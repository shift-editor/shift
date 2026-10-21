//! Laying out a page: the result and the ways a tree can be malformed.

use thiserror::Error;

use crate::engine::Engine;
use crate::text::LineRange;
use crate::tree::LayoutTree;

/// Every box on one page, from one layout pass.
#[derive(Clone, Debug, PartialEq)]
pub struct PageLayout {
    /// One box per input node, in input order.
    pub boxes: Vec<LayoutBox>,
    /// The lines of every text run, in input order.
    pub text_lines: Vec<TextLines>,
}

/// A laid-out node: its origin in its parent's frame and its size, Y-down,
/// scene units. The page's origin is in scene coordinates.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LayoutBox {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// The lines chosen for one text run at its laid-out width.
#[derive(Clone, Debug, PartialEq)]
pub struct TextLines {
    /// The text run's index in [`LayoutTree::nodes`].
    pub node: usize,
    /// At least one line; one per paragraph for a run whose width hugs.
    pub lines: Vec<LineRange>,
}

/// Why a [`LayoutTree`] cannot be laid out.
#[derive(Clone, Debug, Error, PartialEq)]
pub enum LayoutError {
    #[error("the layout tree has no nodes")]
    Empty,
    #[error("the first node must be the page, with no parent")]
    RootNotPage,
    #[error("node {node} has no parent; only the first node may be the page")]
    SecondRoot { node: usize },
    #[error("node {node} is a page; only the first node may be")]
    NestedPage { node: usize },
    #[error("node {node}'s parent {parent} does not come before it")]
    ParentNotBefore { node: usize, parent: usize },
    #[error("node {node}'s parent {parent} is a text run or leaf, which has no children")]
    ParentIsLeaf { node: usize, parent: usize },
    #[error("text node {node} has scale {scale}; it must be positive and finite")]
    InvalidScale { node: usize, scale: f64 },
}

impl LayoutTree {
    /// Lays out the page: sizes and places every node and breaks every text
    /// run into lines.
    ///
    /// The same tree always gives the same layout. Non-finite sizes, gaps,
    /// insets, and positions lay out as zero. Layout runs in `f32`, so boxes
    /// carry about seven significant digits.
    ///
    /// # Errors
    ///
    /// Returns [`LayoutError`] when the first node is not a parentless page,
    /// another node has no parent, is a page, or names a parent that is not
    /// before it or cannot hold children, or a text run's scale is not
    /// positive and finite.
    pub fn layout(&self) -> Result<PageLayout, LayoutError> {
        Ok(Engine::new(self)?.run())
    }
}
