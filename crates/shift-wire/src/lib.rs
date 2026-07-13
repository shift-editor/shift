//! document state types shared by edit logic and bridge bindings.
//!
//! These types split stable glyph structure from mutable numeric values. The
//! values layout is canonical and must stay in lockstep with every consumer.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use shift_font::{
    Anchor as IrAnchor, AnchorId, Axis as IrAxis, AxisId, AxisKind as IrAxisKind,
    AxisMapping as IrAxisMapping, AxisMappingId, AxisRole as IrAxisRole, Component as IrComponent,
    ComponentId, Contour as IrContour, ContourId, DecomposedTransform as IrTransform,
    FontMetadata as IrFontMetadata, FontMetrics as IrFontMetrics, Glyph as IrGlyph, GlyphId,
    GlyphLayer, GlyphName, GuidelineId, LayerId, Location as IrLocation, Point as IrPoint, PointId,
    PointType as IrPointType, Source as IrSource, SourceId,
};

pub mod bridges;
pub mod interpolation;
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
    pub ascender: f64,
    pub descender: f64,
    pub cap_height: Option<f64>,
    pub x_height: Option<f64>,
    pub line_gap: Option<f64>,
    pub italic_angle: Option<f64>,
    pub underline_position: Option<f64>,
    pub underline_thickness: Option<f64>,
}

impl From<&IrFontMetrics> for FontMetrics {
    fn from(metrics: &IrFontMetrics) -> Self {
        Self {
            units_per_em: metrics.units_per_em,
            ascender: metrics.ascender,
            descender: metrics.descender,
            cap_height: metrics.cap_height,
            x_height: metrics.x_height,
            line_gap: metrics.line_gap,
            italic_angle: metrics.italic_angle,
            underline_position: metrics.underline_position,
            underline_thickness: metrics.underline_thickness,
        }
    }
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
pub struct AxisLabel {
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
}

impl From<&IrSource> for Source {
    fn from(source: &IrSource) -> Self {
        Self {
            id: source.id(),
            name: source.name().to_string(),
            location: source.location().into(),
            filename: source.filename().map(str::to_string),
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
    pub variation_data: Option<GlyphVariationData>,
    pub layers: Vec<GlyphLayerSnapshot>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AxisTent {
    pub axis_tag: String,
    pub lower: f64,
    pub peak: f64,
    pub upper: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphVariationData {
    /// One entry per region. Inner = tents on the axes the region depends on.
    pub regions: Vec<Vec<AxisTent>>,
    /// Deltas are flattened in `GlyphState::values` order.
    pub deltas: Vec<Vec<f64>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphMaster {
    pub source_id: String,
    pub source_name: String,
    pub is_default_source: bool,
    pub location: Location,
    pub structure: GlyphStructure,
    pub values: GlyphValues,
}

/// Flatten mutable numeric glyph state in the order described by `GlyphState::values`.
pub fn values_from_layer(layer: &GlyphLayer) -> GlyphValues {
    let mut values = Vec::new();
    values.push(layer.width());

    for contour in layer.contours_iter() {
        for point in contour.points() {
            values.push(point.x());
            values.push(point.y());
        }
    }

    for anchor in layer.anchors_iter() {
        values.push(anchor.x());
        values.push(anchor.y());
    }

    for component in layer.components_iter() {
        push_transform_values(&mut values, component.transform());
    }

    values
}

fn push_transform_values(values: &mut Vec<f64>, transform: &IrTransform) {
    values.push(transform.translate_x);
    values.push(transform.translate_y);
    values.push(transform.rotation);
    values.push(transform.scale_x);
    values.push(transform.scale_y);
    values.push(transform.skew_x);
    values.push(transform.skew_y);
    values.push(transform.t_center_x);
    values.push(transform.t_center_y);
}
