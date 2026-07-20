//! document state types shared by edit logic and bridge bindings.
//!
//! These types split stable glyph structure from mutable numeric values. The
//! values layout is canonical and must stay in lockstep with every consumer.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use shift_font::composite::{
    ComponentAnchorReference as IrComponentAnchorReference, ComponentGlyph as IrComponentGlyph,
    GlyphComponents as IrGlyphComponents,
};
use shift_font::{
    Anchor as IrAnchor, AnchorId, Axis as IrAxis, AxisId, AxisKind as IrAxisKind, AxisLabelId,
    AxisMapping as IrAxisMapping, AxisMappingId, AxisRole as IrAxisRole, Component as IrComponent,
    ComponentId, Contour as IrContour, ContourId, FontMetadata as IrFontMetadata,
    FontMetrics as IrFontMetrics, Glyph as IrGlyph, GlyphId,
    GlyphInterpolation as IrGlyphInterpolation, GlyphLayer, GlyphName,
    GlyphProjection as IrGlyphProjection, GlyphSourceComponents as IrGlyphSourceComponents,
    GuidelineId, InterpolationBasis as IrInterpolationBasis, LayerId, Location as IrLocation,
    MetricDefinition as IrMetricDefinition, MetricId, MetricKind as IrMetricKind,
    NamedInstance as IrNamedInstance, NamedInstanceId, Point as IrPoint, PointId,
    PointType as IrPointType, Source as IrSource, SourceId,
    SourceMetricField as IrSourceMetricField,
    SourceMetricInterpolation as IrSourceMetricInterpolation,
};

pub mod bridges;
pub mod state;

/// Flat numeric glyph values ordered to match `GlyphStructure`.
///
/// This layout is structure-dependent:
///
/// 1. x advance
/// 2. contour point positions, in `GlyphStructure.contours` order:
///    `x, y` for each point
/// 3. anchor positions, in `GlyphStructure.anchors` order:
///    `x, y` for each anchor
/// 4. component transforms, in `GlyphStructure.components` order:
///    `translateX, translateY, rotation, scaleX, scaleY,
///     skewX, skewY, tCenterX, tCenterY` for each component
pub type GlyphValue = f64;

pub type GlyphValues = Vec<GlyphValue>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontMetadata {
    pub family_name: Option<String>,
    pub style_name: Option<String>,
    pub version_major: Option<i32>,
    pub version_minor: Option<i32>,
    pub copyright: Option<String>,
    pub trademark: Option<String>,
    pub designer: Option<String>,
    pub designer_url: Option<String>,
    pub manufacturer: Option<String>,
    pub manufacturer_url: Option<String>,
    pub license: Option<String>,
    pub license_url: Option<String>,
    pub description: Option<String>,
    pub note: Option<String>,
}

impl From<&IrFontMetadata> for FontMetadata {
    fn from(metadata: &IrFontMetadata) -> Self {
        Self {
            family_name: metadata.family_name.clone(),
            style_name: metadata.style_name.clone(),
            version_major: metadata.version_major,
            version_minor: metadata.version_minor,
            copyright: metadata.copyright.clone(),
            trademark: metadata.trademark.clone(),
            designer: metadata.designer.clone(),
            designer_url: metadata.designer_url.clone(),
            manufacturer: metadata.manufacturer.clone(),
            manufacturer_url: metadata.manufacturer_url.clone(),
            license: metadata.license.clone(),
            license_url: metadata.license_url.clone(),
            description: metadata.description.clone(),
            note: metadata.note.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontMetrics {
    pub units_per_em: f64,
}

impl From<&IrFontMetrics> for FontMetrics {
    fn from(metrics: &IrFontMetrics) -> Self {
        Self {
            units_per_em: metrics.units_per_em,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricDefinition {
    pub id: MetricId,
    pub kind: MetricKind,
    pub name: String,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MetricKind {
    Ascender,
    CapHeight,
    XHeight,
    Baseline,
    Descender,
    Custom,
}

impl From<&IrMetricDefinition> for MetricDefinition {
    fn from(definition: &IrMetricDefinition) -> Self {
        let kind = match definition.kind() {
            IrMetricKind::Ascender => MetricKind::Ascender,
            IrMetricKind::CapHeight => MetricKind::CapHeight,
            IrMetricKind::XHeight => MetricKind::XHeight,
            IrMetricKind::Baseline => MetricKind::Baseline,
            IrMetricKind::Descender => MetricKind::Descender,
            IrMetricKind::Custom => MetricKind::Custom,
        };
        Self {
            id: definition.id(),
            kind,
            name: definition.name().to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceMetricValue {
    pub metric_id: MetricId,
    pub position: f64,
    pub overshoot: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Axis {
    pub id: AxisId,
    pub tag: String,
    pub name: String,
    pub role: String,
    pub axis_type: String,
    pub minimum: Option<f64>,
    pub default: f64,
    pub maximum: Option<f64>,
    pub values: Option<Vec<f64>>,
    pub labels: Vec<AxisLabel>,
    pub hidden: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Wire projection of a stable external-axis label.
pub struct AxisLabel {
    pub id: AxisLabelId,
    pub name: String,
    pub value: f64,
    pub minimum: Option<f64>,
    pub maximum: Option<f64>,
    pub linked_value: Option<f64>,
    pub elidable: bool,
}

impl From<&IrAxis> for Axis {
    fn from(axis: &IrAxis) -> Self {
        Self {
            id: axis.id(),
            tag: axis.tag().to_string(),
            name: axis.name().to_string(),
            role: match axis.role() {
                IrAxisRole::External => "external",
                IrAxisRole::Internal => "internal",
            }
            .to_string(),
            axis_type: match axis.kind() {
                IrAxisKind::Continuous { .. } => "continuous",
                IrAxisKind::Discrete { .. } => "discrete",
            }
            .to_string(),
            minimum: matches!(axis.kind(), IrAxisKind::Continuous { .. }).then(|| axis.minimum()),
            default: axis.default(),
            maximum: matches!(axis.kind(), IrAxisKind::Continuous { .. }).then(|| axis.maximum()),
            values: axis.discrete_values().map(<[f64]>::to_vec),
            labels: axis
                .labels()
                .iter()
                .map(|label| AxisLabel {
                    id: label.id(),
                    name: label.name.clone(),
                    value: label.value,
                    minimum: label.range.as_ref().map(|range| range.minimum),
                    maximum: label.range.as_ref().map(|range| range.maximum),
                    linked_value: label.linked_value,
                    elidable: label.elidable,
                })
                .collect(),
            hidden: axis.is_hidden(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Wire projection of an explicit named product preset.
///
/// `location` is complete external authoring state, not a normalized or
/// compiler-owned coordinate record.
pub struct NamedInstance {
    pub id: NamedInstanceId,
    pub name: String,
    pub location: Location,
    pub postscript_name: Option<String>,
}

impl From<&IrNamedInstance> for NamedInstance {
    fn from(instance: &IrNamedInstance) -> Self {
        Self {
            id: instance.id(),
            name: instance.name().to_string(),
            location: instance.location().into(),
            postscript_name: instance.postscript_name().map(str::to_string),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AxisMappingPoint {
    pub description: Option<String>,
    pub input: Location,
    pub output: Location,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AxisMapping {
    pub id: AxisMappingId,
    pub name: String,
    pub description: Option<String>,
    pub inputs: Vec<AxisId>,
    pub outputs: Vec<AxisId>,
    pub points: Vec<AxisMappingPoint>,
}

impl From<&IrAxisMapping> for AxisMapping {
    fn from(mapping: &IrAxisMapping) -> Self {
        Self {
            id: mapping.id(),
            name: mapping.name().to_string(),
            description: mapping.description().map(str::to_string),
            inputs: mapping.inputs().to_vec(),
            outputs: mapping.outputs().to_vec(),
            points: mapping
                .points()
                .iter()
                .map(|point| AxisMappingPoint {
                    description: point.description.clone(),
                    input: (&point.input).into(),
                    output: (&point.output).into(),
                })
                .collect(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub id: SourceId,
    pub name: String,
    pub location: Location,
    pub filename: Option<String>,
    pub metric_values: Vec<SourceMetricValue>,
    pub italic_angle: Option<f64>,
    pub line_gap: Option<f64>,
    pub underline_position: Option<f64>,
    pub underline_thickness: Option<f64>,
}

impl From<&IrSource> for Source {
    fn from(source: &IrSource) -> Self {
        Self {
            id: source.id(),
            name: source.name().to_string(),
            location: source.location().into(),
            filename: source.filename().map(str::to_string),
            metric_values: source
                .metric_values()
                .iter()
                .map(|(metric_id, value)| SourceMetricValue {
                    metric_id: metric_id.clone(),
                    position: value.position,
                    overshoot: value.overshoot,
                })
                .collect(),
            italic_angle: source.italic_angle(),
            line_gap: source.line_gap(),
            underline_position: source.underline_position(),
            underline_thickness: source.underline_thickness(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphRecord {
    pub id: GlyphId,
    pub name: GlyphName,
    pub unicodes: Vec<u32>,
    pub component_base_glyph_ids: Vec<GlyphId>,
    pub layers: Vec<GlyphLayerRecord>,
}

impl From<&IrGlyph> for GlyphRecord {
    fn from(glyph: &IrGlyph) -> Self {
        let mut component_base_glyph_ids: Vec<_> = glyph
            .layers()
            .values()
            .flat_map(|layer| layer.components_iter())
            .map(|component| component.base_glyph_id())
            .collect();
        component_base_glyph_ids.sort();
        component_base_glyph_ids.dedup();
        let mut layers: Vec<_> = glyph
            .layers()
            .values()
            .map(|layer| GlyphLayerRecord::from(layer.as_ref()))
            .collect();
        layers.sort_by(|a, b| {
            a.source_id
                .as_str()
                .cmp(b.source_id.as_str())
                .then_with(|| a.id.as_str().cmp(b.id.as_str()))
        });

        Self {
            id: glyph.id(),
            name: glyph.glyph_name().clone(),
            unicodes: glyph.unicodes().to_vec(),
            component_base_glyph_ids,
            layers,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphLayerRecord {
    pub id: LayerId,
    pub source_id: SourceId,
}

impl From<&GlyphLayer> for GlyphLayerRecord {
    fn from(layer: &GlyphLayer) -> Self {
        Self {
            id: layer.id(),
            source_id: layer.source_id(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphState {
    pub layer_id: LayerId,
    pub structure: GlyphStructure,
    /// Numeric glyph state ordered to match `GlyphStructure`.
    pub values: GlyphValues,
}

impl GlyphState {
    pub fn from_layer(layer: &GlyphLayer) -> Self {
        Self {
            layer_id: layer.id(),
            structure: GlyphStructure::from(layer),
            values: values_from_layer(layer),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphLayerSnapshot {
    pub glyph_id: GlyphId,
    pub source_id: SourceId,
    pub state: GlyphState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphSnapshotRequest {
    pub glyph_id: GlyphId,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphSnapshot {
    pub glyph_id: GlyphId,
    pub projection: Option<GlyphProjection>,
    pub layers: Vec<GlyphLayerSnapshot>,
}

/// One compact glyph layer shape suitable for local projection evaluation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphLayerShape {
    pub structure: GlyphStructure,
    pub values: GlyphValues,
}

impl From<&GlyphLayer> for GlyphLayerShape {
    fn from(layer: &GlyphLayer) -> Self {
        Self {
            structure: GlyphStructure::from(layer),
            values: values_from_layer(layer),
        }
    }
}

/// One axis support within an interpolation coefficient region.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InterpolationSupport {
    pub axis_id: AxisId,
    pub lower: f64,
    pub peak: f64,
    pub upper: f64,
}

/// Coordinate-independent interpolation weights for an ordered source set.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InterpolationBasis {
    pub source_ids: Vec<SourceId>,
    pub regions: Vec<Vec<InterpolationSupport>>,
    pub coefficients: Vec<Vec<f64>>,
}

impl From<&IrInterpolationBasis> for InterpolationBasis {
    fn from(basis: &IrInterpolationBasis) -> Self {
        Self {
            source_ids: basis.source_ids().to_vec(),
            regions: basis
                .regions()
                .iter()
                .map(|region| {
                    region
                        .supports()
                        .iter()
                        .map(|support| InterpolationSupport {
                            axis_id: support.axis_id(),
                            lower: support.minimum(),
                            peak: support.peak(),
                            upper: support.maximum(),
                        })
                        .collect()
                })
                .collect(),
            coefficients: basis.coefficients().to_vec(),
        }
    }
}

/// Initial numeric values for one compatible glyph source.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphSourceValues {
    pub source_id: SourceId,
    pub values: GlyphValues,
}

/// Compatible glyph interpolation over a shared structural fallback.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphInterpolation {
    pub basis: InterpolationBasis,
    pub sources: Vec<GlyphSourceValues>,
}

impl From<&IrGlyphInterpolation> for GlyphInterpolation {
    fn from(interpolation: &IrGlyphInterpolation) -> Self {
        Self {
            basis: interpolation.basis().into(),
            sources: interpolation
                .sources()
                .iter()
                .map(|source| GlyphSourceValues {
                    source_id: source.source_id(),
                    values: source.values().as_slice().to_vec(),
                })
                .collect(),
        }
    }
}

/// Exact authored source shape not represented by compatible interpolation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphSourceShape {
    pub source_id: SourceId,
    pub shape: GlyphLayerShape,
}

/// One anchor occurrence selected by Rust component semantics.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentAnchorReference {
    pub component_path: Vec<ComponentId>,
    pub glyph_id: GlyphId,
    pub anchor_id: AnchorId,
}

impl From<&IrComponentAnchorReference> for ComponentAnchorReference {
    fn from(anchor: &IrComponentAnchorReference) -> Self {
        Self {
            component_path: anchor.component_path().as_slice().to_vec(),
            glyph_id: anchor.glyph_id(),
            anchor_id: anchor.anchor_id(),
        }
    }
}

/// Rust-selected source and target anchors for one component attachment.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentAnchorAttachment {
    pub source: ComponentAnchorReference,
    pub target: ComponentAnchorReference,
}

/// One ordered, cycle-pruned component occurrence.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentGlyph {
    pub parent_glyph_id: GlyphId,
    pub component_id: ComponentId,
    pub base_glyph_id: GlyphId,
    pub parent_path: Vec<ComponentId>,
    pub component_path: Vec<ComponentId>,
    pub attachment: Option<ComponentAnchorAttachment>,
}

impl From<&IrComponentGlyph> for ComponentGlyph {
    fn from(component: &IrComponentGlyph) -> Self {
        Self {
            parent_glyph_id: component.parent_glyph_id(),
            component_id: component.component_id(),
            base_glyph_id: component.base_glyph_id(),
            parent_path: component.parent_path().as_slice().to_vec(),
            component_path: component.component_path().as_slice().to_vec(),
            attachment: component
                .attachment()
                .map(|attachment| ComponentAnchorAttachment {
                    source: attachment.source().into(),
                    target: attachment.target().into(),
                }),
        }
    }
}

/// Ordered component relationships for one resolved root glyph.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphComponents {
    pub root_glyph_id: GlyphId,
    pub components: Vec<ComponentGlyph>,
}

impl From<&IrGlyphComponents> for GlyphComponents {
    fn from(components: &IrGlyphComponents) -> Self {
        Self {
            root_glyph_id: components.root_glyph_id(),
            components: components.components().iter().map(Into::into).collect(),
        }
    }
}

/// Exact-source component relationships that differ from the default shape.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphSourceComponents {
    pub source_id: SourceId,
    pub components: GlyphComponents,
}

impl From<&IrGlyphSourceComponents> for GlyphSourceComponents {
    fn from(source: &IrGlyphSourceComponents) -> Self {
        Self {
            source_id: source.source_id(),
            components: source.components().into(),
        }
    }
}

/// Location-independent glyph payload evaluated synchronously by renderers.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphProjection {
    pub glyph_id: GlyphId,
    pub fallback: GlyphLayerShape,
    pub interpolation: Option<GlyphInterpolation>,
    pub exact_source_shapes: Vec<GlyphSourceShape>,
    pub components: GlyphComponents,
    pub exact_source_components: Vec<GlyphSourceComponents>,
    pub component_glyph_ids: Vec<GlyphId>,
}

impl From<&IrGlyphProjection> for GlyphProjection {
    fn from(projection: &IrGlyphProjection) -> Self {
        Self {
            glyph_id: projection.glyph_id(),
            fallback: GlyphLayerShape::from(projection.fallback()),
            interpolation: projection.interpolation().map(Into::into),
            exact_source_shapes: projection
                .exact_source_shapes()
                .iter()
                .map(|source_shape| GlyphSourceShape {
                    source_id: source_shape.source_id(),
                    shape: GlyphLayerShape::from(source_shape.layer()),
                })
                .collect(),
            components: projection.components().into(),
            exact_source_components: projection
                .exact_source_components()
                .iter()
                .map(Into::into)
                .collect(),
            component_glyph_ids: projection.component_glyph_ids().to_vec(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphStructure {
    pub contours: Vec<ContourData>,
    pub anchors: Vec<AnchorData>,
    pub components: Vec<ComponentData>,
}

impl From<&GlyphLayer> for GlyphStructure {
    fn from(layer: &GlyphLayer) -> Self {
        Self {
            contours: layer.contours_iter().map(ContourData::from).collect(),
            anchors: layer.anchors_iter().map(AnchorData::from).collect(),
            components: layer.components_iter().map(ComponentData::from).collect(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContourData {
    pub id: String,
    pub points: Vec<PointData>,
    pub closed: bool,
}

impl From<&IrContour> for ContourData {
    fn from(contour: &IrContour) -> Self {
        Self {
            id: contour.id().to_string(),
            points: contour.points().iter().map(PointData::from).collect(),
            closed: contour.is_closed(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PointData {
    pub id: String,
    pub point_type: PointType,
    pub smooth: bool,
}

impl From<&IrPoint> for PointData {
    fn from(point: &IrPoint) -> Self {
        Self {
            id: point.id().to_string(),
            point_type: point.point_type().into(),
            smooth: point.is_smooth(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PointType {
    OnCurve,
    OffCurve,
}

impl From<IrPointType> for PointType {
    fn from(point_type: IrPointType) -> Self {
        match point_type {
            IrPointType::OnCurve | IrPointType::QCurve => Self::OnCurve,
            IrPointType::OffCurve => Self::OffCurve,
        }
    }
}

impl From<PointType> for IrPointType {
    fn from(point_type: PointType) -> Self {
        match point_type {
            PointType::OffCurve => IrPointType::OffCurve,
            PointType::OnCurve => IrPointType::OnCurve,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnchorData {
    pub id: String,
    pub name: Option<String>,
}

impl From<&IrAnchor> for AnchorData {
    fn from(anchor: &IrAnchor) -> Self {
        Self {
            id: anchor.id().to_string(),
            name: anchor.name().map(str::to_owned),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentData {
    pub id: String,
    pub base_glyph_id: GlyphId,
    pub base_glyph_name: GlyphName,
}

impl From<&IrComponent> for ComponentData {
    fn from(component: &IrComponent) -> Self {
        Self {
            id: component.id().to_string(),
            base_glyph_id: component.base_glyph_id(),
            base_glyph_name: component.base_glyph_name().clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GlyphChangedEntities {
    pub point_ids: Vec<PointId>,
    pub contour_ids: Vec<ContourId>,
    pub anchor_ids: Vec<AnchorId>,
    pub guideline_ids: Vec<GuidelineId>,
    pub component_ids: Vec<ComponentId>,
}

impl GlyphChangedEntities {
    pub fn point(id: PointId) -> Self {
        Self {
            point_ids: vec![id],
            ..Default::default()
        }
    }

    pub fn points(ids: Vec<PointId>) -> Self {
        Self {
            point_ids: ids,
            ..Default::default()
        }
    }

    pub fn contour(id: ContourId) -> Self {
        Self {
            contour_ids: vec![id],
            ..Default::default()
        }
    }

    pub fn contours(ids: Vec<ContourId>) -> Self {
        Self {
            contour_ids: ids,
            ..Default::default()
        }
    }

    pub fn anchor(id: AnchorId) -> Self {
        Self {
            anchor_ids: vec![id],
            ..Default::default()
        }
    }

    pub fn guideline(id: GuidelineId) -> Self {
        Self {
            guideline_ids: vec![id],
            ..Default::default()
        }
    }

    pub fn component(id: ComponentId) -> Self {
        Self {
            component_ids: vec![id],
            ..Default::default()
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Location {
    pub values: HashMap<AxisId, f64>,
}

impl From<&IrLocation> for Location {
    fn from(location: &IrLocation) -> Self {
        Self {
            values: location
                .iter()
                .map(|(axis_id, value)| (axis_id.clone(), *value))
                .collect(),
        }
    }
}

/// Optional source-level numeric fields appended after authored metric rows.
#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SourceMetricField {
    ItalicAngle,
    LineGap,
    UnderlinePosition,
    UnderlineThickness,
}

/// Initial metric values for one authored source.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceMetricValues {
    pub source_id: SourceId,
    pub values: Vec<f64>,
}

/// Location-independent interpolation model for source-owned font metrics.
///
/// Each source vector stores `position, overshoot` for every `metric_ids`
/// entry, followed by one value for every `technical_fields` entry. A
/// technical field is included only when every master source authors it, so
/// interpolation never invents values for a sparse optional field.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceMetricsInterpolationSnapshot {
    pub metric_ids: Vec<MetricId>,
    pub technical_fields: Vec<SourceMetricField>,
    pub basis: InterpolationBasis,
    pub sources: Vec<SourceMetricValues>,
}

impl From<&IrSourceMetricInterpolation> for SourceMetricsInterpolationSnapshot {
    fn from(interpolation: &IrSourceMetricInterpolation) -> Self {
        Self {
            metric_ids: interpolation.metric_ids().to_vec(),
            technical_fields: interpolation
                .technical_fields()
                .iter()
                .copied()
                .map(SourceMetricField::from)
                .collect(),
            basis: interpolation.basis().into(),
            sources: interpolation
                .sources()
                .iter()
                .map(|source| SourceMetricValues {
                    source_id: source.source_id(),
                    values: source.as_slice().to_vec(),
                })
                .collect(),
        }
    }
}

impl From<IrSourceMetricField> for SourceMetricField {
    fn from(field: IrSourceMetricField) -> Self {
        match field {
            IrSourceMetricField::ItalicAngle => Self::ItalicAngle,
            IrSourceMetricField::LineGap => Self::LineGap,
            IrSourceMetricField::UnderlinePosition => Self::UnderlinePosition,
            IrSourceMetricField::UnderlineThickness => Self::UnderlineThickness,
        }
    }
}

/// Flatten mutable numeric glyph state in the order described by `GlyphState::values`.
pub fn values_from_layer(layer: &GlyphLayer) -> GlyphValues {
    layer.interpolation_values().into_vec()
}
