use napi::{Error, Result, Status};
use napi_derive::napi;
use shift_core::{
  edit_session::EditSession,
  font::Font,
  font_loader::FontLoader,
  point::PointType,
  snapshot::{CommandResult, GlyphSnapshot},
};

use crate::types::{JSFontMetaData, JSFontMetrics};

/// FontEngine is the main entry point for the Rust font editing system.
///
/// It owns the font data and manages edit sessions. When a session is active,
/// the glyph being edited is owned by the session. When the session ends,
/// the glyph is returned to the font.
#[napi]
pub struct FontEngine {
  font_loader: FontLoader,
  current_edit_session: Option<EditSession>,
  /// Unicode of the glyph being edited (for returning it to the font)
  editing_unicode: Option<u32>,
  font: Font,
}

#[napi]
impl FontEngine {
  #[napi(constructor)]
  pub fn new() -> Self {
    Self {
      font_loader: FontLoader::new(),
      current_edit_session: None,
      editing_unicode: None,
      font: Font::default(),
    }
  }

  #[napi]
  pub fn load_font(&mut self, path: String) -> Result<()> {
    self.font = self
      .font_loader
      .read_font(&path)
      .map_err(|e| Error::new(Status::InvalidArg, format!("Failed to load font: {}", e)))?;
    Ok(())
  }

  #[napi]
  pub fn get_metadata(&self) -> JSFontMetaData {
    self.font.get_metadata().clone().into()
  }

  #[napi]
  pub fn get_metrics(&self) -> JSFontMetrics {
    (*self.font.get_metrics()).into()
  }

  #[napi]
  pub fn get_glyph_count(&self) -> u32 {
    self.font.get_glyph_count() as u32
  }

  /// Start an edit session for a glyph.
  /// Takes ownership of the glyph from the font.
  #[napi]
  pub fn start_edit_session(&mut self, unicode: u32) -> Result<()> {
    if self.current_edit_session.is_some() {
      return Err(Error::new(
        Status::GenericFailure,
        "Edit session already active. End the current session first.",
      ));
    }

    // Take ownership of the glyph from the font
    let glyph = self.font.take_glyph(unicode);
    let edit_session = EditSession::new(glyph);

    self.current_edit_session = Some(edit_session);
    self.editing_unicode = Some(unicode);
    Ok(())
  }

  fn get_edit_session(&mut self) -> Result<&mut EditSession> {
    self
      .current_edit_session
      .as_mut()
      .ok_or(Error::new(Status::GenericFailure, "No edit session active"))
  }

  /// End the current edit session.
  /// Returns the glyph to the font.
  #[napi]
  pub fn end_edit_session(&mut self) -> Result<()> {
    let session = self.current_edit_session.take().ok_or(Error::new(
      Status::GenericFailure,
      "No edit session to end",
    ))?;

    // Return the glyph to the font
    let glyph = session.into_glyph();
    self.font.put_glyph(glyph);
    self.editing_unicode = None;

    Ok(())
  }

  /// Check if an edit session is active
  #[napi]
  pub fn has_edit_session(&self) -> bool {
    self.current_edit_session.is_some()
  }

  /// Get the unicode of the glyph being edited
  #[napi]
  pub fn get_editing_unicode(&self) -> Option<u32> {
    self.editing_unicode
  }

  /// Add an empty contour to the current glyph and set it as active.
  /// Returns the contour ID as a string.
  #[napi]
  pub fn add_empty_contour(&mut self) -> Result<String> {
    let edit_session = self.get_edit_session()?;
    let contour_id = edit_session.add_empty_contour();
    Ok(contour_id.raw().to_string())
  }

  /// Get the active contour ID
  #[napi]
  pub fn get_active_contour_id(&mut self) -> Result<Option<String>> {
    let edit_session = self.get_edit_session()?;
    Ok(edit_session.active_contour_id().map(|id| id.raw().to_string()))
  }

  /// Set the active contour by ID
  #[napi]
  pub fn set_active_contour(&mut self, _contour_id: String) -> Result<()> {
    // For now, we need to parse the string back to ContourId
    // This is a simplification - in a full implementation we'd have proper ID handling
    Err(Error::new(
      Status::GenericFailure,
      "set_active_contour not yet implemented - contour IDs need proper serialization",
    ))
  }

  // ═══════════════════════════════════════════════════════════
  // SNAPSHOT METHODS
  // ═══════════════════════════════════════════════════════════

  /// Get the current glyph snapshot as JSON.
  /// Returns null if no edit session is active.
  #[napi]
  pub fn get_snapshot(&self) -> Option<String> {
    self.current_edit_session.as_ref().map(|session| {
      let snapshot = GlyphSnapshot::from_edit_session(session);
      serde_json::to_string(&snapshot).unwrap_or_else(|_| "null".to_string())
    })
  }

  /// Get the current glyph snapshot as a parsed object (avoids JSON overhead).
  /// This is more efficient for frequent reads.
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

  /// Add a point to the active contour.
  /// Returns a CommandResult JSON string.
  #[napi]
  pub fn add_point(
    &mut self,
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
            "Invalid point type: {}",
            point_type
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

  /// Add a point to a specific contour.
  /// Returns a CommandResult JSON string.
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
            "Invalid point type: {}",
            point_type
          )))
          .unwrap(),
        )
      }
    };

    // Parse contour ID (stored as u128 string)
    let cid = match contour_id.parse::<u128>() {
      Ok(raw) => shift_core::entity::ContourId::from_raw(raw),
      Err(_) => {
        return Ok(
          serde_json::to_string(&CommandResult::error(format!(
            "Invalid contour ID: {}",
            contour_id
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

  /// Insert a point before an existing point.
  /// Returns a CommandResult JSON string with the new point ID.
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
            "Invalid point type: {}",
            point_type
          )))
          .unwrap(),
        )
      }
    };

    // Parse point ID (stored as u128 string)
    let before_id = match before_point_id.parse::<u128>() {
      Ok(raw) => shift_core::entity::PointId::from_raw(raw),
      Err(_) => {
        return Ok(
          serde_json::to_string(&CommandResult::error(format!(
            "Invalid point ID: {}",
            before_point_id
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

  /// Add an empty contour and return a CommandResult JSON string.
  #[napi]
  pub fn add_contour(&mut self) -> Result<String> {
    let session = self.get_edit_session()?;
    let _contour_id = session.add_empty_contour();
    let result = CommandResult::success_simple(session);
    Ok(serde_json::to_string(&result).unwrap())
  }

  /// Close the active contour.
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

  /// Move multiple points by a delta (dx, dy).
  /// Takes an array of point ID strings.
  /// Returns a CommandResult JSON string with affected point IDs.
  #[napi]
  pub fn move_points(&mut self, point_ids: Vec<String>, dx: f64, dy: f64) -> Result<String> {
    let session = self.get_edit_session()?;

    // Parse point IDs from strings
    let parsed_ids: Vec<shift_core::entity::PointId> = point_ids
      .iter()
      .filter_map(|id_str| {
        id_str
          .parse::<u128>()
          .ok()
          .map(shift_core::entity::PointId::from_raw)
      })
      .collect();

    if parsed_ids.is_empty() && !point_ids.is_empty() {
      return Ok(serde_json::to_string(&CommandResult::error("No valid point IDs provided")).unwrap());
    }

    let moved = session.move_points(&parsed_ids, dx, dy);
    let result = CommandResult::success(session, moved);
    Ok(serde_json::to_string(&result).unwrap())
  }

  /// Remove multiple points by their IDs.
  /// Takes an array of point ID strings.
  /// Returns a CommandResult JSON string.
  #[napi]
  pub fn remove_points(&mut self, point_ids: Vec<String>) -> Result<String> {
    let session = self.get_edit_session()?;

    // Parse point IDs from strings
    let parsed_ids: Vec<shift_core::entity::PointId> = point_ids
      .iter()
      .filter_map(|id_str| {
        id_str
          .parse::<u128>()
          .ok()
          .map(shift_core::entity::PointId::from_raw)
      })
      .collect();

    if parsed_ids.is_empty() && !point_ids.is_empty() {
      return Ok(serde_json::to_string(&CommandResult::error("No valid point IDs provided")).unwrap());
    }

    let removed = session.remove_points(&parsed_ids);
    let result = CommandResult::success(session, removed);
    Ok(serde_json::to_string(&result).unwrap())
  }
}

// ═══════════════════════════════════════════════════════════
// JS-NATIVE SNAPSHOT TYPES (no JSON serialization)
// ═══════════════════════════════════════════════════════════

/// Point snapshot as native NAPI object (more efficient than JSON)
#[napi(object)]
pub struct JSPointSnapshot {
  pub id: String,
  pub x: f64,
  pub y: f64,
  pub point_type: String,
  pub smooth: bool,
}

/// Contour snapshot as native NAPI object
#[napi(object)]
pub struct JSContourSnapshot {
  pub id: String,
  pub points: Vec<JSPointSnapshot>,
  pub closed: bool,
}

/// Glyph snapshot as native NAPI object
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
    let glyph = session.glyph();
    Self {
      unicode: glyph.unicode(),
      name: glyph.name().to_string(),
      x_advance: glyph.x_advance(),
      contours: glyph
        .contours_iter()
        .map(|c| JSContourSnapshot {
          id: c.id().raw().to_string(),
          points: c
            .points()
            .iter()
            .map(|p| JSPointSnapshot {
              id: p.id().raw().to_string(),
              x: p.x(),
              y: p.y(),
              point_type: match p.point_type() {
                PointType::OnCurve => "onCurve".to_string(),
                PointType::OffCurve => "offCurve".to_string(),
              },
              smooth: p.is_smooth(),
            })
            .collect(),
          closed: c.is_closed(),
        })
        .collect(),
      active_contour_id: session.active_contour_id().map(|id| id.raw().to_string()),
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

    // Start session for 'A' (65)
    engine.start_edit_session(65).unwrap();
    assert!(engine.has_edit_session());
    assert_eq!(engine.get_editing_unicode(), Some(65));

    // End session
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

    // Active contour should be set
    let active = engine.get_active_contour_id().unwrap();
    assert_eq!(active, Some(contour_id));
  }
}
