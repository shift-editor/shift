use std::path::PathBuf;

use shift_backends::{font_loader::FontLoader, ImportLossKind};
use shift_font::test_support::kerning_between;

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("fixtures/fonts")
        .join(name)
}

#[test]
fn glyphs_import_reports_unrepresented_bracket_layers() {
    let path = fixture("GlyphsImportLosses.glyphs");
    let import = FontLoader::new()
        .stream_font(path.to_str().unwrap())
        .expect("Glyphs source should import");

    assert_eq!(import.report().losses.len(), 1);
    let bracket_loss = &import.report().losses[0];
    assert_eq!(bracket_loss.kind, ImportLossKind::Omitted);
    assert!(bracket_loss.message.contains("2 conditional layers"));
    assert!(bracket_loss.message.contains("bracket layers"));

    let font = import
        .collect_font()
        .expect("reported source concepts must not block import");
    let glyph = font.glyph_by_name("space").expect("space should import");
    assert_eq!(glyph.layers().len(), 2);
}

#[test]
fn glyphs_import_keeps_non_default_master_kerning() {
    let path = fixture("GlyphsImportLosses.glyphs");
    let font = FontLoader::new()
        .stream_font(path.to_str().unwrap())
        .expect("Glyphs source should import")
        .collect_font()
        .expect("Glyphs source should collect");

    let default_source_id = font.default_source_id().unwrap();
    let kerned_source = font
        .sources()
        .iter()
        .find(|source| source.id() != default_source_id && source.is_master())
        .expect("the second master should import");
    assert_eq!(
        kerning_between(&font, &kerned_source.id(), "space", "space"),
        Some(-10.0)
    );
    assert_eq!(
        kerning_between(&font, &default_source_id, "space", "space"),
        None
    );
}
