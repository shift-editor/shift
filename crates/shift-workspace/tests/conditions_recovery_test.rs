//! Glyph alternates and component conditions, left as unsaved edits in a
//! document's recovery overlay by a crash, reopen in a workspace exactly,
//! through its lazily loaded directory, and saving keeps them.

mod support;

use shift_font::test_support::conditions_font;

#[test]
fn unsaved_alternates_and_component_conditions_reopen_and_save_in_a_workspace() {
    let tail = ["U", "T", "mid", "HX", "H", "dollarcomp", "dollar"];

    let checks = support::unsaved_glyphs_reopen_and_save(&conditions_font(), &tail);

    // Dirty and exact on reopening; clean and exact after saving.
    assert_eq!(checks.unwrap(), [(true, true), (false, true)]);
}
