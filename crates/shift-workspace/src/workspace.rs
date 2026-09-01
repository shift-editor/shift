use std::{
    collections::{HashMap, HashSet},
    io,
    path::{Path, PathBuf},
    sync::Arc,
    time::Instant,
};

use shift_backends::{
    FontExportRequest, FontExportResult, FontExporter, ImportBatchLimit, font_loader::FontLoader,
};
use shift_font::{
    AppliedIntents, Axis, AxisId, FontChange, FontChangeSet, FontIntent, FontIntentSet,
    FontMetadata, Glyph, GlyphId, GlyphLayer, LayerId, MetricDefinition, NamedInstance, Source,
    SourceId, TouchedLayer, error::CoreError,
};
use shift_store::{
    DocumentMetadata, RecoveryState, ShiftStore, WorkspaceSourceKind, WorkspaceState,
};

use crate::document_identity::{DocumentIdentity, document_identity};
use crate::import_staging::{create_import_staging_path, install_import_store};
use crate::layer_residency::LayerResidency;
use crate::ledger::{GlyphIdentity, LayerPair, Ledger, LedgerEntry, LedgerStep};
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

        let mut pre = FontLevelPreState::default();
        for intent in &set.intents {
            let Some(layer_id) = intent.layer_id() else {
                capture_font_level_pre_state(&self.font, intent, &mut pre);
                continue;
            };
            if pre.layers.iter().any(|pre| pre.layer.id() == *layer_id) {
                continue;
            }
            if let Some(glyph_id) = self.font.glyph_id_by_layer(layer_id.clone())
                && let Some(layer) = self
                    .font
                    .glyph(glyph_id.clone())
                    .and_then(|glyph| glyph.layers().get(layer_id))
                    .cloned()
            {
                pre.layers.push(PreLayer { glyph_id, layer });
            }
        }

        let outcome = self.commit_edit(true, |font| {
            let outcome = font.apply_intents(set)?;
            let changes = outcome.changes.clone();
            Ok((outcome, changes))
        })?;

        let steps = self.ledger_steps(&pre, &outcome);
        self.ledger.push(label, steps);
        Ok(outcome)
    }

    /// Derives the entry's state-pair steps from the applied change set,
    /// snapshotting post states from the committed font.
    fn ledger_steps(&self, pre: &FontLevelPreState, outcome: &AppliedIntents) -> Vec<LedgerStep> {
        let mut steps = Vec::new();

        let pairs: Vec<LayerPair> = outcome
            .layers
            .iter()
            .filter_map(|touched| {
                let post = touched.layer.clone();
                pre.layers
                    .iter()
                    .find(|pre| pre.layer.id() == post.id())
                    .map(|pre| LayerPair {
                        pre: pre.layer.clone(),
                        post,
                        structural: touched.structural,
                    })
            })
            .collect();
        if !pairs.is_empty() {
            steps.push(LedgerStep::Layers(pairs));
        }

        let mut appended_glyphs: Vec<GlyphId> = Vec::new();
        for change in &outcome.changes.changes {
            match change {
                FontChange::GlyphAppended(change) => {
                    appended_glyphs.push(change.glyph_id.clone());
                    let glyph = self
                        .font
                        .glyph(change.glyph_id.clone())
                        .cloned()
                        .expect("an appended glyph must exist in the committed font");
                    steps.push(LedgerStep::GlyphAppend { glyph });
                }
                FontChange::AxisCreated(change) => steps.push(LedgerStep::Axis {
                    pre: None,
                    post: self
                        .font
                        .axes()
                        .iter()
                        .find(|axis| axis.id() == change.axis.id())
                        .cloned(),
                    pre_locations: Vec::new(),
                }),
                FontChange::AxisUpdated(change) => steps.push(LedgerStep::Axis {
                    pre: pre
                        .axes
                        .iter()
                        .find(|axis| axis.id() == change.axis.id())
                        .cloned(),
                    post: Some(change.axis.clone()),
                    pre_locations: Vec::new(),
                }),
                FontChange::AxisDeleted(change) => steps.push(LedgerStep::Axis {
                    pre: pre
                        .axes
                        .iter()
                        .find(|axis| axis.id() == change.axis_id)
                        .cloned(),
                    post: None,
                    pre_locations: pre
                        .axis_locations
                        .iter()
                        .filter(|(axis_id, _, _)| *axis_id == change.axis_id)
                        .map(|(_, source_id, value)| (source_id.clone(), *value))
                        .collect(),
                }),
                FontChange::AxisMappingsUpdated(change) => {
                    steps.push(LedgerStep::AxisMappings {
                        pre: pre.axis_mappings.as_deref().unwrap_or_default().to_vec(),
                        post: change.mappings.clone(),
                    });
                }
                FontChange::MetricDefinitionsUpdated(change) => {
                    steps.push(LedgerStep::MetricDefinitions {
                        pre: pre
                            .metric_definitions
                            .as_deref()
                            .unwrap_or_default()
                            .to_vec(),
                        post: change.definitions.clone(),
                    });
                }
                FontChange::FontMetadataUpdated(_) | FontChange::NamedInstancesUpdated(_) => {}
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
                        .find(|source| source.id() == change.source.id())
                        .cloned(),
                }),
                FontChange::SourceDeleted(change) => steps.push(LedgerStep::Source {
                    pre: pre
                        .sources
                        .iter()
                        .find(|source| source.id() == change.source_id)
                        .cloned(),
                    post: None,
                }),
                FontChange::SourceUpdated(change) => steps.push(LedgerStep::Source {
                    pre: pre
                        .sources
                        .iter()
                        .find(|source| source.id() == change.source.id())
                        .cloned(),
                    post: Some(change.source.clone()),
                }),
                FontChange::GlyphLayerCreated(change) => {
                    // An appended glyph's layers ride its Glyph snapshot.
                    if appended_glyphs.contains(&change.glyph_id) {
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
                    if appended_glyphs.contains(&change.glyph_id) {
                        continue;
                    }
                    steps.push(LedgerStep::GlyphLayer {
                        glyph_id: change.glyph_id.clone(),
                        pre: pre
                            .layers
                            .iter()
                            .find(|pre| {
                                pre.glyph_id == change.glyph_id && pre.layer.id() == change.layer_id
                            })
                            .map(|pre| Box::new(pre.layer.as_ref().clone())),
                        post: None,
                    });
                }
                // Every remaining change kind is layer-scoped and already
                // captured by the LayerPair snapshots above. GlyphPopped is
                // emitted only by replay, which never re-enters the ledger.
                FontChange::GlyphPopped(_)
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

        if let Some(pre_order) = pre.axis_order.as_ref() {
            let post_order = self.font.axes().iter().map(Axis::id).collect::<Vec<_>>();
            if *pre_order != post_order {
                steps.push(LedgerStep::AxisOrder {
                    pre: pre_order.clone(),
                    post: post_order,
                });
            }
        }

        if let Some(pre_order) = pre.source_order.as_ref() {
            let post_order = self
                .font
                .sources()
                .iter()
                .map(Source::id)
                .collect::<Vec<_>>();
            let post_default_source_id = self.font.default_source_id();
            if *pre_order != post_order || pre.default_source_id != post_default_source_id {
                steps.push(LedgerStep::SourceCollection {
                    pre_order: pre_order.clone(),
                    post_order,
                    pre_default_source_id: pre.default_source_id.clone(),
                    post_default_source_id,
                });
            }
        }

        if let Some(instances) = pre.named_instances.as_deref()
            && instances != self.font.named_instances()
        {
            steps.push(LedgerStep::NamedInstances {
                pre: instances.to_vec(),
                post: self.font.named_instances().to_vec(),
            });
        }

        if let Some(metadata) = pre.metadata.as_ref()
            && metadata != self.font.metadata()
        {
            steps.push(LedgerStep::FontMetadata {
                pre: metadata.clone(),
                post: self.font.metadata().clone(),
            });
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

    /// Replays the most recent undone entry's post states in step order.
    /// A failed replay hands the entry back so the step stays available
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

    fn replay(
        &mut self,
        entry: &LedgerEntry,
        side: ReplaySide,
        dirty: bool,
    ) -> Result<AppliedIntents, WorkspaceError> {
        self.acquire_layers(entry.layer_ids())?;

        let mut named_instances = None;
        let mut metric_definitions = None;
        let mut axis_order = None;
        let mut source_collection = None;
        let mut steps = entry
            .steps
            .iter()
            .filter_map(|step| match step {
                LedgerStep::NamedInstances { pre, post } => {
                    named_instances = Some((pre.clone(), post.clone()));
                    None
                }
                LedgerStep::MetricDefinitions { pre, post } => {
                    metric_definitions = Some((pre.clone(), post.clone()));
                    None
                }
                LedgerStep::AxisOrder { pre, post } => {
                    axis_order = Some((pre.clone(), post.clone()));
                    None
                }
                LedgerStep::SourceCollection {
                    pre_order,
                    post_order,
                    pre_default_source_id,
                    post_default_source_id,
                } => {
                    source_collection = Some((
                        pre_order.clone(),
                        post_order.clone(),
                        pre_default_source_id.clone(),
                        post_default_source_id.clone(),
                    ));
                    None
                }
                step => Some(step.clone()),
            })
            .collect::<Vec<_>>();
        if side == ReplaySide::Pre {
            steps.reverse();
        }

        self.commit_edit(dirty, move |font| {
            let mut changes = FontChangeSet::default();
            let mut touched: Vec<TouchedLayer> = Vec::new();

            if let Some((pre, post)) = metric_definitions {
                let (_from, to) = side.orient(pre, post);
                replay_metric_definitions(font, to, &mut changes)?;
            }

            for step in steps {
                match step {
                    LedgerStep::Layers(pairs) => {
                        replay_layer_pairs(font, pairs, side, &mut changes, &mut touched)?;
                    }
                    LedgerStep::GlyphAppend { glyph } => {
                        replay_glyph(font, glyph, side, &mut changes, &mut touched)?;
                    }
                    LedgerStep::FontMetadata { pre, post } => {
                        let (_from, to) = side.orient(pre, post);
                        replay_font_metadata(font, to, &mut changes);
                    }
                    LedgerStep::Axis {
                        pre,
                        post,
                        pre_locations,
                    } => {
                        let (from, to) = side.orient(pre, post);
                        replay_axis(font, from, to, &pre_locations, &mut changes)?;
                    }
                    LedgerStep::AxisMappings { pre, post } => {
                        let (from, to) = side.orient(pre, post);
                        replay_axis_mappings(font, from, to, &mut changes)?;
                    }
                    LedgerStep::AxisOrder { .. } => {
                        unreachable!("axis order replays after axis topology")
                    }
                    LedgerStep::NamedInstances { .. } => {
                        unreachable!("named instances replay after axis topology")
                    }
                    LedgerStep::MetricDefinitions { .. } => {
                        unreachable!("metric definitions replay before sources")
                    }
                    LedgerStep::Source { pre, post } => {
                        let (from, to) = side.orient(pre, post);
                        replay_source(font, from, to, &mut changes)?;
                    }
                    LedgerStep::SourceCollection { .. } => {
                        unreachable!("source collection replays after source topology")
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

            if let Some((pre, post)) = axis_order {
                let (_from, to) = side.orient(pre, post);
                font.set_axis_order(&to)?;
            }

            if let Some((pre_order, post_order, pre_default, post_default)) = source_collection {
                let ((_from_order, _from_default), (to_order, to_default)) =
                    side.orient((pre_order, pre_default), (post_order, post_default));
                font.set_source_order(&to_order)?;
                match to_default {
                    Some(source_id)
                        if font.sources().iter().any(|source| source.id() == source_id) =>
                    {
                        font.set_default_source_id(source_id);
                    }
                    Some(source_id) => {
                        return Err(CoreError::InvalidEntityOrder {
                            kind: "source",
                            message: format!(
                                "default identity {source_id} is absent from the target order"
                            ),
                        }
                        .into());
                    }
                    None if !font.sources().is_empty() => {
                        return Err(CoreError::InvalidEntityOrder {
                            kind: "source",
                            message: "non-empty source order has no default identity".into(),
                        }
                        .into());
                    }
                    None => {}
                }
            }

            if let Some((pre, post)) = named_instances {
                let (_from, to) = side.orient(pre, post);
                replay_named_instances(font, to, &mut changes)?;
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
                    .glyph(glyph_id)
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
            let Some(glyph) = self.font.glyph(glyph_id.clone()) else {
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

#[derive(Clone)]
struct PreLayer {
    glyph_id: GlyphId,
    layer: Arc<GlyphLayer>,
}

#[derive(Default)]
struct FontLevelPreState {
    layers: Vec<PreLayer>,
    metadata: Option<FontMetadata>,
    sources: Vec<Source>,
    source_order: Option<Vec<SourceId>>,
    default_source_id: Option<SourceId>,
    axes: Vec<Axis>,
    axis_order: Option<Vec<AxisId>>,
    axis_mappings: Option<Vec<shift_font::AxisMapping>>,
    metric_definitions: Option<Vec<MetricDefinition>>,
    named_instances: Option<Vec<NamedInstance>>,
    axis_locations: Vec<(AxisId, SourceId, f64)>,
}

fn capture_font_level_pre_state(
    font: &shift_font::Font,
    intent: &FontIntent,
    pre: &mut FontLevelPreState,
) {
    if matches!(intent, FontIntent::UpdateFontMetadata { .. }) && pre.metadata.is_none() {
        pre.metadata = Some(font.metadata().clone());
    }

    if matches!(
        intent,
        FontIntent::CreateAxis { .. }
            | FontIntent::UpdateAxis { .. }
            | FontIntent::DeleteAxis { .. }
            | FontIntent::CreateNamedInstance { .. }
            | FontIntent::UpdateNamedInstance { .. }
            | FontIntent::DeleteNamedInstance { .. }
    ) && pre.named_instances.is_none()
    {
        pre.named_instances = Some(font.named_instances().to_vec());
    }

    if matches!(
        intent,
        FontIntent::CreateSource { .. } | FontIntent::DeleteSource { .. }
    ) && pre.source_order.is_none()
    {
        pre.source_order = Some(font.sources().iter().map(Source::id).collect());
        pre.default_source_id = font.default_source_id();
    }

    if matches!(
        intent,
        FontIntent::CreateAxis { .. } | FontIntent::DeleteAxis { .. }
    ) && pre.axis_order.is_none()
    {
        pre.axis_order = Some(font.axes().iter().map(Axis::id).collect());
    }

    match intent {
        FontIntent::SetMetricDefinitions { .. } => {
            if pre.metric_definitions.is_none() {
                pre.metric_definitions = Some(font.metric_definitions().to_vec());
            }
            for source in font.sources() {
                if !pre
                    .sources
                    .iter()
                    .any(|existing| existing.id() == source.id())
                {
                    pre.sources.push(source.clone());
                }
            }
        }
        FontIntent::UpdateSource { source_id, .. } => {
            if !pre.sources.iter().any(|source| source.id() == *source_id)
                && let Some(source) = font
                    .sources()
                    .iter()
                    .find(|source| source.id() == *source_id)
            {
                pre.sources.push(source.clone());
            }
        }
        FontIntent::DeleteSource { source_id } => {
            if !pre.sources.iter().any(|source| source.id() == *source_id)
                && let Some(source) = font
                    .sources()
                    .iter()
                    .find(|source| source.id() == *source_id)
            {
                pre.sources.push(source.clone());
            }

            for glyph in font.glyphs() {
                let Some(layer) = glyph
                    .layers()
                    .values()
                    .find(|layer| layer.source_id() == *source_id)
                    .cloned()
                else {
                    continue;
                };
                if pre.layers.iter().any(|pre| pre.layer.id() == layer.id()) {
                    continue;
                }
                pre.layers.push(PreLayer {
                    glyph_id: glyph.id(),
                    layer,
                });
            }
        }
        FontIntent::UpdateAxis { axis } => {
            let axis_id = axis.id();
            if pre.axes.iter().any(|axis| axis.id() == axis_id) {
                return;
            }
            let Some(axis) = font.axes().iter().find(|axis| axis.id() == axis_id) else {
                return;
            };
            pre.axes.push(axis.clone());
        }
        FontIntent::DeleteAxis { axis_id } => {
            if pre.axis_mappings.is_none() {
                pre.axis_mappings = Some(font.axis_mappings().to_vec());
            }
            if pre.axes.iter().any(|axis| axis.id() == *axis_id) {
                return;
            }
            let Some(axis) = font.axes().iter().find(|axis| axis.id() == *axis_id) else {
                return;
            };
            pre.axes.push(axis.clone());

            for source in font.sources() {
                if let Some(value) = source.location().get(axis_id) {
                    pre.axis_locations
                        .push((axis_id.clone(), source.id(), value));
                }
            }
        }
        FontIntent::SetAxisMappings { .. } => {
            if pre.axis_mappings.is_none() {
                pre.axis_mappings = Some(font.axis_mappings().to_vec());
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
    let mut replayed = Vec::with_capacity(pairs.len());
    let mut structural_replacements = Vec::with_capacity(pairs.len());
    for pair in pairs {
        let replacement = match side {
            ReplaySide::Pre => pair.pre,
            ReplaySide::Post => pair.post,
        };
        if pair.structural {
            structural_replacements.push(replacement.clone());
        } else {
            font.replace_glyph_layer_values(replacement.id(), &replacement.interpolation_values())?;
        }
        replayed.push((replacement, pair.structural));
    }
    font.replace_glyph_layers(structural_replacements)?;

    for (layer, structural) in replayed {
        // Geometry replace persists contours only; metrics ride their
        // own change so width/height restores reach SQLite too.
        changes.push(FontChange::layer_geometry_replaced(layer.as_ref()));
        changes.push(FontChange::layer_metrics_changed(layer.as_ref()));
        touched.push(TouchedLayer { layer, structural });
    }

    Ok(())
}

fn replay_glyph(
    font: &mut shift_font::Font,
    glyph: Glyph,
    side: ReplaySide,
    changes: &mut FontChangeSet,
    touched: &mut Vec<TouchedLayer>,
) -> Result<(), WorkspaceError> {
    if side == ReplaySide::Pre {
        font.pop_glyph(glyph.id())?;
        changes.push(FontChange::glyph_popped(glyph.id()));
        return Ok(());
    }

    font.insert_glyph(glyph.clone())?;
    changes.push(FontChange::glyph_appended(&glyph));

    for layer in glyph.layers().values() {
        changes.push(FontChange::glyph_layer_created(glyph.id(), layer.as_ref()));
        touched.push(TouchedLayer {
            layer: layer.clone(),
            structural: true,
        });
    }

    Ok(())
}

fn replay_font_metadata(
    font: &mut shift_font::Font,
    metadata: FontMetadata,
    changes: &mut FontChangeSet,
) {
    font.replace_metadata(metadata.clone());
    changes.push(FontChange::font_metadata_updated(&metadata));
}

fn replay_axis(
    font: &mut shift_font::Font,
    from: Option<Axis>,
    to: Option<Axis>,
    pre_locations: &[(SourceId, f64)],
    changes: &mut FontChangeSet,
) -> Result<(), WorkspaceError> {
    let previous_instances = font.named_instances().to_vec();
    if let (Some(from), Some(to)) = (from.as_ref(), to.as_ref())
        && from.id() == to.id()
    {
        font.replace_axis(to.clone())?;
        changes.push(FontChange::axis_updated(to));
        if font.named_instances() != previous_instances {
            changes.push(FontChange::named_instances_updated(font.named_instances()));
        }
        return Ok(());
    }

    if let Some(axis) = from {
        font.remove_axis(axis.id())?;
        changes.push(FontChange::axis_deleted(axis.id()));
    }

    if let Some(axis) = to {
        changes.push(FontChange::axis_created(&axis));
        let axis_id = axis.id();
        font.add_axis(axis)?;

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

    if font.named_instances() != previous_instances {
        changes.push(FontChange::named_instances_updated(font.named_instances()));
    }

    Ok(())
}

fn replay_axis_mappings(
    font: &mut shift_font::Font,
    _from: Vec<shift_font::AxisMapping>,
    to: Vec<shift_font::AxisMapping>,
    changes: &mut FontChangeSet,
) -> Result<(), WorkspaceError> {
    font.set_axis_mappings(to.clone())?;
    changes.push(FontChange::axis_mappings_updated(&to));
    Ok(())
}

fn replay_metric_definitions(
    font: &mut shift_font::Font,
    definitions: Vec<MetricDefinition>,
    changes: &mut FontChangeSet,
) -> Result<(), WorkspaceError> {
    font.set_metric_definitions(definitions.clone())?;
    changes.push(FontChange::metric_definitions_updated(&definitions));
    for source in font.sources() {
        changes.push(FontChange::source_updated(source));
    }
    Ok(())
}

fn replay_named_instances(
    font: &mut shift_font::Font,
    instances: Vec<NamedInstance>,
    changes: &mut FontChangeSet,
) -> Result<(), WorkspaceError> {
    font.set_named_instances(instances.clone())?;
    changes.push(FontChange::named_instances_updated(&instances));
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
    if let (Some(from), Some(to)) = (from.as_ref(), to.as_ref())
        && from.id() == to.id()
    {
        font.replace_source(to.clone())?;
        changes.push(FontChange::source_updated(to));
        return Ok(());
    }

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
        changes.push(FontChange::glyph_layer_created(glyph_id.clone(), &layer));
        font.insert_glyph_layer(glyph_id, layer.clone())?;
        touched.push(TouchedLayer {
            layer: Arc::new(layer),
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
