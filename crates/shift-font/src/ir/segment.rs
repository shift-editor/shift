use crate::point::Point;

/// A typed curve segment extracted from a contour's point list.
#[derive(Debug, Clone)]
pub enum CurveSegment<'a> {
    Line(&'a Point, &'a Point),
    Quad(&'a Point, &'a Point, &'a Point),
    Cubic(&'a Point, &'a Point, &'a Point, &'a Point),
}

/// Iterator that yields [`CurveSegment`]s from a point slice.
///
/// Walks the point list and classifies consecutive points into line,
/// quadratic, or cubic segments based on their on-curve/off-curve types.
pub struct CurveSegmentIter<'a> {
    points: &'a [Point],
    closed: bool,
    pos: usize,
    limit: usize,
}

impl<'a> CurveSegmentIter<'a> {
    pub fn new(points: &'a [Point], closed: bool) -> Self {
        let limit = if closed {
            points.len()
        } else {
            points.len().saturating_sub(1)
        };
        Self {
            points,
            closed,
            pos: 0,
            limit,
        }
    }

    fn get(&self, idx: usize) -> Option<&'a Point> {
        if idx < self.points.len() {
            Some(&self.points[idx])
        } else if self.closed && !self.points.is_empty() {
            Some(&self.points[idx % self.points.len()])
        } else {
            None
        }
    }
}

impl<'a> Iterator for CurveSegmentIter<'a> {
    type Item = CurveSegment<'a>;

    fn next(&mut self) -> Option<Self::Item> {
        while self.pos < self.limit {
            let p1 = self.get(self.pos)?;
            let p2 = self.get(self.pos + 1)?;

            // Line: on-curve → on-curve
            if p1.is_on_curve() && p2.is_on_curve() {
                self.pos += 1;
                return Some(CurveSegment::Line(p1, p2));
            }

            // Quad or cubic: on-curve → off-curve → ...
            if p1.is_on_curve() && !p2.is_on_curve() {
                if let Some(p3) = self.get(self.pos + 2) {
                    if p3.is_on_curve() {
                        self.pos += 2;
                        return Some(CurveSegment::Quad(p1, p2, p3));
                    }
                    if let Some(p4) = self.get(self.pos + 3) {
                        self.pos += 3;
                        return Some(CurveSegment::Cubic(p1, p2, p3, p4));
                    }
                }
            }

            self.pos += 1;
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn on(x: f64, y: f64) -> Point {
        Point::on_curve(x, y)
    }

    fn off(x: f64, y: f64) -> Point {
        Point::off_curve(x, y)
    }

    #[test]
    fn empty_points_yields_nothing() {
        let points: Vec<Point> = vec![];
        let segs: Vec<_> = CurveSegmentIter::new(&points, false).collect();
        assert!(segs.is_empty());
    }

    #[test]
    fn single_point_yields_nothing() {
        let points = vec![on(0.0, 0.0)];
        let segs: Vec<_> = CurveSegmentIter::new(&points, false).collect();
        assert!(segs.is_empty());
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
}
