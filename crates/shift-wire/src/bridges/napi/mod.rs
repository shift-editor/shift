use std::collections::HashMap;

use napi::bindgen_prelude::Float64Array;
use napi_derive::napi;
use shift_font::PointType as IrPointType;

use crate::{
    AnchorData, Axis, AxisTent, ComponentData, ContourData, FontMetadata, FontMetrics,
    GlyphChangedEntities, GlyphMaster, GlyphRecord, GlyphState, GlyphStructure,
    GlyphStructureChange, GlyphValueChange, GlyphVariationData, Location, PointData, PointType,
    Source,
};

#[napi(string_enum = "camelCase")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NapiPointType {
    OnCurve,
    OffCurve,
}

impl From<PointType> for NapiPointType {
    fn from(point_type: PointType) -> Self {
        match point_type {
            PointType::OnCurve => Self::OnCurve,
            PointType::OffCurve => Self::OffCurve,
        }
    }
}

impl From<NapiPointType> for PointType {
    fn from(point_type: NapiPointType) -> Self {
        match point_type {
            NapiPointType::OnCurve => Self::OnCurve,
            NapiPointType::OffCurve => Self::OffCurve,
        }
    }
}

impl From<NapiPointType> for IrPointType {
    fn from(point_type: NapiPointType) -> Self {
        let point_type: PointType = point_type.into();
        point_type.into()
    }
}

#[napi(object)]
pub struct NapiFontMetadata {
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

impl From<FontMetadata> for NapiFontMetadata {
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
    pub ascender: f64,
    pub descender: f64,
    pub cap_height: Option<f64>,
    pub x_height: Option<f64>,
    pub line_gap: Option<f64>,
    pub italic_angle: Option<f64>,
    pub underline_position: Option<f64>,
    pub underline_thickness: Option<f64>,
}

impl From<FontMetrics> for NapiFontMetrics {
    fn from(metrics: FontMetrics) -> Self {
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

#[napi(object)]
pub struct NapiAxis {
    pub tag: String,
    pub name: String,
    pub minimum: f64,
    pub default: f64,
    pub maximum: f64,
    pub hidden: bool,
}

impl From<Axis> for NapiAxis {
    fn from(axis: Axis) -> Self {
        Self {
            tag: axis.tag,
            name: axis.name,
            minimum: axis.minimum,
            default: axis.default,
            maximum: axis.maximum,
            hidden: axis.hidden,
        }
    }
}

#[napi(object)]
pub struct NapiSource {
    #[napi(ts_type = "SourceId")]
    pub id: String,
    pub name: String,
    pub location: NapiLocation,
    #[napi(ts_type = "LayerId")]
    pub layer_id: String,
    pub filename: Option<String>,
}

impl From<Source> for NapiSource {
    fn from(source: Source) -> Self {
        Self {
            id: source.id.to_string(),
            name: source.name,
            location: source.location.into(),
            layer_id: source.layer_id.to_string(),
            filename: source.filename,
        }
    }
}

#[napi(object)]
pub struct NapiGlyphRecord {
    #[napi(ts_type = "GlyphName")]
    pub name: String,
    #[napi(ts_type = "Array<Unicode>")]
    pub unicodes: Vec<u32>,
    #[napi(ts_type = "Array<GlyphName>")]
    pub component_base_glyph_names: Vec<String>,
}

impl From<GlyphRecord> for NapiGlyphRecord {
    fn from(record: GlyphRecord) -> Self {
        Self {
            name: record.name.to_string(),
            unicodes: record.unicodes,
            component_base_glyph_names: record
                .component_base_glyph_names
                .into_iter()
                .map(|name| name.to_string())
                .collect(),
        }
    }
}

#[napi(object)]
pub struct NapiGlyphState {
    pub structure: NapiGlyphStructure,
    /// Numeric glyph state ordered to match `GlyphStructure`.
    pub values: Float64Array,
    pub variation_data: Option<NapiGlyphVariationData>,
}

impl From<GlyphState> for NapiGlyphState {
    fn from(state: GlyphState) -> Self {
        Self {
            structure: state.structure.into(),
            values: state.values.into(),
            variation_data: state.variation_data.map(Into::into),
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
            contours: structure.contours.into_iter().map(Into::into).collect(),
            anchors: structure.anchors.into_iter().map(Into::into).collect(),
            components: structure.components.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<NapiGlyphStructure> for GlyphStructure {
    fn from(structure: NapiGlyphStructure) -> Self {
        Self {
            contours: structure.contours.into_iter().map(Into::into).collect(),
            anchors: structure.anchors.into_iter().map(Into::into).collect(),
            components: structure.components.into_iter().map(Into::into).collect(),
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
            points: contour.points.into_iter().map(Into::into).collect(),
            closed: contour.closed,
        }
    }
}

impl From<NapiContourData> for ContourData {
    fn from(contour: NapiContourData) -> Self {
        Self {
            id: contour.id,
            points: contour.points.into_iter().map(Into::into).collect(),
            closed: contour.closed,
        }
    }
}

#[napi(object)]
pub struct NapiPointData {
    #[napi(ts_type = "PointId")]
    pub id: String,
    pub point_type: NapiPointType,
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
    #[napi(ts_type = "GlyphName")]
    pub base_glyph_name: String,
}

impl From<ComponentData> for NapiComponentData {
    fn from(component: ComponentData) -> Self {
        Self {
            id: component.id,
            base_glyph_name: component.base_glyph_name.to_string(),
        }
    }
}

impl From<NapiComponentData> for ComponentData {
    fn from(component: NapiComponentData) -> Self {
        Self {
            id: component.id,
            base_glyph_name: component.base_glyph_name.into(),
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
            point_ids: entities
                .point_ids
                .into_iter()
                .map(|id| id.to_string())
                .collect(),
            contour_ids: entities
                .contour_ids
                .into_iter()
                .map(|id| id.to_string())
                .collect(),
            anchor_ids: entities
                .anchor_ids
                .into_iter()
                .map(|id| id.to_string())
                .collect(),
            guideline_ids: entities
                .guideline_ids
                .into_iter()
                .map(|id| id.to_string())
                .collect(),
            component_ids: entities
                .component_ids
                .into_iter()
                .map(|id| id.to_string())
                .collect(),
        }
    }
}

#[napi(object)]
pub struct NapiGlyphValueChange {
    pub values: Float64Array,
    pub changed: NapiGlyphChangedEntities,
}

impl From<GlyphValueChange> for NapiGlyphValueChange {
    fn from(change: GlyphValueChange) -> Self {
        Self {
            values: change.values.into(),
            changed: change.changed.into(),
        }
    }
}

#[napi(object)]
pub struct NapiGlyphStructureChange {
    pub structure: NapiGlyphStructure,
    pub values: Float64Array,
    pub changed: NapiGlyphChangedEntities,
}

impl From<GlyphStructureChange> for NapiGlyphStructureChange {
    fn from(change: GlyphStructureChange) -> Self {
        Self {
            structure: change.structure.into(),
            values: change.values.into(),
            changed: change.changed.into(),
        }
    }
}

#[napi(object)]
pub struct NapiLocation {
    pub values: HashMap<String, f64>,
}

impl From<Location> for NapiLocation {
    fn from(location: Location) -> Self {
        Self {
            values: location.values,
        }
    }
}

#[napi(object)]
pub struct NapiAxisTent {
    pub axis_tag: String,
    pub lower: f64,
    pub peak: f64,
    pub upper: f64,
}

impl From<AxisTent> for NapiAxisTent {
    fn from(tent: AxisTent) -> Self {
        Self {
            axis_tag: tent.axis_tag,
            lower: tent.lower,
            peak: tent.peak,
            upper: tent.upper,
        }
    }
}

#[napi(object)]
pub struct NapiGlyphVariationData {
    /// One entry per region. Inner = tents on the axes the region depends on.
    pub regions: Vec<Vec<NapiAxisTent>>,
    /// Deltas are flattened in `GlyphState::values` order.
    pub deltas: Vec<Float64Array>,
}

impl From<GlyphVariationData> for NapiGlyphVariationData {
    fn from(data: GlyphVariationData) -> Self {
        Self {
            regions: data
                .regions
                .into_iter()
                .map(|region| region.into_iter().map(Into::into).collect())
                .collect(),
            deltas: data.deltas.into_iter().map(Into::into).collect(),
        }
    }
}

#[napi(object)]
pub struct NapiGlyphMaster {
    #[napi(ts_type = "SourceId")]
    pub source_id: String,
    pub source_name: String,
    pub is_default_source: bool,
    pub location: NapiLocation,
    pub structure: NapiGlyphStructure,
    pub values: Float64Array,
}

impl From<GlyphMaster> for NapiGlyphMaster {
    fn from(master: GlyphMaster) -> Self {
        Self {
            source_id: master.source_id,
            source_name: master.source_name,
            is_default_source: master.is_default_source,
            location: master.location.into(),
            structure: master.structure.into(),
            values: master.values.into(),
        }
    }
}
