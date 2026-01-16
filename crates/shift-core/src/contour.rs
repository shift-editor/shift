use crate::{
  entity::{ContourId, PointId},
  point::{Point, PointType},
};

#[derive(Clone)]
pub struct Contour {
  cid: ContourId,
  points: Vec<Point>,
  closed: bool,
}

impl Contour {
  pub fn new() -> Self {
    Self {
      cid: ContourId::new(),
      points: Vec::new(),
      closed: false,
    }
  }

  pub fn id(&self) -> ContourId {
    self.cid
  }

  pub fn get_first_point(&self) -> Option<Point> {
    if self.points.len() > 0 {
      Some(self.points[0])
    } else {
      None
    }
  }

  pub fn add_point(&mut self, x: f64, y: f64, point_type: PointType, smooth: bool) -> PointId {
    let point_id = PointId::new_with_parent(&self.cid);
    let point = Point::new(point_id, x, y, point_type, smooth);
    self.points.push(point);
    point_id
  }

  /// Insert a point before an existing point.
  /// Returns None if the reference point is not found.
  pub fn insert_point_before(
    &mut self,
    before_id: PointId,
    x: f64,
    y: f64,
    point_type: PointType,
    smooth: bool,
  ) -> Option<PointId> {
    let index = self.points.iter().position(|p| p.id() == before_id)?;
    let point_id = PointId::new_with_parent(&self.cid);
    let point = Point::new(point_id, x, y, point_type, smooth);
    self.points.insert(index, point);
    Some(point_id)
  }

  pub fn get_point(&self, id: PointId) -> Option<&Point> {
    self.points.iter().find(|p| p.id() == id)
  }

  pub fn get_point_mut(&mut self, id: PointId) -> Option<&mut Point> {
    self.points.iter_mut().find(|p| p.id() == id)
  }

  pub fn remove_point(&mut self, id: PointId) -> Option<Point> {
    let index = self.points.iter().position(|i| i.id() == id)?;
    Some(self.points.remove(index))
  }

  pub fn points(&self) -> &[Point] {
    &self.points
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

  pub fn open(&mut self) {
    self.closed = false;
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
    assert_eq!(contour.points[0].x(), 20.0);
    assert_eq!(contour.points[0].y(), 30.0);
    assert_eq!(contour.points[0].point_type(), &PointType::OnCurve);
    assert_eq!(contour.points[0].id(), id);
  }

  #[test]
  fn get_point() {
    let mut contour = Contour::new();
    let id = contour.add_point(20.0, 30.0, PointType::OnCurve, false);

    let point = contour.get_point(id).unwrap();
    assert_eq!(point.x(), 20.0);
    assert_eq!(point.y(), 30.0);
  }

  #[test]
  fn get_point_mut() {
    let mut contour = Contour::new();
    let id = contour.add_point(20.0, 30.0, PointType::OnCurve, false);

    let point = contour.get_point_mut(id).unwrap();
    point.set_position(50.0, 60.0);

    assert_eq!(contour.get_point(id).unwrap().x(), 50.0);
    assert_eq!(contour.get_point(id).unwrap().y(), 60.0);
  }

  #[test]
  fn remove_point() {
    let mut contour = Contour::new();
    let id = contour.add_point(20.0, 30.0, PointType::OnCurve, false);

    let removed = contour.remove_point(id);
    assert!(removed.is_some());
    assert_eq!(contour.points.len(), 0);
  }

  #[test]
  fn remove_nonexistent_point() {
    let mut contour = Contour::new();
    let id = PointId::new();

    let removed = contour.remove_point(id);
    assert!(removed.is_none());
  }

  #[test]
  fn insert_point_before() {
    let mut contour = Contour::new();
    let id1 = contour.add_point(10.0, 10.0, PointType::OnCurve, false);
    let id2 = contour.add_point(30.0, 30.0, PointType::OnCurve, false);

    // Insert a point before id2
    let inserted_id = contour.insert_point_before(id2, 20.0, 20.0, PointType::OffCurve, false);
    assert!(inserted_id.is_some());

    // Verify order: [id1, inserted, id2]
    assert_eq!(contour.points.len(), 3);
    assert_eq!(contour.points[0].id(), id1);
    assert_eq!(contour.points[1].id(), inserted_id.unwrap());
    assert_eq!(contour.points[2].id(), id2);

    // Verify the inserted point's properties
    assert_eq!(contour.points[1].x(), 20.0);
    assert_eq!(contour.points[1].y(), 20.0);
    assert_eq!(contour.points[1].point_type(), &PointType::OffCurve);
  }

  #[test]
  fn insert_point_before_nonexistent() {
    let mut contour = Contour::new();
    contour.add_point(10.0, 10.0, PointType::OnCurve, false);
    let fake_id = PointId::new();

    let result = contour.insert_point_before(fake_id, 20.0, 20.0, PointType::OffCurve, false);
    assert!(result.is_none());
  }
}
