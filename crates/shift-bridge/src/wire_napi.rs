//! The wire shapes as napi objects: what the native addon's calls take and
//! return, converted from and to [`shift_font::wire`]'s.

use napi::bindgen_prelude::Float64Array;
use napi_derive::napi;
use std::collections::HashMap;

use shift_font::{
  AxisId, ComponentAlignment, GlyphId, Location as FontLocation, PointType as IrPointType,
  Transform,
  composite::{
    ResolvedComponentGeometry, ResolvedContour, ResolvedLayerGeometry, resolved_contours_bbox,
    resolved_contours_to_svg_path,
  },
};

use shift_font::wire::values;
use shift_font::wire::{
  AnchorData, ComponentData, ComponentGlyph, ComponentTransformKind, ContourData,
  DesignNormalization, GlyphComponents, GlyphInterpolation, GlyphLayerShape, GlyphLayerSnapshot,
  GlyphProjection, GlyphSnapshot, GlyphSnapshotRequest, GlyphSourceComponents, GlyphSourceShape,
  GlyphSourceValues, GlyphState, GlyphStructure, GlyphVariation, InterpolationBasis,
  InterpolationSupport, Location as WireLocation, PointData, PointType as StatePointType,
  VariationBasis, VariationDelta,
};

/// A glyph catalog's line metrics, for TypeScript: no call returns it; the
/// renderer builds it from the font's metrics.
#[napi(object)]
#[expect(
  dead_code,
  reason = "napi declares it for TypeScript; Rust never builds one"
)]
pub(crate) struct NapiCatalogMetrics {
  pub units_per_em: f64,
  pub ascender: f64,
  pub descender: f64,
  pub line_gap: f64,
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
  pub point_type: PointType,
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
pub(crate) trait IntoEach: IntoIterator + Sized {
  /// Converts each value with [`From`] and collects the results.
  fn into_each<U: From<Self::Item>>(self) -> Vec<U> {
    self.into_iter().map(U::from).collect()
  }
}

impl<I: IntoIterator> IntoEach for I {}

/// The wire name of a component alignment.
pub(crate) fn alignment_name(alignment: ComponentAlignment) -> &'static str {
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

impl From<WireLocation> for Location {
  fn from(location: WireLocation) -> Self {
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

/// A point type as the native addon's napi records carry it.
#[napi(string_enum = "camelCase")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(
  clippy::enum_variant_names,
  reason = "the font-format names for point types"
)]
pub enum PointType {
  OnCurve,
  OffCurve,
  QCurve,
}

/// A location as the native addon's napi calls take it, by axis id.
#[napi(object)]
pub struct Location {
  #[napi(ts_type = "Record<AxisId, number>")]
  pub values: HashMap<String, f64>,
}

impl TryFrom<Location> for FontLocation {
  type Error = values::WireError;

  fn try_from(wire: Location) -> values::WireResult<Self> {
    wire
      .values
      .into_iter()
      .map(|(axis_id, value)| Ok((values::parse::<AxisId>(&axis_id)?, value)))
      .collect()
  }
}

impl From<StatePointType> for PointType {
  fn from(point_type: StatePointType) -> Self {
    match point_type {
      StatePointType::OnCurve => Self::OnCurve,
      StatePointType::OffCurve => Self::OffCurve,
      StatePointType::QCurve => Self::QCurve,
    }
  }
}

impl From<PointType> for StatePointType {
  fn from(point_type: PointType) -> Self {
    match point_type {
      PointType::OnCurve => Self::OnCurve,
      PointType::OffCurve => Self::OffCurve,
      PointType::QCurve => Self::QCurve,
    }
  }
}

impl From<PointType> for IrPointType {
  fn from(point_type: PointType) -> Self {
    let point_type: StatePointType = point_type.into();
    point_type.into()
  }
}
