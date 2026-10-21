//! Lays out pages of frames and text runs, in Shift's auto layout vocabulary.
//!
//! A page is a [`LayoutTree`]: frames that place their children in a row or
//! column (or leave them free), text runs measured before layout, and leaves
//! of fixed size. [`LayoutTree::layout`] returns a box for every node and the
//! lines of every text run, in one pass with no callbacks, so a host across a
//! boundary (the editor, through WebAssembly) crosses it once per layout.
//!
//! The vocabulary is Figma's: a frame's layout is `free`, `row`, or `column`,
//! with gap, padding, alignment, and wrap; each axis sizes as `fixed`, `hug`,
//! or `fill`; a child placed `absolute` ignores its parent's layout. Rows and
//! columns are laid out by [Taffy](https://github.com/DioxusLabs/taffy)'s
//! flexbox, an implementation detail: no Taffy type is public, so what Shift
//! persists never names it.
//!
//! Text is broken into lines by [`BreakSegments::break_lines`], greedy
//! arithmetic over widths the host measured from live advances and kerning;
//! no shaping happens here.
//!
//! All boxes are Y-down, in scene units, relative to the parent's origin.

// Library code returns errors instead of panicking: a panic kills the
// WebAssembly engine. Tests may unwrap (clippy.toml).
#![warn(clippy::unwrap_used, clippy::print_stdout)]

mod engine;
mod page;
mod text;
mod tree;

pub use kurbo::{Point, Size};
pub use page::{LayoutBox, LayoutError, PageLayout, TextLines};
pub use text::{BreakSegments, LineRange};
pub use tree::{
    Align, FrameLayout, Insets, Justify, LayoutMode, LayoutNode, LayoutTree, NodeKind, Placement,
    Sizing,
};

#[cfg(test)]
mod tests;
