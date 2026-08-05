use crate::font_source::{
    AffineTransform, FontReadError, GlyphAnchor, GlyphIndex, GlyphPoint, GlyphPointKind,
    PointProvenance,
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
    pub(crate) transform: AffineTransform,
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

pub(crate) fn normalize_contour(
    points: Vec<ContourPoint>,
    closed: bool,
) -> Result<SourceContour, FontReadError> {
    if points.is_empty() {
        return Err(invalid_segment("contour has no points"));
    }
    let points = points
        .into_iter()
        .map(|point| GlyphPoint {
            x: point.x,
            y: point.y,
            kind: point.kind,
            smooth: point.smooth,
            provenance: point.provenance,
        })
        .collect::<Vec<_>>();
    let first_on = points
        .iter()
        .position(|point| point.kind == GlyphPointKind::OnCurve);
    let (start, indexes, all_off_curve) = match (closed, first_on) {
        (false, Some(0)) => (
            points[0].clone(),
            (1..points.len()).collect::<Vec<_>>(),
            false,
        ),
        (false, _) => return Err(invalid_segment("open contour does not begin on-curve")),
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
                .any(|point| point.kind != GlyphPointKind::QuadraticControl)
            {
                return Err(invalid_segment(
                    "closed contour without an endpoint contains non-quadratic controls",
                ));
            }
            (
                implied_point(points.last().expect("contour is non-empty"), &points[0]),
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
        let next = if index + 1 < points.len() {
            Some(index + 1)
        } else if closed {
            Some(0)
        } else {
            None
        };
        let closes_all_off_curve = all_off_curve && position + 1 == indexes.len();
        if point.kind == GlyphPointKind::QuadraticControl
            && !closes_all_off_curve
            && next.is_some_and(|next| points[next].kind == GlyphPointKind::QuadraticControl)
        {
            normalized.push(implied_point(
                point,
                &points[next.expect("next was checked")],
            ));
        }
    }
    validate_contour_points(&normalized, closed)?;
    Ok(SourceContour {
        points: normalized,
        closed,
    })
}

fn implied_point(first: &GlyphPoint, second: &GlyphPoint) -> GlyphPoint {
    GlyphPoint {
        x: (first.x + second.x) * 0.5,
        y: (first.y + second.y) * 0.5,
        kind: GlyphPointKind::OnCurve,
        smooth: false,
        provenance: PointProvenance::Implied,
    }
}

fn validate_contour_points(points: &[GlyphPoint], closed: bool) -> Result<(), FontReadError> {
    if points[0].kind != GlyphPointKind::OnCurve {
        return Err(invalid_segment(
            "normalized contour does not begin on-curve",
        ));
    }
    let limit = if closed {
        points.len() + 1
    } else {
        points.len()
    };
    let mut cursor = 1;
    while cursor < limit {
        match points[cursor % points.len()].kind {
            GlyphPointKind::OnCurve => cursor += 1,
            GlyphPointKind::QuadraticControl => {
                if cursor + 1 >= limit
                    || points[(cursor + 1) % points.len()].kind != GlyphPointKind::OnCurve
                {
                    return Err(invalid_segment(
                        "quadratic control is not followed by an endpoint",
                    ));
                }
                cursor += 2;
            }
            GlyphPointKind::CubicControl => {
                if cursor + 2 >= limit
                    || points[(cursor + 1) % points.len()].kind != GlyphPointKind::CubicControl
                    || points[(cursor + 2) % points.len()].kind != GlyphPointKind::OnCurve
                {
                    return Err(invalid_segment("invalid cubic point sequence"));
                }
                cursor += 3;
            }
        }
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
