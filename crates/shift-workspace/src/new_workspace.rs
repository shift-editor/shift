const DEFAULT_FAMILY_NAME: &str = "Untitled Font";

pub struct NewWorkspace {
    pub family_name: String,
    pub units_per_em: i64,
}

impl Default for NewWorkspace {
    fn default() -> Self {
        Self {
            family_name: DEFAULT_FAMILY_NAME.to_string(),
            units_per_em: shift_font::FontMetrics::default().units_per_em as i64,
        }
    }
}

impl NewWorkspace {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_family_name(family_name: impl Into<String>) -> Self {
        Self {
            family_name: family_name.into(),
            ..Self::default()
        }
    }

    pub(crate) fn font_info(&self) -> shift_store::FontInfo {
        let metrics = shift_font::FontMetrics {
            units_per_em: self.units_per_em as f64,
            ..shift_font::FontMetrics::default()
        };
        shift_store::FontInfo {
            family_name: Some(self.family_name.clone()),
            style_name: None,
            copyright: None,
            trademark: None,
            description: None,
            note: None,
            sample_text: None,
            designer: None,
            designer_url: None,
            manufacturer: None,
            manufacturer_url: None,
            license_description: None,
            license_info_url: None,
            vendor_id: None,
            version_major: Some(1),
            version_minor: Some(0),
            units_per_em: metrics.units_per_em,
            ascender: metrics.ascender,
            descender: metrics.descender,
            cap_height: metrics.cap_height,
            x_height: metrics.x_height,
            line_gap: metrics.line_gap,
            italic_angle: metrics.italic_angle,
            underline_position: metrics.underline_position,
            underline_thickness: metrics.underline_thickness,
            default_source_id: None,
        }
    }
}
