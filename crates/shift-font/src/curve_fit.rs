//! One curve that approximates a connected run of segments, as deleting
//! points reconnects what survives.

use kurbo::{CubicBez, Line, ParamCurve, ParamCurveDeriv, PathSeg, Point, QuadBez, Vec2};

/// Samples taken along each source segment, besides its start.
const SAMPLES_PER_SEGMENT: u32 = 32;
/// Rounds of fitting and reprojecting the samples onto the fit.
const MAX_ITERATIONS: usize = 80;
/// Shortest vector [`normalize`] gives a direction to.
const EPSILON: f64 = 1e-10;

/// Why a run of segments cannot be fitted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum CurveFitError {
    #[error("there are no segments to fit")]
    Empty,
    #[error("the segments to fit are not connected end to start")]
    Disconnected,
    #[error("the segments to fit have a coordinate that is not finite")]
    NotFinite,
}

/// One cubic approximating `segments`, with their exact endpoints and with
/// tangents along the run's own at both ends.
///
/// Fits from the original geometry without subdividing the result: samples
/// are fitted by weighted least squares, then reprojected onto the fit by a
/// safeguarded Newton step that keeps them in order, for up to
/// 80 rounds; the best fit seen wins. Coordinates are
/// normalized for the solve. Handle lengths stay within twice the run's
/// sampled length. An endpoint with a zero-length handle takes its direction
/// from the nearest control-polygon point that differs, and a run with no
/// length gives a collapsed cubic. A single segment comes back as itself,
/// raised to a cubic.
///
/// # Errors
///
/// Returns [`CurveFitError`] when `segments` is empty, not connected, or not
/// finite.
pub fn fit_cubic(segments: &[PathSeg]) -> Result<CubicBez, CurveFitError> {
    let polygon = control_polygon(segments)?;
    let (first, last) = ends(segments)?;
    if let [single] = segments {
        return Ok(match *single {
            PathSeg::Cubic(cubic) => cubic,
            PathSeg::Quad(quad) => quad.raise(),
            PathSeg::Line(Line { p0, p1 }) => {
                CubicBez::new(p0, p0.lerp(p1, 1.0 / 3.0), p0.lerp(p1, 2.0 / 3.0), p1)
            }
        });
    }

    let Some(run) = Run::sample(segments, first)? else {
        return Ok(CubicBez::new(first, first, last, last));
    };
    let start = run.points[0];
    let end = run.points[run.points.len() - 1];
    let first_direction = polygon
        .iter()
        .map(|point| (*point - first) / run.length)
        .find(|direction| length(*direction) > 0.0);
    let last_direction = polygon
        .iter()
        .rev()
        .map(|point| (*point - last) / run.length)
        .find(|direction| length(*direction) > 0.0);
    // These directions were already checked for zero; normalizing with an
    // epsilon would erase the direction of a short but authored handle.
    let start_tangent = first_direction.map_or_else(
        || normalize(end - start),
        |direction| direction / length(direction),
    );
    let end_tangent = last_direction.map_or_else(
        || normalize(start - end),
        |direction| direction / length(direction),
    );

    let mut parameters = run.parameters.clone();
    let cubic = |alpha: f64, beta: f64| {
        CubicBez::new(
            start,
            start + start_tangent * alpha,
            end + end_tangent * beta,
            end,
        )
    };
    let mut best = cubic(1.0 / 3.0, 1.0 / 3.0);
    let mut best_error = f64::INFINITY;

    for _ in 0..MAX_ITERATIONS {
        let (mut aa, mut ab, mut bb, mut ar, mut br) = (0.0, 0.0, 0.0, 0.0, 0.0);
        for Sample { t, point, weight } in run.interior(&parameters) {
            // Products, not `powi`, whose precision differs between platforms.
            let u = 1.0 - t;
            let a = start_tangent * (3.0 * u * u * t);
            let b = end_tangent * (3.0 * u * t * t);
            let base = start.lerp(end, t * t * t + 3.0 * u * t * t);
            let residual = point - base;
            aa += weight * a.dot(a);
            ab += weight * a.dot(b);
            bb += weight * b.dot(b);
            ar += weight * a.dot(residual);
            br += weight * b.dot(residual);
        }

        // The box-constrained two-variable least-squares problem has its
        // minimum at the unconstrained solution or on one of four edges.
        let mut candidates = vec![(1.0 / 3.0, 1.0 / 3.0)];
        let determinant = aa * bb - ab * ab;
        if determinant > 1e-12 * aa * bb {
            candidates.push((
                (ar * bb - br * ab) / determinant,
                (br * aa - ar * ab) / determinant,
            ));
        }
        for bound in [1e-8, 2.0] {
            let along_b = if bb > 0.0 {
                (br - ab * bound) / bb
            } else {
                1.0 / 3.0
            };
            let along_a = if aa > 0.0 {
                (ar - ab * bound) / aa
            } else {
                1.0 / 3.0
            };
            candidates.push((bound, along_b.clamp(1e-8, 2.0)));
            candidates.push((along_a.clamp(1e-8, 2.0), bound));
        }

        let mut curve = best;
        let mut error = f64::INFINITY;
        for (alpha, beta) in candidates {
            let usable = |value: f64| value.is_finite() && (1e-8..=2.0).contains(&value);
            if !usable(alpha) || !usable(beta) {
                continue;
            }
            let candidate = cubic(alpha, beta);
            let candidate_error = run.error(&candidate, &parameters);
            if candidate_error < error {
                error = candidate_error;
                curve = candidate;
            }
        }

        if error < best_error {
            best_error = error;
            best = curve;
        }
        if error < 1e-18 {
            break;
        }
        if run.reproject(&curve, &mut parameters) < 1e-12 {
            break;
        }
    }

    Ok(CubicBez::new(
        first,
        first + best.p1.to_vec2() * run.length,
        first + best.p2.to_vec2() * run.length,
        last,
    ))
}

/// One quadratic approximating `segments`, with their exact endpoints: one
/// control fitted by length-weighted least squares at sampled arc-length
/// parameters. Endpoint tangents are not constrained and no error bound is
/// guaranteed. A run with no length gives a collapsed quadratic, and a single
/// quadratic comes back as itself.
///
/// # Errors
///
/// Returns [`CurveFitError`] when `segments` is empty, not connected, or not
/// finite, or when the fitted control is not finite.
pub fn fit_quadratic(segments: &[PathSeg]) -> Result<QuadBez, CurveFitError> {
    control_polygon(segments)?;
    let (first, last) = ends(segments)?;
    if let [PathSeg::Quad(quad)] = segments {
        return Ok(*quad);
    }

    let Some(run) = Run::sample(segments, first)? else {
        return Ok(QuadBez::new(first, first, last));
    };
    let end = run.points[run.points.len() - 1].to_vec2();
    let (mut aa, mut ar) = (0.0, Vec2::ZERO);
    for Sample { t, point, weight } in run.interior(&run.parameters) {
        let a = 2.0 * (1.0 - t) * t;
        let residual = point.to_vec2() - end * (t * t);
        aa += weight * a * a;
        ar += residual * (weight * a);
    }

    let control = if aa > 0.0 { ar / aa } else { end * 0.5 };
    let fitted = first + control * run.length;
    if !fitted.is_finite() {
        return Err(CurveFitError::NotFinite);
    }
    Ok(QuadBez::new(first, fitted, last))
}

/// One sample of a run: its parameter, its normalized position and its weight.
#[derive(Clone, Copy)]
struct Sample {
    t: f64,
    point: Point,
    weight: f64,
}

/// A run of segments sampled and normalized: translated to start at the
/// origin and scaled to unit length.
struct Run {
    points: Vec<Point>,
    /// Each sample's arc-length parameter; the last is exactly 1.
    parameters: Vec<f64>,
    /// Each sample's share of the run's length.
    weights: Vec<f64>,
    length: f64,
}

impl Run {
    /// The samples of `segments` from `first`; `None` when the run has no length.
    fn sample(segments: &[PathSeg], first: Point) -> Result<Option<Self>, CurveFitError> {
        let mut samples = vec![first];
        for segment in segments {
            samples.extend(
                (1..=SAMPLES_PER_SEGMENT)
                    .map(|index| segment.eval(f64::from(index) / f64::from(SAMPLES_PER_SEGMENT))),
            );
        }
        let distances: Vec<f64> = std::iter::once(0.0)
            .chain(samples.windows(2).map(|pair| length(pair[1] - pair[0])))
            .collect();
        let total = distances.iter().fold(0.0, |sum, distance| sum + distance);
        if total == 0.0 {
            return Ok(None);
        }
        if !total.is_finite() {
            return Err(CurveFitError::NotFinite);
        }

        let points = samples
            .iter()
            .map(|sample| ((*sample - first) / total).to_point())
            .collect();
        let weights = (0..distances.len())
            .map(|index| {
                (distances[index] + distances.get(index + 1).copied().unwrap_or(0.0))
                    / (2.0 * total)
            })
            .collect();
        let mut travelled = 0.0;
        let mut parameters: Vec<f64> = distances
            .iter()
            .map(|step| {
                travelled += step;
                travelled / total
            })
            .collect();
        if let Some(last) = parameters.last_mut() {
            *last = 1.0;
        }
        Ok(Some(Self {
            points,
            parameters,
            weights,
            length: total,
        }))
    }

    /// Each sample but the two ends, with its parameter from `parameters` and
    /// its weight.
    fn interior<'a>(&'a self, parameters: &'a [f64]) -> impl Iterator<Item = Sample> + 'a {
        let count = self.points.len().saturating_sub(2);
        parameters
            .iter()
            .zip(&self.points)
            .zip(&self.weights)
            .skip(1)
            .take(count)
            .map(|((&t, &point), &weight)| Sample { t, point, weight })
    }

    /// The weighted squared distance from each sample to `curve` at its parameter.
    fn error(&self, curve: &CubicBez, parameters: &[f64]) -> f64 {
        self.points
            .iter()
            .zip(parameters)
            .zip(&self.weights)
            .fold(0.0, |sum, ((point, t), weight)| {
                sum + weight * (*point - curve.eval(*t)).hypot2()
            })
    }

    /// Moves each interior parameter toward the point of `curve` nearest its
    /// sample, by a Newton step kept inside its neighbours' midpoints and
    /// accepted only when it brings the point closer. Returns the largest move.
    fn reproject(&self, curve: &CubicBez, parameters: &mut [f64]) -> f64 {
        let derivative = curve.deriv();
        let second = derivative.deriv();
        let current = parameters.to_vec();
        let mut movement: f64 = 0.0;
        for index in 1..self.points.len() - 1 {
            let t = current[index];
            let target = self.points[index];
            let residual = curve.eval(t) - target;
            let slope = derivative.eval(t).to_vec2();
            let denominator = slope.dot(slope) + residual.dot(second.eval(t).to_vec2());
            if denominator.abs() < 1e-14 {
                continue;
            }

            let lower = (current[index - 1] + t) / 2.0;
            let upper = (t + current[index + 1]) / 2.0;
            let mut updated = (t - residual.dot(slope) / denominator).clamp(lower, upper);
            let closer = |at: f64| (curve.eval(at) - target).hypot2() <= residual.hypot2();
            for _ in 0..8 {
                if closer(updated) {
                    break;
                }
                updated = f64::midpoint(updated, t);
            }
            if !closer(updated) {
                continue;
            }

            parameters[index] = updated;
            movement = movement.max((updated - t).abs());
        }
        movement
    }
}

/// The control points of `segments` in order, checked connected and finite.
fn control_polygon(segments: &[PathSeg]) -> Result<Vec<Point>, CurveFitError> {
    let mut polygon = Vec::new();
    for (index, segment) in segments.iter().enumerate() {
        if index > 0 && !touches(segments[index - 1].end(), segment.start()) {
            return Err(CurveFitError::Disconnected);
        }
        match *segment {
            PathSeg::Line(Line { p0, p1 }) => polygon.extend([p0, p1]),
            PathSeg::Quad(QuadBez { p0, p1, p2 }) => polygon.extend([p0, p1, p2]),
            PathSeg::Cubic(CubicBez { p0, p1, p2, p3 }) => polygon.extend([p0, p1, p2, p3]),
        }
    }
    if polygon.iter().any(|point| !point.is_finite()) {
        return Err(CurveFitError::NotFinite);
    }
    Ok(polygon)
}

fn ends(segments: &[PathSeg]) -> Result<(Point, Point), CurveFitError> {
    match (segments.first(), segments.last()) {
        (Some(first), Some(last)) => Ok((first.start(), last.end())),
        _ => Err(CurveFitError::Empty),
    }
}

/// Whether one segment's end meets the next one's start, within [`EPSILON`]
/// on each axis as the editor compares points.
fn touches(end: Point, start: Point) -> bool {
    (end.x - start.x).abs() < EPSILON && (end.y - start.y).abs() < EPSILON
}

/// A vector's length, with the same bits natively and in WebAssembly.
fn length(vector: Vec2) -> f64 {
    libm::hypot(vector.x, vector.y)
}

/// A unit vector along `vector`, or zero for one too short to point.
fn normalize(vector: Vec2) -> Vec2 {
    let len = length(vector);
    if len < EPSILON {
        return Vec2::ZERO;
    }
    vector / len
}

#[cfg(test)]
mod tests;
