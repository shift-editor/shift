//! Findings from the test-tools spike in proof-text parsing.

use shift_font::{GlyphName, ProofItem, ProofText};

/// A line break typed straight after a glyph name ends the name, as a space
/// or `/` does.
#[test]
#[ignore = "finding: a glyph name runs through a line break (spike note)"]
fn a_line_break_ends_a_glyph_name() {
    let items = ProofText::parse("/a\nb").expect("proof text").into_items();

    assert_eq!(
        items,
        [
            ProofItem::Glyph(GlyphName::new("a").expect("a name")),
            ProofItem::LineBreak,
            ProofItem::Char('b'),
        ]
    );
}
