//! Shift's auto layout words: what a document stores of a frame and of each
//! node's size and placement. Nothing here names Taffy, so a stored page
//! reads the same whatever lays it out.

/// How a frame places its children.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct FrameLayout {
    pub direction: LayoutDirection,
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
        direction: LayoutDirection::Free,
        gap: 0.0,
        padding: Insets::ZERO,
        align: Align::Start,
        justify: Justify::Start,
        wrap: false,
    };

    /// A frame placing its children in `direction` with no gap or padding,
    /// at the start of both axes.
    #[must_use]
    pub const fn stack(direction: LayoutDirection) -> Self {
        Self {
            direction,
            ..Self::FREE
        }
    }
}

/// Which way a frame places its children, if at all.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum LayoutDirection {
    /// Children keep their positions; a hugging frame covers them.
    #[default]
    Free,
    /// Children left to right.
    Row,
    /// Children top to bottom.
    Column,
}

impl LayoutDirection {
    /// Whether children follow the frame's layout rather than keeping their
    /// positions.
    #[must_use]
    pub const fn is_stack(self) -> bool {
        matches!(self, Self::Row | Self::Column)
    }
}

/// One axis's size rule.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
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

/// A node's size rule on each axis; hugging on both by default.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct BoxSizing {
    pub width: Sizing,
    /// Ignored for the page and text runs, whose height always hugs.
    pub height: Sizing,
}

impl BoxSizing {
    /// `width` and `height`.
    #[must_use]
    pub const fn new(width: Sizing, height: Sizing) -> Self {
        Self { width, height }
    }
}

/// Space inside a frame's edges, scene units.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
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
#[cfg_attr(feature = "pack", derive(pack::Pack))]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
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
#[cfg_attr(feature = "pack", derive(pack::Pack))]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
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
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum Placement {
    /// Placed by the parent's layout.
    Auto,
    /// Keeps its position and takes no room in the parent's layout.
    Absolute,
}
