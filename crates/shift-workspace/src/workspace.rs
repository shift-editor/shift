use shift_font::{AddComponent, DecomposeComponents, ReplaceGlyphLayerContent};
use std::{
    collections::{HashMap, HashSet},
    io,
    path::{Path, PathBuf},
    time::Instant,
};

use shift_backends::{
    FontExportRequest, FontExportResult, FontExporter, ImportBatchLimit, font_loader::FontLoader,
};
use shift_font::{
    AppliedIntents, FontChange, FontChangeSet, FontIntent, FontIntentSet, Glyph, GlyphId,
    GlyphLayer, LayerId, error::CoreError,
};
use shift_store::{
    DocumentMetadata, RecoveryState, SaveState, ShiftStore, WorkspaceSourceKind, WorkspaceState,
};

use crate::document_identity::{DocumentIdentity, document_identity};
use crate::import_staging::{create_import_staging_path, install_import_store};
use crate::layer_residency::LayerResidency;
use crate::ledger::{Ledger, LedgerEntry};
use crate::{NewWorkspace, stream_into};

#[derive(Debug, thiserror::Error)]
pub enum WorkspaceError {
    #[error(transparent)]
    Font(#[from] CoreError),

    #[error(transparent)]
    Store(#[from] shift_store::StoreError),

    #[error(transparent)]
    Backend(#[from] shift_backends::BackendError),

    #[error(transparent)]
    Export(#[from] shift_backends::ExportError),

    #[error("workspace needs a save path")]
    NeedsSaveAs,

    #[error("native .shift documents require an explicit recovery path: {0}")]
    DocumentRequiresRecoveryPath(PathBuf),

    #[error("corrupt working store: {0}")]
    CorruptWorkingStore(String),

    #[error("refusing to persist unloaded glyph layer {0}")]
    UnloadedLayerMutation(LayerId),

    #[error("invalid UTF-8 in workspace path: {0}")]
    InvalidPathUtf8(PathBuf),

    #[error("workspace file-system error: {0}")]
    Io(#[from] io::Error),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum WorkspaceSource {
    Untitled,
    Document { path: PathBuf },
    Imported { original_path: PathBuf },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AcquireScope {
    Glyphs,
    ComponentClosure,
}

pub struct FontWorkspace {
    font: shift_font::Font,
    source: WorkspaceSource,
    store: ShiftStore,
    ledger: Ledger,
    residency: LayerResidency,
}

impl FontWorkspace {
    fn from_store(
        font: shift_font::Font,
        source: WorkspaceSource,
        store: ShiftStore,
        residency: LayerResidency,
        save_state: SaveState,
    ) -> Self {
        Self {
            font,
            source,
            store,
            ledger: Ledger::new(save_state),
            residency,
        }
    }

    /// Creates a workspace for a new, untitled font in a store at `store_path`.
    ///
    /// # Errors
    ///
    /// Returns [`WorkspaceError::Store`] when the store cannot be opened or the new font cannot be
    /// written to it.
    pub fn create_untitled(
        store_path: impl AsRef<Path>,
        new_workspace: NewWorkspace,
    ) -> Result<Self, WorkspaceError> {
        let mut store = ShiftStore::open(store_path)?;
        store.set_font_info(&new_workspace.font_info())?;

        let font = new_font(new_workspace);
        store.replace_font_state(&font)?;
        store.set_workspace_state(&WorkspaceState::untitled(None))?;

        Ok(Self::from_store(
            font,
            WorkspaceSource::Untitled,
            store,
            LayerResidency::default(),
            SaveState::MatchesSaved,
        ))
    }

    /// Imports the font at `source_path` into a working store at `store_path`.
    ///
    /// # Errors
    ///
    /// Returns [`WorkspaceError::DocumentRequiresRecoveryPath`] for a `.shift` document, which
    /// opens with [`Self::open_document`]; [`WorkspaceError::InvalidPathUtf8`] when `source_path`
    /// is not UTF-8; [`WorkspaceError::Backend`] when the source cannot be read; and
    /// [`WorkspaceError::Store`] or [`WorkspaceError::Io`] when the import cannot be staged and
    /// written, including when `store_path` already holds a workspace.
    pub fn open(
        source_path: impl AsRef<Path>,
        store_path: impl AsRef<Path>,
    ) -> Result<Self, WorkspaceError> {
        let source_path = source_path.as_ref();
        if source_path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("shift"))
        {
            return Err(WorkspaceError::DocumentRequiresRecoveryPath(
                source_path.to_path_buf(),
            ));
        }

        Self::import_font(source_path, store_path)
    }

    /// Opens a `.shift` document, keeping unsaved edits in `recovery_path`.
    ///
    /// # Errors
    ///
    /// Returns [`WorkspaceError::Store`] when the document or its recovery store cannot be opened,
    /// or the font directory cannot be loaded.
    pub fn open_document(
        document_path: impl AsRef<Path>,
        recovery_path: impl AsRef<Path>,
    ) -> Result<Self, WorkspaceError> {
        let document_path = document_path.as_ref();
        let store = ShiftStore::open_document_with_recovery(document_path, recovery_path)?;
        let save_state = match store.recovery_state()? {
            Some(RecoveryState::Clean) => SaveState::MatchesSaved,
            _ => SaveState::Unsaved,
        };
        let font = store.load_font_directory()?;
        let residency = LayerResidency::with_unloaded(font.layer_ids());

        Ok(Self::from_store(
            font,
            WorkspaceSource::Document {
                path: document_path.to_path_buf(),
            },
            store,
            residency,
            save_state,
        ))
    }

    /// Reads the identity of the document at `document_path` without opening it.
    ///
    /// # Errors
    ///
    /// Returns [`WorkspaceError::Store`] when the file is not a readable `.shift` document, and
    /// [`WorkspaceError::Io`] when its path cannot be resolved.
    pub fn inspect_document(
        document_path: impl AsRef<Path>,
    ) -> Result<DocumentIdentity, WorkspaceError> {
        document_identity(document_path)
    }

    /// Saves the open document in place.
    ///
    /// # Errors
    ///
    /// Returns [`WorkspaceError::NeedsSaveAs`] when the workspace is untitled or imported, and
    /// [`WorkspaceError::Store`] when the document cannot be written.
    pub fn save(&mut self) -> Result<(), WorkspaceError> {
        match &self.source {
            WorkspaceSource::Document { .. } => {
                self.store.save_document()?;
                self.ledger.mark_saved();
                Ok(())
            }
            WorkspaceSource::Untitled | WorkspaceSource::Imported { .. } => {
                Err(WorkspaceError::NeedsSaveAs)
            }
        }
    }

    /// Saves the workspace as a `.shift` document and continues editing it there.
    ///
    /// # Errors
    ///
    /// Returns [`WorkspaceError::Store`] when the document cannot be written or reopened with its
    /// recovery store.
    pub fn save_as_document(
        &mut self,
        document_path: impl AsRef<Path>,
        recovery_path: impl AsRef<Path>,
    ) -> Result<DocumentMetadata, WorkspaceError> {
        let document_path = document_path.as_ref();
        let metadata = self.store.save_as_document(document_path)?;
        let store = ShiftStore::open_document_with_recovery(document_path, recovery_path)?;
        self.store = store;
        self.source = WorkspaceSource::Document {
            path: document_path.to_path_buf(),
        };
        self.ledger = Ledger::default();

        Ok(metadata)
    }

    /// Drops unsaved edits and reloads the document as last saved.
    ///
    /// # Errors
    ///
    /// Returns [`WorkspaceError::Store`] when the recovery store cannot be cleared or the saved
    /// font cannot be loaded.
    pub fn discard_recovery(&mut self) -> Result<(), WorkspaceError> {
        self.store.discard_recovery()?;
        let font = self.store.load_font_directory()?;
        self.residency = LayerResidency::with_unloaded(font.layer_ids());
        self.font = font;
        self.ledger = Ledger::default();
        Ok(())
    }

    /// Returns the saved document's metadata, or `None` when the workspace is not a document.
    ///
    /// # Errors
    ///
    /// Returns [`WorkspaceError::Store`] when the metadata cannot be read.
    pub fn document_metadata(&self) -> Result<Option<DocumentMetadata>, WorkspaceError> {
        match &self.source {
            WorkspaceSource::Document { .. } => Ok(Some(self.store.document_metadata()?)),
            _ => Ok(None),
        }
    }

    /// Reopens a working store left by an earlier session.
    ///
    /// # Errors
    ///
    /// Returns [`WorkspaceError::Store`] when the store cannot be opened or read, and
    /// [`WorkspaceError::CorruptWorkingStore`] when it has no workspace state or records a source
    /// it cannot describe.
    pub fn resume(store_path: impl AsRef<Path>) -> Result<Self, WorkspaceError> {
        let store = ShiftStore::open(store_path)?;
        let state = store
            .workspace_state()?
            .ok_or_else(|| WorkspaceError::CorruptWorkingStore("missing workspace_state".into()))?;
        let font = store.load_font_directory()?;
        let residency = LayerResidency::with_unloaded(font.layer_ids());
        let source = source_from_workspace_state(&state)?;

        Ok(Self::from_store(
            font,
            source,
            store,
            residency,
            if state.dirty {
                SaveState::Unsaved
            } else {
                SaveState::MatchesSaved
            },
        ))
    }

    /// Loads every layer and exports the font as `request` describes.
    ///
    /// # Errors
    ///
    /// Returns [`WorkspaceError::Store`] when an unloaded layer cannot be read, and
    /// [`WorkspaceError::Export`] when the export fails.
    pub fn export(
        &mut self,
        request: FontExportRequest,
    ) -> Result<FontExportResult, WorkspaceError> {
        self.acquire_all_layers()?;
        FontExporter::new()
            .export(&self.font, request)
            .map_err(WorkspaceError::from)
    }

    /// Applies a renderer intent set: validate + mutate via shift-font,
    /// persist the canonical records, swap the live font, record one ledger
    /// entry. One call = one SQLite transaction = one undo step — including
    /// sets that batch several create intents.
    ///
    /// # Errors
    ///
    /// Returns [`WorkspaceError::Store`] when a required layer cannot be loaded or the changes
    /// cannot be persisted, [`WorkspaceError::Font`] when an intent is invalid for the font, and
    /// [`WorkspaceError::UnloadedLayerMutation`] when an intent would persist a layer that is not
    /// loaded. The live font is unchanged on failure.
    pub fn apply(
        &mut self,
        set: &FontIntentSet,
        label: Option<String>,
    ) -> Result<AppliedIntents, WorkspaceError> {
        let required_layers = set
            .intents
            .iter()
            .flat_map(|intent| intent.required_layer_ids(&self.font))
            .collect::<Vec<_>>();
        self.acquire_layers(required_layers)?;

        let mut component_roots = Vec::new();
        for intent in &set.intents {
            match intent {
                FontIntent::AddComponent(AddComponent { base_glyph_id, .. }) => {
                    component_roots.push(base_glyph_id.clone());
                }
                FontIntent::ReplaceGlyphLayerContent(ReplaceGlyphLayerContent {
                    components,
                    ..
                }) => {
                    component_roots
                        .extend(components.iter().map(shift_font::Component::base_glyph_id));
                }
                FontIntent::DecomposeComponents(DecomposeComponents {
                    layer_id,
                    component_ids,
                }) => {
                    let Some(layer) = self.font.layer(layer_id) else {
                        continue;
                    };
                    component_roots.extend(component_ids.iter().filter_map(|component_id| {
                        layer
                            .component(component_id)
                            .map(shift_font::Component::base_glyph_id)
                    }));
                }
                _ => {}
            }
        }
        if !component_roots.is_empty() {
            self.acquire_glyphs(&component_roots, AcquireScope::ComponentClosure)?;
        }
        // Components attached to anchors this set moves follow them: load
        // every composite built on an edited glyph, with its other components.
        let dependents = self.dependent_glyph_ids_for_layers(&set.layers_with_anchor_edits())?;
        if !dependents.is_empty() {
            self.acquire_glyphs(&dependents, AcquireScope::ComponentClosure)?;
        }

        let outcome = self.commit_edit(SaveState::Unsaved, |font| {
            let outcome = font.apply_intents(set)?;
            let changes = outcome.changes.clone();
            Ok((outcome, changes))
        })?;

        self.ledger.push(label, outcome.changes.clone());
        Ok(outcome)
    }

    /// Applies the inverse of the most recent reversible changeset.
    /// `None` when the undo stack is empty. The echo is the same
    /// replace-grade shape as `apply`. A failed replay hands the entry back
    /// so the change stays available for retry.
    ///
    /// # Errors
    ///
    /// Returns [`WorkspaceError::Store`] or [`WorkspaceError::Font`] when the inverse changes
    /// cannot be loaded, applied or persisted; the entry stays on the undo stack.
    pub fn undo(&mut self) -> Result<Option<AppliedIntents>, WorkspaceError> {
        let Some(entry) = self.ledger.pop_undo() else {
            return Ok(None);
        };

        let save_state = self.ledger.save_state();
        match self.replay(&entry, ReplaySide::Pre, save_state) {
            Ok(outcome) => {
                self.ledger.record_undone(entry);
                Ok(Some(outcome))
            }
            Err(error) => {
                self.ledger.restore_undo(entry);
                Err(error)
            }
        }
    }

    /// Reapplies the most recently undone reversible changeset.
    /// A failed replay hands the entry back so the change stays available
    /// for retry.
    ///
    /// # Errors
    ///
    /// Returns [`WorkspaceError::Store`] or [`WorkspaceError::Font`] when the changes cannot be
    /// loaded, applied or persisted; the entry stays on the redo stack.
    pub fn redo(&mut self) -> Result<Option<AppliedIntents>, WorkspaceError> {
        let Some(entry) = self.ledger.pop_redo() else {
            return Ok(None);
        };

        let save_state = self.ledger.save_state_after(&entry);
        match self.replay(&entry, ReplaySide::Post, save_state) {
            Ok(outcome) => {
                self.ledger.record_redone(entry);
                Ok(Some(outcome))
            }
            Err(error) => {
                self.ledger.restore_redo(entry);
                Err(error)
            }
        }
    }

    /// Permanently removes every redo entry without changing live font state or dirty state.
    pub fn discard_redo(&mut self) {
        self.ledger.discard_redo();
    }

    fn replay(
        &mut self,
        entry: &LedgerEntry,
        side: ReplaySide,
        save_state: SaveState,
    ) -> Result<AppliedIntents, WorkspaceError> {
        self.acquire_layers(entry.layer_ids())?;

        let change_set = match side {
            ReplaySide::Pre => entry.change_set.inverted(),
            ReplaySide::Post => entry.change_set.clone(),
        };
        self.commit_edit(save_state, move |font| {
            font.apply_change_set(&change_set)?;
            let layers = change_set.touched_layers();
            let outcome = AppliedIntents {
                changes: change_set.clone(),
                layers,
            };
            Ok((outcome, change_set))
        })
    }

    fn commit_font(
        &mut self,
        next_font: shift_font::Font,
        change_set: &FontChangeSet,
        save_state: SaveState,
    ) -> Result<(), WorkspaceError> {
        if let Some(layer_id) = change_set
            .changes
            .iter()
            .filter_map(FontChange::layer_id)
            .find(|layer_id| self.residency.is_unloaded(layer_id))
        {
            return Err(WorkspaceError::UnloadedLayerMutation(layer_id));
        }

        self.store
            .apply_change_set_with_font(change_set, &next_font, save_state)?;
        self.font = next_font;
        // Sweeping residency looks up every unloaded layer, so do it only when
        // a change could have removed layers from the directory.
        if change_set.can_remove_layers() {
            self.residency.retain_directory_layers(&self.font);
        }
        Ok(())
    }

    fn commit_edit<R, F>(&mut self, save_state: SaveState, edit: F) -> Result<R, WorkspaceError>
    where
        F: FnOnce(&mut shift_font::Font) -> Result<(R, FontChangeSet), WorkspaceError>,
    {
        let mut next_font = self.font.clone();
        let (result, change_set) = edit(&mut next_font)?;
        self.commit_font(next_font, &change_set, save_state)?;

        Ok(result)
    }

    fn import_font(
        import_path: impl AsRef<Path>,
        store_path: impl AsRef<Path>,
    ) -> Result<Self, WorkspaceError> {
        let import_path = import_path.as_ref();
        let import_path_str = import_path
            .to_str()
            .ok_or_else(|| WorkspaceError::InvalidPathUtf8(import_path.to_path_buf()))?;
        let loader = FontLoader::new();
        match loader.stream_font(import_path_str) {
            Ok(import) => {
                let store_path = store_path.as_ref();
                if store_path.exists() {
                    let existing = ShiftStore::open(store_path)?;
                    if existing.workspace_state()?.is_some() {
                        return Err(shift_store::StoreError::ImportDestinationNotEmpty(
                            store_path.to_path_buf(),
                        )
                        .into());
                    }
                }

                let staged_path = create_import_staging_path(store_path)?;
                let mut store = ShiftStore::open_for_import(&staged_path)?;
                let mut writer = store.begin_import(import.header())?;
                stream_into(import, &mut writer, ImportBatchLimit::default(), |_| {})?;
                writer.finish()?;
                store.set_workspace_state(&WorkspaceState::imported(import_path, None))?;
                store.finish_import()?;
                let font = store.load_font_directory()?;
                let residency = LayerResidency::with_unloaded(font.layer_ids());
                drop(store);
                install_import_store(staged_path, store_path)?;
                let store = ShiftStore::open(store_path)?;

                return Ok(Self::from_store(
                    font,
                    WorkspaceSource::Imported {
                        original_path: import_path.to_path_buf(),
                    },
                    store,
                    residency,
                    SaveState::MatchesSaved,
                ));
            }
            Err(shift_backends::BackendError::StreamingUnsupported { .. }) => {}
            Err(error) => return Err(error.into()),
        }

        let font = loader.read_font(import_path_str)?;
        let mut store = ShiftStore::open(store_path)?;
        store.set_font_info(&font_info_from_font(&font))?;
        store.replace_font_state(&font)?;
        store.set_workspace_state(&WorkspaceState::imported(import_path, None))?;

        Ok(Self::from_store(
            font,
            WorkspaceSource::Imported {
                original_path: import_path.to_path_buf(),
            },
            store,
            LayerResidency::default(),
            SaveState::MatchesSaved,
        ))
    }

    /// Explicitly acquires requested glyph payloads. Component closure expands
    /// dependencies from relational indexes before any BLOB is read.
    ///
    /// # Errors
    ///
    /// Returns [`WorkspaceError::Store`] when the component closure or a layer payload cannot be
    /// read, and [`WorkspaceError::Font`] when a loaded layer cannot replace its placeholder.
    pub fn acquire_glyphs(
        &mut self,
        glyph_ids: &[GlyphId],
        scope: AcquireScope,
    ) -> Result<(), WorkspaceError> {
        let started = Instant::now();
        let glyph_ids = if scope == AcquireScope::ComponentClosure {
            self.store
                .referenced_glyph_closure(glyph_ids.iter().cloned())?
        } else {
            glyph_ids.to_vec()
        };
        if std::env::var("SHIFT_PROFILE_SLUG_ATLAS").is_ok_and(|value| value != "0") {
            eprintln!(
                "[slug-atlas-acquisition] phase=component-closure duration_ms={:.3}",
                started.elapsed().as_secs_f64() * 1_000.0
            );
        }

        let layer_ids = glyph_ids
            .into_iter()
            .flat_map(|glyph_id| {
                self.font
                    .glyph(&glyph_id)
                    .into_iter()
                    .flat_map(Glyph::layer_ids)
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>();
        self.acquire_layers(layer_ids)
    }

    /// Loads every layer that is still a directory placeholder.
    ///
    /// # Errors
    ///
    /// Returns [`WorkspaceError::Store`] when a layer payload cannot be read, and
    /// [`WorkspaceError::Font`] when a loaded layer cannot replace its placeholder.
    pub fn acquire_all_layers(&mut self) -> Result<(), WorkspaceError> {
        let layer_ids = self
            .residency
            .unloaded_layer_ids()
            .cloned()
            .collect::<Vec<_>>();
        self.acquire_layers(layer_ids)
    }

    fn acquire_layers(
        &mut self,
        layer_ids: impl IntoIterator<Item = LayerId>,
    ) -> Result<(), WorkspaceError> {
        let mut layer_ids = self.residency.requested_unloaded(layer_ids);
        layer_ids.sort_by(|left, right| left.as_str().cmp(right.as_str()));
        layer_ids.dedup();
        if layer_ids.is_empty() {
            return Ok(());
        }

        // Decode through bounded SQLite reads. Font validates the complete
        // replacement batch before mutating, so malformed input leaves the
        // live cache unchanged without copying the complete directory.
        let started = Instant::now();
        let layers = self.store.load_glyph_layers(&layer_ids)?;
        if std::env::var("SHIFT_PROFILE_SLUG_ATLAS").is_ok_and(|value| value != "0") {
            eprintln!(
                "[slug-atlas-acquisition] phase=merged-view-read-decode duration_ms={:.3}",
                started.elapsed().as_secs_f64() * 1_000.0
            );
        }

        let started = Instant::now();
        self.font.replace_glyph_layers(layers)?;
        self.residency.mark_loaded(layer_ids);
        if std::env::var("SHIFT_PROFILE_SLUG_ATLAS").is_ok_and(|value| value != "0") {
            eprintln!(
                "[slug-atlas-acquisition] phase=font-install duration_ms={:.3}",
                started.elapsed().as_secs_f64() * 1_000.0
            );
        }
        Ok(())
    }

    /// Drops clean in-memory payloads back to directory placeholders. Every
    /// authored edit is committed before the live font swap, so eviction can
    /// never discard unpersisted state.
    ///
    /// This is currently a test/profiler surface; the bridge does not yet own
    /// a production eviction policy.
    ///
    /// # Errors
    ///
    /// Returns [`WorkspaceError::Font`] when a placeholder cannot replace its layer.
    pub fn evict_glyphs(&mut self, glyph_ids: &[GlyphId]) -> Result<(), WorkspaceError> {
        let mut placeholders = Vec::new();
        let mut evicted = Vec::new();
        let mut seen_layer_ids = HashSet::new();
        for glyph_id in glyph_ids {
            let Some(glyph) = self.font.glyph(glyph_id) else {
                continue;
            };
            for layer in glyph.layers().values().map(AsRef::as_ref) {
                if self.residency.is_unloaded(&layer.id()) || !seen_layer_ids.insert(layer.id()) {
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

    /// Residency instrumentation for tests and import profiling.
    pub fn loaded_layer_count(&self) -> usize {
        let directory_layer_count = self.font.layer_count();
        self.residency.loaded_count(directory_layer_count)
    }

    /// Returns, for each glyph, the glyphs its components reference.
    ///
    /// # Errors
    ///
    /// Returns [`WorkspaceError::Store`] when the references cannot be read.
    pub fn glyph_component_references(
        &self,
    ) -> Result<HashMap<GlyphId, Vec<GlyphId>>, WorkspaceError> {
        self.store.glyph_component_references().map_err(Into::into)
    }

    /// Returns the glyphs `glyph_id`'s components reference.
    ///
    /// # Errors
    ///
    /// Returns [`WorkspaceError::Store`] when the references cannot be read.
    pub fn referenced_glyph_ids_for_glyph(
        &self,
        glyph_id: &GlyphId,
    ) -> Result<Vec<GlyphId>, WorkspaceError> {
        self.store
            .referenced_glyph_ids_for_glyph(glyph_id)
            .map_err(Into::into)
    }

    /// Returns the glyphs whose components reference a glyph owning one of `layer_ids`.
    ///
    /// # Errors
    ///
    /// Returns [`WorkspaceError::Store`] when the references cannot be read.
    pub fn dependent_glyph_ids_for_layers(
        &self,
        layer_ids: &[LayerId],
    ) -> Result<Vec<GlyphId>, WorkspaceError> {
        self.store
            .dependent_glyph_ids_for_layers(layer_ids)
            .map_err(Into::into)
    }

    /// Metadata and directory are always present. Layer payloads are present
    /// only after explicit acquisition.
    pub fn font(&self) -> &shift_font::Font {
        &self.font
    }

    pub fn source(&self) -> &WorkspaceSource {
        &self.source
    }

    pub fn save_target(&self) -> Option<&Path> {
        match &self.source {
            WorkspaceSource::Document { path } => Some(path),
            WorkspaceSource::Untitled | WorkspaceSource::Imported { .. } => None,
        }
    }

    pub fn store(&self) -> &ShiftStore {
        &self.store
    }

    pub fn store_mut(&mut self) -> &mut ShiftStore {
        &mut self.store
    }

    /// Returns the stored font info, or `None` when none was written.
    ///
    /// # Errors
    ///
    /// Returns [`WorkspaceError::Store`] when the font info cannot be read.
    pub fn font_info(&self) -> Result<Option<shift_store::FontInfo>, WorkspaceError> {
        self.store.get_font_info().map_err(WorkspaceError::from)
    }

    /// Returns whether the workspace has edits that are not saved.
    ///
    /// # Errors
    ///
    /// Returns [`WorkspaceError::Store`] when the recovery or workspace state cannot be read.
    pub fn is_dirty(&self) -> Result<bool, WorkspaceError> {
        if matches!(&self.source, WorkspaceSource::Document { .. }) {
            return Ok(!matches!(
                self.store.recovery_state()?,
                Some(RecoveryState::Clean)
            ));
        }

        Ok(self
            .store
            .workspace_state()?
            .is_some_and(|state| state.dirty))
    }

    /// Returns the durable authored revision used to address disposable derived artifacts.
    ///
    /// # Errors
    ///
    /// Returns [`WorkspaceError::Store`] when the document metadata or workspace state cannot be
    /// read, and [`WorkspaceError::CorruptWorkingStore`] when the workspace state is missing or its
    /// revision is negative.
    pub fn slug_atlas_cache_revision(&self) -> Result<String, WorkspaceError> {
        if matches!(&self.source, WorkspaceSource::Document { .. }) {
            let metadata = self.store.document_metadata()?;
            let revision = self.store.recovery_revision()?.unwrap_or_default();
            return Ok(format!("{}:{revision}", metadata.saved_commit_id));
        }

        let state = self
            .store
            .workspace_state()?
            .ok_or_else(|| WorkspaceError::CorruptWorkingStore("missing workspace_state".into()))?;
        if state.revision < 0 {
            return Err(WorkspaceError::CorruptWorkingStore(
                "negative workspace revision".into(),
            ));
        }

        Ok(state.revision.to_string())
    }

    /// Records `workspace_id` in an untitled or imported workspace's store; documents keep their
    /// own id.
    ///
    /// # Errors
    ///
    /// Returns [`WorkspaceError::Store`] when the id cannot be written.
    pub fn set_workspace_id(&mut self, workspace_id: &str) -> Result<(), WorkspaceError> {
        if matches!(&self.source, WorkspaceSource::Document { .. }) {
            return Ok(());
        }

        self.store.set_workspace_document_id(workspace_id)?;
        Ok(())
    }
}

/// Selects the inverted changeset for undo or the original for redo.
#[derive(Clone, Copy, PartialEq, Eq)]
enum ReplaySide {
    Pre,
    Post,
}

fn font_info_from_font(font: &shift_font::Font) -> shift_store::FontInfo {
    let metadata = font.metadata();
    let metrics = font.metrics();
    shift_store::FontInfo {
        family_name: metadata.family_name.clone(),
        style_name: metadata.style_name.clone(),
        copyright: metadata.copyright.clone(),
        trademark: metadata.trademark.clone(),
        description: metadata.description.clone(),
        note: metadata.note.clone(),
        sample_text: None,
        designer: metadata.designer.clone(),
        designer_url: metadata.designer_url.clone(),
        manufacturer: metadata.manufacturer.clone(),
        manufacturer_url: metadata.manufacturer_url.clone(),
        license_description: metadata.license.clone(),
        license_info_url: metadata.license_url.clone(),
        vendor_id: None,
        version_major: metadata.version_major.map(i64::from),
        version_minor: metadata.version_minor.map(i64::from),
        units_per_em: metrics.units_per_em,
        default_source_id: font.default_source_id().map(|id| id.to_string()),
    }
}

fn new_font(new_workspace: NewWorkspace) -> shift_font::Font {
    let mut font = shift_font::Font::new();
    font.metadata_mut().family_name = Some(new_workspace.family_name);
    font.metrics_mut().units_per_em = new_workspace.units_per_em as f64;
    font
}

fn source_from_workspace_state(state: &WorkspaceState) -> Result<WorkspaceSource, WorkspaceError> {
    match state.source_kind {
        WorkspaceSourceKind::Untitled => Ok(WorkspaceSource::Untitled),
        WorkspaceSourceKind::Imported => {
            let original_path = state.original_import_path.clone().ok_or_else(|| {
                WorkspaceError::CorruptWorkingStore(
                    "imported workspace missing original_import_path".into(),
                )
            })?;
            Ok(WorkspaceSource::Imported { original_path })
        }
    }
}
