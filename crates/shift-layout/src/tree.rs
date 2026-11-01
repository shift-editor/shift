//! A page to lay out: its nodes, parents first.

use kurbo::{Point, Size};

use crate::vocabulary::{BoxSizing, FrameLayout, Placement};

/// One page's nodes, parents before children.
///
/// The first node is the page, the tree's only root. Every other node names
/// its parent by index, and that index is smaller than its own, so the list
/// can be built and read in one pass. Children are ordered as they appear.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct LayoutTree {
    pub nodes: Vec<LayoutNode>,
}

/// One node of a [`LayoutTree`], in authored terms.
#[derive(Clone, Debug, PartialEq)]
pub struct LayoutNode {
    /// The parent's index in [`LayoutTree::nodes`]; `None` for the page.
    pub parent: Option<usize>,
    pub kind: NodeKind,
    /// Ignored for the page, which always hugs its children.
    pub sizing: BoxSizing,
    /// Whether a child of a row or column frame follows its layout.
    ///
    /// Ignored under a free frame or the page, whose children always keep
    /// their position.
    pub placement: Placement,
    /// Origin in the parent's frame, Y-down, scene units.
    ///
    /// Used for children of free frames and the page, and for absolute
    /// children; a child that follows a row or column is placed by it.
    pub position: Point,
}

impl LayoutNode {
    /// A node of `kind` under `parent` that hugs on both axes and follows
    /// its parent's layout, at the parent's origin.
    #[must_use]
    pub fn new(parent: Option<usize>, kind: NodeKind) -> Self {
        Self {
            parent,
            kind,
            sizing: BoxSizing::default(),
            placement: Placement::Auto,
            position: Point::ZERO,
        }
    }
}

/// What a node is, as far as layout is concerned.
#[derive(Clone, Debug, PartialEq)]
pub enum NodeKind {
    /// The tree's root: an infinite canvas whose children keep their
    /// positions. It sits at its own position and hugs its children.
    Page,
    /// A container laying out its children as [`FrameLayout`] says.
    Frame(FrameLayout),
    /// A text run, measured during layout through the caller's
    /// `MeasureText`.
    Text,
    /// A leaf with an intrinsic size in scene units, used where it hugs.
    Fixed(Size),
}
