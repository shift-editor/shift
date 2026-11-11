//! Reading sidebearings and widths off a glyph's resolved outline.

use kurbo::{Line, ParamCurve, PathSeg, Point as KurboPoint};

use super::MetricsKeyError;
use crate::composite::{ResolvedContour, resolved_contours_bbox};
use crate::projection::ResolvedGlyph;
use crate::{CurveSegment, CurveSegmentIter};

/// A metric a measurement reads, after the key's side resolved
/// [`super::MeasureSide::Same`] and [`super::MeasureSide::Opposite`].
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Metric {
    LeftSidebearing,
    RightSidebearing,
    Width,
}

impl ResolvedGlyph {
    /// Reads `metric` from the glyph, named `name` in errors.
    ///
    /// A sidebearing is the distance from the advance edge to the outline's
    /// extreme, or, with `at`, to where the outline crosses that height.
    ///
    /// # Errors
    ///
    /// Returns [`MetricsKeyError::NoOutline`] for a sidebearing of a glyph
    /// with no outline, and [`MetricsKeyError::NothingAtHeight`] when no
    /// contour crosses `at`.
    pub(super) fn measure(
        &self,
        name: &str,
        metric: Metric,
        at: Option<f64>,
    ) -> Result<f64, MetricsKeyError> {
        let advance = self.x_advance();
        if metric == Metric::Width {
            return Ok(advance);
        }

        let (min_x, max_x) = match at {
            None => resolved_contours_bbox(self.contours())
                .map(|(min_x, _, max_x, _)| (min_x, max_x))
                .ok_or_else(|| MetricsKeyError::NoOutline(name.to_owned()))?,
            Some(height) => crossings_at(self.contours(), height).ok_or_else(|| {
                MetricsKeyError::NothingAtHeight {
                    glyph: name.to_owned(),
                    height,
                }
            })?,
        };

        Ok(match metric {
            Metric::LeftSidebearing => min_x,
            Metric::RightSidebearing => advance - max_x,
            Metric::Width => advance,
        })
    }
}

/// The leftmost and rightmost x where `contours` cross the horizontal line
/// at `height`, or `None` when none does.
fn crossings_at(contours: &[ResolvedContour], height: f64) -> Option<(f64, f64)> {
    let (min_x, _, max_x, _) = resolved_contours_bbox(contours)?;
    let line = Line::new((min_x - 1.0, height), (max_x + 1.0, height));
    let crossings = contours
        .iter()
        .flat_map(|contour| CurveSegmentIter::new(&contour.points, contour.closed))
        .flat_map(|segment| {
            let segment = segment.path_segment();
            segment
                .intersect_line(line)
                .into_iter()
                .map(move |crossing| segment.eval(crossing.segment_t).x)
        });
    crossings.fold(None, |range, x| match range {
        None => Some((x, x)),
        Some((low, high)) => Some((low.min(x), high.max(x))),
    })
}

impl CurveSegment<'_> {
    /// The segment as a kurbo curve.
    fn path_segment(&self) -> PathSeg {
        let point = |point: &crate::Point| -> KurboPoint { point.position() };
        match self {
            CurveSegment::Line(p0, p1) => PathSeg::Line(Line::new(point(p0), point(p1))),
            CurveSegment::Quad(p0, c, p1) => {
                PathSeg::Quad(kurbo::QuadBez::new(point(p0), point(c), point(p1)))
            }
            CurveSegment::Cubic(p0, c0, c1, p1) => PathSeg::Cubic(kurbo::CubicBez::new(
                point(p0),
                point(c0),
                point(c1),
                point(p1),
            )),
        }
    }
}
