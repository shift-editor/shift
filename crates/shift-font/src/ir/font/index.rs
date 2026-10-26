//! The lookups a [`Font`](super::Font) keeps beside its glyphs.
//!
//! Each index is declared once, as a field of [`FontIndex`]: unique indexes
//! reject a key that is already held, and the others file every value under
//! its key. [`IndexEntries`] says what one glyph or layer files under each
//! index, so inserting and removing are written once for both.
//!
//! Every index is a persistent collection, so copying the index is O(1). An
//! edit inserts into a copy and keeps it only when every insert succeeded,
//! which is how a rejected edit leaves the font unchanged.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::sync::Arc;

use indexmap::IndexSet;

use crate::collection::PersistentEntityList;
use crate::entity::{GlyphEntityId, GlyphId, LayerId, SourceId};
use crate::persistent::{PersistentListMultiMap, PersistentMultiMap, PersistentSet, UniqueIndex};
use crate::{CoreError, CoreResult, Glyph, GlyphLayer, GlyphName};

#[derive(Clone, Debug, Default, PartialEq)]
pub(super) struct FontIndex {
    by_name: UniqueIndex<GlyphName, GlyphId>,
    /// Glyphs sharing a code point, in glyph order.
    by_unicode: PersistentListMultiMap<u32, GlyphId>,
    owners: UniqueIndex<LayerId, GlyphId>,
    /// One layer per glyph and source.
    by_glyph_source: UniqueIndex<GlyphSource, LayerId>,
    /// Layers with a component of each base glyph, so an anchor edit finds
    /// the composites that follow it without scanning every layer. Derived
    /// anchored placement retires this.
    by_component_base: PersistentMultiMap<GlyphId, LayerId>,
    /// Every point, contour, component, anchor, and guideline id in the font.
    pub(super) entity_ids: PersistentSet<GlyphEntityId>,
}

impl FontIndex {
    pub(super) fn from_glyphs(glyphs: &PersistentEntityList<Arc<Glyph>>) -> CoreResult<Self> {
        let mut index = Self::default();
        for (glyph_id, glyph) in glyphs.iter() {
            require_keyed(&glyph_id, glyph)?;
            index.try_insert(IndexEntries::of_glyph(&glyph_id, glyph))?;
        }
        Ok(index)
    }

    pub(super) fn id_by_name(&self, name: &str) -> Option<&GlyphId> {
        self.by_name.get(name)
    }

    /// The glyphs mapped to `unicode`, in glyph order.
    pub(super) fn ids_with_unicode(&self, unicode: u32) -> impl Iterator<Item = &GlyphId> {
        self.by_unicode.get(&unicode)
    }

    pub(super) fn owner(&self, layer_id: &LayerId) -> Option<&GlyphId> {
        self.owners.get(layer_id)
    }

    pub(super) fn layer_at(&self, glyph_id: GlyphId, source_id: SourceId) -> Option<&LayerId> {
        self.by_glyph_source.get(&GlyphSource {
            glyph_id,
            source_id,
        })
    }

    /// Layers with at least one component of `base_glyph_id`.
    pub(super) fn composites_of(&self, base_glyph_id: &GlyphId) -> impl Iterator<Item = &LayerId> {
        self.by_component_base.get(base_glyph_id)
    }

    /// Glyphs owning a layer with a component of `base_glyph_id`; a glyph
    /// with several such layers repeats.
    pub(super) fn composite_glyphs_of(
        &self,
        base_glyph_id: &GlyphId,
    ) -> impl Iterator<Item = &GlyphId> {
        self.composites_of(base_glyph_id)
            .filter_map(|layer_id| self.owner(layer_id))
    }

    /// Files `entries` under every index.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::DuplicateGlyphName`], [`CoreError::DuplicateLayerId`],
    /// [`CoreError::DuplicateGlyphLayer`], or a duplicate entity id error for
    /// the first key a unique index already holds. The index is then partly
    /// updated, so insert into a copy and keep it only on success.
    pub(super) fn try_insert(&mut self, entries: IndexEntries) -> CoreResult<()> {
        self.by_name.try_extend(entries.names).or_duplicate()?;
        self.owners.try_extend(entries.owners).or_duplicate()?;
        self.by_glyph_source
            .try_extend(entries.glyph_sources)
            .or_duplicate()?;
        self.entity_ids
            .try_extend(entries.entity_ids)
            .or_duplicate()?;
        self.by_unicode.extend(entries.unicodes);
        self.by_component_base.extend(entries.component_bases);
        Ok(())
    }

    pub(super) fn remove(&mut self, entries: &IndexEntries) {
        self.by_name.remove_all(&entries.names);
        self.by_unicode.remove_all(&entries.unicodes);
        self.owners.remove_all(&entries.owners);
        self.by_glyph_source.remove_all(&entries.glyph_sources);
        self.by_component_base.remove_all(&entries.component_bases);
        self.entity_ids.remove_all(&entries.entity_ids);
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
    /// Returns the first duplicate, as [`Self::try_insert`] does. The index is
    /// then partly updated, so call this only on a copy that is discarded on
    /// failure.
    pub(super) fn return_glyphs(
        &mut self,
        touched: &IndexSet<GlyphId>,
        before: &HashMap<GlyphId, Arc<Glyph>>,
        glyphs: &PersistentEntityList<Arc<Glyph>>,
    ) -> CoreResult<()> {
        // Every release lands before any claim, so a glyph can take an id
        // another touched glyph gave up.
        let mut transfer = EntityIdTransfer::default();
        let mut ids_changed = HashSet::new();
        for glyph_id in touched {
            let old = before.get(glyph_id);
            if let (Some(old), Some(new)) = (old, glyphs.get(glyph_id))
                && old.has_same_entity_ids(new)
            {
                continue;
            }
            if let Some(old) = old {
                transfer.release(old.entity_ids());
            }
            ids_changed.insert(glyph_id);
        }

        let mut unicodes = BTreeSet::new();
        for glyph_id in touched {
            let Some(glyph) = glyphs.get(glyph_id) else {
                continue;
            };
            require_keyed(glyph_id, glyph)?;
            if ids_changed.contains(glyph_id) {
                transfer.claim(glyph.entity_ids(), &self.entity_ids)?;
            }
            self.try_insert(IndexEntries::records_of_glyph(glyph_id, glyph))?;
            unicodes.extend(glyph.unicodes().iter().copied());
        }
        transfer.apply_to(&mut self.entity_ids);
        // A full rebuild lists glyphs sharing a code point in glyph order; keep that.
        for unicode in unicodes {
            self.by_unicode
                .sort_by_key(&unicode, |glyph_id| glyphs.index_of(glyph_id));
        }
        Ok(())
    }
}

/// What one glyph or layer files under each index of a [`FontIndex`].
#[derive(Debug, Default)]
pub(super) struct IndexEntries {
    names: Vec<(GlyphName, GlyphId)>,
    unicodes: Vec<(u32, GlyphId)>,
    owners: Vec<(LayerId, GlyphId)>,
    glyph_sources: Vec<(GlyphSource, LayerId)>,
    component_bases: Vec<(GlyphId, LayerId)>,
    entity_ids: Vec<GlyphEntityId>,
}

impl IndexEntries {
    pub(super) fn of_glyph(glyph_id: &GlyphId, glyph: &Glyph) -> Self {
        let mut entries = Self::records_of_glyph(glyph_id, glyph);
        entries.entity_ids.extend(glyph.entity_ids());
        entries
    }

    pub(super) fn of_layer(glyph_id: &GlyphId, layer: &GlyphLayer) -> Self {
        let mut entries = Self::records_of_layer(glyph_id, layer);
        entries.entity_ids.extend(layer.entity_ids());
        entries
    }

    /// A glyph's name, code points, and layers, but not its entity ids,
    /// which a change set moves by difference.
    pub(super) fn records_of_glyph(glyph_id: &GlyphId, glyph: &Glyph) -> Self {
        let mut entries = Self::default();
        entries
            .names
            .push((glyph.glyph_name().clone(), glyph_id.clone()));
        for unicode in glyph.unicodes() {
            entries.unicodes.push((*unicode, glyph_id.clone()));
        }
        for layer in glyph.layers().values() {
            entries.add_layer_records(glyph_id, layer);
        }
        entries
    }

    /// A layer's owner, source, and component bases, but not its entity ids,
    /// which an in-place edit moves by difference.
    pub(super) fn records_of_layer(glyph_id: &GlyphId, layer: &GlyphLayer) -> Self {
        let mut entries = Self::default();
        entries.add_layer_records(glyph_id, layer);
        entries
    }

    fn add_layer_records(&mut self, glyph_id: &GlyphId, layer: &GlyphLayer) {
        let layer_id = layer.id();
        self.owners.push((layer_id.clone(), glyph_id.clone()));
        self.glyph_sources
            .push((GlyphSource::of(glyph_id, layer), layer_id.clone()));
        for component in layer.components_iter() {
            self.component_bases
                .push((component.base_glyph_id(), layer_id.clone()));
        }
    }
}

/// The layer slot a glyph has for one source.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub(super) struct GlyphSource {
    glyph_id: GlyphId,
    source_id: SourceId,
}

impl GlyphSource {
    fn of(glyph_id: &GlyphId, layer: &GlyphLayer) -> Self {
        Self {
            glyph_id: glyph_id.clone(),
            source_id: layer.source_id(),
        }
    }
}

/// A key that a unique index holds once.
trait DuplicateKey {
    /// The error for this key being used twice in one font.
    fn duplicate_error(&self) -> CoreError;
}

impl DuplicateKey for GlyphName {
    fn duplicate_error(&self) -> CoreError {
        CoreError::DuplicateGlyphName(self.clone())
    }
}

impl DuplicateKey for LayerId {
    fn duplicate_error(&self) -> CoreError {
        CoreError::DuplicateLayerId(self.clone())
    }
}

impl DuplicateKey for GlyphSource {
    fn duplicate_error(&self) -> CoreError {
        CoreError::DuplicateGlyphLayer {
            glyph_id: self.glyph_id.clone(),
            source_id: self.source_id.clone(),
        }
    }
}

impl DuplicateKey for GlyphEntityId {
    fn duplicate_error(&self) -> CoreError {
        match self.clone() {
            Self::Contour(id) => CoreError::DuplicateContourId(id),
            Self::Point(id) => CoreError::DuplicatePointId(id),
            Self::Component(id) => CoreError::DuplicateComponentId(id),
            Self::Anchor(id) => CoreError::DuplicateAnchorId(id),
            Self::Guideline(id) => CoreError::DuplicateGuidelineId(id),
        }
    }
}

/// Turns a taken key into its duplicate error.
trait OrDuplicate {
    /// # Errors
    ///
    /// Returns the key's duplicate error when one was taken.
    fn or_duplicate(self) -> CoreResult<()>;
}

impl<K: DuplicateKey> OrDuplicate for Result<(), K> {
    fn or_duplicate(self) -> CoreResult<()> {
        self.map_err(|key| key.duplicate_error())
    }
}

/// Requires a glyph to be stored under its own id.
fn require_keyed(glyph_id: &GlyphId, glyph: &Glyph) -> CoreResult<()> {
    if *glyph_id != glyph.id() {
        return Err(CoreError::MismatchedGlyphId {
            key: glyph_id.clone(),
            glyph_id: glyph.id(),
        });
    }
    Ok(())
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
        held: &PersistentSet<GlyphEntityId>,
    ) -> CoreResult<()> {
        for id in ids {
            let taken = held.contains(&id) && !self.released.contains(&id);
            if taken || !self.claimed.insert(id.clone()) {
                return Err(id.duplicate_error());
            }
        }
        Ok(())
    }

    pub(super) fn apply_to(self, ids: &mut PersistentSet<GlyphEntityId>) {
        for id in self.released.difference(&self.claimed) {
            ids.remove(id);
        }
        ids.extend(self.claimed.difference(&self.released).cloned());
    }
}
