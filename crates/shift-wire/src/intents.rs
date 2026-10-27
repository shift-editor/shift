//! The edits the editor sends, in the shape it sends them, for every
//! transport: NAPI to the native workspace and serde to the WebAssembly
//! engine. Each value converts into the shift-font value it describes through
//! one `TryFrom` impl that both transports share.

use std::collections::HashMap;
use std::str::FromStr;

use crate::PointType as StatePointType;
#[cfg(feature = "napi")]
use napi::bindgen_prelude::Float64Array;
#[cfg(feature = "napi")]
use napi_derive::napi;
use shift_font as font;
use shift_font::MaterializeGlyphLayer;
use shift_font::PointType as IrPointType;
use shift_font::{
    AddAnchors, AddComponent, AddContour, AddPoints, AlignPoints, ApplyBooleanOp, CloneGlyphLayer,
    CreateAxis, CreateGlyph, CreateGlyphLayer, CreateKerningGroup, CreateNamedInstance,
    CreateSource, DecomposeComponents, DeleteAxis, DeleteKerningGroup, DeleteNamedInstance,
    DeletePoints, DeleteSource, DistributePoints, JoinContours, MoveAnchors, MovePoints,
    RemoveAnchors, RemoveComponents, RemovePoints, RenameAnchors, RenameKerningGroup,
    ReverseContour, SetAxisMappings, SetComponentAlignment, SetComponentTransforms,
    SetContourClosed, SetContourStart, SetKerningGroupMember, SetKerningValues, SetLanguages,
    SetMetricDefinitions, SetPointSmooth, SetPositions, SetXAdvance, ShiftSidebearing,
    SplitSegment, TransformLayer, TransformPoints, TranslatePoints, UpdateAxis, UpdateFontMetadata,
    UpdateGlyph, UpdateNamedInstance, UpdateSource, UpgradeLineToCubic,
};
use shift_font::{
    AnchorId, AnchorSeed as FontAnchorSeed, Axis as FontAxis, AxisId, AxisLabel as FontAxisLabel,
    AxisLabelId, AxisLabelRange, AxisMapping as FontAxisMapping, AxisMappingId,
    AxisMappingPoint as FontAxisMappingPoint, AxisRole as FontAxisRole, ComponentAlignment,
    ComponentId, ContourEnd as FontContourEnd, ContourId, FontMetadata as FontMetadataModel,
    GlyphId, GuidelineId, KerningGroupId, KerningPair, KerningPosition as FontKerningPosition,
    KerningSide as FontKerningSide, KerningValueEdit as FontKerningValueEdit, LayerId,
    Location as FontLocation, MetricDefinition as FontMetricDefinition, MetricId,
    MetricKind as FontMetricKind, MetricValue, NamedInstance as FontNamedInstance, NamedInstanceId,
    PointId, PointSeed as FontPointSeed, SourceId, Transform,
};

shift_font::string_enum! {
    /// Which kind of id the editor sent, for errors that name it.
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum IdKind {
        Contour => "contour ID",
        Glyph => "glyph ID",
        Point => "point ID",
        Anchor => "anchor ID",
        Axis => "axis ID",
        AxisMapping => "axis mapping ID",
        KerningGroup => "kerning group ID",
        AxisLabel => "axis label ID",
        NamedInstance => "named instance ID",
        Metric => "metric ID",
        Component => "component ID",
        Guideline => "guideline ID",
        Layer => "layer ID",
        Source => "source ID",
    }
    parse_error: String = |text| format!("unknown id kind {text:?}");
}

/// Why a value the editor sent does not describe a domain value.
#[derive(Debug, thiserror::Error)]
pub enum WireError {
    #[error("invalid {kind}: {value}")]
    InvalidId { kind: IdKind, value: String },

    #[error("a layer transform has 6 values, not {0}")]
    TransformLength(usize),

    #[error("unknown boolean operation: {0}")]
    UnknownBooleanOp(String),

    #[error("{0}")]
    UnknownEditOption(#[from] font::UnknownEditOption),

    #[error("a continuous axis needs a minimum and a maximum")]
    ContinuousAxisWithoutBounds,

    #[error("a discrete axis needs its values")]
    DiscreteAxisWithoutValues,

    #[error("an axis label range needs both a minimum and a maximum")]
    IncompleteAxisLabelRange,

    #[error(transparent)]
    Core(#[from] shift_font::CoreError),
}

pub type WireResult<T> = Result<T, WireError>;

/// Reads a wire component alignment; anything else is `Unset`.
pub fn parse_alignment(name: Option<&str>) -> ComponentAlignment {
    match name {
        Some("anchored") => ComponentAlignment::Anchored,
        Some("free") => ComponentAlignment::Free,
        _ => ComponentAlignment::Unset,
    }
}

/// An id the editor sends as text.
pub trait WireParse: Sized + FromStr {
    /// What the id is, for its error.
    const KIND: IdKind;
}

/// Converts every wire value in `values` into the domain values they describe.
///
/// # Errors
///
/// Returns the first value's conversion error.
fn convert_all<W, D>(values: Vec<W>) -> WireResult<Vec<D>>
where
    D: TryFrom<W, Error = WireError>,
{
    values.into_iter().map(D::try_from).collect()
}

/// Parses one id the editor sent.
///
/// # Errors
///
/// Returns [`WireError::InvalidId`] naming the id's kind when `value` is not one.
pub fn parse<T: WireParse>(value: &str) -> WireResult<T> {
    value.parse().map_err(|_| WireError::InvalidId {
        kind: T::KIND,
        value: value.to_string(),
    })
}

/// Parses every id in `ids`.
///
/// # Errors
///
/// As [`parse`], for the first id that is not one.
pub fn parse_id_list<T: WireParse>(ids: &[String]) -> WireResult<Vec<T>> {
    ids.iter().map(|id| parse::<T>(id)).collect()
}

impl WireParse for ContourId {
    const KIND: IdKind = IdKind::Contour;
}

impl WireParse for GlyphId {
    const KIND: IdKind = IdKind::Glyph;
}

impl WireParse for PointId {
    const KIND: IdKind = IdKind::Point;
}

impl WireParse for AnchorId {
    const KIND: IdKind = IdKind::Anchor;
}

impl WireParse for AxisId {
    const KIND: IdKind = IdKind::Axis;
}

impl WireParse for AxisMappingId {
    const KIND: IdKind = IdKind::AxisMapping;
}

impl WireParse for KerningGroupId {
    const KIND: IdKind = IdKind::KerningGroup;
}

impl WireParse for AxisLabelId {
    const KIND: IdKind = IdKind::AxisLabel;
}

impl WireParse for NamedInstanceId {
    const KIND: IdKind = IdKind::NamedInstance;
}

impl WireParse for MetricId {
    const KIND: IdKind = IdKind::Metric;
}

impl WireParse for ComponentId {
    const KIND: IdKind = IdKind::Component;
}

impl WireParse for GuidelineId {
    const KIND: IdKind = IdKind::Guideline;
}

impl WireParse for LayerId {
    const KIND: IdKind = IdKind::Layer;
}

impl WireParse for SourceId {
    const KIND: IdKind = IdKind::Source;
}

#[cfg_attr(feature = "napi", napi(string_enum = "camelCase"))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(
    clippy::enum_variant_names,
    reason = "the font-format names for point types"
)]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PointType {
    OnCurve,
    OffCurve,
    QCurve,
}

#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
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

#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Axis {
    #[cfg_attr(feature = "napi", napi(ts_type = "AxisId"))]
    pub id: String,
    pub tag: String,
    pub name: String,
    pub role: AxisRole,
    pub axis_type: AxisType,
    pub minimum: Option<f64>,
    pub default: f64,
    pub maximum: Option<f64>,
    pub values: Option<Vec<f64>>,
    pub labels: Vec<AxisLabel>,
    pub hidden: bool,
}

#[cfg_attr(feature = "napi", napi(string_enum = "camelCase"))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AxisRole {
    External,
    Internal,
}

#[cfg_attr(feature = "napi", napi(string_enum = "camelCase"))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AxisType {
    Continuous,
    Discrete,
}

#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AxisLabel {
    #[cfg_attr(feature = "napi", napi(ts_type = "AxisLabelId"))]
    pub id: String,
    pub name: String,
    pub value: f64,
    pub minimum: Option<f64>,
    pub maximum: Option<f64>,
    pub linked_value: Option<f64>,
    pub elidable: bool,
}

#[cfg_attr(feature = "napi", napi(object))]
/// NAPI projection of one explicit named product preset.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedInstance {
    #[cfg_attr(feature = "napi", napi(ts_type = "NamedInstanceId"))]
    pub id: String,
    pub name: String,
    pub location: Location,
    pub postscript_name: Option<String>,
}

#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AxisMappingPoint {
    pub description: Option<String>,
    pub input: Location,
    pub output: Location,
}

#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AxisMapping {
    #[cfg_attr(feature = "napi", napi(ts_type = "AxisMappingId"))]
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    #[cfg_attr(feature = "napi", napi(ts_type = "Array<AxisId>"))]
    pub inputs: Vec<String>,
    #[cfg_attr(feature = "napi", napi(ts_type = "Array<AxisId>"))]
    pub outputs: Vec<String>,
    pub points: Vec<AxisMappingPoint>,
}

#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceMetricValue {
    #[cfg_attr(feature = "napi", napi(ts_type = "MetricId"))]
    pub metric_id: String,
    pub position: f64,
    pub overshoot: f64,
}

#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricDefinition {
    #[cfg_attr(feature = "napi", napi(ts_type = "MetricId"))]
    pub id: String,
    pub kind: MetricKind,
    pub name: String,
}

#[cfg_attr(feature = "napi", napi(string_enum = "camelCase"))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MetricKind {
    Ascender,
    CapHeight,
    XHeight,
    Baseline,
    Descender,
    Custom,
}

#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Location {
    #[cfg_attr(feature = "napi", napi(ts_type = "Record<AxisId, number>"))]
    pub values: HashMap<String, f64>,
}

/// One kerning pair value to set or remove at one source.
#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KerningValueEdit {
    #[cfg_attr(feature = "napi", napi(ts_type = "SourceId"))]
    pub source_id: String,
    pub first: KerningSide,
    pub second: KerningSide,
    /// New value in font units; absent removes the pair at this source.
    pub amount: Option<f64>,
}

/// Sets or removes kerning pair values at sources as one undoable edit.
#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetKerningValuesIntent {
    pub edits: Vec<KerningValueEdit>,
}

/// Creates an empty kerning group under an id the client mints.
#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateKerningGroupIntent {
    #[cfg_attr(feature = "napi", napi(ts_type = "KerningGroupId"))]
    pub group_id: String,
    pub position: KerningPosition,
    pub name: String,
}

/// Moves a glyph into a group, or out of its group at `position` without one.
#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetKerningGroupMemberIntent {
    pub position: KerningPosition,
    #[cfg_attr(feature = "napi", napi(ts_type = "GlyphId"))]
    pub glyph_id: String,
    #[cfg_attr(feature = "napi", napi(ts_type = "KerningGroupId"))]
    pub group_id: Option<String>,
}

/// Renames a kerning group; its pairs keep referencing it by id.
#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameKerningGroupIntent {
    #[cfg_attr(feature = "napi", napi(ts_type = "KerningGroupId"))]
    pub group_id: String,
    pub name: String,
}

/// Deletes a kerning group; its pairs stay and resolve again on undo.
#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteKerningGroupIntent {
    #[cfg_attr(feature = "napi", napi(ts_type = "KerningGroupId"))]
    pub group_id: String,
}

/// Replaces the complete authored metadata snapshot without changing metrics.
#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateFontMetadataIntent {
    /// Complete replacement snapshot; omitted optional fields are cleared.
    pub metadata: FontMetadata,
}

/// Replaces the font's tracked language list as one undoable edit.
#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetLanguagesIntent {
    /// Hyperglot language ids in display order. Blank ids are dropped and
    /// duplicates keep their first position; an empty list is stored as-is.
    pub language_ids: Vec<String>,
}

/// Font-level glyph creation. The glyph id is client-minted (decision 6:
/// verbs return identity synchronously); Rust honors it and rejects
/// duplicates.
#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateGlyphIntent {
    #[cfg_attr(feature = "napi", napi(ts_type = "GlyphId"))]
    pub glyph_id: String,
    #[cfg_attr(feature = "napi", napi(ts_type = "GlyphName"))]
    pub name: String,
    #[cfg_attr(feature = "napi", napi(ts_type = "Array<Unicode>"))]
    pub unicodes: Vec<u32>,
}

/// Font-level glyph update. The glyph id targets an existing committed glyph;
/// names are user-editable labels and are not stable identity.
#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateGlyphIntent {
    #[cfg_attr(feature = "napi", napi(ts_type = "GlyphId"))]
    pub glyph_id: String,
    #[cfg_attr(feature = "napi", napi(ts_type = "GlyphName"))]
    pub new_name: String,
    #[cfg_attr(feature = "napi", napi(ts_type = "Array<Unicode>"))]
    pub new_unicodes: Vec<u32>,
}

#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAxisIntent {
    pub axis: Axis,
}

#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetAxisMappingsIntent {
    pub mappings: Vec<AxisMapping>,
}

#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetMetricDefinitionsIntent {
    pub definitions: Vec<MetricDefinition>,
}

#[cfg_attr(feature = "napi", napi(object))]
/// Creates an authored named instance with client-minted stable identity.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateNamedInstanceIntent {
    pub instance: NamedInstance,
}

#[cfg_attr(feature = "napi", napi(object))]
/// Replaces an authored named instance while retaining its identity.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateNamedInstanceIntent {
    pub instance: NamedInstance,
}

#[cfg_attr(feature = "napi", napi(object))]
/// Deletes an authored named instance without changing sources or geometry.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteNamedInstanceIntent {
    #[cfg_attr(feature = "napi", napi(ts_type = "NamedInstanceId"))]
    pub instance_id: String,
}

/// Font-level axis creation. The axis id is client-minted; the tag is an
/// OpenType label and must be unique within the font.
#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAxisIntent {
    pub axis: Axis,
}

/// Font-level axis deletion. Removing an axis also reshapes source locations.
#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteAxisIntent {
    #[cfg_attr(feature = "napi", napi(ts_type = "AxisId"))]
    pub axis_id: String,
}

/// Font-level source deletion. Removing a source also removes its glyph layers.
#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteSourceIntent {
    #[cfg_attr(feature = "napi", napi(ts_type = "SourceId"))]
    pub source_id: String,
}

/// Font-level source creation. The source id is client-minted so verbs can
/// return identity synchronously; Rust honors it and rejects duplicates.
#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSourceIntent {
    #[cfg_attr(feature = "napi", napi(ts_type = "SourceId"))]
    pub source_id: String,
    pub name: String,
    /// Axis id → design-space value for the new source.
    pub location: Location,
}

#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSourceIntent {
    #[cfg_attr(feature = "napi", napi(ts_type = "SourceId"))]
    pub source_id: String,
    pub name: String,
    pub location: Location,
    pub metric_values: Vec<SourceMetricValue>,
    pub italic_angle: Option<f64>,
    pub line_gap: Option<f64>,
    pub underline_position: Option<f64>,
    pub underline_thickness: Option<f64>,
}

/// Creates one sparse glyph layer at an existing source for an existing glyph.
#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateGlyphLayerIntent {
    #[cfg_attr(feature = "napi", napi(ts_type = "LayerId"))]
    pub layer_id: String,
    #[cfg_attr(feature = "napi", napi(ts_type = "GlyphId"))]
    pub glyph_id: String,
    #[cfg_attr(feature = "napi", napi(ts_type = "SourceId"))]
    pub source_id: String,
}

/// Creates one glyph layer by copying another layer's shape with fresh internal ids.
#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneGlyphLayerIntent {
    #[cfg_attr(feature = "napi", napi(ts_type = "LayerId"))]
    pub layer_id: String,
    #[cfg_attr(feature = "napi", napi(ts_type = "GlyphId"))]
    pub glyph_id: String,
    #[cfg_attr(feature = "napi", napi(ts_type = "SourceId"))]
    pub source_id: String,
    #[cfg_attr(feature = "napi", napi(ts_type = "LayerId"))]
    pub from_layer_id: String,
}

/// A layer's numeric state as a transport carries it: a `Float64Array` over
/// NAPI, a number sequence through serde (a `Float64Array` from WebAssembly).
#[cfg(feature = "napi")]
pub type LayerValues = Float64Array;
/// A layer's numeric state as a transport carries it: a `Float64Array` over
/// NAPI, a number sequence through serde (a `Float64Array` from WebAssembly).
#[cfg(not(feature = "napi"))]
pub type LayerValues = Vec<f64>;

#[cfg(feature = "napi")]
#[expect(
    clippy::needless_pass_by_value,
    reason = "one signature for both transports; the serde build moves its Vec"
)]
fn values_vec(values: LayerValues) -> Vec<f64> {
    values.to_vec()
}

#[cfg(not(feature = "napi"))]
fn values_vec(values: LayerValues) -> Vec<f64> {
    values
}

/// Creates one sparse layer from resolved values at a design-space location.
#[cfg_attr(feature = "napi", napi(object))]
#[cfg_attr(not(feature = "napi"), derive(serde::Deserialize))]
#[cfg_attr(not(feature = "napi"), serde(rename_all = "camelCase"))]
pub struct MaterializeGlyphLayerIntent {
    #[cfg_attr(feature = "napi", napi(ts_type = "LayerId"))]
    pub layer_id: String,
    #[cfg_attr(feature = "napi", napi(ts_type = "GlyphId"))]
    pub glyph_id: String,
    #[cfg_attr(feature = "napi", napi(ts_type = "SourceId"))]
    pub source_id: String,
    #[cfg_attr(feature = "napi", napi(ts_type = "LayerId"))]
    pub from_layer_id: String,
    /// Numeric state ordered like `GlyphState.values`.
    #[cfg_attr(feature = "napi", napi(ts_type = "Float64Array"))]
    pub values: LayerValues,
}

/// A point to create, carrying its caller-minted id (decision 6: ids are
/// client-minted so verbs return identity synchronously).
#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PointSeed {
    #[cfg_attr(feature = "napi", napi(ts_type = "PointId"))]
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub point_type: PointType,
    pub smooth: bool,
}

#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddPointsIntent {
    #[cfg_attr(feature = "napi", napi(ts_type = "LayerId"))]
    pub layer_id: String,
    /// Absent when `before` carries the anchor; Rust derives the contour.
    #[cfg_attr(feature = "napi", napi(ts_type = "ContourId"))]
    pub contour_id: Option<String>,
    /// Insert before this point; append when absent.
    #[cfg_attr(feature = "napi", napi(ts_type = "PointId"))]
    pub before: Option<String>,
    pub points: Vec<PointSeed>,
}

#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddContourIntent {
    #[cfg_attr(feature = "napi", napi(ts_type = "LayerId"))]
    pub layer_id: String,
    #[cfg_attr(feature = "napi", napi(ts_type = "ContourId"))]
    pub contour_id: String,
    pub closed: bool,
}

#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetContourClosedIntent {
    #[cfg_attr(feature = "napi", napi(ts_type = "LayerId"))]
    pub layer_id: String,
    #[cfg_attr(feature = "napi", napi(ts_type = "ContourId"))]
    pub contour_id: String,
    pub closed: bool,
}

#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MovePointsIntent {
    #[cfg_attr(feature = "napi", napi(ts_type = "LayerId"))]
    pub layer_id: String,
    #[cfg_attr(feature = "napi", napi(ts_type = "Array<PointId>"))]
    pub point_ids: Vec<String>,
    /// Interleaved absolute coordinates: x0, y0, x1, y1, …
    pub coords: Vec<f64>,
}

#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetPointSmoothIntent {
    #[cfg_attr(feature = "napi", napi(ts_type = "LayerId"))]
    pub layer_id: String,
    #[cfg_attr(feature = "napi", napi(ts_type = "PointId"))]
    pub point_id: String,
    pub smooth: bool,
}

#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemovePointsIntent {
    #[cfg_attr(feature = "napi", napi(ts_type = "LayerId"))]
    pub layer_id: String,
    #[cfg_attr(feature = "napi", napi(ts_type = "Array<PointId>"))]
    pub point_ids: Vec<String>,
}

/// An anchor to create, carrying its caller-minted id (decision 6: ids are
/// client-minted so verbs return identity synchronously).
#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnchorSeed {
    #[cfg_attr(feature = "napi", napi(ts_type = "AnchorId"))]
    pub id: String,
    pub name: Option<String>,
    pub x: f64,
    pub y: f64,
}

#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddAnchorsIntent {
    #[cfg_attr(feature = "napi", napi(ts_type = "LayerId"))]
    pub layer_id: String,
    pub anchors: Vec<AnchorSeed>,
}

#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveAnchorsIntent {
    #[cfg_attr(feature = "napi", napi(ts_type = "LayerId"))]
    pub layer_id: String,
    #[cfg_attr(feature = "napi", napi(ts_type = "Array<AnchorId>"))]
    pub anchor_ids: Vec<String>,
    /// Interleaved absolute coordinates: x0, y0, x1, y1, …
    pub coords: Vec<f64>,
}

/// Every point and anchor position of a layer, naming none of them.
#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetPositionsIntent {
    #[cfg_attr(feature = "napi", napi(ts_type = "LayerId"))]
    pub layer_id: String,
    /// Every contour point, contour after contour, then every anchor, each as `x, y`.
    pub positions: Vec<f64>,
}

#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveAnchorsIntent {
    #[cfg_attr(feature = "napi", napi(ts_type = "LayerId"))]
    pub layer_id: String,
    #[cfg_attr(feature = "napi", napi(ts_type = "Array<AnchorId>"))]
    pub anchor_ids: Vec<String>,
}

/// Renames anchors in one layer; `names[i]` is the new name of `anchorIds[i]`.
#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameAnchorsIntent {
    #[cfg_attr(feature = "napi", napi(ts_type = "LayerId"))]
    pub layer_id: String,
    #[cfg_attr(feature = "napi", napi(ts_type = "Array<AnchorId>"))]
    pub anchor_ids: Vec<String>,
    pub names: Vec<String>,
}

#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddComponentIntent {
    #[cfg_attr(feature = "napi", napi(ts_type = "LayerId"))]
    pub layer_id: String,
    #[cfg_attr(feature = "napi", napi(ts_type = "ComponentId"))]
    pub component_id: String,
    #[cfg_attr(feature = "napi", napi(ts_type = "GlyphId"))]
    pub base_glyph_id: String,
}

#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetComponentTransformsIntent {
    #[cfg_attr(feature = "napi", napi(ts_type = "LayerId"))]
    pub layer_id: String,
    #[cfg_attr(feature = "napi", napi(ts_type = "Array<ComponentId>"))]
    pub component_ids: Vec<String>,
    pub transforms: Vec<f64>,
}

/// Records whether components are placed by their anchors; anchoring one also
/// places it on its anchors now.
#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetComponentAlignmentIntent {
    #[cfg_attr(feature = "napi", napi(ts_type = "LayerId"))]
    pub layer_id: String,
    #[cfg_attr(feature = "napi", napi(ts_type = "Array<ComponentId>"))]
    pub component_ids: Vec<String>,
    #[cfg_attr(
        feature = "napi",
        napi(ts_type = "\"anchored\" | \"free\" | \"unset\"")
    )]
    pub alignment: String,
}

#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveComponentsIntent {
    #[cfg_attr(feature = "napi", napi(ts_type = "LayerId"))]
    pub layer_id: String,
    #[cfg_attr(feature = "napi", napi(ts_type = "Array<ComponentId>"))]
    pub component_ids: Vec<String>,
}

#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecomposeComponentsIntent {
    #[cfg_attr(feature = "napi", napi(ts_type = "LayerId"))]
    pub layer_id: String,
    #[cfg_attr(feature = "napi", napi(ts_type = "Array<ComponentId>"))]
    pub component_ids: Vec<String>,
}

#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReverseContourIntent {
    #[cfg_attr(feature = "napi", napi(ts_type = "LayerId"))]
    pub layer_id: String,
    #[cfg_attr(feature = "napi", napi(ts_type = "ContourId"))]
    pub contour_id: String,
}

/// Selects an existing on-curve start for a closed contour; does not move or convert points.
#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetContourStartIntent {
    #[cfg_attr(feature = "napi", napi(ts_type = "LayerId"))]
    pub layer_id: String,
    #[cfg_attr(feature = "napi", napi(ts_type = "ContourId"))]
    pub contour_id: String,
    #[cfg_attr(feature = "napi", napi(ts_type = "PointId"))]
    pub point_id: String,
}

/// Affine transform of a whole layer: points, anchors, and component placements.
#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransformLayerIntent {
    #[cfg_attr(feature = "napi", napi(ts_type = "LayerId"))]
    pub layer_id: String,
    /// Six affine values `[a, b, c, d, e, f]`: `x' = a·x + c·y + e`, `y' = b·x + d·y + f`.
    pub matrix: Vec<f64>,
}

/// Moves points by one affine transform.
#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransformPointsIntent {
    #[cfg_attr(feature = "napi", napi(ts_type = "LayerId"))]
    pub layer_id: String,
    #[cfg_attr(feature = "napi", napi(ts_type = "Array<PointId>"))]
    pub point_ids: Vec<String>,
    /// Six affine values `[a, b, c, d, e, f]`: `x' = a·x + c·y + e`, `y' = b·x + d·y + f`.
    pub matrix: Vec<f64>,
}

/// Lines points up on an edge or centre of the box around them.
#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlignPointsIntent {
    #[cfg_attr(feature = "napi", napi(ts_type = "LayerId"))]
    pub layer_id: String,
    #[cfg_attr(feature = "napi", napi(ts_type = "Array<PointId>"))]
    pub point_ids: Vec<String>,
    #[cfg_attr(
        feature = "napi",
        napi(
            ts_type = "\"left\" | \"center-h\" | \"right\" | \"top\" | \"center-v\" | \"bottom\""
        )
    )]
    pub alignment: String,
}

/// Spaces points evenly along an axis between the outermost two.
#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DistributePointsIntent {
    #[cfg_attr(feature = "napi", napi(ts_type = "LayerId"))]
    pub layer_id: String,
    #[cfg_attr(feature = "napi", napi(ts_type = "Array<PointId>"))]
    pub point_ids: Vec<String>,
    #[cfg_attr(feature = "napi", napi(ts_type = "\"horizontal\" | \"vertical\""))]
    pub axis: String,
}

/// Adds `delta` to one sidebearing; the left one moves the whole layer with the advance.
#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftSidebearingIntent {
    #[cfg_attr(feature = "napi", napi(ts_type = "LayerId"))]
    pub layer_id: String,
    #[cfg_attr(feature = "napi", napi(ts_type = "\"lsb\" | \"rsb\""))]
    pub sidebearing: String,
    pub delta: f64,
}

/// Affine move: O(selection-ids) wire instead of O(N) coords.
#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslatePointsIntent {
    #[cfg_attr(feature = "napi", napi(ts_type = "LayerId"))]
    pub layer_id: String,
    #[cfg_attr(feature = "napi", napi(ts_type = "Array<PointId>"))]
    pub point_ids: Vec<String>,
    pub dx: f64,
    pub dy: f64,
}

#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetXAdvanceIntent {
    #[cfg_attr(feature = "napi", napi(ts_type = "LayerId"))]
    pub layer_id: String,
    pub width: f64,
}

#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BooleanOpIntent {
    #[cfg_attr(feature = "napi", napi(ts_type = "LayerId"))]
    pub layer_id: String,
    #[cfg_attr(feature = "napi", napi(ts_type = "ContourId"))]
    pub contour_id_a: String,
    #[cfg_attr(feature = "napi", napi(ts_type = "ContourId"))]
    pub contour_id_b: String,
    /// "union" | "subtract" | "intersect" | "difference"
    pub operation: String,
}

/// Deletes points and reconnects what survives, fitting or leaving gaps.
#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletePointsIntent {
    #[cfg_attr(feature = "napi", napi(ts_type = "LayerId"))]
    pub layer_id: String,
    #[cfg_attr(feature = "napi", napi(ts_type = "Array<PointId>"))]
    pub point_ids: Vec<String>,
    #[cfg_attr(feature = "napi", napi(ts_type = "\"fit\" | \"gap\""))]
    pub mode: String,
}

/// Splits the segment between two on-curve points at `t`; the caller mints
/// the new on-curve point's id.
#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitSegmentIntent {
    #[cfg_attr(feature = "napi", napi(ts_type = "LayerId"))]
    pub layer_id: String,
    #[cfg_attr(feature = "napi", napi(ts_type = "PointId"))]
    pub start_id: String,
    #[cfg_attr(feature = "napi", napi(ts_type = "PointId"))]
    pub end_id: String,
    pub t: f64,
    #[cfg_attr(feature = "napi", napi(ts_type = "PointId"))]
    pub point_id: String,
}

/// Raises the line between two on-curve points to a cubic of the same shape.
#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpgradeLineToCubicIntent {
    #[cfg_attr(feature = "napi", napi(ts_type = "LayerId"))]
    pub layer_id: String,
    #[cfg_attr(feature = "napi", napi(ts_type = "PointId"))]
    pub start_id: String,
    #[cfg_attr(feature = "napi", napi(ts_type = "PointId"))]
    pub end_id: String,
}

/// One open end of a contour.
#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContourEnd {
    #[cfg_attr(feature = "napi", napi(ts_type = "ContourId"))]
    pub contour_id: String,
    #[cfg_attr(feature = "napi", napi(ts_type = "\"start\" | \"end\""))]
    pub side: String,
}

/// Closes a contour by its two ends, or joins two contours into `from`.
#[cfg_attr(feature = "napi", napi(object))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinContoursIntent {
    #[cfg_attr(feature = "napi", napi(ts_type = "LayerId"))]
    pub layer_id: String,
    pub from: ContourEnd,
    pub to: ContourEnd,
    #[cfg_attr(feature = "napi", napi(ts_type = "\"merge\" | \"connect\""))]
    pub mode: String,
}

#[cfg_attr(feature = "napi", napi(string_enum = "camelCase"))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum KerningPosition {
    First,
    Second,
}

#[cfg_attr(feature = "napi", napi(string_enum = "camelCase"))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum KerningSideKind {
    Glyph,
    Group,
}

#[cfg_attr(feature = "napi", napi(object))]
/// One kerning pair side: `id` is a glyph id when `kind` is `glyph`, else a group id.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KerningSide {
    pub kind: KerningSideKind,
    pub id: String,
}

impl TryFrom<KerningValueEdit> for FontKerningValueEdit {
    type Error = WireError;

    fn try_from(wire: KerningValueEdit) -> WireResult<Self> {
        Ok(Self {
            source_id: parse::<SourceId>(&wire.source_id)?,
            pair: KerningPair::new(wire.first.try_into()?, wire.second.try_into()?),
            value: wire.amount,
        })
    }
}

impl TryFrom<KerningPosition> for FontKerningPosition {
    type Error = WireError;

    fn try_from(wire: KerningPosition) -> WireResult<Self> {
        Ok(match wire {
            KerningPosition::First => Self::First,
            KerningPosition::Second => Self::Second,
        })
    }
}

impl TryFrom<KerningSide> for FontKerningSide {
    type Error = WireError;

    fn try_from(wire: KerningSide) -> WireResult<Self> {
        Ok(match wire.kind {
            KerningSideKind::Glyph => Self::Glyph(parse::<GlyphId>(&wire.id)?),
            KerningSideKind::Group => Self::Group(parse::<KerningGroupId>(&wire.id)?),
        })
    }
}

/// Lists each intent the editor sends once: the variant, the field holding
/// its payload, and the payload's type. Generates the tagged wire
/// [`FontIntent`] and its conversion into [`font::FontIntent`].
macro_rules! wire_intents {
    ($($(#[$attr:meta])* $variant:ident { $field:ident: $payload:ty },)+) => {
        /// One edit as the editor sends it: `{ kind: "addPoints", addPoints: {…} }`.
        #[cfg_attr(
            feature = "napi",
            napi(discriminant = "kind", discriminant_case = "camelCase")
        )]
        #[derive(serde::Deserialize)]
        #[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
        pub enum FontIntent {
            $($(#[$attr])* $variant { $field: $payload },)+
        }

        impl TryFrom<FontIntent> for font::FontIntent {
            type Error = WireError;

            fn try_from(wire: FontIntent) -> WireResult<Self> {
                match wire {
                    $($(#[$attr])* FontIntent::$variant { $field } => $field.try_into(),)+
                }
            }
        }
    };
}

wire_intents! {
    AddPoints { add_points: AddPointsIntent },
    AddContour { add_contour: AddContourIntent },
    SetContourClosed { set_contour_closed: SetContourClosedIntent },
    MovePoints { move_points: MovePointsIntent },
    SetPointSmooth { set_point_smooth: SetPointSmoothIntent },
    RemovePoints { remove_points: RemovePointsIntent },
    AddAnchors { add_anchors: AddAnchorsIntent },
    MoveAnchors { move_anchors: MoveAnchorsIntent },
    SetPositions { set_positions: SetPositionsIntent },
    RemoveAnchors { remove_anchors: RemoveAnchorsIntent },
    RenameAnchors { rename_anchors: RenameAnchorsIntent },
    AddComponent { add_component: AddComponentIntent },
    SetComponentTransforms { set_component_transforms: SetComponentTransformsIntent },
    SetComponentAlignment { set_component_alignment: SetComponentAlignmentIntent },
    RemoveComponents { remove_components: RemoveComponentsIntent },
    DecomposeComponents { decompose_components: DecomposeComponentsIntent },
    ReverseContour { reverse_contour: ReverseContourIntent },
    SetContourStart { set_contour_start: SetContourStartIntent },
    TranslatePoints { translate_points: TranslatePointsIntent },
    TransformLayer { transform_layer: TransformLayerIntent },
    SetXAdvance { set_x_advance: SetXAdvanceIntent },
    ApplyBooleanOp { apply_boolean_op: BooleanOpIntent },
    DeletePoints { delete_points: DeletePointsIntent },
    SplitSegment { split_segment: SplitSegmentIntent },
    UpgradeLineToCubic { upgrade_line_to_cubic: UpgradeLineToCubicIntent },
    JoinContours { join_contours: JoinContoursIntent },
    TransformPoints { transform_points: TransformPointsIntent },
    AlignPoints { align_points: AlignPointsIntent },
    DistributePoints { distribute_points: DistributePointsIntent },
    ShiftSidebearing { shift_sidebearing: ShiftSidebearingIntent },
    CreateGlyph { create_glyph: CreateGlyphIntent },
    UpdateGlyph { update_glyph: UpdateGlyphIntent },
    UpdateFontMetadata { update_font_metadata: UpdateFontMetadataIntent },
    SetKerningValues { set_kerning_values: SetKerningValuesIntent },
    CreateKerningGroup { create_kerning_group: CreateKerningGroupIntent },
    SetKerningGroupMember { set_kerning_group_member: SetKerningGroupMemberIntent },
    RenameKerningGroup { rename_kerning_group: RenameKerningGroupIntent },
    DeleteKerningGroup { delete_kerning_group: DeleteKerningGroupIntent },
    SetLanguages { set_languages: SetLanguagesIntent },
    CreateAxis { create_axis: CreateAxisIntent },
    UpdateAxis { update_axis: UpdateAxisIntent },
    DeleteAxis { delete_axis: DeleteAxisIntent },
    SetAxisMappings { set_axis_mappings: SetAxisMappingsIntent },
    SetMetricDefinitions { set_metric_definitions: SetMetricDefinitionsIntent },
    CreateNamedInstance { create_named_instance: CreateNamedInstanceIntent },
    UpdateNamedInstance { update_named_instance: UpdateNamedInstanceIntent },
    DeleteNamedInstance { delete_named_instance: DeleteNamedInstanceIntent },
    DeleteSource { delete_source: DeleteSourceIntent },
    CreateSource { create_source: CreateSourceIntent },
    UpdateSource { update_source: UpdateSourceIntent },
    CreateGlyphLayer { create_glyph_layer: CreateGlyphLayerIntent },
    CloneGlyphLayer { clone_glyph_layer: CloneGlyphLayerIntent },
    MaterializeGlyphLayer { materialize_glyph_layer: MaterializeGlyphLayerIntent },
}

impl TryFrom<AddPointsIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: AddPointsIntent) -> WireResult<Self> {
        Ok(AddPoints {
            layer_id: parse::<LayerId>(&wire.layer_id)?,
            contour_id: wire
                .contour_id
                .map(|id| parse::<ContourId>(&id))
                .transpose()?,
            before: wire.before.map(|id| parse::<PointId>(&id)).transpose()?,
            points: convert_all(wire.points)?,
        }
        .into())
    }
}

impl TryFrom<AddContourIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: AddContourIntent) -> WireResult<Self> {
        Ok(AddContour {
            layer_id: parse::<LayerId>(&wire.layer_id)?,
            contour_id: parse::<ContourId>(&wire.contour_id)?,
            closed: wire.closed,
        }
        .into())
    }
}

impl TryFrom<SetContourClosedIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: SetContourClosedIntent) -> WireResult<Self> {
        Ok(SetContourClosed {
            layer_id: parse::<LayerId>(&wire.layer_id)?,
            contour_id: parse::<ContourId>(&wire.contour_id)?,
            closed: wire.closed,
        }
        .into())
    }
}

impl TryFrom<MovePointsIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: MovePointsIntent) -> WireResult<Self> {
        Ok(MovePoints {
            layer_id: parse::<LayerId>(&wire.layer_id)?,
            point_ids: parse_id_list::<PointId>(&wire.point_ids)?,
            coords: wire.coords,
        }
        .into())
    }
}

impl TryFrom<SetPointSmoothIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: SetPointSmoothIntent) -> WireResult<Self> {
        Ok(SetPointSmooth {
            layer_id: parse::<LayerId>(&wire.layer_id)?,
            point_id: parse::<PointId>(&wire.point_id)?,
            smooth: wire.smooth,
        }
        .into())
    }
}

impl TryFrom<RemovePointsIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: RemovePointsIntent) -> WireResult<Self> {
        Ok(RemovePoints {
            layer_id: parse::<LayerId>(&wire.layer_id)?,
            point_ids: parse_id_list::<PointId>(&wire.point_ids)?,
        }
        .into())
    }
}

impl TryFrom<AddAnchorsIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: AddAnchorsIntent) -> WireResult<Self> {
        Ok(AddAnchors {
            layer_id: parse::<LayerId>(&wire.layer_id)?,
            anchors: convert_all(wire.anchors)?,
        }
        .into())
    }
}

impl TryFrom<SetPositionsIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: SetPositionsIntent) -> WireResult<Self> {
        Ok(SetPositions {
            layer_id: parse::<LayerId>(&wire.layer_id)?,
            positions: wire.positions,
        }
        .into())
    }
}

impl TryFrom<MoveAnchorsIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: MoveAnchorsIntent) -> WireResult<Self> {
        Ok(MoveAnchors {
            layer_id: parse::<LayerId>(&wire.layer_id)?,
            anchor_ids: parse_id_list::<AnchorId>(&wire.anchor_ids)?,
            coords: wire.coords,
        }
        .into())
    }
}

impl TryFrom<RemoveAnchorsIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: RemoveAnchorsIntent) -> WireResult<Self> {
        Ok(RemoveAnchors {
            layer_id: parse::<LayerId>(&wire.layer_id)?,
            anchor_ids: parse_id_list::<AnchorId>(&wire.anchor_ids)?,
        }
        .into())
    }
}

impl TryFrom<RenameAnchorsIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: RenameAnchorsIntent) -> WireResult<Self> {
        Ok(RenameAnchors {
            layer_id: parse::<LayerId>(&wire.layer_id)?,
            anchor_ids: parse_id_list::<AnchorId>(&wire.anchor_ids)?,
            names: wire.names,
        }
        .into())
    }
}

impl TryFrom<AddComponentIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: AddComponentIntent) -> WireResult<Self> {
        Ok(AddComponent {
            layer_id: parse::<LayerId>(&wire.layer_id)?,
            component_id: parse::<ComponentId>(&wire.component_id)?,
            base_glyph_id: parse::<GlyphId>(&wire.base_glyph_id)?,
        }
        .into())
    }
}

impl TryFrom<SetComponentTransformsIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: SetComponentTransformsIntent) -> WireResult<Self> {
        Ok(SetComponentTransforms {
            layer_id: parse::<LayerId>(&wire.layer_id)?,
            component_ids: parse_id_list::<ComponentId>(&wire.component_ids)?,
            transforms: wire.transforms,
        }
        .into())
    }
}

impl TryFrom<SetComponentAlignmentIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: SetComponentAlignmentIntent) -> WireResult<Self> {
        Ok(SetComponentAlignment {
            layer_id: parse::<LayerId>(&wire.layer_id)?,
            component_ids: parse_id_list::<ComponentId>(&wire.component_ids)?,
            alignment: parse_alignment(Some(&wire.alignment)),
        }
        .into())
    }
}

impl TryFrom<RemoveComponentsIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: RemoveComponentsIntent) -> WireResult<Self> {
        Ok(RemoveComponents {
            layer_id: parse::<LayerId>(&wire.layer_id)?,
            component_ids: parse_id_list::<ComponentId>(&wire.component_ids)?,
        }
        .into())
    }
}

impl TryFrom<DecomposeComponentsIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: DecomposeComponentsIntent) -> WireResult<Self> {
        Ok(DecomposeComponents {
            layer_id: parse::<LayerId>(&wire.layer_id)?,
            component_ids: parse_id_list::<ComponentId>(&wire.component_ids)?,
        }
        .into())
    }
}

impl TryFrom<ReverseContourIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: ReverseContourIntent) -> WireResult<Self> {
        Ok(ReverseContour {
            layer_id: parse::<LayerId>(&wire.layer_id)?,
            contour_id: parse::<ContourId>(&wire.contour_id)?,
        }
        .into())
    }
}

impl TryFrom<SetContourStartIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: SetContourStartIntent) -> WireResult<Self> {
        Ok(SetContourStart {
            layer_id: parse::<LayerId>(&wire.layer_id)?,
            contour_id: parse::<ContourId>(&wire.contour_id)?,
            point_id: parse::<PointId>(&wire.point_id)?,
        }
        .into())
    }
}

impl TryFrom<TranslatePointsIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: TranslatePointsIntent) -> WireResult<Self> {
        Ok(TranslatePoints {
            layer_id: parse::<LayerId>(&wire.layer_id)?,
            point_ids: parse_id_list::<PointId>(&wire.point_ids)?,
            dx: wire.dx,
            dy: wire.dy,
        }
        .into())
    }
}

/// The transform six affine values `[a, b, c, d, e, f]` describe.
fn affine(matrix: &[f64]) -> WireResult<Transform> {
    let [xx, xy, yx, yy, dx, dy] =
        <[f64; 6]>::try_from(matrix).map_err(|_| WireError::TransformLength(matrix.len()))?;
    Ok(Transform {
        xx,
        xy,
        yx,
        yy,
        dx,
        dy,
    })
}

impl TryFrom<TransformPointsIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: TransformPointsIntent) -> WireResult<Self> {
        Ok(TransformPoints {
            layer_id: parse::<LayerId>(&wire.layer_id)?,
            point_ids: parse_id_list::<PointId>(&wire.point_ids)?,
            transform: affine(&wire.matrix)?,
        }
        .into())
    }
}

impl TryFrom<AlignPointsIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: AlignPointsIntent) -> WireResult<Self> {
        Ok(AlignPoints {
            layer_id: parse::<LayerId>(&wire.layer_id)?,
            point_ids: parse_id_list::<PointId>(&wire.point_ids)?,
            alignment: wire.alignment.parse()?,
        }
        .into())
    }
}

impl TryFrom<DistributePointsIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: DistributePointsIntent) -> WireResult<Self> {
        Ok(DistributePoints {
            layer_id: parse::<LayerId>(&wire.layer_id)?,
            point_ids: parse_id_list::<PointId>(&wire.point_ids)?,
            axis: wire.axis.parse()?,
        }
        .into())
    }
}

impl TryFrom<ShiftSidebearingIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: ShiftSidebearingIntent) -> WireResult<Self> {
        Ok(ShiftSidebearing {
            layer_id: parse::<LayerId>(&wire.layer_id)?,
            sidebearing: wire.sidebearing.parse()?,
            delta: wire.delta,
        }
        .into())
    }
}

impl TryFrom<TransformLayerIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: TransformLayerIntent) -> WireResult<Self> {
        Ok(TransformLayer {
            layer_id: parse::<LayerId>(&wire.layer_id)?,
            transform: affine(&wire.matrix)?,
        }
        .into())
    }
}

impl TryFrom<SetXAdvanceIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: SetXAdvanceIntent) -> WireResult<Self> {
        Ok(SetXAdvance {
            layer_id: parse::<LayerId>(&wire.layer_id)?,
            width: wire.width,
        }
        .into())
    }
}

impl TryFrom<BooleanOpIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: BooleanOpIntent) -> WireResult<Self> {
        Ok(ApplyBooleanOp {
            layer_id: parse::<LayerId>(&wire.layer_id)?,
            contour_id_a: parse::<ContourId>(&wire.contour_id_a)?,
            contour_id_b: parse::<ContourId>(&wire.contour_id_b)?,
            operation: wire
                .operation
                .parse()
                .map_err(WireError::UnknownBooleanOp)?,
        }
        .into())
    }
}

impl TryFrom<DeletePointsIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: DeletePointsIntent) -> WireResult<Self> {
        Ok(DeletePoints {
            layer_id: parse::<LayerId>(&wire.layer_id)?,
            point_ids: parse_id_list::<PointId>(&wire.point_ids)?,
            mode: wire.mode.parse()?,
        }
        .into())
    }
}

impl TryFrom<SplitSegmentIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: SplitSegmentIntent) -> WireResult<Self> {
        Ok(SplitSegment {
            layer_id: parse::<LayerId>(&wire.layer_id)?,
            start_id: parse::<PointId>(&wire.start_id)?,
            end_id: parse::<PointId>(&wire.end_id)?,
            t: wire.t,
            point_id: parse::<PointId>(&wire.point_id)?,
        }
        .into())
    }
}

impl TryFrom<UpgradeLineToCubicIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: UpgradeLineToCubicIntent) -> WireResult<Self> {
        Ok(UpgradeLineToCubic {
            layer_id: parse::<LayerId>(&wire.layer_id)?,
            start_id: parse::<PointId>(&wire.start_id)?,
            end_id: parse::<PointId>(&wire.end_id)?,
        }
        .into())
    }
}

impl TryFrom<ContourEnd> for FontContourEnd {
    type Error = WireError;

    fn try_from(wire: ContourEnd) -> WireResult<Self> {
        Ok(Self {
            contour_id: parse::<ContourId>(&wire.contour_id)?,
            side: wire.side.parse()?,
        })
    }
}

impl TryFrom<JoinContoursIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: JoinContoursIntent) -> WireResult<Self> {
        Ok(JoinContours {
            layer_id: parse::<LayerId>(&wire.layer_id)?,
            from: wire.from.try_into()?,
            to: wire.to.try_into()?,
            mode: wire.mode.parse()?,
        }
        .into())
    }
}

impl TryFrom<CreateGlyphIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: CreateGlyphIntent) -> WireResult<Self> {
        Ok(CreateGlyph {
            glyph_id: Some(parse::<GlyphId>(&wire.glyph_id)?),
            name: wire.name,
            unicodes: wire.unicodes,
        }
        .into())
    }
}

impl TryFrom<UpdateGlyphIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: UpdateGlyphIntent) -> WireResult<Self> {
        Ok(UpdateGlyph {
            glyph_id: parse::<GlyphId>(&wire.glyph_id)?,
            new_name: wire.new_name.into(),
            new_unicodes: wire.new_unicodes,
        }
        .into())
    }
}

impl TryFrom<UpdateFontMetadataIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: UpdateFontMetadataIntent) -> WireResult<Self> {
        Ok(UpdateFontMetadata {
            metadata: wire.metadata.try_into()?,
        }
        .into())
    }
}

impl TryFrom<SetKerningValuesIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: SetKerningValuesIntent) -> WireResult<Self> {
        Ok(SetKerningValues {
            edits: convert_all(wire.edits)?,
        }
        .into())
    }
}

impl TryFrom<CreateKerningGroupIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: CreateKerningGroupIntent) -> WireResult<Self> {
        Ok(CreateKerningGroup {
            group_id: parse::<KerningGroupId>(&wire.group_id)?,
            position: wire.position.try_into()?,
            name: wire.name,
        }
        .into())
    }
}

impl TryFrom<SetKerningGroupMemberIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: SetKerningGroupMemberIntent) -> WireResult<Self> {
        Ok(SetKerningGroupMember {
            position: wire.position.try_into()?,
            glyph_id: parse::<GlyphId>(&wire.glyph_id)?,
            group_id: wire
                .group_id
                .as_deref()
                .map(parse::<KerningGroupId>)
                .transpose()?,
        }
        .into())
    }
}

impl TryFrom<RenameKerningGroupIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: RenameKerningGroupIntent) -> WireResult<Self> {
        Ok(RenameKerningGroup {
            group_id: parse::<KerningGroupId>(&wire.group_id)?,
            name: wire.name,
        }
        .into())
    }
}

impl TryFrom<DeleteKerningGroupIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: DeleteKerningGroupIntent) -> WireResult<Self> {
        Ok(DeleteKerningGroup {
            group_id: parse::<KerningGroupId>(&wire.group_id)?,
        }
        .into())
    }
}

impl TryFrom<SetLanguagesIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: SetLanguagesIntent) -> WireResult<Self> {
        Ok(SetLanguages {
            language_ids: wire.language_ids,
        }
        .into())
    }
}

impl TryFrom<CreateAxisIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: CreateAxisIntent) -> WireResult<Self> {
        Ok(CreateAxis {
            axis: wire.axis.try_into()?,
        }
        .into())
    }
}

impl TryFrom<UpdateAxisIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: UpdateAxisIntent) -> WireResult<Self> {
        Ok(UpdateAxis {
            axis: wire.axis.try_into()?,
        }
        .into())
    }
}

impl TryFrom<DeleteAxisIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: DeleteAxisIntent) -> WireResult<Self> {
        Ok(DeleteAxis {
            axis_id: parse::<AxisId>(&wire.axis_id)?,
        }
        .into())
    }
}

impl TryFrom<SetAxisMappingsIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: SetAxisMappingsIntent) -> WireResult<Self> {
        Ok(SetAxisMappings {
            mappings: convert_all(wire.mappings)?,
        }
        .into())
    }
}

impl TryFrom<SetMetricDefinitionsIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: SetMetricDefinitionsIntent) -> WireResult<Self> {
        Ok(SetMetricDefinitions {
            definitions: convert_all(wire.definitions)?,
        }
        .into())
    }
}

impl TryFrom<CreateNamedInstanceIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: CreateNamedInstanceIntent) -> WireResult<Self> {
        Ok(CreateNamedInstance {
            instance: wire.instance.try_into()?,
        }
        .into())
    }
}

impl TryFrom<UpdateNamedInstanceIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: UpdateNamedInstanceIntent) -> WireResult<Self> {
        Ok(UpdateNamedInstance {
            instance: wire.instance.try_into()?,
        }
        .into())
    }
}

impl TryFrom<DeleteNamedInstanceIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: DeleteNamedInstanceIntent) -> WireResult<Self> {
        Ok(DeleteNamedInstance {
            instance_id: parse::<NamedInstanceId>(&wire.instance_id)?,
        }
        .into())
    }
}

impl TryFrom<DeleteSourceIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: DeleteSourceIntent) -> WireResult<Self> {
        Ok(DeleteSource {
            source_id: parse::<SourceId>(&wire.source_id)?,
        }
        .into())
    }
}

impl TryFrom<CreateSourceIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: CreateSourceIntent) -> WireResult<Self> {
        Ok(CreateSource {
            source_id: parse::<SourceId>(&wire.source_id)?,
            name: wire.name,
            location: shift_font::DesignLocation::from_untyped(wire.location.try_into()?),
        }
        .into())
    }
}

impl TryFrom<UpdateSourceIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: UpdateSourceIntent) -> WireResult<Self> {
        let metric_values = wire
            .metric_values
            .into_iter()
            .map(|value| {
                Ok((
                    parse::<MetricId>(&value.metric_id)?,
                    MetricValue::new(value.position, value.overshoot),
                ))
            })
            .collect::<WireResult<_>>()?;
        Ok(UpdateSource {
            source_id: parse::<SourceId>(&wire.source_id)?,
            name: wire.name,
            location: shift_font::DesignLocation::from_untyped(wire.location.try_into()?),
            metric_values,
            italic_angle: wire.italic_angle,
            line_gap: wire.line_gap,
            underline_position: wire.underline_position,
            underline_thickness: wire.underline_thickness,
        }
        .into())
    }
}

impl TryFrom<CreateGlyphLayerIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: CreateGlyphLayerIntent) -> WireResult<Self> {
        Ok(CreateGlyphLayer {
            layer_id: parse::<LayerId>(&wire.layer_id)?,
            glyph_id: parse::<GlyphId>(&wire.glyph_id)?,
            source_id: parse::<SourceId>(&wire.source_id)?,
        }
        .into())
    }
}

impl TryFrom<CloneGlyphLayerIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: CloneGlyphLayerIntent) -> WireResult<Self> {
        Ok(CloneGlyphLayer {
            layer_id: parse::<LayerId>(&wire.layer_id)?,
            glyph_id: parse::<GlyphId>(&wire.glyph_id)?,
            source_id: parse::<SourceId>(&wire.source_id)?,
            from_layer_id: parse::<LayerId>(&wire.from_layer_id)?,
        }
        .into())
    }
}

/// A NAPI build reads this intent's `Float64Array` only through NAPI; serde
/// decodes it in builds without NAPI, such as the WebAssembly engine.
#[cfg(feature = "napi")]
impl<'de> serde::Deserialize<'de> for MaterializeGlyphLayerIntent {
    fn deserialize<D: serde::Deserializer<'de>>(_: D) -> Result<Self, D::Error> {
        Err(serde::de::Error::custom(
            "materializeGlyphLayer is only accepted over NAPI in this build",
        ))
    }
}

impl TryFrom<MaterializeGlyphLayerIntent> for font::FontIntent {
    type Error = WireError;

    fn try_from(wire: MaterializeGlyphLayerIntent) -> WireResult<Self> {
        Ok(MaterializeGlyphLayer {
            layer_id: parse::<LayerId>(&wire.layer_id)?,
            glyph_id: parse::<GlyphId>(&wire.glyph_id)?,
            source_id: parse::<SourceId>(&wire.source_id)?,
            from_layer_id: parse::<LayerId>(&wire.from_layer_id)?,
            values: shift_font::GlyphInterpolationValues::new(values_vec(wire.values)),
        }
        .into())
    }
}

impl TryFrom<PointSeed> for FontPointSeed {
    type Error = WireError;

    fn try_from(wire: PointSeed) -> WireResult<Self> {
        Ok(Self {
            id: parse::<PointId>(&wire.id)?,
            x: wire.x,
            y: wire.y,
            point_type: wire.point_type.into(),
            smooth: wire.smooth,
        })
    }
}

impl TryFrom<AnchorSeed> for FontAnchorSeed {
    type Error = WireError;

    fn try_from(wire: AnchorSeed) -> WireResult<Self> {
        Ok(Self {
            id: parse::<AnchorId>(&wire.id)?,
            name: wire.name,
            x: wire.x,
            y: wire.y,
        })
    }
}

impl TryFrom<Location> for FontLocation {
    type Error = WireError;

    fn try_from(wire: Location) -> WireResult<Self> {
        wire.values
            .into_iter()
            .map(|(axis_id, value)| Ok((parse::<AxisId>(&axis_id)?, value)))
            .collect()
    }
}

impl TryFrom<FontMetadata> for FontMetadataModel {
    type Error = WireError;

    fn try_from(wire: FontMetadata) -> WireResult<Self> {
        Ok(Self {
            family_name: wire.family_name,
            style_name: wire.style_name,
            version_major: wire.version_major,
            version_minor: wire.version_minor,
            copyright: wire.copyright,
            trademark: wire.trademark,
            designer: wire.designer,
            designer_url: wire.designer_url,
            manufacturer: wire.manufacturer,
            manufacturer_url: wire.manufacturer_url,
            license: wire.license,
            license_url: wire.license_url,
            description: wire.description,
            note: wire.note,
        })
    }
}

impl TryFrom<MetricDefinition> for FontMetricDefinition {
    type Error = WireError;

    fn try_from(wire: MetricDefinition) -> WireResult<Self> {
        let kind = match wire.kind {
            MetricKind::Ascender => FontMetricKind::Ascender,
            MetricKind::CapHeight => FontMetricKind::CapHeight,
            MetricKind::XHeight => FontMetricKind::XHeight,
            MetricKind::Baseline => FontMetricKind::Baseline,
            MetricKind::Descender => FontMetricKind::Descender,
            MetricKind::Custom => FontMetricKind::Custom,
        };
        Ok(Self::with_id(parse::<MetricId>(&wire.id)?, kind, wire.name))
    }
}

impl TryFrom<Axis> for FontAxis {
    type Error = WireError;

    fn try_from(wire: Axis) -> WireResult<Self> {
        let axis_id = parse::<AxisId>(&wire.id)?;
        let mut mapped = match wire.axis_type {
            AxisType::Continuous => Self::continuous_with_id(
                axis_id,
                wire.tag,
                wire.name,
                wire.minimum.ok_or(WireError::ContinuousAxisWithoutBounds)?,
                wire.default,
                wire.maximum.ok_or(WireError::ContinuousAxisWithoutBounds)?,
            ),
            AxisType::Discrete => Self::discrete_with_id(
                axis_id,
                wire.tag,
                wire.name,
                wire.values.ok_or(WireError::DiscreteAxisWithoutValues)?,
                wire.default,
            ),
        };
        mapped.set_role(match wire.role {
            AxisRole::External => FontAxisRole::External,
            AxisRole::Internal => FontAxisRole::Internal,
        });
        let mut labels = Vec::new();
        for label in wire.labels {
            let range = match (label.minimum, label.maximum) {
                (None, None) => None,
                (Some(minimum), Some(maximum)) => Some(AxisLabelRange { minimum, maximum }),
                _ => {
                    return Err(WireError::IncompleteAxisLabelRange);
                }
            };
            labels.push(FontAxisLabel::with_id(
                parse::<AxisLabelId>(&label.id)?,
                label.name,
                label.value,
                range,
                label.linked_value,
                label.elidable,
            ));
        }
        mapped.set_labels(labels);
        mapped.set_hidden(wire.hidden);
        mapped.validate()?;
        Ok(mapped)
    }
}

impl TryFrom<NamedInstance> for FontNamedInstance {
    type Error = WireError;

    fn try_from(wire: NamedInstance) -> WireResult<Self> {
        Ok(Self::with_id(
            parse::<NamedInstanceId>(&wire.id)?,
            wire.name,
            shift_font::ExternalLocation::from_untyped(wire.location.try_into()?),
            wire.postscript_name,
        ))
    }
}

impl TryFrom<AxisMapping> for FontAxisMapping {
    type Error = WireError;

    fn try_from(wire: AxisMapping) -> WireResult<Self> {
        let mut mapped = Self::with_id(
            parse::<AxisMappingId>(&wire.id)?,
            wire.name,
            parse_id_list::<AxisId>(&wire.inputs)?,
            parse_id_list::<AxisId>(&wire.outputs)?,
            wire.points
                .into_iter()
                .map(|point| {
                    Ok(FontAxisMappingPoint {
                        description: point.description,
                        input: point.input.try_into()?,
                        output: point.output.try_into()?,
                    })
                })
                .collect::<WireResult<Vec<_>>>()?,
        );
        mapped.set_description(wire.description);
        Ok(mapped)
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Decodes an intent in the shape the editor sends it.
    fn intent(json: &str) -> WireResult<font::FontIntent> {
        serde_json::from_str::<FontIntent>(json)
            .expect("the editor's shape deserializes")
            .try_into()
    }

    #[test]
    fn layer_intents_decode_from_the_editors_shape() {
        let font::FontIntent::AddPoints(added) = intent(
            r#"{"kind":"addPoints","addPoints":{"layerId":"layer_aaaaaaaaaa",
                "contourId":"contour_aaaaaaaaaa",
                "points":[{"id":"point_aaaaaaaaaa","x":1,"y":2,"pointType":"onCurve","smooth":true}]}}"#,
        )
        .unwrap() else {
            panic!("addPoints decodes to AddPoints");
        };
        assert_eq!(added.layer_id, LayerId::from_raw("aaaaaaaaaa"));
        assert_eq!(added.points.len(), 1);
        assert_eq!(added.points[0].point_type, IrPointType::OnCurve);
        assert!(added.points[0].smooth);

        assert!(matches!(
            intent(
                r#"{"kind":"movePoints","movePoints":{"layerId":"layer_aaaaaaaaaa",
                    "pointIds":["point_aaaaaaaaaa"],"coords":[3,4]}}"#
            ),
            Ok(font::FontIntent::MovePoints(_))
        ));
    }

    #[test]
    fn font_intents_decode_string_enums_in_camel_case() {
        let group = KerningGroupId::new();
        let font::FontIntent::SetKerningValues(set) = intent(&format!(
            r#"{{"kind":"setKerningValues","setKerningValues":{{"edits":[{{
                "sourceId":"source_aaaaaaaaaa",
                "first":{{"kind":"glyph","id":"glyph_aaaaaaaaaa"}},
                "second":{{"kind":"group","id":"{group}"}},
                "amount":-20}}]}}}}"#
        ))
        .unwrap() else {
            panic!("setKerningValues decodes to SetKerningValues");
        };
        assert_eq!(set.edits[0].value, Some(-20.0));
        assert!(matches!(
            &set.edits[0].pair.second,
            FontKerningSide::Group(_)
        ));
    }

    #[test]
    fn an_unknown_kind_or_a_missing_payload_does_not_deserialize() {
        assert!(serde_json::from_str::<FontIntent>(r#"{"kind":"movePoints"}"#).is_err());
        assert!(
            serde_json::from_str::<FontIntent>(r#"{"kind":"teleport","teleport":{}}"#).is_err()
        );
    }

    #[test]
    fn a_malformed_id_names_its_kind() {
        let error = intent(
            r#"{"kind":"movePoints","movePoints":{"layerId":"not a layer",
                "pointIds":[],"coords":[]}}"#,
        )
        .unwrap_err();
        assert!(matches!(
            error,
            WireError::InvalidId {
                kind: IdKind::Layer,
                ..
            }
        ));
        assert_eq!(error.to_string(), "invalid layer ID: not a layer");
    }
}
