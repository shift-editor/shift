use napi::bindgen_prelude::Float64Array;
use napi_derive::napi;
use shift_font::{
    ComponentAlignment, GlyphId, Transform,
    composite::{
        ResolvedComponentGeometry, ResolvedContour, ResolvedLayerGeometry, resolved_contours_bbox,
        resolved_contours_to_svg_path,
    },
};

use crate::intents;
use crate::{
    AnchorData, AnchorMatch, Axis, AxisLabel, AxisMapping, AxisMappingBasis, AxisMappingPoint,
    ComponentData, ComponentGlyph, ComponentMatch, ComponentTransformKind, ContourData,
    ContourMatch, DesignNormalization, FontMetadata, FontMetrics, FontSnapshot,
    GlyphChangedEntities, GlyphComponents, GlyphEntry, GlyphInterpolation, GlyphLayerRecord,
    GlyphLayerShape, GlyphLayerSnapshot, GlyphProjection, GlyphRecord, GlyphSnapshot,
    GlyphSnapshotRequest, GlyphSourceComponents, GlyphSourceShape, GlyphSourceValues, GlyphState,
    GlyphStructure, GlyphVariation, InterpolationBasis, InterpolationSupport, KerningGroup,
    KerningPairValue, KerningPosition, KerningSide, KerningSideKind, KerningSnapshot,
    LayerDifference, LayerDifferenceKind, LayerMatch, Location, MetricDefinition, MetricKind,
    NamedInstance, PointData, PointMatch, Source, SourceKerningPairs, SourceMetricField,
    SourceMetricValue, SourceMetricValues, SourceMetricsInterpolationSnapshot, VariationBasis,
    VariationDelta,
};

#[napi(object)]
pub struct NapiSlugSection {
    pub offset: u32,
    pub length: u32,
}

#[napi(object)]
pub struct NapiSlugLayout {
    pub base_curves: NapiSlugSection,
    pub curve_deltas: NapiSlugSection,
    pub sparse_deltas: NapiSlugSection,
    pub glyphs: NapiSlugSection,
    pub sources: NapiSlugSection,
    pub source_advances: NapiSlugSection,
    pub component_glyphs: NapiSlugSection,
    pub component_parts: NapiSlugSection,
    pub components: NapiSlugSection,
    pub component_sources: NapiSlugSection,
    pub line_bits: NapiSlugSection,
    pub total_length: u32,
}

#[napi(object)]
pub struct NapiSlugExactSource {
    #[napi(ts_type = "SourceId")]
    pub source_id: String,
    pub glyph_index: u32,
}

#[napi(object)]
pub struct NapiSlugGlyph {
    #[napi(ts_type = "GlyphId")]
    pub glyph_id: String,
    pub default_glyph: u32,
    pub exact_sources: Vec<NapiSlugExactSource>,
}

#[napi(object)]
pub struct NapiSlugWeightSet {
    pub basis: NapiInterpolationBasis,
    pub source_weight_indices: Vec<u32>,
}

#[napi(object)]
pub struct NapiSlugPreviewExtents {
    pub horizontal: f64,
    pub minimum_y: f64,
    pub maximum_y: f64,
}

#[napi(object)]
pub struct NapiSlugAtlas {
    pub generation: u32,
    pub band_count: u32,
    pub weight_count: u32,
    pub layout: NapiSlugLayout,
    pub preview_extents: NapiSlugPreviewExtents,
    pub glyphs: Vec<NapiSlugGlyph>,
    pub weight_sets: Vec<NapiSlugWeightSet>,
    pub atlas_glyph_count: u32,
    pub curve_count: u32,
    pub component_count: u32,
}

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
pub struct NapiCatalogAtlasGlyph {
    #[napi(ts_type = "GlyphId")]
    pub glyph_id: String,
    pub default_glyph: u32,
    pub exact_sources: Vec<NapiSlugExactSource>,
}

#[napi(object)]
pub struct NapiCatalogAtlasPage {
    pub generation: u32,
    pub page_index: u32,
    pub band_count: u32,
    pub weight_count: u32,
    pub layout: NapiSlugLayout,
    pub preview_extents: NapiSlugPreviewExtents,
    pub glyphs: Vec<NapiCatalogAtlasGlyph>,
    pub weights: Vec<f64>,
    pub atlas_glyph_count: u32,
    pub curve_count: u32,
    pub component_count: u32,
}

#[napi(object)]
pub struct NapiCatalogAtlasWeights {
    pub page_index: u32,
    pub weights: Vec<f64>,
}

impl From<FontMetadata> for intents::FontMetadata {
    fn from(metadata: FontMetadata) -> Self {
        Self {
            family_name: metadata.family_name,
            style_name: metadata.style_name,
            version_major: metadata.version_major,
            version_minor: metadata.version_minor,
            copyright: metadata.copyright,
            trademark: metadata.trademark,
            designer: metadata.designer,
            designer_url: metadata.designer_url,
            manufacturer: metadata.manufacturer,
            manufacturer_url: metadata.manufacturer_url,
            license: metadata.license,
            license_url: metadata.license_url,
            description: metadata.description,
            note: metadata.note,
        }
    }
}

#[napi(object)]
pub struct NapiFontMetrics {
    pub units_per_em: f64,
}

impl From<FontMetrics> for NapiFontMetrics {
    fn from(metrics: FontMetrics) -> Self {
        Self {
            units_per_em: metrics.units_per_em,
        }
    }
}

impl From<Axis> for intents::Axis {
    fn from(axis: Axis) -> Self {
        Self {
            id: axis.id.to_string(),
            tag: axis.tag,
            name: axis.name,
            role: match axis.role.as_str() {
                "internal" => intents::AxisRole::Internal,
                _ => intents::AxisRole::External,
            },
            axis_type: match axis.axis_type.as_str() {
                "discrete" => intents::AxisType::Discrete,
                _ => intents::AxisType::Continuous,
            },
            minimum: axis.minimum,
            default: axis.default,
            maximum: axis.maximum,
            values: axis.values,
            labels: axis.labels.into_each(),
            hidden: axis.hidden,
        }
    }
}

impl From<AxisLabel> for intents::AxisLabel {
    fn from(label: AxisLabel) -> Self {
        Self {
            id: label.id.to_string(),
            name: label.name,
            value: label.value,
            minimum: label.minimum,
            maximum: label.maximum,
            linked_value: label.linked_value,
            elidable: label.elidable,
        }
    }
}

impl From<NamedInstance> for intents::NamedInstance {
    fn from(instance: NamedInstance) -> Self {
        Self {
            id: instance.id.to_string(),
            name: instance.name,
            location: instance.location.into(),
            postscript_name: instance.postscript_name,
        }
    }
}

impl From<AxisMappingPoint> for intents::AxisMappingPoint {
    fn from(point: AxisMappingPoint) -> Self {
        Self {
            description: point.description,
            input: point.input.into(),
            output: point.output.into(),
        }
    }
}

impl From<AxisMapping> for intents::AxisMapping {
    fn from(mapping: AxisMapping) -> Self {
        Self {
            id: mapping.id.to_string(),
            name: mapping.name,
            description: mapping.description,
            inputs: mapping.inputs.into_each(),
            outputs: mapping.outputs.into_each(),
            points: mapping.points.into_each(),
        }
    }
}

#[napi(object)]
pub struct NapiAxisMappingBasis {
    #[napi(ts_type = "AxisMappingId")]
    pub mapping_id: String,
    #[napi(ts_type = "Array<AxisId>")]
    pub input_axis_ids: Vec<String>,
    #[napi(ts_type = "Array<AxisId>")]
    pub output_axis_ids: Vec<String>,
    pub basis: NapiVariationBasis,
}

impl From<AxisMappingBasis> for NapiAxisMappingBasis {
    fn from(basis: AxisMappingBasis) -> Self {
        Self {
            mapping_id: basis.mapping_id.to_string(),
            input_axis_ids: basis.input_axis_ids.into_each(),
            output_axis_ids: basis.output_axis_ids.into_each(),
            basis: basis.basis.into(),
        }
    }
}

#[napi(object)]
pub struct NapiSource {
    #[napi(ts_type = "SourceId")]
    pub id: String,
    pub name: String,
    pub location: intents::Location,
    pub filename: Option<String>,
    pub metric_values: Vec<intents::SourceMetricValue>,
    pub italic_angle: Option<f64>,
    pub line_gap: Option<f64>,
    pub underline_position: Option<f64>,
    pub underline_thickness: Option<f64>,
}

impl From<SourceMetricValue> for intents::SourceMetricValue {
    fn from(value: SourceMetricValue) -> Self {
        Self {
            metric_id: value.metric_id.to_string(),
            position: value.position,
            overshoot: value.overshoot,
        }
    }
}

impl From<MetricDefinition> for intents::MetricDefinition {
    fn from(definition: MetricDefinition) -> Self {
        Self {
            id: definition.id.to_string(),
            kind: match definition.kind {
                MetricKind::Ascender => intents::MetricKind::Ascender,
                MetricKind::CapHeight => intents::MetricKind::CapHeight,
                MetricKind::XHeight => intents::MetricKind::XHeight,
                MetricKind::Baseline => intents::MetricKind::Baseline,
                MetricKind::Descender => intents::MetricKind::Descender,
                MetricKind::Custom => intents::MetricKind::Custom,
            },
            name: definition.name,
        }
    }
}

impl From<Source> for NapiSource {
    fn from(source: Source) -> Self {
        Self {
            id: source.id.to_string(),
            name: source.name,
            location: source.location.into(),
            filename: source.filename,
            metric_values: source.metric_values.into_each(),
            italic_angle: source.italic_angle,
            line_gap: source.line_gap,
            underline_position: source.underline_position,
            underline_thickness: source.underline_thickness,
        }
    }
}

#[napi(object)]
pub struct NapiGlyphRecord {
    #[napi(ts_type = "GlyphId")]
    pub id: String,
    #[napi(ts_type = "GlyphName")]
    pub name: String,
    #[napi(ts_type = "Array<Unicode>")]
    pub unicodes: Vec<u32>,
    #[napi(ts_type = "Array<GlyphId>")]
    pub component_base_glyph_ids: Vec<String>,
    pub layers: Vec<NapiGlyphLayerRecord>,
    /// In the Mark category or classed `mark`: anchor propagation keeps its own anchors.
    pub mark: Option<bool>,
    /// A nonspacing mark (Mark category, Nonspacing subcategory): export
    /// compiles it with no advance. Absent when it is not one.
    pub nonspacing_mark: Option<bool>,
    /// `"explicit"` when classed a ligature, `"subcategory"` when a ligature
    /// once it has an attaching anchor.
    #[napi(ts_type = "\"explicit\" | \"subcategory\"")]
    pub ligature: Option<String>,
}

impl From<GlyphRecord> for NapiGlyphRecord {
    fn from(record: GlyphRecord) -> Self {
        Self {
            id: record.id.to_string(),
            name: record.name.to_string(),
            unicodes: record.unicodes,
            component_base_glyph_ids: record.component_base_glyph_ids.into_each(),
            layers: record.layers.into_each(),
            mark: record.mark.then_some(true),
            nonspacing_mark: record.nonspacing_mark.then_some(true),
            ligature: record.ligature,
        }
    }
}

#[napi(object)]
pub struct NapiGlyphLayerRecord {
    #[napi(ts_type = "LayerId")]
    pub id: String,
    #[napi(ts_type = "SourceId")]
    pub source_id: String,
}

impl From<GlyphLayerRecord> for NapiGlyphLayerRecord {
    fn from(record: GlyphLayerRecord) -> Self {
        Self {
            id: record.id.to_string(),
            source_id: record.source_id.to_string(),
        }
    }
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
    pub reference_point_type: Option<intents::PointType>,
    pub target_point_type: Option<intents::PointType>,
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

#[napi(object)]
pub struct NapiGlyphEntry {
    #[napi(ts_type = "GlyphId")]
    pub id: String,
    pub name: String,
    pub unicodes: Vec<u32>,
}

impl From<GlyphEntry> for NapiGlyphEntry {
    fn from(entry: GlyphEntry) -> Self {
        Self {
            id: entry.id.to_string(),
            name: entry.name.to_string(),
            unicodes: entry.unicodes,
        }
    }
}

#[napi(object)]
pub struct NapiFontSnapshot {
    pub metadata: intents::FontMetadata,
    pub metrics: NapiFontMetrics,
    pub metric_definitions: Vec<intents::MetricDefinition>,
    pub source_metrics_interpolation: Option<NapiSourceMetricsInterpolationSnapshot>,
    pub glyphs: Vec<NapiGlyphEntry>,
    pub sources: Vec<NapiSource>,
    pub axes: Vec<intents::Axis>,
    pub axis_mappings: Vec<intents::AxisMapping>,
    pub axis_mapping_bases: Vec<NapiAxisMappingBasis>,
    pub named_instances: Vec<intents::NamedInstance>,
    /// Tracked Hyperglot language ids; absent when the font stores no list.
    pub language_ids: Option<Vec<String>>,
    pub kerning: NapiKerningSnapshot,
}

impl From<FontSnapshot> for NapiFontSnapshot {
    fn from(snapshot: FontSnapshot) -> Self {
        Self {
            metadata: snapshot.metadata.into(),
            metrics: snapshot.metrics.into(),
            metric_definitions: snapshot.metric_definitions.into_each(),
            source_metrics_interpolation: snapshot.source_metrics_interpolation.map(Into::into),
            glyphs: snapshot.glyphs.into_each(),
            sources: snapshot.sources.into_each(),
            axes: snapshot.axes.into_each(),
            axis_mappings: snapshot.axis_mappings.into_each(),
            axis_mapping_bases: snapshot.axis_mapping_bases.into_each(),
            named_instances: snapshot.named_instances.into_each(),
            language_ids: snapshot.language_ids,
            kerning: snapshot.kerning.into(),
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
    pub point_type: intents::PointType,
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
    /// Placed by its anchors (`anchored`) or by hand (`free`); `unset` or absent
    /// counts as anchored while the component sits exactly on its anchors.
    #[napi(ts_type = "\"anchored\" | \"free\" | \"unset\"")]
    pub alignment: Option<String>,
}

impl From<ComponentData> for NapiComponentData {
    fn from(component: ComponentData) -> Self {
        Self {
            id: component.id,
            base_glyph_id: component.base_glyph_id.to_string(),
            base_glyph_name: component.base_glyph_name.to_string(),
            alignment: Some(alignment_name(component.alignment).to_string()),
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
            alignment: intents::parse_alignment(component.alignment.as_deref()),
        }
    }
}

#[napi(object)]
pub struct NapiGlyphChangedEntities {
    #[napi(ts_type = "Array<PointId>")]
    pub point_ids: Vec<String>,
    #[napi(ts_type = "Array<ContourId>")]
    pub contour_ids: Vec<String>,
    #[napi(ts_type = "Array<AnchorId>")]
    pub anchor_ids: Vec<String>,
    #[napi(ts_type = "Array<GuidelineId>")]
    pub guideline_ids: Vec<String>,
    #[napi(ts_type = "Array<ComponentId>")]
    pub component_ids: Vec<String>,
}

impl From<GlyphChangedEntities> for NapiGlyphChangedEntities {
    fn from(entities: GlyphChangedEntities) -> Self {
        Self {
            point_ids: entities.point_ids.into_each(),
            contour_ids: entities.contour_ids.into_each(),
            anchor_ids: entities.anchor_ids.into_each(),
            guideline_ids: entities.guideline_ids.into_each(),
            component_ids: entities.component_ids.into_each(),
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

impl From<Location> for intents::Location {
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

#[napi(string_enum = "camelCase")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NapiSourceMetricField {
    ItalicAngle,
    LineGap,
    UnderlinePosition,
    UnderlineThickness,
}

impl From<SourceMetricField> for NapiSourceMetricField {
    fn from(field: SourceMetricField) -> Self {
        match field {
            SourceMetricField::ItalicAngle => Self::ItalicAngle,
            SourceMetricField::LineGap => Self::LineGap,
            SourceMetricField::UnderlinePosition => Self::UnderlinePosition,
            SourceMetricField::UnderlineThickness => Self::UnderlineThickness,
        }
    }
}

#[napi(object)]
pub struct NapiSourceMetricValues {
    #[napi(ts_type = "SourceId")]
    pub source_id: String,
    pub values: Float64Array,
}

impl From<SourceMetricValues> for NapiSourceMetricValues {
    fn from(source: SourceMetricValues) -> Self {
        Self {
            source_id: source.source_id.to_string(),
            values: source.values.into(),
        }
    }
}

#[napi(object)]
pub struct NapiSourceMetricsInterpolationSnapshot {
    #[napi(ts_type = "Array<MetricId>")]
    pub metric_ids: Vec<String>,
    pub technical_fields: Vec<NapiSourceMetricField>,
    pub basis: NapiInterpolationBasis,
    pub sources: Vec<NapiSourceMetricValues>,
}

impl From<SourceMetricsInterpolationSnapshot> for NapiSourceMetricsInterpolationSnapshot {
    fn from(snapshot: SourceMetricsInterpolationSnapshot) -> Self {
        Self {
            metric_ids: snapshot.metric_ids.into_each(),
            technical_fields: snapshot.technical_fields.into_each(),
            basis: snapshot.basis.into(),
            sources: snapshot.sources.into_each(),
        }
    }
}

/// Replacement wrapper whose presence distinguishes "unchanged" from a
/// changed font that no longer has a valid source-metric variation model.
#[napi(object)]
pub struct NapiSourceMetricsInterpolationReplacement {
    pub snapshot: Option<NapiSourceMetricsInterpolationSnapshot>,
}
/// Replacement wrapper whose presence distinguishes "unchanged" from a
/// change that removed the tracked language list.
#[napi(object)]
pub struct NapiLanguagesReplacement {
    /// Tracked Hyperglot language ids in authored order; absent when the font
    /// stores no list and callers should apply their own default.
    pub language_ids: Option<Vec<String>>,
}

/// Replace-grade state for one touched layer; the renderer folds by
/// substitution, never by interpreting changes.
#[napi(object)]
pub struct NapiLayerReplaced {
    #[napi(ts_type = "LayerId")]
    pub layer_id: String,
    /// Present only when the layer's structure changed.
    pub structure: Option<NapiGlyphStructure>,
    pub values: Float64Array,
    pub changed: NapiGlyphChangedEntities,
}

/// Selective replacement-grade font collections produced by one apply.
///
/// Every present collection is complete. An absent collection was untouched;
/// it must be retained from the renderer's current workspace snapshot.
#[derive(Default)]
#[napi(object)]
pub struct NapiFontReplacement {
    /// Complete authored metadata when font metadata changed; absent otherwise.
    pub metadata: Option<intents::FontMetadata>,
    /// Full records list when glyph identity changed; absent when untouched.
    pub glyphs: Option<Vec<NapiGlyphRecord>>,
    /// Full axes list when font-level axis structure changed; absent otherwise.
    pub axes: Option<Vec<intents::Axis>>,
    /// Full mapping list when font-level axis mappings changed; absent otherwise.
    pub axis_mappings: Option<Vec<intents::AxisMapping>>,
    /// Rust-compiled mapping bases when axes or mappings changed; absent otherwise.
    pub axis_mapping_bases: Option<Vec<NapiAxisMappingBasis>>,
    /// Full font-owned metric definitions when their identity or order changed.
    pub metric_definitions: Option<Vec<intents::MetricDefinition>>,
    /// Refreshed source-metric interpolation model when any of its inputs changed.
    pub source_metrics_interpolation: Option<NapiSourceMetricsInterpolationReplacement>,
    /// Full authored product-preset list when named instances changed.
    pub named_instances: Option<Vec<intents::NamedInstance>>,
    /// Tracked language list when it changed; absent otherwise.
    pub languages: Option<NapiLanguagesReplacement>,
    /// Full sources list when font-level source structure changed (createAxis
    /// reshapes locations, createSource adds one); absent otherwise.
    pub sources: Option<Vec<NapiSource>>,
    /// Complete kerning when its values or interpolation basis changed.
    pub kerning: Option<NapiKerningSnapshot>,
}

impl NapiFontReplacement {
    /// The shared font-level records with the workspace's glyph records,
    /// present when the edit changed them.
    pub fn new(
        replacement: crate::replacement::FontReplacement,
        glyphs: Option<Vec<NapiGlyphRecord>>,
    ) -> Self {
        Self {
            metadata: replacement.metadata.map(Into::into),
            glyphs,
            axes: replacement.axes.map(IntoEach::into_each),
            axis_mappings: replacement.axis_mappings.map(IntoEach::into_each),
            axis_mapping_bases: replacement.axis_mapping_bases.map(IntoEach::into_each),
            metric_definitions: replacement.metric_definitions.map(IntoEach::into_each),
            source_metrics_interpolation: replacement.source_metrics_interpolation.map(
                |interpolation| NapiSourceMetricsInterpolationReplacement {
                    snapshot: interpolation.snapshot.map(Into::into),
                },
            ),
            named_instances: replacement.named_instances.map(IntoEach::into_each),
            languages: replacement
                .languages
                .map(|languages| NapiLanguagesReplacement {
                    language_ids: languages.language_ids,
                }),
            sources: replacement.sources.map(IntoEach::into_each),
            kerning: replacement.kerning.map(Into::into),
        }
    }
}

/// Pure-state response to `apply`: no change records cross to the renderer.
#[napi(object)]
pub struct NapiAppliedChange {
    pub layers: Vec<NapiLayerReplaced>,
    /// Present when the apply produced any font-level replacement collections.
    pub next: Option<NapiFontReplacement>,
    /// Stable ids: references survive renames without re-indexing.
    #[napi(ts_type = "Array<GlyphId>")]
    pub dependents: Vec<String>,
}

impl From<KerningPosition> for intents::KerningPosition {
    fn from(position: KerningPosition) -> Self {
        match position {
            KerningPosition::First => Self::First,
            KerningPosition::Second => Self::Second,
        }
    }
}

impl From<KerningSide> for intents::KerningSide {
    fn from(side: KerningSide) -> Self {
        Self {
            kind: match side.kind {
                KerningSideKind::Glyph => intents::KerningSideKind::Glyph,
                KerningSideKind::Group => intents::KerningSideKind::Group,
            },
            id: side.id,
        }
    }
}

#[napi(object)]
pub struct NapiKerningGroup {
    #[napi(ts_type = "KerningGroupId")]
    pub id: String,
    pub position: intents::KerningPosition,
    pub name: String,
    #[napi(ts_type = "Array<GlyphId>")]
    pub glyph_ids: Vec<String>,
}

impl From<KerningGroup> for NapiKerningGroup {
    fn from(group: KerningGroup) -> Self {
        Self {
            id: group.id,
            position: group.position.into(),
            name: group.name,
            glyph_ids: group.glyph_ids.iter().map(ToString::to_string).collect(),
        }
    }
}

#[napi(object)]
pub struct NapiKerningPairValue {
    pub first: intents::KerningSide,
    pub second: intents::KerningSide,
    pub amount: f64,
}

#[napi(object)]
pub struct NapiSourceKerningPairs {
    #[napi(ts_type = "SourceId")]
    pub source_id: String,
    pub pairs: Vec<NapiKerningPairValue>,
}

impl From<SourceKerningPairs> for NapiSourceKerningPairs {
    fn from(source: SourceKerningPairs) -> Self {
        Self {
            source_id: source.source_id.to_string(),
            pairs: source
                .pairs
                .into_iter()
                .map(|pair: KerningPairValue| NapiKerningPairValue {
                    first: pair.first.into(),
                    second: pair.second.into(),
                    amount: pair.amount,
                })
                .collect(),
        }
    }
}

#[napi(object)]
/// Font kerning: groups, per-source pairs, and the interpolation basis over
/// the default source and every master with pairs (absent for static fonts).
pub struct NapiKerningSnapshot {
    pub groups: Vec<NapiKerningGroup>,
    pub sources: Vec<NapiSourceKerningPairs>,
    pub basis: Option<NapiInterpolationBasis>,
}

impl From<KerningSnapshot> for NapiKerningSnapshot {
    fn from(kerning: KerningSnapshot) -> Self {
        Self {
            groups: kerning.groups.into_each(),
            sources: kerning.sources.into_each(),
            basis: kerning.basis.map(Into::into),
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
