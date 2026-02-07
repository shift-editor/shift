use crate::entity::PointId;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PointType {
    OnCurve,
    OffCurve,
    QCurve,
}

impl Default for PointType {
    fn default() -> Self {
        Self::OnCurve
    }
}

impl std::str::FromStr for PointType {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "onCurve" => Ok(Self::OnCurve),
            "offCurve" => Ok(Self::OffCurve),
            "qCurve" => Ok(Self::QCurve),
            _ => Err(format!("Invalid point type: {s}")),
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct Point {
    id: PointId,
    x: f64,
    y: f64,
    point_type: PointType,
    smooth: bool,
}

impl Point {
    pub fn new(id: PointId, x: f64, y: f64, point_type: PointType, smooth: bool) -> Self {
        Self {
            id,
            x,
            y,
            point_type,
            smooth,
        }
    }

    pub fn on_curve(x: f64, y: f64) -> Self {
        Self::new(PointId::new(), x, y, PointType::OnCurve, false)
    }

    pub fn off_curve(x: f64, y: f64) -> Self {
        Self::new(PointId::new(), x, y, PointType::OffCurve, false)
    }

    pub fn id(&self) -> PointId {
        self.id
    }

    pub fn x(&self) -> f64 {
        self.x
    }

    pub fn y(&self) -> f64 {
        self.y
    }

    pub fn point_type(&self) -> PointType {
        self.point_type
    }

    pub fn is_smooth(&self) -> bool {
        self.smooth
    }

    pub fn is_on_curve(&self) -> bool {
        matches!(self.point_type, PointType::OnCurve | PointType::QCurve)
    }

    pub fn distance(&self, x: f64, y: f64) -> f64 {
        ((self.x - x).powi(2) + (self.y - y).powi(2)).sqrt()
    }

    pub fn set_position(&mut self, x: f64, y: f64) {
        self.x = x;
        self.y = y;
    }

    pub fn translate(&mut self, dx: f64, dy: f64) {
        self.x += dx;
        self.y += dy;
    }

    pub fn set_smooth(&mut self, smooth: bool) {
        self.smooth = smooth;
    }

    pub fn toggle_smooth(&mut self) {
        self.smooth = !self.smooth;
    }

    pub fn set_point_type(&mut self, point_type: PointType) {
        self.point_type = point_type;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn point_creation() {
        let p = Point::on_curve(100.0, 200.0);
        assert_eq!(p.x(), 100.0);
        assert_eq!(p.y(), 200.0);
        assert_eq!(p.point_type(), PointType::OnCurve);
        assert!(!p.is_smooth());
    }

    #[test]
    fn point_mutation() {
        let mut p = Point::on_curve(10.0, 20.0);
        p.set_position(30.0, 40.0);
        assert_eq!(p.x(), 30.0);
        assert_eq!(p.y(), 40.0);

        p.translate(5.0, -10.0);
        assert_eq!(p.x(), 35.0);
        assert_eq!(p.y(), 30.0);
    }

    #[test]
    fn point_type_from_str() {
        assert_eq!("onCurve".parse::<PointType>().unwrap(), PointType::OnCurve);
        assert_eq!(
            "offCurve".parse::<PointType>().unwrap(),
            PointType::OffCurve
        );
        assert_eq!("qCurve".parse::<PointType>().unwrap(), PointType::QCurve);
        assert!("invalid".parse::<PointType>().is_err());
        assert!("OnCurve".parse::<PointType>().is_err());
    }

    #[test]
    fn point_smooth() {
        let mut p = Point::on_curve(0.0, 0.0);
        assert!(!p.is_smooth());
        p.set_smooth(true);
        assert!(p.is_smooth());
        p.toggle_smooth();
        assert!(!p.is_smooth());
    }
}
