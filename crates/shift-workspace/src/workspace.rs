use std::{
    collections::HashMap,
    io,
    path::{Path, PathBuf},
    time::Instant,
};

use shift_backends::{
    FontExportRequest, FontExportResult, FontExporter, ImportBatchLimit, font_loader::FontLoader,
};
use shift_engine::{ApplyError, EngineError, EngineSession, LayerSource, LoadError, StagedEdit};
use shift_font::{
    AppliedIntents, FontChangeSet, FontIntentSet, GlyphId, GlyphLayer, LayerId, error::CoreError,
};
use shift_store::{
    DocumentMetadata, RecoveryState, SaveState, ShiftStore, WorkspaceSourceKind, WorkspaceState,
};

use crate::document_identity::{DocumentIdentity, document_identity};
use crate::import_staging::{create_import_staging_path, install_import_store};
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
    session: EngineSession,
    source: WorkspaceSource,
    store: ShiftStore,
    ledger: Ledger,
}

impl FontWorkspace {
    fn from_store(
        session: EngineSession,
        source: WorkspaceSource,
        store: ShiftStore,
        save_state: SaveState,
    ) -> Self {
        Self {
            session,
            source,
            store,
            ledger: Ledger::new(save_state),
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
            EngineSession::open_loaded(font),
            WorkspaceSource::Untitled,
            store,
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
        let session = EngineSession::open_directory(store.load_font_directory()?);

        Ok(Self::from_store(
            session,
            WorkspaceSource::Document {
                path: document_path.to_path_buf(),
            },
            store,
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
        self.session = EngineSession::open_directory(self.store.load_font_directory()?);
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
        let session = EngineSession::open_directory(store.load_font_directory()?);
        let source = source_from_workspace_state(&state)?;

        Ok(Self::from_store(
            session,
            source,
            store,
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
            .export(self.session.font(), request)
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
        let staged = self
            .session
            .stage_loaded(&mut StoreLayers(&self.store), set)
            .map_err(WorkspaceError::from_apply)?;
        let outcome = self.commit(staged, SaveState::Unsaved)?;

        self.ledger.push(label, outcome.changes.clone());
        Ok(outcome)
    }

    /// Persists a change set another process sent compacted, loading the
    /// layers it sent as values and rebuilding them from this font first.
    ///
    /// # Errors
    ///
    /// As [`Self::persist_change_set`], and [`WorkspaceError::Font`] when a
    /// layer sent as values no longer has the change's before values.
    pub fn persist_compact_change_set(
        &mut self,
        change_set: shift_font::CompactChangeSet,
        save_state: SaveState,
    ) -> Result<AppliedIntents, WorkspaceError> {
        self.session
            .load_layers(&mut StoreLayers(&self.store), change_set.value_layer_ids())
            .map_err(WorkspaceError::from_load)?;
        let change_set = change_set.expand(self.session.font())?;
        self.persist_change_set(change_set, save_state)
    }

    /// Persists a change set already applied to a session over this font,
    /// without replaying intents or adding a ledger entry: the session that
    /// made it keeps its undo history. Every `before` must match this font, so a
    /// change set made from a stale font is refused.
    ///
    /// `save_state` is the caller's claim about where the change leaves the
    /// font; the store verifies a [`SaveState::MatchesSaved`] claim against the
    /// saved document before discarding any unsaved edit.
    ///
    /// # Errors
    ///
    /// Returns [`WorkspaceError::Store`] when what it touches cannot be loaded
    /// or the write fails, and [`WorkspaceError::Font`] when it does not apply
    /// to this font. The live font is unchanged on failure.
    pub fn persist_change_set(
        &mut self,
        change_set: FontChangeSet,
        save_state: SaveState,
    ) -> Result<AppliedIntents, WorkspaceError> {
        self.session
            .load_changed(&mut StoreLayers(&self.store), &change_set)
            .map_err(WorkspaceError::from_load)?;
        let staged = self.session.stage_change_set(change_set)?;
        self.commit(staged, save_state)
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
        let change_set = match side {
            ReplaySide::Pre => entry.change_set.inverted(),
            ReplaySide::Post => entry.change_set.clone(),
        };
        self.session
            .load_changed(&mut StoreLayers(&self.store), &change_set)
            .map_err(WorkspaceError::from_load)?;
        let staged = self.session.stage_change_set(change_set)?;
        self.commit(staged, save_state)
    }

    /// Persists a staged edit, then makes it part of the session, so a failed
    /// write leaves the live font unchanged.
    fn commit(
        &mut self,
        staged: StagedEdit,
        save_state: SaveState,
    ) -> Result<AppliedIntents, WorkspaceError> {
        self.store
            .apply_change_set_with_font(staged.changes(), staged.font(), save_state)?;
        Ok(self.session.commit(staged))
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
                let session = EngineSession::open_directory(store.load_font_directory()?);
                drop(store);
                install_import_store(staged_path, store_path)?;
                let store = ShiftStore::open(store_path)?;

                return Ok(Self::from_store(
                    session,
                    WorkspaceSource::Imported {
                        original_path: import_path.to_path_buf(),
                    },
                    store,
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
            EngineSession::open_loaded(font),
            WorkspaceSource::Imported {
                original_path: import_path.to_path_buf(),
            },
            store,
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
        let mut source = StoreLayers(&self.store);
        match scope {
            AcquireScope::Glyphs => self.session.load_glyphs(&mut source, glyph_ids),
            AcquireScope::ComponentClosure => self
                .session
                .load_glyph_closure(&mut source, glyph_ids.iter().copied()),
        }
        .map_err(WorkspaceError::from_load)
    }

    /// Loads every layer that is still a directory placeholder.
    ///
    /// # Errors
    ///
    /// Returns [`WorkspaceError::Store`] when a layer payload cannot be read, and
    /// [`WorkspaceError::Font`] when a loaded layer cannot replace its placeholder.
    pub fn acquire_all_layers(&mut self) -> Result<(), WorkspaceError> {
        self.session
            .load_all(&mut StoreLayers(&self.store))
            .map_err(WorkspaceError::from_load)
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
        Ok(self.session.evict(glyph_ids)?)
    }

    /// Residency instrumentation for tests and import profiling.
    pub fn loaded_layer_count(&self) -> usize {
        let directory_layer_count = self.session.font().layer_count();
        self.session.residency().loaded_count(directory_layer_count)
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
        glyph_id: GlyphId,
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

    /// The font as the store holds it, with every layer a placeholder: what
    /// an engine session in another process opens with, built from this
    /// session instead of from a second read of the store.
    ///
    /// # Errors
    ///
    /// Fails when a placeholder cannot replace a loaded layer.
    pub fn directory(&self) -> Result<shift_font::Font, WorkspaceError> {
        self.session.directory().map_err(Into::into)
    }

    /// Metadata and directory are always present. Layer payloads are present
    /// only after explicit acquisition.
    pub fn font(&self) -> &shift_font::Font {
        self.session.font()
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
/// The store as the session's [`LayerSource`]: what is saved and persisted.
struct StoreLayers<'a>(&'a ShiftStore);

impl LayerSource for StoreLayers<'_> {
    type Error = shift_store::StoreError;

    fn load_layers(&mut self, layer_ids: &[LayerId]) -> Result<Vec<GlyphLayer>, Self::Error> {
        let started = Instant::now();
        let layers = self.0.load_glyph_layers(layer_ids)?;
        profile_acquisition("merged-view-read-decode", started);
        Ok(layers)
    }

    fn component_closure(&mut self, roots: &[GlyphId]) -> Result<Vec<GlyphId>, Self::Error> {
        let started = Instant::now();
        let closure = self.0.referenced_glyph_closure(roots.iter().copied())?;
        profile_acquisition("component-closure", started);
        Ok(closure)
    }

    fn dependents(&mut self, layer_ids: &[LayerId]) -> Result<Vec<GlyphId>, Self::Error> {
        self.0.dependent_glyph_ids_for_layers(layer_ids)
    }
}

fn profile_acquisition(phase: &str, started: Instant) {
    if std::env::var("SHIFT_PROFILE_SLUG_ATLAS").is_ok_and(|value| value != "0") {
        eprintln!(
            "[slug-atlas-acquisition] phase={phase} duration_ms={:.3}",
            started.elapsed().as_secs_f64() * 1_000.0
        );
    }
}

impl WorkspaceError {
    fn from_load(error: LoadError<shift_store::StoreError>) -> Self {
        match error {
            LoadError::Source(error) => Self::Store(error),
            LoadError::Font(error) => Self::Font(error),
        }
    }

    fn from_apply(error: ApplyError<shift_store::StoreError>) -> Self {
        match error {
            ApplyError::Load(error) => Self::from_load(error),
            ApplyError::Engine(error) => error.into(),
        }
    }
}

impl From<EngineError> for WorkspaceError {
    fn from(error: EngineError) -> Self {
        match error {
            EngineError::Font(error) => Self::Font(error),
            EngineError::UnloadedLayerMutation(layer_id) => Self::UnloadedLayerMutation(layer_id),
        }
    }
}

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
