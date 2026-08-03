use std::collections::{BTreeMap, BTreeSet};

use shift_slug::Curve;

use crate::font_source::atlas::SourceAtlasError;
use crate::font_source::GlyphPointKind;

use super::{
    invalid_geometry, VariableContour, VariableCurves, VariableGeometry, VariablePoint,
    VariablePosition,
};

pub(super) fn normalize_contour(
    points: Vec<VariablePoint>,
) -> Result<VariableContour, SourceAtlasError> {
    if points.is_empty() {
        return Err(invalid_geometry("binary atlas contour has no points"));
    }
    let first_on = points
        .iter()
        .position(|point| point.kind == GlyphPointKind::OnCurve);
    let (start, indexes, all_off_curve) = match first_on {
        Some(start) => (
            points[start].clone(),
            (1..points.len())
                .map(|offset| (start + offset) % points.len())
                .collect::<Vec<_>>(),
            false,
        ),
        None => (
            VariablePoint::midpoint(points.last().expect("contour is non-empty"), &points[0]),
            (0..points.len()).collect(),
            true,
        ),
    };
    let mut normalized = Vec::with_capacity(points.len() * 2);
    normalized.push(start);
    for (position, index) in indexes.iter().copied().enumerate() {
        let point = &points[index];
        normalized.push(point.clone());
        let next = (index + 1) % points.len();
        let closes_all_off_curve = all_off_curve && position + 1 == indexes.len();
        if point.kind == GlyphPointKind::QuadraticControl
            && !closes_all_off_curve
            && points[next].kind == GlyphPointKind::QuadraticControl
        {
            normalized.push(VariablePoint::midpoint(point, &points[next]));
        }
    }
    Ok(VariableContour { points: normalized })
}

pub(super) fn curves_from_geometry(
    geometry: &VariableGeometry,
) -> Result<VariableCurves, SourceAtlasError> {
    let weights = geometry
        .contours
        .iter()
        .flat_map(|contour| &contour.points)
        .flat_map(|point| point.position.deltas.keys().copied())
        .collect::<BTreeSet<_>>();
    let mut base = Vec::new();
    let mut line_flags = Vec::new();
    let mut sources = weights
        .iter()
        .map(|weight| (*weight, Vec::new()))
        .collect::<BTreeMap<_, _>>();

    for contour in &geometry.contours {
        let points = &contour.points;
        if points.is_empty() || points[0].kind != GlyphPointKind::OnCurve {
            return Err(invalid_geometry(
                "normalized binary atlas contour does not begin on-curve",
            ));
        }
        let mut current = &points[0].position;
        let mut cursor = 1;
        while cursor <= points.len() {
            let point = &points[cursor % points.len()];
            match point.kind {
                GlyphPointKind::OnCurve => {
                    push_line(
                        &mut base,
                        &mut line_flags,
                        &mut sources,
                        current,
                        &point.position,
                    );
                    current = &point.position;
                    cursor += 1;
                }
                GlyphPointKind::QuadraticControl => {
                    if cursor + 1 > points.len() {
                        return Err(invalid_geometry(
                            "quadratic control is missing its endpoint",
                        ));
                    }
                    let endpoint = &points[(cursor + 1) % points.len()];
                    if endpoint.kind != GlyphPointKind::OnCurve {
                        return Err(invalid_geometry(
                            "quadratic control is not followed by an endpoint",
                        ));
                    }
                    push_quadratic(
                        &mut base,
                        &mut line_flags,
                        &mut sources,
                        current,
                        &point.position,
                        &endpoint.position,
                    );
                    current = &endpoint.position;
                    cursor += 2;
                }
                GlyphPointKind::CubicControl => {
                    return Err(SourceAtlasError::UnsupportedBinary {
                        details:
                            "cubic glyf contours are not supported by the first direct atlas slice",
                    });
                }
            }
        }
    }

    Ok(VariableCurves {
        base,
        line_flags,
        sources,
    })
}

fn push_line(
    base: &mut Vec<Curve>,
    line_flags: &mut Vec<bool>,
    sources: &mut BTreeMap<u32, Vec<Curve>>,
    start: &VariablePosition,
    end: &VariablePosition,
) {
    base.push(Curve::from_line(start.at(None), end.at(None)));
    line_flags.push(true);
    for (weight, curves) in sources {
        curves.push(Curve::from_line(
            start.at(Some(*weight)),
            end.at(Some(*weight)),
        ));
    }
}

fn push_quadratic(
    base: &mut Vec<Curve>,
    line_flags: &mut Vec<bool>,
    sources: &mut BTreeMap<u32, Vec<Curve>>,
    start: &VariablePosition,
    control: &VariablePosition,
    end: &VariablePosition,
) {
    base.push(Curve {
        p0: start.at(None),
        p1: control.at(None),
        p2: end.at(None),
    });
    line_flags.push(false);
    for (weight, curves) in sources {
        curves.push(Curve {
            p0: start.at(Some(*weight)),
            p1: control.at(Some(*weight)),
            p2: end.at(Some(*weight)),
        });
    }
}
