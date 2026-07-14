use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use shift_backends::font_loader::FontLoader;
use shift_backends::{ExportFormat, FontExportRequest, FontExporter};
use shift_font::test_support::sample_variable_font;
use shift_font::Font;
use skrifa::raw::TableProvider;
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

#[derive(Debug, PartialEq)]
struct StaticCompilation {
    units_per_em: f64,
    glyphs: BTreeMap<u32, CompiledGlyph>,
}

#[derive(Debug, PartialEq)]
struct CompiledGlyph {
    advance: f64,
    has_geometry: bool,
}

impl From<&Font> for StaticCompilation {
    fn from(font: &Font) -> Self {
        let mut glyphs = BTreeMap::new();
        let default_source_id = font
            .default_source_id()
            .expect("compiled fixture should have a default source");
        for glyph in font.glyphs() {
            let layer = glyph
                .layer_for_source(default_source_id.clone())
                .expect("encoded glyph should have a default layer");
            for unicode in glyph.unicodes() {
                glyphs.insert(
                    *unicode,
                    CompiledGlyph {
                        advance: layer.width(),
                        has_geometry: !layer.contours().is_empty()
                            || !layer.components().is_empty(),
                    },
                );
            }
        }

        Self {
            units_per_em: font.metrics().units_per_em,
            glyphs,
        }
    }
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
    let exported = load_font(&output_path);

    let exported_family = exported
        .metadata()
        .family_name
        .as_deref()
        .expect("compiled font should contain a family name");
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
        exported_family.contains(source_family),
        "compiled family name should include source family: {exported_family}"
    );
    // A source-declared style map wins the exported subfamily name, so the
    // style name is either the source style or its declared style-map style.
    let source_style_map = match source.fontinfo_remainder().get("styleMapStyleName") {
        Some(shift_font::LibValue::String(style_map)) => Some(style_map.as_str()),
        _ => None,
    };
    assert!(
        exported_family.contains(source_style)
            || exported.metadata().style_name.as_deref() == Some(source_style)
            || exported
                .metadata()
                .style_name
                .as_deref()
                .zip(source_style_map)
                .is_some_and(|(exported_style, style_map)| {
                    exported_style.eq_ignore_ascii_case(style_map)
                }),
        "compiled name data should include source style"
    );
    assert_eq!(
        StaticCompilation::from(&exported),
        StaticCompilation::from(&source)
    );
    assert!(compiled.glyf().is_ok(), "compiled font should contain glyf");
    assert!(compiled.hmtx().is_ok(), "compiled font should contain hmtx");
    assert!(
        compiled.gpos().is_ok(),
        "compiled kerning should produce GPOS"
    );
}

#[test]
fn compiles_variable_shift_source_to_variation_tables() {
    let temp_dir = tempfile::tempdir().expect("tempdir should be created");
    let shift_path = temp_dir.path().join("Variable.shift");
    let output_path = temp_dir.path().join("Variable.ttf");
    FontLoader::new()
        .write_font(&sample_variable_font(), shift_path.to_str().unwrap())
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
    assert_eq!(
        fvar.instance_count(),
        1,
        "only explicit instances are emitted"
    );
    let instance = compiled
        .named_instances()
        .get(0)
        .expect("authored Bold instance should compile");
    assert_eq!(instance.user_coords().collect::<Vec<_>>(), vec![900.0]);
    assert_eq!(
        compiled
            .localized_strings(instance.subfamily_name_id())
            .english_or_first()
            .unwrap()
            .to_string(),
        "Bold"
    );
    assert_eq!(
        compiled
            .localized_strings(instance.postscript_name_id().unwrap())
            .english_or_first()
            .unwrap()
            .to_string(),
        "UntitledFont-Bold"
    );
    compiled.avar().expect("mapped axis should contain avar");
    compiled.stat().expect("axis labels should produce STAT");
    compiled
        .gvar()
        .expect("variable outlines should produce gvar");
}
