use crate::{
  contour::Contour,
  entity::{ContourId, PointId},
  glyph::Glyph,
  point::PointType,
};

/// An editing session for a single glyph.
///
/// The EditSession owns the glyph data during editing, allowing mutations.
/// When the session ends, the modified glyph can be written back to the font.
pub struct EditSession {
  /// The glyph being edited (owned, not shared)
  glyph: Glyph,
  /// The currently active contour for adding points
  active_contour_id: Option<ContourId>,
}

impl EditSession {
  /// Create a new edit session for the given glyph.
  /// Takes ownership of the glyph data.
  pub fn new(glyph: Glyph) -> Self {
    Self {
      glyph,
      active_contour_id: None,
    }
  }

  /// Get a reference to the current glyph
  pub fn glyph(&self) -> &Glyph {
    &self.glyph
  }

  /// Get a mutable reference to the current glyph
  pub fn glyph_mut(&mut self) -> &mut Glyph {
    &mut self.glyph
  }

  /// Consume the session and return the modified glyph
  pub fn into_glyph(self) -> Glyph {
    self.glyph
  }

  /// Get the active contour ID
  pub fn active_contour_id(&self) -> Option<ContourId> {
    self.active_contour_id
  }

  /// Set the active contour
  pub fn set_active_contour(&mut self, contour_id: ContourId) {
    self.active_contour_id = Some(contour_id);
  }

  /// Clear the active contour
  pub fn clear_active_contour(&mut self) {
    self.active_contour_id = None;
  }

  /// Add an empty contour and set it as active
  pub fn add_empty_contour(&mut self) -> ContourId {
    let contour = Contour::new();
    let contour_id = contour.id();
    self.glyph.add_contour(contour);
    self.active_contour_id = Some(contour_id);
    contour_id
  }

  /// Remove a contour by ID
  pub fn remove_contour(&mut self, contour_id: ContourId) -> Option<Contour> {
    // If we're removing the active contour, clear it
    if self.active_contour_id == Some(contour_id) {
      self.active_contour_id = None;
    }
    self.glyph.remove_contour(contour_id)
  }

  /// Add a point to the specified contour
  pub fn add_point_to_contour(
    &mut self,
    contour_id: ContourId,
    x: f64,
    y: f64,
    point_type: PointType,
    is_smooth: bool,
  ) -> Result<PointId, String> {
    let point_id = self
      .glyph
      .contour_mut(contour_id)?
      .add_point(x, y, point_type, is_smooth);
    Ok(point_id)
  }

  /// Add a point to the active contour
  pub fn add_point(
    &mut self,
    x: f64,
    y: f64,
    point_type: PointType,
    is_smooth: bool,
  ) -> Result<PointId, String> {
    let contour_id = self
      .active_contour_id
      .ok_or_else(|| "No active contour".to_string())?;
    self.add_point_to_contour(contour_id, x, y, point_type, is_smooth)
  }

  /// Move a point to a new position
  pub fn move_point(
    &mut self,
    contour_id: ContourId,
    point_id: PointId,
    x: f64,
    y: f64,
  ) -> Result<(), String> {
    let contour = self.glyph.contour_mut(contour_id)?;
    let point = contour
      .get_point_mut(point_id)
      .ok_or_else(|| format!("Point {:?} not found", point_id))?;
    point.set_position(x, y);
    Ok(())
  }

  /// Translate a point by the given delta
  pub fn translate_point(
    &mut self,
    contour_id: ContourId,
    point_id: PointId,
    dx: f64,
    dy: f64,
  ) -> Result<(), String> {
    let contour = self.glyph.contour_mut(contour_id)?;
    let point = contour
      .get_point_mut(point_id)
      .ok_or_else(|| format!("Point {:?} not found", point_id))?;
    point.translate(dx, dy);
    Ok(())
  }

  /// Remove a point from a contour
  pub fn remove_point(
    &mut self,
    contour_id: ContourId,
    point_id: PointId,
  ) -> Result<(), String> {
    let contour = self.glyph.contour_mut(contour_id)?;
    contour
      .remove_point(point_id)
      .ok_or_else(|| format!("Point {:?} not found", point_id))?;
    Ok(())
  }

  /// Close a contour
  pub fn close_contour(&mut self, contour_id: ContourId) -> Result<(), String> {
    let contour = self.glyph.contour_mut(contour_id)?;
    contour.close();
    Ok(())
  }

  /// Open a contour
  pub fn open_contour(&mut self, contour_id: ContourId) -> Result<(), String> {
    let contour = self.glyph.contour_mut(contour_id)?;
    contour.open();
    Ok(())
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn create_session() -> EditSession {
    let glyph = Glyph::new("test".to_string(), 65, 500.0);
    EditSession::new(glyph)
  }

  #[test]
  fn new_session_has_no_active_contour() {
    let session = create_session();
    assert!(session.active_contour_id().is_none());
  }

  #[test]
  fn add_empty_contour_sets_active() {
    let mut session = create_session();
    let contour_id = session.add_empty_contour();

    assert_eq!(session.active_contour_id(), Some(contour_id));
    assert_eq!(session.glyph().contours_count(), 1);
  }

  #[test]
  fn remove_active_contour_clears_active() {
    let mut session = create_session();
    let contour_id = session.add_empty_contour();

    assert_eq!(session.active_contour_id(), Some(contour_id));

    session.remove_contour(contour_id);

    assert!(session.active_contour_id().is_none());
    assert_eq!(session.glyph().contours_count(), 0);
  }

  #[test]
  fn add_point_to_active_contour() {
    let mut session = create_session();
    let contour_id = session.add_empty_contour();

    let point_id = session
      .add_point(100.0, 200.0, PointType::OnCurve, false)
      .unwrap();

    let contour = session.glyph().contour(contour_id).unwrap();
    let point = contour.get_point(point_id).unwrap();

    assert_eq!(point.x(), 100.0);
    assert_eq!(point.y(), 200.0);
  }

  #[test]
  fn add_point_without_active_contour_fails() {
    let mut session = create_session();

    let result = session.add_point(100.0, 200.0, PointType::OnCurve, false);

    assert!(result.is_err());
    assert_eq!(result.unwrap_err(), "No active contour");
  }

  #[test]
  fn move_point() {
    let mut session = create_session();
    let contour_id = session.add_empty_contour();
    let point_id = session
      .add_point(0.0, 0.0, PointType::OnCurve, false)
      .unwrap();

    session.move_point(contour_id, point_id, 50.0, 75.0).unwrap();

    let point = session
      .glyph()
      .contour(contour_id)
      .unwrap()
      .get_point(point_id)
      .unwrap();

    assert_eq!(point.x(), 50.0);
    assert_eq!(point.y(), 75.0);
  }

  #[test]
  fn translate_point() {
    let mut session = create_session();
    let contour_id = session.add_empty_contour();
    let point_id = session
      .add_point(10.0, 20.0, PointType::OnCurve, false)
      .unwrap();

    session.translate_point(contour_id, point_id, 5.0, -10.0).unwrap();

    let point = session
      .glyph()
      .contour(contour_id)
      .unwrap()
      .get_point(point_id)
      .unwrap();

    assert_eq!(point.x(), 15.0);
    assert_eq!(point.y(), 10.0);
  }

  #[test]
  fn into_glyph_transfers_ownership() {
    let mut session = create_session();
    session.add_empty_contour();

    let glyph = session.into_glyph();

    assert_eq!(glyph.contours_count(), 1);
    assert_eq!(glyph.name(), "test");
    assert_eq!(glyph.unicode(), 65);
  }
}
