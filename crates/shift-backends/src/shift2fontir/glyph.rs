use std::sync::Arc;

use fontdrasil::coords::NormalizedLocation;
use fontdrasil::orchestration::{Access, AccessBuilder, Work};
use fontdrasil::types::GlyphName;
use fontir::error::Error;
use fontir::ir::{AnchorBuilder, Component, GlyphBuilder, GlyphInstance};
use fontir::orchestration::{Context, WorkId};
use kurbo::{Affine, BezPath};
use shift_font::{Contour, CurveSegment, Glyph};

use super::source::ShiftSnapshot;

#[derive(Debug)]
pub(super) struct GlyphWork {
    snapshot: Arc<ShiftSnapshot>,
    glyph: Glyph,
    glyph_name: GlyphName,
}

impl GlyphWork {
    pub fn new(snapshot: Arc<ShiftSnapshot>, glyph: Glyph) -> Self {
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
        let layer = self
            .glyph
            .layer_for_source(self.snapshot.default_source_id.clone())
            .ok_or_else(|| {
                Error::InvalidEntry(
                    "Shift glyph",
                    format!(
                        "'{}' has no layer for the default source",
                        self.glyph.name()
                    ),
                )
            })?;
        let location = NormalizedLocation::default();
        let mut builder = GlyphBuilder::new(self.glyph_name.clone());
        builder
            .codepoints
            .extend(self.glyph.unicodes().iter().copied());
        builder.try_add_source(
            &location,
            GlyphInstance {
                width: layer.width(),
                height: layer.height(),
                vertical_origin: None,
                contours: layer.contours_iter().map(to_bez_path).collect(),
                components: layer
                    .components_iter()
                    .map(|component| {
                        let transform = component.matrix();
                        Component {
                            base: component.base_glyph_name().as_str().into(),
                            transform: Affine::new([
                                transform.xx,
                                transform.xy,
                                transform.yx,
                                transform.yy,
                                transform.dx,
                                transform.dy,
                            ]),
                        }
                    })
                    .collect(),
            },
        )?;

        let mut anchors = AnchorBuilder::new(self.glyph_name.clone());
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

        context.anchors.set(anchors.build()?);
        context.glyphs.set(builder.build()?);
        Ok(())
    }
}

fn to_bez_path(contour: &Contour) -> BezPath {
    let mut path = BezPath::new();
    let Some(first) = contour.first_point() else {
        return path;
    };

    path.move_to((first.x(), first.y()));
    for segment in contour.segments() {
        match segment {
            CurveSegment::Line(_, end) => path.line_to((end.x(), end.y())),
            CurveSegment::Quad(_, control, end) => {
                path.quad_to((control.x(), control.y()), (end.x(), end.y()));
            }
            CurveSegment::Cubic(_, first_control, second_control, end) => {
                path.curve_to(
                    (first_control.x(), first_control.y()),
                    (second_control.x(), second_control.y()),
                    (end.x(), end.y()),
                );
            }
        }
    }

    if contour.is_closed() {
        path.close_path();
    }

    path
}
