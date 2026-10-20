//! Component matrices, contour segments and bounds, and whole-layer transforms.

use serde::{Deserialize, Serialize, de::IgnoredAny};
use shift_font::composite::{ResolvedContour, layer_bbox, resolved_contours_bbox};
use shift_font::curve::segment_bounds;
use shift_font::{
    Anchor, AnchorId, Component, ComponentId, Contour, ContourId, CurveSegment, CurveSegmentIter,
    DecomposedTransform, GlyphId, GlyphInterpolationValues, GlyphLayer, LayerId, Point, PointId,
    PointType, SourceId, Transform,
};
use tsify::{Ts, Tsify};
use wasm_bindgen::prelude::*;

/// A component placement, field for field the editor's `DecomposedTransform`.
#[derive(Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceDecomposed {
    translate_x: f64,
    translate_y: f64,
    rotation: f64,
    scale_x: f64,
    scale_y: f64,
    skew_x: f64,
    skew_y: f64,
    t_center_x: f64,
    t_center_y: f64,
}

/// An affine matrix in the editor's `MatModel` names: `a = xx`, `b = xy`,
/// `c = yx`, `d = yy`, `e = dx`, `f = dy`.
#[derive(Serialize, Deserialize, Tsify)]
pub struct ReferenceMatrix {
    a: f64,
    b: f64,
    c: f64,
    d: f64,
    e: f64,
    f: f64,
}

#[derive(Serialize, Deserialize, Tsify)]
pub struct ReferencePoint {
    x: f64,
    y: f64,
}

/// A tight box; the editor's `Bounds` has the same shape.
#[derive(Serialize, Tsify)]
pub struct ReferenceBounds {
    min: ReferencePoint,
    max: ReferencePoint,
}

/// A point's type, as the editor spells it.
#[allow(clippy::enum_variant_names)]
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub enum ReferencePointType {
    OnCurve,
    OffCurve,
    QCurve,
}

/// One authored contour point.
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceContourPoint {
    x: f64,
    y: f64,
    point_type: ReferencePointType,
}

#[derive(Deserialize, Tsify)]
pub struct ReferenceContour {
    points: Vec<ReferenceContourPoint>,
    closed: bool,
}

#[derive(Serialize, Tsify)]
#[serde(rename_all = "lowercase")]
pub enum ReferenceSegmentKind {
    Line,
    Quad,
    Cubic,
}

/// One parsed segment: its kind, its points as indices into the contour, and its tight box.
#[derive(Serialize, Tsify)]
pub struct ReferenceSegment {
    #[serde(rename = "type")]
    kind: ReferenceSegmentKind,
    points: Vec<usize>,
    bounds: ReferenceBounds,
}

#[derive(Serialize, Tsify)]
pub struct ReferenceContourGeometry {
    segments: Vec<ReferenceSegment>,
    bounds: Option<ReferenceBounds>,
}

/// The parts of a contour's structure the layer's values depend on.
#[derive(Deserialize, Tsify)]
pub struct ReferenceStructureContour {
    points: Vec<ReferenceStructurePoint>,
    closed: bool,
}

#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceStructurePoint {
    point_type: ReferencePointType,
}

/// A glyph structure; only point types, closure, and counts are read.
#[derive(Deserialize, Tsify)]
pub struct ReferenceStructure {
    contours: Vec<ReferenceStructureContour>,
    #[tsify(type = "readonly unknown[]")]
    anchors: Vec<IgnoredAny>,
    #[tsify(type = "readonly unknown[]")]
    components: Vec<IgnoredAny>,
}

/// A layer as the editor holds it: its structure and its values in interpolation order.
#[derive(Deserialize, Tsify)]
pub struct ReferenceLayer {
    structure: ReferenceStructure,
    #[tsify(type = "Float64Array | number[]")]
    values: Vec<f64>,
}

#[derive(Serialize, Tsify)]
pub struct ReferenceLayerGeometry {
    values: Vec<f64>,
    bounds: Option<ReferenceBounds>,
}

/// `DecomposedTransform::to_matrix`.
#[wasm_bindgen(js_name = composeTransform)]
pub fn compose_transform(
    transform: Ts<ReferenceDecomposed>,
) -> Result<Ts<ReferenceMatrix>, JsError> {
    let transform = DecomposedTransform::from(transform.to_rust()?);
    Ok(ReferenceMatrix::from(transform.to_matrix()).into_ts()?)
}

/// `DecomposedTransform::transform_point`.
#[wasm_bindgen(js_name = transformPoint)]
pub fn transform_point(
    transform: Ts<ReferenceDecomposed>,
    point: Ts<ReferencePoint>,
) -> Result<Ts<ReferencePoint>, JsError> {
    let transform = DecomposedTransform::from(transform.to_rust()?);
    let point = point.to_rust()?;
    let moved = transform.transform_point(shift_font::kurbo::Point::new(point.x, point.y));
    Ok(ReferencePoint {
        x: moved.x,
        y: moved.y,
    }
    .into_ts()?)
}

/// `DecomposedTransform::from_matrix`.
#[wasm_bindgen(js_name = decomposeMatrix)]
pub fn decompose_matrix(matrix: Ts<ReferenceMatrix>) -> Result<Ts<ReferenceDecomposed>, JsError> {
    let matrix = Transform::from(matrix.to_rust()?);
    Ok(ReferenceDecomposed::from(DecomposedTransform::from_matrix(&matrix)).into_ts()?)
}

/// `CurveSegmentIter`'s segments with `segment_bounds` each, and the
/// contour's `resolved_contours_bbox`.
#[wasm_bindgen(js_name = contourGeometry)]
pub fn contour_geometry(
    contour: Ts<ReferenceContour>,
) -> Result<Ts<ReferenceContourGeometry>, JsError> {
    let contour = contour.to_rust()?;
    let points: Vec<Point> = contour
        .points
        .into_iter()
        .enumerate()
        .map(|(index, point)| {
            Point::new(
                PointId::from_raw(index),
                point.x,
                point.y,
                (&point.point_type).into(),
                false,
            )
        })
        .collect();
    let index_of = |target: &Point| {
        points
            .iter()
            .position(|candidate| std::ptr::eq(candidate, target))
            .unwrap_or(usize::MAX)
    };
    let segments = CurveSegmentIter::new(&points, contour.closed)
        .map(|segment| {
            let (kind, members): (_, Vec<&Point>) = match &segment {
                CurveSegment::Line(p0, p1) => (ReferenceSegmentKind::Line, vec![p0, p1]),
                CurveSegment::Quad(p0, c, p1) => (ReferenceSegmentKind::Quad, vec![p0, c, p1]),
                CurveSegment::Cubic(p0, c0, c1, p1) => {
                    (ReferenceSegmentKind::Cubic, vec![p0, c0, c1, p1])
                }
            };
            ReferenceSegment {
                kind,
                points: members.into_iter().map(index_of).collect(),
                bounds: segment_bounds(&segment).into(),
            }
        })
        .collect();
    let bounds = resolved_contours_bbox(&[ResolvedContour {
        points: points.clone(),
        closed: contour.closed,
    }])
    .map(ReferenceBounds::from);

    Ok(ReferenceContourGeometry { segments, bounds }.into_ts()?)
}

/// `GlyphLayer::transform_layer`, returning the layer's values afterwards and
/// its `layer_bbox` without component contours.
#[wasm_bindgen(js_name = transformLayer)]
pub fn transform_layer(
    layer: Ts<ReferenceLayer>,
    matrix: Ts<ReferenceMatrix>,
) -> Result<Ts<ReferenceLayerGeometry>, JsError> {
    let input = layer.to_rust()?;
    let matrix = Transform::from(matrix.to_rust()?);
    let mut layer = layer_with_structure(&input.structure);
    layer.apply_interpolation_values(&GlyphInterpolationValues::new(input.values))?;

    layer.transform_layer(&matrix);

    Ok(ReferenceLayerGeometry {
        values: layer.interpolation_values().into_vec(),
        bounds: layer_bbox(&layer, &[]).map(ReferenceBounds::from),
    }
    .into_ts()?)
}

/// A layer with `structure`'s contours, anchors, and components, every value zero.
fn layer_with_structure(structure: &ReferenceStructure) -> GlyphLayer {
    let mut layer = GlyphLayer::with_width(
        LayerId::from_raw("reference"),
        SourceId::from_raw("reference"),
        0.0,
    );
    let mut next_point = 0;
    for (index, data) in structure.contours.iter().enumerate() {
        let mut contour = Contour::with_id(ContourId::from_raw(index));
        for point in &data.points {
            contour.add_point_with_id(
                PointId::from_raw(next_point),
                0.0,
                0.0,
                (&point.point_type).into(),
                false,
            );
            next_point += 1;
        }
        if data.closed {
            contour.close();
        }
        layer.add_contour(contour);
    }
    for index in 0..structure.anchors.len() {
        layer.add_anchor(Anchor::with_id(AnchorId::from_raw(index), None, 0.0, 0.0));
    }
    for index in 0..structure.components.len() {
        layer.add_component(Component::with_id(
            ComponentId::from_raw(index),
            GlyphId::from_raw("reference"),
            "reference",
            DecomposedTransform::identity(),
        ));
    }
    layer
}

impl From<&ReferencePointType> for PointType {
    fn from(point_type: &ReferencePointType) -> Self {
        match point_type {
            ReferencePointType::OnCurve => Self::OnCurve,
            ReferencePointType::OffCurve => Self::OffCurve,
            ReferencePointType::QCurve => Self::QCurve,
        }
    }
}

impl From<(f64, f64, f64, f64)> for ReferenceBounds {
    fn from((min_x, min_y, max_x, max_y): (f64, f64, f64, f64)) -> Self {
        Self {
            min: ReferencePoint { x: min_x, y: min_y },
            max: ReferencePoint { x: max_x, y: max_y },
        }
    }
}

impl From<ReferenceMatrix> for Transform {
    fn from(m: ReferenceMatrix) -> Self {
        Self {
            xx: m.a,
            xy: m.b,
            yx: m.c,
            yy: m.d,
            dx: m.e,
            dy: m.f,
        }
    }
}

impl From<Transform> for ReferenceMatrix {
    fn from(m: Transform) -> Self {
        Self {
            a: m.xx,
            b: m.xy,
            c: m.yx,
            d: m.yy,
            e: m.dx,
            f: m.dy,
        }
    }
}

impl From<ReferenceDecomposed> for DecomposedTransform {
    fn from(t: ReferenceDecomposed) -> Self {
        Self {
            translate_x: t.translate_x,
            translate_y: t.translate_y,
            rotation: t.rotation,
            scale_x: t.scale_x,
            scale_y: t.scale_y,
            skew_x: t.skew_x,
            skew_y: t.skew_y,
            t_center_x: t.t_center_x,
            t_center_y: t.t_center_y,
        }
    }
}

impl From<DecomposedTransform> for ReferenceDecomposed {
    fn from(t: DecomposedTransform) -> Self {
        Self {
            translate_x: t.translate_x,
            translate_y: t.translate_y,
            rotation: t.rotation,
            scale_x: t.scale_x,
            scale_y: t.scale_y,
            skew_x: t.skew_x,
            skew_y: t.skew_y,
            t_center_x: t.t_center_x,
            t_center_y: t.t_center_y,
        }
    }
}
