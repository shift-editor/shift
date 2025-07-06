use crate::{
  entity::{ContourId, PointId},
  point::{Point, PointType},
};

#[derive(Clone)]
pub struct Contour {
  id: ContourId,
  points: Vec<Point>,
  closed: bool,
}

impl Contour {
  pub fn new() -> Self {
    Self {
      id: ContourId::new(),
      points: Vec::new(),
      closed: false,
    }
  }

  pub fn get_id(&self) -> ContourId {
    self.id
  }

  pub fn add_point(&mut self, x: f64, y: f64, point_type: PointType, smooth: bool) -> PointId {
    let point = Point::new(x, y, point_type, smooth);
    self.points.push(point);
    point.id()
  }

  pub fn remove_point(&mut self, id: PointId) -> Result<usize, String> {
    let index = self
      .points
      .iter()
      .position(|i| i.id() == id)
      .ok_or("Point not found")?;
    self.points.remove(index);

    Ok(index)
  }

  pub fn is_empty(&self) -> bool {
    self.points.len() == 0
  }

  pub fn is_closed(&self) -> bool {
    self.closed
  }

  pub fn close(&mut self) {
    self.closed = true;
  }

  pub fn length(&self) -> usize {
    self.points.len()
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn new() {
    let contour = Contour::new();
    assert_eq!(contour.points.len(), 0);
    assert_eq!(contour.closed, false);
  }

  #[test]
  fn add_point() {
    let mut contour = Contour::new();
    let id = contour.add_point(20.0, 30.0, PointType::OnCurve, false);

    assert_eq!(contour.points.len(), 1);
    assert_eq!(contour.points[0].get_x(), 20.0);
    assert_eq!(contour.points[0].get_y(), 30.0);
    assert_eq!(contour.points[0].get_point_type(), &PointType::OnCurve);
    assert_eq!(contour.points[0].id(), id);
  }

  #[test]
  fn remove_point() {
    let mut contour = Contour::new();
    let id = contour.add_point(20.0, 30.0, PointType::OnCurve, false);
    let _ = contour.remove_point(id);
    assert_eq!(contour.points.len(), 0);
  }
}
