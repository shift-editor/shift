use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GlyphInspection {
    pub path: String,
    pub format: String,
    pub glyph: GlyphIdentity,
    pub location: GlyphLocation,
    pub summary: GlyphSummary,
    pub structure: GlyphStructure,
    pub components: Vec<ComponentInspection>,
    pub sources: Vec<SourceInspection>,
    pub variation: VariationInspection,
    pub resolved: ResolvedGlyph,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GlyphIdentity {
    pub id: String,
    pub name: String,
    pub unicodes: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GlyphLocation {
    pub external: Vec<LocationValue>,
    pub design: Vec<LocationValue>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocationValue {
    pub axis_tag: String,
    pub value: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GlyphSummary {
    pub advance: f64,
    pub bounds: Option<Bounds>,
    pub contour_count: usize,
    pub point_count: usize,
    pub anchor_count: usize,
    pub direct_component_count: usize,
    pub component_occurrence_count: usize,
    pub resolved_contour_count: usize,
    pub resolved_point_count: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Bounds {
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GlyphStructure {
    pub contours: Vec<ContourInspection>,
    pub anchors: Vec<AnchorInspection>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ContourInspection {
    pub id: String,
    pub closed: bool,
    pub points: Vec<PointInspection>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PointInspection {
    pub id: Option<String>,
    pub x: f64,
    pub y: f64,
    pub point_type: String,
    pub smooth: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AnchorInspection {
    pub id: String,
    pub name: Option<String>,
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ComponentInspection {
    pub order: usize,
    pub parent_glyph_id: String,
    pub parent_glyph_name: String,
    pub component_id: String,
    pub base_glyph_id: String,
    pub base_glyph_name: String,
    pub parent_path: Vec<String>,
    pub component_path: Vec<String>,
    pub decomposed_transform: DecomposedTransform,
    pub transform: AffineTransform,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DecomposedTransform {
    pub translate_x: f64,
    pub translate_y: f64,
    pub rotation: f64,
    pub scale_x: f64,
    pub scale_y: f64,
    pub skew_x: f64,
    pub skew_y: f64,
    pub center_x: f64,
    pub center_y: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AffineTransform {
    pub xx: f64,
    pub xy: f64,
    pub yx: f64,
    pub yy: f64,
    pub dx: f64,
    pub dy: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SourceInspection {
    pub id: String,
    pub name: String,
    pub master: bool,
    pub location: Vec<LocationValue>,
    pub layer: Option<LayerInspection>,
    pub compatible_with_reference: Option<bool>,
    pub differences: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LayerInspection {
    pub id: String,
    pub advance: f64,
    pub contour_count: usize,
    pub point_count: usize,
    pub anchor_count: usize,
    pub component_count: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VariationInspection {
    pub model: String,
    pub selection: String,
    pub exact_source: Option<SourceReference>,
    pub fallback_layer_id: String,
    pub reference_layer_id: Option<String>,
    pub exact_shape_source_ids: Vec<String>,
    pub source_weights: Vec<SourceWeight>,
    pub regions: Vec<VariationRegion>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SourceReference {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SourceWeight {
    pub source_id: String,
    pub source_name: String,
    pub weight: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VariationRegion {
    pub supports: Vec<VariationSupport>,
    pub scalar: f64,
    pub value_count: usize,
    pub non_zero_value_count: usize,
    pub values: Vec<f64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VariationSupport {
    pub axis_tag: String,
    pub minimum: f64,
    pub peak: f64,
    pub maximum: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResolvedGlyph {
    pub advance: f64,
    pub bounds: Option<Bounds>,
    pub contours: Vec<ResolvedContour>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResolvedContour {
    pub closed: bool,
    pub points: Vec<PointInspection>,
}
