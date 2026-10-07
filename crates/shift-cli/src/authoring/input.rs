//! Identity-free JSON contracts for CLI authoring.

use serde::Deserialize;
use shift_font::PointType;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct LayerInput {
    pub advance: f64,
    #[serde(default)]
    pub contours: Option<Vec<ContourInput>>,
    /// SVG path data in font units, with Y up and no coordinate flipping.
    #[serde(default)]
    pub svg_path: Option<String>,
    #[serde(default)]
    pub anchors: Vec<AnchorInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ContourInput {
    pub closed: bool,
    pub points: Vec<PointInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct PointInput {
    pub x: f64,
    pub y: f64,
    #[serde(default)]
    pub point_type: PointType,
    #[serde(default)]
    pub smooth: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct AnchorInput {
    pub name: Option<String>,
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct GlyphBatchInput {
    // Deserialize entries separately so schema errors retain glyph/entry context.
    pub glyphs: Vec<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct GlyphEntryInput {
    pub name: String,
    #[serde(default)]
    pub unicodes: Option<Vec<String>>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub layer: Option<LayerInput>,
}
