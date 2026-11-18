//! A glyph axis and drawings off the font's sources, left as unsaved edits
//! in a document's recovery overlay by a crash, reopen in a workspace
//! exactly, through its lazily loaded directory, and saving keeps them.

mod support;

use shift_font::test_support::glyph_axis_font;

#[test]
fn unsaved_glyph_axes_and_drawings_off_the_sources_reopen_and_save_in_a_workspace() {
    let checks = support::unsaved_glyphs_reopen_and_save(&glyph_axis_font(), &["H", "dot"]);

    // Dirty and exact on reopening; clean and exact after saving.
    assert_eq!(checks.unwrap(), [(true, true), (false, true)]);
}
