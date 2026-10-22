//! The authored layout vocabulary: pages, frames, text runs, and leaves.

use kurbo::{Point, Size};

use crate::text::BreakSegments;

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
    pub width: Sizing,
    /// Ignored for the page and text runs, whose height always hugs.
    pub height: Sizing,
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
    /// Returns a node of `kind` under `parent` that hugs on both axes, at the
    /// parent's origin.
    #[must_use]
    pub fn new(parent: Option<usize>, kind: NodeKind) -> Self {
        Self {
            parent,
            kind,
            width: Sizing::Hug,
            height: Sizing::Hug,
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
    /// A text run, measured before layout and broken into lines during it.
    Text(BreakSegments),
    /// A leaf with an intrinsic size in scene units, used where it hugs.
    Fixed(Size),
}

/// How a frame places its children.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct FrameLayout {
    pub mode: LayoutMode,
    /// Space between neighbouring children, and between lines when wrapping,
    /// scene units. Row and column only.
    pub gap: f64,
    /// Space inside the frame's edges. Row and column only.
    pub padding: Insets,
    /// Where children sit across the main axis. Row and column only.
    pub align: Align,
    /// How children share the main axis. Row and column only.
    pub justify: Justify,
    /// Start a new line of children when they run out of room on the main
    /// axis. Row and column only.
    pub wrap: bool,
}

impl FrameLayout {
    /// A frame whose children keep their positions.
    pub const FREE: Self = Self {
        mode: LayoutMode::Free,
        gap: 0.0,
        padding: Insets::ZERO,
        align: Align::Start,
        justify: Justify::Start,
        wrap: false,
    };

    /// A frame placing its children in `mode` with no gap or padding, at the
    /// start of both axes.
    #[must_use]
    pub const fn stack(mode: LayoutMode) -> Self {
        Self { mode, ..Self::FREE }
    }
}

/// A frame's layout mode.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum LayoutMode {
    /// Children keep their positions; a hugging frame covers them.
    #[default]
    Free,
    /// Children left to right.
    Row,
    /// Children top to bottom.
    Column,
}

impl LayoutMode {
    /// Whether children follow the frame's layout rather than keeping their
    /// positions.
    #[must_use]
    pub const fn is_stack(self) -> bool {
        matches!(self, Self::Row | Self::Column)
    }
}

/// One axis's size rule.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub enum Sizing {
    /// Exactly this many scene units.
    Fixed(f64),
    /// Shrink to the content: children for a frame, the longest line for a
    /// text run, the intrinsic size for a fixed leaf. Never narrower than the
    /// content, even where the parent has less room.
    #[default]
    Hug,
    /// Take the room the parent row or column has left on its main axis, or
    /// its full inner size across it. Lays out as [`Sizing::Hug`] anywhere
    /// else: under a free frame, under the page, or when absolute.
    Fill,
}

/// Space inside a frame's edges, scene units.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Insets {
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    pub left: f64,
}

impl Insets {
    pub const ZERO: Self = Self::uniform(0.0);

    /// The same inset on every side.
    #[must_use]
    pub const fn uniform(inset: f64) -> Self {
        Self {
            top: inset,
            right: inset,
            bottom: inset,
            left: inset,
        }
    }
}

/// Where a row or column's children sit across its main axis.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Align {
    #[default]
    Start,
    Center,
    End,
    /// Rows only: children share their first baseline. Text runs and leaves
    /// report no baseline yet, so their bottom edges stand in for it.
    Baseline,
}

/// How a row or column's children share its main axis.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Justify {
    #[default]
    Start,
    Center,
    End,
    /// The first child at the start, the last at the end, equal space
    /// between; a single child sits at the start.
    SpaceBetween,
}

/// Whether a child of a row or column follows its layout.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Placement {
    /// Placed by the parent's layout.
    #[default]
    Auto,
    /// Keeps its position and takes no room in the parent's layout.
    Absolute,
}
