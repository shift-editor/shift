use std::collections::BTreeSet;

use shift_font::{Font, FontIntentSet, GlyphId, LayerId};

/// What an edit reads beyond the layers it names, found from the font once
/// those layers are loaded.
///
/// This is the one place that knows what shift-font reads while applying:
/// the glyphs the edited layers' components are built from, since new
/// components attach to them; the glyphs new or decomposed components are
/// built from; and the composites that follow an edited glyph's anchors. A
/// session loads each of those with the glyphs it is built from in turn.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ReadSet {
    component_bases: BTreeSet<GlyphId>,
    anchor_edits: Vec<LayerId>,
}

impl ReadSet {
    /// What applying `set` reads once the layers it names are loaded:
    /// decomposed components are read from those layers.
    pub fn for_intents(font: &Font, set: &FontIntentSet) -> Self {
        let mut component_bases = set.edited_component_glyph_ids(font);
        // New components attach to anchors on the edited layers' existing ones.
        component_bases.extend(font.component_glyph_ids_of_layers(&set.required_layer_ids(font)));
        Self {
            component_bases,
            anchor_edits: set.layers_with_anchor_edits().into_iter().collect(),
        }
    }

    /// Glyphs the edit's components, existing or new, are built from.
    pub fn component_bases(&self) -> &BTreeSet<GlyphId> {
        &self.component_bases
    }

    /// Layers whose anchor edits move the composites built on their glyph.
    pub fn anchor_edits(&self) -> &[LayerId] {
        &self.anchor_edits
    }
}
