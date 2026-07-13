use std::path::{Path, PathBuf};

use shift_backends::font_loader::FontLoader;
use shift_backends::{ExportFormat, FontExportRequest, FontExporter};
use shift_font::{
    Axis, AxisLabel, AxisLabelRange, AxisMapping, AxisMappingPoint, Contour, Font, Glyph,
    GlyphLayer, LayerId, Location, PointType, Source,
};
use skrifa::outline::{DrawSettings, OutlinePen};
use skrifa::prelude::{LocationRef, Size};
use skrifa::raw::tables::stat::{AxisValue, AxisValueTableFlags};
use skrifa::raw::TableProvider;
use skrifa::string::StringId;
use skrifa::{FontRef, MetadataProvider};

fn fixtures_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("fixtures")
}

fn mutatorsans_ufo_path() -> PathBuf {
    fixtures_path().join("fonts/mutatorsans/MutatorSansLightCondensed.ufo")
}

fn load_font(path: &Path) -> Font {
    assert!(path.exists(), "missing font fixture at {}", path.display());
    FontLoader::new()
        .read_font(path.to_str().unwrap())
        .unwrap_or_else(|error| panic!("failed to load {}: {error}", path.display()))
}

fn main_layer(glyph: &Glyph) -> &GlyphLayer {
    glyph
        .layers()
        .values()
        .max_by_key(|layer| layer.contours().len())
        .expect("glyph should have at least one layer")
}

#[derive(Default)]
struct OutlineSummary {
    contours: usize,
    segments: usize,
    x_sum: f32,
}

impl OutlinePen for OutlineSummary {
    fn move_to(&mut self, x: f32, _y: f32) {
        self.contours += 1;
        self.x_sum += x;
    }

    fn line_to(&mut self, x: f32, _y: f32) {
        self.segments += 1;
        self.x_sum += x;
    }

    fn quad_to(&mut self, _cx0: f32, _cy0: f32, x: f32, _y: f32) {
        self.segments += 1;
        self.x_sum += x;
    }

    fn curve_to(&mut self, _cx0: f32, _cy0: f32, _cx1: f32, _cy1: f32, x: f32, _y: f32) {
        self.segments += 1;
        self.x_sum += x;
    }

    fn close(&mut self) {}
}

fn localized_string(font: &FontRef<'_>, id: StringId) -> String {
    font.localized_strings(id)
        .english_or_first()
        .expect("compiled font should contain the requested name")
        .to_string()
}

fn mapping_point(axis: &Axis, user: f64, design: f64) -> AxisMappingPoint {
    let mut input = Location::new();
    input.set(axis.id(), user);
    let mut output = Location::new();
    output.set(axis.id(), design);
    AxisMappingPoint {
        description: None,
        input,
        output,
    }
}

fn triangle_layer(source_id: shift_font::SourceId, width: f64, apex_x: f64) -> GlyphLayer {
    let mut layer = GlyphLayer::with_width(LayerId::new(), source_id, width);
    let mut contour = Contour::new();
    contour.add_point(100.0, 0.0, PointType::OnCurve, false);
    contour.add_point(apex_x, 700.0, PointType::OnCurve, false);
    contour.add_point(500.0, 0.0, PointType::OnCurve, false);
    contour.close();
    layer.add_contour(contour);
    layer
}

fn variable_font() -> Font {
    let mut font = Font::new();
    let mut weight = Axis::weight();
    weight.set_labels(vec![
        AxisLabel {
            name: "Regular".to_string(),
            value: 400.0,
            range: Some(AxisLabelRange {
                minimum: 350.0,
                maximum: 450.0,
            }),
            linked_value: Some(700.0),
            elidable: true,
        },
        AxisLabel {
            name: "Bold".to_string(),
            value: 900.0,
            range: None,
            linked_value: None,
            elidable: false,
        },
    ]);
    let weight_id = weight.id();
    font.add_axis(weight.clone());
    font.set_axis_mappings(vec![AxisMapping::new(
        "Weight curve".to_string(),
        vec![weight_id.clone()],
        vec![weight_id.clone()],
        vec![
            mapping_point(&weight, 100.0, 100.0),
            mapping_point(&weight, 400.0, 400.0),
            mapping_point(&weight, 700.0, 600.0),
            mapping_point(&weight, 900.0, 800.0),
        ],
    )])
    .expect("independent axis mapping should be valid");

    let default_source_id = font.default_source_id().unwrap();
    let mut default_location = Location::new();
    default_location.set(weight_id.clone(), 400.0);
    font.source_mut(default_source_id.clone())
        .unwrap()
        .set_location(default_location);

    let mut medium_location = Location::new();
    medium_location.set(weight_id.clone(), 600.0);
    font.add_source(Source::new("Medium".to_string(), medium_location));
    let mut bold_location = Location::new();
    bold_location.set(weight_id, 800.0);
    let bold_source_id = font.add_source(Source::new("Bold".to_string(), bold_location));

    let mut glyph = Glyph::with_unicode("A".to_string(), 0x0041);
    glyph.set_layer(triangle_layer(default_source_id, 600.0, 300.0));
    glyph.set_layer(triangle_layer(bold_source_id, 800.0, 380.0));
    font.insert_glyph(glyph).unwrap();
    font
}

#[test]
fn compiles_mutatorsans_fixture_to_ttf_tables() {
    let temp_dir = tempfile::tempdir().expect("tempdir should be created");
    let shift_path = temp_dir.path().join("MutatorSansLightCondensed.shift");
    let output_path = temp_dir.path().join("MutatorSansLightCondensed.ttf");
    let imported_fixture = load_font(&mutatorsans_ufo_path());
    FontLoader::new()
        .write_font(&imported_fixture, shift_path.to_str().unwrap())
        .expect("MutatorSans fixture should save as canonical Shift source");
    let source = load_font(&shift_path);

    FontExporter::new()
        .export(
            &source,
            FontExportRequest {
                path: output_path.clone(),
                format: ExportFormat::Ttf,
            },
        )
        .expect("MutatorSans Shift source should compile as TTF");

    let bytes = std::fs::read(&output_path).expect("compiled TTF should be readable");
    let compiled = FontRef::new(&bytes).expect("fontc should emit a valid TTF");

    let compiled_family = localized_string(&compiled, StringId::FAMILY_NAME);
    let compiled_style = localized_string(&compiled, StringId::SUBFAMILY_NAME);
    let source_family = source
        .metadata()
        .family_name
        .as_deref()
        .expect("source UFO should include a family name");
    let source_style = source
        .metadata()
        .style_name
        .as_deref()
        .expect("source UFO should include a style name");

    assert!(
        compiled_family.contains(source_family),
        "compiled family name should include source family: {compiled_family}"
    );
    // A source-declared style map wins the exported subfamily name, so the
    // style name is either the source style or its declared style-map style.
    let source_style_map = match source.fontinfo_remainder().get("styleMapStyleName") {
        Some(shift_font::LibValue::String(style_map)) => Some(style_map.as_str()),
        _ => None,
    };
    assert!(
        compiled_family.contains(source_style)
            || compiled_style == source_style
            || source_style_map
                .is_some_and(|style_map| compiled_style.eq_ignore_ascii_case(style_map)),
        "compiled name data should include source style: family={compiled_family}, style={compiled_style}"
    );
    assert_eq!(
        compiled
            .metrics(Size::unscaled(), LocationRef::default())
            .units_per_em as f64,
        source.metrics().units_per_em,
    );
    assert!(compiled.glyf().is_ok(), "compiled font should contain glyf");
    assert!(compiled.hmtx().is_ok(), "compiled font should contain hmtx");
    assert!(
        compiled.gpos().is_ok(),
        "compiled kerning should produce GPOS"
    );

    let charmap = compiled.charmap();
    let glyph_metrics = compiled.glyph_metrics(Size::unscaled(), LocationRef::default());
    let outlines = compiled.outline_glyphs();
    for codepoint in [0x0041_u32, 0x004F, 0x0053, 0x00C4] {
        let glyph_id = charmap
            .map(codepoint)
            .unwrap_or_else(|| panic!("compiled TTF should contain U+{codepoint:04X}"));
        let outline = outlines
            .get(glyph_id)
            .unwrap_or_else(|| panic!("compiled TTF should outline U+{codepoint:04X}"));
        let mut summary = OutlineSummary::default();
        outline
            .draw(
                DrawSettings::unhinted(Size::unscaled(), LocationRef::default()),
                &mut summary,
            )
            .unwrap_or_else(|error| panic!("failed to draw U+{codepoint:04X}: {error}"));

        assert!(
            summary.contours > 0 && summary.segments > 0,
            "U+{codepoint:04X} should retain compiled outlines"
        );
        assert!(
            glyph_metrics
                .advance_width(glyph_id)
                .is_some_and(|width| width > 0.0),
            "U+{codepoint:04X} should retain compiled advance width"
        );
    }

    for codepoint in [0x0041_u32, 0x004F] {
        let source_glyph = source
            .glyphs_by_unicode(codepoint)
            .next()
            .unwrap_or_else(|| panic!("source UFO should contain U+{codepoint:04X}"));
        let source_layer = main_layer(source_glyph);
        let glyph_id = charmap
            .map(codepoint)
            .unwrap_or_else(|| panic!("compiled TTF should contain U+{codepoint:04X}"));
        let compiled_width = glyph_metrics
            .advance_width(glyph_id)
            .expect("compiled glyph should have an advance width");

        assert!(
            (compiled_width as f64 - source_layer.width()).abs() < 0.001,
            "U+{codepoint:04X} should compile the source advance width"
        );
    }
}

#[test]
fn compiles_variable_shift_source_to_variation_tables() {
    let temp_dir = tempfile::tempdir().expect("tempdir should be created");
    let shift_path = temp_dir.path().join("Variable.shift");
    let output_path = temp_dir.path().join("Variable.ttf");
    FontLoader::new()
        .write_font(&variable_font(), shift_path.to_str().unwrap())
        .expect("variable fixture should save as canonical Shift source");
    let source = load_font(&shift_path);

    FontExporter::new()
        .export(
            &source,
            FontExportRequest {
                path: output_path.clone(),
                format: ExportFormat::Ttf,
            },
        )
        .expect("variable Shift source should compile as TTF");

    let bytes = std::fs::read(&output_path).expect("compiled TTF should be readable");
    let compiled = FontRef::new(&bytes).expect("fontc should emit a valid variable TTF");
    let fvar = compiled.fvar().expect("variable font should contain fvar");
    assert_eq!(fvar.axis_count(), 1);
    assert_eq!(fvar.instance_count(), 0, "source names are not instances");
    let axis = fvar.axis_instance_arrays().unwrap().axes()[0];
    assert_eq!(axis.axis_tag(), skrifa::Tag::new(b"wght"));
    assert_eq!(axis.min_value().to_f32(), 100.0);
    assert_eq!(axis.default_value().to_f32(), 400.0);
    assert_eq!(axis.max_value().to_f32(), 900.0);

    let avar = compiled.avar().expect("mapped axis should contain avar");
    let segment_map = avar.axis_segment_maps().iter().next().unwrap().unwrap();
    assert!(segment_map.axis_value_maps().iter().any(|mapping| {
        mapping.from_coordinate().to_fixed().to_f32() != mapping.to_coordinate().to_fixed().to_f32()
    }));

    let stat = compiled.stat().expect("axis labels should produce STAT");
    assert_eq!(stat.design_axis_count(), 1);
    assert_eq!(stat.axis_value_count(), 3);
    let axis_values = stat
        .offset_to_axis_values()
        .expect("STAT should declare axis values")
        .unwrap();
    let mut saw_range = false;
    let mut saw_link = false;
    let mut saw_bold = false;
    for value in axis_values.axis_values().iter() {
        match value.unwrap() {
            AxisValue::Format1(value) => {
                saw_bold = value.value().to_f32() == 900.0
                    && localized_string(&compiled, value.value_name_id()) == "Bold";
            }
            AxisValue::Format2(value) => {
                saw_range = value.nominal_value().to_f32() == 400.0
                    && value.range_min_value().to_f32() == 350.0
                    && value.range_max_value().to_f32() == 450.0
                    && value
                        .flags()
                        .contains(AxisValueTableFlags::ELIDABLE_AXIS_VALUE_NAME);
            }
            AxisValue::Format3(value) => {
                saw_link = value.value().to_f32() == 400.0
                    && value.linked_value().to_f32() == 700.0
                    && value
                        .flags()
                        .contains(AxisValueTableFlags::ELIDABLE_AXIS_VALUE_NAME);
            }
            AxisValue::Format4(_) => {}
        }
    }
    assert!(saw_range && saw_link && saw_bold);
    assert!(
        compiled.gvar().is_ok(),
        "variable outlines should produce gvar"
    );

    let glyph_id = compiled.charmap().map(0x0041_u32).unwrap();
    let default_width = compiled
        .glyph_metrics(Size::unscaled(), LocationRef::default())
        .advance_width(glyph_id)
        .unwrap();
    let bold_location = compiled.axes().location([("wght", 900.0)]);
    let bold_width = compiled
        .glyph_metrics(Size::unscaled(), &bold_location)
        .advance_width(glyph_id)
        .unwrap();
    assert_eq!(default_width, 600.0);
    assert_eq!(bold_width, 800.0);

    let outline = compiled.outline_glyphs().get(glyph_id).unwrap();
    let mut default_outline = OutlineSummary::default();
    outline
        .draw(
            DrawSettings::unhinted(Size::unscaled(), LocationRef::default()),
            &mut default_outline,
        )
        .unwrap();
    let mut bold_outline = OutlineSummary::default();
    outline
        .draw(
            DrawSettings::unhinted(Size::unscaled(), &bold_location),
            &mut bold_outline,
        )
        .unwrap();
    assert!(bold_outline.x_sum > default_outline.x_sum);
}
