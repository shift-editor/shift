//! Contours whose point kinds are explicit: normalizing them, and walking
//! their segments.

use super::GlyphPointKind;

/// A contour point whose kind is explicit: each control is tagged quadratic
/// or cubic, and implied on-curve points are present.
pub(crate) trait KindedPoint {
    fn kind(&self) -> GlyphPointKind;
}

impl KindedPoint for super::GlyphPoint {
    fn kind(&self) -> GlyphPointKind {
        self.kind
    }
}

impl<T> KindedPoint for (GlyphPointKind, T) {
    fn kind(&self) -> GlyphPointKind {
        self.0
    }
}

/// A point that can stand for the on-curve point a quadratic outline implies
/// between two of its controls.
pub(crate) trait ImpliedPoint: KindedPoint + Clone {
    /// The on-curve point halfway between `first` and `second`.
    fn implied_between(first: &Self, second: &Self) -> Self;
}

/// `points` starting on-curve, with the on-curve point a quadratic outline
/// implies between each pair of adjacent quadratic controls inserted.
///
/// A closed contour is rotated to start at its first on-curve point. A closed
/// contour of quadratic controls alone starts at the point implied between its
/// last and first controls.
///
/// # Errors
///
/// Returns [`ContourError::Empty`] for no points,
/// [`ContourError::DoesNotBeginOnCurve`] for an open contour that
/// starts with a control, and [`ContourError::OffCurveNotQuadratic`] for
/// a closed contour of controls that are not all quadratic.
pub(crate) fn normalize_points<T: ImpliedPoint>(
    points: &[T],
    closed: bool,
) -> Result<Vec<T>, ContourError> {
    let (Some(first), Some(last)) = (points.first(), points.last()) else {
        return Err(ContourError::Empty);
    };
    let first_on = points
        .iter()
        .position(|point| point.kind() == GlyphPointKind::OnCurve);
    let (start, indexes, all_off_curve): (T, Vec<usize>, bool) = match (closed, first_on) {
        (false, Some(0)) => (first.clone(), (1..points.len()).collect(), false),
        (false, _) => return Err(ContourError::DoesNotBeginOnCurve),
        (true, Some(start)) => (
            points[start].clone(),
            (1..points.len())
                .map(|offset| (start + offset) % points.len())
                .collect(),
            false,
        ),
        (true, None) => {
            if points
                .iter()
                .any(|point| point.kind() != GlyphPointKind::QuadraticControl)
            {
                return Err(ContourError::OffCurveNotQuadratic);
            }
            (
                T::implied_between(last, first),
                (0..points.len()).collect(),
                true,
            )
        }
    };

    let mut normalized = Vec::with_capacity(points.len() * 2);
    normalized.push(start);
    for (position, index) in indexes.iter().copied().enumerate() {
        let point = &points[index];
        normalized.push(point.clone());
        let next = match index + 1 {
            next if next < points.len() => Some(next),
            _ if closed => Some(0),
            _ => None,
        };
        let closes_all_off_curve = all_off_curve && position + 1 == indexes.len();
        if let Some(next) = next
            && point.kind() == GlyphPointKind::QuadraticControl
            && points[next].kind() == GlyphPointKind::QuadraticControl
            && !closes_all_off_curve
        {
            normalized.push(T::implied_between(point, &points[next]));
        }
    }
    Ok(normalized)
}

/// One segment of a contour, as indexes into its points.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum PointSegment {
    Line {
        start: usize,
        end: usize,
    },
    Quadratic {
        start: usize,
        control: usize,
        end: usize,
    },
    Cubic {
        start: usize,
        first: usize,
        second: usize,
        end: usize,
    },
}

impl PointSegment {
    /// The index of the on-curve point the segment ends at.
    pub(crate) fn end(self) -> usize {
        match self {
            Self::Line { end, .. } | Self::Quadratic { end, .. } | Self::Cubic { end, .. } => end,
        }
    }
}

/// Why a contour's points do not normalize or do not form segments.
#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum ContourError {
    #[error("contour has no points")]
    Empty,

    #[error("closed contour without an endpoint contains non-quadratic controls")]
    OffCurveNotQuadratic,

    #[error("contour does not begin on-curve")]
    DoesNotBeginOnCurve,

    #[error("quadratic control is not followed by an endpoint")]
    QuadraticWithoutEndpoint,

    #[error("cubic controls are not followed by an endpoint")]
    CubicWithoutEndpoint,
}

/// The segments of a contour that begins on-curve, in order.
///
/// A closed contour's last segment ends back at its first point. An open
/// contour's segments stop at its last point. The iterator stops after the
/// first error.
pub(crate) struct ContourSegments<'a, T> {
    points: &'a [T],
    limit: usize,
    cursor: usize,
    current: usize,
}

impl<'a, T: KindedPoint> ContourSegments<'a, T> {
    /// Starts walking `points`.
    ///
    /// # Errors
    ///
    /// Returns [`ContourError::DoesNotBeginOnCurve`] when `points` is
    /// empty or its first point is a control.
    pub(crate) fn new(points: &'a [T], closed: bool) -> Result<Self, ContourError> {
        if points
            .first()
            .is_none_or(|point| point.kind() != GlyphPointKind::OnCurve)
        {
            return Err(ContourError::DoesNotBeginOnCurve);
        }

        let limit = if closed {
            points.len() + 1
        } else {
            points.len()
        };
        Ok(Self {
            points,
            limit,
            cursor: 1,
            current: 0,
        })
    }

    fn index(&self, offset: usize) -> usize {
        (self.cursor + offset) % self.points.len()
    }

    /// Whether the point `offset` past the cursor exists and has `kind`.
    fn is(&self, offset: usize, kind: GlyphPointKind) -> bool {
        self.cursor + offset < self.limit && self.points[self.index(offset)].kind() == kind
    }

    fn segment(&self) -> Result<(PointSegment, usize), ContourError> {
        let start = self.current;
        match self.points[self.index(0)].kind() {
            GlyphPointKind::OnCurve => Ok((
                PointSegment::Line {
                    start,
                    end: self.index(0),
                },
                1,
            )),
            GlyphPointKind::QuadraticControl => {
                if !self.is(1, GlyphPointKind::OnCurve) {
                    return Err(ContourError::QuadraticWithoutEndpoint);
                }
                Ok((
                    PointSegment::Quadratic {
                        start,
                        control: self.index(0),
                        end: self.index(1),
                    },
                    2,
                ))
            }
            GlyphPointKind::CubicControl => {
                if !self.is(1, GlyphPointKind::CubicControl) || !self.is(2, GlyphPointKind::OnCurve)
                {
                    return Err(ContourError::CubicWithoutEndpoint);
                }
                Ok((
                    PointSegment::Cubic {
                        start,
                        first: self.index(0),
                        second: self.index(1),
                        end: self.index(2),
                    },
                    3,
                ))
            }
        }
    }
}

impl<T: KindedPoint> Iterator for ContourSegments<'_, T> {
    type Item = Result<PointSegment, ContourError>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.cursor >= self.limit {
            return None;
        }

        match self.segment() {
            Ok((segment, length)) => {
                self.cursor += length;
                self.current = segment.end();
                Some(Ok(segment))
            }
            Err(error) => {
                self.cursor = self.limit;
                Some(Err(error))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use GlyphPointKind::{CubicControl as C, OnCurve as On, QuadraticControl as Q};

    fn segments(kinds: &[GlyphPointKind], closed: bool) -> Result<Vec<PointSegment>, ContourError> {
        let points: Vec<_> = kinds.iter().map(|kind| (*kind, ())).collect();
        ContourSegments::new(&points, closed)?.collect()
    }

    #[derive(Clone, Debug, PartialEq)]
    struct Kinded(GlyphPointKind, f64);

    impl KindedPoint for Kinded {
        fn kind(&self) -> GlyphPointKind {
            self.0
        }
    }

    impl ImpliedPoint for Kinded {
        fn implied_between(first: &Self, second: &Self) -> Self {
            Self(On, (first.1 + second.1) * 0.5)
        }
    }

    fn normalized(points: &[(GlyphPointKind, f64)], closed: bool) -> Vec<(GlyphPointKind, f64)> {
        let points: Vec<_> = points.iter().map(|(kind, x)| Kinded(*kind, *x)).collect();
        normalize_points(&points, closed)
            .expect("normalizes")
            .into_iter()
            .map(|Kinded(kind, x)| (kind, x))
            .collect()
    }

    #[test]
    fn normalizing_rotates_a_closed_contour_to_its_first_on_curve_point() {
        assert_eq!(
            normalized(&[(Q, 0.0), (On, 1.0), (On, 2.0)], true),
            [(On, 1.0), (On, 2.0), (Q, 0.0)]
        );
    }

    #[test]
    fn normalizing_inserts_implied_points_between_quadratic_controls() {
        assert_eq!(
            normalized(&[(On, 0.0), (Q, 2.0), (Q, 4.0), (On, 6.0)], false),
            [(On, 0.0), (Q, 2.0), (On, 3.0), (Q, 4.0), (On, 6.0)]
        );
        // The wrap from the last control to the first point is only implied
        // when the contour is closed.
        assert_eq!(
            normalized(&[(On, 0.0), (Q, 2.0), (Q, 4.0)], true),
            [(On, 0.0), (Q, 2.0), (On, 3.0), (Q, 4.0)]
        );
    }

    #[test]
    fn normalizing_starts_a_contour_of_controls_between_its_last_and_first() {
        assert_eq!(
            normalized(&[(Q, 0.0), (Q, 2.0), (Q, 4.0)], true),
            [
                (On, 2.0),
                (Q, 0.0),
                (On, 1.0),
                (Q, 2.0),
                (On, 3.0),
                (Q, 4.0)
            ]
        );
    }

    #[test]
    fn normalizing_rejects_contours_it_cannot_start() {
        let reject = |points: &[(GlyphPointKind, f64)], closed| {
            let points: Vec<_> = points.iter().map(|(kind, x)| Kinded(*kind, *x)).collect();
            normalize_points(&points, closed).expect_err("rejects")
        };

        assert_eq!(reject(&[], true), ContourError::Empty);
        assert_eq!(
            reject(&[(Q, 0.0), (On, 1.0)], false),
            ContourError::DoesNotBeginOnCurve
        );
        assert_eq!(
            reject(&[(C, 0.0), (C, 1.0)], true),
            ContourError::OffCurveNotQuadratic
        );
    }

    #[test]
    fn closed_contour_ends_at_its_first_point() {
        assert_eq!(
            segments(&[On, Q, On, C, C], true),
            Ok(vec![
                PointSegment::Quadratic {
                    start: 0,
                    control: 1,
                    end: 2
                },
                PointSegment::Cubic {
                    start: 2,
                    first: 3,
                    second: 4,
                    end: 0
                },
            ])
        );
    }

    #[test]
    fn open_contour_stops_at_its_last_point() {
        assert_eq!(
            segments(&[On, On, Q, On], false),
            Ok(vec![
                PointSegment::Line { start: 0, end: 1 },
                PointSegment::Quadratic {
                    start: 1,
                    control: 2,
                    end: 3
                },
            ])
        );
        assert_eq!(segments(&[On], false), Ok(Vec::new()));
        assert_eq!(
            segments(&[On], true),
            Ok(vec![PointSegment::Line { start: 0, end: 0 }])
        );
    }

    #[test]
    fn rejects_a_contour_that_begins_off_curve_or_is_empty() {
        assert_eq!(
            segments(&[Q, On], true),
            Err(ContourError::DoesNotBeginOnCurve)
        );
        assert_eq!(segments(&[], false), Err(ContourError::DoesNotBeginOnCurve));
    }

    #[test]
    fn rejects_controls_without_their_endpoint() {
        assert_eq!(
            segments(&[On, Q], false),
            Err(ContourError::QuadraticWithoutEndpoint)
        );
        assert_eq!(
            segments(&[On, Q, Q], true),
            Err(ContourError::QuadraticWithoutEndpoint)
        );
        assert_eq!(
            segments(&[On, C, C], false),
            Err(ContourError::CubicWithoutEndpoint)
        );
        assert_eq!(
            segments(&[On, C, On], true),
            Err(ContourError::CubicWithoutEndpoint)
        );
    }

    #[test]
    fn stops_after_the_first_error() {
        let points: Vec<_> = [On, Q, Q, On].iter().map(|kind| (*kind, ())).collect();
        let mut walk = ContourSegments::new(&points, true).expect("begins on-curve");

        assert_eq!(
            walk.next(),
            Some(Err(ContourError::QuadraticWithoutEndpoint))
        );
        assert_eq!(walk.next(), None);
    }

    mod properties {
        use super::*;
        use GlyphPointKind::{CubicControl as C, OnCurve as On, QuadraticControl as Q};
        use proptest::prelude::*;

        /// One segment's kind: a line, a quadratic with this many controls (more
        /// than one implies on-curve points between them), or a cubic.
        #[derive(Clone, Copy, Debug)]
        enum Shape {
            Line,
            Quadratic(usize),
            Cubic,
        }

        fn shape() -> impl Strategy<Value = Shape> {
            prop_oneof![
                Just(Shape::Line),
                (1..4usize).prop_map(Shape::Quadratic),
                Just(Shape::Cubic),
            ]
        }

        impl Shape {
            /// The kinds of the points the segment adds after its start.
            fn kinds(self) -> Vec<GlyphPointKind> {
                let mut kinds = match self {
                    Self::Line => Vec::new(),
                    Self::Quadratic(controls) => vec![Q; controls],
                    Self::Cubic => vec![C, C],
                };
                kinds.push(On);
                kinds
            }
        }

        /// A contour's point kinds as a font file stores them: starting on-curve,
        /// then each segment's controls and end. A closed contour's last segment
        /// ends at its first point, so that point is not repeated.
        fn kinds(shapes: &[Shape], closed: bool) -> Vec<GlyphPointKind> {
            let mut kinds = vec![On];
            kinds.extend(shapes.iter().flat_map(|shape| shape.kinds()));
            if closed {
                kinds.pop();
            }
            kinds
        }

        fn tagged(kinds: &[GlyphPointKind]) -> Vec<Kinded> {
            kinds
                .iter()
                .enumerate()
                .map(|(index, kind)| Kinded(*kind, index as f64))
                .collect()
        }

        proptest! {
            /// A contour with only single quadratic controls needs no implied
            /// points, so it walks as stored: every point after the first is one
            /// segment's control or end exactly once, and a closed contour ends
            /// back at its first point.
            #[test]
            fn a_valid_contour_walks_covering_each_point_once(
                shapes in prop::collection::vec(
                    prop_oneof![Just(Shape::Line), Just(Shape::Quadratic(1)), Just(Shape::Cubic)],
                    1..8,
                ),
                closed in any::<bool>(),
            ) {
                let kinds = kinds(&shapes, closed);
                prop_assume!(!kinds.is_empty());
                let points: Vec<_> = kinds.iter().map(|kind| (*kind, ())).collect();

                let segments: Vec<PointSegment> = ContourSegments::new(&points, closed)
                    .expect("begins on-curve")
                    .collect::<Result<_, _>>()
                    .map_err(|error| TestCaseError::fail(format!("{kinds:?}: {error}")))?;

                prop_assert_eq!(segments.len(), shapes.len());
                let mut covered = vec![0usize; points.len()];
                let mut previous_end = 0;
                for segment in &segments {
                    let (start, rest) = match *segment {
                        PointSegment::Line { start, end } => (start, vec![end]),
                        PointSegment::Quadratic { start, control, end } => (start, vec![control, end]),
                        PointSegment::Cubic { start, first, second, end } => (start, vec![first, second, end]),
                    };
                    prop_assert_eq!(start, previous_end, "{:?} does not start where the last ended", segment);
                    for index in rest {
                        covered[index] += 1;
                    }
                    previous_end = segment.end();
                }
                if closed {
                    prop_assert_eq!(previous_end, 0);
                } else {
                    covered[0] += 1;
                }
                prop_assert!(covered.iter().all(|count| *count == 1), "{kinds:?} covers {covered:?}");
            }

            /// Any contour a font file can hold, rotated to start anywhere,
            /// normalizes to one that walks without error, with one implied point
            /// between each pair of adjacent quadratic controls.
            #[test]
            fn a_normalized_contour_walks_without_error(
                shapes in prop::collection::vec(shape(), 1..8),
                closed in any::<bool>(),
                rotation in 0..32usize,
            ) {
                let mut kinds = kinds(&shapes, closed);
                prop_assume!(!kinds.is_empty());
                if closed {
                    let by = rotation % kinds.len();
                    kinds.rotate_left(by);
                }
                let points = tagged(&kinds);

                let normalized = normalize_points(&points, closed)
                    .map_err(|error| TestCaseError::fail(format!("{kinds:?}: {error}")))?;
                let implied: usize = shapes
                    .iter()
                    .map(|shape| match shape {
                        Shape::Quadratic(controls) => controls - 1,
                        Shape::Line | Shape::Cubic => 0,
                    })
                    .sum();
                prop_assert_eq!(normalized.len(), points.len() + implied, "{:?} normalizes to {:?}", kinds, normalized);

                let walked: Result<Vec<_>, _> = ContourSegments::new(&normalized, closed)
                    .map_err(|error| TestCaseError::fail(format!("{kinds:?}: {error}")))?
                    .collect();
                prop_assert!(walked.is_ok(), "{:?} normalizes to {:?}, which walks to {:?}", kinds, normalized, walked);
            }

            /// A closed contour of quadratic controls alone, as TrueType allows,
            /// normalizes to one walk of quadratic segments through every control.
            #[test]
            fn a_closed_contour_of_controls_alone_walks(controls in 1..8usize) {
                let points = tagged(&vec![Q; controls]);
                let normalized = normalize_points(&points, true).expect("normalizes");
                let segments: Vec<_> = ContourSegments::new(&normalized, true)
                    .expect("begins on-curve")
                    .collect::<Result<_, _>>()
                    .map_err(|error| TestCaseError::fail(format!("{normalized:?}: {error}")))?;
                prop_assert_eq!(segments.len(), controls);
            }
        }
    }
}
