use std::path::PathBuf;

use shift_backends::GlyphCategories;
use shift_backends::font_loader::FontLoader;
use shift_text::shaper_font::{ShaperFont, ShaperFontRequest};

#[test]
fn imported_glyphs_features_compile_into_a_shaper_font() {
    let path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/fonts/Homenaje.glyphs");
    let font = FontLoader::new().read_font(path.to_str().unwrap()).unwrap();
    assert!(font.features().has_features());

    let classes = GlyphCategories::new().classes(font.glyphs(), font.lib());
    let source = font.shaper_font_source(&classes);
    let compilation = ShaperFont::compile(&ShaperFontRequest::new(&source).unwrap()).unwrap();

    let shaper_font = compilation.font.unwrap_or_else(|| {
        panic!(
            "feature source failed to compile: {:?}",
            compilation.diagnostics
        )
    });
    assert!(!shaper_font.bytes().is_empty());
}
