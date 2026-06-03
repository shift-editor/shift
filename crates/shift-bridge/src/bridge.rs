use crate::errors::{self, BridgeError, BridgeResult};
use crate::input::parse;
use napi::bindgen_prelude::*;
use napi::{Error, Status};
use napi_derive::napi;
use serde::{Deserialize, Serialize};
use shift_backends::{
  font_loader::FontLoader, ExportFormat, FontExportRequest, FontExportResult, FontExporter,
  FontView,
};
use shift_font::{
  BooleanOp, BulkNodePositionUpdates, ContourId, Font, Glyph, GlyphLayer, GlyphName, LayerId,
  PointId, SourceId,
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
  #[napi(ts_type = "LayerId")]
  pub layer_id: String,
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
  version: DocumentVersion,
  font: Font,
  active_glyph_override: Option<Arc<Glyph>>,
}

impl FontSaveSnapshot {
  fn new(version: DocumentVersion, font: Font, active_glyph_override: Option<Glyph>) -> Self {
    Self {
      version,
      font,
      active_glyph_override: active_glyph_override.map(Arc::new),
    }
  }

  fn version(&self) -> DocumentVersion {
    self.version
  }

  fn to_font(&self) -> Font {
    let mut font = self.font.clone();
    if let Some(active_glyph) = self.active_glyph_override.as_ref() {
      font.put_glyph(active_glyph.as_ref().clone());
    }
    font
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

pub struct SaveFontTask {
  snapshot: FontSaveSnapshot,
  persisted_version: SharedPersistedVersion,
  path: String,
}

impl Task for SaveFontTask {
  type Output = DocumentVersion;
  type JsValue = u32;

  fn compute(&mut self) -> Result<Self::Output> {
    let font = self.snapshot.to_font();
    FontLoader::new()
      .write_font(&font, &self.path)
      .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

    Ok(self.snapshot.version())
  }

  fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
    record_persisted_version(&self.persisted_version, output);
    Ok(output.as_u32())
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
  font_loader: FontLoader,
  font: Font,
  live_version: DocumentVersion,
  persisted_version: SharedPersistedVersion,
}

#[napi]
impl Bridge {
  #[napi(constructor)]
  pub fn new() -> Self {
    Self {
      font_loader: FontLoader::new(),
      font: Font::default(),
      live_version: DocumentVersion::default(),
      persisted_version: Arc::new(AtomicU64::new(0)),
    }
  }

  #[napi]
  pub fn create_font(&mut self) {
    self.font = Font::new();
    self.live_version = DocumentVersion::default();
    self.persisted_version = Arc::new(AtomicU64::new(0));
  }

  #[napi]
  pub fn load_font(&mut self, path: String) -> errors::Result<()> {
    self.font = self.font_loader.read_font(&path)?;
    self.live_version = DocumentVersion::default();
    self.persisted_version = Arc::new(AtomicU64::new(0));
    Ok(())
  }

  #[napi(ts_return_type = "Promise<number>")]
  pub fn save_font(&mut self, path: String) -> AsyncTask<SaveFontTask> {
    AsyncTask::new(SaveFontTask {
      snapshot: self.save_snapshot(),
      persisted_version: self.persisted_version.clone(),
      path,
    })
  }

  #[napi(ts_return_type = "Promise<NapiFontExportResult>")]
  pub fn export_font(
    &mut self,
    request: NapiFontExportRequest,
  ) -> Result<AsyncTask<ExportFontTask>> {
    Ok(AsyncTask::new(ExportFontTask {
      snapshot: self.save_snapshot(),
      request: request.try_into()?,
    }))
  }

  #[napi]
  pub fn get_metadata(&self) -> NapiFontMetadata {
    FontMetadata::from(self.font.metadata()).into()
  }

  #[napi]
  pub fn get_metrics(&self) -> NapiFontMetrics {
    FontMetrics::from(self.font.metrics()).into()
  }

  #[napi]
  pub fn get_glyph_count(&self) -> u32 {
    self.font.glyph_count() as u32
  }

  #[napi]
  pub fn get_glyphs(&self) -> Vec<NapiGlyphRecord> {
    let mut records: Vec<_> = self
      .font
      .glyphs()
      .values()
      .map(|glyph| glyph.as_ref())
      .map(GlyphRecord::from)
      .map(Into::into)
      .collect();
    records.sort_by(|a: &NapiGlyphRecord, b: &NapiGlyphRecord| a.name.cmp(&b.name));
    records
  }

  #[napi]
  pub fn update_glyph_identity(
    &mut self,
    #[napi(ts_arg_type = "GlyphName")] from_name: String,
    #[napi(ts_arg_type = "GlyphName")] name: String,
    #[napi(ts_arg_type = "Array<Unicode>")] unicodes: Vec<u32>,
  ) -> errors::Result<()> {
    let name = name.trim();

    let existing = self
      .font
      .glyph(&from_name)
      .ok_or_else(|| BridgeError::InvalidInput {
        kind: "glyph name",
        value: from_name.clone(),
      })?;
    if from_name == name && existing.unicodes() == unicodes.as_slice() {
      return Ok(());
    }

    if name.is_empty() {
      return Err(BridgeError::InvalidInput {
        kind: "glyph name",
        value: name.to_string(),
      });
    }

    if from_name != name && self.font.glyph(name).is_some() {
      return Err(BridgeError::InvalidInput {
        kind: "glyph name",
        value: format!("{name} already exists"),
      });
    }

    let Some(mut glyph) = self.font.take_glyph(&from_name) else {
      return Err(BridgeError::InvalidInput {
        kind: "glyph name",
        value: from_name,
      });
    };

    let glyph_name = GlyphName::new(name.to_string()).map_err(|_| BridgeError::InvalidInput {
      kind: "glyph name",
      value: name.to_string(),
    })?;

    glyph.set_name(glyph_name);
    glyph.set_unicodes(unicodes);
    self.font.put_glyph(glyph);
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
    let layer_id = self.source_layer_id(source_id)?;

    let glyph = match self.glyph_for_read(&glyph_handle.name) {
      Some(glyph) => glyph,
      None => return Ok(None),
    };
    let layer = match glyph.layer(layer_id) {
      Some(layer) => layer,
      None => return Ok(None),
    };

    let variation_data = self
      .variation_build_for_glyph(&glyph)
      .and_then(|(_, build)| build.variation_data);

    Ok(Some(GlyphState::from_layer(layer, variation_data).into()))
  }

  #[napi]
  pub fn get_glyph_variation_report(
    &self,
    glyph_ref: GlyphHandle,
  ) -> Option<NapiGlyphVariationReport> {
    let glyph = self.glyph_for_read(&glyph_ref.name)?;
    Some(self.variation_report_for_glyph(&glyph_ref.name, &glyph))
  }

  #[napi]
  pub fn get_variation_reports(&self) -> Vec<NapiGlyphVariationReport> {
    let mut glyph_names: Vec<String> = self
      .font
      .glyphs()
      .keys()
      .map(|glyph_name| glyph_name.to_string())
      .collect();
    glyph_names.sort();

    glyph_names
      .into_iter()
      .filter_map(|glyph_name| {
        self
          .glyph_for_read(&glyph_name)
          .map(|glyph| self.variation_report_for_glyph(&glyph_name, &glyph))
      })
      .collect()
  }

  #[napi]
  pub fn is_variable(&self) -> bool {
    self.font.is_variable()
  }

  #[napi]
  pub fn get_axes(&self) -> Vec<NapiAxis> {
    self
      .font
      .axes()
      .iter()
      .map(Axis::from)
      .map(Into::into)
      .collect()
  }

  #[napi]
  pub fn get_sources(&self) -> Vec<NapiSource> {
    self
      .font
      .sources()
      .iter()
      .map(Source::from)
      .map(Into::into)
      .collect()
  }

  fn source_layer_id(&self, source_id: SourceId) -> BridgeResult<LayerId> {
    if let Some(source) = self
      .font
      .sources()
      .iter()
      .find(|source| source.id() == source_id)
    {
      return Ok(source.layer_id());
    }

    Err(BridgeError::InvalidInput {
      kind: "source ID",
      value: source_id.to_string(),
    })
  }

  fn save_snapshot(&self) -> FontSaveSnapshot {
    FontSaveSnapshot::new(self.live_version(), self.font.clone(), None)
  }

  fn glyph_for_read(&self, glyph_name: &str) -> Option<Glyph> {
    self.font.glyph(glyph_name).cloned()
  }

  fn editable_layer_mut(&mut self, glyph_ref: GlyphLayerRef) -> BridgeResult<&mut GlyphLayer> {
    let layer_id = parse::<LayerId>(&glyph_ref.layer_id)?;
    let glyph_name = glyph_ref.glyph_handle.name;
    let unicode = glyph_ref.glyph_handle.unicode;

    if self.font.glyph(&glyph_name).is_none() {
      let mut glyph = Glyph::new(glyph_name.clone());
      if let Some(unicode) = unicode {
        glyph.add_unicode(unicode);
      }
      glyph.set_layer(layer_id, GlyphLayer::with_width(500.0));
      self.font.insert_glyph(glyph);
    }

    let glyph = self
      .font
      .glyph_mut(&glyph_name)
      .ok_or_else(|| BridgeError::InvalidInput {
        kind: "glyph name",
        value: glyph_name.clone(),
      })?;

    if let Some(unicode) = unicode {
      glyph.add_unicode(unicode);
    }

    Ok(glyph.get_or_create_layer(layer_id))
  }

  fn variation_build_for_glyph(&self, glyph: &Glyph) -> Option<(usize, GlyphVariationBuild)> {
    build_masters(&self.font, glyph).map(|masters| {
      let master_count = masters.len();
      let build = build_glyph_variation_data(&masters, self.font.axes());
      (master_count, build)
    })
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
  ) -> NapiGlyphVariationReport {
    let Some((master_count, build)) = self.variation_build_for_glyph(glyph) else {
      return NapiGlyphVariationReport {
        glyph_name: glyph_name.to_string(),
        status: "static".to_string(),
        variation_data_available: false,
        master_count: 0,
        compatible_master_count: 0,
        skipped_master_count: 0,
        diagnostics: Vec::new(),
      };
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

    NapiGlyphVariationReport {
      glyph_name: glyph_name.to_string(),
      status: status.to_string(),
      variation_data_available,
      master_count: master_count.min(u32::MAX as usize) as u32,
      compatible_master_count: compatible_master_count.min(u32::MAX as usize) as u32,
      skipped_master_count: skipped_master_count.min(u32::MAX as usize) as u32,
      diagnostics,
    }
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
    let change = {
      let layer = self.editable_layer_mut(glyph_ref)?;
      layer.set_x_advance(width);
      GlyphValueChange::from_layer(layer, Default::default())
    };

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
    let change = {
      let layer = self.editable_layer_mut(glyph_ref)?;
      layer.translate_layer(dx, dy);
      GlyphValueChange::from_layer(layer, Default::default())
    };

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

    let change = {
      let layer = self.editable_layer_mut(glyph_ref)?;
      let point_id = layer.add_point_to_contour(contour_id, x, y, point_type, smooth)?;
      let changed = GlyphChangedEntities {
        point_ids: vec![point_id],
        ..Default::default()
      };
      GlyphStructureChange::from_layer(layer, changed)
    };

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

    let change = {
      let layer = self.editable_layer_mut(glyph_ref)?;
      let point_id = layer.insert_point_before(before_point_id, x, y, point_type, smooth)?;
      let changed = GlyphChangedEntities {
        point_ids: vec![point_id],
        ..Default::default()
      };
      GlyphStructureChange::from_layer(layer, changed)
    };

    self.mark_font_changed();
    Ok(change.into())
  }

  #[napi]
  pub fn add_contour(&mut self, glyph_ref: GlyphLayerRef) -> Result<NapiGlyphStructureChange> {
    let change = {
      let layer = self.editable_layer_mut(glyph_ref)?;
      let contour_id = layer.add_empty_contour();
      let changed = GlyphChangedEntities {
        contour_ids: vec![contour_id],
        ..Default::default()
      };
      GlyphStructureChange::from_layer(layer, changed)
    };

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
    let change = {
      let layer = self.editable_layer_mut(glyph_ref)?;
      layer.open_contour(contour_id)?;
      let changed = GlyphChangedEntities {
        contour_ids: vec![contour_id],
        ..Default::default()
      };
      GlyphStructureChange::from_layer(layer, changed)
    };

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
    let change = {
      let layer = self.editable_layer_mut(glyph_ref)?;
      layer.close_contour(contour_id)?;
      let changed = GlyphChangedEntities {
        contour_ids: vec![contour_id],
        ..Default::default()
      };
      GlyphStructureChange::from_layer(layer, changed)
    };

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
    let change = {
      let layer = self.editable_layer_mut(glyph_ref)?;
      layer.reverse_contour(contour_id)?;
      let changed = GlyphChangedEntities {
        contour_ids: vec![contour_id],
        ..Default::default()
      };
      GlyphStructureChange::from_layer(layer, changed)
    };

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

    let change = {
      let layer = self.editable_layer_mut(glyph_ref)?;
      let created_ids = layer.apply_boolean_op(cid_a, cid_b, op)?;
      let changed = GlyphChangedEntities {
        contour_ids: created_ids,
        ..Default::default()
      };
      GlyphStructureChange::from_layer(layer, changed)
    };

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

    let change = {
      let layer = self.editable_layer_mut(glyph_ref)?;
      layer.remove_points(&point_ids)?;
      let changed = GlyphChangedEntities::points(point_ids);
      GlyphStructureChange::from_layer(layer, changed)
    };

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
    let change = {
      let layer = self.editable_layer_mut(glyph_ref)?;
      layer.toggle_smooth(parsed_id)?;
      let changed = GlyphChangedEntities {
        point_ids: vec![parsed_id],
        ..Default::default()
      };
      GlyphStructureChange::from_layer(layer, changed)
    };

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
    {
      let layer = self.editable_layer_mut(glyph_ref)?;
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
    }

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

    let change = {
      let layer = self.editable_layer_mut(glyph_ref)?;
      apply_state_to_layer(layer, &structure, values)?;
      GlyphStructureChange::from_layer(layer, Default::default())
    };

    self.mark_font_changed();
    Ok(change.into())
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use shift_font::{Contour, PointType};
  use std::time::{Duration, Instant};

  fn glyph_handle(name: &str, unicode: Option<u32>) -> GlyphHandle {
    GlyphHandle {
      name: name.to_string(),
      unicode,
    }
  }

  #[derive(Clone, Copy)]
  struct PerfFontMark {
    label: &'static str,
    glyphs: usize,
    contours_per_glyph: usize,
    points_per_contour: usize,
  }

  impl PerfFontMark {
    fn total_points(self) -> usize {
      self.glyphs * self.contours_per_glyph * self.points_per_contour
    }
  }

  fn point_heavy_layer(mark: PerfFontMark, glyph_index: usize) -> GlyphLayer {
    let mut layer = GlyphLayer::with_width(500.0 + glyph_index as f64);

    for contour_index in 0..mark.contours_per_glyph {
      let mut contour = Contour::new();
      for point_index in 0..mark.points_per_contour {
        contour.add_point(
          point_index as f64,
          (glyph_index + contour_index + point_index) as f64,
          PointType::OnCurve,
          false,
        );
      }
      layer.add_contour(contour);
    }

    layer
  }

  fn point_heavy_glyph(
    name: impl Into<String>,
    unicode: u32,
    layer_id: LayerId,
    mark: PerfFontMark,
  ) -> Glyph {
    let mut glyph = Glyph::with_unicode(name.into(), unicode);
    glyph.set_layer(layer_id, point_heavy_layer(mark, unicode as usize));
    glyph
  }

  fn point_heavy_font(mark: PerfFontMark) -> Font {
    let mut font = Font::new();
    let default_layer_id = font.default_layer_id();

    for glyph_index in 0..mark.glyphs {
      font.insert_glyph(point_heavy_glyph(
        format!("g{glyph_index:05}"),
        glyph_index as u32,
        default_layer_id,
        mark,
      ));
    }

    font
  }

  fn default_source_id(bridge: &Bridge) -> String {
    bridge.get_sources()[0].id.clone()
  }

  fn default_layer_ref(bridge: &Bridge, name: &str, unicode: Option<u32>) -> GlyphLayerRef {
    GlyphLayerRef {
      glyph_handle: glyph_handle(name, unicode),
      layer_id: bridge.get_sources()[0].layer_id.clone(),
    }
  }

  fn print_perf_mark(operation: &str, mark: PerfFontMark, elapsed: Duration) {
    eprintln!(
      "perf_mark {operation} [{}]: {} glyphs / {} points in {:?}",
      mark.label,
      mark.glyphs,
      mark.total_points(),
      elapsed
    );
  }

  #[test]
  fn new_bridge_exposes_empty_committed_font_state() {
    let bridge = Bridge::new();

    let metadata = bridge.get_metadata();
    let metrics = bridge.get_metrics();

    assert_eq!(bridge.get_glyph_count(), 0);
    assert!(bridge.get_glyphs().is_empty());
    assert_eq!(bridge.get_sources().len(), 1);
    assert_eq!(bridge.get_sources()[0].name, "Regular");
    assert_eq!(metadata.family_name.as_deref(), Some("Untitled Font"));
    assert_eq!(metadata.style_name.as_deref(), Some("Regular"));
    assert_eq!(metrics.units_per_em, 1000.0);
    assert_eq!(metrics.ascender, 800.0);
    assert_eq!(metrics.descender, -200.0);
  }

  #[test]
  fn create_font_resets_to_fresh_font_state() {
    let mut bridge = Bridge::new();
    bridge
      .set_x_advance(default_layer_ref(&bridge, "A", Some(65)), 500.0)
      .unwrap();

    bridge.create_font();

    assert_eq!(bridge.get_glyph_count(), 0);
    assert!(bridge.get_axes().is_empty());
    assert_eq!(bridge.get_sources().len(), 1);
    assert_eq!(bridge.get_sources()[0].name, "Regular");
  }

  #[test]
  fn add_contour_returns_structure_change() {
    let mut bridge = Bridge::new();
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
    let mut bridge = Bridge::new();
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

    let snapshot = bridge.save_snapshot();
    let glyph = snapshot
      .glyph("A")
      .expect("snapshot should include edited A");
    let layer = glyph
      .layer(snapshot.default_layer_id())
      .expect("edited glyph should include default layer");

    assert_eq!(bridge.get_glyphs().len(), 1);
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
  fn save_task_routes_designspace_paths_through_font_loader() {
    let mut bridge = Bridge::new();
    let glyph_ref = default_layer_ref(&bridge, "A", Some(65));
    bridge.add_contour(glyph_ref).unwrap();

    let dir = std::env::temp_dir().join("shift_bridge_designspace_save_task");
    let designspace_path = dir.join("Smoke.designspace");
    let ufo_path = dir.join("Smoke.ufo");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();

    let mut task = SaveFontTask {
      snapshot: bridge.save_snapshot(),
      persisted_version: bridge.persisted_version.clone(),
      path: designspace_path.to_string_lossy().into_owned(),
    };

    task.compute().unwrap();

    assert!(
      designspace_path.is_file(),
      "designspace save should create an XML file, not a UFO directory"
    );
    assert!(
      ufo_path.is_dir(),
      "designspace save should create a companion UFO source"
    );

    let mut reloaded = Bridge::new();
    reloaded
      .load_font(designspace_path.to_string_lossy().into_owned())
      .unwrap();
    let glyphs = reloaded.get_glyphs();
    assert_eq!(glyphs.len(), 1);
    assert_eq!(glyphs[0].name, "A");

    let _ = std::fs::remove_dir_all(&dir);
  }

  #[test]
  fn persisted_older_snapshot_keeps_document_dirty_after_new_edit() {
    let mut bridge = Bridge::new();
    let glyph_ref = default_layer_ref(&bridge, "A", Some(65));
    let contour_id = bridge
      .add_contour(glyph_ref.clone())
      .unwrap()
      .changed
      .contour_ids[0]
      .clone();
    let snapshot = bridge.save_snapshot();

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
    record_persisted_version(&bridge.persisted_version, snapshot.version());

    assert_eq!(snapshot.version().as_u32(), 1);
    assert_eq!(bridge.live_version().as_u32(), 2);
    assert_eq!(bridge.get_persisted_version(), 1);
    assert!(bridge.is_dirty());
  }

  #[test]
  fn load_resets_persisted_version_handle_for_old_async_saves() {
    let mut bridge = Bridge::new();
    let glyph_ref = default_layer_ref(&bridge, "A", Some(65));
    bridge.add_contour(glyph_ref).unwrap();
    let old_persisted_version = bridge.persisted_version.clone();

    bridge.font = Font::default();
    bridge.live_version = DocumentVersion::default();
    bridge.persisted_version = Arc::new(AtomicU64::new(0));
    record_persisted_version(&old_persisted_version, DocumentVersion(1));

    assert_eq!(bridge.get_persisted_version(), 0);
    assert!(!bridge.is_dirty());
  }

  #[test]
  fn add_point_returns_structure_and_changed_point() {
    let mut bridge = Bridge::new();
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
    let mut bridge = Bridge::new();
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

    assert_eq!(bridge.get_glyphs().len(), 1);
    assert_eq!(state.structure.contours.len(), 1);
    assert_eq!(state.structure.contours[0].points.len(), 1);
    assert_eq!(&state.values[..], &[500.0, 10.0, 20.0]);
  }

  #[test]
  fn get_glyph_state_returns_none_for_missing_glyph() {
    let bridge = Bridge::new();

    assert!(bridge
      .get_glyph_state(glyph_handle("missing", None), default_source_id(&bridge))
      .unwrap()
      .is_none());
  }

  #[test]
  fn edit_methods_require_valid_layer_ref() {
    let mut bridge = Bridge::new();

    let result = bridge.add_contour(GlyphLayerRef {
      glyph_handle: glyph_handle("A", Some(65)),
      layer_id: "not-a-layer-id".to_string(),
    });

    assert!(result.err().unwrap().reason.contains("invalid layer ID"));
  }

  #[test]
  fn perf_mark_save_snapshot_setup_with_committed_font() {
    let committed_mark = PerfFontMark {
      label: "cjk-scale committed",
      glyphs: 10_000,
      contours_per_glyph: 2,
      points_per_contour: 8,
    };
    let mut bridge = Bridge::new();
    bridge.font = point_heavy_font(committed_mark);

    let start = Instant::now();
    let snapshots: Vec<_> = (0..128).map(|_| bridge.save_snapshot()).collect();
    let elapsed = start.elapsed();

    for snapshot in &snapshots {
      assert_eq!(snapshot.version().as_u32(), bridge.live_version().as_u32());
      assert_eq!(snapshot.glyphs().len(), committed_mark.glyphs);
    }
    assert_eq!(bridge.get_glyph_count(), committed_mark.glyphs as u32);

    print_perf_mark("save_snapshot committed x128", committed_mark, elapsed);
    assert!(
      elapsed < Duration::from_secs(1),
      "committed save snapshot setup should stay comfortably sub-second; got {elapsed:?}"
    );
  }
}
