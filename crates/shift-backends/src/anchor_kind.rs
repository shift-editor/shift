//! Reads an anchor's role in mark positioning from its name, as export does.

use fontir::ir::AnchorKind as IrAnchorKind;

/// An anchor's role in mark positioning, read from its name.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AnchorKind {
    /// `top`: marks attach here.
    Base(String),
    /// `_top`: attaches the mark to a base's `top`.
    Mark(String),
    /// `top_2`: marks attach to the second component of a ligature.
    Ligature { group: String, index: usize },
    /// `_3`: a ligature component with no anchors of its own.
    ComponentMarker(usize),
    /// `caret_1`: a caret position inside a ligature.
    Caret(usize),
    /// `vcaret_1`: a vertical caret position inside a ligature.
    VCaret(usize),
    /// `entry`: where the previous glyph's exit joins, in cursive attachment.
    Entry,
    /// `exit`: where the next glyph's entry joins.
    Exit,
    /// A name export rejects, such as `_`, `top_0`, or `_top_1`.
    Invalid,
}

/// Returns the anchor kind export reads from `name`.
pub fn anchor_kind(name: &str) -> AnchorKind {
    match IrAnchorKind::new(name) {
        Ok(IrAnchorKind::Base(group)) => AnchorKind::Base(group.to_string()),
        Ok(IrAnchorKind::Mark(group)) => AnchorKind::Mark(group.to_string()),
        Ok(IrAnchorKind::Ligature { group_name, index }) => AnchorKind::Ligature {
            group: group_name.to_string(),
            index,
        },
        Ok(IrAnchorKind::ComponentMarker(index)) => AnchorKind::ComponentMarker(index),
        Ok(IrAnchorKind::Caret(index)) => AnchorKind::Caret(index),
        Ok(IrAnchorKind::VCaret(index)) => AnchorKind::VCaret(index),
        Ok(IrAnchorKind::CursiveEntry) => AnchorKind::Entry,
        Ok(IrAnchorKind::CursiveExit) => AnchorKind::Exit,
        Err(_) => AnchorKind::Invalid,
    }
}
