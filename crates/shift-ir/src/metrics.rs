use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../packages/types/src/generated/")]
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

impl Default for FontMetrics {
    fn default() -> Self {
        Self {
            units_per_em: 1000.0,
            ascender: 800.0,
            descender: -200.0,
            cap_height: Some(700.0),
            x_height: Some(500.0),
            line_gap: None,
            italic_angle: None,
            underline_position: None,
            underline_thickness: None,
        }
    }
}

impl FontMetrics {
    pub fn new(units_per_em: f64, ascender: f64, descender: f64) -> Self {
        Self {
            units_per_em,
            ascender,
            descender,
            ..Self::default()
        }
    }

    pub fn em_height(&self) -> f64 {
        self.ascender - self.descender
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_metrics() {
        let m = FontMetrics::default();
        assert_eq!(m.units_per_em, 1000.0);
        assert_eq!(m.ascender, 800.0);
        assert_eq!(m.descender, -200.0);
        assert_eq!(m.em_height(), 1000.0);
    }
}
