use napi::bindgen_prelude::Float64Array;
use napi_derive::napi;
use shift_font::{
    ComponentAlignment, GlyphId, Transform,
    composite::{
        ResolvedComponentGeometry, ResolvedContour, ResolvedLayerGeometry, resolved_contours_bbox,
        resolved_contours_to_svg_path,
    },
};

use crate::values;
use crate::{
    AnchorData, AnchorMatch, ComponentData, ComponentGlyph, ComponentMatch, ComponentTransformKind,
    ContourData, ContourMatch, DesignNormalization, GlyphComponents, GlyphInterpolation,
    GlyphLayerShape, GlyphLayerSnapshot, GlyphProjection, GlyphSnapshot, GlyphSnapshotRequest,
    GlyphSourceComponents, GlyphSourceShape, GlyphSourceValues, GlyphState, GlyphStructure,
    GlyphVariation, InterpolationBasis, InterpolationSupport, LayerDifference, LayerDifferenceKind,
    LayerMatch, Location, PointData, PointMatch, VariationBasis, VariationDelta,
};

#[napi(object)]
pub struct NapiCatalogAxis {
    pub index: u32,
    pub tag: String,
    pub name: String,
    pub hidden: bool,
    pub axis_type: String,
    pub minimum: Option<f64>,
    pub default: f64,
    pub maximum: Option<f64>,
    pub values: Vec<f64>,
}

#[napi(object)]
pub struct NapiCatalogMetrics {
    pub units_per_em: f64,
    pub ascender: f64,
    pub descender: f64,
    pub line_gap: f64,
}

#[napi(object)]
pub struct NapiContourMatch {
    #[napi(ts_type = "ContourId")]
    pub reference_id: String,
    #[napi(ts_type = "ContourId")]
    pub target_id: String,
}

impl From<ContourMatch> for NapiContourMatch {
    fn from(pair: ContourMatch) -> Self {
        Self {
            reference_id: pair.reference_id.to_string(),
            target_id: pair.target_id.to_string(),
        }
    }
}

#[napi(object)]
pub struct NapiPointMatch {
    #[napi(ts_type = "PointId")]
    pub reference_id: String,
    #[napi(ts_type = "PointId")]
    pub target_id: String,
}

impl From<PointMatch> for NapiPointMatch {
    fn from(pair: PointMatch) -> Self {
        Self {
            reference_id: pair.reference_id.to_string(),
            target_id: pair.target_id.to_string(),
        }
    }
}

#[napi(object)]
pub struct NapiAnchorMatch {
    #[napi(ts_type = "AnchorId")]
    pub reference_id: String,
    #[napi(ts_type = "AnchorId")]
    pub target_id: String,
}

impl From<AnchorMatch> for NapiAnchorMatch {
    fn from(pair: AnchorMatch) -> Self {
        Self {
            reference_id: pair.reference_id.to_string(),
            target_id: pair.target_id.to_string(),
        }
    }
}

#[napi(object)]
pub struct NapiComponentMatch {
    #[napi(ts_type = "ComponentId")]
    pub reference_id: String,
    #[napi(ts_type = "ComponentId")]
    pub target_id: String,
}

impl From<ComponentMatch> for NapiComponentMatch {
    fn from(pair: ComponentMatch) -> Self {
        Self {
            reference_id: pair.reference_id.to_string(),
            target_id: pair.target_id.to_string(),
        }
    }
}

#[napi(string_enum = "camelCase")]
pub enum NapiLayerDifferenceKind {
    ContourCount,
    ContourClosed,
    PointCount,
    PointType,
    AnchorCount,
    AnchorSequence,
    ComponentSequence,
}

impl From<LayerDifferenceKind> for NapiLayerDifferenceKind {
    fn from(kind: LayerDifferenceKind) -> Self {
        match kind {
            LayerDifferenceKind::ContourCount => Self::ContourCount,
            LayerDifferenceKind::ContourClosed => Self::ContourClosed,
            LayerDifferenceKind::PointCount => Self::PointCount,
            LayerDifferenceKind::PointType => Self::PointType,
            LayerDifferenceKind::AnchorCount => Self::AnchorCount,
            LayerDifferenceKind::AnchorSequence => Self::AnchorSequence,
            LayerDifferenceKind::ComponentSequence => Self::ComponentSequence,
        }
    }
}

#[napi(object)]
pub struct NapiLayerDifference {
    pub kind: NapiLayerDifferenceKind,
    pub contour: Option<u32>,
    pub point: Option<u32>,
    pub reference_count: Option<u32>,
    pub target_count: Option<u32>,
    pub reference_closed: Option<bool>,
    pub target_closed: Option<bool>,
    pub reference_point_type: Option<values::PointType>,
    pub target_point_type: Option<values::PointType>,
    pub reference_anchor_names: Option<Vec<Option<String>>>,
    pub target_anchor_names: Option<Vec<Option<String>>>,
    #[napi(ts_type = "Array<GlyphId> | undefined")]
    pub reference_component_ids: Option<Vec<String>>,
    #[napi(ts_type = "Array<GlyphId> | undefined")]
    pub target_component_ids: Option<Vec<String>>,
}

impl From<LayerDifference> for NapiLayerDifference {
    fn from(difference: LayerDifference) -> Self {
        Self {
            kind: difference.kind.into(),
            contour: difference.contour,
            point: difference.point,
            reference_count: difference.reference_count,
            target_count: difference.target_count,
            reference_closed: difference.reference_closed,
            target_closed: difference.target_closed,
            reference_point_type: difference.reference_point_type.map(Into::into),
            target_point_type: difference.target_point_type.map(Into::into),
            reference_anchor_names: difference.reference_anchor_names,
            target_anchor_names: difference.target_anchor_names,
            reference_component_ids: difference.reference_component_ids.map(IntoEach::into_each),
            target_component_ids: difference.target_component_ids.map(IntoEach::into_each),
        }
    }
}

#[napi(object)]
pub struct NapiLayerMatch {
    #[napi(ts_type = "LayerId")]
    pub reference_layer_id: String,
    #[napi(ts_type = "LayerId")]
    pub target_layer_id: String,
    pub complete: bool,
    pub contours: Vec<NapiContourMatch>,
    pub points: Vec<NapiPointMatch>,
    pub anchors: Vec<NapiAnchorMatch>,
    pub components: Vec<NapiComponentMatch>,
    pub differences: Vec<NapiLayerDifference>,
}

impl From<LayerMatch> for NapiLayerMatch {
    fn from(layer_match: LayerMatch) -> Self {
        Self {
            reference_layer_id: layer_match.reference_layer_id.to_string(),
            target_layer_id: layer_match.target_layer_id.to_string(),
            complete: layer_match.complete,
            contours: layer_match.contours.into_each(),
            points: layer_match.points.into_each(),
            anchors: layer_match.anchors.into_each(),
            components: layer_match.components.into_each(),
            differences: layer_match.differences.into_each(),
        }
    }
}

#[napi(object)]
pub struct NapiGlyphState {
    #[napi(ts_type = "LayerId")]
    pub layer_id: String,
    pub structure: NapiGlyphStructure,
    /// Numeric glyph state ordered to match `GlyphStructure`.
    pub values: Float64Array,
}

impl From<GlyphState> for NapiGlyphState {
    fn from(state: GlyphState) -> Self {
        Self {
            layer_id: state.layer_id.to_string(),
            structure: state.structure.into(),
            values: state.values.into(),
        }
    }
}

#[napi(object)]
pub struct NapiGlyphLayerSnapshot {
    #[napi(ts_type = "GlyphId")]
    pub glyph_id: String,
    #[napi(ts_type = "SourceId")]
    pub source_id: String,
    pub state: NapiGlyphState,
}

impl From<GlyphLayerSnapshot> for NapiGlyphLayerSnapshot {
    fn from(snapshot: GlyphLayerSnapshot) -> Self {
        Self {
            glyph_id: snapshot.glyph_id.to_string(),
            source_id: snapshot.source_id.to_string(),
            state: snapshot.state.into(),
        }
    }
}

#[napi(object)]
pub struct NapiGlyphSnapshotRequest {
    #[napi(ts_type = "GlyphId")]
    pub glyph_id: String,
}

impl From<NapiGlyphSnapshotRequest> for GlyphSnapshotRequest {
    fn from(request: NapiGlyphSnapshotRequest) -> Self {
        Self {
            glyph_id: GlyphId::from_raw(request.glyph_id),
        }
    }
}

#[napi(object)]
pub struct NapiGlyphSnapshot {
    #[napi(ts_type = "GlyphId")]
    pub glyph_id: String,
    pub projection: Option<NapiGlyphProjection>,
    pub layers: Vec<NapiGlyphLayerSnapshot>,
}

impl From<GlyphSnapshot> for NapiGlyphSnapshot {
    fn from(snapshot: GlyphSnapshot) -> Self {
        Self {
            glyph_id: snapshot.glyph_id.to_string(),
            projection: snapshot.projection.map(Into::into),
            layers: snapshot.layers.into_each(),
        }
    }
}

#[napi(string_enum = "camelCase")]
pub enum NapiComponentTransformKind {
    Decomposed,
    Affine,
}

#[napi(object)]
pub struct NapiGlyphLayerShape {
    pub structure: NapiGlyphStructure,
    pub values: Float64Array,
    pub component_transform_kind: NapiComponentTransformKind,
}

impl From<GlyphLayerShape> for NapiGlyphLayerShape {
    fn from(shape: GlyphLayerShape) -> Self {
        Self {
            structure: shape.structure.into(),
            values: shape.values.into(),
            component_transform_kind: match shape.component_transform_kind {
                ComponentTransformKind::Decomposed => NapiComponentTransformKind::Decomposed,
                ComponentTransformKind::Affine => NapiComponentTransformKind::Affine,
            },
        }
    }
}

#[napi(object)]
pub struct NapiInterpolationSupport {
    #[napi(ts_type = "AxisId")]
    pub axis_id: String,
    pub lower: f64,
    pub peak: f64,
    pub upper: f64,
}

impl From<InterpolationSupport> for NapiInterpolationSupport {
    fn from(support: InterpolationSupport) -> Self {
        Self {
            axis_id: support.axis_id.to_string(),
            lower: support.lower,
            peak: support.peak,
            upper: support.upper,
        }
    }
}

#[napi(object)]
pub struct NapiVariationDelta {
    pub region: Vec<NapiInterpolationSupport>,
    pub values: Float64Array,
}

impl From<VariationDelta> for NapiVariationDelta {
    fn from(delta: VariationDelta) -> Self {
        Self {
            region: delta.region.into_each(),
            values: delta.values.into(),
        }
    }
}

#[napi(object)]
pub struct NapiVariationBasis {
    pub deltas: Vec<NapiVariationDelta>,
}

impl From<VariationBasis> for NapiVariationBasis {
    fn from(basis: VariationBasis) -> Self {
        Self {
            deltas: basis.deltas.into_each(),
        }
    }
}

#[napi(object)]
pub struct NapiDesignNormalization {
    #[napi(ts_type = "AxisId")]
    pub axis_id: String,
    pub minimum: f64,
    pub default: f64,
    pub maximum: f64,
}

impl From<DesignNormalization> for NapiDesignNormalization {
    fn from(normalization: DesignNormalization) -> Self {
        Self {
            axis_id: normalization.axis_id.to_string(),
            minimum: normalization.minimum,
            default: normalization.default,
            maximum: normalization.maximum,
        }
    }
}

#[napi(object)]
pub struct NapiInterpolationBasis {
    #[napi(ts_type = "Array<SourceId>")]
    pub source_ids: Vec<String>,
    pub basis: NapiVariationBasis,
    pub design_normalization: Vec<NapiDesignNormalization>,
}

impl From<InterpolationBasis> for NapiInterpolationBasis {
    fn from(basis: InterpolationBasis) -> Self {
        Self {
            source_ids: basis.source_ids.into_each(),
            basis: basis.basis.into(),
            design_normalization: basis.design_normalization.into_each(),
        }
    }
}

#[napi(object)]
pub struct NapiGlyphSourceValues {
    #[napi(ts_type = "SourceId")]
    pub source_id: String,
    pub values: Float64Array,
}

impl From<GlyphSourceValues> for NapiGlyphSourceValues {
    fn from(source: GlyphSourceValues) -> Self {
        Self {
            source_id: source.source_id.to_string(),
            values: source.values.into(),
        }
    }
}

#[napi(object)]
pub struct NapiGlyphInterpolation {
    pub basis: NapiInterpolationBasis,
    pub sources: Vec<NapiGlyphSourceValues>,
}

impl From<GlyphInterpolation> for NapiGlyphInterpolation {
    fn from(interpolation: GlyphInterpolation) -> Self {
        Self {
            basis: interpolation.basis.into(),
            sources: interpolation.sources.into_each(),
        }
    }
}

#[napi(object)]
pub struct NapiGlyphVariation {
    pub basis: NapiVariationBasis,
}

impl From<GlyphVariation> for NapiGlyphVariation {
    fn from(variation: GlyphVariation) -> Self {
        Self {
            basis: variation.basis.into(),
        }
    }
}

#[napi(object)]
pub struct NapiGlyphSourceShape {
    #[napi(ts_type = "SourceId")]
    pub source_id: String,
    pub shape: NapiGlyphLayerShape,
}

#[napi(object)]
pub struct NapiComponentGlyph {
    #[napi(ts_type = "GlyphId")]
    pub parent_glyph_id: String,
    #[napi(ts_type = "ComponentId")]
    pub component_id: String,
    pub component_index: u32,
    #[napi(ts_type = "GlyphId")]
    pub base_glyph_id: String,
    #[napi(ts_type = "Array<ComponentId>")]
    pub parent_path: Vec<String>,
    #[napi(ts_type = "Array<ComponentId>")]
    pub component_path: Vec<String>,
}

impl From<ComponentGlyph> for NapiComponentGlyph {
    fn from(component: ComponentGlyph) -> Self {
        Self {
            parent_glyph_id: component.parent_glyph_id.to_string(),
            component_id: component.component_id.to_string(),
            component_index: u32::try_from(component.component_index)
                .expect("component index exceeds u32"),
            base_glyph_id: component.base_glyph_id.to_string(),
            parent_path: component.parent_path.into_each(),
            component_path: component.component_path.into_each(),
        }
    }
}

#[napi(object)]
pub struct NapiGlyphComponents {
    #[napi(ts_type = "GlyphId")]
    pub root_glyph_id: String,
    pub components: Vec<NapiComponentGlyph>,
}

impl From<GlyphComponents> for NapiGlyphComponents {
    fn from(components: GlyphComponents) -> Self {
        Self {
            root_glyph_id: components.root_glyph_id.to_string(),
            components: components.components.into_each(),
        }
    }
}

#[napi(object)]
pub struct NapiGlyphSourceComponents {
    #[napi(ts_type = "SourceId")]
    pub source_id: String,
    pub components: NapiGlyphComponents,
}

impl From<GlyphSourceComponents> for NapiGlyphSourceComponents {
    fn from(source: GlyphSourceComponents) -> Self {
        Self {
            source_id: source.source_id.to_string(),
            components: source.components.into(),
        }
    }
}

impl From<GlyphSourceShape> for NapiGlyphSourceShape {
    fn from(source_shape: GlyphSourceShape) -> Self {
        Self {
            source_id: source_shape.source_id.to_string(),
            shape: source_shape.shape.into(),
        }
    }
}

#[napi(object)]
pub struct NapiGlyphProjection {
    #[napi(ts_type = "GlyphId")]
    pub glyph_id: String,
    pub fallback: NapiGlyphLayerShape,
    pub interpolation: Option<NapiGlyphInterpolation>,
    pub decomposition: Option<NapiInterpolationBasis>,
    pub variation: Option<NapiGlyphVariation>,
    pub exact_source_shapes: Vec<NapiGlyphSourceShape>,
    pub components: NapiGlyphComponents,
    pub exact_source_components: Vec<NapiGlyphSourceComponents>,
    #[napi(ts_type = "Array<GlyphId>")]
    pub component_glyph_ids: Vec<String>,
}

impl From<GlyphProjection> for NapiGlyphProjection {
    fn from(projection: GlyphProjection) -> Self {
        Self {
            glyph_id: projection.glyph_id.to_string(),
            fallback: projection.fallback.into(),
            interpolation: projection.interpolation.map(Into::into),
            decomposition: projection.decomposition.map(Into::into),
            variation: projection.variation.map(Into::into),
            exact_source_shapes: projection.exact_source_shapes.into_each(),
            components: projection.components.into(),
            exact_source_components: projection.exact_source_components.into_each(),
            component_glyph_ids: projection.component_glyph_ids.into_each(),
        }
    }
}

#[napi(object)]
pub struct NapiGlyphStructure {
    pub contours: Vec<NapiContourData>,
    pub anchors: Vec<NapiAnchorData>,
    pub components: Vec<NapiComponentData>,
}

impl From<GlyphStructure> for NapiGlyphStructure {
    fn from(structure: GlyphStructure) -> Self {
        Self {
            contours: structure.contours.into_each(),
            anchors: structure.anchors.into_each(),
            components: structure.components.into_each(),
        }
    }
}

impl From<NapiGlyphStructure> for GlyphStructure {
    fn from(structure: NapiGlyphStructure) -> Self {
        Self {
            contours: structure.contours.into_each(),
            anchors: structure.anchors.into_each(),
            components: structure.components.into_each(),
        }
    }
}

#[napi(object)]
pub struct NapiContourData {
    #[napi(ts_type = "ContourId")]
    pub id: String,
    pub points: Vec<NapiPointData>,
    pub closed: bool,
}

impl From<ContourData> for NapiContourData {
    fn from(contour: ContourData) -> Self {
        Self {
            id: contour.id,
            points: contour.points.into_each(),
            closed: contour.closed,
        }
    }
}

impl From<NapiContourData> for ContourData {
    fn from(contour: NapiContourData) -> Self {
        Self {
            id: contour.id,
            points: contour.points.into_each(),
            closed: contour.closed,
        }
    }
}

#[napi(object)]
pub struct NapiPointData {
    #[napi(ts_type = "PointId")]
    pub id: String,
    pub point_type: values::PointType,
    pub smooth: bool,
}

impl From<PointData> for NapiPointData {
    fn from(point: PointData) -> Self {
        Self {
            id: point.id,
            point_type: point.point_type.into(),
            smooth: point.smooth,
        }
    }
}

impl From<NapiPointData> for PointData {
    fn from(point: NapiPointData) -> Self {
        Self {
            id: point.id,
            point_type: point.point_type.into(),
            smooth: point.smooth,
        }
    }
}

#[napi(object)]
pub struct NapiAnchorData {
    #[napi(ts_type = "AnchorId")]
    pub id: String,
    pub name: Option<String>,
}

impl From<AnchorData> for NapiAnchorData {
    fn from(anchor: AnchorData) -> Self {
        Self {
            id: anchor.id,
            name: anchor.name,
        }
    }
}

impl From<NapiAnchorData> for AnchorData {
    fn from(anchor: NapiAnchorData) -> Self {
        Self {
            id: anchor.id,
            name: anchor.name,
        }
    }
}

#[napi(object)]
pub struct NapiComponentData {
    #[napi(ts_type = "ComponentId")]
    pub id: String,
    #[napi(ts_type = "GlyphId")]
    pub base_glyph_id: String,
    #[napi(ts_type = "GlyphName")]
    pub base_glyph_name: String,
    /// Placed by its anchors (`anchored`) or by hand (`free`); `unset` counts
    /// as anchored while the component sits exactly on its anchors.
    #[napi(ts_type = "\"anchored\" | \"free\" | \"unset\"")]
    pub alignment: String,
}

impl From<ComponentData> for NapiComponentData {
    fn from(component: ComponentData) -> Self {
        Self {
            id: component.id,
            base_glyph_id: component.base_glyph_id.to_string(),
            base_glyph_name: component.base_glyph_name.to_string(),
            alignment: alignment_name(component.alignment).to_string(),
        }
    }
}

/// Converts every value of a collection, as [`Into`] converts one.
///
/// An `Option` is a collection of at most one value, so convert the list
/// inside it with `option.map(IntoEach::into_each)`.
pub trait IntoEach: IntoIterator + Sized {
    /// Converts each value with [`From`] and collects the results.
    fn into_each<U: From<Self::Item>>(self) -> Vec<U> {
        self.into_iter().map(U::from).collect()
    }
}

impl<I: IntoIterator> IntoEach for I {}

/// The wire name of a component alignment.
pub fn alignment_name(alignment: ComponentAlignment) -> &'static str {
    match alignment {
        ComponentAlignment::Unset => "unset",
        ComponentAlignment::Anchored => "anchored",
        ComponentAlignment::Free => "free",
    }
}

impl From<NapiComponentData> for ComponentData {
    fn from(component: NapiComponentData) -> Self {
        Self {
            id: component.id,
            base_glyph_id: GlyphId::from_raw(component.base_glyph_id),
            base_glyph_name: component.base_glyph_name.into(),
            alignment: values::parse_alignment(Some(&component.alignment)),
        }
    }
}

/// Location-resolved drawable preview: one svg path and advance per glyph,
/// with no editable structure crossing the boundary.
#[napi(object)]
pub struct NapiGlyphPreview {
    #[napi(ts_type = "GlyphId")]
    pub glyph_id: String,
    pub svg_path: String,
    pub x_advance: f64,
}

/// One corner of outline bounds in font units.
#[napi(object)]
pub struct NapiBoundsCorner {
    pub x: f64,
    pub y: f64,
}

/// Tight axis-aligned outline bounds in font units, y-up.
#[napi(object)]
pub struct NapiOutlineBounds {
    pub min: NapiBoundsCorner,
    pub max: NapiBoundsCorner,
}

/// Composited outline as one SVG path in font units with its tight bounds.
#[napi(object)]
pub struct NapiResolvedOutline {
    pub svg_path: String,
    pub bounds: Option<NapiOutlineBounds>,
}

impl From<&[ResolvedContour]> for NapiResolvedOutline {
    fn from(contours: &[ResolvedContour]) -> Self {
        Self {
            svg_path: resolved_contours_to_svg_path(contours),
            bounds: resolved_contours_bbox(contours).map(|(min_x, min_y, max_x, max_y)| {
                NapiOutlineBounds {
                    min: NapiBoundsCorner { x: min_x, y: min_y },
                    max: NapiBoundsCorner { x: max_x, y: max_y },
                }
            }),
        }
    }
}

/// Six-value affine placement of a component in its parent layer.
#[napi(object)]
pub struct NapiComponentTransform {
    pub xx: f64,
    pub xy: f64,
    pub yx: f64,
    pub yy: f64,
    pub dx: f64,
    pub dy: f64,
}

impl From<Transform> for NapiComponentTransform {
    fn from(transform: Transform) -> Self {
        Self {
            xx: transform.xx,
            xy: transform.xy,
            yx: transform.yx,
            yy: transform.yy,
            dx: transform.dx,
            dy: transform.dy,
        }
    }
}

/// One direct component whose outline includes its resolved descendants.
#[napi(object)]
pub struct NapiResolvedComponentGeometry {
    #[napi(ts_type = "ComponentId")]
    pub id: String,
    #[napi(ts_type = "GlyphId")]
    pub base_glyph_id: String,
    pub transformation: NapiComponentTransform,
    pub outline: NapiResolvedOutline,
}

impl From<&ResolvedComponentGeometry> for NapiResolvedComponentGeometry {
    fn from(component: &ResolvedComponentGeometry) -> Self {
        Self {
            id: component.component_id().to_string(),
            base_glyph_id: component.base_glyph_id().to_string(),
            transformation: component.transformation().into(),
            outline: component.outline().into(),
        }
    }
}

/// Composited geometry of one exact authored layer at its own source.
#[napi(object)]
pub struct NapiResolvedLayerGeometry {
    pub outline: NapiResolvedOutline,
    pub components: Vec<NapiResolvedComponentGeometry>,
}

impl From<&ResolvedLayerGeometry> for NapiResolvedLayerGeometry {
    fn from(geometry: &ResolvedLayerGeometry) -> Self {
        Self {
            outline: geometry.outline().into(),
            components: geometry.components().iter().map(Into::into).collect(),
        }
    }
}

/// One accepted-state layer: authored state and its resolved geometry, read together.
#[napi(object)]
pub struct NapiLayerRead {
    pub authored: NapiGlyphLayerSnapshot,
    pub resolved: NapiResolvedLayerGeometry,
}

impl From<Location> for values::Location {
    fn from(location: Location) -> Self {
        Self {
            values: location
                .values
                .into_iter()
                .map(|(axis_id, value)| (axis_id.to_string(), value))
                .collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn into_each_converts_every_value_in_order() {
        let ids = vec![GlyphId::from_raw("a"), GlyphId::from_raw("b")];

        let names: Vec<String> = ids.into_each();

        assert_eq!(names, ["glyph_a", "glyph_b"]);
    }

    #[test]
    fn into_each_on_an_option_converts_the_values_inside_it() {
        let ids = Some(vec![GlyphId::from_raw("a")]);

        let names: Option<Vec<String>> = ids.map(IntoEach::into_each);

        assert_eq!(names, Some(vec!["glyph_a".to_owned()]));
    }
}
