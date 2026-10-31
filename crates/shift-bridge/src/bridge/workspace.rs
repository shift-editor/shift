//! The open workspace, as the utility process asks for it: opening, saving
//! and closing documents, persisting the window's edits, and reading the
//! font's records.

use pack::{Bytes, Pack};
use shift_font::{
  FontChangeImpact, FontChangeSet, FontIntent, FontIntentSet, Glyph, GlyphId, LayerId,
};
use shift_wire::replacement::FontReplacement;
use shift_wire::{
  Axis, AxisMapping, AxisMappingBasis, FontMetadata, FontMetrics, GlyphChangedEntities,
  GlyphLayerRecord, GlyphLayerSnapshot, GlyphRecord, GlyphRecordChanges, GlyphStructure,
  KerningSnapshot, Ligature, MetricDefinition, NamedInstance, Source,
  SourceMetricsInterpolationSnapshot,
};
use shift_workspace::{
  AcquireScope, DocumentIdentity as StoreDocumentIdentity, FontWorkspace, NewWorkspace,
  WorkspaceError, WorkspaceSource,
};

use super::{Bridge, layer_snapshot, path_to_string};
use crate::errors::{BridgeError, BridgeResult, through_bridge_error};

/// The workspace the utility process has open, and the font in it.
///
/// One workspace is open at a time; every method but [`Self::inspect_document`]
/// and the `open` and `create` methods needs one.
#[pack::interface]
pub(crate) trait NativeWorkspace {
  /// Opens a new untitled workspace over a working store at `store_path`,
  /// closing the font source.
  ///
  /// # Errors
  ///
  /// Fails when the store cannot be created.
  fn create_untitled_workspace(
    &mut self,
    store_path: String,
    options: Option<NewWorkspaceOptions>,
  ) -> Result<(), NativeWorkspaceError>;

  /// Where the open workspace saves, and whether it has unsaved changes.
  ///
  /// # Errors
  ///
  /// Fails when no workspace is open or its store cannot be read.
  fn document_state(&self) -> Result<DocumentState, NativeWorkspaceError>;

  /// The identity of the document at `path`, without opening it.
  ///
  /// # Errors
  ///
  /// Fails when the file is not a Shift document.
  fn inspect_document(&self, path: String) -> Result<DocumentIdentity, NativeWorkspaceError>;

  /// Closes the open workspace, if any.
  fn close_workspace(&mut self);

  /// Opens the Shift document at `path` with its recovery overlay.
  ///
  /// # Errors
  ///
  /// Fails when the document or overlay cannot be opened.
  fn open_document(
    &mut self,
    path: String,
    recovery_path: String,
  ) -> Result<(), NativeWorkspaceError>;

  /// Imports the font file at `path` into a working store at `store_path`.
  ///
  /// # Errors
  ///
  /// Fails when the font cannot be read or the store created.
  fn open_workspace(
    &mut self,
    path: String,
    store_path: String,
  ) -> Result<(), NativeWorkspaceError>;

  /// Reopens the working store at `store_path`, as left by an earlier session.
  ///
  /// # Errors
  ///
  /// Fails when the store cannot be opened.
  fn resume_workspace(&mut self, store_path: String) -> Result<(), NativeWorkspaceError>;

  /// Records which workspace the store belongs to, and returns its state.
  ///
  /// # Errors
  ///
  /// Fails when no workspace is open or the store cannot be written.
  fn set_workspace_id(
    &mut self,
    workspace_id: String,
  ) -> Result<DocumentState, NativeWorkspaceError>;

  /// Saves the open document in place, and returns its state.
  ///
  /// # Errors
  ///
  /// Returns [`NativeWorkspaceError::NeedsSaveAs`] for an untitled or
  /// imported workspace, and fails when the document cannot be written.
  fn save_workspace(&mut self) -> Result<DocumentState, NativeWorkspaceError>;

  /// Saves the workspace as a Shift document at `path`, with its recovery
  /// overlay at `recovery_path`, and returns its state.
  ///
  /// # Errors
  ///
  /// Fails when no workspace is open or the document cannot be written.
  fn save_workspace_as_document(
    &mut self,
    path: String,
    recovery_path: String,
  ) -> Result<DocumentState, NativeWorkspaceError>;

  /// Drops the unsaved changes the recovery overlay holds, and returns the
  /// workspace's state.
  ///
  /// # Errors
  ///
  /// Fails when no workspace is open or the overlay cannot be cleared.
  fn discard_workspace_changes(&mut self) -> Result<DocumentState, NativeWorkspaceError>;

  /// The open font's metadata and its glyph and layer directory, every
  /// layer a placeholder, as named MessagePack: what a window's engine
  /// session opens with.
  ///
  /// # Errors
  ///
  /// Fails when no workspace is open or the directory cannot be encoded.
  fn encoded_directory(&self) -> Result<Bytes, NativeWorkspaceError>;

  /// The font's metadata.
  ///
  /// # Errors
  ///
  /// Fails when no workspace is open.
  fn get_metadata(&self) -> Result<FontMetadata, NativeWorkspaceError>;

  /// The font's metrics.
  ///
  /// # Errors
  ///
  /// Fails when no workspace is open.
  fn get_metrics(&self) -> Result<FontMetrics, NativeWorkspaceError>;

  /// Every glyph's record, sorted by name, each listing only layers on the
  /// font's masters, so every listed layer's source is one
  /// [`Self::get_sources`] returns.
  ///
  /// # Errors
  ///
  /// Fails when no workspace is open or the store cannot be read.
  fn get_glyphs(&self) -> Result<Vec<GlyphRecord>, NativeWorkspaceError>;

  /// Applies `intents` as one atomic edit, one store transaction and one
  /// undo step, and returns what it changed. The editor edits in its window's
  /// engine and persists the change set; this writes a store from intents
  /// directly, as tests and tools that seed one do.
  ///
  /// # Errors
  ///
  /// Fails when an intent names a missing entity, or the edit cannot be
  /// applied or written; the font is then unchanged.
  fn apply(
    &mut self,
    intents: Vec<FontIntent>,
    label: Option<String>,
  ) -> Result<AppliedChange, NativeWorkspaceError>;

  /// Persists a change set, as named MessagePack, that a session over this
  /// font already applied, and returns its echo: the layers it touched, the
  /// font-level and glyph records it changed, and the composites that
  /// depend on them. Nothing is added to this workspace's undo ledger.
  /// `save_state` claims where the change leaves the font; the store
  /// verifies a claim to match the saved document before discarding unsaved
  /// edits.
  ///
  /// # Errors
  ///
  /// Returns [`NativeWorkspaceError::InvalidInput`] when the bytes do not
  /// decode to a change set, and fails when a `before` in it does not match
  /// this font or the write fails; the font is then unchanged.
  fn persist(
    &mut self,
    change_set: Bytes,
    save_state: SaveState,
  ) -> Result<AppliedChange, NativeWorkspaceError>;

  /// Removes every redo entry without changing the font or its dirty state.
  ///
  /// # Errors
  ///
  /// Fails when no workspace is open.
  fn discard_redo(&mut self) -> Result<(), NativeWorkspaceError>;

  /// The authored layers `layer_ids` name, in request order, as accepted
  /// workspace state. Components are not resolved, so a layer with a broken
  /// component reference stays readable.
  ///
  /// # Errors
  ///
  /// Fails when a layer is absent from the font or cannot be loaded.
  fn read_layers(
    &mut self,
    layer_ids: Vec<LayerId>,
  ) -> Result<Vec<GlyphLayerSnapshot>, NativeWorkspaceError>;

  /// Whether the font has axes.
  ///
  /// # Errors
  ///
  /// Fails when no workspace is open.
  fn is_variable(&self) -> Result<bool, NativeWorkspaceError>;

  /// The font's axes, in order.
  ///
  /// # Errors
  ///
  /// Fails when no workspace is open.
  fn get_axes(&self) -> Result<Vec<Axis>, NativeWorkspaceError>;

  /// The font's axis mappings, as authored.
  ///
  /// # Errors
  ///
  /// Fails when no workspace is open.
  fn get_axis_mappings(&self) -> Result<Vec<AxisMapping>, NativeWorkspaceError>;

  /// The variation bases the font's axis mappings compile to.
  ///
  /// # Errors
  ///
  /// Fails when no workspace is open or a mapping cannot be compiled.
  fn get_axis_mapping_bases(&self) -> Result<Vec<AxisMappingBasis>, NativeWorkspaceError>;

  /// The font's metric definitions, in order.
  ///
  /// # Errors
  ///
  /// Fails when no workspace is open.
  fn get_metric_definitions(&self) -> Result<Vec<MetricDefinition>, NativeWorkspaceError>;

  /// The font's tracked Hyperglot language ids in authored order; `None`
  /// when the font stores no list, so the editor applies its own default.
  /// An empty list is an explicit empty list.
  ///
  /// # Errors
  ///
  /// Fails when no workspace is open.
  fn get_language_ids(&self) -> Result<Option<Vec<String>>, NativeWorkspaceError>;

  /// The font's kerning groups, per-source pairs, and the basis kerning
  /// interpolates over.
  ///
  /// # Errors
  ///
  /// Fails when no workspace is open.
  fn get_kerning(&self) -> Result<KerningSnapshot, NativeWorkspaceError>;

  /// The font's named instances, in order.
  ///
  /// # Errors
  ///
  /// Fails when no workspace is open.
  fn get_named_instances(&self) -> Result<Vec<NamedInstance>, NativeWorkspaceError>;

  /// The precomputed source-metric interpolation model; `None` for a font
  /// without one.
  ///
  /// # Errors
  ///
  /// Fails when no workspace is open.
  fn get_source_metrics_interpolation(
    &self,
  ) -> Result<Option<SourceMetricsInterpolationSnapshot>, NativeWorkspaceError>;

  /// The font's master sources, in order.
  ///
  /// # Errors
  ///
  /// Fails when no workspace is open.
  fn get_sources(&self) -> Result<Vec<Source>, NativeWorkspaceError>;
}

/// Why a [`NativeWorkspace`] request failed. Every variant carries the Rust error's
/// text as `detail`, which TypeScript's `PackError` ends its message with.
#[derive(Clone, Debug, PartialEq, Eq, Pack, thiserror::Error)]
pub(crate) enum NativeWorkspaceError {
  /// The request needs an open workspace, and none is open.
  #[error("{detail}")]
  NoWorkspace { detail: String },

  /// The workspace is untitled or imported, so saving needs a path.
  #[error("{detail}")]
  NeedsSaveAs { detail: String },

  /// The request named something malformed or missing: an id, a path, or a
  /// change set that does not decode. `detail` is the error's text.
  #[error("{detail}")]
  InvalidInput { detail: String },

  /// The workspace, its store or the font failed. `detail` is the error's
  /// text: the error itself cannot cross the boundary.
  #[error("{detail}")]
  Failed { detail: String },
}

impl From<BridgeError> for NativeWorkspaceError {
  fn from(error: BridgeError) -> Self {
    let detail = error.to_string();
    match error {
      BridgeError::NoWorkspace => Self::NoWorkspace { detail },
      BridgeError::Workspace(WorkspaceError::NeedsSaveAs) => Self::NeedsSaveAs { detail },
      BridgeError::InvalidInput { .. } | BridgeError::Wire(_) | BridgeError::Decoding(_) => {
        Self::InvalidInput { detail }
      }
      _ => Self::Failed { detail },
    }
  }
}

through_bridge_error!(NativeWorkspaceError);

/// What a new untitled workspace starts with; a field left out keeps the
/// default.
#[derive(Clone, Debug, Default, Pack)]
pub(crate) struct NewWorkspaceOptions {
  pub family_name: Option<String>,
  pub units_per_em: Option<i32>,
}

impl From<NewWorkspaceOptions> for NewWorkspace {
  fn from(options: NewWorkspaceOptions) -> Self {
    let mut workspace = Self::default();
    if let Some(family_name) = options.family_name {
      workspace.family_name = family_name;
    }
    if let Some(units_per_em) = options.units_per_em {
      workspace.units_per_em = i64::from(units_per_em);
    }
    workspace
  }
}

/// Where a workspace's font came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Pack)]
pub(crate) enum SourceKind {
  /// Created in the editor, never saved.
  Untitled,
  /// Opened from, or saved as, a Shift document.
  Document,
  /// Imported from another font format.
  Imported,
}

/// Where the open workspace saves, and whether it has unsaved changes.
#[derive(Clone, Debug, PartialEq, Eq, Pack)]
pub(crate) struct DocumentState {
  pub source_kind: SourceKind,
  pub document_id: Option<String>,
  /// The document a save writes; `None` until the workspace has one.
  pub save_target: Option<String>,
  pub dirty: bool,
  /// Whether saving needs a path: the workspace is untitled or imported.
  pub needs_save_as: bool,
}

/// A Shift document's identity, read without opening it.
#[derive(Clone, Debug, PartialEq, Eq, Pack)]
pub(crate) struct DocumentIdentity {
  pub document_id: String,
  pub canonical_path: String,
}

impl TryFrom<StoreDocumentIdentity> for DocumentIdentity {
  type Error = BridgeError;

  fn try_from(identity: StoreDocumentIdentity) -> BridgeResult<Self> {
    Ok(Self {
      document_id: identity.document_id.to_string(),
      canonical_path: path_to_string(&identity.canonical_path)?,
    })
  }
}

/// Where a persisted change leaves the font, as the session that made it
/// claims.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Pack)]
pub(crate) enum SaveState {
  /// The font now differs from the saved document.
  Unsaved,
  /// The font is back to the saved document, as an undo or redo onto the
  /// saved position leaves it; the store verifies this before trusting it.
  MatchesSaved,
}

impl From<SaveState> for shift_store::SaveState {
  fn from(state: SaveState) -> Self {
    match state {
      SaveState::Unsaved => Self::Unsaved,
      SaveState::MatchesSaved => Self::MatchesSaved,
    }
  }
}

/// Replace-grade state for one layer an edit touched; the window folds it
/// by substitution, never by interpreting changes.
#[derive(Clone, Debug, Pack)]
pub(crate) struct LayerReplaced {
  pub layer_id: LayerId,
  /// Present only when the layer's structure changed.
  pub structure: Option<GlyphStructure>,
  #[pack(numbers)]
  pub values: Vec<f64>,
  pub changed: GlyphChangedEntities,
}

/// What an edit changed, as state rather than change records: each layer it
/// touched, the font-level records it replaced, and the composites that
/// depend on the touched layers.
#[derive(Clone, Debug, Default, Pack)]
pub(crate) struct AppliedChange {
  pub layers: Vec<LayerReplaced>,
  /// Present when the edit replaced any font-level collection.
  pub next: Option<FontReplacement>,
  pub dependents: Vec<GlyphId>,
}

impl NativeWorkspace for Bridge {
  fn create_untitled_workspace(
    &mut self,
    store_path: String,
    options: Option<NewWorkspaceOptions>,
  ) -> Result<(), NativeWorkspaceError> {
    self.workspace = Some(FontWorkspace::create_untitled(
      store_path,
      options.unwrap_or_default().into(),
    )?);
    self.retained_source = None;
    self.reset_versions();
    Ok(())
  }

  fn document_state(&self) -> Result<DocumentState, NativeWorkspaceError> {
    Ok(self.document_state_snapshot()?)
  }

  fn inspect_document(&self, path: String) -> Result<DocumentIdentity, NativeWorkspaceError> {
    Ok(FontWorkspace::inspect_document(path)?.try_into()?)
  }

  fn close_workspace(&mut self) {
    self.workspace = None;
    self.reset_versions();
  }

  fn open_document(
    &mut self,
    path: String,
    recovery_path: String,
  ) -> Result<(), NativeWorkspaceError> {
    self.workspace = Some(FontWorkspace::open_document(path, recovery_path)?);
    self.retained_source = None;
    self.reset_versions();
    Ok(())
  }

  fn open_workspace(
    &mut self,
    path: String,
    store_path: String,
  ) -> Result<(), NativeWorkspaceError> {
    self.workspace = Some(FontWorkspace::open(path, store_path)?);
    self.retained_source = None;
    self.reset_versions();
    Ok(())
  }

  fn resume_workspace(&mut self, store_path: String) -> Result<(), NativeWorkspaceError> {
    self.workspace = Some(FontWorkspace::resume(store_path)?);
    self.retained_source = None;
    self.reset_versions();
    Ok(())
  }

  fn set_workspace_id(
    &mut self,
    workspace_id: String,
  ) -> Result<DocumentState, NativeWorkspaceError> {
    self.workspace_mut()?.set_workspace_id(&workspace_id)?;
    Ok(self.document_state_snapshot()?)
  }

  fn save_workspace(&mut self) -> Result<DocumentState, NativeWorkspaceError> {
    self.workspace_mut()?.save()?;
    self.mark_saved();
    Ok(self.document_state_snapshot()?)
  }

  fn save_workspace_as_document(
    &mut self,
    path: String,
    recovery_path: String,
  ) -> Result<DocumentState, NativeWorkspaceError> {
    self
      .workspace_mut()?
      .save_as_document(path, recovery_path)?;
    self.mark_saved();
    Ok(self.document_state_snapshot()?)
  }

  fn discard_workspace_changes(&mut self) -> Result<DocumentState, NativeWorkspaceError> {
    self.workspace_mut()?.discard_recovery()?;
    self.reset_versions();
    Ok(self.document_state_snapshot()?)
  }

  fn encoded_directory(&self) -> Result<Bytes, NativeWorkspaceError> {
    let directory = self.workspace()?.directory()?;
    Ok(Bytes(rmp_serde::to_vec_named(&directory)?))
  }

  fn get_metadata(&self) -> Result<FontMetadata, NativeWorkspaceError> {
    Ok(FontMetadata::from(self.font()?.metadata()))
  }

  fn get_metrics(&self) -> Result<FontMetrics, NativeWorkspaceError> {
    Ok(FontMetrics::from(self.font()?.metrics()))
  }

  fn get_glyphs(&self) -> Result<Vec<GlyphRecord>, NativeWorkspaceError> {
    let workspace = self.workspace()?;
    let mut component_references = workspace.glyph_component_references()?;
    let glyphs: Vec<&Glyph> = workspace.font().glyphs().collect();
    Ok(self.glyph_records(&glyphs, |glyph_id| {
      Ok(component_references.remove(&glyph_id).unwrap_or_default())
    })?)
  }

  fn apply(
    &mut self,
    intents: Vec<FontIntent>,
    label: Option<String>,
  ) -> Result<AppliedChange, NativeWorkspaceError> {
    if intents.is_empty() {
      return Ok(AppliedChange::default());
    }

    let outcome = self
      .workspace_mut()?
      .apply(&FontIntentSet { intents }, label)?;
    self.mark_font_changed();

    Ok(self.applied_echo(outcome)?)
  }

  fn persist(
    &mut self,
    change_set: Bytes,
    save_state: SaveState,
  ) -> Result<AppliedChange, NativeWorkspaceError> {
    let change_set: shift_font::CompactChangeSet = rmp_serde::from_slice(&change_set.0)?;
    let outcome = self
      .workspace_mut()?
      .persist_compact_change_set(change_set, save_state.into())?;
    self.mark_font_changed();
    Ok(self.applied_echo(outcome)?)
  }

  fn discard_redo(&mut self) -> Result<(), NativeWorkspaceError> {
    self.workspace_mut()?.discard_redo();
    Ok(())
  }

  fn read_layers(
    &mut self,
    layer_ids: Vec<LayerId>,
  ) -> Result<Vec<GlyphLayerSnapshot>, NativeWorkspaceError> {
    let glyph_ids = self.layer_owners(&layer_ids)?;
    let font = self.acquire_and_font(&glyph_ids, AcquireScope::Glyphs)?;

    layer_ids
      .iter()
      .zip(glyph_ids)
      .map(|(layer_id, glyph_id)| Ok(layer_snapshot(glyph_id, font.require_layer(*layer_id)?)))
      .collect()
  }

  fn is_variable(&self) -> Result<bool, NativeWorkspaceError> {
    Ok(self.font()?.is_variable())
  }

  fn get_axes(&self) -> Result<Vec<Axis>, NativeWorkspaceError> {
    Ok(self.font()?.axes().iter().map(Axis::from).collect())
  }

  fn get_axis_mappings(&self) -> Result<Vec<AxisMapping>, NativeWorkspaceError> {
    Ok(
      self
        .font()?
        .axis_mappings()
        .iter()
        .map(AxisMapping::from)
        .collect(),
    )
  }

  fn get_axis_mapping_bases(&self) -> Result<Vec<AxisMappingBasis>, NativeWorkspaceError> {
    Ok(
      self
        .font()?
        .axis_mapping_bases()?
        .iter()
        .map(AxisMappingBasis::from)
        .collect(),
    )
  }

  fn get_metric_definitions(&self) -> Result<Vec<MetricDefinition>, NativeWorkspaceError> {
    Ok(
      self
        .font()?
        .metric_definitions()
        .iter()
        .map(MetricDefinition::from)
        .collect(),
    )
  }

  fn get_language_ids(&self) -> Result<Option<Vec<String>>, NativeWorkspaceError> {
    Ok(self.font()?.language_ids())
  }

  fn get_kerning(&self) -> Result<KerningSnapshot, NativeWorkspaceError> {
    Ok(KerningSnapshot::from(self.font()?))
  }

  fn get_named_instances(&self) -> Result<Vec<NamedInstance>, NativeWorkspaceError> {
    Ok(
      self
        .font()?
        .named_instances()
        .iter()
        .map(NamedInstance::from)
        .collect(),
    )
  }

  fn get_source_metrics_interpolation(
    &self,
  ) -> Result<Option<SourceMetricsInterpolationSnapshot>, NativeWorkspaceError> {
    Ok(
      self
        .font()?
        .source_metric_interpolation()
        .as_ref()
        .map(SourceMetricsInterpolationSnapshot::from),
    )
  }

  fn get_sources(&self) -> Result<Vec<Source>, NativeWorkspaceError> {
    Ok(Source::masters_of(self.font()?))
  }
}

impl Bridge {
  /// The workspace's save state, as [`NativeWorkspace::document_state`]
  /// returns it after each storage call.
  fn document_state_snapshot(&self) -> BridgeResult<DocumentState> {
    let workspace = self.workspace()?;
    let source_kind = match workspace.source() {
      WorkspaceSource::Untitled => SourceKind::Untitled,
      WorkspaceSource::Document { .. } => SourceKind::Document,
      WorkspaceSource::Imported { .. } => SourceKind::Imported,
    };
    let document_id = workspace
      .document_metadata()?
      .map(|metadata| metadata.document_id.to_string());
    let save_target = workspace.save_target().map(path_to_string).transpose()?;

    Ok(DocumentState {
      source_kind,
      document_id,
      save_target,
      dirty: workspace.is_dirty()?,
      needs_save_as: source_kind != SourceKind::Document,
    })
  }

  /// Each of `layer_ids`' owning glyph, in request order.
  pub(super) fn layer_owners(&self, layer_ids: &[LayerId]) -> BridgeResult<Vec<GlyphId>> {
    let font = self.font()?;
    layer_ids
      .iter()
      .map(|layer_id| Ok(font.require_layer_owner(*layer_id)?))
      .collect()
  }

  /// The records of the glyphs `changes` changed, as they are now, and the
  /// glyphs it removed: what a reply to the edit carries instead of every
  /// record, which on a 65K-glyph font took 128 ms to build.
  fn glyph_record_changes(&self, changes: &FontChangeSet) -> BridgeResult<GlyphRecordChanges> {
    let workspace = self.workspace()?;
    let font = workspace.font();
    let mut glyphs = Vec::new();
    let mut removed = Vec::new();
    for glyph_id in changes.record_glyph_ids() {
      match font.glyph(glyph_id) {
        Some(glyph) => glyphs.push(glyph),
        None => removed.push(glyph_id),
      }
    }

    let updated = self.glyph_records(&glyphs, |glyph_id| {
      Ok(workspace.referenced_glyph_ids_for_glyph(glyph_id)?)
    })?;
    Ok(GlyphRecordChanges { updated, removed })
  }

  /// The records of `glyphs` sorted by name, each listing only layers on
  /// [`shift_font::Font::masters`] and the component bases
  /// `component_bases` reads for it.
  fn glyph_records(
    &self,
    glyphs: &[&Glyph],
    mut component_bases: impl FnMut(GlyphId) -> BridgeResult<Vec<GlyphId>>,
  ) -> BridgeResult<Vec<GlyphRecord>> {
    let font = self.font()?;
    let categories = shift_backends::record_categories(glyphs.iter().copied(), font.lib());
    let mut records = glyphs
      .iter()
      .map(|glyph| {
        let mut record = GlyphRecord::from(*glyph);
        if let Some(category) = categories.get(&glyph.id()) {
          record.mark = category.mark;
          record.nonspacing_mark = category.nonspacing_mark;
          record.ligature = category.ligature.map(|ligature| match ligature {
            shift_backends::PropagationLigature::Explicit => Ligature::Explicit,
            shift_backends::PropagationLigature::Subcategory => Ligature::Subcategory,
          });
        }
        record.component_base_glyph_ids = component_bases(glyph.id())?;
        record.layers = font
          .master_layers(glyph)
          .map(|layer| GlyphLayerRecord::from(layer.as_ref()))
          .collect();
        Ok(record)
      })
      .collect::<BridgeResult<Vec<_>>>()?;
    records.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(records)
  }

  /// The pure-state echo of an applied outcome: replace-grade layers, the
  /// font-level collections the change set touched, whole, with the records
  /// of only the glyphs it changed, and the dependent composites. Shared by
  /// apply, undo, redo and persist.
  fn applied_echo(&self, outcome: shift_font::AppliedIntents) -> BridgeResult<AppliedChange> {
    let impact = outcome.changes.impact();
    let glyphs_changed = impact.contains(FontChangeImpact::GLYPHS);

    let touched_layer_ids: Vec<LayerId> = outcome
      .layers
      .iter()
      .map(|touched| touched.layer.id())
      .collect();
    let dependents = self
      .workspace()?
      .dependent_glyph_ids_for_layers(&touched_layer_ids)?;

    let layers = outcome
      .layers
      .into_iter()
      .map(|touched| LayerReplaced {
        layer_id: touched.layer.id(),
        structure: touched
          .structural
          .then(|| GlyphStructure::from(touched.layer.as_ref())),
        values: shift_wire::values_from_layer(touched.layer.as_ref()),
        changed: GlyphChangedEntities::default(),
      })
      .collect();

    let next = FontReplacement::changed_by(self.font()?, impact)?
      .map(|mut replacement| -> BridgeResult<FontReplacement> {
        replacement.glyph_changes = glyphs_changed
          .then(|| self.glyph_record_changes(&outcome.changes))
          .transpose()?;
        Ok(replacement)
      })
      .transpose()?;

    Ok(AppliedChange {
      layers,
      next,
      dependents,
    })
  }
}
