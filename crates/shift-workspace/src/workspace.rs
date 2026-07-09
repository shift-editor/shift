use std::{
    io,
    path::{Path, PathBuf},
};

use shift_backends::{FontExportRequest, FontExportResult, FontExporter, font_loader::FontLoader};
use shift_font::{
    AppliedIntents, Axis, AxisId, FontChange, FontChangeSet, FontIntent, FontIntentSet, Glyph,
    GlyphId, GlyphLayer, Source, SourceId, TouchedLayer, error::CoreError,
};
use shift_source::ShiftSourcePackage;
use shift_store::{ShiftStore, SourceIdentitySnapshot, WorkspaceSourceKind, WorkspaceState};

use crate::NewWorkspace;
use crate::ledger::{GlyphIdentity, LayerPair, Ledger, LedgerEntry, LedgerStep};
use crate::source_identity::{
    PackageDraft, PackageIdentity, package_identity, source_identity_snapshot,
    validate_source_identity_for_save,
};

#[derive(Debug, thiserror::Error)]
pub enum WorkspaceError {
    #[error(transparent)]
    Font(#[from] CoreError),

    #[error(transparent)]
    Source(#[from] shift_source::SourcePackageError),

    #[error(transparent)]
    Store(#[from] shift_store::StoreError),

    #[error(transparent)]
    Backend(#[from] shift_backends::BackendError),

    #[error(transparent)]
    Export(#[from] shift_backends::ExportError),

    #[error("workspace needs a save path")]
    NeedsSaveAs,

    #[error("source package is missing: {0}")]
    SourceMissing(PathBuf),

    #[error("source package identity no longer matches: {0}")]
    SourceIdentityConflict(PathBuf),

    #[error("source package was modified outside Shift: {0}")]
    SourceExternallyModified(PathBuf),

    #[error("corrupt working store: {0}")]
    CorruptWorkingStore(String),

    #[error("invalid UTF-8 in workspace path: {0}")]
    InvalidPathUtf8(PathBuf),

    #[error("workspace file-system error: {0}")]
    Io(#[from] io::Error),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum WorkspaceSource {
    Untitled,
    Package { path: PathBuf },
    Imported { original_path: PathBuf },
}

pub struct FontWorkspace {
    font: shift_font::Font,
    source: WorkspaceSource,
    store: ShiftStore,
    ledger: Ledger,
}

impl FontWorkspace {
    pub fn create_untitled(
        store_path: impl AsRef<Path>,
        new_workspace: NewWorkspace,
    ) -> Result<Self, WorkspaceError> {
        let mut store = ShiftStore::open(store_path)?;
        store.set_font_info(new_workspace.font_info())?;

        let font = new_font(new_workspace);
        store.replace_font_state(&font)?;
        store.set_workspace_state(WorkspaceState::untitled(None))?;

        Ok(Self {
            font,
            source: WorkspaceSource::Untitled,
            store,
            ledger: Ledger::default(),
        })
    }

    pub fn create_package(
        source_path: impl AsRef<Path>,
        store_path: impl AsRef<Path>,
        new_workspace: NewWorkspace,
    ) -> Result<Self, WorkspaceError> {
        let mut workspace = Self::create_untitled(store_path, new_workspace)?;
        workspace.save_as(source_path)?;
        Ok(workspace)
    }

    pub fn open(
        source_path: impl AsRef<Path>,
        store_path: impl AsRef<Path>,
    ) -> Result<Self, WorkspaceError> {
        let source_path = source_path.as_ref();
        if ShiftSourcePackage::is_package_path(source_path) {
            Self::open_package(source_path, store_path)
        } else {
            Self::import_font(source_path, store_path)
        }
    }

    pub fn save(&mut self) -> Result<(), WorkspaceError> {
        match self.source.clone() {
            WorkspaceSource::Package { path } => {
                self.validate_save_target(&path)?;
                ShiftSourcePackage::save_font(&path, &self.font)?;
                let identity = source_identity_snapshot(&path)?;
                self.mark_saved_package(identity)?;
                Ok(())
            }
            WorkspaceSource::Untitled | WorkspaceSource::Imported { .. } => {
                Err(WorkspaceError::NeedsSaveAs)
            }
        }
    }

    pub fn save_as(&mut self, source_path: impl AsRef<Path>) -> Result<(), WorkspaceError> {
        let source_package = ShiftSourcePackage::save_font_as(source_path, &self.font)?;
        let identity = source_identity_snapshot(source_package.path())?;
        self.source = WorkspaceSource::Package {
            path: source_package.path().to_path_buf(),
        };
        self.mark_saved_package(identity)?;

        Ok(())
    }

    pub fn resume(store_path: impl AsRef<Path>) -> Result<Self, WorkspaceError> {
        let store = ShiftStore::open(store_path)?;
        let state = store
            .workspace_state()?
            .ok_or_else(|| WorkspaceError::CorruptWorkingStore("missing workspace_state".into()))?;
        let font = store.load_font_state()?;
        let source = source_from_workspace_state(&state)?;

        Ok(Self {
            font,
            source,
            store,
            ledger: Ledger::default(),
        })
    }

    pub fn resume_for_source(
        store_path: impl AsRef<Path>,
        source_path: impl AsRef<Path>,
    ) -> Result<Self, WorkspaceError> {
        let mut workspace = Self::resume(store_path)?;
        let identity = source_identity_snapshot(source_path)?;
        workspace.relink_package_source(identity)?;
        Ok(workspace)
    }

    pub fn inspect_package(
        source_path: impl AsRef<Path>,
    ) -> Result<PackageIdentity, WorkspaceError> {
        package_identity(source_path)
    }

    pub fn inspect_package_draft(
        store_path: impl AsRef<Path>,
    ) -> Result<PackageDraft, WorkspaceError> {
        let store = ShiftStore::open(store_path)?;
        let state = store
            .workspace_state()?
            .ok_or_else(|| WorkspaceError::CorruptWorkingStore("missing workspace_state".into()))?;
        if state.source_kind != WorkspaceSourceKind::Package {
            return Err(WorkspaceError::CorruptWorkingStore(
                "working store is not package-backed".into(),
            ));
        }

        let package_id = state.source_package_id.ok_or_else(|| {
            WorkspaceError::CorruptWorkingStore("package draft missing package ID".into())
        })?;
        let source_path = state.source_path.ok_or_else(|| {
            WorkspaceError::CorruptWorkingStore("package draft missing source path".into())
        })?;
        let base_fingerprint = state.source_fingerprint.ok_or_else(|| {
            WorkspaceError::CorruptWorkingStore("package draft missing base fingerprint".into())
        })?;

        Ok(PackageDraft {
            document_id: state.document_id,
            package_id,
            source_path,
            base_fingerprint,
            dirty: state.dirty,
        })
    }

    pub fn export(&self, request: FontExportRequest) -> Result<FontExportResult, WorkspaceError> {
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
        let mut pre_layers: Vec<PreLayer> = Vec::new();
        let mut pre_sources: Vec<Source> = Vec::new();
        let mut pre_axes: Vec<Axis> = Vec::new();
        let mut pre_axis_locations: Vec<(AxisId, SourceId, f64)> = Vec::new();
        for intent in &set.intents {
            let Some(layer_id) = intent.layer_id() else {
                capture_font_level_pre_state(
                    &self.font,
                    intent,
                    &mut pre_layers,
                    &mut pre_sources,
                    &mut pre_axes,
                    &mut pre_axis_locations,
                );
                continue;
            };
            if pre_layers.iter().any(|pre| pre.layer.id() == *layer_id) {
                continue;
            }
            if let Some(layer) = self.font.layer(layer_id.clone())
                && let Some(glyph_id) = self.font.glyph_id_by_layer(layer_id.clone())
            {
                pre_layers.push(PreLayer {
                    glyph_id,
                    layer: layer.clone(),
                });
            }
        }

        let outcome = self.commit_edit(|font| {
            let outcome = font.apply_intents(set)?;
            let changes = outcome.changes.clone();
            Ok((outcome, changes))
        })?;

        let steps = self.ledger_steps(
            &pre_layers,
            &pre_sources,
            &pre_axes,
            &pre_axis_locations,
            &outcome,
        );
        self.ledger.push(LedgerEntry { label, steps });
        Ok(outcome)
    }

    /// Derives the entry's state-pair steps from the applied change set,
    /// snapshotting post states from the committed font.
    fn ledger_steps(
        &self,
        pre_layers: &[PreLayer],
        pre_sources: &[Source],
        pre_axes: &[Axis],
        pre_axis_locations: &[(AxisId, SourceId, f64)],
        outcome: &AppliedIntents,
    ) -> Vec<LedgerStep> {
        let mut steps = Vec::new();

        let pairs: Vec<LayerPair> = outcome
            .layers
            .iter()
            .filter_map(|touched| {
                let post = touched.layer.clone();
                pre_layers
                    .iter()
                    .find(|pre| pre.layer.id() == post.id())
                    .map(|pre| LayerPair {
                        pre: pre.layer.clone(),
                        post,
                    })
            })
            .collect();
        if !pairs.is_empty() {
            steps.push(LedgerStep::Layers(pairs));
        }

        let mut created_glyphs: Vec<GlyphId> = Vec::new();
        for change in &outcome.changes.changes {
            match change {
                FontChange::GlyphCreated(change) => {
                    created_glyphs.push(change.glyph_id.clone());
                    steps.push(LedgerStep::Glyph {
                        pre: None,
                        post: self.font.glyph(change.glyph_id.clone()).cloned(),
                    });
                }
                FontChange::AxisCreated(change) => steps.push(LedgerStep::Axis {
                    pre: None,
                    post: self
                        .font
                        .axes()
                        .iter()
                        .find(|axis| axis.id() == change.axis_id)
                        .cloned(),
                    pre_locations: Vec::new(),
                }),
                FontChange::AxisDeleted(change) => steps.push(LedgerStep::Axis {
                    pre: pre_axes
                        .iter()
                        .find(|axis| axis.id() == change.axis_id)
                        .cloned(),
                    post: None,
                    pre_locations: pre_axis_locations
                        .iter()
                        .filter(|(axis_id, _, _)| *axis_id == change.axis_id)
                        .map(|(_, source_id, value)| (source_id.clone(), *value))
                        .collect(),
                }),
                FontChange::GlyphIdentityChanged(change) => {
                    steps.push(LedgerStep::GlyphIdentity {
                        glyph_id: change.glyph_id.clone(),
                        pre: GlyphIdentity {
                            name: change.from_name.clone(),
                            unicodes: change.from_unicodes.clone(),
                        },
                        post: GlyphIdentity {
                            name: change.to_name.clone(),
                            unicodes: change.to_unicodes.clone(),
                        },
                    });
                }
                FontChange::SourceCreated(change) => steps.push(LedgerStep::Source {
                    pre: None,
                    post: self
                        .font
                        .sources()
                        .iter()
                        .find(|source| source.id() == change.source_id)
                        .cloned(),
                }),
                FontChange::SourceDeleted(change) => steps.push(LedgerStep::Source {
                    pre: pre_sources
                        .iter()
                        .find(|source| source.id() == change.source_id)
                        .cloned(),
                    post: None,
                }),
                FontChange::GlyphLayerCreated(change) => {
                    // A created glyph's layers ride its Glyph snapshot.
                    if created_glyphs.contains(&change.glyph_id) {
                        continue;
                    }
                    let Some(layer) = self.font.layer(change.layer_id.clone()) else {
                        continue;
                    };
                    steps.push(LedgerStep::GlyphLayer {
                        glyph_id: change.glyph_id.clone(),
                        pre: None,
                        post: Some(Box::new(layer.clone())),
                    });
                }
                FontChange::GlyphLayerDeleted(change) => {
                    if created_glyphs.contains(&change.glyph_id) {
                        continue;
                    }
                    steps.push(LedgerStep::GlyphLayer {
                        glyph_id: change.glyph_id.clone(),
                        pre: pre_layers
                            .iter()
                            .find(|pre| {
                                pre.glyph_id == change.glyph_id && pre.layer.id() == change.layer_id
                            })
                            .map(|pre| Box::new(pre.layer.clone())),
                        post: None,
                    });
                }
                // Every remaining change kind is layer-scoped and already
                // captured by the LayerPair snapshots above. GlyphDeleted
                // has no producing intent yet; replay is its only emitter,
                // and replayed changes never re-enter the ledger.
                FontChange::GlyphDeleted(_)
                | FontChange::LayerMetricsChanged(_)
                | FontChange::ContourAdded(_)
                | FontChange::ContourOpenClosedChanged(_)
                | FontChange::PointsAdded(_)
                | FontChange::PointsDeleted(_)
                | FontChange::PointSmoothChanged(_)
                | FontChange::PointPositionsChanged(_)
                | FontChange::AnchorPositionsChanged(_)
                | FontChange::LayerGeometryReplaced(_) => {}
            }
        }

        steps
    }

    /// Replays the most recent entry's pre states in reverse step order.
    /// `None` when the undo stack is empty. The echo is the same
    /// replace-grade shape as `apply`. A failed replay hands the entry back
    /// so the step stays available for retry.
    pub fn undo(&mut self) -> Result<Option<AppliedIntents>, WorkspaceError> {
        let Some(entry) = self.ledger.pop_undo() else {
            return Ok(None);
        };

        match self.replay(&entry, ReplaySide::Pre) {
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

    /// Replays the most recent undone entry's post states in step order.
    /// A failed replay hands the entry back so the step stays available
    /// for retry.
    pub fn redo(&mut self) -> Result<Option<AppliedIntents>, WorkspaceError> {
        let Some(entry) = self.ledger.pop_redo() else {
            return Ok(None);
        };

        match self.replay(&entry, ReplaySide::Post) {
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

    fn replay(
        &mut self,
        entry: &LedgerEntry,
        side: ReplaySide,
    ) -> Result<AppliedIntents, WorkspaceError> {
        let mut steps = entry.steps.clone();
        if side == ReplaySide::Pre {
            steps.reverse();
        }

        self.commit_edit(move |font| {
            let mut changes = FontChangeSet::default();
            let mut touched: Vec<TouchedLayer> = Vec::new();

            for step in steps {
                match step {
                    LedgerStep::Layers(pairs) => {
                        replay_layer_pairs(font, pairs, side, &mut changes, &mut touched)?;
                    }
                    LedgerStep::Glyph { pre, post } => {
                        let (from, to) = side.orient(pre, post);
                        replay_glyph(font, from, to, &mut changes, &mut touched)?;
                    }
                    LedgerStep::Axis {
                        pre,
                        post,
                        pre_locations,
                    } => {
                        let (from, to) = side.orient(pre, post);
                        replay_axis(font, from, to, &pre_locations, &mut changes)?;
                    }
                    LedgerStep::Source { pre, post } => {
                        let (from, to) = side.orient(pre, post);
                        replay_source(font, from, to, &mut changes)?;
                    }
                    LedgerStep::GlyphLayer {
                        glyph_id,
                        pre,
                        post,
                    } => {
                        let (from, to) = side.orient(pre, post);
                        replay_glyph_layer(
                            font,
                            glyph_id,
                            from.map(|layer| *layer),
                            to.map(|layer| *layer),
                            &mut changes,
                            &mut touched,
                        )?;
                    }
                    LedgerStep::GlyphIdentity {
                        glyph_id,
                        pre,
                        post,
                    } => {
                        let (from, to) = side.orient(pre, post);
                        replay_glyph_identity(font, glyph_id, from, to, &mut changes)?;
                    }
                }
            }

            let outcome = AppliedIntents {
                changes: changes.clone(),
                layers: touched,
            };
            Ok((outcome, changes))
        })
    }

    fn commit_font(
        &mut self,
        next_font: shift_font::Font,
        change_set: FontChangeSet,
    ) -> Result<(), WorkspaceError> {
        self.store.apply_change_set(&change_set)?;
        self.font = next_font;
        Ok(())
    }

    fn commit_edit<R, F>(&mut self, edit: F) -> Result<R, WorkspaceError>
    where
        F: FnOnce(&mut shift_font::Font) -> Result<(R, FontChangeSet), WorkspaceError>,
    {
        let mut next_font = self.font.clone();
        let (result, change_set) = edit(&mut next_font)?;
        self.commit_font(next_font, change_set)?;

        Ok(result)
    }

    fn validate_save_target(&self, path: &Path) -> Result<(), WorkspaceError> {
        if !path.exists() {
            return Err(WorkspaceError::SourceMissing(path.to_path_buf()));
        }

        let current = source_identity_snapshot(path)?;
        let Some(state) = self.store.workspace_state()? else {
            return Ok(());
        };
        if state.source_kind != WorkspaceSourceKind::Package {
            return Ok(());
        }

        validate_source_identity_for_save(&state.source_identity(), &current, path)
    }

    fn mark_saved_package(
        &mut self,
        identity: SourceIdentitySnapshot,
    ) -> Result<(), WorkspaceError> {
        let mut state = self
            .store
            .workspace_state()?
            .unwrap_or_else(|| WorkspaceState::package(identity.clone(), None));
        state.set_package_identity(identity);
        state.dirty = false;
        state.saved_revision = state.revision;
        self.store.set_workspace_state(state)?;
        Ok(())
    }

    fn relink_package_source(
        &mut self,
        identity: SourceIdentitySnapshot,
    ) -> Result<(), WorkspaceError> {
        let path = identity.source_path.clone().ok_or_else(|| {
            WorkspaceError::CorruptWorkingStore("package identity missing source path".into())
        })?;
        let mut state = self
            .store
            .workspace_state()?
            .ok_or_else(|| WorkspaceError::CorruptWorkingStore("missing workspace_state".into()))?;
        state.set_package_identity(identity);

        self.store.set_workspace_state(state)?;
        self.source = WorkspaceSource::Package { path };

        Ok(())
    }

    fn open_package(
        source_path: impl AsRef<Path>,
        store_path: impl AsRef<Path>,
    ) -> Result<Self, WorkspaceError> {
        let source_package = ShiftSourcePackage::open(source_path)?;
        let mut store = ShiftStore::open(store_path)?;
        let font = ShiftSourcePackage::load_font(source_package.path())?;
        store.set_font_info(font_info_from_font(&font))?;
        store.replace_font_state(&font)?;
        let identity = source_identity_snapshot(source_package.path())?;
        store.set_workspace_state(WorkspaceState::package(identity, None))?;

        Ok(Self {
            font,
            source: WorkspaceSource::Package {
                path: source_package.path().to_path_buf(),
            },
            store,
            ledger: Ledger::default(),
        })
    }

    fn import_font(
        import_path: impl AsRef<Path>,
        store_path: impl AsRef<Path>,
    ) -> Result<Self, WorkspaceError> {
        let import_path = import_path.as_ref();
        let import_path_str = import_path
            .to_str()
            .ok_or_else(|| WorkspaceError::InvalidPathUtf8(import_path.to_path_buf()))?;
        let font = FontLoader::new().read_font(import_path_str)?;
        let mut store = ShiftStore::open(store_path)?;
        store.set_font_info(font_info_from_font(&font))?;
        store.replace_font_state(&font)?;
        store.set_workspace_state(WorkspaceState::imported(import_path, None))?;

        Ok(Self {
            font,
            source: WorkspaceSource::Imported {
                original_path: import_path.to_path_buf(),
            },
            store,
            ledger: Ledger::default(),
        })
    }

    pub fn font(&self) -> &shift_font::Font {
        &self.font
    }

    pub fn source(&self) -> &WorkspaceSource {
        &self.source
    }

    pub fn save_target(&self) -> Option<&Path> {
        match &self.source {
            WorkspaceSource::Untitled => None,
            WorkspaceSource::Package { path } => Some(path),
            WorkspaceSource::Imported { .. } => None,
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
        Ok(self
            .store
            .workspace_state()?
            .is_some_and(|state| state.dirty))
    }

    pub fn set_document_id(&mut self, document_id: String) -> Result<(), WorkspaceError> {
        self.store.set_workspace_document_id(document_id)?;
        Ok(())
    }
}

#[derive(Clone)]
struct PreLayer {
    glyph_id: GlyphId,
    layer: GlyphLayer,
}

fn capture_font_level_pre_state(
    font: &shift_font::Font,
    intent: &FontIntent,
    pre_layers: &mut Vec<PreLayer>,
    pre_sources: &mut Vec<Source>,
    pre_axes: &mut Vec<Axis>,
    pre_axis_locations: &mut Vec<(AxisId, SourceId, f64)>,
) {
    match intent {
        FontIntent::DeleteSource { source_id } => {
            if !pre_sources.iter().any(|source| source.id() == *source_id)
                && let Some(source) = font
                    .sources()
                    .iter()
                    .find(|source| source.id() == *source_id)
            {
                pre_sources.push(source.clone());
            }

            for glyph in font.glyphs() {
                let Some(layer) = glyph.layer_for_source(source_id.clone()) else {
                    continue;
                };
                if pre_layers.iter().any(|pre| pre.layer.id() == layer.id()) {
                    continue;
                }
                pre_layers.push(PreLayer {
                    glyph_id: glyph.id(),
                    layer: layer.clone(),
                });
            }
        }
        FontIntent::DeleteAxis { axis_id } => {
            if pre_axes.iter().any(|axis| axis.id() == *axis_id) {
                return;
            }
            let Some(axis) = font.axes().iter().find(|axis| axis.id() == *axis_id) else {
                return;
            };
            pre_axes.push(axis.clone());

            for source in font.sources() {
                if let Some(value) = source.location().get(axis_id) {
                    pre_axis_locations.push((axis_id.clone(), source.id(), value));
                }
            }
        }
        _ => {}
    }
}

/// Which side of every state pair a replay applies: undo restores `Pre`,
/// redo restores `Post`.
#[derive(Clone, Copy, PartialEq, Eq)]
enum ReplaySide {
    Pre,
    Post,
}

impl ReplaySide {
    /// Orients a state pair into (from, to) for this side.
    fn orient<T>(self, pre: T, post: T) -> (T, T) {
        match self {
            Self::Pre => (post, pre),
            Self::Post => (pre, post),
        }
    }
}

fn replay_layer_pairs(
    font: &mut shift_font::Font,
    pairs: Vec<LayerPair>,
    side: ReplaySide,
    changes: &mut FontChangeSet,
    touched: &mut Vec<TouchedLayer>,
) -> Result<(), WorkspaceError> {
    for pair in pairs {
        let replacement = match side {
            ReplaySide::Pre => pair.pre,
            ReplaySide::Post => pair.post,
        };
        let layer_id = replacement.id();
        let layer = font
            .layer_mut(layer_id.clone())
            .ok_or(CoreError::LayerNotFound(layer_id))?;
        *layer = replacement;

        // Geometry replace persists contours only; metrics ride their
        // own change so width/height restores reach SQLite too.
        changes.push(FontChange::layer_geometry_replaced(layer));
        changes.push(FontChange::layer_metrics_changed(layer));
        touched.push(TouchedLayer {
            layer: layer.clone(),
            structural: true,
        });
    }

    Ok(())
}

fn replay_glyph(
    font: &mut shift_font::Font,
    from: Option<Glyph>,
    to: Option<Glyph>,
    changes: &mut FontChangeSet,
    touched: &mut Vec<TouchedLayer>,
) -> Result<(), WorkspaceError> {
    if let Some(glyph) = from {
        font.remove_glyph(glyph.id())
            .ok_or(CoreError::GlyphNotFound(glyph.id()))?;
        changes.push(FontChange::glyph_deleted(glyph.id()));
    }

    if let Some(glyph) = to {
        font.insert_glyph(glyph.clone())?;
        changes.push(FontChange::glyph_created(&glyph));

        for layer in glyph.layers().values() {
            let layer = layer.as_ref().clone();
            changes.push(FontChange::glyph_layer_created(
                glyph.id(),
                Some(glyph.glyph_name().clone()),
                &layer,
            ));
            touched.push(TouchedLayer {
                layer,
                structural: true,
            });
        }
    }

    Ok(())
}

fn replay_axis(
    font: &mut shift_font::Font,
    from: Option<Axis>,
    to: Option<Axis>,
    pre_locations: &[(SourceId, f64)],
    changes: &mut FontChangeSet,
) -> Result<(), WorkspaceError> {
    if let Some(axis) = from {
        font.remove_axis(axis.id())
            .ok_or_else(|| CoreError::AxisNotFound(axis.id()))?;
        changes.push(FontChange::axis_deleted(axis.id()));
    }

    if let Some(axis) = to {
        changes.push(FontChange::axis_created(&axis));
        let axis_id = axis.id();
        font.add_axis(axis);

        // Removing the axis stripped its value from every source's
        // location (and cascaded the rows out of the store), so restoring
        // the axis restores those values too. Sources deleted in the same
        // entry are skipped; their own Source step carries the location.
        for (source_id, value) in pre_locations {
            let Some(source) = font.source_mut(source_id.clone()) else {
                continue;
            };
            let mut location = source.location().clone();
            location.set(axis_id.clone(), *value);
            source.set_location(location);

            let snapshot = source.clone();
            changes.push(FontChange::source_created(&snapshot));
        }
    }

    Ok(())
}

fn replay_glyph_identity(
    font: &mut shift_font::Font,
    glyph_id: GlyphId,
    from: GlyphIdentity,
    to: GlyphIdentity,
    changes: &mut FontChangeSet,
) -> Result<(), WorkspaceError> {
    font.rename_glyph(glyph_id.clone(), to.name.clone())?;
    font.set_glyph_unicodes(glyph_id.clone(), to.unicodes.clone())?;
    changes.push(FontChange::glyph_identity_changed(
        glyph_id,
        from.name,
        to.name,
        from.unicodes,
        to.unicodes,
    ));

    Ok(())
}

fn replay_source(
    font: &mut shift_font::Font,
    from: Option<Source>,
    to: Option<Source>,
    changes: &mut FontChangeSet,
) -> Result<(), WorkspaceError> {
    if let Some(source) = from {
        font.remove_source(source.id())
            .ok_or(CoreError::SourceNotFound(source.id()))?;
        changes.push(FontChange::source_deleted(source.id()));
    }

    if let Some(source) = to {
        changes.push(FontChange::source_created(&source));
        font.add_source(source);
    }

    Ok(())
}

fn replay_glyph_layer(
    font: &mut shift_font::Font,
    glyph_id: GlyphId,
    from: Option<GlyphLayer>,
    to: Option<GlyphLayer>,
    changes: &mut FontChangeSet,
    touched: &mut Vec<TouchedLayer>,
) -> Result<(), WorkspaceError> {
    if let Some(layer) = from {
        font.remove_glyph_layer(layer.id())?;
        changes.push(FontChange::glyph_layer_deleted(glyph_id.clone(), &layer));
    }

    if let Some(layer) = to {
        let glyph_name = font
            .glyph(glyph_id.clone())
            .map(|glyph| glyph.glyph_name().clone());
        changes.push(FontChange::glyph_layer_created(
            glyph_id.clone(),
            glyph_name,
            &layer,
        ));
        font.insert_glyph_layer(glyph_id, layer.clone())?;
        touched.push(TouchedLayer {
            layer,
            structural: true,
        });
    }

    Ok(())
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
        ascender: metrics.ascender,
        descender: metrics.descender,
        cap_height: metrics.cap_height,
        x_height: metrics.x_height,
        line_gap: metrics.line_gap,
        italic_angle: metrics.italic_angle,
        underline_position: metrics.underline_position,
        underline_thickness: metrics.underline_thickness,
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
        WorkspaceSourceKind::Package => {
            let path = state.source_path.clone().ok_or_else(|| {
                WorkspaceError::CorruptWorkingStore("package workspace missing source_path".into())
            })?;
            Ok(WorkspaceSource::Package { path })
        }
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
