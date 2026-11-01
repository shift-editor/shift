//! What one document edit changed: its font and its scene, together.

use std::collections::BTreeSet;

use pack::Pack;
use serde::{Deserialize, Serialize};
use shift_font::{CompactChangeSet, FontChangeImpact, FontChangeSet, GlyphId, NodeId};

use crate::scene::SceneChangeSet;

/// One edit's changes to the font and to the scene, made, undone and
/// persisted as one.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct DocumentChangeSet {
    pub font: FontChangeSet,
    pub scene: SceneChangeSet,
}

impl DocumentChangeSet {
    pub fn is_empty(&self) -> bool {
        self.font.is_empty() && self.scene.is_empty()
    }

    /// The change set that takes this one back.
    #[must_use]
    pub fn inverted(&self) -> Self {
        Self {
            font: self.font.inverted(),
            scene: self.scene.inverted(),
        }
    }

    /// What reads this change set invalidates: the font's projections, and
    /// [`FontChangeImpact::SCENE`] when it changes the scene.
    pub fn impact(&self) -> FontChangeImpact {
        self.font.impact() | self.scene.impact()
    }

    /// The change set for sending to another process, its font part
    /// compacted ([`FontChangeSet::compact`]).
    pub fn compact(&self) -> CompactDocumentChangeSet {
        CompactDocumentChangeSet {
            font: self.font.compact(),
            scene: self.scene.clone(),
        }
    }
}

/// A [`DocumentChangeSet`] as it crosses to the process that persists it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CompactDocumentChangeSet {
    pub font: CompactChangeSet,
    pub scene: SceneChangeSet,
}

/// Where an edit was made and what it changed there, so an undo or redo can
/// show it: the page the editor showed when the edit was made, the glyphs it
/// changed and the scene nodes it changed.
#[derive(Clone, Debug, Default, PartialEq, Pack)]
pub struct EditLocation {
    /// The page of the first scene node the edit changed (a deleted page's
    /// own id); for an edit that changed no page's nodes, such as a font
    /// edit, the page shown when it was made. `None` only when the document
    /// had no page at all.
    pub page_id: Option<NodeId>,
    /// The glyphs whose record or layers the edit changed, in id order.
    pub glyph_ids: Vec<GlyphId>,
    /// The scene nodes the edit created, changed or removed, in the order it
    /// first changed them.
    pub node_ids: Vec<NodeId>,
}

impl EditLocation {
    /// The location of `change_set`, made on `page_id`.
    pub fn of(page_id: Option<NodeId>, change_set: &DocumentChangeSet) -> Self {
        let glyph_ids: BTreeSet<GlyphId> = change_set
            .font
            .changes
            .iter()
            .flat_map(shift_font::FontChange::glyph_ids)
            .collect();
        Self {
            page_id,
            glyph_ids: glyph_ids.into_iter().collect(),
            node_ids: change_set.scene.node_ids().cloned().collect(),
        }
    }
}
