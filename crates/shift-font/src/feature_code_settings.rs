//! How a font's feature code is linted and formatted, stored in the font lib
//! under [`FEATURE_CODE_SETTINGS_LIB_KEY`] so the choices travel with the font.

use std::collections::BTreeMap;

use crate::{LibData, LibValue};

/// The font lib key that holds [`FeatureCodeSettings`].
pub const FEATURE_CODE_SETTINGS_LIB_KEY: &str = "com.shift.feanor";

/// The indent unit formatted feature code uses.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum FeatureCodeIndent {
    /// Whatever the code already uses; four spaces when nothing is indented.
    #[default]
    Auto,
    /// This many spaces per level.
    Spaces(u8),
    /// One tab per level.
    Tab,
}

/// How a font's feature code is linted and formatted.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FeatureCodeSettings {
    /// The width classes are packed to and long rules wrapped at, in characters.
    pub line_width: u32,
    pub indent: FeatureCodeIndent,
    /// Keep statements aligned by hand aligned, with their columns recomputed.
    pub keep_alignment: bool,
    /// Lint rules never reported for this font, by code (`G001`) or name.
    pub ignored_rules: Vec<String>,
    /// Format the feature code each time the document is saved.
    pub format_on_save: bool,
}

impl Default for FeatureCodeSettings {
    fn default() -> Self {
        Self {
            line_width: 100,
            indent: FeatureCodeIndent::Auto,
            keep_alignment: true,
            ignored_rules: Vec::new(),
            format_on_save: false,
        }
    }
}

impl FeatureCodeSettings {
    /// The settings stored in `lib`; defaults for anything missing or malformed.
    pub fn from_lib(lib: &LibData) -> Self {
        let mut settings = Self::default();
        let Some(LibValue::Dict(values)) = lib.get(FEATURE_CODE_SETTINGS_LIB_KEY) else {
            return settings;
        };
        if let Some(width) = values.get("lineWidth").and_then(integer) {
            settings.line_width = u32::try_from(width).unwrap_or(settings.line_width).max(1);
        }
        settings.indent = match values.get("indent") {
            Some(LibValue::String(indent)) if indent == "tab" => FeatureCodeIndent::Tab,
            Some(value) => integer(value)
                .and_then(|spaces| u8::try_from(spaces).ok())
                .filter(|spaces| *spaces > 0)
                .map_or(FeatureCodeIndent::Auto, FeatureCodeIndent::Spaces),
            None => FeatureCodeIndent::Auto,
        };
        if let Some(LibValue::Boolean(keep)) = values.get("keepAlignment") {
            settings.keep_alignment = *keep;
        }
        if let Some(LibValue::Array(rules)) = values.get("ignore") {
            settings.ignored_rules = rules
                .iter()
                .filter_map(|rule| match rule {
                    LibValue::String(rule) => Some(rule.clone()),
                    _ => None,
                })
                .collect();
        }
        if let Some(LibValue::Boolean(format)) = values.get("formatOnSave") {
            settings.format_on_save = *format;
        }
        settings
    }

    /// The lib value that stores these settings; `None` when they are all defaults.
    pub fn to_lib_value(&self) -> Option<LibValue> {
        if *self == Self::default() {
            return None;
        }
        let indent = match self.indent {
            FeatureCodeIndent::Auto => LibValue::String("auto".to_string()),
            FeatureCodeIndent::Tab => LibValue::String("tab".to_string()),
            FeatureCodeIndent::Spaces(spaces) => LibValue::Integer(i64::from(spaces)),
        };
        let ignore = self
            .ignored_rules
            .iter()
            .cloned()
            .map(LibValue::String)
            .collect();
        Some(LibValue::Dict(BTreeMap::from([
            (
                "lineWidth".to_string(),
                LibValue::Integer(i64::from(self.line_width)),
            ),
            ("indent".to_string(), indent),
            (
                "keepAlignment".to_string(),
                LibValue::Boolean(self.keep_alignment),
            ),
            ("ignore".to_string(), LibValue::Array(ignore)),
            (
                "formatOnSave".to_string(),
                LibValue::Boolean(self.format_on_save),
            ),
        ])))
    }
}

fn integer(value: &LibValue) -> Option<i64> {
    match value {
        LibValue::Integer(value) => Some(*value),
        LibValue::UnsignedInteger(value) => i64::try_from(*value).ok(),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_round_trip_through_the_font_lib() {
        let settings = FeatureCodeSettings {
            line_width: 80,
            indent: FeatureCodeIndent::Spaces(2),
            keep_alignment: false,
            ignored_rules: vec!["G001".to_string(), "unused-class".to_string()],
            format_on_save: true,
        };
        let mut lib = LibData::new();
        lib.set(
            FEATURE_CODE_SETTINGS_LIB_KEY.to_string(),
            settings.to_lib_value().unwrap(),
        );

        assert_eq!(FeatureCodeSettings::from_lib(&lib), settings);
    }

    #[test]
    fn defaults_are_not_stored_and_missing_settings_read_as_defaults() {
        assert_eq!(FeatureCodeSettings::default().to_lib_value(), None);
        assert_eq!(
            FeatureCodeSettings::from_lib(&LibData::new()),
            FeatureCodeSettings::default()
        );
    }
}
