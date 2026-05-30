const DEFAULT_FAMILY_NAME: &str = "Untitled Font";

pub struct NewDocument {
    pub family_name: String,
    pub units_per_em: i64,
}

impl Default for NewDocument {
    fn default() -> Self {
        Self {
            family_name: DEFAULT_FAMILY_NAME.to_string(),
            units_per_em: shift_ir::FontMetrics::default().units_per_em as i64,
        }
    }
}

impl NewDocument {
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
        shift_store::FontInfo {
            family_name: Some(self.family_name.clone()),
            copyright: None,
            trademark: None,
            description: None,
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
            units_per_em: self.units_per_em,
        }
    }
}
