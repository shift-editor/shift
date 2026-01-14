use std::cell::{Ref, RefMut};

use crate::{
  contour::Contour,
  entity::{ContourId, PointId},
  glyph::{Glyph, SharedGlyph},
  point::PointType,
};

pub enum EditCommand {
  AddPoint {
    x: f64,
    y: f64,
    point_type: PointType,
    is_smooth: bool,
  },
  MovePoint {
    point_id: PointId,
    x: f64,
    y: f64,
  },
  RemovePoint {
    point_id: PointId,
  },
  SetPointType {
    point_id: PointId,
    point_type: PointType,
    is_smooth: bool,
  },
  AddContour,
  CloseContour {
    contour_id: ContourId,
  },
  RemoveContour {
    contour_id: ContourId,
  },
}

pub struct EditSession {
  current_glyph: SharedGlyph,
  active_contour_id: Option<ContourId>,
}

impl EditSession {
  pub fn new(glyph: SharedGlyph) -> Self {
    Self {
      current_glyph: glyph,
      active_contour_id: None,
    }
  }

  pub fn current_glyph(&self) -> Ref<Glyph> {
    self.current_glyph.borrow()
  }

  pub fn current_glyph_as_mut(&mut self) -> RefMut<Glyph> {
    self.current_glyph.borrow_mut()
  }

  pub fn apply(&mut self, command: Vec<EditCommand>) {}

  fn add_empty_contour(&mut self) -> ContourId {
    let contour = Contour::new();
    let contour_id = contour.id();
    self
      .current_glyph_as_mut()
      .contours_mut()
      .insert(contour_id, contour);
    contour_id
  }

  fn remove_contour(&mut self, contour_id: ContourId) {
    self
      .current_glyph_as_mut()
      .contours_mut()
      .remove(&contour_id);
  }

  fn add_point_to_contour(
    &mut self,
    x: f64,
    y: f64,
    point_type: PointType,
    is_smooth: bool,
  ) -> Result<PointId, String> {
    let contour_id = match self.active_contour_id {
      Some(contour_id) => contour_id,
      None => self.add_empty_contour(),
    };

    let point_id = self
      .current_glyph_as_mut()
      .contour_mut(contour_id)?
      .add_point(x, y, point_type, is_smooth);
    Ok(point_id)
  }
  fn move_point_in_contour() {}
  fn remove_point_from_contour() {}
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn create_edit_session() {
    let glyph = Glyph::new("test".to_string(), 0, 0.0);
    let edit_session = EditSession::new(glyph);
    assert_eq!(edit_session.current_glyph_as_mut().contours_count(), 0);
  }

  #[test]
  fn add_empty_contour() {
    let glyph = Glyph::new("test".to_string(), 0, 0.0);
    let mut edit_session = EditSession::new(glyph);

    edit_session.add_empty_contour();
    assert_eq!(edit_session.current_glyph_as_mut().contours_count(), 1);
  }

  #[test]
  fn remove_contour() {
    let glyph = Glyph::new("test".to_string(), 0, 0.0);
    let mut edit_session = EditSession::new(glyph);

    let contour_id = edit_session.add_empty_contour();
    edit_session.remove_contour(contour_id);
    assert_eq!(edit_session.current_glyph_as_mut().contours_count(), 0);
  }

  #[test]
  fn add_point_to_contour() {
    let glyph = Glyph::new("test".to_string(), 0, 0.0);
    let mut edit_session = EditSession::new(glyph);

    let contour_id = edit_session.add_empty_contour();
    let point_id = edit_session
      .add_point_to_contour(20.0, 30.0, PointType::OnCurve, false)
      .unwrap();

    let glyph = edit_session.current_glyph();
    let contour = glyph.contour(contour_id).unwrap();
    let point = contour.get_point(point_id).unwrap();

    assert_eq!(contour.length(), 1);

    assert_eq!(point.x(), 20.0);
    assert_eq!(point.y(), 30.0);
    assert_eq!(point.point_type(), &PointType::OnCurve);
    assert_eq!(point.is_smooth(), false);
  }
}
