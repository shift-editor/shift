//! Identity-free JSON contracts for CLI authoring.

use serde::Deserialize;
use std::collections::BTreeMap;

use shift_font::{DecomposedTransform, MetricsKeySide, PointType};

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
    #[serde(default)]
    pub components: Vec<ComponentInput>,
    /// Metrics keys for this layer's source only, overriding the glyph's.
    #[serde(default)]
    pub metrics_keys: Option<MetricsKeysInput>,
}

/// Metrics keys such as `=space` or `=n+10`, by side (`left`, `right`,
/// `width`). An omitted side keeps its key; empty or blank text clears it.
#[derive(Debug, Default, Clone, PartialEq, Eq, Deserialize)]
#[serde(try_from = "BTreeMap<String, String>")]
pub(super) struct MetricsKeysInput(pub BTreeMap<MetricsKeySide, String>);

impl TryFrom<BTreeMap<String, String>> for MetricsKeysInput {
    type Error = String;

    fn try_from(keys: BTreeMap<String, String>) -> Result<Self, Self::Error> {
        keys.into_iter()
            .map(|(name, text)| {
                let side = match name.as_str() {
                    "left" => MetricsKeySide::Left,
                    "right" => MetricsKeySide::Right,
                    "width" => MetricsKeySide::Width,
                    _ => {
                        return Err(format!(
                            "unknown metrics key side `{name}`, expected `left`, `right` or `width`"
                        ));
                    }
                };
                Ok((side, text))
            })
            .collect::<Result<_, _>>()
            .map(Self)
    }
}

/// A reference to another glyph, by name, placed with an optional transform.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ComponentInput {
    pub base: String,
    #[serde(default)]
    pub transform: Option<TransformInput>,
}

/// A component transform: Shift's decomposed form, or an affine
/// `[xx, xy, yx, yy, dx, dy]` as UFO and most font tools write it.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub(super) enum TransformInput {
    Affine([f64; 6]),
    Decomposed(DecomposedTransform),
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
    /// The batch format version; absent means the first.
    #[serde(default)]
    pub format: Option<u32>,
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
    /// Metrics keys that apply in every source the glyph's layers do not override.
    #[serde(default)]
    pub metrics_keys: Option<MetricsKeysInput>,
    #[serde(default)]
    pub layer: Option<LayerInput>,
}
