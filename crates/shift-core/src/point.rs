use crate::entity::PointId;

#[derive(Clone, PartialEq, Eq, Copy, Debug)]
pub enum PointType {
  OnCurve,
  OffCurve,
}

#[derive(Clone, Copy, Debug)]
pub struct Point {
  id: PointId,
  x: f64,
  y: f64,
  point_type: PointType,
  smooth: bool,
}

impl Point {
  pub fn new(x: f64, y: f64, point_type: PointType, smooth: bool) -> Self {
    Self {
      id: PointId::new(),
      x,
      y,
      point_type,
      smooth,
    }
  }

  pub fn get_x(&self) -> f64 {
    self.x
  }

  pub fn get_y(&self) -> f64 {
    self.y
  }

  pub fn get_point_type(&self) -> &PointType {
    &self.point_type
  }

  pub fn is_smooth(&self) -> bool {
    self.smooth
  }

  pub fn id(&self) -> PointId {
    self.id
  }
}
