use std::collections::{BTreeSet, HashMap, HashSet};

use shift_font::{
    Anchor, FontChangeSet, Glyph, GlyphClasses, GlyphDataCategory, GlyphId, GlyphRecordChanges,
    GlyphRecords, LayerId, LibData, NamedGlyph, OpenTypeCategories, ShaperFontSource,
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
    /// `source` once for what the font cannot answer ([`RecordAnswers`]) and
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
        let answers = RecordAnswers::ask(self, source, glyphs)?;
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

    /// What the font's shaper font compiles from, as the font stands: unsaved
    /// edits included. Each glyph's `GDEF` class reads its anchors from the
    /// layers the session has loaded and asks `source` about the rest
    /// ([`ClassAnswers`]), so nothing is loaded to answer.
    ///
    /// # Errors
    ///
    /// Returns the source's error when it cannot answer.
    pub fn shaper_font_source<S: RecordSource>(
        &self,
        source: &mut S,
    ) -> Result<ShaperFontSource, S::Error> {
        let font = self.font();
        let glyphs: Vec<&Glyph> = font.glyphs().collect();
        let classes = ClassAnswers::ask(self, source, &glyphs)?.classes(font.lib(), &glyphs);
        Ok(font.shaper_font_source(&classes))
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
struct RecordAnswers {
    persisted_bases: HashMap<GlyphId, Vec<GlyphId>>,
    categories: HashMap<GlyphId, GlyphDataCategory>,
}

impl RecordAnswers {
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
        Ok(Self {
            persisted_bases: answered(unloaded, bases),
            categories: categories_of(source, glyphs)?,
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

/// What a session's font cannot answer for some glyphs' `GDEF` classes,
/// asked of the store once each: every glyph's glyph-data category, and which
/// layers the session has not loaded carry an anchor marks attach to.
struct ClassAnswers {
    categories: HashMap<GlyphId, GlyphDataCategory>,
    persisted_attaching: HashSet<LayerId>,
}

impl ClassAnswers {
    /// Asks `source` about `glyphs` as `session` holds them.
    fn ask<S: RecordSource>(
        session: &EngineSession,
        source: &mut S,
        glyphs: &[&Glyph],
    ) -> Result<Self, S::Error> {
        let unloaded: Vec<LayerId> = glyphs
            .iter()
            .flat_map(|glyph| glyph.layers().keys().copied())
            .filter(|layer_id| session.residency().is_unloaded(*layer_id))
            .collect();
        let persisted_attaching = match unloaded.is_empty() {
            true => HashSet::new(),
            false => source
                .attaching_anchor_layers(&unloaded)?
                .into_iter()
                .collect(),
        };
        Ok(Self {
            categories: categories_of(source, glyphs)?,
            persisted_attaching,
        })
    }

    /// The classes of `glyphs` from these answers and `lib`'s explicit ones.
    /// A placeholder layer has no anchors, so the store answers for it.
    fn classes<'a>(self, lib: &'a LibData, glyphs: &[&Glyph]) -> GlyphClasses<'a> {
        let attaching = glyphs
            .iter()
            .filter(|glyph| {
                glyph.layers().values().any(|layer| {
                    self.persisted_attaching.contains(&layer.id())
                        || layer.anchors().iter().any(Anchor::attaches_marks)
                })
            })
            .map(|glyph| glyph.id())
            .collect();
        GlyphClasses::new(lib, self.categories, attaching)
    }
}

/// Glyph data's category for each of `glyphs`, asked of `source` once.
fn categories_of<S: RecordSource>(
    source: &mut S,
    glyphs: &[&Glyph],
) -> Result<HashMap<GlyphId, GlyphDataCategory>, S::Error> {
    let named: Vec<NamedGlyph> = glyphs.iter().copied().map(NamedGlyph::from).collect();
    let categories = source.glyph_data_categories(&named)?;
    Ok(answered(glyphs.iter().map(|glyph| glyph.id()), categories))
}

/// Each of `questions` with its answer, `answers` being in request order.
fn answered<V>(
    questions: impl IntoIterator<Item = GlyphId>,
    answers: Vec<V>,
) -> HashMap<GlyphId, V> {
    questions.into_iter().zip(answers).collect()
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
