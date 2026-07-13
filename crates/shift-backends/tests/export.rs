use std::path::{Path, PathBuf};

use shift_backends::font_loader::FontLoader;
use shift_backends::{ExportFormat, FontExportRequest, FontExporter};
use shift_font::{Font, Glyph, GlyphLayer};
use skrifa::outline::{DrawSettings, OutlinePen};
use skrifa::prelude::{LocationRef, Size};
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
}

impl OutlinePen for OutlineSummary {
    fn move_to(&mut self, _x: f32, _y: f32) {
        self.contours += 1;
    }

    fn line_to(&mut self, _x: f32, _y: f32) {
        self.segments += 1;
    }

    fn quad_to(&mut self, _cx0: f32, _cy0: f32, _x: f32, _y: f32) {
        self.segments += 1;
    }

    fn curve_to(&mut self, _cx0: f32, _cy0: f32, _cx1: f32, _cy1: f32, _x: f32, _y: f32) {
        self.segments += 1;
    }

    fn close(&mut self) {}
}

fn localized_string(font: &FontRef<'_>, id: StringId) -> String {
    font.localized_strings(id)
        .english_or_first()
        .expect("compiled font should contain the requested name")
        .to_string()
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
