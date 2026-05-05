use crate::errors::{self, to_napi_error, BridgeError, BridgeResult};
use crate::input::parse;
use napi::bindgen_prelude::*;
use napi::{Error, Status};
use napi_derive::napi;
use serde::{Deserialize, Serialize};
use shift_backends::{font_loader::FontLoader, ufo::UfoWriter, FontView};
use shift_edit::{
  edit_session::{BulkNodePositionUpdates, EditSession},
  interpolation::{build_masters, get_glyph_variation_data},
  BooleanOp, ContourId, Font, Glyph, GlyphLayer, LayerId, PointId,
};
use shift_wire::{
  bridges::napi::{
    NapiAxis, NapiFontMetadata, NapiFontMetrics, NapiGlyphRecord, NapiGlyphState,
    NapiGlyphStructure, NapiGlyphStructureChange, NapiGlyphValueChange, NapiPointType, NapiSource,
  },
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
}

impl FontView for FontSaveSnapshot {
  fn metadata(&self) -> &shift_ir::FontMetadata {
    self.font.metadata()
  }

  fn metrics(&self) -> &shift_ir::FontMetrics {
    self.font.metrics()
  }

  fn axes(&self) -> &[shift_ir::Axis] {
    self.font.axes()
  }

  fn sources(&self) -> &[shift_ir::Source] {
    self.font.sources()
  }

  fn layers(&self) -> Vec<(LayerId, &shift_ir::Layer)> {
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

  fn kerning(&self) -> &shift_ir::KerningData {
    self.font.kerning()
  }

  fn features(&self) -> &shift_ir::FeatureData {
    self.font.features()
  }

  fn guidelines(&self) -> &[shift_ir::Guideline] {
    self.font.guidelines()
  }

  fn lib(&self) -> &shift_ir::LibData {
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
    UfoWriter::new()
      .save_view(&self.snapshot, &self.path)
      .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to save font: {e}")))?;

    Ok(self.snapshot.version())
  }

  fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
    record_persisted_version(&self.persisted_version, output);
    Ok(output.as_u32())
  }
}

pub struct ActiveEdit {
  session: EditSession,
  glyph: Glyph,
  layer_id: LayerId,
  dirty: bool,
}

impl ActiveEdit {
  fn new(session: EditSession, glyph: Glyph, layer_id: LayerId) -> Self {
    Self {
      session,
      glyph,
      layer_id,
      dirty: false,
    }
  }

  fn from_glyph(glyph: Glyph, layer_id: LayerId, unicode_hint: Option<u32>) -> Self {
    let unicode = glyph.primary_unicode().or(unicode_hint).unwrap_or(0);
    let layer = glyph
      .layer(layer_id)
      .cloned()
      .unwrap_or_else(|| GlyphLayer::with_width(500.0));
    let session = EditSession::new(glyph.name().to_string(), unicode, layer);

    Self::new(session, glyph, layer_id)
  }

  fn session(&self) -> &EditSession {
    &self.session
  }

  fn session_mut(&mut self) -> &mut EditSession {
    &mut self.session
  }

  fn mark_dirty(&mut self) {
    self.dirty = true;
  }

  fn is_dirty(&self) -> bool {
    self.dirty
  }

  fn glyph_with_session_layer(&self) -> Glyph {
    let mut glyph = self.glyph.clone();
    glyph.set_layer(self.layer_id, self.session.layer().clone());
    if self.session.unicode() != 0 {
      glyph.add_unicode(self.session.unicode());
    }
    glyph
  }

  fn finish(self) -> Glyph {
    let Self {
      session,
      mut glyph,
      layer_id,
      ..
    } = self;

    let session_unicode = session.unicode();
    let layer = session.into_layer();
    glyph.set_layer(layer_id, layer);
    if session_unicode != 0 {
      glyph.add_unicode(session_unicode);
    }

    glyph
  }
}

#[napi]
pub struct Bridge {
  active_edit: Option<ActiveEdit>,
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
      active_edit: None,
      font: Font::default(),
      live_version: DocumentVersion::default(),
      persisted_version: Arc::new(AtomicU64::new(0)),
    }
  }

  #[napi]
  pub fn load_font(&mut self, path: String) -> errors::Result<()> {
    self.font = self.font_loader.read_font(&path)?;
    self.active_edit = None;
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
  pub fn get_glyph_state(&self, glyph_ref: GlyphHandle) -> Option<NapiGlyphState> {
    let glyph = self.glyph_for_read(&glyph_ref.name)?;
    let layer = glyph.layer(self.font.default_layer_id())?;
    let variation_data = build_masters(&self.font, &glyph)
      .and_then(|masters| get_glyph_variation_data(&masters, self.font.axes()));

    Some(GlyphState::from_layer(layer, variation_data).into())
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

  fn start_edit_session_for_name(
    &mut self,
    glyph_name: &str,
    unicode_hint: Option<u32>,
  ) -> Result<()> {
    if self.active_edit.is_some() {
      return Err(to_napi_error(BridgeError::ActiveEditAlreadyExists));
    }

    let default_layer_id = self.font.default_layer_id();
    let glyph = self
      .font
      .glyph(glyph_name)
      .cloned()
      .unwrap_or_else(|| Glyph::new(glyph_name.to_string()));

    self.active_edit = Some(ActiveEdit::from_glyph(
      glyph,
      default_layer_id,
      unicode_hint,
    ));

    Ok(())
  }

  #[napi]
  pub fn start_edit_session(&mut self, glyph_ref: GlyphHandle) -> Result<()> {
    self.start_edit_session_for_name(&glyph_ref.name, glyph_ref.unicode)
  }

  fn active_edit(&self) -> BridgeResult<&ActiveEdit> {
    self.active_edit.as_ref().ok_or(BridgeError::NoActiveEdit)
  }

  fn active_edit_mut(&mut self) -> BridgeResult<&mut ActiveEdit> {
    self.active_edit.as_mut().ok_or(BridgeError::NoActiveEdit)
  }

  fn take_active_edit(&mut self) -> BridgeResult<ActiveEdit> {
    self.active_edit.take().ok_or(BridgeError::NoActiveEdit)
  }

  fn active_session(&self) -> BridgeResult<&EditSession> {
    Ok(self.active_edit()?.session())
  }

  fn active_session_mut(&mut self) -> BridgeResult<&mut EditSession> {
    Ok(self.active_edit_mut()?.session_mut())
  }

  fn save_snapshot(&self) -> FontSaveSnapshot {
    FontSaveSnapshot::new(
      self.live_version(),
      self.font.clone(),
      self
        .active_edit
        .as_ref()
        .map(ActiveEdit::glyph_with_session_layer),
    )
  }

  fn glyph_for_read(&self, glyph_name: &str) -> Option<Glyph> {
    self
      .active_edit
      .as_ref()
      .filter(|active_edit| active_edit.session().glyph_name() == glyph_name)
      .map(ActiveEdit::glyph_with_session_layer)
      .or_else(|| self.font.glyph(glyph_name).cloned())
  }

  fn mark_active_edit_changed(&mut self) {
    self.bump_live_version();
    if let Some(active_edit) = self.active_edit.as_mut() {
      active_edit.mark_dirty();
    }
  }

  fn mark_committed_changed(&mut self) {
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
  pub fn get_live_version(&self) -> u32 {
    self.live_version().as_u32()
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
  pub fn end_edit_session(&mut self) -> Result<()> {
    let active_edit = self.take_active_edit()?;
    let was_dirty = active_edit.is_dirty();
    let glyph = active_edit.finish();
    self.font.put_glyph(glyph);
    if !was_dirty {
      self.mark_committed_changed();
    }

    Ok(())
  }

  #[napi]
  pub fn has_edit_session(&self) -> bool {
    self.active_edit.is_some()
  }

  #[napi(ts_return_type = "Unicode | null")]
  pub fn get_editing_unicode(&self) -> Option<u32> {
    self.active_session().ok().map(|session| session.unicode())
  }

  #[napi(ts_return_type = "GlyphName | null")]
  pub fn get_editing_glyph_name(&self) -> Option<String> {
    self
      .active_session()
      .ok()
      .map(|session| session.glyph_name().to_string())
  }

  #[napi]
  pub fn set_x_advance(&mut self, width: f64) -> errors::Result<NapiGlyphValueChange> {
    let session = self.active_session_mut()?;
    session.set_x_advance(width);

    let change = GlyphValueChange::from_layer(session.layer(), Default::default());
    self.mark_active_edit_changed();
    Ok(change.into())
  }

  #[napi]
  pub fn translate_layer(&mut self, dx: f64, dy: f64) -> errors::Result<NapiGlyphValueChange> {
    let session = self.active_session_mut()?;
    session.translate_layer(dx, dy);

    let change = GlyphValueChange::from_layer(session.layer(), Default::default());
    self.mark_active_edit_changed();
    Ok(change.into())
  }

  #[napi]
  pub fn add_point(
    &mut self,
    #[napi(ts_arg_type = "ContourId")] contour_id: String,
    x: f64,
    y: f64,
    point_type: NapiPointType,
    smooth: bool,
  ) -> errors::Result<NapiGlyphStructureChange> {
    let contour_id = parse::<ContourId>(&contour_id)?;
    let point_type = point_type.into();

    let session = self.active_session_mut()?;
    let point_id = session.add_point_to_contour(contour_id, x, y, point_type, smooth)?;

    let changed = GlyphChangedEntities {
      point_ids: vec![point_id],
      ..Default::default()
    };

    let change = GlyphStructureChange::from_layer(session.layer(), changed);
    self.mark_active_edit_changed();
    Ok(change.into())
  }

  #[napi]
  pub fn insert_point_before(
    &mut self,
    #[napi(ts_arg_type = "PointId")] before_point_id: String,
    x: f64,
    y: f64,
    point_type: NapiPointType,
    smooth: bool,
  ) -> errors::Result<NapiGlyphStructureChange> {
    let before_point_id = parse::<PointId>(&before_point_id)?;
    let point_type = point_type.into();

    let session = self.active_session_mut()?;
    let point_id = session.insert_point_before(before_point_id, x, y, point_type, smooth)?;

    let changed = GlyphChangedEntities {
      point_ids: vec![point_id],
      ..Default::default()
    };

    let change = GlyphStructureChange::from_layer(session.layer(), changed);

    self.mark_active_edit_changed();
    Ok(change.into())
  }

  #[napi]
  pub fn add_contour(&mut self) -> Result<NapiGlyphStructureChange> {
    let session = self.active_session_mut()?;
    let contour_id = session.add_empty_contour();

    let changed = GlyphChangedEntities {
      contour_ids: vec![contour_id],
      ..Default::default()
    };

    let change = GlyphStructureChange::from_layer(session.layer(), changed);

    self.mark_active_edit_changed();
    Ok(change.into())
  }

  #[napi]
  pub fn open_contour(
    &mut self,
    #[napi(ts_arg_type = "ContourId")] contour_id: String,
  ) -> errors::Result<NapiGlyphStructureChange> {
    let contour_id = parse::<ContourId>(&contour_id)?;
    let session = self.active_session_mut()?;
    session.open_contour(contour_id)?;

    let changed = GlyphChangedEntities {
      contour_ids: vec![contour_id],
      ..Default::default()
    };

    let change = GlyphStructureChange::from_layer(session.layer(), changed);

    self.mark_active_edit_changed();
    Ok(change.into())
  }

  #[napi]
  pub fn close_contour(
    &mut self,
    #[napi(ts_arg_type = "ContourId")] contour_id: String,
  ) -> errors::Result<NapiGlyphStructureChange> {
    let contour_id = parse::<ContourId>(&contour_id)?;
    let session = self.active_session_mut()?;
    session.close_contour(contour_id)?;

    let changed = GlyphChangedEntities {
      contour_ids: vec![contour_id],
      ..Default::default()
    };

    let change = GlyphStructureChange::from_layer(session.layer(), changed);

    self.mark_active_edit_changed();
    Ok(change.into())
  }

  #[napi]
  pub fn reverse_contour(
    &mut self,
    #[napi(ts_arg_type = "ContourId")] contour_id: String,
  ) -> errors::Result<NapiGlyphStructureChange> {
    let contour_id = parse::<ContourId>(&contour_id)?;
    let session = self.active_session_mut()?;
    session.reverse_contour(contour_id)?;

    let changed = GlyphChangedEntities {
      contour_ids: vec![contour_id],
      ..Default::default()
    };

    let change = GlyphStructureChange::from_layer(session.layer(), changed);

    self.mark_active_edit_changed();
    Ok(change.into())
  }

  #[napi]
  pub fn apply_boolean_op(
    &mut self,
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

    let session = self.active_session_mut()?;
    let created_ids = session.apply_boolean_op(cid_a, cid_b, op)?;

    let changed = GlyphChangedEntities {
      contour_ids: created_ids,
      ..Default::default()
    };

    let change = GlyphStructureChange::from_layer(session.layer(), changed);

    self.mark_active_edit_changed();
    Ok(change.into())
  }

  #[napi]
  pub fn remove_points(
    &mut self,
    #[napi(ts_arg_type = "Array<PointId>")] point_ids: Vec<String>,
  ) -> errors::Result<NapiGlyphStructureChange> {
    let point_ids: BridgeResult<Vec<_>> = point_ids.iter().map(|id| parse::<PointId>(id)).collect();
    let point_ids = point_ids?;

    let session = self.active_session_mut()?;
    session.remove_points(&point_ids)?;

    let changed = GlyphChangedEntities::points(point_ids);
    let change = GlyphStructureChange::from_layer(session.layer(), changed);
    self.mark_active_edit_changed();
    Ok(change.into())
  }

  #[napi]
  pub fn toggle_smooth(
    &mut self,
    #[napi(ts_arg_type = "PointId")] point_id: String,
  ) -> errors::Result<NapiGlyphStructureChange> {
    let parsed_id = parse::<PointId>(&point_id)?;
    let session = self.active_session_mut()?;
    session.toggle_smooth(parsed_id)?;

    let changed = GlyphChangedEntities {
      point_ids: vec![parsed_id],
      ..Default::default()
    };

    let change = GlyphStructureChange::from_layer(session.layer(), changed);

    self.mark_active_edit_changed();
    Ok(change.into())
  }

  /// Bulk position sync. IDs use BigUint64Array to avoid lossy float packing.
  /// Coords are interleaved [x0, y0, x1, y1, ...].
  #[napi]
  pub fn set_positions(
    &mut self,
    point_ids: Option<BigUint64Array>,
    point_coords: Option<Float64Array>,
    anchor_ids: Option<BigUint64Array>,
    anchor_coords: Option<Float64Array>,
  ) -> errors::Result<NapiGlyphValueChange> {
    let session = self.active_session_mut()?;
    let changed = session.set_bulk_node_positions(BulkNodePositionUpdates {
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

    let change = GlyphValueChange::from_layer(session.layer(), changed);
    self.mark_active_edit_changed();
    Ok(change.into())
  }

  #[napi]
  pub fn restore_state(
    &mut self,
    structure: NapiGlyphStructure,
    values: Float64Array,
  ) -> errors::Result<NapiGlyphStructureChange> {
    let structure = GlyphStructure::from(structure);
    let values: &[f64] = &values;

    let session = self.active_session_mut()?;
    session.restore_layer(&structure, values)?;

    let change = GlyphStructureChange::from_layer(session.layer(), Default::default());
    self.mark_active_edit_changed();
    Ok(change.into())
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use shift_edit::{Contour, PointType};
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

    assert!(!bridge.has_edit_session());
    assert_eq!(bridge.get_glyph_count(), 0);
    assert!(bridge.get_glyphs().is_empty());
    assert_eq!(metadata.family_name.as_deref(), Some("Untitled Font"));
    assert_eq!(metadata.style_name.as_deref(), Some("Regular"));
    assert_eq!(metrics.units_per_em, 1000.0);
    assert_eq!(metrics.ascender, 800.0);
    assert_eq!(metrics.descender, -200.0);
  }

  #[test]
  fn edit_session_tracks_current_glyph() {
    let mut bridge = Bridge::new();

    bridge
      .start_edit_session(glyph_handle("A", Some(65)))
      .unwrap();

    assert!(bridge.has_edit_session());
    assert_eq!(bridge.get_editing_glyph_name().as_deref(), Some("A"));
    assert_eq!(bridge.get_editing_unicode(), Some(65));
  }

  #[test]
  fn end_edit_session_commits_glyph_to_font() {
    let mut bridge = Bridge::new();

    bridge
      .start_edit_session(glyph_handle("A", Some(65)))
      .unwrap();
    bridge.end_edit_session().unwrap();

    let glyphs = bridge.get_glyphs();
    assert!(!bridge.has_edit_session());
    assert_eq!(glyphs.len(), 1);
    assert_eq!(glyphs[0].name, "A");
    assert_eq!(glyphs[0].unicodes, vec![65]);
  }

  #[test]
  fn starting_second_session_returns_bridge_error() {
    let mut bridge = Bridge::new();

    bridge
      .start_edit_session(glyph_handle("A", Some(65)))
      .unwrap();
    let result = bridge.start_edit_session(glyph_handle("B", Some(66)));

    assert_eq!(result.unwrap_err().reason, "edit session already active");
    assert_eq!(bridge.get_editing_glyph_name().as_deref(), Some("A"));
  }

  #[test]
  fn add_contour_returns_structure_change() {
    let mut bridge = Bridge::new();
    bridge
      .start_edit_session(glyph_handle("A", Some(65)))
      .unwrap();

    let change = bridge.add_contour().unwrap();

    assert_eq!(change.structure.contours.len(), 1);
    assert_eq!(change.changed.contour_ids.len(), 1);
    assert_eq!(
      change.structure.contours[0].id,
      change.changed.contour_ids[0]
    );
    assert!(change.structure.contours[0].points.is_empty());
  }

  #[test]
  fn save_snapshot_includes_active_edit_without_committing_session() {
    let mut bridge = Bridge::new();
    bridge
      .start_edit_session(glyph_handle("A", Some(65)))
      .unwrap();
    let contour_id = bridge.add_contour().unwrap().changed.contour_ids[0].clone();
    let point_id = bridge
      .add_point(contour_id, 10.0, 20.0, NapiPointType::OnCurve, false)
      .unwrap()
      .changed
      .point_ids[0]
      .clone();

    let snapshot = bridge.save_snapshot();
    let glyph = snapshot
      .glyph("A")
      .expect("snapshot should include active A");
    let layer = glyph
      .layer(snapshot.default_layer_id())
      .expect("active glyph should include default layer");

    assert!(bridge.has_edit_session());
    assert!(bridge.get_glyphs().is_empty());
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
    let mut bridge = Bridge::new();
    bridge
      .start_edit_session(glyph_handle("A", Some(65)))
      .unwrap();
    let contour_id = bridge.add_contour().unwrap().changed.contour_ids[0].clone();
    let snapshot = bridge.save_snapshot();

    bridge
      .add_point(contour_id, 10.0, 20.0, NapiPointType::OnCurve, false)
      .unwrap();
    record_persisted_version(&bridge.persisted_version, snapshot.version());

    assert_eq!(snapshot.version().as_u32(), 1);
    assert_eq!(bridge.get_live_version(), 2);
    assert_eq!(bridge.get_persisted_version(), 1);
    assert!(bridge.is_dirty());
  }

  #[test]
  fn load_resets_persisted_version_handle_for_old_async_saves() {
    let mut bridge = Bridge::new();
    bridge
      .start_edit_session(glyph_handle("A", Some(65)))
      .unwrap();
    bridge.add_contour().unwrap();
    let old_persisted_version = bridge.persisted_version.clone();

    bridge.font = Font::default();
    bridge.active_edit = None;
    bridge.live_version = DocumentVersion::default();
    bridge.persisted_version = Arc::new(AtomicU64::new(0));
    record_persisted_version(&old_persisted_version, DocumentVersion(1));

    assert_eq!(bridge.get_persisted_version(), 0);
    assert!(!bridge.is_dirty());
  }

  #[test]
  fn ending_dirty_edit_session_does_not_increment_version_again() {
    let mut bridge = Bridge::new();
    bridge
      .start_edit_session(glyph_handle("A", Some(65)))
      .unwrap();
    bridge.add_contour().unwrap();

    bridge.end_edit_session().unwrap();

    assert_eq!(bridge.get_live_version(), 1);
    assert!(bridge.is_dirty());
    assert_eq!(bridge.get_glyphs()[0].name, "A");
  }

  #[test]
  fn add_point_returns_structure_and_changed_point() {
    let mut bridge = Bridge::new();
    bridge
      .start_edit_session(glyph_handle("A", Some(65)))
      .unwrap();
    let contour_id = bridge.add_contour().unwrap().changed.contour_ids[0].clone();

    let change = bridge
      .add_point(contour_id, 10.0, 20.0, NapiPointType::OnCurve, false)
      .unwrap();

    let points = &change.structure.contours[0].points;
    assert_eq!(change.changed.point_ids.len(), 1);
    assert_eq!(points.len(), 1);
    assert_eq!(points[0].id, change.changed.point_ids[0]);
    assert_eq!(points[0].point_type, NapiPointType::OnCurve);
    assert!(!points[0].smooth);
  }

  #[test]
  fn get_glyph_state_reads_active_edit_overlay() {
    let mut bridge = Bridge::new();
    bridge
      .start_edit_session(glyph_handle("A", Some(65)))
      .unwrap();
    let contour_id = bridge.add_contour().unwrap().changed.contour_ids[0].clone();
    bridge
      .add_point(contour_id, 10.0, 20.0, NapiPointType::OnCurve, false)
      .unwrap();

    let state = bridge
      .get_glyph_state(glyph_handle("A", Some(65)))
      .expect("active edit glyph should be readable");

    assert!(bridge.get_glyphs().is_empty());
    assert_eq!(state.structure.contours.len(), 1);
    assert_eq!(state.structure.contours[0].points.len(), 1);
    assert_eq!(&state.values[..], &[500.0, 10.0, 20.0]);
  }

  #[test]
  fn get_glyph_state_returns_none_for_missing_glyph() {
    let bridge = Bridge::new();

    assert!(bridge
      .get_glyph_state(glyph_handle("missing", None))
      .is_none());
  }

  #[test]
  fn edit_methods_require_active_session() {
    let mut bridge = Bridge::new();

    let result = bridge.add_contour();

    assert_eq!(result.err().unwrap().reason, "no active edit");
  }

  #[test]
  fn perf_mark_save_snapshot_setup_with_active_edit_overlay() {
    let committed_mark = PerfFontMark {
      label: "cjk-scale committed",
      glyphs: 10_000,
      contours_per_glyph: 2,
      points_per_contour: 8,
    };
    let active_mark = PerfFontMark {
      label: "active-overlay",
      glyphs: 1,
      contours_per_glyph: 50,
      points_per_contour: 1_000,
    };
    let mut bridge = Bridge::new();
    bridge.font = point_heavy_font(committed_mark);
    let default_layer_id = bridge.font.default_layer_id();
    let active_glyph = point_heavy_glyph("active", 0xE000, default_layer_id, active_mark);
    bridge.active_edit = Some(ActiveEdit::from_glyph(
      active_glyph,
      default_layer_id,
      Some(0xE000),
    ));
    bridge.mark_active_edit_changed();

    let start = Instant::now();
    let snapshots: Vec<_> = (0..128).map(|_| bridge.save_snapshot()).collect();
    let elapsed = start.elapsed();

    for snapshot in &snapshots {
      let active_glyph = snapshot
        .glyph("active")
        .expect("snapshot should include the active edit overlay");
      let active_layer = active_glyph
        .layer(snapshot.default_layer_id())
        .expect("active overlay should include the default layer");

      assert_eq!(snapshot.version().as_u32(), bridge.get_live_version());
      assert_eq!(snapshot.glyphs().len(), committed_mark.glyphs + 1);
      assert_eq!(active_glyph.unicodes(), &[0xE000]);
      assert_eq!(
        active_layer.contours().len(),
        active_mark.contours_per_glyph
      );
    }
    assert!(bridge.has_edit_session());
    assert_eq!(bridge.get_glyph_count(), committed_mark.glyphs as u32);

    print_perf_mark(
      "save_snapshot active overlay x128",
      PerfFontMark {
        label: "cjk-scale + active-overlay",
        ..committed_mark
      },
      elapsed,
    );
    assert!(
      elapsed < Duration::from_secs(1),
      "active-overlay save snapshot setup should stay comfortably sub-second; got {elapsed:?}"
    );
  }
}
