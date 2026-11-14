//! Generated fonts: any small valid font made in Shift, exported as a
//! designspace (or as a UFO when it has one master), reads back with every
//! part the sources carry unchanged.

use std::collections::BTreeSet;

use proptest::prelude::*;
use shift_backends::formats::designspace::DesignspaceReader;
use shift_backends::formats::ufo::UfoReader;
use shift_backends::{ExportFormat, FontExportRequest, FontExporter, FontReader};
use shift_font::{
    Anchor, Axis, AxisMapping, AxisMappingPoint, Component, Contour, DesignLocation,
    ExternalLocation, Font, Glyph, GlyphId, GlyphLayer, KerningPair, LayerId, Location,
    NamedInstance, PointType, Source, SourceId, Transform,
};

use super::Fixture;
use super::summary::FontSummary;

const AXES: [(&str, &str); 6] = [
    ("wght", "Weight"),
    ("wdth", "Width"),
    ("opsz", "Optical size"),
    ("RESO", "Resolution"),
    ("BLED", "Bleed"),
    ("XTRA", "Counter width"),
];
const MASTER_NAMES: [&str; 5] = ["Bold", "Light Italic", "Wide/Bled", "Größe", "Thin"];
const GLYPH_NAMES: [&str; 8] = ["a", "A", "dot", "a.alt", "f_i", "uni0627", "acutecomb", "Ä"];
const ANCHOR_NAMES: [&str; 4] = ["top", "_top", "bottom", "exit"];
const INSTANCE_NAMES: [&str; 3] = ["Regular", "Display Wide", "Ünïcode"];

#[derive(Clone, Debug)]
struct AxisSpec {
    tag: &'static str,
    name: &'static str,
    minimum: i32,
    default: i32,
    maximum: i32,
    /// Maps user `u` to design `2u`, so design and user coordinates differ.
    mapped: bool,
    hidden: bool,
}

impl AxisSpec {
    fn design(&self, user: i32) -> f64 {
        let factor = if self.mapped { 2.0 } else { 1.0 };
        f64::from(user) * factor
    }

    /// The user value `step` quarters (0..=4) of the way along the axis.
    fn at(&self, step: i32) -> i32 {
        self.minimum + (self.maximum - self.minimum) * step / 4
    }
}

#[derive(Clone, Debug)]
struct MasterSpec {
    name: &'static str,
    italic_angle: Option<i8>,
    line_gap: Option<u8>,
    /// Quarter steps along each axis, by axis index.
    steps: Vec<i32>,
}

#[derive(Clone, Debug)]
enum Segment {
    Line(i16, i16),
    Cubic([(i16, i16); 3]),
}

#[derive(Clone, Debug)]
struct ContourSpec {
    start: (i16, i16),
    /// Segments, each with its end point's smooth flag.
    segments: Vec<(Segment, bool)>,
    closed: bool,
    /// Two off-curve points that close the contour with a curve back to its start.
    closing_curve: Option<[(i16, i16); 2]>,
}

#[derive(Clone, Debug)]
struct ComponentSpec {
    /// Picks a base among the glyphs before this one.
    base: prop::sample::Index,
    scale: (f64, f64),
    offset: (i16, i16),
}

#[derive(Clone, Debug)]
struct AnchorSpec {
    name: &'static str,
    x: i16,
    y: i16,
}

#[derive(Clone, Debug)]
struct LayerSpec {
    width: u16,
    contours: Vec<ContourSpec>,
    components: Vec<ComponentSpec>,
    anchors: Vec<AnchorSpec>,
}

#[derive(Clone, Debug)]
struct GlyphSpec {
    name: &'static str,
    unicode: Option<u32>,
    /// One layer per master slot; slot 0 is the default master. `None` leaves
    /// a non-default master without a layer.
    layers: Vec<Option<LayerSpec>>,
}

#[derive(Clone, Debug)]
struct KerningSpec {
    first: prop::sample::Index,
    second: prop::sample::Index,
    /// One value per master slot.
    values: Vec<i16>,
}

#[derive(Clone, Debug)]
struct InstanceSpec {
    name: &'static str,
    steps: Vec<i32>,
    postscript: bool,
}

#[derive(Clone, Debug)]
struct FontSpec {
    axes: Vec<AxisSpec>,
    masters: Vec<MasterSpec>,
    /// Where the default master sits in the font's source order.
    default_index: prop::sample::Index,
    glyphs: Vec<GlyphSpec>,
    kerning: Vec<KerningSpec>,
    instances: Vec<InstanceSpec>,
    features: Option<&'static str>,
}

fn point() -> impl Strategy<Value = (i16, i16)> {
    (-200i16..1200, -300i16..1000)
}

fn segment() -> impl Strategy<Value = (Segment, bool)> {
    let segment = prop_oneof![
        point().prop_map(|(x, y)| Segment::Line(x, y)),
        [point(), point(), point()].prop_map(Segment::Cubic),
    ];
    (segment, any::<bool>())
}

fn contour() -> impl Strategy<Value = ContourSpec> {
    (
        point(),
        prop::collection::vec(segment(), 1..5),
        any::<bool>(),
        prop::option::of([point(), point()]),
    )
        .prop_map(|(start, segments, closed, closing_curve)| ContourSpec {
            start,
            segments,
            closed,
            closing_curve: closing_curve.filter(|_| closed),
        })
}

fn component() -> impl Strategy<Value = ComponentSpec> {
    let scale = prop::sample::select(vec![
        (1.0, 1.0),
        (0.5, 2.0),
        (-1.0, 1.0),
        (1.0, -1.0),
        (-1.0, -1.0),
    ]);
    (any::<prop::sample::Index>(), scale, point()).prop_map(|(base, scale, offset)| ComponentSpec {
        base,
        scale,
        offset,
    })
}

fn anchor() -> impl Strategy<Value = AnchorSpec> {
    (prop::sample::select(ANCHOR_NAMES.to_vec()), point()).prop_map(|(name, (x, y))| AnchorSpec {
        name,
        x,
        y,
    })
}

fn layer() -> impl Strategy<Value = LayerSpec> {
    (
        0u16..1200,
        prop::collection::vec(contour(), 0..3),
        prop::collection::vec(component(), 0..3),
        prop::collection::vec(anchor(), 0..3),
    )
        .prop_map(|(width, contours, components, anchors)| LayerSpec {
            width,
            contours,
            components,
            anchors,
        })
}

fn glyphs() -> impl Strategy<Value = Vec<GlyphSpec>> {
    prop::sample::subsequence(GLYPH_NAMES.to_vec(), 1..6).prop_flat_map(|names| {
        let count = names.len();
        let glyph = (
            prop::option::of(0x21u32..0x3000),
            prop::collection::vec(prop::option::weighted(0.8, layer()), 4),
        );
        (Just(names), prop::collection::vec(glyph, count)).prop_map(|(names, glyphs)| {
            names
                .into_iter()
                .zip(glyphs)
                .map(|(name, (unicode, layers))| GlyphSpec {
                    name,
                    unicode,
                    layers,
                })
                .collect()
        })
    })
}

fn axes() -> impl Strategy<Value = Vec<AxisSpec>> {
    prop::sample::subsequence(AXES.to_vec(), 0..=3).prop_flat_map(|picked| {
        let count = picked.len();
        let ranges = prop::collection::vec(
            (0i32..400, 1i32..400, 0i32..=4, any::<bool>(), any::<bool>()),
            count,
        );
        (Just(picked), ranges).prop_map(|(picked, ranges)| {
            picked
                .into_iter()
                .zip(ranges)
                .map(
                    |((tag, name), (minimum, span, step, mapped, hidden))| AxisSpec {
                        tag,
                        name,
                        minimum,
                        default: minimum + span * step / 4,
                        maximum: minimum + span,
                        mapped,
                        hidden,
                    },
                )
                .collect()
        })
    })
}

/// Up to three masters besides the default; none without axes.
fn masters(axis_count: usize) -> impl Strategy<Value = Vec<MasterSpec>> {
    let count = if axis_count == 0 { 0..1 } else { 0..4 };
    prop::sample::subsequence(MASTER_NAMES.to_vec(), count).prop_flat_map(move |names| {
        let count = names.len();
        let master = (
            prop::collection::vec(0i32..=4, axis_count),
            prop::option::of(-20i8..20),
            prop::option::of(any::<u8>()),
        );
        (Just(names), prop::collection::vec(master, count)).prop_map(|(names, masters)| {
            names
                .into_iter()
                .zip(masters)
                .map(|(name, (steps, italic_angle, line_gap))| MasterSpec {
                    name,
                    steps,
                    italic_angle,
                    line_gap,
                })
                .collect()
        })
    })
}

fn instances(axis_count: usize) -> BoxedStrategy<Vec<InstanceSpec>> {
    if axis_count == 0 {
        return Just(Vec::new()).boxed();
    }

    prop::sample::subsequence(INSTANCE_NAMES.to_vec(), 0..=3)
        .prop_flat_map(move |names| {
            let count = names.len();
            let specs = prop::collection::vec(
                (prop::collection::vec(0i32..=4, axis_count), any::<bool>()),
                count,
            );
            (Just(names), specs)
        })
        .prop_map(|(names, specs)| {
            names
                .into_iter()
                .zip(specs)
                .map(|(name, (steps, postscript))| InstanceSpec {
                    name,
                    steps,
                    postscript,
                })
                .collect()
        })
        .boxed()
}

fn kerning() -> impl Strategy<Value = Vec<KerningSpec>> {
    let pair = (
        any::<prop::sample::Index>(),
        any::<prop::sample::Index>(),
        prop::collection::vec(-200i16..200, 4),
    );
    prop::collection::vec(pair, 0..4).prop_map(|pairs| {
        pairs
            .into_iter()
            .map(|(first, second, values)| KerningSpec {
                first,
                second,
                values,
            })
            .collect()
    })
}

fn font_spec() -> impl Strategy<Value = FontSpec> {
    axes().prop_flat_map(|axes| {
        let axis_count = axes.len();
        (
            Just(axes),
            masters(axis_count),
            any::<prop::sample::Index>(),
            glyphs(),
            kerning(),
            instances(axis_count),
            prop::option::of(prop::sample::select(vec![
                "languagesystem DFLT dflt;\n",
                "feature liga {\n    sub f i by f_i;\n} liga;\n",
            ])),
        )
            .prop_map(
                |(axes, masters, default_index, glyphs, kerning, instances, features)| FontSpec {
                    axes,
                    masters,
                    default_index,
                    glyphs,
                    kerning,
                    instances,
                    features,
                },
            )
    })
}

fn contour_from(spec: &ContourSpec) -> Contour {
    let mut contour = Contour::new();
    let mut add = |(x, y): (i16, i16), point_type, smooth| {
        contour.add_point(f64::from(x), f64::from(y), point_type, smooth);
    };
    add(spec.start, PointType::OnCurve, false);
    for (segment, smooth) in &spec.segments {
        match segment {
            Segment::Line(x, y) => add((*x, *y), PointType::OnCurve, *smooth),
            Segment::Cubic([first, second, end]) => {
                add(*first, PointType::OffCurve, false);
                add(*second, PointType::OffCurve, false);
                add(*end, PointType::OnCurve, *smooth);
            }
        }
    }
    if let Some([first, second]) = spec.closing_curve {
        add(first, PointType::OffCurve, false);
        add(second, PointType::OffCurve, false);
    }
    if spec.closed {
        contour.close();
    }
    contour
}

fn layer_from(spec: &LayerSpec, source: SourceId, bases: &[(GlyphId, &str)]) -> GlyphLayer {
    let mut layer = GlyphLayer::with_width(LayerId::new(), source, f64::from(spec.width));
    for contour in &spec.contours {
        layer.add_contour(contour_from(contour));
    }
    if !bases.is_empty() {
        for component in &spec.components {
            let (base_id, base_name) = *component.base.get(bases);
            let matrix = Transform {
                dx: f64::from(component.offset.0),
                dy: f64::from(component.offset.1),
                ..Transform::scale(component.scale.0, component.scale.1)
            };
            layer.add_component(Component::with_matrix(base_id, base_name, &matrix));
        }
    }
    for anchor in &spec.anchors {
        layer.add_anchor(Anchor::new(
            Some(anchor.name.to_string()),
            f64::from(anchor.x),
            f64::from(anchor.y),
        ));
    }
    layer
}

/// Builds the font `spec` describes, with its masters in generated order and
/// the default master at `default_index` among them.
fn font_from(spec: &FontSpec) -> Fixture<Font> {
    let mut font = Font::new();
    font.metadata_mut().family_name = Some("Generated".to_string());
    if let Some(features) = spec.features {
        font.features_mut()
            .set_fea_source(Some(features.to_string()));
    }

    let mut axis_ids = Vec::new();
    for axis in &spec.axes {
        let mut shift_axis = Axis::new(
            axis.tag.to_string(),
            axis.name.to_string(),
            f64::from(axis.minimum),
            f64::from(axis.default),
            f64::from(axis.maximum),
        );
        shift_axis.set_hidden(axis.hidden);
        axis_ids.push(shift_axis.id());
        font.add_axis(shift_axis)?;
    }
    let mappings = spec
        .axes
        .iter()
        .zip(&axis_ids)
        .filter(|(axis, _)| axis.mapped)
        .map(|(axis, id)| {
            let users: BTreeSet<_> = [axis.minimum, axis.default, axis.maximum].into();
            let points = users
                .into_iter()
                .map(|user| AxisMappingPoint {
                    description: None,
                    input: Location::from([(*id, f64::from(user))]),
                    output: Location::from([(*id, axis.design(user))]),
                })
                .collect();
            AxisMapping::new(axis.name.to_string(), vec![*id], vec![*id], points)
        })
        .collect();
    font.set_axis_mappings(mappings)?;

    let design_at = |steps: &[i32]| -> DesignLocation {
        spec.axes
            .iter()
            .zip(&axis_ids)
            .zip(steps)
            .map(|((axis, id), step)| (*id, axis.design(axis.at(*step))))
            .collect()
    };
    let default_location: DesignLocation = spec
        .axes
        .iter()
        .zip(&axis_ids)
        .map(|(axis, id)| (*id, axis.design(axis.default)))
        .collect();

    // Masters sit at distinct locations away from the default, where only
    // the default master may be.
    let mut seen = vec![default_location.clone()];
    let mut sources = Vec::new();
    for master in &spec.masters {
        let location = design_at(&master.steps);
        if seen.contains(&location) {
            continue;
        }
        seen.push(location.clone());
        let mut source = Source::new(master.name.to_string(), location);
        source.set_italic_angle(master.italic_angle.map(f64::from));
        source.set_line_gap(master.line_gap.map(f64::from));
        sources.push(source);
    }

    let default_id = font
        .default_source_id()
        .ok_or("a new font has a default source")?;
    let mut default_source = font
        .source(default_id)
        .ok_or("the default source is in the font")?
        .clone();
    default_source.set_location(default_location);
    let master_slots: Vec<SourceId> = std::iter::once(default_id)
        .chain(sources.iter().map(Source::id))
        .collect();
    sources.insert(spec.default_index.index(sources.len() + 1), default_source);
    font.clear_sources();
    for source in sources {
        font.add_source(source);
    }
    font.set_default_source_id(default_id);

    let mut glyphs: Vec<(GlyphId, &str)> = Vec::new();
    let mut unicodes = BTreeSet::new();
    for glyph_spec in &spec.glyphs {
        let mut glyph = match glyph_spec.unicode.filter(|code| unicodes.insert(*code)) {
            Some(code) => Glyph::with_unicode(glyph_spec.name, code),
            None => Glyph::new(glyph_spec.name),
        };
        // A glyph has a layer in at least one master; a glyph with none has
        // no file in any UFO.
        let has_layer = glyph_spec
            .layers
            .iter()
            .take(master_slots.len())
            .any(Option::is_some);
        for (slot, source) in master_slots.iter().enumerate() {
            let layer = match glyph_spec.layers.get(slot).and_then(Option::as_ref) {
                Some(layer) => layer_from(layer, *source, &glyphs),
                None if slot == 0 && !has_layer => {
                    GlyphLayer::with_width(LayerId::new(), *source, 500.0)
                }
                None => continue,
            };
            glyph.set_layer(layer);
        }
        let id = font.insert_glyph(glyph)?;
        glyphs.push((id, glyph_spec.name));
    }

    for pair in &spec.kerning {
        let (first, _) = *pair.first.get(&glyphs);
        let (second, _) = *pair.second.get(&glyphs);
        for (source, value) in master_slots.iter().zip(&pair.values) {
            font.kerning_mut().set_value(
                *source,
                KerningPair::glyphs(first, second),
                f64::from(*value),
            );
        }
    }

    let mut instance_locations = Vec::new();
    let mut instances = Vec::new();
    for (index, instance) in spec.instances.iter().enumerate() {
        let location: ExternalLocation = spec
            .axes
            .iter()
            .zip(&axis_ids)
            .zip(&instance.steps)
            .map(|((axis, id), step)| (*id, f64::from(axis.at(*step))))
            .collect();
        if instance_locations.contains(&location) {
            continue;
        }
        instance_locations.push(location.clone());
        let postscript = instance
            .postscript
            .then(|| format!("Generated-Instance{index}"));
        instances.push(NamedInstance::new(
            instance.name.to_string(),
            location,
            postscript,
        ));
    }
    font.set_named_instances(instances)?;

    Ok(font)
}

/// Exports `font` as `format` to a file named `file` and reads it back.
fn round_trip(font: &Font, file: &str, format: ExportFormat) -> Fixture<Font> {
    let temp = tempfile::tempdir()?;
    let path = temp.path().join(file);
    FontExporter::new().export(
        font,
        FontExportRequest {
            path: path.clone(),
            format,
        },
    )?;
    let path = path.to_str().ok_or("temp paths are UTF-8")?;
    let read = match format {
        ExportFormat::Ufo => UfoReader::new().load(path)?,
        _ => DesignspaceReader::new().load(path)?,
    };
    Ok(read)
}

/// A fixture failure as a failed proptest case.
fn fail(error: &dyn std::error::Error) -> TestCaseError {
    TestCaseError::fail(error.to_string())
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    #[test]
    fn designspace_export_reads_back_unchanged(spec in font_spec()) {
        let font = font_from(&spec).map_err(|error| fail(&*error))?;

        let read = round_trip(&font, "Generated.designspace", ExportFormat::Designspace)
            .map_err(|error| fail(&*error))?;

        let differences = FontSummary::of(&read).differences(&FontSummary::of(&font));
        prop_assert!(differences.is_empty(), "{}", differences.join("\n"));
    }

    #[test]
    fn single_master_ufo_export_reads_back_unchanged(spec in font_spec()) {
        let spec = FontSpec {
            axes: Vec::new(),
            masters: Vec::new(),
            instances: Vec::new(),
            ..spec
        };
        let font = font_from(&spec).map_err(|error| fail(&*error))?;

        let read = round_trip(&font, "Generated.ufo", ExportFormat::Ufo).map_err(|error| fail(&*error))?;

        let differences = FontSummary::of(&read).differences(&FontSummary::of(&font));
        prop_assert!(differences.is_empty(), "{}", differences.join("\n"));
    }
}
