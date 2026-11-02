//! The segments of a contour whose point kinds are explicit.

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

/// Why a contour's points do not form segments.
#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum ContourSegmentError {
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
    /// Returns [`ContourSegmentError::DoesNotBeginOnCurve`] when `points` is
    /// empty or its first point is a control.
    pub(crate) fn new(points: &'a [T], closed: bool) -> Result<Self, ContourSegmentError> {
        if points
            .first()
            .is_none_or(|point| point.kind() != GlyphPointKind::OnCurve)
        {
            return Err(ContourSegmentError::DoesNotBeginOnCurve);
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

    fn segment(&self) -> Result<(PointSegment, usize), ContourSegmentError> {
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
                    return Err(ContourSegmentError::QuadraticWithoutEndpoint);
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
                    return Err(ContourSegmentError::CubicWithoutEndpoint);
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
    type Item = Result<PointSegment, ContourSegmentError>;

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

    fn segments(
        kinds: &[GlyphPointKind],
        closed: bool,
    ) -> Result<Vec<PointSegment>, ContourSegmentError> {
        let points: Vec<_> = kinds.iter().map(|kind| (*kind, ())).collect();
        ContourSegments::new(&points, closed)?.collect()
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
            Err(ContourSegmentError::DoesNotBeginOnCurve)
        );
        assert_eq!(
            segments(&[], false),
            Err(ContourSegmentError::DoesNotBeginOnCurve)
        );
    }

    #[test]
    fn rejects_controls_without_their_endpoint() {
        assert_eq!(
            segments(&[On, Q], false),
            Err(ContourSegmentError::QuadraticWithoutEndpoint)
        );
        assert_eq!(
            segments(&[On, Q, Q], true),
            Err(ContourSegmentError::QuadraticWithoutEndpoint)
        );
        assert_eq!(
            segments(&[On, C, C], false),
            Err(ContourSegmentError::CubicWithoutEndpoint)
        );
        assert_eq!(
            segments(&[On, C, On], true),
            Err(ContourSegmentError::CubicWithoutEndpoint)
        );
    }

    #[test]
    fn stops_after_the_first_error() {
        let points: Vec<_> = [On, Q, Q, On].iter().map(|kind| (*kind, ())).collect();
        let mut walk = ContourSegments::new(&points, true).expect("begins on-curve");

        assert_eq!(
            walk.next(),
            Some(Err(ContourSegmentError::QuadraticWithoutEndpoint))
        );
        assert_eq!(walk.next(), None);
    }
}
