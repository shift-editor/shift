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
}
