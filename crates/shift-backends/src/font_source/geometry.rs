use std::collections::HashMap;

use kurbo::{CubicBez, Line, Point, QuadBez, Shape};

use crate::font_source::{
    AffineTransform, AnchorRange, ComponentInstance, ComponentRange, ContourRange, DisplayGlyph,
    FontReadError, GeometryIndex, GlyphAnchor, GlyphBounds, GlyphContour, GlyphGeometry,
    GlyphGuide, GlyphIndex, GlyphMetrics, GlyphPoint, GlyphPointKind, GuideRange, PointProvenance,
    PointRange, VariationLocation,
};

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
    pub(crate) guides: Vec<GlyphGuide>,
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

pub(crate) fn build_display_glyph(
    root: GlyphIndex,
    location: VariationLocation,
    geometries: Vec<SourceGeometry>,
    metrics: GlyphMetrics,
) -> Result<DisplayGlyph, FontReadError> {
    let geometry_indices = geometries
        .iter()
        .enumerate()
        .map(|(index, geometry)| {
            let index = u32::try_from(index).map_err(|_| FontReadError::InvalidDisplayGlyph {
                details: "geometry count exceeds u32".into(),
            })?;
            Ok((geometry.glyph, GeometryIndex::new(index)))
        })
        .collect::<Result<HashMap<_, _>, FontReadError>>()?;
    if geometry_indices.len() != geometries.len() {
        return Err(FontReadError::InvalidDisplayGlyph {
            details: "resolved geometries contain duplicate glyph indexes".into(),
        });
    }
    let root_geometry =
        geometry_indices
            .get(&root)
            .copied()
            .ok_or_else(|| FontReadError::InvalidDisplayGlyph {
                details: "resolved geometries omit the requested root".into(),
            })?;

    let bounds = glyph_bounds(root_geometry, &geometries, &geometry_indices)?;
    let mut glyph_geometries = Vec::with_capacity(geometries.len());
    let mut contours = Vec::new();
    let mut components = Vec::new();
    let mut points = Vec::new();
    let mut anchors = Vec::new();
    let mut guides = Vec::new();

    for geometry in geometries {
        let contour_start = contours.len();
        for contour in geometry.contours {
            let point_start = points.len();
            let point_count = contour.points.len();
            points.extend(contour.points);
            contours.push(GlyphContour {
                points: PointRange::new(point_start, point_count)?,
                closed: contour.closed,
            });
        }

        let component_start = components.len();
        for component in geometry.components {
            let geometry = geometry_indices.get(&component.glyph).copied().ok_or(
                FontReadError::MissingComponent {
                    glyph: geometry.glyph,
                    base: component.glyph,
                },
            )?;
            components.push(ComponentInstance {
                geometry,
                transform: component.transform,
            });
        }

        let anchor_start = anchors.len();
        let anchor_count = geometry.anchors.len();
        anchors.extend(geometry.anchors);
        let guide_start = guides.len();
        let guide_count = geometry.guides.len();
        guides.extend(geometry.guides);
        glyph_geometries.push(GlyphGeometry {
            glyph: geometry.glyph,
            contours: ContourRange::new(contour_start, contours.len() - contour_start)?,
            components: ComponentRange::new(component_start, components.len() - component_start)?,
            anchors: AnchorRange::new(anchor_start, anchor_count)?,
            guides: GuideRange::new(guide_start, guide_count)?,
        });
    }

    let glyph = DisplayGlyph {
        glyph: root,
        location,
        root_geometry,
        geometries: glyph_geometries.into_boxed_slice(),
        contours: contours.into_boxed_slice(),
        components: components.into_boxed_slice(),
        points: points.into_boxed_slice(),
        anchors: anchors.into_boxed_slice(),
        guides: guides.into_boxed_slice(),
        metrics,
        bounds,
    };
    glyph.validate()?;
    Ok(glyph)
}

fn glyph_bounds(
    root: GeometryIndex,
    geometries: &[SourceGeometry],
    indices: &HashMap<GlyphIndex, GeometryIndex>,
) -> Result<Option<GlyphBounds>, FontReadError> {
    let mut bounds = None;
    let mut visiting = Vec::new();
    append_geometry_bounds(
        root,
        AffineTransform::identity(),
        geometries,
        indices,
        &mut visiting,
        &mut bounds,
    )?;
    Ok(bounds)
}

fn append_geometry_bounds(
    geometry_index: GeometryIndex,
    transform: AffineTransform,
    geometries: &[SourceGeometry],
    indices: &HashMap<GlyphIndex, GeometryIndex>,
    visiting: &mut Vec<GeometryIndex>,
    bounds: &mut Option<GlyphBounds>,
) -> Result<(), FontReadError> {
    if visiting.contains(&geometry_index) {
        return Err(FontReadError::ComponentCycle {
            glyph: geometries[geometry_index.to_usize()].glyph,
        });
    }
    visiting.push(geometry_index);
    let geometry = &geometries[geometry_index.to_usize()];
    for contour in &geometry.contours {
        append_contour_bounds(contour, transform, bounds)?;
    }
    for component in &geometry.components {
        let child =
            indices
                .get(&component.glyph)
                .copied()
                .ok_or(FontReadError::MissingComponent {
                    glyph: geometry.glyph,
                    base: component.glyph,
                })?;
        append_geometry_bounds(
            child,
            transform.compose(component.transform),
            geometries,
            indices,
            visiting,
            bounds,
        )?;
    }
    visiting.pop();
    Ok(())
}

fn append_contour_bounds(
    contour: &SourceContour,
    transform: AffineTransform,
    bounds: &mut Option<GlyphBounds>,
) -> Result<(), FontReadError> {
    let point_count = contour.points.len();
    if point_count < 2 {
        return Ok(());
    }
    if contour.points[0].kind != GlyphPointKind::OnCurve {
        return Err(FontReadError::InvalidDisplayGlyph {
            details: "normalized contour does not begin on-curve".into(),
        });
    }

    let limit = if contour.closed {
        point_count + 1
    } else {
        point_count
    };
    let mut start = transformed_point(&contour.points[0], transform);
    let mut cursor = 1;
    while cursor < limit {
        let point = &contour.points[cursor % point_count];
        match point.kind {
            GlyphPointKind::OnCurve => {
                let end = transformed_point(point, transform);
                include_rect(bounds, Line::new(start, end).bounding_box());
                start = end;
                cursor += 1;
            }
            GlyphPointKind::QuadraticControl => {
                if cursor + 1 >= limit {
                    return Err(invalid_segment("quadratic control has no endpoint"));
                }
                let end_point = &contour.points[(cursor + 1) % point_count];
                if end_point.kind != GlyphPointKind::OnCurve {
                    return Err(invalid_segment(
                        "quadratic control is not followed by an endpoint",
                    ));
                }
                let control = transformed_point(point, transform);
                let end = transformed_point(end_point, transform);
                include_rect(bounds, QuadBez::new(start, control, end).bounding_box());
                start = end;
                cursor += 2;
            }
            GlyphPointKind::CubicControl => {
                if cursor + 2 >= limit {
                    return Err(invalid_segment("cubic controls have no endpoint"));
                }
                let second = &contour.points[(cursor + 1) % point_count];
                let end_point = &contour.points[(cursor + 2) % point_count];
                if second.kind != GlyphPointKind::CubicControl
                    || end_point.kind != GlyphPointKind::OnCurve
                {
                    return Err(invalid_segment("invalid cubic point sequence"));
                }
                let control_0 = transformed_point(point, transform);
                let control_1 = transformed_point(second, transform);
                let end = transformed_point(end_point, transform);
                include_rect(
                    bounds,
                    CubicBez::new(start, control_0, control_1, end).bounding_box(),
                );
                start = end;
                cursor += 3;
            }
        }
    }
    Ok(())
}

fn transformed_point(point: &GlyphPoint, transform: AffineTransform) -> Point {
    let (x, y) = transform.transform_point(point.x, point.y);
    Point::new(x, y)
}

fn include_rect(bounds: &mut Option<GlyphBounds>, rect: kurbo::Rect) {
    match bounds {
        Some(bounds) => {
            bounds.min_x = bounds.min_x.min(rect.x0);
            bounds.min_y = bounds.min_y.min(rect.y0);
            bounds.max_x = bounds.max_x.max(rect.x1);
            bounds.max_y = bounds.max_y.max(rect.y1);
        }
        None => {
            *bounds = Some(GlyphBounds {
                min_x: rect.x0,
                min_y: rect.y0,
                max_x: rect.x1,
                max_y: rect.y1,
            });
        }
    }
}

fn invalid_segment(details: &str) -> FontReadError {
    FontReadError::InvalidDisplayGlyph {
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

    fn native(x: f64, y: f64, kind: GlyphPointKind) -> GlyphPoint {
        GlyphPoint {
            x,
            y,
            kind,
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

    #[test]
    fn component_bounds_apply_the_instance_transform_to_tight_curve_bounds() {
        let root = GlyphIndex::new(0);
        let child = GlyphIndex::new(1);
        let glyph = build_display_glyph(
            root,
            VariationLocation::default(),
            vec![
                SourceGeometry {
                    glyph: root,
                    contours: Vec::new(),
                    components: vec![SourceComponent {
                        glyph: child,
                        transform: AffineTransform {
                            xx: 2.0,
                            yy: 3.0,
                            dx: 10.0,
                            dy: 20.0,
                            ..AffineTransform::identity()
                        },
                    }],
                    anchors: Vec::new(),
                    guides: Vec::new(),
                },
                SourceGeometry {
                    glyph: child,
                    contours: vec![SourceContour {
                        points: vec![
                            native(0.0, 0.0, GlyphPointKind::OnCurve),
                            native(50.0, 100.0, GlyphPointKind::QuadraticControl),
                            native(100.0, 0.0, GlyphPointKind::OnCurve),
                        ],
                        closed: false,
                    }],
                    components: Vec::new(),
                    anchors: Vec::new(),
                    guides: Vec::new(),
                },
            ],
            GlyphMetrics {
                x_advance: 100.0,
                y_advance: None,
            },
        )
        .unwrap();

        assert_eq!(
            glyph.bounds,
            Some(GlyphBounds {
                min_x: 10.0,
                min_y: 20.0,
                max_x: 210.0,
                max_y: 170.0,
            })
        );

        let mut invalid = glyph;
        invalid.geometries[0].contours.start = 1;
        assert!(matches!(
            invalid.validate(),
            Err(FontReadError::InvalidDisplayGlyph { .. })
        ));
    }
}
