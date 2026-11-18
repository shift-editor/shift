use std::str::FromStr;
use std::sync::Arc;

use fontdrasil::coords::{DesignCoord, NormalizedCoord, NormalizedLocation};
use fontdrasil::orchestration::{Access, AccessBuilder, Work};
use fontdrasil::types::{Axes, GlyphName, Tag};
use fontir::error::Error;
use fontir::ir::{AnchorBuilder, Component, ComponentTransform, GlyphBuilder, GlyphInstance};
use fontir::orchestration::{Context, WorkId};
use kurbo::{Affine, BezPath};
use shift_font::{
    AxisId, AxisList, ComponentInheritance, ComponentLocationFill, Glyph, GlyphLayer, open_corners,
};

use super::glyph_axes;
use super::source::{DrawingSource, ShiftSnapshot};

/// Emits the authored drawings and anchors for one Shift glyph, each as a
/// glyph source at its own location.
///
/// The default-source layer is required. Missing layers for other master
/// sources are treated as sparse masters, and a drawing located off the
/// masters (a brace drawing) is a glyph source of its own, for which fontir
/// builds the glyph a variation model of its own. Layers belonging to
/// non-master sources do not participate in compilation.
#[derive(Debug)]
pub(super) struct GlyphWork {
    snapshot: Arc<ShiftSnapshot>,
    glyph: Glyph,
    glyph_name: GlyphName,
}

impl GlyphWork {
    pub(super) fn new(snapshot: Arc<ShiftSnapshot>, glyph: Glyph) -> Self {
        let glyph_name = glyph.name().into();
        Self {
            snapshot,
            glyph,
            glyph_name,
        }
    }
}

impl Work<Context, WorkId, Error> for GlyphWork {
    fn id(&self) -> WorkId {
        WorkId::Glyph(self.glyph_name.clone())
    }

    fn read_access(&self) -> Access<WorkId> {
        Access::Variant(WorkId::StaticMetadata)
    }

    fn write_access(&self) -> Access<WorkId> {
        AccessBuilder::new()
            .specific_instance(WorkId::Glyph(self.glyph_name.clone()))
            .specific_instance(WorkId::Anchor(self.glyph_name.clone()))
            .build()
    }

    fn also_completes(&self) -> Vec<WorkId> {
        vec![WorkId::Anchor(self.glyph_name.clone())]
    }

    fn exec(&self, context: &Context) -> Result<(), Error> {
        self.glyph
            .layer_for_source(self.snapshot.default_source_id)
            .ok_or_else(|| {
                Error::InvalidEntry(
                    "Shift glyph",
                    format!(
                        "'{}' has no layer for the default source",
                        self.glyph.name()
                    ),
                )
            })?;

        let metadata = context.static_metadata.get();
        let mut builder = GlyphBuilder::new(self.glyph_name.clone());
        builder.emit_to_binary = !self.snapshot.skipped_glyphs.contains(self.glyph.name());
        builder
            .codepoints
            .extend(self.glyph.unicodes().iter().copied());
        let mut anchors = AnchorBuilder::new(self.glyph_name.clone());

        let masters = self.snapshot.glyph_masters(&metadata)?;
        let drawings = self
            .snapshot
            .drawing_sources(&self.glyph, &masters, &metadata)?;
        // A drawing stores only the component axes its designer set; fill each with what it
        // inherits, as interpolation reads it, so every drawing locates the same axes.
        let layers: Vec<&GlyphLayer> = drawings.iter().map(DrawingSource::drawing).collect();
        let fill = ComponentLocationFill::new(&self.snapshot.axes, &layers);
        let mut sources = Vec::new();
        for drawing in &drawings {
            let layer = drawing.drawing();
            let filled = fill.fill(
                self.snapshot.axes.as_slice(),
                layer,
                &drawing.design_location,
            );
            let mut instance = to_glyph_instance(
                filled.as_ref().unwrap_or(layer),
                &self.snapshot,
                &metadata.all_source_axes,
            );
            if self.snapshot.nonspacing_marks.contains(self.glyph.name()) {
                // Glyphs exports nonspacing marks with no advance.
                instance.width = 0.0;
            }
            add_anchors(&mut anchors, layer, &drawing.location)?;
            sources.push((&drawing.location, instance));
        }
        erase_open_corners(&mut sources);
        for (location, instance) in sources {
            builder.try_add_source(location, instance)?;
        }

        builder.axes = self.snapshot.hidden_axes.of_glyph(self.glyph.id());

        context.anchors.set(anchors.build()?);
        context.glyphs.set(builder.build()?);
        Ok(())
    }
}

/// Erases open corners in the glyph's masters, as fontc erases them for a
/// Glyphs source, keeping a contour as authored in every master when erasing
/// would leave the masters different: `shift_font::open_corners`.
fn erase_open_corners(sources: &mut [(&NormalizedLocation, GlyphInstance)]) {
    let mut contours: Vec<Vec<BezPath>> = sources
        .iter_mut()
        .map(|(_, instance)| std::mem::take(&mut instance.contours))
        .collect();
    open_corners::erase_open_corners_in_masters(&mut contours);
    for ((_, instance), erased) in sources.iter_mut().zip(contours) {
        instance.contours = erased;
    }
}

/// One drawing as fontir reads it. A component's location is its design
/// values on font axes, normalized through `ir_axes` as the font's own
/// coordinates are, and on its base glyph's own axes, normalized over each
/// axis's range and tagged as [`HiddenAxes`](super::glyph_axes::HiddenAxes)
/// compiles them. A base glyph axis the component doesn't set is written at
/// its default, since glyph axes are never inherited and the hidden tags are
/// shared across glyphs. `Font` inheritance is VARC's
/// `RESET_UNSPECIFIED_AXES`. A component with a location or that reset is a
/// variable component, which fontc writes to `VARC` or decomposes at its
/// location.
fn to_glyph_instance(
    layer: &GlyphLayer,
    snapshot: &ShiftSnapshot,
    ir_axes: &Axes,
) -> GlyphInstance {
    let font_axis_coordinate = |axis_id: AxisId, value: f64| {
        let tag = Tag::from_str(snapshot.axes.axis(axis_id)?.tag()).ok()?;
        let ir_axis = ir_axes.get(&tag)?;
        Some((
            tag,
            DesignCoord::new(value).to_normalized(&ir_axis.converter),
        ))
    };
    let normalized = |component: &shift_font::Component| -> NormalizedLocation {
        let mut location: NormalizedLocation = component
            .location()
            .iter()
            .filter_map(|(axis_id, value)| {
                font_axis_coordinate(*axis_id, *value).or_else(|| {
                    let ir_axis = snapshot.hidden_axes.axis(*axis_id)?;
                    Some((ir_axis.tag, glyph_axes::normalized(ir_axis, *value)))
                })
            })
            .collect();
        for base_axis in snapshot
            .hidden_axes
            .of_glyph(component.base_glyph_id())
            .iter()
        {
            if location.get(base_axis.tag).is_none() {
                location.insert(base_axis.tag, NormalizedCoord::new(0.0));
            }
        }
        location
    };
    GlyphInstance {
        width: layer.width(),
        height: layer.height(),
        vertical_origin: None,
        contours: layer.contours_iter().map(BezPath::from).collect(),
        components: layer
            .components_iter()
            .map(|component| {
                let transform = component.matrix();
                Component {
                    base: component.base_glyph_name().as_str().into(),
                    transform: ComponentTransform::Affine(Affine::new([
                        transform.xx,
                        transform.xy,
                        transform.yx,
                        transform.yy,
                        transform.dx,
                        transform.dy,
                    ])),
                    anchor: None,
                    location: normalized(component),
                    reset_unspecified_axes: component.inheritance() == ComponentInheritance::Font,
                }
            })
            .collect(),
    }
}

fn add_anchors(
    anchors: &mut AnchorBuilder,
    layer: &GlyphLayer,
    location: &NormalizedLocation,
) -> Result<(), Error> {
    for anchor in layer.anchors_iter() {
        let Some(name) = anchor.name() else {
            continue;
        };
        anchors.add(
            name.into(),
            location.clone(),
            (anchor.x(), anchor.y()).into(),
        )?;
    }

    Ok(())
}
