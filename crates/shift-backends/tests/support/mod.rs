//! Fonts more than one integration test loads.

use shift_backends::font_loader::FontLoader;
use shift_font::Font;
use shift_font::test_support::fixtures;

/// MutatorSans, read from its designspace fixture.
pub(crate) fn mutatorsans() -> Font {
    let path = fixtures::mutatorsans_designspace();
    FontLoader::new()
        .read_font(&path.to_string_lossy())
        .expect("MutatorSans should load")
}
