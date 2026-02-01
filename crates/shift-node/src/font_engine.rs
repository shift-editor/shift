use napi::bindgen_prelude::*;
use napi::{Error, Result, Status};
use napi_derive::napi;
use shift_core::{
  edit_session::EditSession,
  font_loader::FontLoader,
  snapshot::{
    CommandResult, ContourSnapshot, GlyphSnapshot, PointSnapshot, PointType as SnapshotPointType,
  },
  ContourId, Font, FontWriter, Glyph, GlyphLayer, LayerId, PasteContour, PointId, PointType,
  UfoWriter,
};

use crate::types::{JSFontMetaData, JSFontMetrics};

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
  pub fn get_metadata(&self) -> JSFontMetaData {
    self.font.metadata().into()
  }

  #[napi]
  pub fn get_metrics(&self) -> JSFontMetrics {
    self.font.metrics().into()
  }

  #[napi]
  pub fn get_glyph_count(&self) -> u32 {
    self.font.glyph_count() as u32
  }

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
      .max_by_key(|(_, layer)| layer.contours().len())
      .map(|(id, layer)| (*id, layer.clone()))
      .map(|(id, layer)| (id, glyph.remove_layer(id).unwrap_or(layer)))
      .unwrap_or_else(|| {
        let id = self.font.default_layer_id();
        (id, GlyphLayer::with_width(500.0))
      });

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
    let session = self.get_edit_session()?;

    let cid = match contour_id.parse::<u128>() {
      Ok(raw) => ContourId::from_raw(raw),
      Err(_) => {
        return Ok(
          serde_json::to_string(&CommandResult::error(format!(
            "Invalid contour ID: {contour_id}"
          )))
          .unwrap(),
        )
      }
    };

    session.set_active_contour(cid);
    let result = CommandResult::success_simple(session);
    Ok(serde_json::to_string(&result).unwrap())
  }

  #[napi]
  pub fn clear_active_contour(&mut self) -> Result<String> {
    let session = self.get_edit_session()?;
    session.clear_active_contour();
    let result = CommandResult::success_simple(session);
    Ok(serde_json::to_string(&result).unwrap())
  }

  // ═══════════════════════════════════════════════════════════
  // SNAPSHOT METHODS
  // ═══════════════════════════════════════════════════════════

  #[napi]
  pub fn get_snapshot_data(&self) -> Result<JSGlyphSnapshot> {
    let session = self
      .current_edit_session
      .as_ref()
      .ok_or_else(|| Error::new(Status::GenericFailure, "No edit session active"))?;

    Ok(JSGlyphSnapshot::from_edit_session(session))
  }

  // ═══════════════════════════════════════════════════════════
  // POINT OPERATIONS
  // ═══════════════════════════════════════════════════════════

  #[napi]
  pub fn add_point(&mut self, x: f64, y: f64, point_type: String, smooth: bool) -> Result<String> {
    let session = self.get_edit_session()?;

    let pt = match point_type.as_str() {
      "onCurve" => PointType::OnCurve,
      "offCurve" => PointType::OffCurve,
      _ => {
        return Ok(
          serde_json::to_string(&CommandResult::error(format!(
            "Invalid point type: {point_type}"
          )))
          .unwrap(),
        )
      }
    };

    match session.add_point(x, y, pt, smooth) {
      Ok(point_id) => {
        let result = CommandResult::success(session, vec![point_id]);
        Ok(serde_json::to_string(&result).unwrap())
      }
      Err(e) => Ok(serde_json::to_string(&CommandResult::error(e)).unwrap()),
    }
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
    let session = self.get_edit_session()?;

    let pt = match point_type.as_str() {
      "onCurve" => PointType::OnCurve,
      "offCurve" => PointType::OffCurve,
      _ => {
        return Ok(
          serde_json::to_string(&CommandResult::error(format!(
            "Invalid point type: {point_type}"
          )))
          .unwrap(),
        )
      }
    };

    let cid = match contour_id.parse::<u128>() {
      Ok(raw) => ContourId::from_raw(raw),
      Err(_) => {
        return Ok(
          serde_json::to_string(&CommandResult::error(format!(
            "Invalid contour ID: {contour_id}"
          )))
          .unwrap(),
        )
      }
    };

    match session.add_point_to_contour(cid, x, y, pt, smooth) {
      Ok(point_id) => {
        let result = CommandResult::success(session, vec![point_id]);
        Ok(serde_json::to_string(&result).unwrap())
      }
      Err(e) => Ok(serde_json::to_string(&CommandResult::error(e)).unwrap()),
    }
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
    let session = self.get_edit_session()?;

    let pt = match point_type.as_str() {
      "onCurve" => PointType::OnCurve,
      "offCurve" => PointType::OffCurve,
      _ => {
        return Ok(
          serde_json::to_string(&CommandResult::error(format!(
            "Invalid point type: {point_type}"
          )))
          .unwrap(),
        )
      }
    };

    let before_id = match before_point_id.parse::<u128>() {
      Ok(raw) => PointId::from_raw(raw),
      Err(_) => {
        return Ok(
          serde_json::to_string(&CommandResult::error(format!(
            "Invalid point ID: {before_point_id}"
          )))
          .unwrap(),
        )
      }
    };

    match session.insert_point_before(before_id, x, y, pt, smooth) {
      Ok(point_id) => {
        let result = CommandResult::success(session, vec![point_id]);
        Ok(serde_json::to_string(&result).unwrap())
      }
      Err(e) => Ok(serde_json::to_string(&CommandResult::error(e)).unwrap()),
    }
  }

  #[napi]
  pub fn add_contour(&mut self) -> Result<String> {
    let session = self.get_edit_session()?;
    let _contour_id = session.add_empty_contour();
    let result = CommandResult::success_simple(session);
    Ok(serde_json::to_string(&result).unwrap())
  }

  #[napi]
  pub fn close_contour(&mut self) -> Result<String> {
    let session = self.get_edit_session()?;

    let contour_id = match session.active_contour_id() {
      Some(id) => id,
      None => {
        return Ok(serde_json::to_string(&CommandResult::error("No active contour")).unwrap())
      }
    };

    match session.close_contour(contour_id) {
      Ok(_) => {
        let result = CommandResult::success_simple(session);
        Ok(serde_json::to_string(&result).unwrap())
      }
      Err(e) => Ok(serde_json::to_string(&CommandResult::error(e)).unwrap()),
    }
  }

  #[napi]
  pub fn open_contour(&mut self, contour_id: String) -> Result<String> {
    let session = self.get_edit_session()?;

    let cid = match contour_id.parse::<u128>() {
      Ok(raw) => ContourId::from_raw(raw),
      Err(_) => {
        return Ok(
          serde_json::to_string(&CommandResult::error(format!(
            "Invalid contour ID: {contour_id}"
          )))
          .unwrap(),
        )
      }
    };

    match session.open_contour(cid) {
      Ok(_) => {
        let result = CommandResult::success_simple(session);
        Ok(serde_json::to_string(&result).unwrap())
      }
      Err(e) => Ok(serde_json::to_string(&CommandResult::error(e)).unwrap()),
    }
  }

  #[napi]
  pub fn reverse_contour(&mut self, contour_id: String) -> Result<String> {
    let session = self.get_edit_session()?;

    let cid = match contour_id.parse::<u128>() {
      Ok(raw) => ContourId::from_raw(raw),
      Err(_) => {
        return Ok(
          serde_json::to_string(&CommandResult::error(format!(
            "Invalid contour ID: {contour_id}"
          )))
          .unwrap(),
        )
      }
    };

    match session.reverse_contour(cid) {
      Ok(_) => {
        let result = CommandResult::success_simple(session);
        Ok(serde_json::to_string(&result).unwrap())
      }
      Err(e) => Ok(serde_json::to_string(&CommandResult::error(e)).unwrap()),
    }
  }

  #[napi]
  pub fn move_points(&mut self, point_ids: Vec<String>, dx: f64, dy: f64) -> Result<String> {
    let session = self.get_edit_session()?;

    let parsed_ids: Vec<PointId> = point_ids
      .iter()
      .filter_map(|id_str| id_str.parse::<u128>().ok().map(PointId::from_raw))
      .collect();

    if parsed_ids.is_empty() && !point_ids.is_empty() {
      return Ok(
        serde_json::to_string(&CommandResult::error("No valid point IDs provided")).unwrap(),
      );
    }

    let moved = session.move_points(&parsed_ids, dx, dy);
    let result = CommandResult::success(session, moved);
    Ok(serde_json::to_string(&result).unwrap())
  }

  #[napi]
  pub fn remove_points(&mut self, point_ids: Vec<String>) -> Result<String> {
    let session = self.get_edit_session()?;

    let parsed_ids: Vec<PointId> = point_ids
      .iter()
      .filter_map(|id_str| id_str.parse::<u128>().ok().map(PointId::from_raw))
      .collect();

    if parsed_ids.is_empty() && !point_ids.is_empty() {
      return Ok(
        serde_json::to_string(&CommandResult::error("No valid point IDs provided")).unwrap(),
      );
    }

    let removed = session.remove_points(&parsed_ids);
    let result = CommandResult::success(session, removed);
    Ok(serde_json::to_string(&result).unwrap())
  }

  #[napi]
  pub fn toggle_smooth(&mut self, point_id: String) -> Result<String> {
    let session = self.get_edit_session()?;

    let parsed_id = match point_id.parse::<u128>() {
      Ok(raw) => PointId::from_raw(raw),
      Err(_) => {
        return Ok(
          serde_json::to_string(&CommandResult::error(format!(
            "Invalid point ID: {point_id}"
          )))
          .unwrap(),
        )
      }
    };

    match session.toggle_smooth(parsed_id) {
      Ok(_) => {
        let result = CommandResult::success(session, vec![parsed_id]);
        Ok(serde_json::to_string(&result).unwrap())
      }
      Err(e) => Ok(serde_json::to_string(&CommandResult::error(e)).unwrap()),
    }
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
        return Ok(
          serde_json::to_string(&PasteResultJson {
            success: false,
            created_point_ids: vec![],
            created_contour_ids: vec![],
            error: Some(format!("Failed to parse contours: {e}")),
          })
          .unwrap(),
        )
      }
    };

    let result = session.paste_contours(contours, offset_x, offset_y);

    Ok(
      serde_json::to_string(&PasteResultJson {
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
      })
      .unwrap(),
    )
  }

  #[napi]
  pub fn remove_contour(&mut self, contour_id: String) -> Result<String> {
    let session = self.get_edit_session()?;

    let cid = match contour_id.parse::<u128>() {
      Ok(raw) => ContourId::from_raw(raw),
      Err(_) => {
        return Ok(
          serde_json::to_string(&CommandResult::error(format!(
            "Invalid contour ID: {contour_id}"
          )))
          .unwrap(),
        )
      }
    };

    session.remove_contour(cid);
    let result = CommandResult::success_simple(session);
    Ok(serde_json::to_string(&result).unwrap())
  }

  // ═══════════════════════════════════════════════════════════
  // LIGHTWEIGHT DRAG OPERATIONS (no snapshot return)
  // ═══════════════════════════════════════════════════════════

  /// Set point positions directly - fire-and-forget for drag operations.
  /// Returns true on success, false on failure.
  /// Does NOT return a snapshot - use get_snapshot_data() when needed.
  #[napi]
  pub fn set_point_positions(&mut self, moves: Vec<JSPointMove>) -> Result<bool> {
    let session = match self.current_edit_session.as_mut() {
      Some(s) => s,
      None => return Ok(false),
    };

    for m in moves {
      if let Ok(raw) = m.id.parse::<u128>() {
        let point_id = PointId::from_raw(raw);
        session.set_point_position(point_id, m.x, m.y);
      }
    }

    Ok(true)
  }

  #[napi]
  pub fn restore_snapshot_native(&mut self, snapshot: JSGlyphSnapshot) -> Result<bool> {
    let session = match self.current_edit_session.as_mut() {
      Some(s) => s,
      None => return Ok(false),
    };

    // Convert JS snapshot to internal GlyphSnapshot
    let glyph_snapshot = GlyphSnapshot {
      unicode: snapshot.unicode,
      name: snapshot.name,
      x_advance: snapshot.x_advance,
      contours: snapshot
        .contours
        .into_iter()
        .map(|c| ContourSnapshot {
          id: c.id,
          points: c
            .points
            .into_iter()
            .map(|p| PointSnapshot {
              id: p.id,
              x: p.x,
              y: p.y,
              point_type: if p.point_type == "offCurve" {
                SnapshotPointType::OffCurve
              } else {
                SnapshotPointType::OnCurve
              },
              smooth: p.smooth,
            })
            .collect(),
          closed: c.closed,
        })
        .collect(),
      active_contour_id: snapshot.active_contour_id,
    };

    session.restore_from_snapshot(&glyph_snapshot);
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

// ═══════════════════════════════════════════════════════════
// JS-NATIVE SNAPSHOT TYPES (no JSON serialization)
// ═══════════════════════════════════════════════════════════

#[napi(object)]
pub struct JSPointSnapshot {
  pub id: String,
  pub x: f64,
  pub y: f64,
  pub point_type: String,
  pub smooth: bool,
}

#[napi(object)]
pub struct JSContourSnapshot {
  pub id: String,
  pub points: Vec<JSPointSnapshot>,
  pub closed: bool,
}

#[napi(object)]
pub struct JSGlyphSnapshot {
  pub unicode: u32,
  pub name: String,
  pub x_advance: f64,
  pub contours: Vec<JSContourSnapshot>,
  pub active_contour_id: Option<String>,
}

impl JSGlyphSnapshot {
  pub fn from_edit_session(session: &EditSession) -> Self {
    Self {
      unicode: session.unicode(),
      name: session.glyph_name().to_string(),
      x_advance: session.width(),
      contours: session
        .contours_iter()
        .map(|c| JSContourSnapshot {
          id: c.id().to_string(),
          points: c
            .points()
            .iter()
            .map(|p| JSPointSnapshot {
              id: p.id().to_string(),
              x: p.x(),
              y: p.y(),
              point_type: match p.point_type() {
                PointType::OnCurve | PointType::QCurve => "onCurve".to_string(),
                PointType::OffCurve => "offCurve".to_string(),
              },
              smooth: p.is_smooth(),
            })
            .collect(),
          closed: c.is_closed(),
        })
        .collect(),
      active_contour_id: session.active_contour_id().map(|id| id.to_string()),
    }
  }
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
}
