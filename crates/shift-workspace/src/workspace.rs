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
    AppliedIntents, FontChange, FontChangeSet, FontIntent, FontIntentSet, GlyphId, GlyphLayer,
    LayerId, TouchedLayer, error::CoreError,
};
use shift_store::{
    DocumentMetadata, RecoveryState, ShiftStore, WorkspaceSourceKind, WorkspaceState,
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
        dirty: bool,
    ) -> Self {
        Self {
            font,
            source,
            store,
            ledger: Ledger::new(dirty),
            residency,
        }
    }

    pub fn create_untitled(
        store_path: impl AsRef<Path>,
        new_workspace: NewWorkspace,
    ) -> Result<Self, WorkspaceError> {
        let mut store = ShiftStore::open(store_path)?;
        store.set_font_info(new_workspace.font_info())?;

        let font = new_font(new_workspace);
        store.replace_font_state(&font)?;
        store.set_workspace_state(WorkspaceState::untitled(None))?;

        Ok(Self::from_store(
            font,
            WorkspaceSource::Untitled,
            store,
            LayerResidency::default(),
            false,
        ))
    }

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

    pub fn open_document(
        document_path: impl AsRef<Path>,
        recovery_path: impl AsRef<Path>,
    ) -> Result<Self, WorkspaceError> {
        let document_path = document_path.as_ref();
        let store = ShiftStore::open_document_with_recovery(document_path, recovery_path)?;
        let dirty = !matches!(store.recovery_state()?, Some(RecoveryState::Clean));
        let font = store.load_font_directory()?;
        let residency = LayerResidency::with_unloaded(
            font.glyphs()
                .flat_map(|glyph| glyph.layers().keys().cloned()),
        );

        Ok(Self::from_store(
            font,
            WorkspaceSource::Document {
                path: document_path.to_path_buf(),
            },
            store,
            residency,
            dirty,
        ))
    }

    pub fn inspect_document(
        document_path: impl AsRef<Path>,
    ) -> Result<DocumentIdentity, WorkspaceError> {
        document_identity(document_path)
    }

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

    pub fn discard_recovery(&mut self) -> Result<(), WorkspaceError> {
        self.store.discard_recovery()?;
        let font = self.store.load_font_directory()?;
        self.residency = LayerResidency::with_unloaded(
            font.glyphs()
                .flat_map(|glyph| glyph.layers().keys().cloned()),
        );
        self.font = font;
        self.ledger = Ledger::default();
        Ok(())
    }

    pub fn document_metadata(&self) -> Result<Option<DocumentMetadata>, WorkspaceError> {
        match &self.source {
            WorkspaceSource::Document { .. } => Ok(Some(self.store.document_metadata()?)),
            _ => Ok(None),
        }
    }

    pub fn resume(store_path: impl AsRef<Path>) -> Result<Self, WorkspaceError> {
        let store = ShiftStore::open(store_path)?;
        let state = store
            .workspace_state()?
            .ok_or_else(|| WorkspaceError::CorruptWorkingStore("missing workspace_state".into()))?;
        let font = store.load_font_directory()?;
        let residency = LayerResidency::with_unloaded(
            font.glyphs()
                .flat_map(|glyph| glyph.layers().keys().cloned()),
        );
        let source = source_from_workspace_state(&state)?;

        Ok(Self::from_store(
            font,
            source,
            store,
            residency,
            state.dirty,
        ))
    }

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
    pub fn apply(
        &mut self,
        set: FontIntentSet,
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
                FontIntent::AddComponent { base_glyph_id, .. } => {
                    component_roots.push(base_glyph_id.clone());
                }
                FontIntent::ReplaceGlyphLayerContent { components, .. } => {
                    component_roots
                        .extend(components.iter().map(|component| component.base_glyph_id()));
                }
                FontIntent::DecomposeComponents {
                    layer_id,
                    component_ids,
                } => {
                    let Some(layer) = self.font.layer(layer_id) else {
                        continue;
                    };
                    component_roots.extend(component_ids.iter().filter_map(|component_id| {
                        layer
                            .component(component_id)
                            .map(|component| component.base_glyph_id())
                    }));
                }
                _ => {}
            }
        }
        if !component_roots.is_empty() {
            self.acquire_glyphs(&component_roots, AcquireScope::ComponentClosure)?;
        }

        let outcome = self.commit_edit(true, |font| {
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
    pub fn undo(&mut self) -> Result<Option<AppliedIntents>, WorkspaceError> {
        let Some(entry) = self.ledger.pop_undo() else {
            return Ok(None);
        };

        let dirty = self.ledger.is_dirty();
        match self.replay(&entry, ReplaySide::Pre, dirty) {
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
    pub fn redo(&mut self) -> Result<Option<AppliedIntents>, WorkspaceError> {
        let Some(entry) = self.ledger.pop_redo() else {
            return Ok(None);
        };

        let dirty = self.ledger.is_entry_dirty(&entry);
        match self.replay(&entry, ReplaySide::Post, dirty) {
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
        dirty: bool,
    ) -> Result<AppliedIntents, WorkspaceError> {
        self.acquire_layers(entry.layer_ids())?;

        let change_set = match side {
            ReplaySide::Pre => entry.change_set.inverted(),
            ReplaySide::Post => entry.change_set.clone(),
        };
        self.commit_edit(dirty, move |font| {
            font.apply_change_set(&change_set)?;
            let layers = touched_layers(&change_set);
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
        change_set: FontChangeSet,
        dirty: bool,
    ) -> Result<(), WorkspaceError> {
        if let Some(layer_id) = change_set
            .changes
            .iter()
            .filter_map(FontChange::layer_id)
            .find(|layer_id| self.residency.is_unloaded(layer_id))
        {
            return Err(WorkspaceError::UnloadedLayerMutation(layer_id.clone()));
        }

        self.store
            .apply_change_set_with_font(&change_set, &next_font, dirty)?;
        self.font = next_font;
        self.residency.retain_directory_layers(&self.font);
        Ok(())
    }

    fn commit_edit<R, F>(&mut self, dirty: bool, edit: F) -> Result<R, WorkspaceError>
    where
        F: FnOnce(&mut shift_font::Font) -> Result<(R, FontChangeSet), WorkspaceError>,
    {
        let mut next_font = self.font.clone();
        let (result, change_set) = edit(&mut next_font)?;
        self.commit_font(next_font, change_set, dirty)?;

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
                store.set_workspace_state(WorkspaceState::imported(import_path, None))?;
                store.finish_import()?;
                let font = store.load_font_directory()?;
                let residency = LayerResidency::with_unloaded(
                    font.glyphs()
                        .flat_map(|glyph| glyph.layers().keys().cloned()),
                );
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
                    false,
                ));
            }
            Err(shift_backends::BackendError::StreamingUnsupported { .. }) => {}
            Err(error) => return Err(error.into()),
        }

        let font = loader.read_font(import_path_str)?;
        let mut store = ShiftStore::open(store_path)?;
        store.set_font_info(font_info_from_font(&font))?;
        store.replace_font_state(&font)?;
        store.set_workspace_state(WorkspaceState::imported(import_path, None))?;

        Ok(Self::from_store(
            font,
            WorkspaceSource::Imported {
                original_path: import_path.to_path_buf(),
            },
            store,
            LayerResidency::default(),
            false,
        ))
    }

    /// Explicitly acquires requested glyph payloads. Component closure expands
    /// dependencies from relational indexes before any BLOB is read.
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
                    .flat_map(|glyph| glyph.layers().keys().cloned())
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>();
        self.acquire_layers(layer_ids)
    }

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
    pub fn evict_glyphs(&mut self, glyph_ids: &[GlyphId]) -> Result<(), WorkspaceError> {
        let mut placeholders = Vec::new();
        let mut evicted = Vec::new();
        let mut seen_layer_ids = HashSet::new();
        for glyph_id in glyph_ids {
            let Some(glyph) = self.font.glyph(glyph_id) else {
                continue;
            };
            for layer in glyph.layers().values().map(|layer| layer.as_ref()) {
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
        let directory_layer_count = self.font.glyphs().map(|glyph| glyph.layers().len()).sum();
        self.residency.loaded_count(directory_layer_count)
    }

    pub fn glyph_component_references(
        &self,
    ) -> Result<HashMap<GlyphId, Vec<GlyphId>>, WorkspaceError> {
        self.store.glyph_component_references().map_err(Into::into)
    }

    pub fn referenced_glyph_ids_for_glyph(
        &self,
        glyph_id: &GlyphId,
    ) -> Result<Vec<GlyphId>, WorkspaceError> {
        self.store
            .referenced_glyph_ids_for_glyph(glyph_id)
            .map_err(Into::into)
    }

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

    pub fn font_info(&self) -> Result<Option<shift_store::FontInfo>, WorkspaceError> {
        self.store.get_font_info().map_err(WorkspaceError::from)
    }

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

    pub fn set_workspace_id(&mut self, workspace_id: String) -> Result<(), WorkspaceError> {
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

fn touched_layers(change_set: &FontChangeSet) -> Vec<TouchedLayer> {
    change_set
        .changes
        .iter()
        .flat_map(|change| match change {
            FontChange::Layer {
                layer, structural, ..
            } => layer
                .after
                .iter()
                .map(|layer| TouchedLayer {
                    layer: layer.clone(),
                    structural: *structural,
                })
                .collect(),
            FontChange::Glyph(value) if value.before.is_none() => value
                .after
                .iter()
                .flat_map(|glyph| glyph.layers().values())
                .map(|layer| TouchedLayer {
                    layer: layer.clone(),
                    structural: true,
                })
                .collect(),
            _ => Vec::new(),
        })
        .collect()
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
