//! The lookups a [`Font`](super::Font) keeps beside its glyphs.
//!
//! Each part owns one rule: glyph names are unique, a glyph has one layer per
//! source, and an entity id is used once in the whole font. Every part is a
//! persistent collection, so copying a font to edit it shares the index.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::sync::Arc;

use indexmap::IndexSet;

use crate::collection::PersistentEntityList;
use crate::entity::{GlyphEntityId, GlyphId, LayerId, SourceId};
use crate::persistent::{PersistentMap, PersistentMultiMap, PersistentSet};
use crate::{CoreError, CoreResult, Glyph, GlyphLayer, GlyphName};

#[derive(Clone, Debug, Default, PartialEq)]
pub(super) struct FontIndex {
    pub(super) glyphs: GlyphDirectory,
    pub(super) layers: LayerIndex,
    pub(super) entity_ids: EntityIds,
}

impl FontIndex {
    pub(super) fn from_glyphs(glyphs: &PersistentEntityList<Arc<Glyph>>) -> CoreResult<Self> {
        let mut index = Self::default();

        for (glyph_id, glyph) in glyphs.iter() {
            index.validate_glyph_insert(&glyph_id, glyph)?;
            index.insert_glyph(&glyph_id, glyph);
        }

        Ok(index)
    }

    /// Validates `glyph` joining the index under `glyph_id`.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::MismatchedGlyphId`], [`CoreError::DuplicateGlyphName`],
    /// [`CoreError::DuplicateLayerId`], [`CoreError::DuplicateGlyphLayer`], or a
    /// duplicate entity id error.
    pub(super) fn validate_glyph_insert(
        &self,
        glyph_id: &GlyphId,
        glyph: &Glyph,
    ) -> CoreResult<()> {
        self.validate_records(glyph_id, glyph)?;
        self.entity_ids.require_free(glyph.entity_ids())
    }

    pub(super) fn insert_glyph(&mut self, glyph_id: &GlyphId, glyph: &Glyph) {
        self.insert_records(glyph_id, glyph);
        self.entity_ids.insert_all(glyph.entity_ids());
    }

    pub(super) fn remove_glyph(&mut self, glyph_id: &GlyphId, glyph: &Glyph) {
        self.remove_records(glyph_id, glyph);
        self.entity_ids.remove_all(glyph.entity_ids());
    }

    /// Validates a glyph's name and layers, but not its entity ids.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::MismatchedGlyphId`], [`CoreError::DuplicateGlyphName`],
    /// [`CoreError::DuplicateLayerId`], or [`CoreError::DuplicateGlyphLayer`].
    pub(super) fn validate_records(&self, glyph_id: &GlyphId, glyph: &Glyph) -> CoreResult<()> {
        if *glyph_id != glyph.id() {
            return Err(CoreError::MismatchedGlyphId {
                key: glyph_id.clone(),
                glyph_id: glyph.id(),
            });
        }
        self.glyphs.validate_insert(glyph)?;
        self.layers.validate_glyph(glyph_id, glyph)
    }

    /// Indexes a glyph's name, code points, and layers, but not its entity ids.
    pub(super) fn insert_records(&mut self, glyph_id: &GlyphId, glyph: &Glyph) {
        self.glyphs.insert(glyph_id, glyph);
        for layer in glyph.layers().values() {
            self.layers.insert(glyph_id, layer);
        }
    }

    /// Forgets a glyph's name, code points, and layers, but not its entity ids.
    pub(super) fn remove_records(&mut self, glyph_id: &GlyphId, glyph: &Glyph) {
        self.glyphs.remove(glyph_id, glyph);
        for layer in glyph.layers().values() {
            self.layers.remove(glyph_id, layer);
        }
    }

    /// Validates `layer` joining the glyph `glyph_id`.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::DuplicateLayerId`], [`CoreError::DuplicateGlyphLayer`], or a
    /// duplicate entity id error.
    pub(super) fn validate_layer_insert(
        &self,
        glyph_id: &GlyphId,
        layer: &GlyphLayer,
    ) -> CoreResult<()> {
        self.layers.validate_insert(glyph_id, layer)?;
        self.entity_ids.require_free(layer.entity_ids())
    }

    pub(super) fn insert_layer(&mut self, glyph_id: &GlyphId, layer: &GlyphLayer) {
        self.layers.insert(glyph_id, layer);
        self.entity_ids.insert_all(layer.entity_ids());
    }

    pub(super) fn remove_layer(&mut self, glyph_id: &GlyphId, layer: &GlyphLayer) {
        self.layers.remove(glyph_id, layer);
        self.entity_ids.remove_all(layer.entity_ids());
    }

    /// Indexes the touched glyphs again after a change set replaced them.
    ///
    /// Each touched glyph's records left the index before the change, and
    /// `before` holds the versions they came from. Glyphs that kept exactly
    /// their entity ids keep them in the index; the rest move theirs by
    /// difference. Every returning glyph is validated as a full rebuild would.
    ///
    /// # Errors
    ///
    /// Returns the first validation error, as [`Self::validate_glyph_insert`]
    /// does. The index is then partly updated, so call this only on a staged
    /// copy that is discarded on failure.
    pub(super) fn return_glyphs(
        &mut self,
        touched: &IndexSet<GlyphId>,
        before: &HashMap<GlyphId, Arc<Glyph>>,
        glyphs: &PersistentEntityList<Arc<Glyph>>,
    ) -> CoreResult<()> {
        let ids_changed: HashSet<&GlyphId> = touched
            .iter()
            .filter(|glyph_id| {
                !before
                    .get(*glyph_id)
                    .zip(glyphs.get(glyph_id))
                    .is_some_and(|(before, after)| before.has_same_entity_ids(after))
            })
            .collect();
        let mut transfer = EntityIdTransfer::default();
        for glyph in ids_changed
            .iter()
            .filter_map(|glyph_id| before.get(*glyph_id))
        {
            transfer.release(glyph.entity_ids());
        }

        let mut unicodes = BTreeSet::new();
        for glyph_id in touched {
            let Some(glyph) = glyphs.get(glyph_id) else {
                continue;
            };
            self.validate_records(glyph_id, glyph)?;
            if ids_changed.contains(glyph_id) {
                transfer.claim(glyph.entity_ids(), &self.entity_ids)?;
            }
            self.insert_records(glyph_id, glyph);
            unicodes.extend(glyph.unicodes().iter().copied());
        }
        transfer.apply_to(&mut self.entity_ids);
        // A full rebuild lists glyphs sharing a code point in glyph order; keep that.
        self.glyphs.reorder_unicodes(unicodes, glyphs);
        Ok(())
    }
}

/// Glyphs by name and by code point.
#[derive(Clone, Debug, Default, PartialEq)]
pub(super) struct GlyphDirectory {
    by_name: PersistentMap<GlyphName, GlyphId>,
    /// Glyphs sharing a code point, in glyph order.
    by_unicode: PersistentMap<u32, Vec<GlyphId>>,
}

impl GlyphDirectory {
    pub(super) fn id_by_name(&self, name: &str) -> Option<&GlyphId> {
        self.by_name.get(name)
    }

    /// The glyphs mapped to `unicode`, in glyph order.
    pub(super) fn ids_with_unicode(&self, unicode: u32) -> impl Iterator<Item = &GlyphId> {
        self.by_unicode.get(&unicode).into_iter().flatten()
    }

    fn validate_insert(&self, glyph: &Glyph) -> CoreResult<()> {
        if self.by_name.contains_key(glyph.glyph_name()) {
            return Err(CoreError::DuplicateGlyphName(glyph.glyph_name().clone()));
        }
        Ok(())
    }

    fn insert(&mut self, glyph_id: &GlyphId, glyph: &Glyph) {
        self.by_name
            .insert(glyph.glyph_name().clone(), glyph_id.clone());
        for unicode in glyph.unicodes() {
            self.by_unicode
                .get_or_default(*unicode)
                .push(glyph_id.clone());
        }
    }

    fn remove(&mut self, glyph_id: &GlyphId, glyph: &Glyph) {
        self.by_name.remove(glyph.glyph_name());
        for unicode in glyph.unicodes() {
            if let Some(glyph_ids) = self.by_unicode.get_mut(unicode) {
                glyph_ids.retain(|id| id != glyph_id);
                if glyph_ids.is_empty() {
                    self.by_unicode.remove(unicode);
                }
            }
        }
    }

    /// Lists the glyphs sharing each of `unicodes` in `glyphs`' order again,
    /// after glyphs returned to the index out of order.
    pub(super) fn reorder_unicodes(
        &mut self,
        unicodes: impl IntoIterator<Item = u32>,
        glyphs: &PersistentEntityList<Arc<Glyph>>,
    ) {
        for unicode in unicodes {
            if let Some(glyph_ids) = self.by_unicode.get_mut(&unicode) {
                glyph_ids.sort_by_key(|glyph_id| glyphs.index_of(glyph_id));
            }
        }
    }
}

/// Which glyph owns each layer, and which layers reference each base glyph.
#[derive(Clone, Debug, Default, PartialEq)]
pub(super) struct LayerIndex {
    owners: PersistentMap<LayerId, GlyphId>,
    /// One layer per glyph and source.
    by_glyph_source: PersistentMap<(GlyphId, SourceId), LayerId>,
    /// Layers with a component of each base glyph, so an anchor edit finds
    /// the composites that follow it without scanning every layer. Derived
    /// anchored placement retires this.
    by_component_base: PersistentMultiMap<GlyphId, LayerId>,
}

impl LayerIndex {
    pub(super) fn owner(&self, layer_id: &LayerId) -> Option<&GlyphId> {
        self.owners.get(layer_id)
    }

    pub(super) fn layer_at(&self, glyph_id: GlyphId, source_id: SourceId) -> Option<&LayerId> {
        self.by_glyph_source.get(&(glyph_id, source_id))
    }

    /// Layers with at least one component of `base_glyph_id`.
    pub(super) fn composites_of(&self, base_glyph_id: &GlyphId) -> impl Iterator<Item = &LayerId> {
        self.by_component_base.get(base_glyph_id)
    }

    fn validate_glyph(&self, glyph_id: &GlyphId, glyph: &Glyph) -> CoreResult<()> {
        let mut sources = HashSet::new();
        for layer in glyph.layers().values() {
            self.validate_insert(glyph_id, layer)?;
            if !sources.insert(layer.source_id()) {
                return Err(CoreError::DuplicateGlyphLayer {
                    glyph_id: glyph_id.clone(),
                    source_id: layer.source_id(),
                });
            }
        }
        Ok(())
    }

    fn validate_insert(&self, glyph_id: &GlyphId, layer: &GlyphLayer) -> CoreResult<()> {
        if self.owners.contains_key(&layer.id()) {
            return Err(CoreError::DuplicateLayerId(layer.id()));
        }
        if self
            .by_glyph_source
            .contains_key(&(glyph_id.clone(), layer.source_id()))
        {
            return Err(CoreError::DuplicateGlyphLayer {
                glyph_id: glyph_id.clone(),
                source_id: layer.source_id(),
            });
        }
        Ok(())
    }

    pub(super) fn insert(&mut self, glyph_id: &GlyphId, layer: &GlyphLayer) {
        self.owners.insert(layer.id(), glyph_id.clone());
        self.by_glyph_source
            .insert((glyph_id.clone(), layer.source_id()), layer.id());
        for component in layer.components_iter() {
            self.by_component_base
                .insert(component.base_glyph_id(), layer.id());
        }
    }

    pub(super) fn remove(&mut self, glyph_id: &GlyphId, layer: &GlyphLayer) {
        self.owners.remove(&layer.id());
        self.by_glyph_source
            .remove(&(glyph_id.clone(), layer.source_id()));
        for component in layer.components_iter() {
            self.by_component_base
                .remove(&component.base_glyph_id(), &layer.id());
        }
    }
}

/// Every point, contour, component, anchor, and guideline id in the font.
#[derive(Clone, Debug, Default, PartialEq)]
pub(super) struct EntityIds(PersistentSet<GlyphEntityId>);

impl EntityIds {
    pub(super) fn contains(&self, id: &GlyphEntityId) -> bool {
        self.0.contains(id)
    }

    pub(super) fn insert(&mut self, id: GlyphEntityId) {
        self.0.insert(id);
    }

    pub(super) fn remove(&mut self, id: &GlyphEntityId) {
        self.0.remove(id);
    }

    pub(super) fn insert_all(&mut self, ids: impl IntoIterator<Item = GlyphEntityId>) {
        self.0.extend(ids);
    }

    pub(super) fn remove_all(&mut self, ids: impl IntoIterator<Item = GlyphEntityId>) {
        for id in ids {
            self.0.remove(&id);
        }
    }

    /// Requires every id to be unused here and to appear once.
    ///
    /// # Errors
    ///
    /// Returns the duplicate entity id error for the first id that is taken or
    /// repeated.
    fn require_free(&self, ids: impl IntoIterator<Item = GlyphEntityId>) -> CoreResult<()> {
        let mut seen = HashSet::new();
        for id in ids {
            if self.contains(&id) || !seen.insert(id.clone()) {
                return Err(id.duplicate_error());
            }
        }
        Ok(())
    }
}

/// Moves entity ids between versions of glyphs or layers by difference.
///
/// Ids the old versions held are released and ids the new versions hold are
/// claimed. An id is claimable when nothing else in the font holds it, or when
/// an old version released it, and only once. Applying the transfer then
/// touches only the ids that changed, which is cheap when a replacement keeps
/// most of its ids.
#[derive(Debug, Default)]
pub(super) struct EntityIdTransfer {
    released: HashSet<GlyphEntityId>,
    claimed: HashSet<GlyphEntityId>,
}

impl EntityIdTransfer {
    pub(super) fn release(&mut self, ids: impl IntoIterator<Item = GlyphEntityId>) {
        self.released.extend(ids);
    }

    /// Claims `ids` for a new version.
    ///
    /// # Errors
    ///
    /// Returns the duplicate entity id error for the first id that `held`
    /// holds and nothing released, or that was already claimed.
    pub(super) fn claim(
        &mut self,
        ids: impl IntoIterator<Item = GlyphEntityId>,
        held: &EntityIds,
    ) -> CoreResult<()> {
        for id in ids {
            let taken = held.contains(&id) && !self.released.contains(&id);
            if taken || !self.claimed.insert(id.clone()) {
                return Err(id.duplicate_error());
            }
        }
        Ok(())
    }

    pub(super) fn apply_to(self, ids: &mut EntityIds) {
        for id in self.released.difference(&self.claimed) {
            ids.remove(id);
        }
        for id in self.claimed.difference(&self.released) {
            ids.insert(id.clone());
        }
    }
}
