use crate::collection::Identified;
use crate::entity::{ContourId, PointId};
use crate::point::{Point, PointType};
use crate::segment::CurveSegmentIter;
use kurbo::{BezPath, PathEl};
use serde::{Deserialize, Serialize};

/// How near a closing point must be to the start to count as repeating it.
const REPEATED_POINT_EPSILON: f64 = 1e-6;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct Contour {
    id: ContourId,
    points: Vec<Point>,
    closed: bool,
}

impl Identified for Contour {
    type Id = ContourId;

    fn id(&self) -> Self::Id {
        Self::id(self)
    }
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
        self.id.clone()
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

    /// Removes a trailing on-curve point that sits on the first point.
    ///
    /// A path closed by `ClosePath` often ends its last segment on its own
    /// start; a closed contour wraps to the first point and must not repeat it.
    pub fn close(&mut self) {
        self.closed = true;
    }

    pub fn open(&mut self) {
        self.closed = false;
    }

    pub fn reverse(&mut self) {
        self.points.reverse();
    }

    /// Rotates a closed contour so its first point is its first on-curve point.
    ///
    /// Glyphs and UFO sources may list a closed contour's leading off-curve
    /// controls before its start point. Rotation keeps every segment and
    /// point identity; corresponding master contours rotate by the same
    /// amount, so interpolation compatibility is unchanged. Open contours
    /// and contours without an on-curve point are left as they are.
    pub fn start_at_first_on_curve(&mut self) {
        if !self.closed {
            return;
        }
        if let Some(start) = self.points.iter().position(Point::is_on_curve) {
            self.points.rotate_left(start);
        }
    }

    pub fn add_point(&mut self, x: f64, y: f64, point_type: PointType, smooth: bool) -> PointId {
        let id = PointId::new();
        let point = Point::new(id.clone(), x, y, point_type, smooth);
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

    pub fn get_point(&self, id: &PointId) -> Option<&Point> {
        self.points.iter().find(|p| p.id() == *id)
    }

    pub fn get_point_mut(&mut self, id: &PointId) -> Option<&mut Point> {
        self.points.iter_mut().find(|p| p.id() == *id)
    }

    pub fn get_point_at(&self, index: usize) -> Option<&Point> {
        self.points.get(index)
    }

    pub fn get_point_at_mut(&mut self, index: usize) -> Option<&mut Point> {
        self.points.get_mut(index)
    }

    pub fn remove_point(&mut self, id: &PointId) -> Option<Point> {
        let index = self.points.iter().position(|p| p.id() == *id)?;
        Some(self.points.remove(index))
    }

    pub fn insert_point_before(
        &mut self,
        before_id: &PointId,
        x: f64,
        y: f64,
        point_type: PointType,
        smooth: bool,
    ) -> Option<PointId> {
        let index = self.points.iter().position(|p| p.id() == *before_id)?;
        let id = PointId::new();
        let point = Point::new(id.clone(), x, y, point_type, smooth);
        self.points.insert(index, point);
        Some(id)
    }

    pub fn point_index(&self, id: &PointId) -> Option<usize> {
        self.points.iter().position(|p| p.id() == *id)
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
        Self(
            SubpathPoints::of_path(path)
                .into_iter()
                .map(Contour::from)
                .collect(),
        )
    }
}

/// One subpath of a [`BezPath`] as plain data, with no ids.
///
/// A [`Contour`] mints a random id for itself and for every point, which costs
/// several times what flattening a stroke outline does. A reader that only
/// draws or sends the points takes them from here; [`Contours::from`] builds
/// on this, so both read a path alike.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SubpathPoints {
    /// Whether the subpath ends in a `ClosePath`.
    pub closed: bool,
    /// One entry per point, in path order: a cubic adds two off-curve points
    /// and its end, a quadratic an off-curve point and a `QCurve` end.
    pub point_types: Vec<PointType>,
    /// The points' x and y in font units, interleaved: two numbers for each
    /// entry of `point_types`.
    pub coordinates: Vec<f64>,
}

impl SubpathPoints {
    /// The subpaths of `path`, one for each `MoveTo`, in order.
    ///
    /// A closing `ClosePath` drops an end point that is on-curve and repeats
    /// the start, since the closed contour already returns there.
    pub fn of_path(path: &BezPath) -> Vec<Self> {
        let mut subpaths = Vec::new();
        let mut current: Option<Self> = None;

        for element in path.elements() {
            match *element {
                PathEl::MoveTo(point) => {
                    subpaths.extend(current.take());
                    let mut subpath = Self::default();
                    subpath.push(point, PointType::OnCurve);
                    current = Some(subpath);
                }
                PathEl::LineTo(point) => {
                    if let Some(subpath) = current.as_mut() {
                        subpath.push(point, PointType::OnCurve);
                    }
                }
                PathEl::QuadTo(control, end) => {
                    if let Some(subpath) = current.as_mut() {
                        subpath.push(control, PointType::OffCurve);
                        subpath.push(end, PointType::QCurve);
                    }
                }
                PathEl::CurveTo(first, second, end) => {
                    if let Some(subpath) = current.as_mut() {
                        subpath.push(first, PointType::OffCurve);
                        subpath.push(second, PointType::OffCurve);
                        subpath.push(end, PointType::OnCurve);
                    }
                }
                PathEl::ClosePath => {
                    if let Some(subpath) = current.as_mut() {
                        subpath.close();
                    }
                }
            }
        }

        subpaths.extend(current);
        subpaths
    }

    fn push(&mut self, point: kurbo::Point, point_type: PointType) {
        self.point_types.push(point_type);
        self.coordinates.extend([point.x, point.y]);
    }

    /// Marks the subpath closed, without an end point that repeats its start.
    fn close(&mut self) {
        self.closed = true;

        let ([first, .., last], _) = self.coordinates.as_chunks::<2>() else {
            return;
        };
        let repeats_start = self.point_types.last() == Some(&PointType::OnCurve)
            && kurbo::Point::new(last[0], last[1]).distance(kurbo::Point::new(first[0], first[1]))
                <= REPEATED_POINT_EPSILON;
        if repeats_start {
            self.point_types.pop();
            self.coordinates.pop();
            self.coordinates.pop();
        }
    }
}

impl From<SubpathPoints> for Contour {
    fn from(subpath: SubpathPoints) -> Self {
        let mut contour = Self::new();
        let (points, _) = subpath.coordinates.as_chunks::<2>();
        for (point_type, &[x, y]) in subpath.point_types.iter().zip(points) {
            contour.add_point(x, y, *point_type, false);
        }
        if subpath.closed {
            contour.close();
        }
        contour
    }
}

/// Draws the contour from its first segment's on-curve start.
///
/// Glyphs and UFO contours may begin with off-curve points; segment iteration
/// starts at the first on-curve point and wraps the leading controls into the
/// closing segment, so the path starts there too. A contour with no segments
/// draws nothing.
impl From<&Contour> for BezPath {
    fn from(contour: &Contour) -> Self {
        use crate::segment::CurveSegment;

        let mut path = Self::new();
        let mut segments = contour.segments().peekable();
        let Some(
            CurveSegment::Line(first, _)
            | CurveSegment::Quad(first, _, _)
            | CurveSegment::Cubic(first, _, _, _),
        ) = segments.peek()
        else {
            return path;
        };

        path.move_to((first.x(), first.y()));
        for segment in segments {
            match segment {
                CurveSegment::Line(_, end) => path.line_to((end.x(), end.y())),
                CurveSegment::Quad(_, control, end) => {
                    path.quad_to((control.x(), control.y()), (end.x(), end.y()));
                }
                CurveSegment::Cubic(_, first_control, second_control, end) => {
                    path.curve_to(
                        (first_control.x(), first_control.y()),
                        (second_control.x(), second_control.y()),
                        (end.x(), end.y()),
                    );
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
    fn a_contour_starting_off_curve_draws_from_an_on_curve_point() {
        let mut contour = Contour::new();
        contour.add_point(10.0, 0.0, PointType::OffCurve, false);
        contour.add_point(20.0, 10.0, PointType::OffCurve, false);
        contour.add_point(20.0, 20.0, PointType::OnCurve, false);
        contour.add_point(0.0, 20.0, PointType::OnCurve, false);
        contour.add_point(0.0, 0.0, PointType::OnCurve, false);
        contour.close();

        let elements = BezPath::from(&contour).elements().to_vec();

        assert_eq!(
            elements,
            vec![
                kurbo::PathEl::MoveTo((20.0, 20.0).into()),
                kurbo::PathEl::LineTo((0.0, 20.0).into()),
                kurbo::PathEl::LineTo((0.0, 0.0).into()),
                kurbo::PathEl::CurveTo(
                    (10.0, 0.0).into(),
                    (20.0, 10.0).into(),
                    (20.0, 20.0).into()
                ),
                kurbo::PathEl::ClosePath,
            ]
        );
    }

    #[test]
    fn closed_contour_starts_at_first_on_curve() {
        let mut c = Contour::new();
        c.add_point(10.0, 0.0, PointType::OffCurve, false);
        c.add_point(20.0, 10.0, PointType::OffCurve, false);
        c.add_point(20.0, 20.0, PointType::OnCurve, false);
        c.add_point(0.0, 0.0, PointType::OnCurve, false);
        c.close();

        c.start_at_first_on_curve();

        let xs: Vec<f64> = c.points().iter().map(Point::x).collect();
        assert_eq!(xs, vec![20.0, 0.0, 10.0, 20.0]);
    }

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
        assert!(c.get_point(&id1).is_some());
        assert!(c.get_point(&id2).is_some());
    }

    #[test]
    fn remove_point() {
        let mut c = Contour::new();
        let id = c.add_point(10.0, 20.0, PointType::OnCurve, false);
        assert_eq!(c.len(), 1);

        let removed = c.remove_point(&id);
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
    fn single_point_to_bezpath_draws_nothing() {
        let mut c = Contour::new();
        c.add_point(10.0, 20.0, PointType::OnCurve, false);
        let path = BezPath::from(&c);
        assert!(path.elements().is_empty());
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
        let c = crate::contour![(0.0, 0.0), (100.0, 0.0), (50.0, 100.0)];

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
    fn bezpath_quadratic_to_contour_preserves_qcurve_endpoint() {
        let mut path = BezPath::new();
        path.move_to((0.0, 0.0));
        path.quad_to((50.0, 100.0), (100.0, 0.0));

        let contours = Contours::from(&path);
        assert_eq!(contours.len(), 1);
        assert_eq!(contours[0].len(), 3);
        assert_eq!(
            contours[0].get_point_at(1).unwrap().point_type(),
            PointType::OffCurve
        );
        assert_eq!(
            contours[0].get_point_at(2).unwrap().point_type(),
            PointType::QCurve
        );
    }

    #[test]
    fn bezpath_close_path_drops_an_end_point_that_repeats_the_start() {
        let mut path = BezPath::new();
        path.move_to((0.0, 0.0));
        path.curve_to((0.0, 50.0), (50.0, 100.0), (100.0, 100.0));
        path.curve_to((50.0, 0.0), (0.0, -50.0), (0.0, 0.0));
        path.close_path();

        let contours = Contours::from(&path);

        assert_eq!(contours.len(), 1);
        assert!(contours[0].is_closed());
        // start + 2 controls + corner + 2 controls; the final curve ends on the start.
        assert_eq!(contours[0].len(), 6);
    }

    #[test]
    fn bezpath_close_path_keeps_distinct_end_points() {
        let mut path = BezPath::new();
        path.move_to((0.0, 0.0));
        path.line_to((100.0, 0.0));
        path.line_to((100.0, 100.0));
        path.close_path();

        assert_eq!(Contours::from(&path)[0].len(), 3);
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
    fn subpath_points_of_a_cubic_path_are_flat_pairs_with_their_types() {
        let mut path = BezPath::new();
        path.move_to((0.0, 0.0));
        path.curve_to((10.0, 20.0), (30.0, 40.0), (50.0, 60.0));

        assert_eq!(
            SubpathPoints::of_path(&path),
            vec![SubpathPoints {
                closed: false,
                point_types: vec![
                    PointType::OnCurve,
                    PointType::OffCurve,
                    PointType::OffCurve,
                    PointType::OnCurve,
                ],
                coordinates: vec![0.0, 0.0, 10.0, 20.0, 30.0, 40.0, 50.0, 60.0],
            }]
        );
    }

    #[test]
    fn subpath_points_of_a_quad_ends_on_a_qcurve_point() {
        let mut path = BezPath::new();
        path.move_to((0.0, 0.0));
        path.quad_to((50.0, 100.0), (100.0, 0.0));

        let [subpath] = SubpathPoints::of_path(&path).try_into().unwrap();

        assert_eq!(
            subpath.point_types,
            vec![PointType::OnCurve, PointType::OffCurve, PointType::QCurve]
        );
    }

    #[test]
    fn subpath_points_close_drops_an_end_point_that_repeats_the_start() {
        let mut path = BezPath::new();
        path.move_to((0.0, 0.0));
        path.line_to((100.0, 0.0));
        path.line_to((0.0, 0.0));
        path.close_path();

        let [subpath] = SubpathPoints::of_path(&path).try_into().unwrap();

        assert!(subpath.closed);
        assert_eq!(subpath.coordinates, vec![0.0, 0.0, 100.0, 0.0]);
    }

    #[test]
    fn subpath_points_close_keeps_a_repeating_end_that_is_not_on_curve() {
        let mut path = BezPath::new();
        path.move_to((0.0, 0.0));
        path.quad_to((50.0, 50.0), (0.0, 0.0));
        path.close_path();

        let [subpath] = SubpathPoints::of_path(&path).try_into().unwrap();

        assert_eq!(subpath.point_types.len(), 3);
    }

    #[test]
    fn subpath_points_split_at_each_move_to() {
        let mut path = BezPath::new();
        path.move_to((0.0, 0.0));
        path.line_to((50.0, 0.0));
        path.close_path();
        path.move_to((100.0, 100.0));
        path.line_to((200.0, 100.0));

        let subpaths = SubpathPoints::of_path(&path);

        assert_eq!(
            subpaths
                .iter()
                .map(|subpath| subpath.closed)
                .collect::<Vec<_>>(),
            vec![true, false]
        );
        assert_eq!(subpaths[1].coordinates, vec![100.0, 100.0, 200.0, 100.0]);
    }

    #[test]
    fn subpath_points_of_an_empty_path_are_empty() {
        assert!(SubpathPoints::of_path(&BezPath::new()).is_empty());
    }

    #[test]
    fn a_contour_from_subpath_points_keeps_their_types_coordinates_and_closure() {
        let mut path = BezPath::new();
        path.move_to((0.0, 0.0));
        path.curve_to((10.0, 20.0), (30.0, 40.0), (50.0, 60.0));
        path.line_to((0.0, 60.0));
        path.close_path();
        let [subpath] = SubpathPoints::of_path(&path).try_into().unwrap();

        let contour = Contour::from(subpath.clone());

        assert!(contour.is_closed());
        assert_eq!(
            contour
                .points()
                .iter()
                .map(Point::point_type)
                .collect::<Vec<_>>(),
            subpath.point_types
        );
        assert_eq!(
            contour
                .points()
                .iter()
                .flat_map(|point| [point.x(), point.y()])
                .collect::<Vec<_>>(),
            subpath.coordinates
        );
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
