use crate::point::{Point, PointType};

/// A typed curve segment extracted from a contour's point list.
#[derive(Debug, Clone)]
pub enum CurveSegment<'a> {
    Line(&'a Point, &'a Point),
    Quad(&'a Point, &'a Point, &'a Point),
    Cubic(&'a Point, &'a Point, &'a Point, &'a Point),
}

/// One segment of a contour as the indices of its points, in order. A closed
/// contour's last segment wraps back to index 0.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SegmentIndices {
    Line([usize; 2]),
    Quad([usize; 3]),
    Cubic([usize; 4]),
}

impl SegmentIndices {
    /// The indices of the segment's points, from start to end.
    pub fn points(&self) -> &[usize] {
        match self {
            Self::Line(indices) => indices,
            Self::Quad(indices) => indices,
            Self::Cubic(indices) => indices,
        }
    }

    /// The index of the segment's first point. Its points are consecutive
    /// from there, wrapping to index 0 on a closed contour.
    pub fn first(&self) -> usize {
        match *self {
            Self::Line([first, _]) | Self::Quad([first, ..]) | Self::Cubic([first, ..]) => first,
        }
    }
}

/// The points of a contour, as far as segmenting it needs: how many there
/// are and which lie on the curve.
pub trait PointKinds {
    fn point_count(&self) -> usize;
    fn is_on_curve(&self, index: usize) -> bool;
}

impl PointKinds for [Point] {
    fn point_count(&self) -> usize {
        self.len()
    }

    fn is_on_curve(&self, index: usize) -> bool {
        self.get(index).is_some_and(Point::is_on_curve)
    }
}

impl PointKinds for [PointType] {
    fn point_count(&self) -> usize {
        self.len()
    }

    fn is_on_curve(&self, index: usize) -> bool {
        self.get(index).is_some_and(|kind| kind.is_on_curve())
    }
}

/// Classifies a contour's points into line, quadratic, or cubic segments by
/// whether each is on the curve, yielding each segment's point indices.
///
/// The one segment rule: [`CurveSegmentIter`] walks points with it, and the
/// editor walks point types with it through `shift-wasm`. A closed contour
/// with a single on-curve point yields one zero-length line, as the pen
/// protocol draws it.
pub struct SegmentIndexIter<'a, K: PointKinds + ?Sized> {
    kinds: &'a K,
    closed: bool,
    pos: usize,
    limit: usize,
}

impl<'a, K: PointKinds + ?Sized> SegmentIndexIter<'a, K> {
    pub fn new(kinds: &'a K, closed: bool) -> Self {
        let len = kinds.point_count();
        let limit = if closed { len } else { len.saturating_sub(1) };
        Self {
            kinds,
            closed,
            pos: 0,
            limit,
        }
    }

    /// `index`, wrapped to the start when the contour is closed.
    fn get(&self, index: usize) -> Option<usize> {
        let len = self.kinds.point_count();
        if index < len {
            Some(index)
        } else if self.closed && len > 0 {
            Some(index % len)
        } else {
            None
        }
    }
}

impl<K: PointKinds + ?Sized> Iterator for SegmentIndexIter<'_, K> {
    type Item = SegmentIndices;

    fn next(&mut self) -> Option<Self::Item> {
        while self.pos < self.limit {
            let p1 = self.get(self.pos)?;
            let p2 = self.get(self.pos + 1)?;
            let on = |index| self.kinds.is_on_curve(index);

            // Line: on-curve → on-curve
            if on(p1) && on(p2) {
                self.pos += 1;
                return Some(SegmentIndices::Line([p1, p2]));
            }

            // Quad or cubic: on-curve → off-curve → ...
            if on(p1)
                && !on(p2)
                && let Some(p3) = self.get(self.pos + 2)
            {
                if on(p3) {
                    self.pos += 2;
                    return Some(SegmentIndices::Quad([p1, p2, p3]));
                }
                if let Some(p4) = self.get(self.pos + 3) {
                    self.pos += 3;
                    return Some(SegmentIndices::Cubic([p1, p2, p3, p4]));
                }
            }

            self.pos += 1;
        }
        None
    }
}

/// Iterator that yields [`CurveSegment`]s from a point slice.
///
/// Walks the point list and classifies consecutive points into line,
/// quadratic, or cubic segments based on their on-curve/off-curve types,
/// by [`SegmentIndexIter`].
pub struct CurveSegmentIter<'a> {
    points: &'a [Point],
    indices: SegmentIndexIter<'a, [Point]>,
}

impl<'a> CurveSegmentIter<'a> {
    pub fn new(points: &'a [Point], closed: bool) -> Self {
        Self {
            points,
            indices: SegmentIndexIter::new(points, closed),
        }
    }
}

impl<'a> Iterator for CurveSegmentIter<'a> {
    type Item = CurveSegment<'a>;

    fn next(&mut self) -> Option<Self::Item> {
        let points = self.points;
        Some(match self.indices.next()? {
            SegmentIndices::Line([a, b]) => CurveSegment::Line(&points[a], &points[b]),
            SegmentIndices::Quad([a, b, c]) => {
                CurveSegment::Quad(&points[a], &points[b], &points[c])
            }
            SegmentIndices::Cubic([a, b, c, d]) => {
                CurveSegment::Cubic(&points[a], &points[b], &points[c], &points[d])
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::PointId;

    fn on(x: f64, y: f64) -> Point {
        Point::on_curve(x, y)
    }

    fn off(x: f64, y: f64) -> Point {
        Point::off_curve(x, y)
    }

    #[test]
    fn empty_points_yields_nothing() {
        let points: Vec<Point> = vec![];
        assert!(CurveSegmentIter::new(&points, false).next().is_none());
    }

    #[test]
    fn single_point_yields_nothing() {
        let points = vec![on(0.0, 0.0)];
        assert!(CurveSegmentIter::new(&points, false).next().is_none());
    }

    #[test]
    fn line_segments() {
        let points = vec![on(0.0, 0.0), on(100.0, 0.0), on(100.0, 100.0)];
        let segs: Vec<_> = CurveSegmentIter::new(&points, false).collect();
        assert_eq!(segs.len(), 2);
        assert!(matches!(segs[0], CurveSegment::Line(_, _)));
        assert!(matches!(segs[1], CurveSegment::Line(_, _)));
    }

    #[test]
    fn quad_segment() {
        let points = vec![on(0.0, 0.0), off(50.0, 100.0), on(100.0, 0.0)];
        let segs: Vec<_> = CurveSegmentIter::new(&points, false).collect();
        assert_eq!(segs.len(), 1);
        assert!(matches!(segs[0], CurveSegment::Quad(_, _, _)));
    }

    #[test]
    fn cubic_segment() {
        let points = vec![
            on(0.0, 0.0),
            off(33.0, 100.0),
            off(66.0, 100.0),
            on(100.0, 0.0),
        ];
        let segs: Vec<_> = CurveSegmentIter::new(&points, false).collect();
        assert_eq!(segs.len(), 1);
        assert!(matches!(segs[0], CurveSegment::Cubic(_, _, _, _)));
    }

    #[test]
    fn mixed_segments() {
        let points = vec![
            on(0.0, 0.0),
            on(100.0, 0.0),
            off(150.0, 50.0),
            on(200.0, 0.0),
        ];
        let segs: Vec<_> = CurveSegmentIter::new(&points, false).collect();
        assert_eq!(segs.len(), 2);
        assert!(matches!(segs[0], CurveSegment::Line(_, _)));
        assert!(matches!(segs[1], CurveSegment::Quad(_, _, _)));
    }

    #[test]
    fn closed_contour_wraps_around() {
        // A closed triangle: 3 on-curve points should yield 3 line segments
        let points = vec![on(0.0, 0.0), on(100.0, 0.0), on(50.0, 100.0)];
        let segs: Vec<_> = CurveSegmentIter::new(&points, true).collect();
        assert_eq!(segs.len(), 3);
        assert!(matches!(segs[0], CurveSegment::Line(_, _)));
        assert!(matches!(segs[1], CurveSegment::Line(_, _)));
        assert!(matches!(segs[2], CurveSegment::Line(_, _)));

        // The last segment should wrap: points[2] → points[0]
        if let CurveSegment::Line(a, b) = &segs[2] {
            assert_eq!(a.x(), 50.0);
            assert_eq!(b.x(), 0.0);
        } else {
            panic!("Expected Line segment");
        }
    }

    #[test]
    fn closed_cubic_wraps() {
        let points = vec![
            on(0.0, 0.0),
            off(33.0, 100.0),
            off(66.0, 100.0),
            on(100.0, 0.0),
            off(133.0, -100.0),
            off(166.0, -100.0),
        ];
        let segs: Vec<_> = CurveSegmentIter::new(&points, true).collect();
        assert_eq!(segs.len(), 2);
        assert!(matches!(segs[0], CurveSegment::Cubic(_, _, _, _)));
        assert!(matches!(segs[1], CurveSegment::Cubic(_, _, _, _)));
    }

    #[test]
    fn point_types_give_the_segments_and_bounds_points_give() {
        let points = vec![
            on(0.0, 0.0),
            off(10.0, 80.0),
            off(90.0, 80.0),
            on(100.0, 0.0),
            Point::new(
                PointId::from_raw("q"),
                120.0,
                -30.0,
                PointType::QCurve,
                false,
            ),
            off(60.0, -60.0),
            on(10.0, -20.0),
        ];
        let kinds: Vec<PointType> = points.iter().map(Point::point_type).collect();
        for closed in [false, true] {
            let from_points: Vec<_> = CurveSegmentIter::new(&points, closed)
                .map(|segment| segment.bounds())
                .collect();
            let position = |index: usize| (points[index].x(), points[index].y());
            let from_kinds: Vec<_> = SegmentIndexIter::new(kinds.as_slice(), closed)
                .map(|segment| segment.bounds(position))
                .collect();

            assert!(!from_points.is_empty());
            assert_eq!(from_kinds, from_points, "closed: {closed}");
        }
    }

    #[test]
    fn a_closed_single_on_curve_point_is_one_zero_length_line() {
        let kinds = [PointType::OnCurve];
        let segments: Vec<_> = SegmentIndexIter::new(kinds.as_slice(), true).collect();

        assert_eq!(segments, [SegmentIndices::Line([0, 0])]);
    }

    #[test]
    fn leading_off_curves_close_into_a_cubic_only_when_closed() {
        use PointType::{OffCurve, OnCurve};
        let kinds = [OffCurve, OffCurve, OnCurve, OnCurve];

        let closed: Vec<_> = SegmentIndexIter::new(kinds.as_slice(), true).collect();
        let open: Vec<_> = SegmentIndexIter::new(kinds.as_slice(), false).collect();

        assert_eq!(
            closed,
            [
                SegmentIndices::Line([2, 3]),
                SegmentIndices::Cubic([3, 0, 1, 2])
            ]
        );
        assert_eq!(open, [SegmentIndices::Line([2, 3])]);
    }

    #[test]
    fn an_open_run_of_three_off_curves_ends_in_one_cubic() {
        use PointType::{OffCurve, OnCurve};
        let kinds = [OnCurve, OffCurve, OffCurve, OffCurve];

        let segments: Vec<_> = SegmentIndexIter::new(kinds.as_slice(), false).collect();

        assert_eq!(segments, [SegmentIndices::Cubic([0, 1, 2, 3])]);
    }

    #[test]
    fn a_lone_off_curve_point_has_no_segments() {
        let kinds = [PointType::OffCurve];
        for closed in [false, true] {
            let mut segments = SegmentIndexIter::new(kinds.as_slice(), closed);
            assert!(segments.next().is_none(), "closed: {closed}");
        }
    }
}
