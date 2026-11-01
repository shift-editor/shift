//! The nodes a scene holds: pages, text runs and placed glyphs.

use std::collections::BTreeMap;

use pack::Pack;
use serde::{Deserialize, Serialize};
use shift_font::index_key::{self, IndexKeyError};
use shift_font::{GlyphId, NodeId, RunId, SourceId, TextItemId};
use shift_layout::{FeatureSetting, LayoutRequest, LayoutUnit, LineHeight, TextAlign, TextOptions};

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
        /// How the run is shaped. A run stored before a setting existed
        /// reads it at its default.
        #[serde(default)]
        settings: RunSettings,
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

/// How a text run's text is shaped and set; each setting a run was stored
/// without reads at its default.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Pack)]
pub struct RunSettings {
    /// Whether the font's feature code shapes the text; off lays out each
    /// item as typed.
    #[serde(default = "shaped")]
    pub shaping: bool,
    /// Features turned on (`true`) or off (`false`) for this text, by tag;
    /// a tag left out keeps the font's default.
    #[serde(default)]
    pub features: BTreeMap<String, bool>,
    /// The BCP 47 language the text is shaped as; `None` for the font's
    /// default language system.
    #[serde(default)]
    pub language: Option<String>,
    /// An ISO 15924 script the whole text is shaped in; `None` shapes each
    /// stretch in its own characters' script.
    #[serde(default)]
    pub script: Option<String>,
    /// The distance between baselines, in ems; `None` for the font's own
    /// line spacing.
    #[serde(default)]
    pub line_height: Option<f64>,
    /// How lines line up; `None` follows each line's direction.
    #[serde(default)]
    pub align: Option<TextAlign>,
}

impl Default for RunSettings {
    fn default() -> Self {
        Self {
            shaping: shaped(),
            features: BTreeMap::new(),
            language: None,
            script: None,
            line_height: None,
            align: None,
        }
    }
}

impl RunSettings {
    /// The options text with these settings is laid out with, each
    /// paragraph on one line: each forced feature switched on or off
    /// ([`FeatureSetting::switched`]), and no line height read as the font's
    /// own.
    pub fn text_options(&self) -> TextOptions {
        TextOptions {
            language: self.language.clone(),
            script: self.script.clone(),
            features: self
                .features
                .iter()
                .map(|(tag, &on)| FeatureSetting::switched(tag.clone(), on))
                .collect(),
            shaping: self.shaping,
            align: self.align,
            line_height: self
                .line_height
                .map_or(LineHeight::Auto, |em| LineHeight::Em { em }),
            width: None,
        }
    }
}

/// A run is shaped unless it says otherwise.
fn shaped() -> bool {
    true
}

/// A text run's items and settings, as the scene stores them: what its text
/// is laid out from.
#[derive(Clone, Debug, PartialEq, Pack)]
pub struct TextRun {
    pub items: Vec<TextItem>,
    pub settings: RunSettings,
}

impl TextRun {
    /// The run laid out as its settings say ([`RunSettings::text_options`]),
    /// one unit per item.
    pub fn layout_request(&self) -> LayoutRequest {
        LayoutRequest {
            units: self.items.iter().map(TextItem::layout_unit).collect(),
            options: self.settings.text_options(),
        }
    }
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

impl TextItem {
    /// The unit layout takes for this item: its character, its glyph, or a
    /// line break.
    pub fn layout_unit(&self) -> LayoutUnit {
        match *self {
            Self::Character { codepoint, .. } => LayoutUnit::Character { codepoint },
            Self::Glyph { glyph_id, .. } => LayoutUnit::Glyph { glyph_id },
            Self::Linebreak { .. } => LayoutUnit::LineBreak,
        }
    }
}

/// The name of the page a document gets when it has none.
pub const DEFAULT_PAGE_NAME: &str = "Page 1";

impl SceneNode {
    /// A new page of the user's, named `name`, with the key of a node that
    /// has no siblings yet.
    ///
    /// # Errors
    ///
    /// Returns shift-font's [`IndexKeyError`] when no first key can be made.
    pub fn new_page(name: &str) -> Result<Self, IndexKeyError> {
        Ok(Self {
            id: NodeId::new(),
            parent_id: None,
            index: index_key::between(None, None)?,
            x: 0.0,
            y: 0.0,
            content: NodeContent::Page {
                name: name.to_owned(),
                role: None,
            },
        })
    }

    /// Whether the node is a page.
    pub fn is_page(&self) -> bool {
        matches!(self.content, NodeContent::Page { .. })
    }

    /// Whether the node is a glyph page, which shows one glyph outside the
    /// user's pages, as a glyph tab does.
    pub fn is_glyph_page(&self) -> bool {
        matches!(
            self.content,
            NodeContent::Page {
                role: Some(PageRole::Glyph),
                ..
            }
        )
    }

    /// Gives a text run `current`'s items and settings in place of its own,
    /// as an update, which never changes them, does; other kinds are
    /// unchanged.
    pub(super) fn keep_items_of(&mut self, current: &Self) {
        if let (
            NodeContent::TextRun {
                items, settings, ..
            },
            NodeContent::TextRun {
                items: kept,
                settings: kept_settings,
                ..
            },
        ) = (&mut self.content, &current.content)
        {
            items.clone_from(kept);
            settings.clone_from(kept_settings);
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
