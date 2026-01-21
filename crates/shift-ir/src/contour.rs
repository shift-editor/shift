use crate::entity::{ContourId, PointId};
use crate::point::{Point, PointType};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Contour {
    id: ContourId,
    points: Vec<Point>,
    closed: bool,
}

impl Default for Contour {
    fn default() -> Self {
        Self::new()
    }
}

impl Contour {
    pub fn new() -> Self {
        Self {
            id: ContourId::new(),
            points: Vec::new(),
            closed: false,
        }
    }

    pub fn with_id(id: ContourId) -> Self {
        Self {
            id,
            points: Vec::new(),
            closed: false,
        }
    }

    pub fn from_points(points: Vec<Point>, closed: bool) -> Self {
        Self {
            id: ContourId::new(),
            points,
            closed,
        }
    }

    pub fn id(&self) -> ContourId {
        self.id
    }

    pub fn points(&self) -> &[Point] {
        &self.points
    }

    pub fn points_mut(&mut self) -> &mut Vec<Point> {
        &mut self.points
    }

    pub fn is_closed(&self) -> bool {
        self.closed
    }

    pub fn is_empty(&self) -> bool {
        self.points.is_empty()
    }

    pub fn len(&self) -> usize {
        self.points.len()
    }

    pub fn close(&mut self) {
        self.closed = true;
    }

    pub fn open(&mut self) {
        self.closed = false;
    }

    pub fn reverse(&mut self) {
        self.points.reverse();
    }

    pub fn add_point(&mut self, x: f64, y: f64, point_type: PointType, smooth: bool) -> PointId {
        let id = PointId::new();
        let point = Point::new(id, x, y, point_type, smooth);
        self.points.push(point);
        id
    }

    pub fn push_point(&mut self, point: Point) {
        self.points.push(point);
    }

    pub fn insert_point(&mut self, index: usize, point: Point) {
        self.points.insert(index, point);
    }

    pub fn get_point(&self, id: PointId) -> Option<&Point> {
        self.points.iter().find(|p| p.id() == id)
    }

    pub fn get_point_mut(&mut self, id: PointId) -> Option<&mut Point> {
        self.points.iter_mut().find(|p| p.id() == id)
    }

    pub fn get_point_at(&self, index: usize) -> Option<&Point> {
        self.points.get(index)
    }

    pub fn get_point_at_mut(&mut self, index: usize) -> Option<&mut Point> {
        self.points.get_mut(index)
    }

    pub fn remove_point(&mut self, id: PointId) -> Option<Point> {
        let index = self.points.iter().position(|p| p.id() == id)?;
        Some(self.points.remove(index))
    }

    pub fn insert_point_before(
        &mut self,
        before_id: PointId,
        x: f64,
        y: f64,
        point_type: PointType,
        smooth: bool,
    ) -> Option<PointId> {
        let index = self.points.iter().position(|p| p.id() == before_id)?;
        let id = PointId::new();
        let point = Point::new(id, x, y, point_type, smooth);
        self.points.insert(index, point);
        Some(id)
    }

    pub fn point_index(&self, id: PointId) -> Option<usize> {
        self.points.iter().position(|p| p.id() == id)
    }

    pub fn first_point(&self) -> Option<&Point> {
        self.points.first()
    }

    pub fn last_point(&self) -> Option<&Point> {
        self.points.last()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contour_creation() {
        let c = Contour::new();
        assert!(c.is_empty());
        assert!(!c.is_closed());
    }

    #[test]
    fn add_points() {
        let mut c = Contour::new();
        let id1 = c.add_point(10.0, 20.0, PointType::OnCurve, false);
        let id2 = c.add_point(30.0, 40.0, PointType::OffCurve, false);

        assert_eq!(c.len(), 2);
        assert!(c.get_point(id1).is_some());
        assert!(c.get_point(id2).is_some());
    }

    #[test]
    fn remove_point() {
        let mut c = Contour::new();
        let id = c.add_point(10.0, 20.0, PointType::OnCurve, false);
        assert_eq!(c.len(), 1);

        let removed = c.remove_point(id);
        assert!(removed.is_some());
        assert!(c.is_empty());
    }

    #[test]
    fn close_contour() {
        let mut c = Contour::new();
        assert!(!c.is_closed());
        c.close();
        assert!(c.is_closed());
        c.open();
        assert!(!c.is_closed());
    }
}
