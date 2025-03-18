use crate::glyph::Glyph;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use ts_rs::TS;

#[derive(Serialize, Deserialize, Debug, Clone, TS)]
#[ts(export, rename_all = "camelCase")]
pub struct FontMetadata {
    pub family: String,
    pub style_name: String,
    pub version: i32,
}

impl Default for FontMetadata {
    fn default() -> Self {
        Self {
            family: "Untitled Font".to_string(),
            style_name: "Regular".to_string(),
            version: 1,
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Metrics {
    pub units_per_em: f64,
    pub ascender: f64,
    pub descender: f64,
    pub cap_height: f64,
    pub x_height: f64,
}

impl Default for Metrics {
    fn default() -> Self {
        Metrics {
            units_per_em: 1000.0,
            ascender: 750.0,
            descender: -200.0,
            cap_height: 700.0,
            x_height: 500.0,
        }
    }
}

#[derive(Serialize, Clone, TS)]
#[ts(export)]
pub struct Font {
    pub metadata: FontMetadata,
    pub metrics: Metrics,
    pub glyphs: HashMap<char, Glyph>,
}

impl Default for Font {
    fn default() -> Self {
        Self {
            metadata: FontMetadata::default(),
            metrics: Metrics::default(),
            glyphs: HashMap::new(),
        }
    }
}
