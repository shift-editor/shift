//! Laying out a page: how text is measured, the result, and the ways a tree
//! can be malformed.

use kurbo::Size;
use thiserror::Error;

use crate::engine::Engine;
use crate::tree::LayoutTree;

/// Measures text runs for layout: the one place a run's lines are chosen.
///
/// Layout asks for a run's size at each width it considers, often more than
/// once per width and for several widths per run, so an implementation that
/// lays text out expensively keeps what it measured. It must answer the same
/// size for the same node and width within one layout.
pub trait MeasureText {
    /// The size, in scene units, of text run `node` (its index in
    /// [`LayoutTree::nodes`]) broken into lines no wider than `width` scene
    /// units; `None` breaks only between paragraphs, and `Some(0.0)` asks for
    /// the narrowest the run can be, broken at every opportunity. The width
    /// is the widest line, and the height the lines' height.
    fn measure(&mut self, node: usize, width: Option<f64>) -> Size;
}

/// Every box on one page, from one layout pass.
#[derive(Clone, Debug, PartialEq)]
pub struct PageLayout {
    /// One box per input node, in input order.
    pub boxes: Vec<LayoutBox>,
    /// The width every text run's lines break at, in input order.
    pub text_widths: Vec<TextWidth>,
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

/// The width one text run's lines break at, once the page is laid out: what
/// to measure it at for the lines it shows.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TextWidth {
    /// The text run's index in [`LayoutTree::nodes`].
    pub node: usize,
    /// In scene units; `None` for a run whose width hugs, which breaks only
    /// between paragraphs.
    pub width: Option<f64>,
}

/// Why a [`LayoutTree`] cannot be laid out.
#[derive(Clone, Debug, Error, PartialEq, Eq)]
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
}

impl LayoutTree {
    /// Lays out the page: sizes and places every node, measuring each text
    /// run through `text`.
    ///
    /// The same tree and measurements always give the same layout.
    /// Non-finite sizes, gaps, insets, and positions lay out as zero. Layout
    /// runs in `f32`, so boxes carry about seven significant digits; a
    /// measured size is rounded up to the next `f32`, so a run offered the
    /// width it measured is never narrower than its lines.
    ///
    /// # Errors
    ///
    /// Returns [`LayoutError`] when the first node is not a parentless page,
    /// or another node has no parent, is a page, or names a parent that is
    /// not before it or cannot hold children.
    pub fn layout(&self, text: &mut impl MeasureText) -> Result<PageLayout, LayoutError> {
        Ok(Engine::new(self, text)?.run())
    }
}
