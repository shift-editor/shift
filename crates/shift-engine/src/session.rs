use std::collections::{BTreeSet, HashSet};

use shift_font::{
    AppliedIntents, CoreError, Font, FontChange, FontChangeSet, FontIntentSet, GlyphId, GlyphLayer,
    LayerId,
};

use crate::{LayerResidency, LayerSource};

/// Why a staged edit failed. The session is unchanged.
#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    #[error(transparent)]
    Font(#[from] CoreError),

    #[error("refusing to change unloaded glyph layer {0}")]
    UnloadedLayerMutation(LayerId),
}

/// Why loading failed. Layers loaded before the failure stay loaded.
#[derive(Debug, thiserror::Error)]
pub enum LoadError<E> {
    #[error("layer source failed: {0}")]
    Source(E),

    #[error(transparent)]
    Font(#[from] CoreError),
}

/// An editing session over a font directory whose layer content loads on
/// demand.
///
/// Edits are staged on an O(1) copy of the font and committed separately, so
/// a caller that persists them commits only once the write succeeded.
#[derive(Clone, Debug)]
pub struct EngineSession {
    font: Font,
    residency: LayerResidency,
}

/// An applied edit that is not part of the session yet.
#[derive(Debug)]
pub struct StagedEdit {
    font: Font,
    applied: AppliedIntents,
}

impl StagedEdit {
    /// The font as the edit leaves it.
    pub fn font(&self) -> &Font {
        &self.font
    }

    pub fn changes(&self) -> &FontChangeSet {
        &self.applied.changes
    }
}

impl EngineSession {
    /// A session over a directory whose layers are all placeholders.
    pub fn open_directory(font: Font) -> Self {
        Self {
            residency: LayerResidency::with_unloaded(font.layer_ids()),
            font,
        }
    }

    /// A session over a font whose layers are all loaded.
    pub fn open_loaded(font: Font) -> Self {
        Self {
            font,
            residency: LayerResidency::default(),
        }
    }

    pub fn font(&self) -> &Font {
        &self.font
    }

    pub fn residency(&self) -> &LayerResidency {
        &self.residency
    }

    /// Loads everything applying `set` reads: the layers it names, the
    /// glyphs its components are built from (see
    /// [`FontIntentSet::component_bases`]), and the composites that follow
    /// anchors it moves, each with every glyph it is built from.
    ///
    /// # Errors
    ///
    /// Returns [`LoadError::Source`] when the source fails and
    /// [`LoadError::Font`] when a loaded layer cannot replace its placeholder.
    pub fn load_reads<S: LayerSource>(
        &mut self,
        source: &mut S,
        set: &FontIntentSet,
    ) -> Result<(), LoadError<S::Error>> {
        self.load_layers(source, set.required_layer_ids(&self.font))?;
        // Decomposed components are read from the named layers, so their
        // bases are found only once those are loaded.
        let mut roots = set.component_bases(&self.font);
        let anchor_edits: Vec<LayerId> = set.layers_with_anchor_edits().into_iter().collect();
        roots.extend(self.dependents(source, &anchor_edits)?);
        self.load_glyph_closure(source, roots)
    }

    /// Loads every layer `change_set` changes, and every layer of the glyphs
    /// it replaces whole, which replaying it compares loaded or not.
    ///
    /// # Errors
    ///
    /// As [`Self::load_reads`].
    pub fn load_changed<S: LayerSource>(
        &mut self,
        source: &mut S,
        change_set: &FontChangeSet,
    ) -> Result<(), LoadError<S::Error>> {
        let replaced: Vec<GlyphId> = change_set.replaced_glyph_ids().collect();
        let mut layer_ids: BTreeSet<LayerId> = change_set.changed_layer_ids().into_iter().collect();
        layer_ids.extend(self.font.layer_ids_of_glyphs(&replaced));
        self.load_layers(source, layer_ids)
    }

    /// Loads every layer of `glyph_ids`.
    ///
    /// # Errors
    ///
    /// As [`Self::load_reads`].
    pub fn load_glyphs<S: LayerSource>(
        &mut self,
        source: &mut S,
        glyph_ids: &[GlyphId],
    ) -> Result<(), LoadError<S::Error>> {
        let layer_ids = self.font.layer_ids_of_glyphs(glyph_ids);
        self.load_layers(source, layer_ids)
    }

    /// Loads every layer of `roots` and of the glyphs their components use.
    ///
    /// # Errors
    ///
    /// As [`Self::load_reads`].
    pub fn load_glyph_closure<S: LayerSource>(
        &mut self,
        source: &mut S,
        roots: impl IntoIterator<Item = GlyphId>,
    ) -> Result<(), LoadError<S::Error>> {
        // The source knows persisted components and the font knows the loaded
        // ones, which may be ahead. Ask both about each glyph once, until
        // neither finds a glyph not seen yet.
        let mut closure: BTreeSet<GlyphId> = roots.into_iter().collect();
        let mut frontier: Vec<GlyphId> = closure.iter().cloned().collect();
        while !frontier.is_empty() {
            let persisted = source
                .component_closure(&frontier)
                .map_err(LoadError::Source)?;
            let loaded = self.font.component_glyph_ids_of_glyphs(&frontier);
            // `insert` is true only for a glyph not seen yet.
            frontier = persisted
                .into_iter()
                .chain(loaded)
                .filter(|glyph_id| closure.insert(glyph_id.clone()))
                .collect();
        }
        let glyph_ids: Vec<GlyphId> = closure.into_iter().collect();
        self.load_glyphs(source, &glyph_ids)
    }

    /// Loads every layer that is still a placeholder.
    ///
    /// # Errors
    ///
    /// As [`Self::load_reads`].
    pub fn load_all<S: LayerSource>(&mut self, source: &mut S) -> Result<(), LoadError<S::Error>> {
        let layer_ids: Vec<LayerId> = self.residency.unloaded_layer_ids().cloned().collect();
        self.load_layers(source, layer_ids)
    }

    /// Loads `layer_ids` that are still placeholders.
    ///
    /// # Errors
    ///
    /// As [`Self::load_reads`].
    pub fn load_layers<S: LayerSource>(
        &mut self,
        source: &mut S,
        layer_ids: impl IntoIterator<Item = LayerId>,
    ) -> Result<(), LoadError<S::Error>> {
        let missing: Vec<LayerId> = self
            .residency
            .requested_unloaded(layer_ids)
            .into_iter()
            .collect();
        if missing.is_empty() {
            return Ok(());
        }
        let layers = source.load_layers(&missing).map_err(LoadError::Source)?;
        self.font.replace_glyph_layers(layers)?;
        self.residency.mark_loaded(missing);
        Ok(())
    }

    /// Drops loaded layers of `glyph_ids` back to placeholders. Every edit is
    /// committed after it is persisted, so eviction never loses work.
    ///
    /// # Errors
    ///
    /// Returns the font's error when a placeholder cannot replace its layer.
    pub fn evict(&mut self, glyph_ids: &[GlyphId]) -> Result<(), CoreError> {
        let mut placeholders = Vec::new();
        let mut evicted = Vec::new();
        let mut seen = HashSet::new();
        for glyph in glyph_ids
            .iter()
            .filter_map(|glyph_id| self.font.glyph(glyph_id))
        {
            for layer in glyph.layers().values() {
                if self.residency.is_unloaded(&layer.id()) || !seen.insert(layer.id()) {
                    continue;
                }
                let mut placeholder =
                    GlyphLayer::with_width(layer.id(), layer.source_id(), layer.width());
                placeholder.set_height(layer.height());
                placeholders.push(placeholder);
                evicted.push(layer.id());
            }
        }
        self.font.replace_glyph_layers(placeholders)?;
        self.residency.mark_unloaded(evicted);
        Ok(())
    }

    /// Applies `set` to a copy of the font. Load what it reads first.
    ///
    /// # Errors
    ///
    /// Returns [`EngineError::UnloadedLayerMutation`] when the edit would
    /// change a placeholder, and the font's error when an intent is invalid.
    pub fn stage_intents(&self, set: &FontIntentSet) -> Result<StagedEdit, EngineError> {
        let mut font = self.font.clone();
        let applied = font.apply_intents(set)?;
        self.staged(font, applied)
    }

    /// Applies a recorded change set to a copy of the font, as undo and redo
    /// replay one. Load what it reads first.
    ///
    /// # Errors
    ///
    /// As [`Self::stage_intents`].
    pub fn stage_change_set(&self, change_set: FontChangeSet) -> Result<StagedEdit, EngineError> {
        let mut font = self.font.clone();
        font.apply_change_set(&change_set)?;
        let layers = change_set.touched_layers();
        self.staged(
            font,
            AppliedIntents {
                changes: change_set,
                layers,
            },
        )
    }

    /// Makes a staged edit part of the session.
    pub fn commit(&mut self, staged: StagedEdit) -> AppliedIntents {
        self.font = staged.font;
        // Sweeping residency looks up every unloaded layer, so do it only when
        // a change could have removed layers from the directory.
        if staged.applied.changes.can_remove_layers() {
            self.residency.retain_directory_layers(&self.font);
        }
        staged.applied
    }

    /// What applying `set` would leave, without keeping it: for a preview
    /// shown while a gesture is under way. Loads what `set` reads, which stays
    /// loaded; the font is otherwise unchanged.
    ///
    /// # Errors
    ///
    /// As [`Self::apply`].
    pub fn preview<S: LayerSource>(
        &mut self,
        source: &mut S,
        set: &FontIntentSet,
    ) -> Result<AppliedIntents, ApplyError<S::Error>> {
        Ok(self.stage_loaded(source, set)?.applied)
    }

    /// Loads what `set` reads, then stages and commits it.
    ///
    /// # Errors
    ///
    /// Returns [`LoadError`] when loading fails, or [`EngineError`] when the
    /// edit does; the font is then as loading left it.
    pub fn apply<S: LayerSource>(
        &mut self,
        source: &mut S,
        set: &FontIntentSet,
    ) -> Result<AppliedIntents, ApplyError<S::Error>> {
        let staged = self.stage_loaded(source, set)?;
        Ok(self.commit(staged))
    }

    /// Loads what `set` reads and stages it. A glyph the edit replaces whole
    /// is recorded with every layer, so any of its layers still unloaded are
    /// loaded and the edit staged again: every session that persists or undoes
    /// the change then compares complete glyphs.
    ///
    /// # Errors
    ///
    /// As [`Self::apply`].
    pub fn stage_loaded<S: LayerSource>(
        &mut self,
        source: &mut S,
        set: &FontIntentSet,
    ) -> Result<StagedEdit, ApplyError<S::Error>> {
        self.load_reads(source, set)?;
        let staged = self.stage_intents(set)?;
        let partly_loaded: Vec<GlyphId> = staged
            .changes()
            .replaced_glyph_ids()
            .filter(|glyph_id| self.is_partly_loaded(glyph_id))
            .collect();
        if partly_loaded.is_empty() {
            return Ok(staged);
        }
        self.load_glyphs(source, &partly_loaded)?;
        Ok(self.stage_intents(set)?)
    }

    /// Loads what replaying `change_set` reads, then applies and commits it:
    /// an edit recorded by another session over the same font, as undo and
    /// redo replay one.
    ///
    /// # Errors
    ///
    /// As [`Self::apply`].
    pub fn replay<S: LayerSource>(
        &mut self,
        source: &mut S,
        change_set: FontChangeSet,
    ) -> Result<AppliedIntents, ApplyError<S::Error>> {
        self.load_changed(source, &change_set)?;
        let staged = self.stage_change_set(change_set)?;
        Ok(self.commit(staged))
    }

    /// Whether any layer of `glyph_id` is still a placeholder.
    fn is_partly_loaded(&self, glyph_id: &GlyphId) -> bool {
        self.font
            .layer_ids_of_glyphs([glyph_id])
            .iter()
            .any(|layer_id| self.residency.is_unloaded(layer_id))
    }

    /// Glyphs with a component of a glyph owning one of `layer_ids`.
    fn dependents<S: LayerSource>(
        &self,
        source: &mut S,
        layer_ids: &[LayerId],
    ) -> Result<BTreeSet<GlyphId>, LoadError<S::Error>> {
        if layer_ids.is_empty() {
            return Ok(BTreeSet::new());
        }
        let mut dependents = self.font.dependent_glyph_ids(layer_ids);
        // Loaded composites may use the glyph through edits not persisted
        // yet, so the source's answer only adds to the font's.
        dependents.extend(source.dependents(layer_ids).map_err(LoadError::Source)?);
        Ok(dependents)
    }

    fn staged(&self, font: Font, applied: AppliedIntents) -> Result<StagedEdit, EngineError> {
        if let Some(layer_id) = applied
            .changes
            .changes
            .iter()
            .filter_map(FontChange::layer_id)
            .find(|layer_id| self.residency.is_unloaded(layer_id))
        {
            return Err(EngineError::UnloadedLayerMutation(layer_id));
        }
        Ok(StagedEdit { font, applied })
    }
}

/// Why [`EngineSession::apply`] failed.
#[derive(Debug, thiserror::Error)]
pub enum ApplyError<E> {
    #[error(transparent)]
    Load(#[from] LoadError<E>),

    #[error(transparent)]
    Engine(#[from] EngineError),
}
