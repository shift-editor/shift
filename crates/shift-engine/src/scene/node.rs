//! The nodes a scene holds: pages, text runs and placed glyphs.

use pack::Pack;
use serde::{Deserialize, Serialize};
use shift_font::{GlyphId, NodeId, RunId, SourceId, TextItemId};

/// One placed object on the canvas.
///
/// A node's frame is placed at `x`, `y` within its parent's frame, or within
/// the page for a node at a page's top level; Y runs down, in scene units.
/// Siblings sort by `index`, a fractional index compared as plain bytes, and
/// then by id.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Pack)]
pub struct SceneNode {
    pub id: NodeId,
    /// The node this one is placed in; `None` for a page, the scene's roots.
    pub parent_id: Option<NodeId>,
    /// Sort key among the nodes that share `parent_id`.
    pub index: String,
    pub x: f64,
    pub y: f64,
    pub content: NodeContent,
}

/// The index of the only node among its siblings, as
/// `index_key::between(None, None)` makes it.
const FIRST_INDEX: &str = "a0";

/// What a node is, and the fields only that kind has.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Pack)]
pub enum NodeContent {
    /// A top-level canvas. Every other node descends from one page.
    Page {
        /// Shown in the pages list.
        name: String,
        /// What else the page is for; `None` for a page the user made.
        role: Option<PageRole>,
    },
    /// A line of proof text: its items, laid out at `size`.
    TextRun {
        /// The run's content identity, which glyph nodes in it refer to.
        run_id: RunId,
        /// The proof size, in font units per em.
        size: f64,
        items: Vec<TextItem>,
    },
    /// An authored glyph source placed for editing.
    Glyph {
        glyph_id: GlyphId,
        source_id: SourceId,
        /// The run item this glyph takes the place of, when its parent is a
        /// text run.
        item_id: Option<TextItemId>,
    },
}

/// What a page is for, beyond the user's own pages.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Pack)]
pub enum PageRole {
    /// Shows one glyph outside the user's pages, as a glyph tab does; never
    /// listed among the pages.
    Glyph,
}

/// One item of a text run. Glyphs are referenced by id, so renaming a glyph
/// leaves the run as it was.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Pack)]
pub enum TextItem {
    /// A typed character; the font's Unicode mapping picks its glyph.
    Character { id: TextItemId, codepoint: u32 },
    /// A glyph picked by identity, such as an alternate with no codepoint.
    Glyph { id: TextItemId, glyph_id: GlyphId },
    /// A paragraph break; never laid out as a glyph.
    Linebreak { id: TextItemId },
}

/// The name of the page a document gets when it has none.
pub const DEFAULT_PAGE_NAME: &str = "Page 1";

impl SceneNode {
    /// A new page of the user's, named `name`, sorting first among pages that
    /// have no index yet.
    pub fn new_page(name: &str) -> Self {
        Self {
            id: NodeId::new(),
            parent_id: None,
            index: FIRST_INDEX.to_owned(),
            x: 0.0,
            y: 0.0,
            content: NodeContent::Page {
                name: name.to_owned(),
                role: None,
            },
        }
    }

    /// Whether the node is a page.
    pub fn is_page(&self) -> bool {
        matches!(self.content, NodeContent::Page { .. })
    }

    /// Gives a text run `current`'s items in place of its own, as an update,
    /// which never changes them, does; other kinds are unchanged.
    pub(super) fn keep_items_of(&mut self, current: &Self) {
        if let (NodeContent::TextRun { items, .. }, NodeContent::TextRun { items: kept, .. }) =
            (&mut self.content, &current.content)
        {
            items.clone_from(kept);
        }
    }

    /// Whether `other` is a node of the same kind.
    pub fn same_kind(&self, other: &Self) -> bool {
        std::mem::discriminant(&self.content) == std::mem::discriminant(&other.content)
    }

    /// The node's kind, by name, as the store files it.
    pub fn kind(&self) -> NodeKind {
        match self.content {
            NodeContent::Page { .. } => NodeKind::Page,
            NodeContent::TextRun { .. } => NodeKind::TextRun,
            NodeContent::Glyph { .. } => NodeKind::Glyph,
        }
    }
}

/// The kinds of node a scene holds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NodeKind {
    Page,
    TextRun,
    Glyph,
}

impl NodeKind {
    /// The kind's name, as the editor and the store spell it.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Page => "page",
            Self::TextRun => "textRun",
            Self::Glyph => "glyph",
        }
    }
}

impl std::fmt::Display for NodeKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}
