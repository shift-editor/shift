//! document state types shared by edit logic and bridge bindings.
//!
//! These types split stable glyph structure from mutable numeric values. The
//! values layout is canonical and must stay in lockstep with every consumer.

// Library code returns errors instead of panicking: a panic kills the
// WebAssembly engine. Tests may unwrap (clippy.toml).
#![warn(clippy::unwrap_used, clippy::print_stdout)]

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use shift_font::composite::{
    ComponentGlyph as IrComponentGlyph, GlyphComponents as IrGlyphComponents,
};
use shift_font::{
    Anchor as IrAnchor, AnchorId, AxisId, AxisMapping as IrAxisMapping,
    AxisMappingBasis as IrAxisMappingBasis, AxisMappingId, Component as IrComponent,
    ComponentAlignment, ComponentId, Contour as IrContour, ContourId, Font as IrFont,
    FontMetadata as IrFontMetadata, FontMetrics as IrFontMetrics, GlyphId,
    GlyphInterpolation as IrGlyphInterpolation, GlyphLayer, GlyphName,
    GlyphProjection as IrGlyphProjection, GlyphSourceComponents as IrGlyphSourceComponents,
    GuidelineId, InterpolationBasis as IrInterpolationBasis, KerningPosition as IrKerningPosition,
    LayerId, Location as IrLocation, MetricDefinition as IrMetricDefinition, MetricId,
    MetricKind as IrMetricKind, NamedInstance as IrNamedInstance, NamedInstanceId,
    Point as IrPoint, PointId, PointType as IrPointType, SourceId,
    SourceMetricField as IrSourceMetricField,
    SourceMetricInterpolation as IrSourceMetricInterpolation, VariationBasis as IrVariationBasis,
};

pub mod bridges;
pub mod replacement;
pub mod state;
pub mod values;

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

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
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
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct FontMetrics {
    pub units_per_em: f64,
}

impl Default for FontMetrics {
    /// A new font's em.
    fn default() -> Self {
        Self {
            units_per_em: shift_font::FontMetrics::default().units_per_em,
        }
    }
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
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct MetricDefinition {
    pub id: MetricId,
    pub kind: MetricKind,
    pub name: String,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub enum MetricKind {
    Ascender,
    CapHeight,
    XHeight,
    Baseline,
    Descender,
    Custom,
}

impl From<IrMetricKind> for MetricKind {
    fn from(kind: IrMetricKind) -> Self {
        match kind {
            IrMetricKind::Ascender => Self::Ascender,
            IrMetricKind::CapHeight => Self::CapHeight,
            IrMetricKind::XHeight => Self::XHeight,
            IrMetricKind::Baseline => Self::Baseline,
            IrMetricKind::Descender => Self::Descender,
            IrMetricKind::Custom => Self::Custom,
        }
    }
}

impl From<&IrMetricDefinition> for MetricDefinition {
    fn from(definition: &IrMetricDefinition) -> Self {
        Self {
            id: definition.id(),
            kind: definition.kind().into(),
            name: definition.name().to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Wire projection of an explicit named product preset.
///
/// `location` is complete external authoring state, not a normalized or
/// compiler-owned coordinate record.
#[cfg_attr(feature = "pack", derive(pack::Pack))]
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
            location: instance.location().as_untyped().into(),
            postscript_name: instance.postscript_name().map(str::to_string),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct AxisMappingPoint {
    pub description: Option<String>,
    pub input: Location,
    pub output: Location,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
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

/// Fontdrasil-compiled contribution basis for one authored axis mapping.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct AxisMappingBasis {
    pub mapping_id: AxisMappingId,
    pub input_axis_ids: Vec<AxisId>,
    pub output_axis_ids: Vec<AxisId>,
    pub basis: VariationBasis,
}

impl From<&IrAxisMappingBasis> for AxisMappingBasis {
    fn from(basis: &IrAxisMappingBasis) -> Self {
        Self {
            mapping_id: basis.mapping_id(),
            input_axis_ids: basis.input_axis_ids().to_vec(),
            output_axis_ids: basis.output_axis_ids().to_vec(),
            basis: basis.basis().into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct GlyphState {
    pub layer_id: LayerId,
    pub structure: GlyphStructure,
    /// Numeric glyph state ordered to match `GlyphStructure`.
    #[cfg_attr(feature = "pack", pack(numbers))]
    pub values: Vec<f64>,
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
#[cfg_attr(feature = "pack", derive(pack::Pack))]
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
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct GlyphSnapshot {
    pub glyph_id: GlyphId,
    pub projection: Option<GlyphProjection>,
    pub layers: Vec<GlyphLayerSnapshot>,
}

/// Lightweight glyph identity present before geometry is acquired.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct GlyphEntry {
    pub id: GlyphId,
    pub name: GlyphName,
    pub unicodes: Vec<u32>,
}

/// Source-neutral font state required to construct the renderer model.
///
/// The default is an empty font with a new font's em, which a preview fills
/// from its source's directory and leaves without a lib or kerning.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct FontSnapshot {
    pub metadata: FontMetadata,
    pub metrics: FontMetrics,
    pub metric_definitions: Vec<MetricDefinition>,
    pub source_metrics_interpolation: Option<SourceMetricsInterpolationSnapshot>,
    pub glyphs: Vec<GlyphEntry>,
    pub sources: Vec<shift_font::Source>,
    pub axes: Vec<shift_font::Axis>,
    pub axis_mappings: Vec<AxisMapping>,
    pub axis_mapping_bases: Vec<AxisMappingBasis>,
    pub named_instances: Vec<NamedInstance>,
    /// Tracked Hyperglot language ids; `None` when the font stores no list.
    pub language_ids: Option<Vec<String>>,
    pub kerning: KerningSnapshot,
}

/// Numeric encoding used for component transforms in one projection shape.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub enum ComponentTransformKind {
    Decomposed,
    Affine,
}

/// One compact glyph layer shape suitable for local projection evaluation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct GlyphLayerShape {
    pub structure: GlyphStructure,
    #[cfg_attr(feature = "pack", pack(numbers))]
    pub values: Vec<f64>,
    pub component_transform_kind: ComponentTransformKind,
}

impl From<&GlyphLayer> for GlyphLayerShape {
    fn from(layer: &GlyphLayer) -> Self {
        Self {
            structure: GlyphStructure::from(layer),
            values: values_from_layer(layer),
            component_transform_kind: ComponentTransformKind::Decomposed,
        }
    }
}

/// One axis support within an interpolation coefficient region.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct InterpolationSupport {
    pub axis_id: AxisId,
    pub lower: f64,
    pub peak: f64,
    pub upper: f64,
}

/// One normalized support and numeric contribution vector.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct VariationDelta {
    pub region: Vec<InterpolationSupport>,
    #[cfg_attr(feature = "pack", pack(numbers))]
    pub values: Vec<f64>,
}

/// Fontdrasil-compiled supports and numeric contributions.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct VariationBasis {
    pub deltas: Vec<VariationDelta>,
}

impl From<&IrVariationBasis> for VariationBasis {
    fn from(basis: &IrVariationBasis) -> Self {
        Self {
            deltas: basis
                .deltas()
                .iter()
                .map(|delta| VariationDelta {
                    region: delta
                        .region()
                        .supports()
                        .iter()
                        .map(|support| InterpolationSupport {
                            axis_id: support.axis_id(),
                            lower: support.minimum(),
                            peak: support.peak(),
                            upper: support.maximum(),
                        })
                        .collect(),
                    values: delta.values().to_vec(),
                })
                .collect(),
        }
    }
}

/// Design-space normalization transported without authoring-axis metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct DesignNormalization {
    pub axis_id: AxisId,
    pub minimum: f64,
    pub default: f64,
    pub maximum: f64,
}

impl From<&shift_font::DesignNormalization> for DesignNormalization {
    fn from(normalization: &shift_font::DesignNormalization) -> Self {
        Self {
            axis_id: normalization.axis_id,
            minimum: normalization.minimum,
            default: normalization.default,
            maximum: normalization.maximum,
        }
    }
}

/// Coordinate-independent interpolation weights for an ordered source set.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct InterpolationBasis {
    pub source_ids: Vec<SourceId>,
    pub basis: VariationBasis,
    pub design_normalization: Vec<DesignNormalization>,
}

impl From<&IrInterpolationBasis> for InterpolationBasis {
    fn from(basis: &IrInterpolationBasis) -> Self {
        Self {
            source_ids: basis.source_ids().to_vec(),
            basis: basis.variation_basis().into(),
            design_normalization: basis
                .design_normalization()
                .iter()
                .map(Into::into)
                .collect(),
        }
    }
}

/// Initial numeric values for one compatible glyph source.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct GlyphSourceValues {
    pub source_id: SourceId,
    #[cfg_attr(feature = "pack", pack(numbers))]
    pub values: Vec<f64>,
}

/// Compatible glyph interpolation over a shared structural fallback.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct GlyphInterpolation {
    pub basis: InterpolationBasis,
    pub sources: Vec<GlyphSourceValues>,
}

/// Compiled numeric variation for a passive imported glyph shape.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct GlyphVariation {
    pub basis: VariationBasis,
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
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct GlyphSourceShape {
    pub source_id: SourceId,
    pub shape: GlyphLayerShape,
}

/// One ordered, cycle-pruned component occurrence.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct ComponentGlyph {
    pub parent_glyph_id: GlyphId,
    pub component_id: ComponentId,
    pub component_index: usize,
    pub base_glyph_id: GlyphId,
    pub parent_path: Vec<ComponentId>,
    pub component_path: Vec<ComponentId>,
}

impl From<&IrComponentGlyph> for ComponentGlyph {
    fn from(component: &IrComponentGlyph) -> Self {
        Self {
            parent_glyph_id: component.parent_glyph_id(),
            component_id: component.component_id(),
            component_index: component.component_index(),
            base_glyph_id: component.base_glyph_id(),
            parent_path: component.parent_path().as_slice().to_vec(),
            component_path: component.component_path().as_slice().to_vec(),
        }
    }
}

/// Ordered component relationships for one resolved root glyph.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
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
#[cfg_attr(feature = "pack", derive(pack::Pack))]
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
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct GlyphProjection {
    pub glyph_id: GlyphId,
    pub fallback: GlyphLayerShape,
    pub interpolation: Option<GlyphInterpolation>,
    /// Basis over the glyph's and its components' masters, present when
    /// compiled fonts interpolate the glyph decomposed.
    pub decomposition: Option<InterpolationBasis>,
    pub variation: Option<GlyphVariation>,
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
            decomposition: projection.decomposition().map(Into::into),
            variation: None,
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
#[cfg_attr(feature = "pack", derive(pack::Pack))]
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
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct ContourData {
    #[cfg_attr(feature = "pack", pack(id = "ContourId"))]
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
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct PointData {
    #[cfg_attr(feature = "pack", pack(id = "PointId"))]
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
#[allow(
    clippy::enum_variant_names,
    reason = "the font-format names for point types"
)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub enum PointType {
    OnCurve,
    OffCurve,
    QCurve,
}

impl From<IrPointType> for PointType {
    fn from(point_type: IrPointType) -> Self {
        match point_type {
            IrPointType::OnCurve => Self::OnCurve,
            IrPointType::OffCurve => Self::OffCurve,
            IrPointType::QCurve => Self::QCurve,
        }
    }
}

impl From<PointType> for IrPointType {
    fn from(point_type: PointType) -> Self {
        match point_type {
            PointType::OnCurve => Self::OnCurve,
            PointType::OffCurve => Self::OffCurve,
            PointType::QCurve => Self::QCurve,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct AnchorData {
    #[cfg_attr(feature = "pack", pack(id = "AnchorId"))]
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
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct ComponentData {
    #[cfg_attr(feature = "pack", pack(id = "ComponentId"))]
    pub id: String,
    pub base_glyph_id: GlyphId,
    pub base_glyph_name: GlyphName,
    /// Whether the component is placed by its anchors or by hand.
    #[serde(default)]
    pub alignment: ComponentAlignment,
}

impl From<&IrComponent> for ComponentData {
    fn from(component: &IrComponent) -> Self {
        Self {
            id: component.id().to_string(),
            base_glyph_id: component.base_glyph_id(),
            base_glyph_name: component.base_glyph_name().clone(),
            alignment: component.alignment(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
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
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct Location {
    pub values: HashMap<AxisId, f64>,
}

impl From<&IrLocation> for Location {
    fn from(location: &IrLocation) -> Self {
        Self {
            values: location
                .iter()
                .map(|(axis_id, value)| (*axis_id, *value))
                .collect(),
        }
    }
}

/// Optional source-level numeric fields appended after authored metric rows.
#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub enum SourceMetricField {
    ItalicAngle,
    LineGap,
    UnderlinePosition,
    UnderlineThickness,
}

/// Initial metric values for one authored source.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct SourceMetricValues {
    pub source_id: SourceId,
    #[cfg_attr(feature = "pack", pack(numbers))]
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
#[cfg_attr(feature = "pack", derive(pack::Pack))]
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

/// Pair position a kerning group applies to: `First` kerns a glyph's right
/// edge, `Second` its left edge.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub enum KerningPosition {
    First,
    Second,
}

impl From<IrKerningPosition> for KerningPosition {
    fn from(position: IrKerningPosition) -> Self {
        match position {
            IrKerningPosition::First => Self::First,
            IrKerningPosition::Second => Self::Second,
        }
    }
}

/// One kerning group and its members in authored order.
///
/// Pairs reference the group by `id`; `name` is its label, unique at its position.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct KerningGroup {
    #[cfg_attr(feature = "pack", pack(id = "KerningGroupId"))]
    pub id: String,
    pub position: KerningPosition,
    pub name: String,
    pub glyph_ids: Vec<GlyphId>,
}

/// One authored pair and its adjustment in font units.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct KerningPairValue {
    pub first: shift_font::KerningSide,
    pub second: shift_font::KerningSide,
    pub amount: f64,
}

/// The pairs one source authors.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct SourceKerningPairs {
    pub source_id: SourceId,
    pub pairs: Vec<KerningPairValue>,
}

/// Font kerning for the renderer: groups, per-source pairs, and the basis
/// kerning interpolates over.
///
/// `basis` is absent for a static font. Group members and pair sides may name
/// glyphs or sources that are not in the font; they never resolve.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct KerningSnapshot {
    pub groups: Vec<KerningGroup>,
    pub sources: Vec<SourceKerningPairs>,
    pub basis: Option<InterpolationBasis>,
}

impl From<&IrFont> for KerningSnapshot {
    fn from(font: &IrFont) -> Self {
        let kerning = font.kerning();
        let groups = [IrKerningPosition::First, IrKerningPosition::Second]
            .into_iter()
            .flat_map(|position| {
                kerning
                    .groups(position)
                    .map(|(group_id, group)| KerningGroup {
                        id: group_id.to_string(),
                        position: group.position.into(),
                        name: group.name.clone(),
                        glyph_ids: group.members.clone(),
                    })
            })
            .collect();
        let sources = kerning
            .sources()
            .map(|(source_id, pairs)| SourceKerningPairs {
                source_id: *source_id,
                pairs: pairs
                    .pairs()
                    .map(|(pair, amount)| KerningPairValue {
                        first: pair.first.clone(),
                        second: pair.second.clone(),
                        amount,
                    })
                    .collect(),
            })
            .collect();
        Self {
            groups,
            sources,
            basis: font
                .kerning_interpolation_basis()
                .as_ref()
                .map(InterpolationBasis::from),
        }
    }
}

/// Flatten mutable numeric glyph state in the order described by `GlyphState::values`.
pub fn values_from_layer(layer: &GlyphLayer) -> GlyphValues {
    layer.interpolation_values().into_vec()
}
