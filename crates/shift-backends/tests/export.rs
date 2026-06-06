use std::path::{Path, PathBuf};

use shift_backends::font_loader::FontLoader;
use shift_backends::{ExportFormat, FontExportRequest, FontExporter};
use shift_font::{Font, Glyph, GlyphLayer};

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

#[test]
fn exports_mutatorsans_ufo_to_readable_ttf() {
    let source = load_font(&mutatorsans_ufo_path());
    let temp_dir = tempfile::tempdir().expect("tempdir should be created");
    let output_path = temp_dir.path().join("MutatorSansLightCondensed.ttf");

    FontExporter::new()
        .export(
            &source,
            FontExportRequest {
                path: output_path.clone(),
                format: ExportFormat::Ttf,
            },
        )
        .expect("MutatorSans UFO should export as TTF");

    let exported = load_font(&output_path);

    let exported_family = exported
        .metadata()
        .family_name
        .as_deref()
        .expect("exported TTF should include a family name");
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
        "exported family name should include source family: {exported_family}"
    );
    assert!(
        exported_family.contains(source_style)
            || exported.metadata().style_name.as_deref() == Some(source_style),
        "exported name data should include source style: family={exported_family}, style={:?}",
        exported.metadata().style_name
    );
    assert_eq!(
        exported.metrics().units_per_em,
        source.metrics().units_per_em
    );

    for codepoint in [0x0041, 0x004F, 0x0053] {
        let glyph = exported
            .glyphs_by_unicode(codepoint)
            .next()
            .unwrap_or_else(|| panic!("exported TTF should contain U+{codepoint:04X}"));
        let layer = main_layer(glyph);

        assert!(
            !layer.contours().is_empty(),
            "U+{codepoint:04X} should retain exported outlines"
        );
        assert!(
            layer.width() > 0.0,
            "U+{codepoint:04X} should retain exported advance width"
        );
    }

    for codepoint in [0x0041, 0x004F] {
        let source_glyph = source
            .glyphs_by_unicode(codepoint)
            .next()
            .unwrap_or_else(|| panic!("source UFO should contain U+{codepoint:04X}"));
        let exported_glyph = exported
            .glyphs_by_unicode(codepoint)
            .next()
            .unwrap_or_else(|| panic!("exported TTF should contain U+{codepoint:04X}"));
        let source_layer = main_layer(source_glyph);
        let exported_layer = main_layer(exported_glyph);

        assert!(
            (exported_layer.width() - source_layer.width()).abs() < 0.001,
            "U+{codepoint:04X} should retain source advance width"
        );
    }
}
