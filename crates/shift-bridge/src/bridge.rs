use crate::errors::{self, BridgeError, BridgeResult};
use crate::input::{parse, BridgeParse};
use napi::bindgen_prelude::*;
use napi::{Error, Status};
use napi_derive::napi;
use serde::{Deserialize, Serialize};
use shift_backends::{ExportFormat, FontExportRequest, FontExportResult, FontExporter, FontView};
use shift_font::{
  BooleanOp, BulkNodePositionUpdates, ContourId, Font, Glyph, GlyphId, LayerId, PointId, SourceId,
};
use shift_wire::{
  bridges::napi::{
    NapiAppliedChange, NapiAxis, NapiFontIntent, NapiFontMetadata, NapiFontMetrics,
    NapiGlyphRecord, NapiGlyphState, NapiGlyphStructure, NapiGlyphStructureChange,
    NapiGlyphValueChange, NapiLayerReplaced, NapiPointType, NapiSource,
  },
  interpolation::{build_glyph_variation_data, build_masters, GlyphVariationBuild},
  state::apply_state_to_layer,
  Axis, FontMetadata, FontMetrics, GlyphChangedEntities, GlyphRecord, GlyphState, GlyphStructure,
  GlyphStructureChange, GlyphValueChange, Source,
};
use shift_workspace::{FontWorkspace, NewWorkspace};
use std::sync::{
  atomic::{AtomicU64, Ordering},
  Arc,
};

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct GlyphHandle {
  #[napi(ts_type = "GlyphName")]
  pub name: String,
  #[napi(ts_type = "Unicode")]
  pub unicode: Option<u32>,
}

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

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord)]
pub struct DocumentVersion(u64);

impl DocumentVersion {
  fn next(self) -> Self {
    Self(self.0 + 1)
  }

  fn as_u32(self) -> u32 {
    self.0.min(u32::MAX as u64) as u32
  }
}

type SharedPersistedVersion = Arc<AtomicU64>;

fn record_persisted_version(persisted_version: &SharedPersistedVersion, version: DocumentVersion) {
  let mut current = persisted_version.load(Ordering::Acquire);
  while version.0 > current {
    match persisted_version.compare_exchange(
      current,
      version.0,
      Ordering::AcqRel,
      Ordering::Acquire,
    ) {
      Ok(_) => return,
      Err(observed) => current = observed,
    }
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
  persisted_version: SharedPersistedVersion,
}

#[napi]
impl Bridge {
  #[napi(constructor)]
  pub fn new() -> Self {
    Self {
      workspace: None,
      live_version: DocumentVersion::default(),
      persisted_version: Arc::new(AtomicU64::new(0)),
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

  #[napi]
  pub fn close_workspace(&mut self) -> errors::Result<()> {
    self.workspace = None;
    self.reset_versions();
    Ok(())
  }

  #[napi]
  pub fn save_workspace(&mut self) -> errors::Result<u32> {
    self.workspace_mut()?.save()?;
    let version = self.live_version();
    record_persisted_version(&self.persisted_version, version);
    Ok(version.as_u32())
  }

  #[napi]
  pub fn save_workspace_as(&mut self, path: String) -> errors::Result<u32> {
    self.workspace_mut()?.save_as(path)?;
    let version = self.live_version();
    record_persisted_version(&self.persisted_version, version);
    Ok(version.as_u32())
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
  pub fn get_metadata(&self) -> errors::Result<NapiFontMetadata> {
    Ok(FontMetadata::from(self.font()?.metadata()).into())
  }

  #[napi]
  pub fn get_metrics(&self) -> errors::Result<NapiFontMetrics> {
    Ok(FontMetrics::from(self.font()?.metrics()).into())
  }

  #[napi]
  pub fn get_glyph_count(&self) -> errors::Result<u32> {
    Ok(self.font()?.glyph_count() as u32)
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

  #[napi]
  pub fn update_glyph_identity(
    &mut self,
    #[napi(ts_arg_type = "GlyphName")] from_name: String,
    #[napi(ts_arg_type = "GlyphName")] name: String,
    #[napi(ts_arg_type = "Array<Unicode>")] unicodes: Vec<u32>,
  ) -> errors::Result<()> {
    self
      .workspace_mut()?
      .update_glyph_identity(&from_name, name, unicodes)?;
    self.mark_font_changed();

    Ok(())
  }

  /// CS0 walking skeleton: applies a small intent set through the existing
  /// workspace verbs and answers with pure replace-grade state. CS1 replaces
  /// the stringly intent match with `Font::apply_intents` over per-variant
  /// structs.
  #[napi]
  pub fn apply(
    &mut self,
    intents: Vec<NapiFontIntent>,
    label: Option<String>,
  ) -> errors::Result<NapiAppliedChange> {
    // The ledger lands in CS1b; the label is part of the wire contract now.
    let _ = label;

    let mut layers: Vec<NapiLayerReplaced> = Vec::new();
    let mut glyphs_changed = false;

    for intent in intents {
      match intent.kind.as_str() {
        "createGlyph" => {
          let name = intent.name.ok_or(BridgeError::InvalidInput {
            kind: "intent",
            value: "createGlyph requires name".to_string(),
          })?;
          let unicodes = intent.unicodes.unwrap_or_default();

          let source_id = self
            .font()?
            .default_source_id()
            .or_else(|| self.font().ok()?.sources().first().map(|s| s.id()))
            .ok_or(BridgeError::InvalidInput {
              kind: "intent",
              value: "createGlyph requires a font with at least one source".to_string(),
            })?;

          let glyph = self.workspace_mut()?.create_glyph(name, unicodes)?;
          let layer = self
            .workspace_mut()?
            .create_glyph_layer(glyph.id(), source_id)?;

          layers.push(NapiLayerReplaced {
            layer_id: layer.id().to_string(),
            structure: Some(GlyphStructure::from(&layer).into()),
            values: shift_wire::values_from_layer(&layer).into(),
            changed: GlyphChangedEntities::default().into(),
          });
          glyphs_changed = true;
        }
        "setXAdvance" => {
          let layer_id = intent.layer_id.ok_or(BridgeError::InvalidInput {
            kind: "intent",
            value: "setXAdvance requires layerId".to_string(),
          })?;
          let width = intent.width.ok_or(BridgeError::InvalidInput {
            kind: "intent",
            value: "setXAdvance requires width".to_string(),
          })?;

          let layer_id = parse::<LayerId>(&layer_id)?;
          let layer = self.workspace_mut()?.set_x_advance(layer_id, width)?;
          let change = GlyphValueChange::from_layer(&layer, GlyphChangedEntities::default());

          layers.push(NapiLayerReplaced {
            layer_id: layer.id().to_string(),
            structure: None,
            values: change.values.into(),
            changed: change.changed.into(),
          });
        }
        other => {
          return Err(BridgeError::InvalidInput {
            kind: "intent",
            value: format!("unknown intent kind \"{other}\""),
          })
        }
      }
    }

    self.mark_font_changed();

    let glyphs = if glyphs_changed {
      Some(self.get_glyphs()?)
    } else {
      None
    };

    Ok(NapiAppliedChange {
      layers,
      glyphs,
      // Dependent-composite invalidation lands with the interpreter in CS1.
      dependents: Vec::new(),
    })
  }

  #[napi]
  pub fn get_glyph_state(
    &self,
    glyph_handle: GlyphHandle,
    #[napi(ts_arg_type = "SourceId")] source_id: String,
  ) -> errors::Result<Option<NapiGlyphState>> {
    let source_id = parse::<SourceId>(&source_id)?;

    let glyph = match self.glyph_for_read(&glyph_handle.name)? {
      Some(glyph) => glyph,
      None => return Ok(None),
    };
    let layer = match glyph.layer_for_source(source_id) {
      Some(layer) => layer,
      None => return Ok(None),
    };

    let variation_data = self
      .variation_build_for_glyph(&glyph)?
      .and_then(|(_, build)| build.variation_data);

    Ok(Some(GlyphState::from_layer(layer, variation_data).into()))
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

  fn glyph_for_read(&self, glyph_name: &str) -> BridgeResult<Option<Glyph>> {
    Ok(self.font()?.glyph_by_name(glyph_name).cloned())
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

  fn mark_font_changed(&mut self) {
    self.bump_live_version();
  }

  fn bump_live_version(&mut self) {
    self.live_version = self.live_version.next();
  }

  fn reset_versions(&mut self) {
    self.live_version = DocumentVersion::default();
    self.persisted_version = Arc::new(AtomicU64::new(0));
  }

  fn live_version(&self) -> DocumentVersion {
    self.live_version
  }

  fn persisted_version(&self) -> DocumentVersion {
    DocumentVersion(self.persisted_version.load(Ordering::Acquire))
  }

  #[napi]
  pub fn get_persisted_version(&self) -> u32 {
    self.persisted_version().as_u32()
  }

  #[napi]
  pub fn is_dirty(&self) -> bool {
    self.persisted_version() < self.live_version()
  }

  #[napi(ts_return_type = "GlyphId")]
  pub fn create_glyph(
    &mut self,
    #[napi(ts_arg_type = "GlyphName")] name: String,
    #[napi(ts_arg_type = "Array<Unicode>")] unicodes: Vec<u32>,
  ) -> errors::Result<String> {
    let glyph = self.workspace_mut()?.create_glyph(name, unicodes)?;

    self.mark_font_changed();
    Ok(glyph.id().to_string())
  }

  #[napi(ts_return_type = "LayerId")]
  pub fn create_glyph_layer(
    &mut self,
    #[napi(ts_arg_type = "GlyphId")] glyph_id: String,
    #[napi(ts_arg_type = "SourceId")] source_id: String,
  ) -> errors::Result<String> {
    let glyph_id = parse::<GlyphId>(&glyph_id)?;
    let source_id = parse::<SourceId>(&source_id)?;
    let layer = self
      .workspace_mut()?
      .create_glyph_layer(glyph_id, source_id)?;

    self.mark_font_changed();
    Ok(layer.id().to_string())
  }

  #[napi]
  pub fn set_x_advance(
    &mut self,
    #[napi(ts_arg_type = "LayerId")] layer_id: String,
    width: f64,
  ) -> errors::Result<NapiGlyphValueChange> {
    let layer_id = parse::<LayerId>(&layer_id)?;
    let layer = self.workspace_mut()?.set_x_advance(layer_id, width)?;
    let change = GlyphValueChange::from_layer(&layer, Default::default());

    self.mark_font_changed();
    Ok(change.into())
  }

  #[napi]
  pub fn translate_layer(
    &mut self,
    #[napi(ts_arg_type = "LayerId")] layer_id: String,
    dx: f64,
    dy: f64,
  ) -> errors::Result<NapiGlyphValueChange> {
    let layer_id = parse::<LayerId>(&layer_id)?;
    let layer = self.workspace_mut()?.translate_layer(layer_id, dx, dy)?;
    let change = GlyphValueChange::from_layer(&layer, Default::default());

    self.mark_font_changed();
    Ok(change.into())
  }

  #[napi]
  pub fn add_point(
    &mut self,
    #[napi(ts_arg_type = "LayerId")] layer_id: String,
    #[napi(ts_arg_type = "ContourId")] contour_id: String,
    x: f64,
    y: f64,
    point_type: NapiPointType,
    smooth: bool,
  ) -> errors::Result<NapiGlyphStructureChange> {
    let contour_id = parse::<ContourId>(&contour_id)?;
    let point_type = point_type.into();

    let layer_id = parse::<LayerId>(&layer_id)?;
    let (layer, point_id) = self
      .workspace_mut()?
      .add_point(layer_id, contour_id, x, y, point_type, smooth)?;
    let changed = GlyphChangedEntities {
      point_ids: vec![point_id],
      ..Default::default()
    };
    let change = GlyphStructureChange::from_layer(&layer, changed);

    self.mark_font_changed();
    Ok(change.into())
  }

  #[napi]
  pub fn insert_point_before(
    &mut self,
    #[napi(ts_arg_type = "LayerId")] layer_id: String,
    #[napi(ts_arg_type = "PointId")] before_point_id: String,
    x: f64,
    y: f64,
    point_type: NapiPointType,
    smooth: bool,
  ) -> errors::Result<NapiGlyphStructureChange> {
    let before_point_id = parse::<PointId>(&before_point_id)?;
    let point_type = point_type.into();

    let layer_id = parse::<LayerId>(&layer_id)?;
    let (layer, point_id) = self.workspace_mut()?.insert_point_before(
      layer_id,
      before_point_id,
      x,
      y,
      point_type,
      smooth,
    )?;
    let changed = GlyphChangedEntities {
      point_ids: vec![point_id],
      ..Default::default()
    };
    let change = GlyphStructureChange::from_layer(&layer, changed);

    self.mark_font_changed();
    Ok(change.into())
  }

  #[napi]
  pub fn add_contour(
    &mut self,
    #[napi(ts_arg_type = "LayerId")] layer_id: String,
  ) -> errors::Result<NapiGlyphStructureChange> {
    let layer_id = parse::<LayerId>(&layer_id)?;
    let (layer, contour_id) = self.workspace_mut()?.add_contour(layer_id)?;
    let changed = GlyphChangedEntities {
      contour_ids: vec![contour_id],
      ..Default::default()
    };
    let change = GlyphStructureChange::from_layer(&layer, changed);

    self.mark_font_changed();
    Ok(change.into())
  }

  #[napi]
  pub fn open_contour(
    &mut self,
    #[napi(ts_arg_type = "LayerId")] layer_id: String,
    #[napi(ts_arg_type = "ContourId")] contour_id: String,
  ) -> errors::Result<NapiGlyphStructureChange> {
    let contour_id = parse::<ContourId>(&contour_id)?;
    let layer_id = parse::<LayerId>(&layer_id)?;
    let layer = self
      .workspace_mut()?
      .open_contour(layer_id, contour_id.clone())?;
    let changed = GlyphChangedEntities {
      contour_ids: vec![contour_id],
      ..Default::default()
    };
    let change = GlyphStructureChange::from_layer(&layer, changed);

    self.mark_font_changed();
    Ok(change.into())
  }

  #[napi]
  pub fn close_contour(
    &mut self,
    #[napi(ts_arg_type = "LayerId")] layer_id: String,
    #[napi(ts_arg_type = "ContourId")] contour_id: String,
  ) -> errors::Result<NapiGlyphStructureChange> {
    let contour_id = parse::<ContourId>(&contour_id)?;
    let layer_id = parse::<LayerId>(&layer_id)?;
    let layer = self
      .workspace_mut()?
      .close_contour(layer_id, contour_id.clone())?;
    let changed = GlyphChangedEntities {
      contour_ids: vec![contour_id],
      ..Default::default()
    };
    let change = GlyphStructureChange::from_layer(&layer, changed);

    self.mark_font_changed();
    Ok(change.into())
  }

  #[napi]
  pub fn reverse_contour(
    &mut self,
    #[napi(ts_arg_type = "LayerId")] layer_id: String,
    #[napi(ts_arg_type = "ContourId")] contour_id: String,
  ) -> errors::Result<NapiGlyphStructureChange> {
    let contour_id = parse::<ContourId>(&contour_id)?;
    let layer_id = parse::<LayerId>(&layer_id)?;
    let layer = self
      .workspace_mut()?
      .reverse_contour(layer_id, contour_id.clone())?;
    let changed = GlyphChangedEntities {
      contour_ids: vec![contour_id],
      ..Default::default()
    };
    let change = GlyphStructureChange::from_layer(&layer, changed);

    self.mark_font_changed();
    Ok(change.into())
  }

  #[napi]
  pub fn apply_boolean_op(
    &mut self,
    #[napi(ts_arg_type = "LayerId")] layer_id: String,
    #[napi(ts_arg_type = "ContourId")] contour_id_a: String,
    #[napi(ts_arg_type = "ContourId")] contour_id_b: String,
    operation: String,
  ) -> errors::Result<NapiGlyphStructureChange> {
    let cid_a = parse::<ContourId>(&contour_id_a)?;
    let cid_b = parse::<ContourId>(&contour_id_b)?;

    let op = match operation.as_str() {
      "union" => BooleanOp::Union,
      "subtract" => BooleanOp::Subtract,
      "intersect" => BooleanOp::Intersect,
      "difference" => BooleanOp::Difference,
      _ => {
        return Err(errors::BridgeError::InvalidInput {
          kind: "boolean operation",
          value: operation,
        });
      }
    };

    let layer_id = parse::<LayerId>(&layer_id)?;
    let (layer, contour_ids) = self
      .workspace_mut()?
      .apply_boolean_op(layer_id, cid_a, cid_b, op)?;
    let changed = GlyphChangedEntities {
      contour_ids,
      ..Default::default()
    };
    let change = GlyphStructureChange::from_layer(&layer, changed);

    self.mark_font_changed();
    Ok(change.into())
  }

  #[napi]
  pub fn remove_points(
    &mut self,
    #[napi(ts_arg_type = "LayerId")] layer_id: String,
    #[napi(ts_arg_type = "Array<PointId>")] point_ids: Vec<String>,
  ) -> errors::Result<NapiGlyphStructureChange> {
    let point_ids: BridgeResult<Vec<_>> = point_ids.iter().map(|id| parse::<PointId>(id)).collect();
    let point_ids = point_ids?;

    let layer_id = parse::<LayerId>(&layer_id)?;
    let layer = self
      .workspace_mut()?
      .remove_points(layer_id, point_ids.clone())?;
    let change = GlyphStructureChange::from_layer(&layer, GlyphChangedEntities::points(point_ids));

    self.mark_font_changed();
    Ok(change.into())
  }

  #[napi]
  pub fn toggle_smooth(
    &mut self,
    #[napi(ts_arg_type = "LayerId")] layer_id: String,
    #[napi(ts_arg_type = "PointId")] point_id: String,
  ) -> errors::Result<NapiGlyphStructureChange> {
    let parsed_id = parse::<PointId>(&point_id)?;
    let layer_id = parse::<LayerId>(&layer_id)?;
    let layer = self
      .workspace_mut()?
      .toggle_smooth(layer_id, parsed_id.clone())?;
    let changed = GlyphChangedEntities {
      point_ids: vec![parsed_id],
      ..Default::default()
    };
    let change = GlyphStructureChange::from_layer(&layer, changed);

    self.mark_font_changed();
    Ok(change.into())
  }

  /// Bulk position sync. IDs are stable typed strings from the current glyph state.
  /// Coords are interleaved [x0, y0, x1, y1, ...].
  #[napi]
  pub fn apply_position_patch(
    &mut self,
    #[napi(ts_arg_type = "LayerId")] layer_id: String,
    #[napi(ts_arg_type = "Array<PointId> | null")] point_ids: Option<Vec<String>>,
    point_coords: Option<Float64Array>,
    #[napi(ts_arg_type = "Array<AnchorId> | null")] anchor_ids: Option<Vec<String>>,
    anchor_coords: Option<Float64Array>,
  ) -> errors::Result<()> {
    let point_ids = parse_ids::<PointId>(point_ids.as_deref())?;
    let anchor_ids = parse_ids::<shift_font::AnchorId>(anchor_ids.as_deref())?;
    let point_position_changes = read_point_position_changes(point_ids.as_deref(), &point_coords)?;
    let has_anchor_updates = anchor_ids.as_ref().is_some_and(|ids| !ids.is_empty())
      || anchor_coords
        .as_ref()
        .is_some_and(|coords| !coords.is_empty());
    let layer_id = parse::<LayerId>(&layer_id)?;
    let point_id_slice = point_ids.as_deref();
    let point_coord_slice = point_coords.as_ref().map(|coords| {
      let coords: &[f64] = coords;
      coords
    });
    let anchor_id_slice = anchor_ids.as_deref();
    let anchor_coord_slice = anchor_coords.as_ref().map(|coords| {
      let coords: &[f64] = coords;
      coords
    });

    self.workspace_mut()?.apply_position_patch(
      layer_id,
      BulkNodePositionUpdates {
        point_ids: point_id_slice,
        point_coords: point_coord_slice,
        anchor_ids: anchor_id_slice,
        anchor_coords: anchor_coord_slice,
      },
      point_position_changes,
      has_anchor_updates,
    )?;

    self.mark_font_changed();
    Ok(())
  }

  #[napi]
  pub fn restore_state(
    &mut self,
    #[napi(ts_arg_type = "LayerId")] layer_id: String,
    structure: NapiGlyphStructure,
    values: Float64Array,
  ) -> errors::Result<NapiGlyphStructureChange> {
    let structure = GlyphStructure::from(structure);
    let values: &[f64] = &values;
    let layer_id = parse::<LayerId>(&layer_id)?;
    let mut layer = self
      .font()?
      .layer(layer_id.clone())
      .ok_or(shift_font::error::CoreError::LayerNotFound(
        layer_id.clone(),
      ))?
      .clone();
    apply_state_to_layer(&mut layer, &structure, values)?;
    let layer = self
      .workspace_mut()?
      .replace_layer(layer_id.clone(), layer)?;
    let change = GlyphStructureChange::from_layer(&layer, Default::default());

    self.mark_font_changed();
    Ok(change.into())
  }
}

fn parse_ids<T: BridgeParse>(ids: Option<&[String]>) -> BridgeResult<Option<Vec<T>>> {
  ids
    .map(|ids| ids.iter().map(|id| parse::<T>(id)).collect())
    .transpose()
}

fn read_point_position_changes(
  point_ids: Option<&[PointId]>,
  point_coords: &Option<Float64Array>,
) -> BridgeResult<Vec<shift_font::PointPosition>> {
  let Some(point_ids) = point_ids else {
    return Ok(Vec::new());
  };

  let point_coords = point_coords
    .as_ref()
    .ok_or_else(|| BridgeError::InvalidInput {
      kind: "point positions",
      value: "missing coordinates".to_string(),
    })?;
  let point_coords: &[f64] = point_coords;
  let expected_coords = point_ids.len() * 2;
  if point_coords.len() != expected_coords {
    return Err(BridgeError::InvalidInput {
      kind: "point positions",
      value: format!(
        "expected {expected_coords} coordinates, got {}",
        point_coords.len()
      ),
    });
  }

  Ok(
    point_ids
      .iter()
      .enumerate()
      .map(|(index, point_id)| shift_font::PointPosition {
        point_id: point_id.clone(),
        x: point_coords[index * 2],
        y: point_coords[index * 2 + 1],
      })
      .collect(),
  )
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::sync::atomic::{AtomicUsize, Ordering};

  fn glyph_handle(name: &str, unicode: Option<u32>) -> GlyphHandle {
    GlyphHandle {
      name: name.to_string(),
      unicode,
    }
  }

  static TEST_ID: AtomicUsize = AtomicUsize::new(0);

  fn skeleton_intent(kind: &str) -> NapiFontIntent {
    NapiFontIntent {
      kind: kind.to_string(),
      name: None,
      unicodes: None,
      layer_id: None,
      width: None,
    }
  }

  #[test]
  fn apply_create_glyph_returns_records_and_replace_grade_layer() {
    let mut bridge = bridge_with_workspace();

    let applied = bridge
      .apply(
        vec![NapiFontIntent {
          name: Some("A".to_string()),
          unicodes: Some(vec![65]),
          ..skeleton_intent("createGlyph")
        }],
        Some("Add Glyph".to_string()),
      )
      .unwrap();

    let glyphs = applied.glyphs.expect("createGlyph must echo records");
    assert_eq!(glyphs.len(), 1);
    assert_eq!(glyphs[0].name, "A");
    assert_eq!(applied.layers.len(), 1);
    assert!(applied.layers[0].structure.is_some());
  }

  #[test]
  fn apply_set_x_advance_echoes_values_without_structure() {
    let mut bridge = bridge_with_workspace();
    let created = bridge
      .apply(
        vec![NapiFontIntent {
          name: Some("A".to_string()),
          unicodes: Some(vec![65]),
          ..skeleton_intent("createGlyph")
        }],
        None,
      )
      .unwrap();
    let layer_id = created.layers[0].layer_id.clone();

    let applied = bridge
      .apply(
        vec![NapiFontIntent {
          layer_id: Some(layer_id.clone()),
          width: Some(642.0),
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

  fn default_source_id(bridge: &Bridge) -> String {
    bridge.get_sources().unwrap()[0].id.clone()
  }

  fn create_default_glyph_layer(bridge: &mut Bridge, name: &str, unicode: Option<u32>) -> String {
    let source_id = bridge.get_sources().unwrap()[0].id.clone();
    let unicodes = unicode.into_iter().collect();
    let glyph_id = bridge.create_glyph(name.to_string(), unicodes).unwrap();
    bridge.create_glyph_layer(glyph_id, source_id).unwrap()
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

    assert_eq!(bridge.get_glyph_count().unwrap(), 0);
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
    let layer_id = create_default_glyph_layer(&mut bridge, "A", Some(65));
    bridge.add_contour(layer_id).unwrap();

    let (_, store_path) = test_paths("reset");
    bridge.create_untitled_workspace(store_path, None).unwrap();

    assert_eq!(bridge.get_glyph_count().unwrap(), 0);
    assert!(bridge.get_axes().unwrap().is_empty());
    assert_eq!(bridge.get_sources().unwrap().len(), 1);
    assert_eq!(bridge.get_sources().unwrap()[0].name, "Regular");
  }

  #[test]
  fn save_as_assigns_a_save_target_for_untitled_workspace() {
    let mut bridge = bridge_with_workspace();
    let (source_path, _) = test_paths("save-as");

    let version = bridge.save_workspace_as(source_path.clone()).unwrap();

    assert_eq!(version, bridge.get_persisted_version());
    assert!(!bridge.is_dirty());
    assert!(std::path::PathBuf::from(source_path)
      .join("manifest.json")
      .is_file());
  }

  #[test]
  fn close_workspace_releases_active_workspace() {
    let mut bridge = bridge_with_workspace();

    bridge.close_workspace().unwrap();

    let error = match bridge.get_metadata() {
      Ok(_) => panic!("metadata read should require an open workspace after close"),
      Err(error) => error,
    };

    assert!(error.to_string().contains("no workspace is open"));
  }

  #[test]
  fn add_contour_returns_structure_change() {
    let mut bridge = bridge_with_workspace();
    let layer_id = create_default_glyph_layer(&mut bridge, "A", Some(65));

    let change = bridge.add_contour(layer_id).unwrap();

    assert_eq!(change.structure.contours.len(), 1);
    assert_eq!(change.changed.contour_ids.len(), 1);
    assert_eq!(
      change.structure.contours[0].id,
      change.changed.contour_ids[0]
    );
    assert!(change.structure.contours[0].points.is_empty());
  }

  #[test]
  fn set_x_advance_requires_existing_layer_id() {
    let mut bridge = bridge_with_workspace();
    let missing_layer_id = LayerId::new().to_string();

    let error = match bridge.set_x_advance(missing_layer_id, 640.0) {
      Ok(_) => panic!("set_x_advance should require an existing glyph layer"),
      Err(error) => error,
    };

    assert!(matches!(
      error,
      BridgeError::Workspace(_) | BridgeError::Core(_)
    ));
    assert_eq!(bridge.get_glyph_count().unwrap(), 0);
  }

  #[test]
  fn set_x_advance_updates_existing_glyph_layer() {
    let mut bridge = bridge_with_workspace();
    let layer_id = create_default_glyph_layer(&mut bridge, "A", Some(65));

    let change = bridge.set_x_advance(layer_id, 640.0).unwrap();

    assert_eq!(&change.values[..], &[640.0]);
    assert!(change.changed.contour_ids.is_empty());
    assert!(change.changed.point_ids.is_empty());
  }

  #[test]
  fn save_snapshot_includes_direct_glyph_layer_edit() {
    let mut bridge = bridge_with_workspace();
    let layer_id = create_default_glyph_layer(&mut bridge, "A", Some(65));
    let contour_id = bridge
      .add_contour(layer_id.clone())
      .unwrap()
      .changed
      .contour_ids[0]
      .clone();
    let point_id = bridge
      .add_point(
        layer_id,
        contour_id,
        10.0,
        20.0,
        NapiPointType::OnCurve,
        false,
      )
      .unwrap()
      .changed
      .point_ids[0]
      .clone();

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
  fn persisted_older_snapshot_keeps_document_dirty_after_new_edit() {
    let mut bridge = bridge_with_workspace();
    let layer_id = create_default_glyph_layer(&mut bridge, "A", Some(65));
    let contour_id = bridge
      .add_contour(layer_id.clone())
      .unwrap()
      .changed
      .contour_ids[0]
      .clone();
    let snapshot_version = bridge.live_version();

    bridge
      .add_point(
        layer_id,
        contour_id,
        10.0,
        20.0,
        NapiPointType::OnCurve,
        false,
      )
      .unwrap();
    record_persisted_version(&bridge.persisted_version, snapshot_version);

    assert!(snapshot_version.as_u32() > 0);
    assert_eq!(
      bridge.live_version().as_u32(),
      snapshot_version.as_u32() + 1
    );
    assert_eq!(bridge.get_persisted_version(), snapshot_version.as_u32());
    assert!(bridge.is_dirty());
  }

  #[test]
  fn opening_workspace_resets_persisted_version_handle_for_old_saves() {
    let mut bridge = bridge_with_workspace();
    let layer_id = create_default_glyph_layer(&mut bridge, "A", Some(65));
    bridge.add_contour(layer_id).unwrap();
    let old_persisted_version = bridge.persisted_version.clone();

    let (_, store_path) = test_paths("reopen");
    bridge.create_untitled_workspace(store_path, None).unwrap();
    record_persisted_version(&old_persisted_version, DocumentVersion(1));

    assert_eq!(bridge.get_persisted_version(), 0);
    assert!(!bridge.is_dirty());
  }

  #[test]
  fn add_point_returns_structure_and_changed_point() {
    let mut bridge = bridge_with_workspace();
    let layer_id = create_default_glyph_layer(&mut bridge, "A", Some(65));
    let contour_id = bridge
      .add_contour(layer_id.clone())
      .unwrap()
      .changed
      .contour_ids[0]
      .clone();

    let change = bridge
      .add_point(
        layer_id,
        contour_id,
        10.0,
        20.0,
        NapiPointType::OnCurve,
        false,
      )
      .unwrap();

    let points = &change.structure.contours[0].points;
    assert_eq!(change.changed.point_ids.len(), 1);
    assert_eq!(points.len(), 1);
    assert_eq!(points[0].id, change.changed.point_ids[0]);
    assert_eq!(points[0].point_type, NapiPointType::OnCurve);
    assert!(!points[0].smooth);
  }

  #[test]
  fn get_glyph_state_reads_direct_glyph_layer_edit() {
    let mut bridge = bridge_with_workspace();
    let layer_id = create_default_glyph_layer(&mut bridge, "A", Some(65));
    let contour_id = bridge
      .add_contour(layer_id.clone())
      .unwrap()
      .changed
      .contour_ids[0]
      .clone();
    bridge
      .add_point(
        layer_id.clone(),
        contour_id,
        10.0,
        20.0,
        NapiPointType::OnCurve,
        false,
      )
      .unwrap();

    let state = bridge
      .get_glyph_state(glyph_handle("A", Some(65)), default_source_id(&bridge))
      .unwrap()
      .expect("edited glyph should be readable");

    assert_eq!(bridge.get_glyphs().unwrap().len(), 1);
    assert_eq!(state.layer_id, layer_id);
    assert_eq!(state.structure.contours.len(), 1);
    assert_eq!(state.structure.contours[0].points.len(), 1);
    assert_eq!(&state.values[..], &[500.0, 10.0, 20.0]);
  }

  #[test]
  fn get_glyph_state_returns_none_for_missing_glyph() {
    let bridge = bridge_with_workspace();

    assert!(bridge
      .get_glyph_state(glyph_handle("missing", None), default_source_id(&bridge))
      .unwrap()
      .is_none());
  }

  #[test]
  fn edit_methods_require_valid_layer_id() {
    let mut bridge = bridge_with_workspace();

    let result = bridge.add_contour("not-a-layer-id".to_string());

    assert!(matches!(
      result.err().unwrap(),
      BridgeError::InvalidInput {
        kind: "layer ID",
        ..
      }
    ));
  }
}
