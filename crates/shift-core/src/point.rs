use crate::entity::PointId;

#[derive(Clone, PartialEq, Eq, Copy, Debug)]
pub enum PointType {
  OnCurve,
  OffCurve,
}

#[derive(Clone, Copy, Debug)]
pub struct Point {
  _id: PointId,
  x: f64,
  y: f64,
  point_type: PointType,
  smooth: bool,
}

impl Point {
  pub fn new(id: PointId, x: f64, y: f64, point_type: PointType, smooth: bool) -> Self {
    Self {
      _id: id,
      x,
      y,
      point_type,
      smooth,
    }
  }

  pub fn x(&self) -> f64 {
    self.x
  }

  pub fn y(&self) -> f64 {
    self.y
  }

  pub fn point_type(&self) -> &PointType {
    &self.point_type
  }

  pub fn id(&self) -> PointId {
    self._id
  }

  pub fn is_smooth(&self) -> bool {
    self.smooth
  }

  pub fn distance(&self, x: f64, y: f64) -> f64 {
    return ((self.x - x).powf(2.0) + (self.y - y).powf(2.0)).sqrt();
  }

  /// Set the position of the point
  pub fn set_position(&mut self, x: f64, y: f64) {
    self.x = x;
    self.y = y;
  }

  /// Translate the point by the given delta
  pub fn translate(&mut self, dx: f64, dy: f64) {
    self.x += dx;
    self.y += dy;
  }

  /// Set whether this point is smooth
  pub fn set_smooth(&mut self, smooth: bool) {
    self.smooth = smooth;
  }

  /// Set the point type
  pub fn set_point_type(&mut self, point_type: PointType) {
    self.point_type = point_type;
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn point_mutation() {
    let mut point = Point::new(PointId::new(), 10.0, 20.0, PointType::OnCurve, false);

    assert_eq!(point.x(), 10.0);
    assert_eq!(point.y(), 20.0);

    point.set_position(30.0, 40.0);
    assert_eq!(point.x(), 30.0);
    assert_eq!(point.y(), 40.0);

    point.translate(5.0, -10.0);
    assert_eq!(point.x(), 35.0);
    assert_eq!(point.y(), 30.0);
  }

  #[test]
  fn point_smooth_mutation() {
    let mut point = Point::new(PointId::new(), 0.0, 0.0, PointType::OnCurve, false);
    assert!(!point.is_smooth());

    point.set_smooth(true);
    assert!(point.is_smooth());
  }

  #[test]
  fn point_type_mutation() {
    let mut point = Point::new(PointId::new(), 0.0, 0.0, PointType::OnCurve, false);
    assert_eq!(point.point_type(), &PointType::OnCurve);

    point.set_point_type(PointType::OffCurve);
    assert_eq!(point.point_type(), &PointType::OffCurve);
  }
}
