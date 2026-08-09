use std::path::PathBuf;

use shift_backends::{font_loader::FontLoader, ImportLossKind};

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

    assert_eq!(import.report().losses.len(), 2);
    let bracket_loss = &import.report().losses[0];
    assert_eq!(bracket_loss.kind, ImportLossKind::Omitted);
    assert!(bracket_loss.message.contains("2 conditional layers"));
    assert!(bracket_loss.message.contains("bracket layers"));
    let kerning_loss = &import.report().losses[1];
    assert_eq!(kerning_loss.kind, ImportLossKind::Omitted);
    assert!(kerning_loss.message.contains("1 non-default-master"));

    let font = import
        .collect_font()
        .expect("reported source concepts must not block import");
    let glyph = font.glyph_by_name("space").expect("space should import");
    assert_eq!(glyph.layers().len(), 2);
}
