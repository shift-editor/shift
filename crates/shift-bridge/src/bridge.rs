use crate::errors::{self, BridgeError, BridgeResult};
use crate::input::{parse, BridgeParse};
use napi::bindgen_prelude::*;
use napi::{Error, Status};
use napi_derive::napi;
use shift_backends::{ExportFormat, FontExportRequest, FontExportResult, FontExporter, FontView};
use shift_font::{
  AnchorId, AnchorSeed, Axis as FontAxis, AxisId, AxisLabel, AxisLabelRange,
  AxisMapping as FontAxisMapping, AxisMappingId, AxisMappingPoint as FontAxisMappingPoint,
  AxisRole, BooleanOp, ContourId, Font, FontChange, FontIntent, FontIntentSet, Glyph, GlyphId,
  LayerId, Location as FontLocation, PointId, PointSeed, SourceId,
};
use shift_wire::{
  bridges::napi::{
    NapiAnchorSeed, NapiAppliedChange, NapiAxis, NapiAxisMapping, NapiAxisRole, NapiAxisType,
    NapiFontIntent, NapiFontMetadata, NapiFontMetrics, NapiGlyphRecord, NapiGlyphSnapshot,
    NapiGlyphSnapshotRequest, NapiLayerReplaced, NapiLocation, NapiPointSeed, NapiSource,
  },
  interpolation::{build_glyph_variation_data, build_masters, GlyphVariationBuild},
  Axis, AxisMapping, FontMetadata, FontMetrics, GlyphChangedEntities, GlyphLayerSnapshot,
  GlyphRecord, GlyphSnapshot, GlyphSnapshotRequest, GlyphState, GlyphStructure, Source,
};
use shift_workspace::{
  FontWorkspace, NewWorkspace, PackageDraft, PackageIdentity, WorkspaceError, WorkspaceSource,
};
use std::{path::Path, sync::Arc};

#[napi(object)]
#[derive(Clone, Debug)]
pub struct NapiFontExportRequest {
  pub path: String,
  pub format: String,
}

#[napi(object)]
pub struct NapiFontExportResult {
  pub path: String,
  pub format: String,
}

#[napi(object)]
pub struct NapiNewWorkspace {
  pub family_name: Option<String>,
  pub units_per_em: Option<i64>,
}

#[napi(object)]
#[derive(Debug)]
pub struct NapiDocumentState {
  pub source_kind: String,
  pub save_target: Option<String>,
  pub dirty: bool,
  pub needs_save_as: bool,
}

#[napi(object)]
pub struct NapiPackageIdentity {
  pub package_id: String,
  pub canonical_path: String,
  pub fingerprint: String,
}

#[napi(object)]
pub struct NapiPackageDraft {
  pub document_id: Option<String>,
  pub package_id: String,
  pub source_path: String,
  pub base_fingerprint: String,
  pub dirty: bool,
}

fn new_workspace_from_options(options: Option<NapiNewWorkspace>) -> NewWorkspace {
  let Some(options) = options else {
    return NewWorkspace::default();
  };

  let mut new_workspace = NewWorkspace::default();
  if let Some(family_name) = options.family_name {
    new_workspace.family_name = family_name;
  }
  if let Some(units_per_em) = options.units_per_em {
    new_workspace.units_per_em = units_per_em;
  }

  new_workspace
}

impl TryFrom<NapiFontExportRequest> for FontExportRequest {
  type Error = Error;

  fn try_from(request: NapiFontExportRequest) -> Result<Self> {
    let format = ExportFormat::try_from(request.format.as_str())
      .map_err(|e| Error::new(Status::InvalidArg, e.to_string()))?;

    Ok(Self {
      path: request.path.into(),
      format,
    })
  }
}

impl From<FontExportResult> for NapiFontExportResult {
  fn from(result: FontExportResult) -> Self {
    Self {
      path: result.path.to_string_lossy().into_owned(),
      format: result.format.as_str().to_string(),
    }
  }
}

impl TryFrom<PackageIdentity> for NapiPackageIdentity {
  type Error = BridgeError;

  fn try_from(identity: PackageIdentity) -> BridgeResult<Self> {
    Ok(Self {
      package_id: identity.package_id,
      canonical_path: path_to_string(&identity.canonical_path)?,
      fingerprint: identity.fingerprint,
    })
  }
}

impl TryFrom<PackageDraft> for NapiPackageDraft {
  type Error = BridgeError;

  fn try_from(draft: PackageDraft) -> BridgeResult<Self> {
    Ok(Self {
      document_id: draft.document_id,
      package_id: draft.package_id,
      source_path: path_to_string(&draft.source_path)?,
      base_fingerprint: draft.base_fingerprint,
      dirty: draft.dirty,
    })
  }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord)]
pub struct DocumentVersion(u64);

impl DocumentVersion {
  fn next(self) -> Self {
    Self(self.0 + 1)
  }
}

#[derive(Clone)]
pub struct FontSaveSnapshot {
  font: Font,
  active_glyph_override: Option<Arc<Glyph>>,
}

impl FontSaveSnapshot {
  fn new(font: Font, active_glyph_override: Option<Glyph>) -> Self {
    Self {
      font,
      active_glyph_override: active_glyph_override.map(Arc::new),
    }
  }
}

impl FontView for FontSaveSnapshot {
  fn metadata(&self) -> &shift_font::FontMetadata {
    self.font.metadata()
  }

  fn metrics(&self) -> &shift_font::FontMetrics {
    self.font.metrics()
  }

  fn axes(&self) -> &[shift_font::Axis] {
    self.font.axes()
  }

  fn sources(&self) -> &[shift_font::Source] {
    self.font.sources()
  }

  fn default_source_id(&self) -> Option<SourceId> {
    self.font.default_source_id()
  }

  fn glyphs(&self) -> Vec<&Glyph> {
    let override_name = self
      .active_glyph_override
      .as_ref()
      .map(|glyph| glyph.name().to_string());
    let mut glyphs = Vec::new();

    if let Some(active_glyph) = self.active_glyph_override.as_ref() {
      glyphs.push(active_glyph.as_ref());
    }

    glyphs.extend(
      self
        .font
        .glyphs()
        .filter(|glyph| override_name.as_deref() != Some(glyph.name())),
    );

    glyphs
  }

  fn glyph(&self, name: &str) -> Option<&Glyph> {
    if let Some(active_glyph) = self.active_glyph_override.as_ref() {
      if active_glyph.name() == name {
        return Some(active_glyph.as_ref());
      }
    }

    self.font.glyph_by_name(name)
  }

  fn kerning(&self) -> &shift_font::KerningData {
    self.font.kerning()
  }

  fn features(&self) -> &shift_font::FeatureData {
    self.font.features()
  }

  fn guidelines(&self) -> &[shift_font::Guideline] {
    self.font.guidelines()
  }

  fn lib(&self) -> &shift_font::LibData {
    self.font.lib()
  }

  fn fontinfo_remainder(&self) -> &shift_font::LibData {
    self.font.fontinfo_remainder()
  }

  fn data_files(&self) -> &shift_font::BinaryData {
    self.font.data_files()
  }

  fn images(&self) -> &shift_font::BinaryData {
    self.font.images()
  }
}

pub struct ExportFontTask {
  snapshot: FontSaveSnapshot,
  request: FontExportRequest,
}

impl Task for ExportFontTask {
  type Output = FontExportResult;
  type JsValue = NapiFontExportResult;

  fn compute(&mut self) -> Result<Self::Output> {
    FontExporter::new()
      .export(&self.snapshot, self.request.clone())
      .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))
  }

  fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
    Ok(output.into())
  }
}

#[napi]
pub struct Bridge {
  workspace: Option<FontWorkspace>,
  live_version: DocumentVersion,
  saved_version: DocumentVersion,
}

#[napi]
impl Bridge {
  #[napi(constructor)]
  pub fn new() -> Self {
    Self {
      workspace: None,
      live_version: DocumentVersion::default(),
      saved_version: DocumentVersion::default(),
    }
  }

  #[napi]
  pub fn create_untitled_workspace(
    &mut self,
    store_path: String,
    options: Option<NapiNewWorkspace>,
  ) -> errors::Result<()> {
    self.workspace = Some(FontWorkspace::create_untitled(
      store_path,
      new_workspace_from_options(options),
    )?);
    self.reset_versions();
    Ok(())
  }

  #[napi(ts_return_type = "Promise<NapiFontExportResult>")]
  pub fn export_workspace(
    &mut self,
    request: NapiFontExportRequest,
  ) -> Result<AsyncTask<ExportFontTask>> {
    Ok(AsyncTask::new(ExportFontTask {
      snapshot: self
        .save_snapshot()
        .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?,
      request: request.try_into()?,
    }))
  }

  #[napi]
  pub fn document_state(&self) -> errors::Result<NapiDocumentState> {
    self.document_state_snapshot()
  }

  #[napi]
  pub fn inspect_package(&self, path: String) -> errors::Result<NapiPackageIdentity> {
    FontWorkspace::inspect_package(path)?.try_into()
  }

  #[napi]
  pub fn inspect_package_draft(&self, store_path: String) -> errors::Result<NapiPackageDraft> {
    FontWorkspace::inspect_package_draft(store_path)?.try_into()
  }

  #[napi]
  pub fn close_workspace(&mut self) {
    self.workspace = None;
    self.reset_versions();
  }

  #[napi]
  pub fn open_workspace(&mut self, path: String, store_path: String) -> errors::Result<()> {
    self.workspace = Some(FontWorkspace::open(path, store_path)?);
    self.reset_versions();
    Ok(())
  }

  #[napi]
  pub fn resume_workspace_for_source(
    &mut self,
    store_path: String,
    source_path: String,
  ) -> errors::Result<()> {
    self.workspace = Some(FontWorkspace::resume_for_source(store_path, source_path)?);
    self.reset_versions();
    Ok(())
  }

  #[napi]
  pub fn set_document_id(&mut self, document_id: String) -> errors::Result<NapiDocumentState> {
    self.workspace_mut()?.set_document_id(document_id)?;
    self.document_state_snapshot()
  }

  #[napi]
  pub fn save_workspace(&mut self) -> errors::Result<NapiDocumentState> {
    self.workspace_mut()?.save()?;
    self.mark_saved();
    self.document_state_snapshot()
  }

  #[napi]
  pub fn save_workspace_as(&mut self, path: String) -> errors::Result<NapiDocumentState> {
    self.workspace_mut()?.save_as(path)?;
    self.mark_saved();
    self.document_state_snapshot()
  }

  #[napi]
  pub fn get_metadata(&self) -> errors::Result<NapiFontMetadata> {
    Ok(FontMetadata::from(self.font()?.metadata()).into())
  }

  #[napi]
  pub fn get_metrics(&self) -> errors::Result<NapiFontMetrics> {
    Ok(FontMetrics::from(self.font()?.metrics()).into())
  }

  #[napi]
  pub fn get_glyphs(&self) -> errors::Result<Vec<NapiGlyphRecord>> {
    let mut records: Vec<_> = self
      .font()?
      .glyphs()
      .map(GlyphRecord::from)
      .map(Into::into)
      .collect();
    records.sort_by(|a: &NapiGlyphRecord, b: &NapiGlyphRecord| a.name.cmp(&b.name));
    Ok(records)
  }

  /// Applies one intent set as a single atomic workspace apply: every kind
  /// — editing and create alike — decodes through `map_intent` into one
  /// `FontWorkspace::apply` call. One call = one SQLite transaction = one
  /// undo step, however many intents the set batches.
  #[napi]
  pub fn apply(
    &mut self,
    intents: Vec<NapiFontIntent>,
    label: Option<String>,
  ) -> errors::Result<NapiAppliedChange> {
    if intents.is_empty() {
      return Ok(NapiAppliedChange {
        layers: Vec::new(),
        glyphs: None,
        axes: None,
        axis_mappings: None,
        sources: None,
        dependents: Vec::new(),
      });
    }

    let mut set = FontIntentSet::default();
    for intent in intents {
      set.intents.push(map_intent(intent)?);
    }

    let outcome = self.workspace_mut()?.apply(set, label)?;
    self.mark_font_changed();

    self.applied_echo(outcome)
  }

  /// Assembles the pure-state echo for an applied outcome: replace-grade
  /// layers plus dependent composites. Shared by apply/undo/redo. The
  /// records grain (glyphs/axes/sources lists) rides along whenever the
  /// change set touched that structure.
  fn applied_echo(&self, outcome: shift_font::AppliedIntents) -> errors::Result<NapiAppliedChange> {
    let mut glyphs_changed = false;
    let mut axes_changed = false;
    let mut axis_mappings_changed = false;
    let mut sources_changed = false;
    for change in &outcome.changes.changes {
      match change {
        FontChange::GlyphCreated(_)
        | FontChange::GlyphDeleted(_)
        | FontChange::GlyphIdentityChanged(_)
        | FontChange::GlyphLayerCreated(_)
        | FontChange::GlyphLayerDeleted(_) => glyphs_changed = true,
        // Axis structure reshapes every source location's design space.
        FontChange::AxisCreated(_) | FontChange::AxisUpdated(_) | FontChange::AxisDeleted(_) => {
          axes_changed = true;
          sources_changed = true;
        }
        FontChange::AxisMappingsUpdated(_) => axis_mappings_changed = true,
        FontChange::SourceCreated(_) | FontChange::SourceDeleted(_) => sources_changed = true,
        _ => {}
      }
    }

    let touched_layer_ids: Vec<LayerId> = outcome
      .layers
      .iter()
      .map(|touched| touched.layer.id())
      .collect();
    let dependents = self
      .font()?
      .dependents_of_layers(&touched_layer_ids)
      .into_iter()
      .map(|name| name.to_string())
      .collect();

    let layers = outcome
      .layers
      .into_iter()
      .map(|touched| NapiLayerReplaced {
        layer_id: touched.layer.id().to_string(),
        structure: touched
          .structural
          .then(|| GlyphStructure::from(&touched.layer).into()),
        values: shift_wire::values_from_layer(&touched.layer).into(),
        changed: GlyphChangedEntities::default().into(),
      })
      .collect();

    Ok(NapiAppliedChange {
      layers,
      glyphs: glyphs_changed.then(|| self.get_glyphs()).transpose()?,
      axes: axes_changed.then(|| self.get_axes()).transpose()?,
      axis_mappings: axis_mappings_changed
        .then(|| self.get_axis_mappings())
        .transpose()?,
      sources: sources_changed.then(|| self.get_sources()).transpose()?,
      dependents,
    })
  }

  /// Replays the most recent ledger entry's pre states; `null` when the
  /// undo stack is empty.
  #[napi]
  pub fn undo(&mut self) -> errors::Result<Option<NapiAppliedChange>> {
    let Some(outcome) = self.workspace_mut()?.undo()? else {
      return Ok(None);
    };

    self.mark_font_changed();
    Ok(Some(self.applied_echo(outcome)?))
  }

  /// Replays the most recent undone entry's post states; `null` when the
  /// redo stack is empty.
  #[napi]
  pub fn redo(&mut self) -> errors::Result<Option<NapiAppliedChange>> {
    let Some(outcome) = self.workspace_mut()?.redo()? else {
      return Ok(None);
    };

    self.mark_font_changed();
    Ok(Some(self.applied_echo(outcome)?))
  }

  /// Glyph-addressed snapshots for renderer-local synchronous font state.
  #[napi]
  pub fn get_glyph_snapshots(
    &self,
    requests: Vec<NapiGlyphSnapshotRequest>,
  ) -> errors::Result<Vec<NapiGlyphSnapshot>> {
    let font = self.font()?;
    let mut snapshots = Vec::new();

    for request in requests {
      let request = GlyphSnapshotRequest::from(request);
      let glyph_id = request.glyph_id;
      let Some(glyph) = font.glyph(glyph_id.clone()) else {
        continue;
      };

      let variation_data = self
        .variation_build_for_glyph(glyph)?
        .and_then(|(_, build)| build.variation_data);

      let layers = glyph
        .layers()
        .values()
        .map(|layer| layer.as_ref())
        .map(|layer| GlyphLayerSnapshot {
          glyph_id: glyph_id.clone(),
          source_id: layer.source_id(),
          state: GlyphState::from_layer(layer),
        })
        .collect();

      snapshots.push(GlyphSnapshot {
        glyph_id,
        variation_data,
        layers,
      });
    }

    Ok(snapshots.into_iter().map(Into::into).collect())
  }

  #[napi]
  pub fn is_variable(&self) -> errors::Result<bool> {
    Ok(self.font()?.is_variable())
  }

  #[napi]
  pub fn get_axes(&self) -> errors::Result<Vec<NapiAxis>> {
    Ok(
      self
        .font()?
        .axes()
        .iter()
        .map(Axis::from)
        .map(Into::into)
        .collect(),
    )
  }

  #[napi]
  pub fn get_axis_mappings(&self) -> errors::Result<Vec<NapiAxisMapping>> {
    Ok(
      self
        .font()?
        .axis_mappings()
        .iter()
        .map(AxisMapping::from)
        .map(Into::into)
        .collect(),
    )
  }

  #[napi]
  pub fn map_location(&self, location: NapiLocation) -> errors::Result<NapiLocation> {
    let external = map_location(location)?;
    let mapped = self.font()?.mapped_location(&external)?;
    Ok(shift_wire::Location::from(&mapped).into())
  }

  #[napi]
  pub fn get_sources(&self) -> errors::Result<Vec<NapiSource>> {
    Ok(
      self
        .font()?
        .sources()
        .iter()
        .map(Source::from)
        .map(Into::into)
        .collect(),
    )
  }

  fn save_snapshot(&self) -> BridgeResult<FontSaveSnapshot> {
    Ok(FontSaveSnapshot::new(self.font()?.clone(), None))
  }

  fn variation_build_for_glyph(
    &self,
    glyph: &Glyph,
  ) -> BridgeResult<Option<(usize, GlyphVariationBuild)>> {
    let font = self.font()?;

    Ok(build_masters(font, glyph).map(|masters| {
      let master_count = masters.len();
      let build = build_glyph_variation_data(&masters, font.axes());
      (master_count, build)
    }))
  }

  fn workspace(&self) -> BridgeResult<&FontWorkspace> {
    self
      .workspace
      .as_ref()
      .ok_or_else(|| BridgeError::InvalidInput {
        kind: "workspace",
        value: "no workspace is open".to_string(),
      })
  }

  fn workspace_mut(&mut self) -> BridgeResult<&mut FontWorkspace> {
    self
      .workspace
      .as_mut()
      .ok_or_else(|| BridgeError::InvalidInput {
        kind: "workspace",
        value: "no workspace is open".to_string(),
      })
  }

  fn font(&self) -> BridgeResult<&Font> {
    Ok(self.workspace()?.font())
  }

  fn document_state_snapshot(&self) -> BridgeResult<NapiDocumentState> {
    let workspace = self.workspace()?;
    let source_kind = match workspace.source() {
      WorkspaceSource::Untitled => "untitled",
      WorkspaceSource::Package { .. } => "package",
      WorkspaceSource::Imported { .. } => "imported",
    };
    let save_target = workspace.save_target().map(path_to_string).transpose()?;
    let needs_save_as = !matches!(workspace.source(), WorkspaceSource::Package { .. });

    Ok(NapiDocumentState {
      source_kind: source_kind.to_string(),
      save_target,
      dirty: workspace.is_dirty()?,
      needs_save_as,
    })
  }

  fn mark_font_changed(&mut self) {
    self.bump_live_version();
  }

  fn mark_saved(&mut self) {
    self.saved_version = self.live_version;
  }

  fn bump_live_version(&mut self) {
    self.live_version = self.live_version.next();
  }

  fn reset_versions(&mut self) {
    self.live_version = DocumentVersion::default();
    self.saved_version = DocumentVersion::default();
  }
}

fn path_to_string(path: &Path) -> BridgeResult<String> {
  path
    .to_str()
    .map(str::to_string)
    .ok_or_else(|| WorkspaceError::InvalidPathUtf8(path.to_path_buf()).into())
}

fn parse_id_list<T: BridgeParse>(ids: &[String]) -> BridgeResult<Vec<T>> {
  ids.iter().map(|id| parse::<T>(id)).collect()
}

fn map_intent(intent: NapiFontIntent) -> errors::Result<FontIntent> {
  let missing = |kind: &str| BridgeError::InvalidInput {
    kind: "intent",
    value: format!("{kind} requires its payload field"),
  };

  match intent.kind.as_str() {
    "addPoints" => {
      let payload = intent.add_points.ok_or_else(|| missing("addPoints"))?;
      Ok(FontIntent::AddPoints {
        layer_id: parse::<LayerId>(&payload.layer_id)?,
        contour_id: payload
          .contour_id
          .map(|id| parse::<ContourId>(&id))
          .transpose()?,
        before: payload.before.map(|id| parse::<PointId>(&id)).transpose()?,
        points: payload
          .points
          .into_iter()
          .map(map_point_seed)
          .collect::<errors::Result<Vec<_>>>()?,
      })
    }
    "addContour" => {
      let payload = intent.add_contour.ok_or_else(|| missing("addContour"))?;
      Ok(FontIntent::AddContour {
        layer_id: parse::<LayerId>(&payload.layer_id)?,
        contour_id: parse::<ContourId>(&payload.contour_id)?,
        closed: payload.closed,
      })
    }
    "setContourClosed" => {
      let payload = intent
        .set_contour_closed
        .ok_or_else(|| missing("setContourClosed"))?;
      Ok(FontIntent::SetContourClosed {
        layer_id: parse::<LayerId>(&payload.layer_id)?,
        contour_id: parse::<ContourId>(&payload.contour_id)?,
        closed: payload.closed,
      })
    }
    "movePoints" => {
      let payload = intent.move_points.ok_or_else(|| missing("movePoints"))?;
      Ok(FontIntent::MovePoints {
        layer_id: parse::<LayerId>(&payload.layer_id)?,
        point_ids: parse_id_list::<PointId>(&payload.point_ids)?,
        coords: payload.coords,
      })
    }
    "setPointSmooth" => {
      let payload = intent
        .set_point_smooth
        .ok_or_else(|| missing("setPointSmooth"))?;
      Ok(FontIntent::SetPointSmooth {
        layer_id: parse::<LayerId>(&payload.layer_id)?,
        point_id: parse::<PointId>(&payload.point_id)?,
        smooth: payload.smooth,
      })
    }
    "removePoints" => {
      let payload = intent
        .remove_points
        .ok_or_else(|| missing("removePoints"))?;
      Ok(FontIntent::RemovePoints {
        layer_id: parse::<LayerId>(&payload.layer_id)?,
        point_ids: parse_id_list::<PointId>(&payload.point_ids)?,
      })
    }
    "addAnchors" => {
      let payload = intent.add_anchors.ok_or_else(|| missing("addAnchors"))?;
      Ok(FontIntent::AddAnchors {
        layer_id: parse::<LayerId>(&payload.layer_id)?,
        anchors: payload
          .anchors
          .into_iter()
          .map(map_anchor_seed)
          .collect::<errors::Result<Vec<_>>>()?,
      })
    }
    "moveAnchors" => {
      let payload = intent.move_anchors.ok_or_else(|| missing("moveAnchors"))?;
      Ok(FontIntent::MoveAnchors {
        layer_id: parse::<LayerId>(&payload.layer_id)?,
        anchor_ids: parse_id_list::<AnchorId>(&payload.anchor_ids)?,
        coords: payload.coords,
      })
    }
    "removeAnchors" => {
      let payload = intent
        .remove_anchors
        .ok_or_else(|| missing("removeAnchors"))?;
      Ok(FontIntent::RemoveAnchors {
        layer_id: parse::<LayerId>(&payload.layer_id)?,
        anchor_ids: parse_id_list::<AnchorId>(&payload.anchor_ids)?,
      })
    }
    "reverseContour" => {
      let payload = intent
        .reverse_contour
        .ok_or_else(|| missing("reverseContour"))?;
      Ok(FontIntent::ReverseContour {
        layer_id: parse::<LayerId>(&payload.layer_id)?,
        contour_id: parse::<ContourId>(&payload.contour_id)?,
      })
    }
    "translatePoints" => {
      let payload = intent
        .translate_points
        .ok_or_else(|| missing("translatePoints"))?;
      Ok(FontIntent::TranslatePoints {
        layer_id: parse::<LayerId>(&payload.layer_id)?,
        point_ids: parse_id_list::<PointId>(&payload.point_ids)?,
        dx: payload.dx,
        dy: payload.dy,
      })
    }
    "setXAdvance" => {
      let payload = intent.set_x_advance.ok_or_else(|| missing("setXAdvance"))?;
      Ok(FontIntent::SetXAdvance {
        layer_id: parse::<LayerId>(&payload.layer_id)?,
        width: payload.width,
      })
    }
    "applyBooleanOp" => {
      let payload = intent
        .apply_boolean_op
        .ok_or_else(|| missing("applyBooleanOp"))?;
      Ok(FontIntent::ApplyBooleanOp {
        layer_id: parse::<LayerId>(&payload.layer_id)?,
        contour_id_a: parse::<ContourId>(&payload.contour_id_a)?,
        contour_id_b: parse::<ContourId>(&payload.contour_id_b)?,
        operation: parse_boolean_op(&payload.operation)?,
      })
    }
    "createGlyph" => {
      let payload = intent.create_glyph.ok_or_else(|| missing("createGlyph"))?;
      Ok(FontIntent::CreateGlyph {
        glyph_id: Some(parse::<GlyphId>(&payload.glyph_id)?),
        name: payload.name,
        unicodes: payload.unicodes,
      })
    }
    "updateGlyph" => {
      let payload = intent.update_glyph.ok_or_else(|| missing("updateGlyph"))?;
      Ok(FontIntent::UpdateGlyph {
        glyph_id: parse::<GlyphId>(&payload.glyph_id)?,
        new_name: payload.new_name.into(),
        new_unicodes: payload.new_unicodes,
      })
    }
    "createAxis" => {
      let payload = intent.create_axis.ok_or_else(|| missing("createAxis"))?;
      Ok(FontIntent::CreateAxis {
        axis: map_axis(payload.axis)?,
      })
    }
    "updateAxis" => {
      let payload = intent.update_axis.ok_or_else(|| missing("updateAxis"))?;
      Ok(FontIntent::UpdateAxis {
        axis: map_axis(payload.axis)?,
      })
    }
    "deleteAxis" => {
      let payload = intent.delete_axis.ok_or_else(|| missing("deleteAxis"))?;
      Ok(FontIntent::DeleteAxis {
        axis_id: parse::<AxisId>(&payload.axis_id)?,
      })
    }
    "setAxisMappings" => {
      let payload = intent
        .set_axis_mappings
        .ok_or_else(|| missing("setAxisMappings"))?;
      Ok(FontIntent::SetAxisMappings {
        mappings: payload
          .mappings
          .into_iter()
          .map(map_axis_mapping)
          .collect::<errors::Result<Vec<_>>>()?,
      })
    }
    "deleteSource" => {
      let payload = intent
        .delete_source
        .ok_or_else(|| missing("deleteSource"))?;
      Ok(FontIntent::DeleteSource {
        source_id: parse::<SourceId>(&payload.source_id)?,
      })
    }
    "createSource" => {
      let payload = intent
        .create_source
        .ok_or_else(|| missing("createSource"))?;
      Ok(FontIntent::CreateSource {
        source_id: parse::<SourceId>(&payload.source_id)?,
        name: payload.name,
        location: map_location(payload.location)?,
      })
    }
    "createGlyphLayer" => {
      let payload = intent
        .create_glyph_layer
        .ok_or_else(|| missing("createGlyphLayer"))?;
      Ok(FontIntent::CreateGlyphLayer {
        layer_id: parse::<LayerId>(&payload.layer_id)?,
        glyph_id: parse::<GlyphId>(&payload.glyph_id)?,
        source_id: parse::<SourceId>(&payload.source_id)?,
      })
    }
    "cloneGlyphLayer" => {
      let payload = intent
        .clone_glyph_layer
        .ok_or_else(|| missing("cloneGlyphLayer"))?;
      Ok(FontIntent::CloneGlyphLayer {
        layer_id: parse::<LayerId>(&payload.layer_id)?,
        glyph_id: parse::<GlyphId>(&payload.glyph_id)?,
        source_id: parse::<SourceId>(&payload.source_id)?,
        from_layer_id: parse::<LayerId>(&payload.from_layer_id)?,
      })
    }
    other => Err(BridgeError::InvalidInput {
      kind: "intent",
      value: format!("unknown intent kind \"{other}\""),
    }),
  }
}

fn parse_boolean_op(operation: &str) -> errors::Result<BooleanOp> {
  match operation {
    "union" => Ok(BooleanOp::Union),
    "subtract" => Ok(BooleanOp::Subtract),
    "intersect" => Ok(BooleanOp::Intersect),
    "difference" => Ok(BooleanOp::Difference),
    other => Err(BridgeError::InvalidInput {
      kind: "intent",
      value: format!("unknown boolean operation \"{other}\""),
    }),
  }
}

fn map_point_seed(seed: NapiPointSeed) -> errors::Result<PointSeed> {
  Ok(PointSeed {
    id: parse::<PointId>(&seed.id)?,
    x: seed.x,
    y: seed.y,
    point_type: seed.point_type.into(),
    smooth: seed.smooth,
  })
}

fn map_anchor_seed(seed: NapiAnchorSeed) -> errors::Result<AnchorSeed> {
  Ok(AnchorSeed {
    id: parse::<AnchorId>(&seed.id)?,
    name: seed.name,
    x: seed.x,
    y: seed.y,
  })
}

fn map_location(location: NapiLocation) -> errors::Result<FontLocation> {
  let values = location
    .values
    .into_iter()
    .map(|(axis_id, value)| Ok((parse::<AxisId>(&axis_id)?, value)))
    .collect::<errors::Result<_>>()?;
  Ok(FontLocation::from_map(values))
}

fn map_axis(axis: NapiAxis) -> errors::Result<FontAxis> {
  let axis_id = parse::<AxisId>(&axis.id)?;
  let mut mapped = match axis.axis_type {
    NapiAxisType::Continuous => FontAxis::continuous_with_id(
      axis_id,
      axis.tag,
      axis.name,
      axis.minimum.ok_or_else(|| BridgeError::InvalidInput {
        kind: "continuous axis minimum",
        value: "missing".to_string(),
      })?,
      axis.default,
      axis.maximum.ok_or_else(|| BridgeError::InvalidInput {
        kind: "continuous axis maximum",
        value: "missing".to_string(),
      })?,
    ),
    NapiAxisType::Discrete => FontAxis::discrete_with_id(
      axis_id,
      axis.tag,
      axis.name,
      axis.values.ok_or_else(|| BridgeError::InvalidInput {
        kind: "discrete axis values",
        value: "missing".to_string(),
      })?,
      axis.default,
    ),
  };
  mapped.set_role(match axis.role {
    NapiAxisRole::External => AxisRole::External,
    NapiAxisRole::Internal => AxisRole::Internal,
  });
  let mut labels = Vec::new();
  for label in axis.labels {
    let range = match (label.minimum, label.maximum) {
      (None, None) => None,
      (Some(minimum), Some(maximum)) => Some(AxisLabelRange { minimum, maximum }),
      _ => {
        return Err(BridgeError::InvalidInput {
          kind: "axis label range",
          value: "minimum and maximum must be provided together".to_string(),
        })
      }
    };
    labels.push(AxisLabel {
      name: label.name,
      value: label.value,
      range,
      linked_value: label.linked_value,
      elidable: label.elidable,
    });
  }
  mapped.set_labels(labels);
  mapped.set_hidden(axis.hidden);
  mapped.validate()?;
  Ok(mapped)
}

fn map_axis_mapping(mapping: NapiAxisMapping) -> errors::Result<FontAxisMapping> {
  let mut mapped = FontAxisMapping::with_id(
    parse::<AxisMappingId>(&mapping.id)?,
    mapping.name,
    mapping
      .inputs
      .iter()
      .map(|id| parse::<AxisId>(id))
      .collect::<errors::Result<Vec<_>>>()?,
    mapping
      .outputs
      .iter()
      .map(|id| parse::<AxisId>(id))
      .collect::<errors::Result<Vec<_>>>()?,
    mapping
      .points
      .into_iter()
      .map(|point| {
        Ok(FontAxisMappingPoint {
          description: point.description,
          input: map_location(point.input)?,
          output: map_location(point.output)?,
        })
      })
      .collect::<errors::Result<Vec<_>>>()?,
  );
  mapped.set_description(mapping.description);
  Ok(mapped)
}

#[cfg(test)]
mod tests {
  use super::*;
  use shift_wire::bridges::napi::{
    NapiAddAnchorsIntent, NapiAddContourIntent, NapiAddPointsIntent, NapiAxis, NapiAxisRole,
    NapiAxisType, NapiCloneGlyphLayerIntent, NapiCreateAxisIntent, NapiCreateGlyphIntent,
    NapiCreateGlyphLayerIntent, NapiCreateSourceIntent, NapiDeleteAxisIntent,
    NapiDeleteSourceIntent, NapiGlyphSnapshotRequest, NapiGlyphState, NapiLocation,
    NapiMoveAnchorsIntent, NapiMovePointsIntent, NapiPointSeed, NapiPointType,
    NapiRemoveAnchorsIntent, NapiRemovePointsIntent, NapiReverseContourIntent,
    NapiSetContourClosedIntent, NapiSetPointSmoothIntent, NapiSetXAdvanceIntent,
    NapiTranslatePointsIntent,
  };
  use std::sync::atomic::{AtomicUsize, Ordering};

  static TEST_ID: AtomicUsize = AtomicUsize::new(0);

  fn skeleton_intent(kind: &str) -> NapiFontIntent {
    NapiFontIntent {
      kind: kind.to_string(),
      add_points: None,
      add_contour: None,
      set_contour_closed: None,
      move_points: None,
      set_point_smooth: None,
      remove_points: None,
      add_anchors: None,
      move_anchors: None,
      remove_anchors: None,
      reverse_contour: None,
      translate_points: None,
      set_x_advance: None,
      apply_boolean_op: None,
      create_glyph: None,
      update_glyph: None,
      create_axis: None,
      update_axis: None,
      delete_axis: None,
      set_axis_mappings: None,
      create_source: None,
      delete_source: None,
      create_glyph_layer: None,
      clone_glyph_layer: None,
    }
  }

  fn create_glyph_napi(name: &str, unicodes: Vec<u32>) -> NapiFontIntent {
    NapiFontIntent {
      create_glyph: Some(NapiCreateGlyphIntent {
        glyph_id: GlyphId::new().to_string(),
        name: name.to_string(),
        unicodes,
      }),
      ..skeleton_intent("createGlyph")
    }
  }

  fn create_glyph_napi_with_id(glyph_id: &str, name: &str, unicodes: Vec<u32>) -> NapiFontIntent {
    NapiFontIntent {
      create_glyph: Some(NapiCreateGlyphIntent {
        glyph_id: glyph_id.to_string(),
        name: name.to_string(),
        unicodes,
      }),
      ..skeleton_intent("createGlyph")
    }
  }

  fn create_glyph_layer_intent(layer_id: &str, glyph_id: &str, source_id: &str) -> NapiFontIntent {
    NapiFontIntent {
      create_glyph_layer: Some(NapiCreateGlyphLayerIntent {
        layer_id: layer_id.to_string(),
        glyph_id: glyph_id.to_string(),
        source_id: source_id.to_string(),
      }),
      ..skeleton_intent("createGlyphLayer")
    }
  }

  fn clone_glyph_layer_intent(
    layer_id: &str,
    glyph_id: &str,
    source_id: &str,
    from_layer_id: &str,
  ) -> NapiFontIntent {
    NapiFontIntent {
      clone_glyph_layer: Some(NapiCloneGlyphLayerIntent {
        layer_id: layer_id.to_string(),
        glyph_id: glyph_id.to_string(),
        source_id: source_id.to_string(),
        from_layer_id: from_layer_id.to_string(),
      }),
      ..skeleton_intent("cloneGlyphLayer")
    }
  }

  #[test]
  fn apply_create_glyph_returns_identity_record_without_layers() {
    let mut bridge = bridge_with_workspace();

    let applied = bridge
      .apply(
        vec![create_glyph_napi("A", vec![65])],
        Some("Add Glyph".to_string()),
      )
      .unwrap();

    let glyphs = applied.glyphs.expect("createGlyph must echo records");
    assert_eq!(glyphs.len(), 1);
    assert_eq!(glyphs[0].name, "A");
    assert!(glyphs[0].layers.is_empty());
    assert!(applied.layers.is_empty());
  }

  #[test]
  fn apply_create_glyph_layer_returns_record_membership_and_replace_grade_layer() {
    let mut bridge = bridge_with_workspace();
    let glyph_id = GlyphId::new().to_string();
    let layer_id = LayerId::new().to_string();
    let source_id = default_source_id(&bridge);

    let applied = bridge
      .apply(
        vec![
          create_glyph_napi_with_id(&glyph_id, "A", vec![65]),
          create_glyph_layer_intent(&layer_id, &glyph_id, &source_id),
        ],
        Some("Add Glyph".to_string()),
      )
      .unwrap();

    let glyphs = applied.glyphs.expect("createGlyphLayer must echo records");
    assert_eq!(glyphs[0].layers.len(), 1);
    assert_eq!(glyphs[0].layers[0].id, layer_id);
    assert_eq!(glyphs[0].layers[0].source_id, source_id);
    assert_eq!(applied.layers.len(), 1);
    assert_eq!(applied.layers[0].layer_id, layer_id);
    assert!(applied.layers[0].structure.is_some());
  }

  #[test]
  fn apply_set_x_advance_echoes_values_without_structure() {
    let mut bridge = bridge_with_workspace();
    let layer_id = create_default_glyph_layer(&mut bridge, "A", Some(65));

    let applied = bridge
      .apply(
        vec![NapiFontIntent {
          set_x_advance: Some(NapiSetXAdvanceIntent {
            layer_id: layer_id.clone(),
            width: 642.0,
          }),
          ..skeleton_intent("setXAdvance")
        }],
        None,
      )
      .unwrap();

    assert!(applied.glyphs.is_none());
    assert_eq!(applied.layers[0].layer_id, layer_id);
    assert!(applied.layers[0].structure.is_none());
    // canonical values layout: x advance is slot 0
    assert_eq!(applied.layers[0].values[0], 642.0);
  }

  #[test]
  fn apply_rejects_unknown_intent_kinds() {
    let mut bridge = bridge_with_workspace();

    assert!(bridge
      .apply(vec![skeleton_intent("explodeFont")], None)
      .is_err());
  }

  fn pen_setup(bridge: &mut Bridge) -> (String, String) {
    let glyph_id = GlyphId::new().to_string();
    let layer_id = LayerId::new().to_string();
    let source_id = default_source_id(bridge);
    let created = bridge
      .apply(
        vec![
          create_glyph_napi_with_id(&glyph_id, "A", vec![65]),
          create_glyph_layer_intent(&layer_id, &glyph_id, &source_id),
        ],
        None,
      )
      .unwrap();
    assert_eq!(created.layers[0].layer_id, layer_id);

    let contour_id = shift_font::ContourId::new().to_string();
    bridge
      .apply(
        vec![NapiFontIntent {
          add_contour: Some(NapiAddContourIntent {
            layer_id: layer_id.clone(),
            contour_id: contour_id.clone(),
            closed: false,
          }),
          ..skeleton_intent("addContour")
        }],
        None,
      )
      .unwrap();

    (layer_id, contour_id)
  }

  fn seed(id: &str, x: f64, y: f64) -> NapiPointSeed {
    NapiPointSeed {
      id: id.to_string(),
      x,
      y,
      point_type: NapiPointType::OnCurve,
      smooth: false,
    }
  }

  fn add_points_intent(
    layer_id: &str,
    contour_id: &str,
    before: Option<String>,
    points: Vec<NapiPointSeed>,
  ) -> NapiFontIntent {
    NapiFontIntent {
      add_points: Some(NapiAddPointsIntent {
        layer_id: layer_id.to_string(),
        contour_id: Some(contour_id.to_string()),
        before,
        points,
      }),
      ..skeleton_intent("addPoints")
    }
  }

  #[test]
  fn apply_pen_intents_honors_client_minted_ids_and_one_atomic_echo() {
    let mut bridge = bridge_with_workspace();
    let (layer_id, contour_id) = pen_setup(&mut bridge);
    let p1 = shift_font::PointId::new().to_string();
    let p2 = shift_font::PointId::new().to_string();

    let applied = bridge
      .apply(
        vec![add_points_intent(
          &layer_id,
          &contour_id,
          None,
          vec![seed(&p1, 10.0, 20.0), seed(&p2, 30.0, 40.0)],
        )],
        Some("Add Points".to_string()),
      )
      .unwrap();

    assert_eq!(applied.layers.len(), 1);
    let structure = applied.layers[0].structure.as_ref().unwrap();
    let ids: Vec<&str> = structure.contours[0]
      .points
      .iter()
      .map(|p| p.id.as_str())
      .collect();
    assert_eq!(ids, vec![p1.as_str(), p2.as_str()]);
    // canonical values: [xAdvance, x0, y0, x1, y1]
    assert_eq!(applied.layers[0].values[1], 10.0);
    assert_eq!(applied.layers[0].values[4], 40.0);
  }

  #[test]
  fn apply_pen_intents_inserts_before_the_anchor_point() {
    let mut bridge = bridge_with_workspace();
    let (layer_id, contour_id) = pen_setup(&mut bridge);
    let p1 = shift_font::PointId::new().to_string();
    let p2 = shift_font::PointId::new().to_string();
    let mid = shift_font::PointId::new().to_string();

    bridge
      .apply(
        vec![add_points_intent(
          &layer_id,
          &contour_id,
          None,
          vec![seed(&p1, 0.0, 0.0), seed(&p2, 100.0, 0.0)],
        )],
        None,
      )
      .unwrap();

    let applied = bridge
      .apply(
        vec![add_points_intent(
          &layer_id,
          &contour_id,
          Some(p2.clone()),
          vec![seed(&mid, 50.0, 0.0)],
        )],
        None,
      )
      .unwrap();

    let structure = applied.layers[0].structure.as_ref().unwrap();
    let ids: Vec<&str> = structure.contours[0]
      .points
      .iter()
      .map(|p| p.id.as_str())
      .collect();
    assert_eq!(ids, vec![p1.as_str(), mid.as_str(), p2.as_str()]);
  }

  #[test]
  fn apply_pen_intents_moves_points_and_sets_smooth_and_closes() {
    let mut bridge = bridge_with_workspace();
    let (layer_id, contour_id) = pen_setup(&mut bridge);
    let p1 = shift_font::PointId::new().to_string();

    bridge
      .apply(
        vec![add_points_intent(
          &layer_id,
          &contour_id,
          None,
          vec![seed(&p1, 0.0, 0.0)],
        )],
        None,
      )
      .unwrap();

    let applied = bridge
      .apply(
        vec![
          NapiFontIntent {
            move_points: Some(NapiMovePointsIntent {
              layer_id: layer_id.clone(),
              point_ids: vec![p1.clone()],
              coords: vec![77.0, 88.0],
            }),
            ..skeleton_intent("movePoints")
          },
          NapiFontIntent {
            set_point_smooth: Some(NapiSetPointSmoothIntent {
              layer_id: layer_id.clone(),
              point_id: p1.clone(),
              smooth: true,
            }),
            ..skeleton_intent("setPointSmooth")
          },
          NapiFontIntent {
            set_contour_closed: Some(NapiSetContourClosedIntent {
              layer_id: layer_id.clone(),
              contour_id: contour_id.clone(),
              closed: true,
            }),
            ..skeleton_intent("setContourClosed")
          },
        ],
        Some("Close Contour".to_string()),
      )
      .unwrap();

    // one atomic apply → one echo, structural because smooth/closed changed
    assert_eq!(applied.layers.len(), 1);
    let structure = applied.layers[0].structure.as_ref().unwrap();
    assert!(structure.contours[0].closed);
    assert!(structure.contours[0].points[0].smooth);
    assert_eq!(applied.layers[0].values[1], 77.0);
    assert_eq!(applied.layers[0].values[2], 88.0);
  }

  #[test]
  fn apply_pen_intents_rejects_duplicate_ids_atomically() {
    let mut bridge = bridge_with_workspace();
    let (layer_id, contour_id) = pen_setup(&mut bridge);
    let p1 = shift_font::PointId::new().to_string();

    bridge
      .apply(
        vec![add_points_intent(
          &layer_id,
          &contour_id,
          None,
          vec![seed(&p1, 0.0, 0.0)],
        )],
        None,
      )
      .unwrap();

    // second set: one valid point THEN a duplicate — whole set must reject
    let fresh = shift_font::PointId::new().to_string();
    let result = bridge.apply(
      vec![add_points_intent(
        &layer_id,
        &contour_id,
        None,
        vec![seed(&fresh, 1.0, 1.0), seed(&p1, 2.0, 2.0)],
      )],
      None,
    );
    assert!(result.is_err());

    // atomicity: the valid point from the rejected set must NOT exist
    let state = glyph_state(&bridge, "A");
    assert_eq!(state.structure.contours[0].points.len(), 1);
  }

  fn anchor_seed(id: &str, name: Option<&str>, x: f64, y: f64) -> NapiAnchorSeed {
    NapiAnchorSeed {
      id: id.to_string(),
      name: name.map(str::to_owned),
      x,
      y,
    }
  }

  fn add_anchors_intent(layer_id: &str, anchors: Vec<NapiAnchorSeed>) -> NapiFontIntent {
    NapiFontIntent {
      add_anchors: Some(NapiAddAnchorsIntent {
        layer_id: layer_id.to_string(),
        anchors,
      }),
      ..skeleton_intent("addAnchors")
    }
  }

  #[test]
  fn apply_add_anchors_echoes_structure_and_values_with_minted_ids() {
    let mut bridge = bridge_with_workspace();
    let (layer_id, _) = pen_setup(&mut bridge);
    let a1 = shift_font::AnchorId::new().to_string();
    let a2 = shift_font::AnchorId::new().to_string();

    let applied = bridge
      .apply(
        vec![add_anchors_intent(
          &layer_id,
          vec![
            anchor_seed(&a1, Some("top"), 250.0, 700.0),
            anchor_seed(&a2, None, 250.0, -10.0),
          ],
        )],
        Some("Add Anchors".to_string()),
      )
      .unwrap();

    assert_eq!(applied.layers.len(), 1);
    let structure = applied.layers[0].structure.as_ref().unwrap();
    let ids: Vec<&str> = structure.anchors.iter().map(|a| a.id.as_str()).collect();
    assert_eq!(ids, vec![a1.as_str(), a2.as_str()]);
    assert_eq!(structure.anchors[0].name.as_deref(), Some("top"));
    assert_eq!(structure.anchors[1].name, None);
    // canonical values: [xAdvance, point coords…, anchor coords…]; the
    // contour is empty, so anchors start at slot 1
    assert_eq!(
      &applied.layers[0].values[1..],
      &[250.0, 700.0, 250.0, -10.0]
    );
  }

  #[test]
  fn apply_move_anchors_echoes_values_without_structure() {
    let mut bridge = bridge_with_workspace();
    let (layer_id, _) = pen_setup(&mut bridge);
    let a1 = shift_font::AnchorId::new().to_string();

    bridge
      .apply(
        vec![add_anchors_intent(
          &layer_id,
          vec![anchor_seed(&a1, Some("top"), 250.0, 700.0)],
        )],
        None,
      )
      .unwrap();

    let applied = bridge
      .apply(
        vec![NapiFontIntent {
          move_anchors: Some(NapiMoveAnchorsIntent {
            layer_id: layer_id.clone(),
            anchor_ids: vec![a1.clone()],
            coords: vec![300.0, 650.0],
          }),
          ..skeleton_intent("moveAnchors")
        }],
        None,
      )
      .unwrap();

    assert_eq!(applied.layers.len(), 1);
    assert!(applied.layers[0].structure.is_none());
    assert_eq!(&applied.layers[0].values[1..], &[300.0, 650.0]);
  }

  #[test]
  fn apply_remove_anchors_with_points_in_one_atomic_set() {
    let mut bridge = bridge_with_workspace();
    let (layer_id, contour_id) = pen_setup(&mut bridge);
    let p1 = shift_font::PointId::new().to_string();
    let a1 = shift_font::AnchorId::new().to_string();

    // mixed same-set point+anchor adds apply atomically: one echo
    let applied = bridge
      .apply(
        vec![
          add_points_intent(&layer_id, &contour_id, None, vec![seed(&p1, 10.0, 20.0)]),
          add_anchors_intent(&layer_id, vec![anchor_seed(&a1, Some("top"), 250.0, 700.0)]),
        ],
        None,
      )
      .unwrap();
    assert_eq!(applied.layers.len(), 1);

    // a same-set failure must reject the whole set: the valid removePoints
    // must not survive a missing-anchor removeAnchors
    let missing = shift_font::AnchorId::new().to_string();
    let result = bridge.apply(
      vec![
        NapiFontIntent {
          remove_points: Some(NapiRemovePointsIntent {
            layer_id: layer_id.clone(),
            point_ids: vec![p1.clone()],
          }),
          ..skeleton_intent("removePoints")
        },
        NapiFontIntent {
          remove_anchors: Some(NapiRemoveAnchorsIntent {
            layer_id: layer_id.clone(),
            anchor_ids: vec![missing],
          }),
          ..skeleton_intent("removeAnchors")
        },
      ],
      None,
    );
    assert!(result.is_err());
    let state = glyph_state(&bridge, "A");
    assert_eq!(state.structure.contours[0].points.len(), 1);
    assert_eq!(state.structure.anchors.len(), 1);

    // the valid mixed removal applies atomically
    let removed = bridge
      .apply(
        vec![
          NapiFontIntent {
            remove_points: Some(NapiRemovePointsIntent {
              layer_id: layer_id.clone(),
              point_ids: vec![p1.clone()],
            }),
            ..skeleton_intent("removePoints")
          },
          NapiFontIntent {
            remove_anchors: Some(NapiRemoveAnchorsIntent {
              layer_id: layer_id.clone(),
              anchor_ids: vec![a1.clone()],
            }),
            ..skeleton_intent("removeAnchors")
          },
        ],
        None,
      )
      .unwrap();
    assert_eq!(removed.layers.len(), 1);
    let state = glyph_state(&bridge, "A");
    assert_eq!(state.structure.contours[0].points.len(), 0);
    assert!(state.structure.anchors.is_empty());
  }

  #[test]
  fn undo_after_add_anchors_removes_them_and_redo_restores() {
    let mut bridge = bridge_with_workspace();
    let (layer_id, _) = pen_setup(&mut bridge);
    let a1 = shift_font::AnchorId::new().to_string();

    bridge
      .apply(
        vec![add_anchors_intent(
          &layer_id,
          vec![anchor_seed(&a1, Some("top"), 250.0, 700.0)],
        )],
        Some("Add Anchor".to_string()),
      )
      .unwrap();
    assert_eq!(glyph_state(&bridge, "A").structure.anchors.len(), 1);

    let undone = bridge.undo().unwrap().expect("one entry to undo");
    assert_eq!(undone.layers.len(), 1);
    assert!(glyph_state(&bridge, "A").structure.anchors.is_empty());

    let redone = bridge.redo().unwrap().expect("one entry to redo");
    assert_eq!(redone.layers.len(), 1);
    let state = glyph_state(&bridge, "A");
    assert_eq!(state.structure.anchors.len(), 1);
    assert_eq!(state.structure.anchors[0].id, a1);
    assert_eq!(state.structure.anchors[0].name.as_deref(), Some("top"));
    assert_eq!(&state.values[1..], &[250.0, 700.0]);
  }

  #[test]
  fn apply_add_anchors_rejects_duplicate_ids_atomically() {
    let mut bridge = bridge_with_workspace();
    let (layer_id, _) = pen_setup(&mut bridge);
    let a1 = shift_font::AnchorId::new().to_string();

    bridge
      .apply(
        vec![add_anchors_intent(
          &layer_id,
          vec![anchor_seed(&a1, Some("top"), 0.0, 0.0)],
        )],
        None,
      )
      .unwrap();

    let fresh = shift_font::AnchorId::new().to_string();
    let result = bridge.apply(
      vec![add_anchors_intent(
        &layer_id,
        vec![
          anchor_seed(&fresh, None, 1.0, 1.0),
          anchor_seed(&a1, None, 2.0, 2.0),
        ],
      )],
      None,
    );
    assert!(result.is_err());

    // atomicity: the valid anchor from the rejected set must NOT exist
    assert_eq!(glyph_state(&bridge, "A").structure.anchors.len(), 1);
  }

  fn glyph_state(bridge: &Bridge, name: &str) -> NapiGlyphState {
    let record = bridge
      .get_glyphs()
      .unwrap()
      .into_iter()
      .find(|record| record.name == name)
      .expect("glyph record should exist");
    let source_id = default_source_id(bridge);

    glyph_source_state(bridge, &record.id, &source_id).expect("glyph state should be readable")
  }

  fn glyph_source_state(
    bridge: &Bridge,
    glyph_id: &str,
    source_id: &str,
  ) -> Option<NapiGlyphState> {
    let snapshots = bridge
      .get_glyph_snapshots(vec![NapiGlyphSnapshotRequest {
        glyph_id: glyph_id.to_string(),
      }])
      .unwrap();

    snapshots
      .into_iter()
      .next()
      .and_then(|snapshot| {
        snapshot
          .layers
          .into_iter()
          .find(|layer| layer.source_id == source_id)
      })
      .map(|layer| layer.state)
  }

  fn contour_point_count(bridge: &Bridge) -> usize {
    glyph_state(bridge, "A")
      .structure
      .contours
      .first()
      .map(|contour| contour.points.len())
      .unwrap_or(0)
  }

  #[test]
  fn undo_restores_pre_state_and_redo_restores_post_state() {
    let mut bridge = bridge_with_workspace();
    let (layer_id, contour_id) = pen_setup(&mut bridge);
    let p1 = shift_font::PointId::new().to_string();

    bridge
      .apply(
        vec![add_points_intent(
          &layer_id,
          &contour_id,
          None,
          vec![seed(&p1, 10.0, 20.0)],
        )],
        Some("Add Point".to_string()),
      )
      .unwrap();
    assert_eq!(contour_point_count(&bridge), 1);

    let undone = bridge.undo().unwrap().expect("one entry to undo");
    assert_eq!(undone.layers.len(), 1);
    assert_eq!(contour_point_count(&bridge), 0);

    let redone = bridge.redo().unwrap().expect("one entry to redo");
    assert_eq!(redone.layers.len(), 1);
    assert_eq!(contour_point_count(&bridge), 1);
  }

  #[test]
  fn undo_returns_none_when_the_ledger_is_empty() {
    let mut bridge = bridge_with_workspace();

    assert!(bridge.undo().unwrap().is_none());
    assert!(bridge.redo().unwrap().is_none());
  }

  #[test]
  fn a_fresh_apply_truncates_the_redo_stack() {
    let mut bridge = bridge_with_workspace();
    let (layer_id, contour_id) = pen_setup(&mut bridge);
    let p1 = shift_font::PointId::new().to_string();
    let p2 = shift_font::PointId::new().to_string();

    bridge
      .apply(
        vec![add_points_intent(
          &layer_id,
          &contour_id,
          None,
          vec![seed(&p1, 0.0, 0.0)],
        )],
        None,
      )
      .unwrap();
    bridge.undo().unwrap().expect("undo the first point");

    // a new apply while redo is available must truncate it
    bridge
      .apply(
        vec![add_points_intent(
          &layer_id,
          &contour_id,
          None,
          vec![seed(&p2, 5.0, 5.0)],
        )],
        None,
      )
      .unwrap();

    assert!(bridge.redo().unwrap().is_none());
    assert_eq!(contour_point_count(&bridge), 1);
  }

  #[test]
  fn apply_remove_translate_and_reverse_intents() {
    let mut bridge = bridge_with_workspace();
    let (layer_id, contour_id) = pen_setup(&mut bridge);
    let p1 = shift_font::PointId::new().to_string();
    let p2 = shift_font::PointId::new().to_string();
    let p3 = shift_font::PointId::new().to_string();

    bridge
      .apply(
        vec![add_points_intent(
          &layer_id,
          &contour_id,
          None,
          vec![
            seed(&p1, 0.0, 0.0),
            seed(&p2, 100.0, 0.0),
            seed(&p3, 50.0, 80.0),
          ],
        )],
        None,
      )
      .unwrap();

    // translate two of three points by an affine delta (O(ids) wire)
    let translated = bridge
      .apply(
        vec![NapiFontIntent {
          translate_points: Some(NapiTranslatePointsIntent {
            layer_id: layer_id.clone(),
            point_ids: vec![p1.clone(), p2.clone()],
            dx: 10.0,
            dy: 5.0,
          }),
          ..skeleton_intent("translatePoints")
        }],
        None,
      )
      .unwrap();
    assert!(translated.layers[0].structure.is_none());
    assert_eq!(translated.layers[0].values[1], 10.0);
    assert_eq!(translated.layers[0].values[2], 5.0);

    // reverse the contour: same point ids, reversed order, structural echo
    let reversed = bridge
      .apply(
        vec![NapiFontIntent {
          reverse_contour: Some(NapiReverseContourIntent {
            layer_id: layer_id.clone(),
            contour_id: contour_id.clone(),
          }),
          ..skeleton_intent("reverseContour")
        }],
        None,
      )
      .unwrap();
    let ids: Vec<&str> = reversed.layers[0].structure.as_ref().unwrap().contours[0]
      .points
      .iter()
      .map(|p| p.id.as_str())
      .collect();
    assert_eq!(ids, vec![p3.as_str(), p2.as_str(), p1.as_str()]);

    // remove one point; undo restores it (ledger covers the new kinds)
    bridge
      .apply(
        vec![NapiFontIntent {
          remove_points: Some(NapiRemovePointsIntent {
            layer_id: layer_id.clone(),
            point_ids: vec![p2.clone()],
          }),
          ..skeleton_intent("removePoints")
        }],
        None,
      )
      .unwrap();
    assert_eq!(contour_point_count(&bridge), 2);

    bridge
      .undo()
      .unwrap()
      .expect("removePoints must be undoable");
    assert_eq!(contour_point_count(&bridge), 3);
  }

  fn test_paths(label: &str) -> (String, String) {
    let id = TEST_ID.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!("shift-bridge-{label}-{id}"));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    (
      dir.join("TestFont.shift").to_string_lossy().into_owned(),
      dir.join("working.sqlite").to_string_lossy().into_owned(),
    )
  }

  fn bridge_with_workspace() -> Bridge {
    let mut bridge = Bridge::new();
    let (_, store_path) = test_paths("workspace");
    bridge.create_untitled_workspace(store_path, None).unwrap();
    bridge
  }

  #[test]
  fn document_state_tracks_dirty_across_edits_and_saves() {
    let mut bridge = bridge_with_workspace();

    let state = bridge.document_state().unwrap();
    assert_eq!(state.source_kind, "untitled");
    assert_eq!(state.save_target, None);
    assert!(!state.dirty);
    assert!(state.needs_save_as);

    bridge
      .apply(vec![create_glyph_napi("A", vec![65])], None)
      .unwrap();

    assert!(bridge.document_state().unwrap().dirty);

    let (save_path, _) = test_paths("save-as");
    let state = bridge.save_workspace_as(save_path.clone()).unwrap();
    assert_eq!(state.source_kind, "package");
    assert_eq!(state.save_target.as_deref(), Some(save_path.as_str()));
    assert!(!state.dirty);
    assert!(!state.needs_save_as);

    bridge
      .apply(vec![create_glyph_napi("B", vec![66])], None)
      .unwrap();

    assert!(bridge.document_state().unwrap().dirty);

    let state = bridge.save_workspace().unwrap();
    assert!(!state.dirty);
  }

  #[test]
  fn save_workspace_reports_needs_save_as_for_untitled_documents() {
    let mut bridge = bridge_with_workspace();
    bridge
      .apply(vec![create_glyph_napi("A", vec![65])], None)
      .unwrap();

    let error = bridge.save_workspace().unwrap_err();

    assert!(error.to_string().contains("workspace needs a save path"));
    let state = bridge.document_state().unwrap();
    assert!(state.dirty);
    assert!(state.needs_save_as);
  }

  #[test]
  fn resume_workspace_restores_persisted_dirty_state() {
    let (save_path, store_path) = test_paths("resume");
    {
      let mut bridge = Bridge::new();
      bridge
        .create_untitled_workspace(store_path.clone(), None)
        .unwrap();
      bridge
        .apply(vec![create_glyph_napi("A", vec![65])], None)
        .unwrap();
      bridge.save_workspace_as(save_path.clone()).unwrap();
      bridge
        .apply(vec![create_glyph_napi("B", vec![66])], None)
        .unwrap();
      assert!(bridge.document_state().unwrap().dirty);
    }

    let mut bridge = Bridge::new();
    bridge
      .resume_workspace_for_source(store_path, save_path.clone())
      .unwrap();

    let state = bridge.document_state().unwrap();
    assert_eq!(state.source_kind, "package");
    assert_eq!(state.save_target.as_deref(), Some(save_path.as_str()));
    assert!(state.dirty);
    assert_eq!(
      bridge
        .get_glyphs()
        .unwrap()
        .into_iter()
        .map(|glyph| glyph.name)
        .collect::<Vec<_>>(),
      vec!["A".to_string(), "B".to_string()]
    );
  }

  fn default_source_id(bridge: &Bridge) -> String {
    bridge.get_sources().unwrap()[0].id.clone()
  }

  fn create_default_glyph_layer(bridge: &mut Bridge, name: &str, unicode: Option<u32>) -> String {
    let glyph_id = GlyphId::new().to_string();
    let layer_id = LayerId::new().to_string();
    let source_id = default_source_id(bridge);
    let applied = bridge
      .apply(
        vec![
          create_glyph_napi_with_id(&glyph_id, name, unicode.into_iter().collect()),
          create_glyph_layer_intent(&layer_id, &glyph_id, &source_id),
        ],
        None,
      )
      .unwrap();
    assert_eq!(applied.layers[0].layer_id, layer_id);
    layer_id
  }

  fn create_axis_intent(
    axis_id: &str,
    tag: &str,
    name: &str,
    min: f64,
    default: f64,
    max: f64,
  ) -> NapiFontIntent {
    NapiFontIntent {
      create_axis: Some(NapiCreateAxisIntent {
        axis: NapiAxis {
          id: axis_id.to_string(),
          tag: tag.to_string(),
          name: name.to_string(),
          role: NapiAxisRole::External,
          axis_type: NapiAxisType::Continuous,
          minimum: Some(min),
          default,
          maximum: Some(max),
          values: None,
          labels: Vec::new(),
          hidden: false,
        },
      }),
      ..skeleton_intent("createAxis")
    }
  }

  fn delete_axis_intent(axis_id: &str) -> NapiFontIntent {
    NapiFontIntent {
      delete_axis: Some(NapiDeleteAxisIntent {
        axis_id: axis_id.to_string(),
      }),
      ..skeleton_intent("deleteAxis")
    }
  }

  fn delete_source_intent(source_id: &str) -> NapiFontIntent {
    NapiFontIntent {
      delete_source: Some(NapiDeleteSourceIntent {
        source_id: source_id.to_string(),
      }),
      ..skeleton_intent("deleteSource")
    }
  }

  fn create_source_intent(source_id: &str, name: &str, location: &[(&str, f64)]) -> NapiFontIntent {
    NapiFontIntent {
      create_source: Some(NapiCreateSourceIntent {
        source_id: source_id.to_string(),
        name: name.to_string(),
        location: NapiLocation {
          values: location
            .iter()
            .map(|(tag, value)| (tag.to_string(), *value))
            .collect(),
        },
      }),
      ..skeleton_intent("createSource")
    }
  }

  fn weight_axis_intent() -> NapiFontIntent {
    create_axis_intent("axis_weight", "wght", "Weight", 100.0, 400.0, 900.0)
  }

  #[test]
  fn apply_create_axis_echoes_axes_and_sources() {
    let mut bridge = bridge_with_workspace();

    let applied = bridge.apply(vec![weight_axis_intent()], None).unwrap();

    let axes = applied.axes.expect("createAxis must echo axes");
    assert_eq!(axes.len(), 1);
    assert_eq!(axes[0].tag, "wght");
    assert_eq!(axes[0].name, "Weight");
    assert_eq!(axes[0].minimum, Some(100.0));
    assert_eq!(axes[0].default, 400.0);
    assert_eq!(axes[0].maximum, Some(900.0));
    // locations may change shape, so sources ride along
    assert!(applied.sources.is_some());
    assert!(applied.glyphs.is_none());
    assert!(applied.layers.is_empty());
    assert!(bridge.is_variable().unwrap());
  }

  #[test]
  fn apply_create_axis_rejects_duplicate_tags() {
    let mut bridge = bridge_with_workspace();
    bridge.apply(vec![weight_axis_intent()], None).unwrap();

    let result = bridge.apply(
      vec![create_axis_intent(
        "axis_weight_again",
        "wght",
        "Weight Again",
        0.0,
        50.0,
        100.0,
      )],
      None,
    );

    assert!(result.is_err());
    assert_eq!(bridge.get_axes().unwrap().len(), 1);
  }

  #[test]
  fn apply_delete_axis_echoes_axes_and_sources() {
    let mut bridge = bridge_with_workspace();
    bridge.apply(vec![weight_axis_intent()], None).unwrap();

    let applied = bridge
      .apply(vec![delete_axis_intent("axis_weight")], None)
      .unwrap();

    let axes = applied.axes.expect("deleteAxis must echo axes");
    assert!(axes.is_empty());
    let sources = applied.sources.expect("deleteAxis must echo sources");
    assert!(sources
      .iter()
      .all(|source| source.location.values.is_empty()));
    assert!(!bridge.is_variable().unwrap());
  }

  #[test]
  fn apply_create_source_echoes_sources_without_creating_layers() {
    let mut bridge = bridge_with_workspace();
    create_default_glyph_layer(&mut bridge, "A", Some(65));
    bridge.apply(vec![weight_axis_intent()], None).unwrap();

    let applied = bridge
      .apply(
        vec![create_source_intent(
          "source_bold",
          "Bold",
          &[("axis_weight", 700.0)],
        )],
        None,
      )
      .unwrap();

    let sources = applied.sources.expect("createSource must echo sources");
    assert_eq!(sources.len(), 2);
    let bold = sources
      .iter()
      .find(|source| source.name == "Bold")
      .expect("new source must be in the echo");
    assert_eq!(bold.id, "source_bold");
    assert_eq!(bold.location.values.get("axis_weight"), Some(&700.0));
    assert!(applied.layers.is_empty());
    assert!(applied.glyphs.is_none());
    assert_eq!(bridge.get_glyphs().unwrap()[0].layers.len(), 1);
  }

  #[test]
  fn apply_create_glyph_layer_resolves_layer_for_new_source() {
    let mut bridge = bridge_with_workspace();
    create_default_glyph_layer(&mut bridge, "A", Some(65));
    bridge.apply(vec![weight_axis_intent()], None).unwrap();

    bridge
      .apply(
        vec![create_source_intent(
          "source_bold",
          "Bold",
          &[("axis_weight", 700.0)],
        )],
        None,
      )
      .unwrap();

    let glyph_id = bridge.get_glyphs().unwrap()[0].id.clone();
    let layer_id = LayerId::new().to_string();

    let applied = bridge
      .apply(
        vec![create_glyph_layer_intent(
          &layer_id,
          &glyph_id,
          "source_bold",
        )],
        None,
      )
      .unwrap();

    let state = glyph_source_state(&bridge, &glyph_id, "source_bold")
      .expect("the explicit layer must resolve by glyph and source");
    assert_eq!(state.layer_id, layer_id);
    assert_eq!(applied.layers[0].layer_id, layer_id);
    let glyphs = applied
      .glyphs
      .expect("layer membership must echo glyph records");
    assert_eq!(glyphs[0].layers.len(), 2);
  }

  #[test]
  fn apply_clone_glyph_layer_copies_shape_with_fresh_internal_ids() {
    let mut bridge = bridge_with_workspace();
    let (from_layer_id, contour_id) = pen_setup(&mut bridge);
    let glyph_id = bridge.get_glyphs().unwrap()[0].id.clone();
    let point_a = shift_font::PointId::new().to_string();
    let point_b = shift_font::PointId::new().to_string();
    let anchor_top = shift_font::AnchorId::new().to_string();

    bridge
      .apply(
        vec![
          add_points_intent(
            &from_layer_id,
            &contour_id,
            None,
            vec![seed(&point_a, 10.0, 20.0), seed(&point_b, 30.0, 40.0)],
          ),
          add_anchors_intent(
            &from_layer_id,
            vec![anchor_seed(&anchor_top, Some("top"), 15.0, 70.0)],
          ),
        ],
        None,
      )
      .unwrap();
    bridge
      .apply(vec![create_source_intent("source_bold", "Bold", &[])], None)
      .unwrap();

    let layer_id = LayerId::new().to_string();
    let applied = bridge
      .apply(
        vec![clone_glyph_layer_intent(
          &layer_id,
          &glyph_id,
          "source_bold",
          &from_layer_id,
        )],
        None,
      )
      .unwrap();

    let source = glyph_source_state(&bridge, &glyph_id, &default_source_id(&bridge))
      .expect("source layer should be readable");
    let cloned = glyph_source_state(&bridge, &glyph_id, "source_bold")
      .expect("cloned layer should be readable");

    assert_eq!(applied.layers[0].layer_id, layer_id);
    assert_eq!(cloned.layer_id, layer_id);
    assert_eq!(cloned.values.len(), source.values.len());
    for index in 0..cloned.values.len() {
      assert_eq!(cloned.values[index], source.values[index]);
    }
    assert_eq!(
      cloned.structure.contours.len(),
      source.structure.contours.len()
    );
    assert_eq!(
      cloned.structure.contours[0].points.len(),
      source.structure.contours[0].points.len()
    );
    assert_ne!(
      cloned.structure.contours[0].points[0].id,
      source.structure.contours[0].points[0].id
    );
    assert_ne!(
      cloned.structure.anchors[0].id,
      source.structure.anchors[0].id
    );
  }

  #[test]
  fn apply_create_source_rejects_unknown_axis_ids() {
    let mut bridge = bridge_with_workspace();
    bridge.apply(vec![weight_axis_intent()], None).unwrap();

    let result = bridge.apply(
      vec![create_source_intent(
        "source_wide",
        "Wide",
        &[("axis_width", 125.0)],
      )],
      None,
    );

    assert!(result.is_err());
    assert_eq!(bridge.get_sources().unwrap().len(), 1);
  }

  #[test]
  fn apply_create_source_rejects_duplicate_source_names() {
    let mut bridge = bridge_with_workspace();
    bridge.apply(vec![weight_axis_intent()], None).unwrap();

    // the untitled workspace already has a "Regular" source
    let result = bridge.apply(
      vec![create_source_intent(
        "source_regular_duplicate",
        "Regular",
        &[],
      )],
      None,
    );

    assert!(result.is_err());
    assert_eq!(bridge.get_sources().unwrap().len(), 1);
  }

  #[test]
  fn apply_create_source_rejects_duplicate_source_ids() {
    let mut bridge = bridge_with_workspace();
    bridge.apply(vec![weight_axis_intent()], None).unwrap();
    bridge
      .apply(
        vec![create_source_intent(
          "source_bold",
          "Bold",
          &[("axis_weight", 700.0)],
        )],
        None,
      )
      .unwrap();

    let result = bridge.apply(
      vec![create_source_intent(
        "source_bold",
        "Bold Again",
        &[("axis_weight", 800.0)],
      )],
      None,
    );

    assert!(result.is_err());
    assert_eq!(bridge.get_sources().unwrap().len(), 2);
  }

  #[test]
  fn apply_delete_source_echoes_sources_and_removes_layers() {
    let mut bridge = bridge_with_workspace();
    let default_layer_id = create_default_glyph_layer(&mut bridge, "A", Some(65));
    bridge.apply(vec![weight_axis_intent()], None).unwrap();
    bridge
      .apply(
        vec![create_source_intent(
          "source_bold",
          "Bold",
          &[("axis_weight", 700.0)],
        )],
        None,
      )
      .unwrap();
    let glyph_id = bridge.get_glyphs().unwrap()[0].id.clone();
    let bold_layer_id = LayerId::new().to_string();
    bridge
      .apply(
        vec![create_glyph_layer_intent(
          &bold_layer_id,
          &glyph_id,
          "source_bold",
        )],
        None,
      )
      .unwrap();
    assert!(glyph_source_state(&bridge, &glyph_id, "source_bold").is_some());

    let applied = bridge
      .apply(vec![delete_source_intent("source_bold")], None)
      .unwrap();

    let sources = applied.sources.expect("deleteSource must echo sources");
    assert_eq!(sources.len(), 1);
    assert_eq!(sources[0].name, "Regular");
    let glyphs = applied
      .glyphs
      .expect("deleteSource layer removal must echo glyph records");
    assert_eq!(glyphs[0].layers.len(), 1);
    assert!(applied.layers.is_empty());
    assert!(glyph_source_state(&bridge, &glyph_id, "source_bold").is_none());
    let default_state = glyph_source_state(&bridge, &glyph_id, &default_source_id(&bridge))
      .expect("default source must keep its layer");
    assert_eq!(default_state.layer_id, default_layer_id);
  }

  #[test]
  fn apply_delete_source_rejects_last_source() {
    let mut bridge = bridge_with_workspace();
    let source_id = default_source_id(&bridge);

    let result = bridge.apply(vec![delete_source_intent(&source_id)], None);

    assert!(result.is_err());
    assert_eq!(bridge.get_sources().unwrap().len(), 1);
  }

  #[test]
  fn apply_create_glyph_does_not_emit_layers_for_sources() {
    let mut bridge = bridge_with_workspace();
    bridge.apply(vec![weight_axis_intent()], None).unwrap();
    bridge
      .apply(
        vec![create_source_intent(
          "source_bold",
          "Bold",
          &[("axis_weight", 700.0)],
        )],
        None,
      )
      .unwrap();

    let applied = bridge
      .apply(vec![create_glyph_napi("A", vec![65])], None)
      .unwrap();

    assert!(applied.layers.is_empty());
    let glyphs = applied.glyphs.expect("createGlyph must echo records");
    assert!(glyphs[0].layers.is_empty());
  }

  #[test]
  fn apply_mixes_editing_and_create_intents_as_one_undo_step() {
    let mut bridge = bridge_with_workspace();
    let (layer_id, _) = pen_setup(&mut bridge);

    let applied = bridge
      .apply(
        vec![
          weight_axis_intent(),
          NapiFontIntent {
            set_x_advance: Some(NapiSetXAdvanceIntent {
              layer_id: layer_id.clone(),
              width: 600.0,
            }),
            ..skeleton_intent("setXAdvance")
          },
        ],
        Some("Add Weight".to_string()),
      )
      .unwrap();

    assert_eq!(applied.axes.expect("createAxis must echo axes").len(), 1);
    assert!(applied
      .layers
      .iter()
      .any(|layer| layer.layer_id == layer_id));

    let undone = bridge.undo().unwrap().expect("mixed set should undo");
    assert!(bridge.get_axes().unwrap().is_empty());
    assert_eq!(undone.axes.expect("undo must echo axes").len(), 0);
  }

  #[test]
  fn new_bridge_requires_workspace_before_font_reads() {
    let bridge = Bridge::new();

    let error = match bridge.get_metadata() {
      Ok(_) => panic!("metadata read should require an open workspace"),
      Err(error) => error,
    };

    assert!(error.to_string().contains("no workspace is open"));
  }

  #[test]
  fn create_untitled_workspace_exposes_empty_font_state() {
    let bridge = bridge_with_workspace();

    let metadata = bridge.get_metadata().unwrap();
    let metrics = bridge.get_metrics().unwrap();

    assert!(bridge.get_glyphs().unwrap().is_empty());
    assert_eq!(bridge.get_sources().unwrap().len(), 1);
    assert_eq!(bridge.get_sources().unwrap()[0].name, "Regular");
    assert_eq!(metadata.family_name.as_deref(), Some("Untitled Font"));
    assert_eq!(metadata.style_name.as_deref(), Some("Regular"));
    assert_eq!(metrics.units_per_em, 1000.0);
    assert_eq!(metrics.ascender, 800.0);
    assert_eq!(metrics.descender, -200.0);
  }

  #[test]
  fn create_untitled_workspace_resets_to_fresh_font_state() {
    let mut bridge = bridge_with_workspace();
    create_default_glyph_layer(&mut bridge, "A", Some(65));

    let (_, store_path) = test_paths("reset");
    bridge.create_untitled_workspace(store_path, None).unwrap();

    assert!(bridge.get_glyphs().unwrap().is_empty());
    assert!(bridge.get_axes().unwrap().is_empty());
    assert_eq!(bridge.get_sources().unwrap().len(), 1);
    assert_eq!(bridge.get_sources().unwrap()[0].name, "Regular");
  }

  #[test]
  fn save_snapshot_includes_applied_glyph_edits() {
    let mut bridge = bridge_with_workspace();
    let (layer_id, contour_id) = pen_setup(&mut bridge);
    let point_id = shift_font::PointId::new().to_string();
    bridge
      .apply(
        vec![add_points_intent(
          &layer_id,
          &contour_id,
          None,
          vec![seed(&point_id, 10.0, 20.0)],
        )],
        None,
      )
      .unwrap();

    let snapshot = bridge.save_snapshot().unwrap();
    let glyph = snapshot
      .glyph("A")
      .expect("snapshot should include edited A");
    let layer = glyph
      .layer_for_source(snapshot.default_source_id().unwrap())
      .expect("edited glyph should include default layer");

    assert_eq!(bridge.get_glyphs().unwrap().len(), 1);
    assert_eq!(glyph.unicodes(), &[65]);
    assert_eq!(layer.contours().len(), 1);
    assert_eq!(
      layer.contours().values().next().unwrap().points()[0]
        .id()
        .to_string(),
      point_id
    );
  }

  #[test]
  fn get_glyph_snapshots_read_applied_edits() {
    let mut bridge = bridge_with_workspace();
    let (layer_id, contour_id) = pen_setup(&mut bridge);
    let point_id = shift_font::PointId::new().to_string();
    bridge
      .apply(
        vec![add_points_intent(
          &layer_id,
          &contour_id,
          None,
          vec![seed(&point_id, 10.0, 20.0)],
        )],
        None,
      )
      .unwrap();

    let state = glyph_state(&bridge, "A");

    assert_eq!(state.layer_id, layer_id);
    assert_eq!(state.structure.contours.len(), 1);
    assert_eq!(state.structure.contours[0].points.len(), 1);
    assert_eq!(&state.values[..], &[500.0, 10.0, 20.0]);
  }

  #[test]
  fn get_glyph_snapshots_returns_none_for_missing_glyph() {
    let bridge = bridge_with_workspace();
    let missing_glyph_id = shift_font::GlyphId::new().to_string();

    let snapshots = bridge
      .get_glyph_snapshots(vec![NapiGlyphSnapshotRequest {
        glyph_id: missing_glyph_id,
      }])
      .unwrap();

    assert!(snapshots.is_empty());
  }

  #[test]
  fn apply_requires_valid_layer_id() {
    let mut bridge = bridge_with_workspace();

    let result = bridge.apply(
      vec![NapiFontIntent {
        add_contour: Some(NapiAddContourIntent {
          layer_id: "not-a-layer-id".to_string(),
          contour_id: shift_font::ContourId::new().to_string(),
          closed: false,
        }),
        ..skeleton_intent("addContour")
      }],
      None,
    );

    assert!(matches!(
      result.err().unwrap(),
      BridgeError::InvalidInput {
        kind: "layer ID",
        ..
      }
    ));
  }
}
