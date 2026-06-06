use crate::errors::{self, BridgeError, BridgeResult};
use crate::input::parse;
use napi::bindgen_prelude::*;
use napi::{Error, Status};
use napi_derive::napi;
use serde::{Deserialize, Serialize};
use shift_backends::{ExportFormat, FontExportRequest, FontExportResult, FontExporter, FontView};
use shift_font::{
  BooleanOp, BulkNodePositionUpdates, ContourId, Font, Glyph, GlyphLayer, LayerId, PointId,
  SourceId,
};
use shift_wire::{
  bridges::napi::{
    NapiAxis, NapiFontMetadata, NapiFontMetrics, NapiGlyphRecord, NapiGlyphState,
    NapiGlyphStructure, NapiGlyphStructureChange, NapiGlyphValueChange, NapiPointType, NapiSource,
  },
  interpolation::{build_glyph_variation_data, build_masters, GlyphVariationBuild},
  state::apply_state_to_layer,
  Axis, FontMetadata, FontMetrics, GlyphChangedEntities, GlyphRecord, GlyphState, GlyphStructure,
  GlyphStructureChange, GlyphValueChange, Source,
};
use shift_workspace::{FontWorkspace, GlyphLayerTarget, NewWorkspace};
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
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct GlyphLayerRef {
  pub glyph_handle: GlyphHandle,
  #[napi(ts_type = "SourceId")]
  pub source_id: String,
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

#[napi(object)]
pub struct NapiGlyphVariationDiagnosticSource {
  #[napi(ts_type = "SourceId")]
  pub id: String,
  pub index: u32,
  pub name: String,
}

#[napi(object)]
pub struct NapiGlyphVariationDiagnostic {
  #[napi(ts_type = "GlyphName")]
  pub glyph_name: String,
  pub code: String,
  pub severity: String,
  pub source: Option<NapiGlyphVariationDiagnosticSource>,
  pub message: String,
}

#[napi(object)]
pub struct NapiGlyphVariationReport {
  #[napi(ts_type = "GlyphName")]
  pub glyph_name: String,
  pub status: String,
  pub variation_data_available: bool,
  pub master_count: u32,
  pub compatible_master_count: u32,
  pub skipped_master_count: u32,
  pub diagnostics: Vec<NapiGlyphVariationDiagnostic>,
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

  fn layers(&self) -> Vec<(LayerId, &shift_font::Layer)> {
    self
      .font
      .layers()
      .iter()
      .map(|(layer_id, layer)| (*layer_id, layer))
      .collect()
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
        .values()
        .map(|glyph| glyph.as_ref())
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

    self.font.glyph(name)
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

  fn default_layer_id(&self) -> LayerId {
    self.font.default_layer_id()
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
  pub fn create_workspace(
    &mut self,
    source_path: String,
    store_path: String,
    options: Option<NapiNewWorkspace>,
  ) -> errors::Result<()> {
    self.workspace = Some(FontWorkspace::create(
      source_path,
      store_path,
      new_workspace_from_options(options),
    )?);
    self.live_version = DocumentVersion::default();
    self.persisted_version = Arc::new(AtomicU64::new(0));
    Ok(())
  }

  #[napi]
  pub fn open_workspace(&mut self, path: String, store_path: String) -> errors::Result<()> {
    self.workspace = Some(FontWorkspace::open(path, store_path)?);
    self.live_version = DocumentVersion::default();
    self.persisted_version = Arc::new(AtomicU64::new(0));
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
      .values()
      .map(|glyph| glyph.as_ref())
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
  pub fn get_glyph_variation_report(
    &self,
    glyph_ref: GlyphHandle,
  ) -> Option<NapiGlyphVariationReport> {
    let glyph = self.glyph_for_read(&glyph_ref.name).ok()??;
    self
      .variation_report_for_glyph(&glyph_ref.name, &glyph)
      .ok()
  }

  #[napi]
  pub fn get_variation_reports(&self) -> errors::Result<Vec<NapiGlyphVariationReport>> {
    let mut glyph_names: Vec<String> = self
      .font()?
      .glyphs()
      .keys()
      .map(|glyph_name| glyph_name.to_string())
      .collect();
    glyph_names.sort();

    Ok(
      glyph_names
        .into_iter()
        .filter_map(|glyph_name| {
          self
            .glyph_for_read(&glyph_name)
            .ok()
            .flatten()
            .and_then(|glyph| self.variation_report_for_glyph(&glyph_name, &glyph).ok())
        })
        .collect(),
    )
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
    Ok(self.font()?.glyph(glyph_name).cloned())
  }

  fn glyph_layer_target(&self, glyph_ref: GlyphLayerRef) -> BridgeResult<GlyphLayerTarget> {
    let source_id = parse::<SourceId>(&glyph_ref.source_id)?;
    if !self
      .font()?
      .sources()
      .iter()
      .any(|source| source.id() == source_id)
    {
      return Err(BridgeError::InvalidInput {
        kind: "source ID",
        value: source_id.to_string(),
      });
    }

    let layer_id = self
      .font()?
      .glyph(&glyph_ref.glyph_handle.name)
      .and_then(|glyph| glyph.layer_for_source(source_id))
      .map(GlyphLayer::id)
      .unwrap_or_else(LayerId::new);

    Ok(GlyphLayerTarget {
      glyph_name: glyph_ref.glyph_handle.name,
      unicode: glyph_ref.glyph_handle.unicode,
      source_id,
      layer_id,
    })
  }

  fn edit_glyph_layer<R>(
    &mut self,
    glyph_ref: GlyphLayerRef,
    edit: impl FnOnce(&mut GlyphLayer) -> std::result::Result<R, shift_font::error::CoreError>,
    changes: impl FnOnce(
      &shift_font::GlyphLayerChangeTarget,
      &GlyphLayer,
      &R,
    ) -> shift_font::FontChangeSet,
  ) -> BridgeResult<R> {
    let target = self.glyph_layer_target(glyph_ref)?;
    Ok(
      self
        .workspace_mut()?
        .edit_glyph_layer(target, edit, changes)?,
    )
  }

  fn one_change(change: shift_font::FontChange) -> shift_font::FontChangeSet {
    shift_font::FontChangeSet::new(vec![change])
  }

  fn layer_replaced_change(
    target: &shift_font::GlyphLayerChangeTarget,
    layer: &GlyphLayer,
    _result: &impl Sized,
  ) -> shift_font::FontChangeSet {
    Self::one_change(shift_font::FontChange::LayerGeometryReplaced(
      shift_font::LayerGeometryReplaced {
        target: target.clone(),
        layer: shift_font::GlyphLayerValue::from(layer),
      },
    ))
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

  fn variation_diagnostics_for_build(
    glyph_name: &str,
    build: &GlyphVariationBuild,
  ) -> Vec<NapiGlyphVariationDiagnostic> {
    let mut diagnostics = Vec::new();

    if build.missing_default_source {
      diagnostics.push(NapiGlyphVariationDiagnostic {
        glyph_name: glyph_name.to_string(),
        code: "missing-default-source".to_string(),
        severity: "error".to_string(),
        source: None,
        message: "glyph has variation masters, but none belongs to the default source".to_string(),
      });
    }

    diagnostics.extend(
      build
        .source_errors
        .iter()
        .map(|error| NapiGlyphVariationDiagnostic {
          glyph_name: glyph_name.to_string(),
          code: "incompatible-source".to_string(),
          severity: "warning".to_string(),
          source: Some(NapiGlyphVariationDiagnosticSource {
            id: error.source_id.clone(),
            index: error.source_index.min(u32::MAX as usize) as u32,
            name: error.source_name.clone(),
          }),
          message: error.message.clone(),
        }),
    );

    if let Some(message) = &build.model_error {
      diagnostics.push(NapiGlyphVariationDiagnostic {
        glyph_name: glyph_name.to_string(),
        code: "variation-model-failed".to_string(),
        severity: "error".to_string(),
        source: None,
        message: message.clone(),
      });
    }

    diagnostics
  }

  fn variation_report_for_glyph(
    &self,
    glyph_name: &str,
    glyph: &Glyph,
  ) -> BridgeResult<NapiGlyphVariationReport> {
    let Some((master_count, build)) = self.variation_build_for_glyph(glyph)? else {
      return Ok(NapiGlyphVariationReport {
        glyph_name: glyph_name.to_string(),
        status: "static".to_string(),
        variation_data_available: false,
        master_count: 0,
        compatible_master_count: 0,
        skipped_master_count: 0,
        diagnostics: Vec::new(),
      });
    };

    let diagnostics = Self::variation_diagnostics_for_build(glyph_name, &build);
    let skipped_master_count = build.source_errors.len();
    let compatible_master_count = if build.missing_default_source {
      0
    } else {
      master_count.saturating_sub(skipped_master_count)
    };
    let variation_data_available = build.variation_data.is_some();
    let status = match (
      variation_data_available,
      skipped_master_count > 0 || !diagnostics.is_empty(),
    ) {
      (true, false) => "variable",
      (true, true) => "partial",
      (false, _) => "unavailable",
    };

    Ok(NapiGlyphVariationReport {
      glyph_name: glyph_name.to_string(),
      status: status.to_string(),
      variation_data_available,
      master_count: master_count.min(u32::MAX as usize) as u32,
      compatible_master_count: compatible_master_count.min(u32::MAX as usize) as u32,
      skipped_master_count: skipped_master_count.min(u32::MAX as usize) as u32,
      diagnostics,
    })
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

  #[napi]
  pub fn set_x_advance(
    &mut self,
    glyph_ref: GlyphLayerRef,
    width: f64,
  ) -> errors::Result<NapiGlyphValueChange> {
    let change = self.edit_glyph_layer(
      glyph_ref,
      |layer| {
        layer.set_x_advance(width);
        Ok(GlyphValueChange::from_layer(layer, Default::default()))
      },
      |target, layer, _change| {
        Self::one_change(shift_font::FontChange::LayerMetricsChanged(
          shift_font::LayerMetricsChanged::from_layer(target.clone(), layer),
        ))
      },
    )?;

    self.mark_font_changed();
    Ok(change.into())
  }

  #[napi]
  pub fn translate_layer(
    &mut self,
    glyph_ref: GlyphLayerRef,
    dx: f64,
    dy: f64,
  ) -> errors::Result<NapiGlyphValueChange> {
    let change = self.edit_glyph_layer(
      glyph_ref,
      |layer| {
        layer.translate_layer(dx, dy);
        Ok(GlyphValueChange::from_layer(layer, Default::default()))
      },
      Self::layer_replaced_change,
    )?;

    self.mark_font_changed();
    Ok(change.into())
  }

  #[napi]
  pub fn add_point(
    &mut self,
    glyph_ref: GlyphLayerRef,
    #[napi(ts_arg_type = "ContourId")] contour_id: String,
    x: f64,
    y: f64,
    point_type: NapiPointType,
    smooth: bool,
  ) -> errors::Result<NapiGlyphStructureChange> {
    let contour_id = parse::<ContourId>(&contour_id)?;
    let point_type = point_type.into();

    let change = self.edit_glyph_layer(
      glyph_ref,
      |layer| {
        let point_id = layer.add_point_to_contour(contour_id, x, y, point_type, smooth)?;
        let changed = GlyphChangedEntities {
          point_ids: vec![point_id],
          ..Default::default()
        };
        Ok(GlyphStructureChange::from_layer(layer, changed))
      },
      move |target, layer, change| {
        let contour = layer
          .contour(contour_id)
          .map(shift_font::ContourValue::from);
        contour
          .map(|contour| {
            Self::one_change(shift_font::FontChange::PointsAdded(
              shift_font::PointsAdded {
                target: target.clone(),
                contour,
                point_ids: change.changed.point_ids.clone(),
              },
            ))
          })
          .unwrap_or_default()
      },
    )?;

    self.mark_font_changed();
    Ok(change.into())
  }

  #[napi]
  pub fn insert_point_before(
    &mut self,
    glyph_ref: GlyphLayerRef,
    #[napi(ts_arg_type = "PointId")] before_point_id: String,
    x: f64,
    y: f64,
    point_type: NapiPointType,
    smooth: bool,
  ) -> errors::Result<NapiGlyphStructureChange> {
    let before_point_id = parse::<PointId>(&before_point_id)?;
    let point_type = point_type.into();

    let change = self.edit_glyph_layer(
      glyph_ref,
      |layer| {
        let point_id = layer.insert_point_before(before_point_id, x, y, point_type, smooth)?;
        let changed = GlyphChangedEntities {
          point_ids: vec![point_id],
          ..Default::default()
        };
        Ok(GlyphStructureChange::from_layer(layer, changed))
      },
      move |target, layer, change| {
        let Some(contour_id) = layer.find_point_contour(before_point_id) else {
          return Self::layer_replaced_change(target, layer, change);
        };
        let Some(contour) = layer
          .contour(contour_id)
          .map(shift_font::ContourValue::from)
        else {
          return Self::layer_replaced_change(target, layer, change);
        };
        Self::one_change(shift_font::FontChange::PointsAdded(
          shift_font::PointsAdded {
            target: target.clone(),
            contour,
            point_ids: change.changed.point_ids.clone(),
          },
        ))
      },
    )?;

    self.mark_font_changed();
    Ok(change.into())
  }

  #[napi]
  pub fn add_contour(&mut self, glyph_ref: GlyphLayerRef) -> Result<NapiGlyphStructureChange> {
    let change = self.edit_glyph_layer(
      glyph_ref,
      |layer| {
        let contour_id = layer.add_empty_contour();
        let changed = GlyphChangedEntities {
          contour_ids: vec![contour_id],
          ..Default::default()
        };
        Ok(GlyphStructureChange::from_layer(layer, changed))
      },
      |target, layer, change| {
        let Some(contour) = layer
          .contours_iter()
          .last()
          .map(shift_font::ContourValue::from)
        else {
          return Self::layer_replaced_change(target, layer, change);
        };
        Self::one_change(shift_font::FontChange::ContourAdded(
          shift_font::ContourAdded {
            target: target.clone(),
            contour,
          },
        ))
      },
    )?;

    self.mark_font_changed();
    Ok(change.into())
  }

  #[napi]
  pub fn open_contour(
    &mut self,
    glyph_ref: GlyphLayerRef,
    #[napi(ts_arg_type = "ContourId")] contour_id: String,
  ) -> errors::Result<NapiGlyphStructureChange> {
    let contour_id = parse::<ContourId>(&contour_id)?;
    let change = self.edit_glyph_layer(
      glyph_ref,
      |layer| {
        layer.open_contour(contour_id)?;
        let changed = GlyphChangedEntities {
          contour_ids: vec![contour_id],
          ..Default::default()
        };
        Ok(GlyphStructureChange::from_layer(layer, changed))
      },
      move |target, _layer, _change| {
        Self::one_change(shift_font::FontChange::ContourOpenClosedChanged(
          shift_font::ContourOpenClosedChanged {
            target: target.clone(),
            contour_id,
            closed: false,
          },
        ))
      },
    )?;

    self.mark_font_changed();
    Ok(change.into())
  }

  #[napi]
  pub fn close_contour(
    &mut self,
    glyph_ref: GlyphLayerRef,
    #[napi(ts_arg_type = "ContourId")] contour_id: String,
  ) -> errors::Result<NapiGlyphStructureChange> {
    let contour_id = parse::<ContourId>(&contour_id)?;
    let change = self.edit_glyph_layer(
      glyph_ref,
      |layer| {
        layer.close_contour(contour_id)?;
        let changed = GlyphChangedEntities {
          contour_ids: vec![contour_id],
          ..Default::default()
        };
        Ok(GlyphStructureChange::from_layer(layer, changed))
      },
      move |target, _layer, _change| {
        Self::one_change(shift_font::FontChange::ContourOpenClosedChanged(
          shift_font::ContourOpenClosedChanged {
            target: target.clone(),
            contour_id,
            closed: true,
          },
        ))
      },
    )?;

    self.mark_font_changed();
    Ok(change.into())
  }

  #[napi]
  pub fn reverse_contour(
    &mut self,
    glyph_ref: GlyphLayerRef,
    #[napi(ts_arg_type = "ContourId")] contour_id: String,
  ) -> errors::Result<NapiGlyphStructureChange> {
    let contour_id = parse::<ContourId>(&contour_id)?;
    let change = self.edit_glyph_layer(
      glyph_ref,
      |layer| {
        layer.reverse_contour(contour_id)?;
        let changed = GlyphChangedEntities {
          contour_ids: vec![contour_id],
          ..Default::default()
        };
        Ok(GlyphStructureChange::from_layer(layer, changed))
      },
      Self::layer_replaced_change,
    )?;

    self.mark_font_changed();
    Ok(change.into())
  }

  #[napi]
  pub fn apply_boolean_op(
    &mut self,
    glyph_ref: GlyphLayerRef,
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

    let change = self.edit_glyph_layer(
      glyph_ref,
      |layer| {
        let created_ids = layer.apply_boolean_op(cid_a, cid_b, op)?;
        let changed = GlyphChangedEntities {
          contour_ids: created_ids,
          ..Default::default()
        };
        Ok(GlyphStructureChange::from_layer(layer, changed))
      },
      Self::layer_replaced_change,
    )?;

    self.mark_font_changed();
    Ok(change.into())
  }

  #[napi]
  pub fn remove_points(
    &mut self,
    glyph_ref: GlyphLayerRef,
    #[napi(ts_arg_type = "Array<PointId>")] point_ids: Vec<String>,
  ) -> errors::Result<NapiGlyphStructureChange> {
    let point_ids: BridgeResult<Vec<_>> = point_ids.iter().map(|id| parse::<PointId>(id)).collect();
    let point_ids = point_ids?;

    let change = self.edit_glyph_layer(
      glyph_ref,
      |layer| {
        layer.remove_points(&point_ids)?;
        let changed = GlyphChangedEntities::points(point_ids);
        Ok(GlyphStructureChange::from_layer(layer, changed))
      },
      Self::layer_replaced_change,
    )?;

    self.mark_font_changed();
    Ok(change.into())
  }

  #[napi]
  pub fn toggle_smooth(
    &mut self,
    glyph_ref: GlyphLayerRef,
    #[napi(ts_arg_type = "PointId")] point_id: String,
  ) -> errors::Result<NapiGlyphStructureChange> {
    let parsed_id = parse::<PointId>(&point_id)?;
    let change = self.edit_glyph_layer(
      glyph_ref,
      |layer| {
        layer.toggle_smooth(parsed_id)?;
        let changed = GlyphChangedEntities {
          point_ids: vec![parsed_id],
          ..Default::default()
        };
        Ok(GlyphStructureChange::from_layer(layer, changed))
      },
      move |target, layer, change| {
        let smooth = layer
          .contours_iter()
          .find_map(|contour| contour.get_point(parsed_id))
          .map(|point| point.is_smooth());
        smooth
          .map(|smooth| {
            Self::one_change(shift_font::FontChange::PointSmoothChanged(
              shift_font::PointSmoothChanged {
                target: target.clone(),
                point_id: parsed_id,
                smooth,
              },
            ))
          })
          .unwrap_or_else(|| Self::layer_replaced_change(target, layer, change))
      },
    )?;

    self.mark_font_changed();
    Ok(change.into())
  }

  /// Bulk position sync. IDs use BigUint64Array to avoid lossy float packing.
  /// Coords are interleaved [x0, y0, x1, y1, ...].
  #[napi]
  pub fn apply_position_patch(
    &mut self,
    glyph_ref: GlyphLayerRef,
    point_ids: Option<BigUint64Array>,
    point_coords: Option<Float64Array>,
    anchor_ids: Option<BigUint64Array>,
    anchor_coords: Option<Float64Array>,
  ) -> errors::Result<()> {
    let point_position_changes = read_point_position_changes(&point_ids, &point_coords)?;
    let has_anchor_updates = anchor_ids.as_ref().is_some_and(|ids| !ids.is_empty())
      || anchor_coords
        .as_ref()
        .is_some_and(|coords| !coords.is_empty());

    self.edit_glyph_layer(
      glyph_ref,
      |layer| {
        layer.apply_bulk_node_positions(BulkNodePositionUpdates {
          point_ids: point_ids.as_ref().map(|ids| {
            let ids: &[u64] = ids;
            ids
          }),
          point_coords: point_coords.as_ref().map(|coords| {
            let coords: &[f64] = coords;
            coords
          }),
          anchor_ids: anchor_ids.as_ref().map(|ids| {
            let ids: &[u64] = ids;
            ids
          }),
          anchor_coords: anchor_coords.as_ref().map(|coords| {
            let coords: &[f64] = coords;
            coords
          }),
        })?;
        Ok(())
      },
      move |target, layer, result| {
        if has_anchor_updates {
          return Self::layer_replaced_change(target, layer, result);
        }

        Self::one_change(shift_font::FontChange::PointPositionsChanged(
          shift_font::PointPositionsChanged {
            target: target.clone(),
            points: point_position_changes,
          },
        ))
      },
    )?;

    self.mark_font_changed();
    Ok(())
  }

  #[napi]
  pub fn restore_state(
    &mut self,
    glyph_ref: GlyphLayerRef,
    structure: NapiGlyphStructure,
    values: Float64Array,
  ) -> errors::Result<NapiGlyphStructureChange> {
    let structure = GlyphStructure::from(structure);
    let values: &[f64] = &values;

    let change = self.edit_glyph_layer(
      glyph_ref,
      |layer| {
        apply_state_to_layer(layer, &structure, values)?;
        Ok(GlyphStructureChange::from_layer(layer, Default::default()))
      },
      Self::layer_replaced_change,
    )?;

    self.mark_font_changed();
    Ok(change.into())
  }
}

fn read_point_position_changes(
  point_ids: &Option<BigUint64Array>,
  point_coords: &Option<Float64Array>,
) -> BridgeResult<Vec<shift_font::PointPosition>> {
  let Some(point_ids) = point_ids.as_ref() else {
    return Ok(Vec::new());
  };

  let point_ids: &[u64] = point_ids;
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
        point_id: PointId::from_raw(*point_id as u128),
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
    let (source_path, store_path) = test_paths("workspace");
    bridge
      .create_workspace(source_path, store_path, None)
      .unwrap();
    bridge
  }

  fn default_source_id(bridge: &Bridge) -> String {
    bridge.get_sources().unwrap()[0].id.clone()
  }

  fn default_layer_ref(bridge: &Bridge, name: &str, unicode: Option<u32>) -> GlyphLayerRef {
    GlyphLayerRef {
      glyph_handle: glyph_handle(name, unicode),
      source_id: bridge.get_sources().unwrap()[0].id.clone(),
    }
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
  fn create_workspace_exposes_empty_font_state() {
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
  fn create_workspace_resets_to_fresh_font_state() {
    let mut bridge = bridge_with_workspace();
    bridge
      .set_x_advance(default_layer_ref(&bridge, "A", Some(65)), 500.0)
      .unwrap();

    let (source_path, store_path) = test_paths("reset");
    bridge
      .create_workspace(source_path, store_path, None)
      .unwrap();

    assert_eq!(bridge.get_glyph_count().unwrap(), 0);
    assert!(bridge.get_axes().unwrap().is_empty());
    assert_eq!(bridge.get_sources().unwrap().len(), 1);
    assert_eq!(bridge.get_sources().unwrap()[0].name, "Regular");
  }

  #[test]
  fn add_contour_returns_structure_change() {
    let mut bridge = bridge_with_workspace();
    let glyph_ref = default_layer_ref(&bridge, "A", Some(65));

    let change = bridge.add_contour(glyph_ref).unwrap();

    assert_eq!(change.structure.contours.len(), 1);
    assert_eq!(change.changed.contour_ids.len(), 1);
    assert_eq!(
      change.structure.contours[0].id,
      change.changed.contour_ids[0]
    );
    assert!(change.structure.contours[0].points.is_empty());
  }

  #[test]
  fn save_snapshot_includes_direct_glyph_layer_edit() {
    let mut bridge = bridge_with_workspace();
    let glyph_ref = default_layer_ref(&bridge, "A", Some(65));
    let contour_id = bridge
      .add_contour(glyph_ref.clone())
      .unwrap()
      .changed
      .contour_ids[0]
      .clone();
    let point_id = bridge
      .add_point(
        glyph_ref,
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
  fn open_workspace_imports_designspace_fonts() {
    let mut bridge = Bridge::new();
    let (_, store_path) = test_paths("import");
    let designspace_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
      .join("../..")
      .join("fixtures/fonts/mutatorsans-variable/MutatorSans.designspace");

    bridge
      .open_workspace(designspace_path.to_string_lossy().into_owned(), store_path)
      .unwrap();

    assert!(bridge.get_glyph_count().unwrap() > 0);
    assert!(bridge.is_variable().unwrap());
  }

  #[test]
  fn persisted_older_snapshot_keeps_document_dirty_after_new_edit() {
    let mut bridge = bridge_with_workspace();
    let glyph_ref = default_layer_ref(&bridge, "A", Some(65));
    let contour_id = bridge
      .add_contour(glyph_ref.clone())
      .unwrap()
      .changed
      .contour_ids[0]
      .clone();
    let snapshot_version = bridge.live_version();

    bridge
      .add_point(
        glyph_ref,
        contour_id,
        10.0,
        20.0,
        NapiPointType::OnCurve,
        false,
      )
      .unwrap();
    record_persisted_version(&bridge.persisted_version, snapshot_version);

    assert_eq!(snapshot_version.as_u32(), 1);
    assert_eq!(bridge.live_version().as_u32(), 2);
    assert_eq!(bridge.get_persisted_version(), 1);
    assert!(bridge.is_dirty());
  }

  #[test]
  fn opening_workspace_resets_persisted_version_handle_for_old_saves() {
    let mut bridge = bridge_with_workspace();
    let glyph_ref = default_layer_ref(&bridge, "A", Some(65));
    bridge.add_contour(glyph_ref).unwrap();
    let old_persisted_version = bridge.persisted_version.clone();

    let (source_path, store_path) = test_paths("reopen");
    bridge
      .create_workspace(source_path, store_path, None)
      .unwrap();
    record_persisted_version(&old_persisted_version, DocumentVersion(1));

    assert_eq!(bridge.get_persisted_version(), 0);
    assert!(!bridge.is_dirty());
  }

  #[test]
  fn add_point_returns_structure_and_changed_point() {
    let mut bridge = bridge_with_workspace();
    let glyph_ref = default_layer_ref(&bridge, "A", Some(65));
    let contour_id = bridge
      .add_contour(glyph_ref.clone())
      .unwrap()
      .changed
      .contour_ids[0]
      .clone();

    let change = bridge
      .add_point(
        glyph_ref,
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
    let glyph_ref = default_layer_ref(&bridge, "A", Some(65));
    let contour_id = bridge
      .add_contour(glyph_ref.clone())
      .unwrap()
      .changed
      .contour_ids[0]
      .clone();
    bridge
      .add_point(
        glyph_ref,
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
  fn edit_methods_require_valid_layer_ref() {
    let mut bridge = bridge_with_workspace();

    let result = bridge.add_contour(GlyphLayerRef {
      glyph_handle: glyph_handle("A", Some(65)),
      source_id: "not-a-source-id".to_string(),
    });

    assert!(result.err().unwrap().reason.contains("invalid source ID"));
  }
}
