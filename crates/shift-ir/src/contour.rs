use crate::entity::{ContourId, PointId};
use crate::point::{Point, PointType};
use crate::segment::CurveSegmentIter;
use kurbo::{BezPath, PathEl};
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

    pub fn add_point_with_id(
        &mut self,
        id: PointId,
        x: f64,
        y: f64,
        point_type: PointType,
        smooth: bool,
    ) {
        let point = Point::new(id, x, y, point_type, smooth);
        self.points.push(point);
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

    pub fn segments(&self) -> CurveSegmentIter<'_> {
        CurveSegmentIter::new(&self.points, self.closed)
    }
}

#[derive(Debug, Clone)]
pub struct Contours(pub Vec<Contour>);

impl std::ops::Deref for Contours {
    type Target = Vec<Contour>;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl From<&BezPath> for Contours {
    fn from(path: &BezPath) -> Self {
        let mut contours = Vec::new();
        let mut current: Option<Contour> = None;

        for el in path.elements() {
            match *el {
                PathEl::MoveTo(p) => {
                    if let Some(c) = current.take() {
                        contours.push(c);
                    }
                    let mut c = Contour::new();
                    c.add_point(p.x, p.y, PointType::OnCurve, false);
                    current = Some(c);
                }
                PathEl::LineTo(p) => {
                    if let Some(c) = current.as_mut() {
                        c.add_point(p.x, p.y, PointType::OnCurve, false);
                    }
                }
                PathEl::QuadTo(ctrl, end) => {
                    if let Some(c) = current.as_mut() {
                        c.add_point(ctrl.x, ctrl.y, PointType::OffCurve, false);
                        c.add_point(end.x, end.y, PointType::OnCurve, false);
                    }
                }
                PathEl::CurveTo(c1, c2, end) => {
                    if let Some(c) = current.as_mut() {
                        c.add_point(c1.x, c1.y, PointType::OffCurve, false);
                        c.add_point(c2.x, c2.y, PointType::OffCurve, false);
                        c.add_point(end.x, end.y, PointType::OnCurve, false);
                    }
                }
                PathEl::ClosePath => {
                    if let Some(c) = current.as_mut() {
                        c.close();
                    }
                }
            }
        }

        if let Some(c) = current {
            contours.push(c);
        }

        Contours(contours)
    }
}

impl From<&Contour> for BezPath {
    fn from(contour: &Contour) -> Self {
        let mut path = BezPath::new();

        if let Some(first) = contour.points().first() {
            path.move_to((first.x(), first.y()));
        } else {
            return path;
        }

        for segment in contour.segments() {
            match segment {
                crate::segment::CurveSegment::Line(_, p2) => {
                    path.line_to((p2.x(), p2.y()));
                }
                crate::segment::CurveSegment::Quad(_, c, p3) => {
                    path.quad_to((c.x(), c.y()), (p3.x(), p3.y()));
                }
                crate::segment::CurveSegment::Cubic(_, c1, c2, p4) => {
                    path.curve_to((c1.x(), c1.y()), (c2.x(), c2.y()), (p4.x(), p4.y()));
                }
            }
        }

        if contour.is_closed() {
            path.close_path();
        }

        path
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

    use kurbo::PathEl;

    // -- BezPath conversion tests --

    #[test]
    fn empty_contour_to_bezpath() {
        let c = Contour::new();
        let path = BezPath::from(&c);
        assert_eq!(path.elements().len(), 0);
    }

    #[test]
    fn single_point_to_bezpath() {
        let mut c = Contour::new();
        c.add_point(10.0, 20.0, PointType::OnCurve, false);
        let path = BezPath::from(&c);
        assert_eq!(path.elements().len(), 1);
        assert!(matches!(path.elements()[0], PathEl::MoveTo(_)));
    }

    #[test]
    fn open_line_contour_to_bezpath() {
        let mut c = Contour::new();
        c.add_point(0.0, 0.0, PointType::OnCurve, false);
        c.add_point(100.0, 0.0, PointType::OnCurve, false);
        c.add_point(100.0, 100.0, PointType::OnCurve, false);

        let path = BezPath::from(&c);
        assert_eq!(path.elements().len(), 3);
        assert!(matches!(path.elements()[0], PathEl::MoveTo(_)));
        assert!(matches!(path.elements()[1], PathEl::LineTo(_)));
        assert!(matches!(path.elements()[2], PathEl::LineTo(_)));
    }

    #[test]
    fn closed_triangle_to_bezpath() {
        let mut c = Contour::new();
        c.add_point(0.0, 0.0, PointType::OnCurve, false);
        c.add_point(100.0, 0.0, PointType::OnCurve, false);
        c.add_point(50.0, 100.0, PointType::OnCurve, false);
        c.close();

        let path = BezPath::from(&c);
        let els = path.elements();
        assert_eq!(els.len(), 5);
        assert!(matches!(els[0], PathEl::MoveTo(_)));
        assert!(matches!(els[1], PathEl::LineTo(_)));
        assert!(matches!(els[2], PathEl::LineTo(_)));
        assert!(matches!(els[3], PathEl::LineTo(_)));
        assert!(matches!(els[4], PathEl::ClosePath));
    }

    #[test]
    fn cubic_contour_to_bezpath() {
        let mut c = Contour::new();
        c.add_point(0.0, 0.0, PointType::OnCurve, false);
        c.add_point(33.0, 100.0, PointType::OffCurve, false);
        c.add_point(66.0, 100.0, PointType::OffCurve, false);
        c.add_point(100.0, 0.0, PointType::OnCurve, false);

        let path = BezPath::from(&c);
        let els = path.elements();
        assert_eq!(els.len(), 2);
        assert!(matches!(els[0], PathEl::MoveTo(_)));
        assert!(matches!(els[1], PathEl::CurveTo(_, _, _)));
    }

    #[test]
    fn quad_contour_to_bezpath() {
        let mut c = Contour::new();
        c.add_point(0.0, 0.0, PointType::OnCurve, false);
        c.add_point(50.0, 100.0, PointType::OffCurve, false);
        c.add_point(100.0, 0.0, PointType::OnCurve, false);

        let path = BezPath::from(&c);
        let els = path.elements();
        assert_eq!(els.len(), 2);
        assert!(matches!(els[0], PathEl::MoveTo(_)));
        assert!(matches!(els[1], PathEl::QuadTo(_, _)));
    }

    #[test]
    fn mixed_segments_to_bezpath() {
        let mut c = Contour::new();
        c.add_point(0.0, 0.0, PointType::OnCurve, false);
        c.add_point(100.0, 0.0, PointType::OnCurve, false);
        c.add_point(133.0, 50.0, PointType::OffCurve, false);
        c.add_point(166.0, 50.0, PointType::OffCurve, false);
        c.add_point(200.0, 0.0, PointType::OnCurve, false);
        c.close();

        let path = BezPath::from(&c);
        let els = path.elements();
        // MoveTo + LineTo + CurveTo + LineTo(wrap) + ClosePath
        assert!(matches!(els[0], PathEl::MoveTo(_)));
        assert!(matches!(els[1], PathEl::LineTo(_)));
        assert!(matches!(els[2], PathEl::CurveTo(_, _, _)));
        assert!(matches!(els.last().unwrap(), PathEl::ClosePath));
    }

    // -- BezPath -> Vec<Contour> tests --

    #[test]
    fn bezpath_line_to_contour() {
        let mut path = BezPath::new();
        path.move_to((0.0, 0.0));
        path.line_to((100.0, 0.0));
        path.line_to((100.0, 100.0));
        path.close_path();

        let contours = Contours::from(&path);
        assert_eq!(contours.len(), 1);
        assert!(contours[0].is_closed());
        assert_eq!(contours[0].len(), 3);
    }

    #[test]
    fn bezpath_cubic_to_contour() {
        let mut path = BezPath::new();
        path.move_to((0.0, 0.0));
        path.curve_to((33.0, 100.0), (66.0, 100.0), (100.0, 0.0));

        let contours = Contours::from(&path);
        assert_eq!(contours.len(), 1);
        assert!(!contours[0].is_closed());
        // MoveTo point + 2 off-curve + 1 on-curve = 4
        assert_eq!(contours[0].len(), 4);
        assert_eq!(
            contours[0].get_point_at(0).unwrap().point_type(),
            PointType::OnCurve
        );
        assert_eq!(
            contours[0].get_point_at(1).unwrap().point_type(),
            PointType::OffCurve
        );
        assert_eq!(
            contours[0].get_point_at(2).unwrap().point_type(),
            PointType::OffCurve
        );
        assert_eq!(
            contours[0].get_point_at(3).unwrap().point_type(),
            PointType::OnCurve
        );
    }

    #[test]
    fn bezpath_multiple_subpaths_to_contours() {
        let mut path = BezPath::new();
        path.move_to((0.0, 0.0));
        path.line_to((50.0, 0.0));
        path.close_path();
        path.move_to((100.0, 100.0));
        path.line_to((200.0, 100.0));
        path.close_path();

        let contours = Contours::from(&path);
        assert_eq!(contours.len(), 2);
        assert!(contours[0].is_closed());
        assert!(contours[1].is_closed());
    }

    #[test]
    fn bezpath_open_subpath_to_contour() {
        let mut path = BezPath::new();
        path.move_to((10.0, 20.0));
        path.line_to((30.0, 40.0));

        let contours = Contours::from(&path);
        assert_eq!(contours.len(), 1);
        assert!(!contours[0].is_closed());
    }

    #[test]
    fn empty_bezpath_to_contours() {
        let path = BezPath::new();
        let contours = Contours::from(&path);
        assert!(contours.is_empty());
    }

    #[test]
    fn bezpath_coordinates_are_correct() {
        let mut c = Contour::new();
        c.add_point(10.0, 20.0, PointType::OnCurve, false);
        c.add_point(30.0, 40.0, PointType::OnCurve, false);

        let path = BezPath::from(&c);
        let els = path.elements();

        let PathEl::MoveTo(p0) = els[0] else {
            panic!("expected MoveTo");
        };
        assert_eq!(p0, kurbo::Point::new(10.0, 20.0));

        let PathEl::LineTo(p1) = els[1] else {
            panic!("expected LineTo");
        };
        assert_eq!(p1, kurbo::Point::new(30.0, 40.0));
    }
}
