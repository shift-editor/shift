use std::collections::HashMap;

use napi::bindgen_prelude::Float64Array;
use napi_derive::napi;
use shift_font::{GlyphId, PointType as IrPointType};

use crate::{
    AnchorData, Axis, AxisTent, ComponentData, ContourData, FontMetadata, FontMetrics,
    GlyphChangedEntities, GlyphMaster, GlyphRecord, GlyphState, GlyphStructure, GlyphVariationData,
    Location, PointData, PointType, Source,
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
    #[napi(ts_type = "AxisId")]
    pub id: String,
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
            id: axis.id.to_string(),
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
    pub filename: Option<String>,
}

impl From<Source> for NapiSource {
    fn from(source: Source) -> Self {
        Self {
            id: source.id.to_string(),
            name: source.name,
            location: source.location.into(),
            filename: source.filename,
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
}

impl From<GlyphRecord> for NapiGlyphRecord {
    fn from(record: GlyphRecord) -> Self {
        Self {
            id: record.id.to_string(),
            name: record.name.to_string(),
            unicodes: record.unicodes,
            component_base_glyph_ids: record
                .component_base_glyph_ids
                .into_iter()
                .map(|id| id.to_string())
                .collect(),
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
    pub variation_data: Option<NapiGlyphVariationData>,
}

impl From<GlyphState> for NapiGlyphState {
    fn from(state: GlyphState) -> Self {
        Self {
            layer_id: state.layer_id.to_string(),
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
    #[napi(ts_type = "GlyphId")]
    pub base_glyph_id: String,
    #[napi(ts_type = "GlyphName")]
    pub base_glyph_name: String,
}

impl From<ComponentData> for NapiComponentData {
    fn from(component: ComponentData) -> Self {
        Self {
            id: component.id,
            base_glyph_id: component.base_glyph_id.to_string(),
            base_glyph_name: component.base_glyph_name.to_string(),
        }
    }
}

impl From<NapiComponentData> for ComponentData {
    fn from(component: NapiComponentData) -> Self {
        Self {
            id: component.id,
            base_glyph_id: GlyphId::from_raw(component.base_glyph_id),
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
pub struct NapiLocation {
    #[napi(ts_type = "Record<AxisId, number>")]
    pub values: HashMap<String, f64>,
}

impl From<Location> for NapiLocation {
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

/// CS0 walking-skeleton intent. A stringly union covering exactly the two
/// skeleton kinds; CS1 replaces this with per-variant intent structs.
#[napi(object)]
pub struct NapiFontIntent {
    /// Discriminator naming the populated payload field. Editing kinds:
    /// "addPoints" | "addContour" | "setContourClosed" | "movePoints" |
    /// "setPointSmooth" | "removePoints" | "addAnchors" | "moveAnchors" |
    /// "removeAnchors" | "reverseContour" | "translatePoints" |
    /// "setXAdvance" | "applyBooleanOp".
    /// Create kinds: "createGlyph" | "createAxis" | "createSource". Delete
    /// kinds: "deleteAxis" | "deleteSource". Every
    /// kind shares the same apply path; one set = one undo step.
    pub kind: String,
    pub add_points: Option<NapiAddPointsIntent>,
    pub add_contour: Option<NapiAddContourIntent>,
    pub set_contour_closed: Option<NapiSetContourClosedIntent>,
    pub move_points: Option<NapiMovePointsIntent>,
    pub set_point_smooth: Option<NapiSetPointSmoothIntent>,
    pub remove_points: Option<NapiRemovePointsIntent>,
    pub add_anchors: Option<NapiAddAnchorsIntent>,
    pub move_anchors: Option<NapiMoveAnchorsIntent>,
    pub remove_anchors: Option<NapiRemoveAnchorsIntent>,
    pub reverse_contour: Option<NapiReverseContourIntent>,
    pub translate_points: Option<NapiTranslatePointsIntent>,
    pub set_x_advance: Option<NapiSetXAdvanceIntent>,
    pub apply_boolean_op: Option<NapiBooleanOpIntent>,
    pub create_glyph: Option<NapiCreateGlyphIntent>,
    pub update_glyph: Option<NapiUpdateGlyphIntent>,
    pub create_axis: Option<NapiCreateAxisIntent>,
    pub delete_axis: Option<NapiDeleteAxisIntent>,
    pub create_source: Option<NapiCreateSourceIntent>,
    pub delete_source: Option<NapiDeleteSourceIntent>,
}

/// Font-level glyph creation. The glyph id is client-minted (decision 6:
/// verbs return identity synchronously); Rust honors it and rejects
/// duplicates.
#[napi(object)]
pub struct NapiCreateGlyphIntent {
    #[napi(ts_type = "GlyphId")]
    pub glyph_id: String,
    #[napi(ts_type = "GlyphName")]
    pub name: String,
    #[napi(ts_type = "Array<Unicode>")]
    pub unicodes: Vec<u32>,
}

/// Font-level glyph update. The glyph id targets an existing committed glyph;
/// names are user-editable labels and are not stable identity.
#[napi(object)]
pub struct NapiUpdateGlyphIntent {
    #[napi(ts_type = "GlyphId")]
    pub glyph_id: String,
    #[napi(ts_type = "GlyphName")]
    pub new_name: String,
    #[napi(ts_type = "Array<Unicode>")]
    pub new_unicodes: Vec<u32>,
}

/// Font-level axis creation. The axis id is client-minted; the tag is an
/// OpenType label and must be unique within the font.
#[napi(object)]
pub struct NapiCreateAxisIntent {
    #[napi(ts_type = "AxisId")]
    pub axis_id: String,
    pub tag: String,
    pub name: String,
    pub min: f64,
    pub default: f64,
    pub max: f64,
    pub hidden: bool,
}

/// Font-level axis deletion. Removing an axis also reshapes source locations.
#[napi(object)]
pub struct NapiDeleteAxisIntent {
    #[napi(ts_type = "AxisId")]
    pub axis_id: String,
}

/// Font-level source deletion. Removing a source also removes its glyph layers.
#[napi(object)]
pub struct NapiDeleteSourceIntent {
    #[napi(ts_type = "SourceId")]
    pub source_id: String,
}

/// Font-level source creation. The source id is client-minted so verbs can
/// return identity synchronously; Rust honors it and rejects duplicates.
#[napi(object)]
pub struct NapiCreateSourceIntent {
    #[napi(ts_type = "SourceId")]
    pub source_id: String,
    pub name: String,
    /// Axis id → design-space value for the new source.
    pub location: NapiLocation,
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

/// Pure-state response to `apply`: no change records cross to the renderer.
#[napi(object)]
pub struct NapiAppliedChange {
    pub layers: Vec<NapiLayerReplaced>,
    /// Full records list when glyph identity changed; absent when untouched.
    pub glyphs: Option<Vec<NapiGlyphRecord>>,
    /// Full axes list when font-level axis structure changed; absent otherwise.
    pub axes: Option<Vec<NapiAxis>>,
    /// Full sources list when font-level source structure changed (createAxis
    /// reshapes locations, createSource adds one); absent otherwise.
    pub sources: Option<Vec<NapiSource>>,
    /// Stable ids: references survive renames without re-indexing.
    #[napi(ts_type = "Array<GlyphId>")]
    pub dependents: Vec<String>,
}

/// A point to create, carrying its caller-minted id (decision 6: ids are
/// client-minted so verbs return identity synchronously).
#[napi(object)]
pub struct NapiPointSeed {
    #[napi(ts_type = "PointId")]
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub point_type: NapiPointType,
    pub smooth: bool,
}

#[napi(object)]
pub struct NapiAddPointsIntent {
    #[napi(ts_type = "LayerId")]
    pub layer_id: String,
    /// Absent when `before` carries the anchor; Rust derives the contour.
    #[napi(ts_type = "ContourId")]
    pub contour_id: Option<String>,
    /// Insert before this point; append when absent.
    #[napi(ts_type = "PointId")]
    pub before: Option<String>,
    pub points: Vec<NapiPointSeed>,
}

#[napi(object)]
pub struct NapiAddContourIntent {
    #[napi(ts_type = "LayerId")]
    pub layer_id: String,
    #[napi(ts_type = "ContourId")]
    pub contour_id: String,
    pub closed: bool,
}

#[napi(object)]
pub struct NapiSetContourClosedIntent {
    #[napi(ts_type = "LayerId")]
    pub layer_id: String,
    #[napi(ts_type = "ContourId")]
    pub contour_id: String,
    pub closed: bool,
}

#[napi(object)]
pub struct NapiMovePointsIntent {
    #[napi(ts_type = "LayerId")]
    pub layer_id: String,
    #[napi(ts_type = "Array<PointId>")]
    pub point_ids: Vec<String>,
    /// Interleaved absolute coordinates: x0, y0, x1, y1, …
    pub coords: Vec<f64>,
}

#[napi(object)]
pub struct NapiSetPointSmoothIntent {
    #[napi(ts_type = "LayerId")]
    pub layer_id: String,
    #[napi(ts_type = "PointId")]
    pub point_id: String,
    pub smooth: bool,
}

#[napi(object)]
pub struct NapiRemovePointsIntent {
    #[napi(ts_type = "LayerId")]
    pub layer_id: String,
    #[napi(ts_type = "Array<PointId>")]
    pub point_ids: Vec<String>,
}

/// An anchor to create, carrying its caller-minted id (decision 6: ids are
/// client-minted so verbs return identity synchronously).
#[napi(object)]
pub struct NapiAnchorSeed {
    #[napi(ts_type = "AnchorId")]
    pub id: String,
    pub name: Option<String>,
    pub x: f64,
    pub y: f64,
}

#[napi(object)]
pub struct NapiAddAnchorsIntent {
    #[napi(ts_type = "LayerId")]
    pub layer_id: String,
    pub anchors: Vec<NapiAnchorSeed>,
}

#[napi(object)]
pub struct NapiMoveAnchorsIntent {
    #[napi(ts_type = "LayerId")]
    pub layer_id: String,
    #[napi(ts_type = "Array<AnchorId>")]
    pub anchor_ids: Vec<String>,
    /// Interleaved absolute coordinates: x0, y0, x1, y1, …
    pub coords: Vec<f64>,
}

#[napi(object)]
pub struct NapiRemoveAnchorsIntent {
    #[napi(ts_type = "LayerId")]
    pub layer_id: String,
    #[napi(ts_type = "Array<AnchorId>")]
    pub anchor_ids: Vec<String>,
}

#[napi(object)]
pub struct NapiReverseContourIntent {
    #[napi(ts_type = "LayerId")]
    pub layer_id: String,
    #[napi(ts_type = "ContourId")]
    pub contour_id: String,
}

/// Affine move: O(selection-ids) wire instead of O(N) coords.
#[napi(object)]
pub struct NapiTranslatePointsIntent {
    #[napi(ts_type = "LayerId")]
    pub layer_id: String,
    #[napi(ts_type = "Array<PointId>")]
    pub point_ids: Vec<String>,
    pub dx: f64,
    pub dy: f64,
}

#[napi(object)]
pub struct NapiSetXAdvanceIntent {
    #[napi(ts_type = "LayerId")]
    pub layer_id: String,
    pub width: f64,
}

#[napi(object)]
pub struct NapiBooleanOpIntent {
    #[napi(ts_type = "LayerId")]
    pub layer_id: String,
    #[napi(ts_type = "ContourId")]
    pub contour_id_a: String,
    #[napi(ts_type = "ContourId")]
    pub contour_id_b: String,
    /// "union" | "subtract" | "intersect" | "difference"
    pub operation: String,
}
