use std::collections::{BTreeSet, HashMap, HashSet};

use shift_font::{
    Anchor, FontChangeSet, Glyph, GlyphDataCategory, GlyphId, GlyphRecord, GlyphRecordChanges,
    LayerId, NamedGlyph, OpenTypeCategories, OpenTypeCategory, ShaperFontSource,
};

use crate::EngineSession;

/// What a session reads from its store to build glyph records and the shaper
/// font's source: the parts its own font cannot answer for layers it has not
/// loaded, and glyph data's categories, which stay with the store's reader.
pub trait RecordSource {
    type Error;

    /// The direct component bases of each of `glyph_ids`, as persisted, in
    /// request order.
    ///
    /// # Errors
    ///
    /// Returns the source's error when the component references cannot be read.
    fn component_bases(&mut self, glyph_ids: &[GlyphId]) -> Result<Vec<Vec<GlyphId>>, Self::Error>;

    /// Glyph data's category for each of `glyphs`, by name and codepoints, in
    /// request order.
    ///
    /// # Errors
    ///
    /// Returns the source's error when glyph data cannot be read.
    fn glyph_data_categories(
        &mut self,
        glyphs: &[NamedGlyph],
    ) -> Result<Vec<GlyphDataCategory>, Self::Error>;

    /// Those of `layer_ids` that carry an anchor marks attach to, as
    /// persisted.
    ///
    /// # Errors
    ///
    /// Returns the source's error when the layers cannot be read.
    fn attaching_anchor_layers(
        &mut self,
        layer_ids: &[LayerId],
    ) -> Result<Vec<LayerId>, Self::Error>;
}

impl EngineSession {
    /// Every glyph's record, sorted by name, as the font stands: unsaved
    /// edits included.
    ///
    /// # Errors
    ///
    /// Returns the source's error when it cannot answer.
    pub fn glyph_records<S: RecordSource>(
        &self,
        source: &mut S,
    ) -> Result<Vec<GlyphRecord>, S::Error> {
        let glyphs: Vec<&Glyph> = self.font().glyphs().collect();
        self.records_of(source, &glyphs)
    }

    /// The records of the glyphs `changes` changed, as they are now, and the
    /// glyphs it removed: what an edit's reply carries instead of every
    /// record.
    ///
    /// # Errors
    ///
    /// Returns the source's error when it cannot answer.
    pub fn glyph_record_changes<S: RecordSource>(
        &self,
        source: &mut S,
        changes: &FontChangeSet,
    ) -> Result<GlyphRecordChanges, S::Error> {
        let font = self.font();
        let mut glyphs = Vec::new();
        let mut removed = Vec::new();
        for glyph_id in changes.record_glyph_ids() {
            match font.glyph(glyph_id) {
                Some(glyph) => glyphs.push(glyph),
                None => removed.push(glyph_id),
            }
        }
        let updated = self.records_of(source, &glyphs)?;
        Ok(GlyphRecordChanges { updated, removed })
    }

    /// The records of `glyphs`, sorted by name, asking `source` once for the
    /// component bases of the glyphs not loaded whole and once for every
    /// glyph's glyph-data category.
    fn records_of<S: RecordSource>(
        &self,
        source: &mut S,
        glyphs: &[&Glyph],
    ) -> Result<Vec<GlyphRecord>, S::Error> {
        let font = self.font();
        let unloaded: Vec<GlyphId> = glyphs
            .iter()
            .filter(|glyph| self.has_unloaded_layer(glyph))
            .map(|glyph| glyph.id())
            .collect();
        let mut persisted = unloaded
            .iter()
            .copied()
            .zip(source.component_bases(&unloaded)?)
            .collect::<HashMap<_, _>>();
        let named: Vec<NamedGlyph> = glyphs.iter().copied().map(NamedGlyph::from).collect();
        let categories = source.glyph_data_categories(&named)?;
        let explicit = OpenTypeCategories::of(font.lib());

        let mut records: Vec<GlyphRecord> = glyphs
            .iter()
            .zip(categories)
            .map(|(glyph, category)| {
                // A placeholder layer has no components, so a glyph's loaded
                // layers answer for themselves and the store for the rest. The
                // store may still list a base an unsaved edit removed from a
                // loaded layer: an extra dependency, never a missing one.
                let mut bases: BTreeSet<GlyphId> = glyph.component_glyph_ids().collect();
                bases.extend(persisted.remove(&glyph.id()).unwrap_or_default());
                font.glyph_record(glyph, bases.into_iter().collect(), category, &explicit)
            })
            .collect();
        GlyphRecord::sort_by_name(&mut records);
        Ok(records)
    }

    /// What the font's shaper font compiles from, as the font stands: unsaved
    /// edits included. Each glyph's GDEF class reads its anchors from the
    /// layers the session has loaded and asks `source` about the rest, so
    /// nothing is loaded to answer.
    ///
    /// # Errors
    ///
    /// Returns the source's error when it cannot answer.
    pub fn shaper_font_source<S: RecordSource>(
        &self,
        source: &mut S,
    ) -> Result<ShaperFontSource, S::Error> {
        let font = self.font();
        let unloaded: Vec<LayerId> = font
            .glyphs()
            .flat_map(|glyph| glyph.layers().keys().copied())
            .filter(|layer_id| self.residency().is_unloaded(*layer_id))
            .collect();
        let persisted_attaching: HashSet<LayerId> = if unloaded.is_empty() {
            HashSet::new()
        } else {
            source
                .attaching_anchor_layers(&unloaded)?
                .into_iter()
                .collect()
        };
        let named: Vec<NamedGlyph> = font.glyphs().map(NamedGlyph::from).collect();
        let glyph_data: HashMap<GlyphId, GlyphDataCategory> = font
            .glyphs()
            .map(Glyph::id)
            .zip(source.glyph_data_categories(&named)?)
            .collect();
        let explicit = OpenTypeCategories::of(font.lib());

        Ok(font.shaper_font_source(|glyph| {
            // A placeholder layer has no anchors, so the store answers for it.
            let attaching_anchor = glyph.layers().values().any(|layer| {
                persisted_attaching.contains(&layer.id())
                    || layer.anchors().iter().any(Anchor::attaches_marks)
            });
            OpenTypeCategory::of(
                glyph,
                glyph_data.get(&glyph.id()).copied().unwrap_or_default(),
                explicit.class(glyph.name()),
                attaching_anchor,
            )
        }))
    }

    /// Whether any of `glyph`'s layers is still a placeholder.
    fn has_unloaded_layer(&self, glyph: &Glyph) -> bool {
        glyph
            .layers()
            .values()
            .any(|layer| self.residency().is_unloaded(layer.id()))
    }
}

/// Answers a [`RecordSource`] gives that stay true while a session lives,
/// so each is asked once.
///
/// Glyph data's category depends only on a glyph's name and codepoints, so it
/// is kept by those. Whether a layer the session has not loaded carries an
/// attaching anchor is kept by layer: the store holds what the layer was when
/// the session opened until an edit loads it, after which the session's own
/// layer answers and the store is not asked. A session that evicts layers
/// forgets them here ([`RecordCache::forget_layers`]).
#[derive(Debug, Default)]
pub struct RecordCache {
    categories: HashMap<NamedGlyph, GlyphDataCategory>,
    attaching: HashMap<LayerId, bool>,
}

impl RecordCache {
    /// Forgets what is kept for `layer_ids`, as after the session evicts them:
    /// the store's copy may then hold edits made since it opened.
    pub fn forget_layers(&mut self, layer_ids: &[LayerId]) {
        for layer_id in layer_ids {
            self.attaching.remove(layer_id);
        }
    }

    /// A source that answers from this cache and asks `source` for the rest,
    /// keeping its answers.
    pub fn reading<'a, S: RecordSource>(&'a mut self, source: &'a mut S) -> CachedRecords<'a, S> {
        CachedRecords {
            cache: self,
            source,
        }
    }
}

/// A [`RecordSource`] that answers from a [`RecordCache`] first.
pub struct CachedRecords<'a, S> {
    cache: &'a mut RecordCache,
    source: &'a mut S,
}

impl<S: RecordSource> RecordSource for CachedRecords<'_, S> {
    type Error = S::Error;

    fn component_bases(&mut self, glyph_ids: &[GlyphId]) -> Result<Vec<Vec<GlyphId>>, S::Error> {
        self.source.component_bases(glyph_ids)
    }

    fn glyph_data_categories(
        &mut self,
        glyphs: &[NamedGlyph],
    ) -> Result<Vec<GlyphDataCategory>, S::Error> {
        let missing: Vec<NamedGlyph> = glyphs
            .iter()
            .filter(|glyph| !self.cache.categories.contains_key(glyph))
            .cloned()
            .collect();
        if !missing.is_empty() {
            let answers = self.source.glyph_data_categories(&missing)?;
            self.cache
                .categories
                .extend(missing.into_iter().zip(answers));
        }
        Ok(glyphs
            .iter()
            .map(|glyph| {
                self.cache
                    .categories
                    .get(glyph)
                    .copied()
                    .unwrap_or_default()
            })
            .collect())
    }

    fn attaching_anchor_layers(&mut self, layer_ids: &[LayerId]) -> Result<Vec<LayerId>, S::Error> {
        let missing: Vec<LayerId> = layer_ids
            .iter()
            .copied()
            .filter(|layer_id| !self.cache.attaching.contains_key(layer_id))
            .collect();
        if !missing.is_empty() {
            let attaching: HashSet<LayerId> = self
                .source
                .attaching_anchor_layers(&missing)?
                .into_iter()
                .collect();
            self.cache.attaching.extend(
                missing
                    .into_iter()
                    .map(|layer_id| (layer_id, attaching.contains(&layer_id))),
            );
        }
        Ok(layer_ids
            .iter()
            .copied()
            .filter(|layer_id| self.cache.attaching.get(layer_id).copied().unwrap_or(false))
            .collect())
    }
}
