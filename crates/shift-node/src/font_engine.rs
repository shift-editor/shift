use napi::bindgen_prelude::*;
use napi::{Error, Result, Status};
use napi_derive::napi;
use shift_core::{
  curve::segment_bounds,
  edit_session::EditSession,
  font_loader::FontLoader,
  snapshot::{CommandResult, GlyphSnapshot},
  ContourId, CurveSegment, CurveSegmentIter, Font, FontWriter, Glyph, GlyphLayer, LayerId,
  PasteContour, Point, PointId, PointType, UfoWriter,
};

fn to_json(value: &impl serde::Serialize) -> String {
  serde_json::to_string(value).expect("NAPI result serialization failed")
}

macro_rules! parse_or_err {
  ($id_str:expr, $ty:ty, $label:expr) => {
    match $id_str.parse::<$ty>() {
      Ok(id) => id,
      Err(_) => {
        return Ok(to_json(&CommandResult::error(format!(
          concat!("Invalid ", $label, ": {}"),
          $id_str
        ))))
      }
    }
  };
}

fn layer_to_svg_path(layer: &GlyphLayer) -> String {
  let mut parts: Vec<String> = Vec::new();
  for contour in layer.contours_iter() {
    let d = contour_to_svg_d(contour.points(), contour.is_closed());
    if !d.is_empty() {
      parts.push(d);
    }
  }
  parts.join(" ")
}

fn layer_bbox(layer: &GlyphLayer) -> Option<(f64, f64, f64, f64)> {
  let mut min_x = f64::MAX;
  let mut min_y = f64::MAX;
  let mut max_x = f64::MIN;
  let mut max_y = f64::MIN;
  let mut any = false;

  for contour in layer.contours_iter() {
    for segment in contour.segments() {
      let (sx, sy, ex, ey) = segment_bounds(&segment);
      min_x = min_x.min(sx);
      min_y = min_y.min(sy);
      max_x = max_x.max(ex);
      max_y = max_y.max(ey);
      any = true;
    }
  }

  if any {
    Some((min_x, min_y, max_x, max_y))
  } else {
    None
  }
}

fn contour_to_svg_d(points: &[Point], closed: bool) -> String {
  if points.len() < 2 {
    return String::new();
  }

  let mut out = Vec::new();
  let mut first = true;

  for seg in CurveSegmentIter::new(points, closed) {
    match seg {
      CurveSegment::Line(p1, p2) => {
        if first {
          out.push(format!("M {} {}", p1.x(), p1.y()));
          first = false;
        }
        out.push(format!("L {} {}", p2.x(), p2.y()));
      }
      CurveSegment::Quad(p1, cp, p2) => {
        if first {
          out.push(format!("M {} {}", p1.x(), p1.y()));
          first = false;
        }
        out.push(format!("Q {} {} {} {}", cp.x(), cp.y(), p2.x(), p2.y()));
      }
      CurveSegment::Cubic(p1, cp1, cp2, p2) => {
        if first {
          out.push(format!("M {} {}", p1.x(), p1.y()));
          first = false;
        }
        out.push(format!(
          "C {} {} {} {} {} {}",
          cp1.x(),
          cp1.y(),
          cp2.x(),
          cp2.y(),
          p2.x(),
          p2.y()
        ));
      }
    }
  }

  if closed && !out.is_empty() {
    out.push("Z".to_string());
  }
  out.join(" ")
}

pub struct SaveFontTask {
  font: Font,
  path: String,
}

impl Task for SaveFontTask {
  type Output = ();
  type JsValue = ();

  fn compute(&mut self) -> Result<Self::Output> {
    UfoWriter::new()
      .save(&self.font, &self.path)
      .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to save font: {e}")))
  }

  fn resolve(&mut self, _env: Env, _output: Self::Output) -> Result<Self::JsValue> {
    Ok(())
  }
}

#[napi]
pub struct FontEngine {
  font_loader: FontLoader,
  current_edit_session: Option<EditSession>,
  editing_glyph: Option<Glyph>,
  editing_layer_id: Option<LayerId>,
  font: Font,
}

impl Default for FontEngine {
  fn default() -> Self {
    Self::new()
  }
}

#[napi]
impl FontEngine {
  #[napi(constructor)]
  pub fn new() -> Self {
    Self {
      font_loader: FontLoader::new(),
      current_edit_session: None,
      editing_glyph: None,
      editing_layer_id: None,
      font: Font::default(),
    }
  }

  #[napi]
  pub fn load_font(&mut self, path: String) -> Result<()> {
    self.font = self
      .font_loader
      .read_font(&path)
      .map_err(|e| Error::new(Status::InvalidArg, format!("Failed to load font: {e}")))?;
    Ok(())
  }

  #[napi]
  pub fn save_font(&mut self, path: String) -> Result<()> {
    let backup = self.apply_edits_for_save();

    let result = self
      .font_loader
      .write_font(&self.font, &path)
      .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to save font: {e}")));

    self.restore_from_backup(backup);

    result
  }

  #[napi(ts_return_type = "Promise<void>")]
  pub fn save_font_async(&mut self, path: String) -> AsyncTask<SaveFontTask> {
    let backup = self.apply_edits_for_save();
    let font = self.font.clone();
    self.restore_from_backup(backup);

    AsyncTask::new(SaveFontTask { font, path })
  }

  fn apply_edits_for_save(&mut self) -> Option<(String, Glyph)> {
    let (session, glyph, layer_id) = match (
      &self.current_edit_session,
      &self.editing_glyph,
      &self.editing_layer_id,
    ) {
      (Some(s), Some(g), Some(l)) => (s, g, l),
      _ => return None,
    };

    let glyph_name = glyph.name().to_string();
    let original = self.font.take_glyph(&glyph_name);

    let mut glyph_copy = glyph.clone();
    let layer = session.layer().clone();
    glyph_copy.set_layer(*layer_id, layer);
    self.font.put_glyph(glyph_copy);

    let backup_glyph = original.unwrap_or_else(|| Glyph::new(glyph_name.clone()));
    Some((glyph_name, backup_glyph))
  }

  fn restore_from_backup(&mut self, backup: Option<(String, Glyph)>) {
    if let Some((_, original_glyph)) = backup {
      self.font.put_glyph(original_glyph);
    }
  }

  #[napi]
  pub fn get_metadata(&self) -> String {
    to_json(self.font.metadata())
  }

  #[napi]
  pub fn get_metrics(&self) -> String {
    to_json(self.font.metrics())
  }

  #[napi]
  pub fn get_glyph_count(&self) -> u32 {
    self.font.glyph_count() as u32
  }

  #[napi]
  pub fn get_glyph_unicodes(&self) -> Vec<u32> {
    let mut unicodes: Vec<u32> = self
      .font
      .glyphs()
      .values()
      .flat_map(|g| g.unicodes().iter().copied())
      .collect();
    unicodes.sort_unstable();
    unicodes.dedup();
    unicodes
  }

  #[napi]
  pub fn get_glyph_svg_path(&self, unicode: u32) -> Option<String> {
    let glyph = self.font.glyph_by_unicode(unicode)?;
    let layer = glyph.layers().values().max_by_key(|l| l.contours().len())?;
    let path = layer_to_svg_path(layer);
    if path.is_empty() {
      return None;
    }
    Some(path)
  }

  #[napi]
  pub fn get_glyph_advance(&self, unicode: u32) -> Option<f64> {
    let glyph = self.font.glyph_by_unicode(unicode)?;
    let layer = glyph.layers().values().max_by_key(|l| l.contours().len())?;
    Some(layer.width())
  }

  #[napi]
  pub fn get_glyph_bbox(&self, unicode: u32) -> Option<Vec<f64>> {
    let glyph = self.font.glyph_by_unicode(unicode)?;
    let layer = glyph.layers().values().max_by_key(|l| l.contours().len())?;
    layer_bbox(layer).map(|(min_x, min_y, max_x, max_y)| vec![min_x, min_y, max_x, max_y])
  }

  // ═══════════════════════════════════════════════════════════
  // EDIT SESSIONS
  // ═══════════════════════════════════════════════════════════

  #[napi]
  pub fn start_edit_session(&mut self, unicode: u32) -> Result<()> {
    if self.current_edit_session.is_some() {
      return Err(Error::new(
        Status::GenericFailure,
        "Edit session already active. End the current session first.",
      ));
    }

    let glyph_name = self
      .font
      .glyph_by_unicode(unicode)
      .map(|g| g.name().to_string());

    let mut glyph = if let Some(name) = &glyph_name {
      self
        .font
        .take_glyph(name)
        .unwrap_or_else(|| Glyph::with_unicode(name.clone(), unicode))
    } else {
      let name = char::from_u32(unicode)
        .map(|c| c.to_string())
        .unwrap_or_else(|| format!("uni{unicode:04X}"));
      Glyph::with_unicode(name, unicode)
    };

    let (layer_id, layer) = glyph
      .layers()
      .iter()
      .max_by_key(|(_, l)| l.contours().len())
      .map(|(id, _)| *id)
      .and_then(|id| glyph.remove_layer(id).map(|l| (id, l)))
      .unwrap_or_else(|| (self.font.default_layer_id(), GlyphLayer::with_width(500.0)));

    let edit_session = EditSession::new(glyph.name().to_string(), unicode, layer);

    self.current_edit_session = Some(edit_session);
    self.editing_glyph = Some(glyph);
    self.editing_layer_id = Some(layer_id);

    Ok(())
  }

  fn get_edit_session(&mut self) -> Result<&mut EditSession> {
    self
      .current_edit_session
      .as_mut()
      .ok_or(Error::new(Status::GenericFailure, "No edit session active"))
  }

  fn command(&mut self, f: impl FnOnce(&mut EditSession) -> Vec<PointId>) -> Result<String> {
    let session = self.get_edit_session()?;
    let ids = f(session);
    Ok(to_json(&CommandResult::success(session, ids)))
  }

  fn command_simple(&mut self, f: impl FnOnce(&mut EditSession)) -> Result<String> {
    let session = self.get_edit_session()?;
    f(session);
    Ok(to_json(&CommandResult::success_simple(session)))
  }

  fn command_try(
    &mut self,
    f: impl FnOnce(&mut EditSession) -> std::result::Result<Vec<PointId>, String>,
  ) -> Result<String> {
    let session = self.get_edit_session()?;
    match f(session) {
      Ok(ids) => Ok(to_json(&CommandResult::success(session, ids))),
      Err(e) => Ok(to_json(&CommandResult::error(e))),
    }
  }

  fn command_try_simple(
    &mut self,
    f: impl FnOnce(&mut EditSession) -> std::result::Result<(), String>,
  ) -> Result<String> {
    let session = self.get_edit_session()?;
    match f(session) {
      Ok(()) => Ok(to_json(&CommandResult::success_simple(session))),
      Err(e) => Ok(to_json(&CommandResult::error(e))),
    }
  }

  #[napi]
  pub fn end_edit_session(&mut self) -> Result<()> {
    let session = self
      .current_edit_session
      .take()
      .ok_or(Error::new(Status::GenericFailure, "No edit session to end"))?;

    let mut glyph = self.editing_glyph.take().ok_or(Error::new(
      Status::GenericFailure,
      "No glyph stored for session",
    ))?;

    let layer_id = self.editing_layer_id.take().ok_or(Error::new(
      Status::GenericFailure,
      "No layer ID stored for session",
    ))?;

    let layer = session.into_layer();
    glyph.set_layer(layer_id, layer);
    self.font.put_glyph(glyph);

    Ok(())
  }

  #[napi]
  pub fn has_edit_session(&self) -> bool {
    self.current_edit_session.is_some()
  }

  #[napi]
  pub fn get_editing_unicode(&self) -> Option<u32> {
    self.current_edit_session.as_ref().map(|s| s.unicode())
  }

  #[napi]
  pub fn add_empty_contour(&mut self) -> Result<String> {
    let edit_session = self.get_edit_session()?;
    let contour_id = edit_session.add_empty_contour();
    Ok(contour_id.to_string())
  }

  #[napi]
  pub fn get_active_contour_id(&mut self) -> Result<Option<String>> {
    let edit_session = self.get_edit_session()?;
    Ok(edit_session.active_contour_id().map(|id| id.to_string()))
  }

  #[napi]
  pub fn set_active_contour(&mut self, contour_id: String) -> Result<String> {
    let cid = parse_or_err!(contour_id, ContourId, "contour ID");
    self.command_simple(|s| s.set_active_contour(cid))
  }

  #[napi]
  pub fn clear_active_contour(&mut self) -> Result<String> {
    self.command_simple(|s| s.clear_active_contour())
  }

  #[napi]
  pub fn get_snapshot_data(&self) -> Result<String> {
    let session = self
      .current_edit_session
      .as_ref()
      .ok_or_else(|| Error::new(Status::GenericFailure, "No edit session active"))?;

    Ok(to_json(&GlyphSnapshot::from_edit_session(session)))
  }

  #[napi]
  pub fn add_point(&mut self, x: f64, y: f64, point_type: String, smooth: bool) -> Result<String> {
    let pt = parse_or_err!(point_type, PointType, "point type");
    self.command_try(|s| s.add_point(x, y, pt, smooth).map(|id| vec![id]))
  }

  #[napi]
  pub fn add_point_to_contour(
    &mut self,
    contour_id: String,
    x: f64,
    y: f64,
    point_type: String,
    smooth: bool,
  ) -> Result<String> {
    let pt = parse_or_err!(point_type, PointType, "point type");
    let cid = parse_or_err!(contour_id, ContourId, "contour ID");
    self.command_try(|s| {
      s.add_point_to_contour(cid, x, y, pt, smooth)
        .map(|id| vec![id])
    })
  }

  #[napi]
  pub fn insert_point_before(
    &mut self,
    before_point_id: String,
    x: f64,
    y: f64,
    point_type: String,
    smooth: bool,
  ) -> Result<String> {
    let pt = parse_or_err!(point_type, PointType, "point type");
    let before_id = parse_or_err!(before_point_id, PointId, "point ID");
    self.command_try(|s| {
      s.insert_point_before(before_id, x, y, pt, smooth)
        .map(|id| vec![id])
    })
  }

  #[napi]
  pub fn add_contour(&mut self) -> Result<String> {
    self.command_simple(|s| {
      s.add_empty_contour();
    })
  }

  #[napi]
  pub fn close_contour(&mut self) -> Result<String> {
    let session = self.get_edit_session()?;

    let contour_id = match session.active_contour_id() {
      Some(id) => id,
      None => return Ok(to_json(&CommandResult::error("No active contour"))),
    };

    match session.close_contour(contour_id) {
      Ok(_) => Ok(to_json(&CommandResult::success_simple(session))),
      Err(e) => Ok(to_json(&CommandResult::error(e))),
    }
  }

  #[napi]
  pub fn open_contour(&mut self, contour_id: String) -> Result<String> {
    let cid = parse_or_err!(contour_id, ContourId, "contour ID");
    self.command_try_simple(|s| s.open_contour(cid))
  }

  #[napi]
  pub fn reverse_contour(&mut self, contour_id: String) -> Result<String> {
    let cid = parse_or_err!(contour_id, ContourId, "contour ID");
    self.command_try_simple(|s| s.reverse_contour(cid))
  }

  #[napi]
  pub fn move_points(&mut self, point_ids: Vec<String>, dx: f64, dy: f64) -> Result<String> {
    let parsed_ids: Vec<PointId> = point_ids
      .iter()
      .filter_map(|id_str| id_str.parse::<PointId>().ok())
      .collect();

    if parsed_ids.is_empty() && !point_ids.is_empty() {
      return Ok(to_json(&CommandResult::error(
        "No valid point IDs provided",
      )));
    }

    self.command(|s| s.move_points(&parsed_ids, dx, dy))
  }

  #[napi]
  pub fn remove_points(&mut self, point_ids: Vec<String>) -> Result<String> {
    let parsed_ids: Vec<PointId> = point_ids
      .iter()
      .filter_map(|id_str| id_str.parse::<PointId>().ok())
      .collect();

    if parsed_ids.is_empty() && !point_ids.is_empty() {
      return Ok(to_json(&CommandResult::error(
        "No valid point IDs provided",
      )));
    }

    self.command(|s| s.remove_points(&parsed_ids))
  }

  #[napi]
  pub fn toggle_smooth(&mut self, point_id: String) -> Result<String> {
    let parsed_id = parse_or_err!(point_id, PointId, "point ID");
    self.command_try(|s| s.toggle_smooth(parsed_id).map(|_| vec![parsed_id]))
  }

  // ═══════════════════════════════════════════════════════════
  // CLIPBOARD OPERATIONS
  // ═══════════════════════════════════════════════════════════

  #[napi]
  pub fn paste_contours(
    &mut self,
    contours_json: String,
    offset_x: f64,
    offset_y: f64,
  ) -> Result<String> {
    let session = self.get_edit_session()?;

    let contours: Vec<PasteContour> = match serde_json::from_str(&contours_json) {
      Ok(c) => c,
      Err(e) => {
        return Ok(to_json(&PasteResultJson {
          success: false,
          created_point_ids: vec![],
          created_contour_ids: vec![],
          error: Some(format!("Failed to parse contours: {e}")),
        }))
      }
    };

    let result = session.paste_contours(contours, offset_x, offset_y);

    Ok(to_json(&PasteResultJson {
      success: result.success,
      created_point_ids: result
        .created_point_ids
        .iter()
        .map(|id| id.to_string())
        .collect(),
      created_contour_ids: result
        .created_contour_ids
        .iter()
        .map(|id| id.to_string())
        .collect(),
      error: result.error,
    }))
  }

  #[napi]
  pub fn remove_contour(&mut self, contour_id: String) -> Result<String> {
    let cid = parse_or_err!(contour_id, ContourId, "contour ID");
    self.command_simple(|s| {
      s.remove_contour(cid);
    })
  }

  // ═══════════════════════════════════════════════════════════
  // LIGHTWEIGHT DRAG OPERATIONS (no snapshot return)
  // ═══════════════════════════════════════════════════════════

  /// Set point positions directly — fire-and-forget for drag operations.
  /// Returns true on success, false if no edit session is active.
  /// Does NOT return a snapshot — use get_snapshot_data() when needed.
  #[napi]
  pub fn set_point_positions(&mut self, moves: Vec<JSPointMove>) -> Result<bool> {
    let Some(session) = self.current_edit_session.as_mut() else {
      return Ok(false);
    };

    for m in moves {
      if let Ok(point_id) = m.id.parse::<PointId>() {
        session.set_point_position(point_id, m.x, m.y);
      }
    }

    Ok(true)
  }

  #[napi]
  pub fn restore_snapshot(&mut self, snapshot_json: String) -> Result<bool> {
    let Some(session) = self.current_edit_session.as_mut() else {
      return Ok(false);
    };

    let snapshot: GlyphSnapshot = serde_json::from_str(&snapshot_json).map_err(|e| {
      Error::new(
        Status::GenericFailure,
        format!("Invalid snapshot JSON: {e}"),
      )
    })?;

    session.restore_from_snapshot(&snapshot);
    Ok(true)
  }
}

// ═══════════════════════════════════════════════════════════
// LIGHTWEIGHT NATIVE TYPES FOR DRAG OPERATIONS
// ═══════════════════════════════════════════════════════════

/// Input type for set_point_positions - a single point move
#[napi(object)]
pub struct JSPointMove {
  pub id: String,
  pub x: f64,
  pub y: f64,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PasteResultJson {
  success: bool,
  created_point_ids: Vec<String>,
  created_contour_ids: Vec<String>,
  error: Option<String>,
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_new_font_engine() {
    let engine = FontEngine::new();
    assert!(!engine.has_edit_session());
    assert_eq!(engine.get_glyph_count(), 0);
  }

  #[test]
  fn test_start_and_end_session() {
    let mut engine = FontEngine::new();

    engine.start_edit_session(65).unwrap();
    assert!(engine.has_edit_session());
    assert_eq!(engine.get_editing_unicode(), Some(65));

    engine.end_edit_session().unwrap();
    assert!(!engine.has_edit_session());
    assert_eq!(engine.get_editing_unicode(), None);
  }

  #[test]
  fn test_cannot_start_second_session() {
    let mut engine = FontEngine::new();

    engine.start_edit_session(65).unwrap();
    let result = engine.start_edit_session(66);

    assert!(result.is_err());
  }

  #[test]
  fn test_add_contour() {
    let mut engine = FontEngine::new();
    engine.start_edit_session(65).unwrap();

    let contour_id = engine.add_empty_contour().unwrap();
    assert!(!contour_id.is_empty());

    let active = engine.get_active_contour_id().unwrap();
    assert_eq!(active, Some(contour_id));
  }

  #[test]
  fn test_get_glyph_svg_path_after_load() {
    let ufo_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
      .join("../../fixtures/fonts/mutatorsans/MutatorSansLightCondensed.ufo");
    if !ufo_path.exists() {
      return;
    }
    let path_str = ufo_path.to_str().unwrap();
    let mut engine = FontEngine::new();
    engine.load_font(path_str.to_string()).unwrap();
    let path = engine.get_glyph_svg_path(65);
    assert!(
      path.is_some(),
      "get_glyph_svg_path(65) should return Some for MutatorSans A"
    );
    let path = path.unwrap();
    assert!(!path.is_empty());
    assert!(path.starts_with("M "));
  }

  #[test]
  fn test_get_glyph_bbox_after_load() {
    let ufo_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
      .join("../../fixtures/fonts/mutatorsans/MutatorSansLightCondensed.ufo");
    if !ufo_path.exists() {
      return;
    }
    let path_str = ufo_path.to_str().unwrap();
    let mut engine = FontEngine::new();
    engine.load_font(path_str.to_string()).unwrap();
    let bbox = engine.get_glyph_bbox(65);
    assert!(
      bbox.is_some(),
      "get_glyph_bbox(65) should return Some for MutatorSans A"
    );
    let b = bbox.unwrap();
    assert_eq!(b.len(), 4);
    assert!(b[0] < b[2], "min_x < max_x");
    assert!(b[1] < b[3], "min_y < max_y");
  }
}
