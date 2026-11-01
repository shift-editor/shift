//! Lays out pages of frames and text runs, in Shift's auto layout vocabulary.
//!
//! A page is a [`LayoutTree`]: frames that place their children in a row or
//! column (or leave them free), text runs, and leaves of fixed size.
//! [`LayoutTree::layout`] returns a box for every node and the width each
//! text run's lines break at, in one pass.
//!
//! The vocabulary is Figma's: a frame's direction is `free`, `row`, or
//! `column`, with gap, padding, alignment, and wrap; each axis sizes as
//! `fixed`, `hug`, or `fill`; a child placed `absolute` ignores its parent's
//! layout. Rows and columns are laid out by
//! [Taffy](https://github.com/DioxusLabs/taffy)'s flexbox, an implementation
//! detail: no Taffy type is public, so what Shift persists never names it.
//!
//! Text is not broken into lines here. The caller measures each text run
//! through [`MeasureText`], with the one text layout every Shift host uses
//! (shift-text's), so a run wraps the same on a page as anywhere else.
//!
//! All boxes are Y-down, in scene units, relative to the parent's origin.
//!
//! Without the `layout` feature the crate holds only the vocabulary, the
//! types a document stores.

// Library code returns errors instead of panicking: a panic kills the
// WebAssembly engine. Tests may unwrap (clippy.toml).
#![warn(clippy::unwrap_used, clippy::print_stdout)]

#[cfg(feature = "layout")]
mod engine;
#[cfg(feature = "layout")]
mod page;
mod tree;
mod vocabulary;

pub use kurbo::{Point, Size};
#[cfg(feature = "layout")]
pub use page::{LayoutBox, LayoutError, MeasureText, PageLayout, TextWidth};
pub use tree::{LayoutNode, LayoutTree, NodeKind};
pub use vocabulary::{
    Align, BoxSizing, FrameLayout, Insets, Justify, LayoutDirection, Placement, Sizing,
};

#[cfg(feature = "layout")]
#[cfg(test)]
mod tests;
