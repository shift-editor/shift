use std::path::PathBuf;

use shift_backends::font_loader::FontLoader;
use shift_backends::shaper_font::{compile_shaper_font, ShaperFontRequest};

#[test]
fn imported_glyphs_features_compile_into_a_shaper_font() {
    let path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/fonts/Homenaje.glyphs");
    let font = FontLoader::new().read_font(path.to_str().unwrap()).unwrap();
    assert!(font.features().has_features());

    let request = ShaperFontRequest::from_font(&font).unwrap();
    let compilation = compile_shaper_font(&request).unwrap();

    let shaper_font = compilation
        .font
        .unwrap_or_else(|| panic!("feature source failed to compile:\n{}", compilation.report));
    assert!(!shaper_font.bytes().is_empty());
}
