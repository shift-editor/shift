use std::collections::{BTreeSet, HashMap};

use shift_font::{
    FontChangeSet, Glyph, GlyphDataCategory, GlyphId, GlyphRecord, GlyphRecordChanges, NamedGlyph,
    OpenTypeCategories,
};

use crate::EngineSession;

/// What a session reads from its store to build glyph records: the parts of
/// a record its own font cannot answer for a glyph whose layers it has not
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

    /// Whether any of `glyph`'s layers is still a placeholder.
    fn has_unloaded_layer(&self, glyph: &Glyph) -> bool {
        glyph
            .layers()
            .values()
            .any(|layer| self.residency().is_unloaded(layer.id()))
    }
}
