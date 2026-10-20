use crate::entity::PointId;
use serde::{Deserialize, Serialize};

crate::string_enum! {
    // The names match serde's camelCase names, which stored layers use.
    #[derive(Clone, Copy, Default, PartialEq, Eq, Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    #[allow(
        clippy::enum_variant_names,
        reason = "the font-format names for point types"
    )]
    pub enum PointType {
        #[default]
        OnCurve => "onCurve",
        OffCurve => "offCurve",
        QCurve => "qCurve",
    }
    parse_error: String = |text| format!("Invalid point type: {text}");
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
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
        self.id.clone()
    }

    pub fn position(&self) -> kurbo::Point {
        kurbo::Point::new(self.x, self.y)
    }

    /// Returns a copy of this point at `position`, under a new id.
    pub fn copied_to(&self, position: kurbo::Point) -> Self {
        Self::new(
            PointId::new(),
            position.x,
            position.y,
            self.point_type,
            self.smooth,
        )
    }

    /// Returns a copy of this point under a new id.
    pub fn with_fresh_id(&self) -> Self {
        self.copied_to(self.position())
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
        "invalid".parse::<PointType>().unwrap_err();
        "OnCurve".parse::<PointType>().unwrap_err();
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

    #[test]
    fn copies_keep_type_and_smoothness_under_a_new_id() {
        let mut point = Point::off_curve(10.0, 20.0);
        point.set_smooth(true);

        let moved = point.copied_to(kurbo::Point::new(30.0, 40.0));
        let fresh = point.with_fresh_id();

        assert_ne!(moved.id(), point.id());
        assert_eq!(moved.position(), kurbo::Point::new(30.0, 40.0));
        assert_eq!(moved.point_type(), PointType::OffCurve);
        assert!(moved.is_smooth());
        assert_ne!(fresh.id(), point.id());
        assert_eq!(fresh.position(), point.position());
    }
}
