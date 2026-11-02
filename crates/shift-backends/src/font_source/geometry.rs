use shift_font::Transform;

use crate::font_source::segments::{ContourSegments, ImpliedPoint, normalize_points};
use crate::font_source::{
    FontReadError, GlyphAnchor, GlyphIndex, GlyphPoint, GlyphPointKind, PointProvenance,
};

/// Maximum tangent-angle difference used to infer smooth binary outline points.
pub(crate) const SMOOTH_ANGLE_TOLERANCE: f64 = 0.05;

#[derive(Clone, Debug)]
pub(crate) struct ContourPoint {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) kind: GlyphPointKind,
    pub(crate) smooth: bool,
    pub(crate) provenance: PointProvenance,
}

#[derive(Clone, Debug)]
pub(crate) struct SourceContour {
    pub(crate) points: Vec<GlyphPoint>,
    pub(crate) closed: bool,
}

#[derive(Clone, Debug)]
pub(crate) struct SourceComponent {
    pub(crate) glyph: GlyphIndex,
    pub(crate) transform: Transform,
}

#[derive(Clone, Debug)]
pub(crate) struct SourceGeometry {
    pub(crate) glyph: GlyphIndex,
    pub(crate) contours: Vec<SourceContour>,
    pub(crate) components: Vec<SourceComponent>,
    pub(crate) anchors: Vec<GlyphAnchor>,
}

pub(crate) fn inferred_smooth_point_indices<T>(
    points: &[T],
    closed: bool,
    position: impl Fn(&T) -> (f64, f64),
    is_on_curve: impl Fn(&T) -> bool,
) -> Vec<usize> {
    if points.len() < 3 {
        return Vec::new();
    }

    let mut smooth = Vec::new();
    for index in 0..points.len() {
        let point = &points[index];
        if !is_on_curve(point) {
            continue;
        }

        let (previous_index, next_index) = match closed {
            true => (
                (index + points.len() - 1) % points.len(),
                (index + 1) % points.len(),
            ),
            false if index == 0 || index + 1 == points.len() => continue,
            false => (index - 1, index + 1),
        };
        let previous = &points[previous_index];
        let next = &points[next_index];
        if is_on_curve(previous) && is_on_curve(next) {
            continue;
        }

        let (previous_x, previous_y) = position(previous);
        let (point_x, point_y) = position(point);
        let (next_x, next_y) = position(next);
        let incoming_angle = (point_y - previous_y).atan2(point_x - previous_x);
        let outgoing_angle = (next_y - point_y).atan2(next_x - point_x);
        if (incoming_angle - outgoing_angle).abs() < SMOOTH_ANGLE_TOLERANCE {
            smooth.push(index);
        }
    }
    smooth
}

pub(crate) fn control_point_kind<T>(
    points: &[T],
    index: usize,
    closed: bool,
    classify: impl Fn(&T) -> Result<Option<GlyphPointKind>, FontReadError>,
    open_contour_details: &'static str,
) -> Result<GlyphPointKind, FontReadError> {
    let mut next = next_contour_index(index, points.len(), closed);
    for _ in 0..points.len() {
        let Some(next_index) = next else {
            break;
        };
        if let Some(kind) = classify(&points[next_index])? {
            return Ok(kind);
        }
        next = next_contour_index(next_index, points.len(), closed);
    }
    if closed {
        return Ok(GlyphPointKind::QuadraticControl);
    }
    Err(invalid_segment(open_contour_details))
}

fn next_contour_index(index: usize, count: usize, closed: bool) -> Option<usize> {
    if index + 1 < count {
        Some(index + 1)
    } else if closed {
        Some(0)
    } else {
        None
    }
}

pub(crate) fn normalize_contour(
    points: Vec<ContourPoint>,
    closed: bool,
) -> Result<SourceContour, FontReadError> {
    let points: Vec<_> = points
        .into_iter()
        .map(|point| GlyphPoint {
            x: point.x,
            y: point.y,
            kind: point.kind,
            smooth: point.smooth,
            provenance: point.provenance,
        })
        .collect();
    let normalized = normalize_points(&points, closed)?;
    validate_contour_points(&normalized, closed)?;
    Ok(SourceContour {
        points: normalized,
        closed,
    })
}

impl ImpliedPoint for GlyphPoint {
    fn implied_between(first: &Self, second: &Self) -> Self {
        Self {
            x: (first.x + second.x) * 0.5,
            y: (first.y + second.y) * 0.5,
            kind: GlyphPointKind::OnCurve,
            smooth: false,
            provenance: PointProvenance::Implied,
        }
    }
}

fn validate_contour_points(points: &[GlyphPoint], closed: bool) -> Result<(), FontReadError> {
    for segment in ContourSegments::new(points, closed)? {
        segment?;
    }
    Ok(())
}

fn invalid_segment(details: &str) -> FontReadError {
    FontReadError::InvalidProjection {
        details: details.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn quadratic(x: f64, y: f64) -> ContourPoint {
        ContourPoint {
            x,
            y,
            kind: GlyphPointKind::QuadraticControl,
            smooth: false,
            provenance: PointProvenance::Native {
                ttf_point_index: None,
            },
        }
    }

    #[test]
    fn all_off_curve_contour_does_not_duplicate_the_closing_implied_point() {
        let contour = normalize_contour(
            vec![
                quadratic(0.0, 0.0),
                quadratic(100.0, 0.0),
                quadratic(100.0, 100.0),
            ],
            true,
        )
        .unwrap();

        assert_eq!(contour.points.len(), 6);
        assert!(matches!(
            contour.points[0].provenance,
            PointProvenance::Implied
        ));
        assert!(matches!(
            contour.points.last().unwrap().provenance,
            PointProvenance::Native { .. }
        ));
        assert_eq!(contour.points[0].x, 50.0);
        assert_eq!(contour.points[0].y, 50.0);
    }
}
