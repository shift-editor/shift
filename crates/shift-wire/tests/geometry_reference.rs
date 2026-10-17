//! Rust reference results for the geometry the editor recomputes every frame.
//!
//! The editor keeps TypeScript copies of component matrix compose and
//! decompose, segment parsing and tight bounds, and whole-layer transforms so
//! drags never wait on the bridge. This test writes what `shift-font` computes
//! for the same inputs to `packages/types/__fixtures__/geometry_reference.json`
//! and fails when the committed fixture is stale; TypeScript tests compare their
//! copies against it.
//!
//! Regenerate with
//! `SHIFT_UPDATE_FIXTURES=1 cargo test -p shift-wire --test geometry_reference`.
//!
//! Matrices are written in the TypeScript `MatModel` names: `a = xx`,
//! `b = xy`, `c = yx`, `d = yy`, `e = dx`, `f = dy`.

use serde_json::{json, Value};
use shift_font::composite::{layer_bbox, resolved_contours_bbox, ResolvedContour};
use shift_font::curve::segment_bounds;
use shift_font::{
    Anchor, AnchorId, Component, ComponentId, Contour, ContourId, CurveSegment, CurveSegmentIter,
    DecomposedTransform, GlyphId, GlyphLayer, LayerId, Point, PointId, PointType, SourceId,
    Transform,
};
use shift_wire::GlyphState;

const FIXTURE: &str = "../../packages/types/__fixtures__/geometry_reference.json";

#[test]
fn geometry_reference_fixture_matches_shift_font() {
    let generated = fixture_text(&[
        ("compose", json!(compose_cases())),
        ("contours", json!(contour_cases())),
        ("decompose", json!(decompose_cases())),
        ("layerInput", json!(GlyphState::from_layer(&sample_layer()))),
        ("layerTransforms", json!(layer_transform_cases())),
    ]);
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(FIXTURE);

    if std::env::var_os("SHIFT_UPDATE_FIXTURES").is_some() {
        std::fs::write(&path, generated).unwrap();
        return;
    }

    let committed = std::fs::read_to_string(&path).unwrap_or_default();
    assert!(
        committed == generated,
        "{FIXTURE} is stale; regenerate it with \
         `SHIFT_UPDATE_FIXTURES=1 cargo test -p shift-wire --test geometry_reference`",
    );
}

/// Writes the fixture's sections pretty-printed, but each case as one compact
/// line, so a regenerated fixture diffs per case instead of per number.
fn fixture_text(sections: &[(&str, Value)]) -> String {
    let compact = |value: &Value| serde_json::to_string(value).unwrap();
    let sections = sections
        .iter()
        .map(|(name, value)| {
            let body = match value {
                Value::Array(cases) => {
                    let lines = cases
                        .iter()
                        .map(|case| format!("    {}", compact(case)))
                        .collect::<Vec<_>>();
                    format!("[\n{}\n  ]", lines.join(",\n"))
                }
                other => compact(other),
            };
            format!("  {}: {body}", compact(&json!(name)))
        })
        .collect::<Vec<_>>();
    format!("{{\n{}\n}}\n", sections.join(",\n"))
}

fn decomposed(
    translate: (f64, f64),
    rotation: f64,
    scale: (f64, f64),
    skew: (f64, f64),
    center: (f64, f64),
) -> DecomposedTransform {
    DecomposedTransform {
        translate_x: translate.0,
        translate_y: translate.1,
        rotation,
        scale_x: scale.0,
        scale_y: scale.1,
        skew_x: skew.0,
        skew_y: skew.1,
        t_center_x: center.0,
        t_center_y: center.1,
    }
}

fn matrix(a: f64, b: f64, c: f64, d: f64, e: f64, f: f64) -> Transform {
    Transform {
        xx: a,
        xy: b,
        yx: c,
        yy: d,
        dx: e,
        dy: f,
    }
}

fn matrix_json(m: &Transform) -> Value {
    json!({ "a": m.xx, "b": m.xy, "c": m.yx, "d": m.yy, "e": m.dx, "f": m.dy })
}

fn compose_inputs() -> Vec<(&'static str, DecomposedTransform)> {
    let o = (0.0, 0.0);
    let one = (1.0, 1.0);
    vec![
        ("identity", DecomposedTransform::identity()),
        ("translation", decomposed((120.5, -48.25), 0.0, one, o, o)),
        ("rotation 30", decomposed(o, 30.0, one, o, o)),
        ("rotation 90", decomposed(o, 90.0, one, o, o)),
        ("rotation -135", decomposed((10.0, 20.0), -135.0, one, o, o)),
        ("rotation 180", decomposed(o, 180.0, one, o, o)),
        ("uniform scale", decomposed(o, 0.0, (2.5, 2.5), o, o)),
        ("non-uniform scale", decomposed(o, 0.0, (0.5, 3.0), o, o)),
        (
            "horizontal flip",
            decomposed((500.0, 0.0), 0.0, (-1.0, 1.0), o, o),
        ),
        (
            "vertical flip",
            decomposed((0.0, 700.0), 0.0, (1.0, -1.0), o, o),
        ),
        ("double flip", decomposed(o, 0.0, (-1.0, -1.0), o, o)),
        ("skew x", decomposed(o, 0.0, one, (15.0, 0.0), o)),
        ("skew y", decomposed(o, 0.0, one, (0.0, -20.0), o)),
        ("skew both", decomposed(o, 0.0, one, (12.0, 8.0), o)),
        (
            "rotation about center",
            decomposed(o, 45.0, one, o, (250.0, 350.0)),
        ),
        (
            "scale about center",
            decomposed(o, 0.0, (1.5, 0.75), o, (300.0, -120.0)),
        ),
        (
            "flip about center",
            decomposed((4.0, -6.0), 0.0, (-1.0, 1.0), o, (250.0, 0.0)),
        ),
        (
            "every field",
            decomposed(
                (33.0, -17.5),
                -62.5,
                (1.25, -0.8),
                (9.0, -4.0),
                (110.0, 240.0),
            ),
        ),
        (
            "zero scale",
            decomposed((5.0, 5.0), 20.0, (0.0, 1.0), o, (10.0, 10.0)),
        ),
    ]
}

/// `DecomposedTransform::to_matrix`, plus a sample point mapped through it.
fn compose_cases() -> Vec<Value> {
    let point = (37.5, -82.25);
    compose_inputs()
        .into_iter()
        .map(|(name, transform)| {
            let (x, y) = transform.transform_point(point.0, point.1);
            json!({
                "name": name,
                "decomposed": transform,
                "matrix": matrix_json(&transform.to_matrix()),
                "point": { "x": point.0, "y": point.1 },
                "mappedPoint": { "x": x, "y": y },
            })
        })
        .collect()
}

/// `DecomposedTransform::from_matrix` for raw matrices and for every composed case.
fn decompose_cases() -> Vec<Value> {
    let raw = [
        ("identity", Transform::identity()),
        ("translation", Transform::translate(-15.0, 42.0)),
        ("scale", Transform::scale(3.0, 0.25)),
        ("horizontal flip", matrix(-1.0, 0.0, 0.0, 1.0, 600.0, 0.0)),
        ("vertical flip", matrix(1.0, 0.0, 0.0, -1.0, 0.0, 800.0)),
        ("shear x", matrix(1.0, 0.0, 0.4, 1.0, 0.0, 0.0)),
        ("shear y", matrix(1.0, 0.3, 0.0, 1.0, 0.0, 0.0)),
        ("general", matrix(0.8, -0.6, 1.1, 0.9, 12.0, -7.0)),
        (
            "reflection with rotation",
            matrix(0.0, 1.0, 1.0, 0.0, 3.0, 4.0),
        ),
        ("singular", matrix(0.0, 0.0, 0.0, 2.0, 1.0, 1.0)),
    ];
    let composed = compose_inputs()
        .into_iter()
        .map(|(name, transform)| (name, transform.to_matrix()));

    raw.into_iter()
        .chain(composed)
        .map(|(name, m)| {
            json!({
                "name": name,
                "matrix": matrix_json(&m),
                "decomposed": DecomposedTransform::from_matrix(&m),
            })
        })
        .collect()
}

/// Deterministic coordinates with fractional parts, so bounds exercise real arithmetic.
struct Coordinates(u64);

impl Coordinates {
    fn next(&mut self) -> f64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        let bucket = (self.0 >> 33) % 4001;
        (bucket as f64 - 2000.0) / 4.0
    }
}

/// One authored point as `(x, y, type)`.
type PointSpec = (f64, f64, PointType);

fn point(x: f64, y: f64, point_type: PointType) -> Point {
    Point::new(PointId::from_raw(0), x, y, point_type, false)
}

/// Every on/off pattern up to four points, open and closed, plus curated curves.
///
/// Segment parsing looks at most three points ahead, so four points with
/// wrapping reach every branch of the parser.
fn contour_inputs() -> Vec<(String, Vec<Point>, bool)> {
    let mut coordinates = Coordinates(0x5eed);
    let mut cases = Vec::new();

    for len in 1..=4 {
        for mask in 0..(1u32 << len) {
            let types: Vec<PointType> = (0..len)
                .map(|bit| {
                    if mask & (1 << bit) != 0 {
                        PointType::OnCurve
                    } else {
                        PointType::OffCurve
                    }
                })
                .collect();
            for closed in [false, true] {
                let points = types
                    .iter()
                    .map(|&point_type| point(coordinates.next(), coordinates.next(), point_type))
                    .collect();
                let pattern = types
                    .iter()
                    .map(|point_type| match point_type {
                        PointType::OffCurve => "off",
                        _ => "on",
                    })
                    .collect::<Vec<_>>()
                    .join(",");
                let closure = if closed { "closed" } else { "open" };
                cases.push((format!("{closure} {pattern}"), points, closed));
            }
        }
    }

    let on = PointType::OnCurve;
    let off = PointType::OffCurve;
    let q = PointType::QCurve;
    let curated: Vec<(&str, Vec<PointSpec>, bool)> = vec![
        (
            "quadratic with interior extrema",
            vec![(0.0, 0.0, on), (50.0, 100.0, off), (100.0, 0.0, q)],
            false,
        ),
        (
            "quadratic with control past the end",
            vec![(0.0, 0.0, on), (140.0, -60.0, off), (100.0, 20.0, on)],
            false,
        ),
        (
            "bulging cubic",
            vec![
                (0.0, 0.0, on),
                (0.0, 200.0, off),
                (100.0, 200.0, off),
                (100.0, 0.0, on),
            ],
            false,
        ),
        (
            "s-curve cubic",
            vec![
                (0.0, 0.0, on),
                (100.0, 200.0, off),
                (-100.0, -200.0, off),
                (100.0, 0.0, on),
            ],
            false,
        ),
        (
            "cubic with retracted handles",
            vec![
                (10.0, 10.0, on),
                (10.0, 10.0, off),
                (90.0, 40.0, off),
                (90.0, 40.0, on),
            ],
            false,
        ),
        (
            "collinear cubic",
            vec![
                (0.0, 0.0, on),
                (25.0, 25.0, off),
                (75.0, 75.0, off),
                (100.0, 100.0, on),
            ],
            false,
        ),
        (
            "cubic collapsed to a point",
            vec![
                (42.0, 42.0, on),
                (42.0, 42.0, off),
                (42.0, 42.0, off),
                (42.0, 42.0, on),
            ],
            false,
        ),
        (
            "cubic whose x derivative is nearly linear",
            vec![
                (0.0, 0.0, on),
                (30.0, 80.0, off),
                (60.0 + 1e-11, -40.0, off),
                (90.0, 10.0, on),
            ],
            false,
        ),
        (
            "tiny cubic tail split near its end",
            vec![
                (99.999_7, 0.000_9, on),
                (99.999_8, 0.000_6, off),
                (99.999_9, 0.000_3, off),
                (100.0, 0.0, on),
            ],
            false,
        ),
        (
            "nearly straight quadratic",
            vec![
                (0.0, 0.0, on),
                (50.0 + 2e-11, 50.0, off),
                (100.0, 100.0, on),
            ],
            false,
        ),
        (
            "closed ring of cubics",
            vec![
                (250.0, 0.0, on),
                (388.0, 0.0, off),
                (500.0, 112.0, off),
                (500.0, 250.0, on),
                (500.0, 388.0, off),
                (388.0, 500.0, off),
                (250.0, 500.0, on),
                (112.0, 500.0, off),
                (0.0, 388.0, off),
                (0.0, 250.0, on),
                (0.0, 112.0, off),
                (112.0, 0.0, off),
            ],
            true,
        ),
        (
            "closed TrueType-style quadratics",
            vec![
                (0.0, 0.0, on),
                (120.0, -40.0, off),
                (200.0, 60.0, q),
                (240.0, 200.0, off),
                (60.0, 180.0, q),
            ],
            true,
        ),
        (
            "open cubic with a dangling handle",
            vec![
                (0.0, 0.0, on),
                (40.0, 90.0, off),
                (80.0, 90.0, off),
                (120.0, 0.0, on),
                (160.0, -90.0, off),
            ],
            false,
        ),
        (
            "open cubic missing its end point",
            vec![
                (0.0, 0.0, on),
                (100.0, 0.0, on),
                (140.0, 80.0, off),
                (180.0, 80.0, off),
            ],
            false,
        ),
    ];
    for (name, points, closed) in curated {
        let points = points
            .into_iter()
            .map(|(x, y, point_type)| point(x, y, point_type))
            .collect();
        cases.push((name.to_string(), points, closed));
    }

    cases
}

fn index_of(points: &[Point], target: &Point) -> usize {
    points
        .iter()
        .position(|candidate| std::ptr::eq(candidate, target))
        .expect("segment points borrow from the contour")
}

fn bounds_json(bounds: (f64, f64, f64, f64)) -> Value {
    json!({
        "min": { "x": bounds.0, "y": bounds.1 },
        "max": { "x": bounds.2, "y": bounds.3 },
    })
}

/// `CurveSegmentIter` segment kinds and point indices, `segment_bounds` for
/// each, and the contour's union bounds.
fn contour_cases() -> Vec<Value> {
    contour_inputs()
        .into_iter()
        .map(|(name, points, closed)| {
            let segments = CurveSegmentIter::new(&points, closed)
                .map(|segment| {
                    let (kind, members): (&str, Vec<&Point>) = match &segment {
                        CurveSegment::Line(p0, p1) => ("line", vec![p0, p1]),
                        CurveSegment::Quad(p0, c, p1) => ("quad", vec![p0, c, p1]),
                        CurveSegment::Cubic(p0, c0, c1, p1) => ("cubic", vec![p0, c0, c1, p1]),
                    };
                    let indices: Vec<usize> =
                        members.iter().map(|p| index_of(&points, p)).collect();
                    json!({
                        "type": kind,
                        "points": indices,
                        "bounds": bounds_json(segment_bounds(&segment)),
                    })
                })
                .collect::<Vec<_>>();
            let bounds = resolved_contours_bbox(&[ResolvedContour {
                points: points.clone(),
                closed,
            }])
            .map(bounds_json);
            let points = points
                .iter()
                .map(|point| {
                    json!({
                        "x": point.x(),
                        "y": point.y(),
                        "pointType": shift_wire::PointType::from(point.point_type()),
                    })
                })
                .collect::<Vec<_>>();

            json!({
                "name": name,
                "closed": closed,
                "points": points,
                "segments": segments,
                "bounds": bounds,
            })
        })
        .collect()
}

fn sample_layer() -> GlyphLayer {
    let mut layer = GlyphLayer::with_width(
        LayerId::from_raw("reference-layer"),
        SourceId::from_raw("reference-source"),
        600.0,
    );
    let contours: [(u64, bool, &[PointSpec]); 3] = [
        (
            100,
            true,
            &[
                (250.0, 0.0, PointType::OnCurve),
                (388.5, 0.0, PointType::OffCurve),
                (500.0, 111.5, PointType::OffCurve),
                (500.0, 250.0, PointType::OnCurve),
                (420.0, 520.0, PointType::OnCurve),
                (80.0, 520.0, PointType::OnCurve),
            ],
        ),
        (
            200,
            false,
            &[
                (40.0, -30.0, PointType::OnCurve),
                (160.0, 90.25, PointType::OnCurve),
            ],
        ),
        (
            300,
            true,
            &[
                (300.0, 300.0, PointType::OnCurve),
                (360.0, 240.0, PointType::OffCurve),
                (420.0, 300.0, PointType::QCurve),
                (360.0, 380.0, PointType::OffCurve),
            ],
        ),
    ];
    let mut next_point = 1000;
    for (contour_id, closed, points) in contours {
        let mut contour = Contour::with_id(ContourId::from_raw(contour_id));
        for &(x, y, point_type) in points {
            next_point += 1;
            contour.add_point_with_id(PointId::from_raw(next_point), x, y, point_type, false);
        }
        if closed {
            contour.close();
        }
        layer.add_contour(contour);
    }

    layer.add_anchor(Anchor::with_id(
        AnchorId::from_raw(500),
        Some("top".to_string()),
        250.0,
        700.0,
    ));
    layer.add_anchor(Anchor::with_id(
        AnchorId::from_raw(501),
        Some("_bottom".to_string()),
        -12.5,
        -3.75,
    ));

    let o = (0.0, 0.0);
    let one = (1.0, 1.0);
    let components = [
        (600, DecomposedTransform::identity()),
        (601, decomposed((140.0, 0.0), 0.0, one, o, o)),
        (602, decomposed((20.0, 30.0), 25.0, one, o, (100.0, 200.0))),
        (603, decomposed((0.0, 0.0), 0.0, (-1.0, 1.0), o, o)),
        (
            604,
            decomposed((7.0, -9.0), -40.0, (0.7, 1.3), (10.0, 0.0), o),
        ),
    ];
    for (component_id, transform) in components {
        layer.add_component(Component::with_id(
            ComponentId::from_raw(component_id),
            GlyphId::from_raw("base"),
            "base".to_string(),
            transform,
        ));
    }

    layer
}

/// Matrix that applies `inner` about `center` (translate there, apply, translate back).
fn about(center: (f64, f64), inner: Transform) -> Transform {
    Transform::translate(center.0, center.1)
        .compose(inner)
        .compose(Transform::translate(-center.0, -center.1))
}

fn rotation(degrees: f64) -> Transform {
    let (sin, cos) = degrees.to_radians().sin_cos();
    matrix(cos, sin, -sin, cos, 0.0, 0.0)
}

/// `GlyphLayer::transform_layer` on the `layerInput` layer under several matrices.
fn layer_transform_cases() -> Vec<Value> {
    let center = (250.0, 260.0);
    let matrices = [
        ("translation", Transform::translate(35.5, -12.0)),
        (
            "uniform scale about center",
            about(center, Transform::scale(1.5, 1.5)),
        ),
        (
            "non-uniform scale about corner",
            about((0.0, 520.0), Transform::scale(0.6, 1.8)),
        ),
        ("rotation 90", rotation(90.0)),
        ("rotation about center", about(center, rotation(-33.0))),
        (
            "horizontal flip about center",
            about(center, Transform::scale(-1.0, 1.0)),
        ),
        ("vertical flip", Transform::scale(1.0, -1.0)),
        ("skew", matrix(1.0, 0.0, 0.25, 1.0, 0.0, 0.0)),
        (
            "collapse to zero width",
            about(center, Transform::scale(0.0, 1.0)),
        ),
    ];

    matrices
        .into_iter()
        .map(|(name, transform)| {
            let mut after = sample_layer();
            after.transform_layer(&transform);
            json!({
                "name": name,
                "matrix": matrix_json(&transform),
                "after": GlyphState::from_layer(&after).values,
                "afterBounds": layer_bbox(&after, &[]).map(bounds_json),
            })
        })
        .collect()
}
