use std::collections::{BTreeSet, HashMap};

use shift_font::{
    FontChangeSet, Glyph, GlyphDataCategory, GlyphId, GlyphRecordChanges, GlyphRecords, NamedGlyph,
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
    /// Every glyph's record, in name order, as the font stands: unsaved
    /// edits included.
    ///
    /// # Errors
    ///
    /// Returns the source's error when it cannot answer.
    pub fn glyph_records<S: RecordSource>(&self, source: &mut S) -> Result<GlyphRecords, S::Error> {
        let glyphs: Vec<&Glyph> = self.font().glyphs().collect();
        self.glyph_records_of(source, &glyphs)
    }

    /// The records of the glyphs `changes` changed, as they are now, the
    /// glyphs it removed, and the glyph order when it moved a glyph in it:
    /// what an edit's reply carries instead of every record, for a reader
    /// that keeps every record in order.
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
        let changed = GlyphRecordChanges::of(font, changes, |glyphs| {
            self.glyph_records_of(source, glyphs)
        })?;
        Ok(changed.with_order(font, changes))
    }

    /// The records of `glyphs`, in name order, as the font stands. Asks
    /// `source` once for what the font cannot answer ([`StoreAnswers`]) and
    /// loads nothing.
    ///
    /// # Errors
    ///
    /// Returns the source's error when it cannot answer.
    pub fn glyph_records_of<S: RecordSource>(
        &self,
        source: &mut S,
        glyphs: &[&Glyph],
    ) -> Result<GlyphRecords, S::Error> {
        let answers = StoreAnswers::ask(self, source, glyphs)?;
        let font = self.font();
        let explicit = OpenTypeCategories::of(font.lib());
        Ok(glyphs
            .iter()
            .map(|glyph| {
                font.glyph_record(
                    glyph,
                    answers.component_bases(glyph),
                    answers.category(glyph),
                    &explicit,
                )
            })
            .collect())
    }

    /// Whether any of `glyph`'s layers is still a placeholder.
    fn has_unloaded_layer(&self, glyph: &Glyph) -> bool {
        glyph
            .layers()
            .values()
            .any(|layer| self.residency().is_unloaded(layer.id()))
    }
}

/// What a session's font cannot answer for some glyphs' records, asked of
/// the store once each: the persisted component bases of the glyphs with a
/// layer the session has not loaded, and every glyph's glyph-data category.
struct StoreAnswers {
    persisted_bases: HashMap<GlyphId, Vec<GlyphId>>,
    categories: HashMap<GlyphId, GlyphDataCategory>,
}

impl StoreAnswers {
    /// Asks `source` about `glyphs` as `session` holds them.
    fn ask<S: RecordSource>(
        session: &EngineSession,
        source: &mut S,
        glyphs: &[&Glyph],
    ) -> Result<Self, S::Error> {
        let unloaded: Vec<GlyphId> = glyphs
            .iter()
            .filter(|glyph| session.has_unloaded_layer(glyph))
            .map(|glyph| glyph.id())
            .collect();
        let bases = source.component_bases(&unloaded)?;
        let named: Vec<NamedGlyph> = glyphs.iter().copied().map(NamedGlyph::from).collect();
        let categories = source.glyph_data_categories(&named)?;
        Ok(Self {
            persisted_bases: answered(unloaded, bases),
            categories: answered(glyphs.iter().map(|glyph| glyph.id()), categories),
        })
    }

    /// The glyphs `glyph`'s components use, in id order. A placeholder layer
    /// has no components, so its loaded layers answer for themselves and the
    /// store for the rest. The store may still list a base an unsaved edit
    /// removed from a loaded layer: an extra dependency, never a missing one.
    fn component_bases(&self, glyph: &Glyph) -> Vec<GlyphId> {
        let persisted = self.persisted_bases.get(&glyph.id()).into_iter().flatten();
        let bases: BTreeSet<GlyphId> = glyph
            .component_glyph_ids()
            .chain(persisted.copied())
            .collect();
        bases.into_iter().collect()
    }

    /// Glyph data's category for `glyph`.
    fn category(&self, glyph: &Glyph) -> GlyphDataCategory {
        self.categories
            .get(&glyph.id())
            .copied()
            .unwrap_or_default()
    }
}

/// Each of `questions` with its answer, `answers` being in request order.
fn answered<V>(
    questions: impl IntoIterator<Item = GlyphId>,
    answers: Vec<V>,
) -> HashMap<GlyphId, V> {
    questions.into_iter().zip(answers).collect()
}
