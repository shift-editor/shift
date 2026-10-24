use std::collections::BTreeSet;

use shift_font::{
    AddComponent, Component, DecomposeComponents, EntityChange, Font, FontChangeSet,
    FontEntityChange, FontIntent, FontIntentSet, GlyphId, LayerId, ReplaceGlyphLayerContent,
};

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
    anchor_edits: BTreeSet<LayerId>,
}

impl ReadSet {
    /// The layers `set` names, which must be loaded before [`Self::for_intents`]
    /// can read their components.
    pub fn named_layers(font: &Font, set: &FontIntentSet) -> Vec<LayerId> {
        set.intents
            .iter()
            .flat_map(|intent| intent.required_layer_ids(font))
            .collect()
    }

    pub fn for_intents(font: &Font, set: &FontIntentSet) -> Self {
        // New components attach to anchors on the edited layers' existing ones.
        let attached_to: Vec<GlyphId> = Self::named_layers(font, set)
            .iter()
            .filter_map(|layer_id| font.layer(layer_id))
            .flat_map(|layer| layer.components_iter().map(Component::base_glyph_id))
            .collect();
        Self {
            component_bases: set
                .intents
                .iter()
                .flat_map(|intent| component_bases(font, intent))
                .chain(attached_to)
                .collect(),
            anchor_edits: set.layers_with_anchor_edits().into_iter().collect(),
        }
    }

    /// Glyphs the edit's components, existing or new, are built from.
    pub fn component_bases(&self) -> impl Iterator<Item = &GlyphId> {
        self.component_bases.iter()
    }

    /// Layers whose anchor edits move the composites built on their glyph.
    pub fn anchor_edits(&self) -> impl Iterator<Item = &LayerId> {
        self.anchor_edits.iter()
    }

    /// The layers replaying `change_set`, for undo or redo, reads.
    pub fn change_set_layers(change_set: &FontChangeSet) -> Vec<LayerId> {
        change_set
            .entity_changes()
            .into_iter()
            .filter_map(|entity| match entity {
                FontEntityChange::Layer { change, .. } => Some(match change {
                    EntityChange::Created(layer) | EntityChange::Deleted(layer) => layer.id(),
                    EntityChange::Updated { after, .. } => after.id(),
                }),
                _ => None,
            })
            .collect()
    }
}

/// Glyphs an intent's new or decomposed components are built from.
fn component_bases(font: &Font, intent: &FontIntent) -> Vec<GlyphId> {
    match intent {
        FontIntent::AddComponent(AddComponent { base_glyph_id, .. }) => {
            vec![base_glyph_id.clone()]
        }
        FontIntent::ReplaceGlyphLayerContent(ReplaceGlyphLayerContent { components, .. }) => {
            components.iter().map(Component::base_glyph_id).collect()
        }
        FontIntent::DecomposeComponents(DecomposeComponents {
            layer_id,
            component_ids,
        }) => {
            let Some(layer) = font.layer(layer_id) else {
                return Vec::new();
            };
            component_ids
                .iter()
                .filter_map(|component_id| layer.component(component_id))
                .map(Component::base_glyph_id)
                .collect()
        }
        _ => Vec::new(),
    }
}
