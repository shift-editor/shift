use std::collections::{BTreeSet, HashSet};

use shift_font::{
    AppliedIntents, CoreError, Font, FontChange, FontChangeSet, FontIntentSet, Glyph, GlyphId,
    GlyphLayer, LayerId,
};

use crate::{LayerResidency, LayerSource, ReadSet};

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

    /// Loads everything applying `set` reads.
    ///
    /// # Errors
    ///
    /// Returns [`LoadError::Source`] when the source fails and
    /// [`LoadError::Font`] when a loaded layer cannot replace its placeholder.
    pub fn load_for_intents<S: LayerSource>(
        &mut self,
        source: &mut S,
        set: &FontIntentSet,
    ) -> Result<(), LoadError<S::Error>> {
        self.load_layers(source, ReadSet::named_layers(&self.font, set))?;
        // Decomposed components are read from the named layers, so find the
        // rest of the read set only once those are loaded.
        let reads = ReadSet::for_intents(&self.font, set);
        let anchor_edits: Vec<LayerId> = reads.anchor_edits().cloned().collect();
        let mut roots: BTreeSet<GlyphId> = reads.component_bases().cloned().collect();
        roots.extend(self.dependents(source, &anchor_edits)?);
        self.load_glyph_closure(source, roots)
    }

    /// Loads what replaying `change_set` reads.
    ///
    /// # Errors
    ///
    /// As [`Self::load_for_intents`].
    pub fn load_for_change_set<S: LayerSource>(
        &mut self,
        source: &mut S,
        change_set: &FontChangeSet,
    ) -> Result<(), LoadError<S::Error>> {
        self.load_layers(source, ReadSet::change_set_layers(change_set))
    }

    /// Loads every layer of `glyph_ids`.
    ///
    /// # Errors
    ///
    /// As [`Self::load_for_intents`].
    pub fn load_glyphs<S: LayerSource>(
        &mut self,
        source: &mut S,
        glyph_ids: &[GlyphId],
    ) -> Result<(), LoadError<S::Error>> {
        let layer_ids = self.layer_ids_of(glyph_ids);
        self.load_layers(source, layer_ids)
    }

    /// Loads every layer of `roots` and of the glyphs their components use.
    ///
    /// # Errors
    ///
    /// As [`Self::load_for_intents`].
    pub fn load_glyph_closure<S: LayerSource>(
        &mut self,
        source: &mut S,
        roots: impl IntoIterator<Item = GlyphId>,
    ) -> Result<(), LoadError<S::Error>> {
        let mut closure: BTreeSet<GlyphId> = roots.into_iter().collect();
        // The source knows persisted components and the font knows the loaded
        // ones, which may be ahead; load both until neither adds a glyph.
        loop {
            let roots: Vec<GlyphId> = closure.iter().cloned().collect();
            let mut next: BTreeSet<GlyphId> = source
                .component_closure(&roots)
                .map_err(LoadError::Source)?
                .into_iter()
                .collect();
            next.extend(closure.iter().cloned());
            next.extend(
                roots
                    .iter()
                    .flat_map(|glyph_id| self.loaded_bases(glyph_id)),
            );
            if next == closure {
                break;
            }
            closure = next;
        }
        let glyph_ids: Vec<GlyphId> = closure.into_iter().collect();
        self.load_glyphs(source, &glyph_ids)
    }

    /// Loads every layer that is still a placeholder.
    ///
    /// # Errors
    ///
    /// As [`Self::load_for_intents`].
    pub fn load_all<S: LayerSource>(&mut self, source: &mut S) -> Result<(), LoadError<S::Error>> {
        let layer_ids = self.residency.unloaded_layer_ids().cloned().collect();
        self.load_layers(source, layer_ids)
    }

    /// Loads `layer_ids` that are still placeholders.
    ///
    /// # Errors
    ///
    /// As [`Self::load_for_intents`].
    pub fn load_layers<S: LayerSource>(
        &mut self,
        source: &mut S,
        layer_ids: Vec<LayerId>,
    ) -> Result<(), LoadError<S::Error>> {
        let mut missing = self.residency.requested_unloaded(layer_ids);
        missing.sort();
        missing.dedup();
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
        self.load_for_intents(source, set)?;
        let staged = self.stage_intents(set)?;
        Ok(self.commit(staged))
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
        let mut dependents: BTreeSet<GlyphId> = source
            .dependents(layer_ids)
            .map_err(LoadError::Source)?
            .into_iter()
            .collect();
        // Loaded composites may use the glyph through edits not persisted yet.
        for base in layer_ids
            .iter()
            .filter_map(|layer_id| self.font.glyph_id_by_layer(layer_id))
        {
            dependents.extend(
                self.font
                    .layers_using_component_base(&base)
                    .filter_map(|layer_id| self.font.glyph_id_by_layer(layer_id)),
            );
        }
        Ok(dependents)
    }

    /// Bases of `glyph_id`'s loaded components.
    fn loaded_bases(&self, glyph_id: &GlyphId) -> Vec<GlyphId> {
        self.font
            .glyph(glyph_id)
            .into_iter()
            .flat_map(|glyph| glyph.layers().values())
            .flat_map(|layer| {
                layer
                    .components_iter()
                    .map(shift_font::Component::base_glyph_id)
            })
            .collect()
    }

    fn layer_ids_of(&self, glyph_ids: &[GlyphId]) -> Vec<LayerId> {
        glyph_ids
            .iter()
            .filter_map(|glyph_id| self.font.glyph(glyph_id))
            .flat_map(Glyph::layer_ids)
            .collect()
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
