//! The proof definition: what to set, at which sizes and locations.
//!
//! A definition is data. The CLI reads it from JSON; later hosts (live MCP
//! proofs, canvas proof blocks) render the same definition.

use serde::Deserialize;

use crate::ProofError;

/// Sections to set, in order, and how the page is laid out.
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ProofDefinition {
    #[serde(default)]
    pub page: PageSettings,
    pub sections: Vec<ProofSection>,
}

/// Page-wide layout choices.
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, default)]
pub struct PageSettings {
    /// Page width in pixels; text wraps at word boundaries. `None` fits the content.
    pub width: Option<u32>,
    /// Draws ascender, cap height, x-height, baseline, and descender guides
    /// behind each section's largest row.
    pub metrics: bool,
}

/// One part of a proof.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum ProofSection {
    /// One string at one size, once per location.
    Text {
        text: String,
        #[serde(default = "default_size")]
        size: f32,
        /// Each entry is one location, `TAG=VALUE` pairs separated by commas.
        /// Empty sets the text once at the default location.
        #[serde(default)]
        locations: Vec<String>,
    },
    /// One string at descending sizes.
    Waterfall {
        text: String,
        #[serde(default = "default_sizes")]
        sizes: Vec<f32>,
        #[serde(default)]
        location: Option<String>,
    },
    /// A grid of glyphs by name, or every drawn glyph.
    Glyphs {
        glyphs: GlyphSelection,
        #[serde(default = "default_glyph_size")]
        size: f32,
        #[serde(default)]
        location: Option<String>,
    },
    /// The same string across the font's sources, named instances, or an axis sweep.
    Locations {
        text: String,
        across: Across,
        #[serde(default = "default_location_size")]
        size: f32,
    },
}

/// Which glyphs a [`ProofSection::Glyphs`] section shows.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum GlyphSelection {
    /// `"drawn"`: every glyph with an outline, in font order.
    Keyword(GlyphKeyword),
    /// Glyph names, in the order given.
    Names(Vec<String>),
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GlyphKeyword {
    Drawn,
}

/// What a [`ProofSection::Locations`] section steps through.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum Across {
    Keyword(AcrossKeyword),
    /// Evenly spaced values from the axis minimum to its maximum.
    Axis {
        axis: String,
        steps: u32,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AcrossKeyword {
    /// Every source of the font document, at its own location.
    Sources,
    /// Every named instance of the compiled font.
    Instances,
}

fn default_size() -> f32 {
    72.0
}

fn default_sizes() -> Vec<f32> {
    vec![96.0, 48.0, 24.0, 12.0]
}

fn default_glyph_size() -> f32 {
    96.0
}

fn default_location_size() -> f32 {
    48.0
}

impl ProofDefinition {
    /// Parses a definition from JSON, rejecting unknown fields.
    ///
    /// # Errors
    ///
    /// Returns [`ProofError::Definition`] with the line and column of the problem.
    pub fn from_json(json: &str) -> Result<Self, ProofError> {
        let definition: Self = serde_json::from_str(json).map_err(|error| {
            ProofError::Definition(format!(
                "{error} (line {}, column {})",
                error.line(),
                error.column()
            ))
        })?;
        definition.validate()?;
        Ok(definition)
    }

    /// A one-section definition that sets `text` at `size`, for quick checks.
    pub fn text(text: impl Into<String>, size: f32, location: Option<String>) -> Self {
        Self {
            page: PageSettings::default(),
            sections: vec![ProofSection::Text {
                text: text.into(),
                size,
                locations: location.into_iter().collect(),
            }],
        }
    }

    fn validate(&self) -> Result<(), ProofError> {
        if self.sections.is_empty() {
            return Err(ProofError::Definition(
                "a proof needs at least one section".into(),
            ));
        }
        for (index, section) in self.sections.iter().enumerate() {
            let invalid = |message: &str| {
                Err(ProofError::Definition(format!(
                    "section {}: {message}",
                    index + 1
                )))
            };
            let sizes: &[f32] = match section {
                ProofSection::Text { size, .. }
                | ProofSection::Glyphs { size, .. }
                | ProofSection::Locations { size, .. } => std::slice::from_ref(size),
                ProofSection::Waterfall { sizes, .. } => sizes,
            };
            if sizes.is_empty() {
                return invalid("needs at least one size");
            }
            if sizes
                .iter()
                .any(|size| !size.is_finite() || *size <= 0.0 || *size > 1000.0)
            {
                return invalid("sizes must be between 0 and 1000 pixels");
            }
            if let ProofSection::Locations {
                across: Across::Axis { steps, .. },
                ..
            } = section
            {
                if !(2..=50).contains(steps) {
                    return invalid("an axis sweep needs between 2 and 50 steps");
                }
            }
        }
        Ok(())
    }
}

/// Axis tags with user-space values.
pub type UserLocation = Vec<(String, f32)>;

/// Parses `TAG=VALUE` pairs separated by commas.
///
/// # Errors
///
/// Returns [`ProofError::Location`] for a malformed pair or a non-finite value.
pub fn parse_location(text: &str) -> Result<UserLocation, ProofError> {
    text.split(',')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(|part| {
            let (tag, value) = part
                .split_once('=')
                .ok_or_else(|| ProofError::Location(format!("{part:?} is not TAG=VALUE")))?;
            let value: f32 = value
                .trim()
                .parse()
                .ok()
                .filter(|value: &f32| value.is_finite())
                .ok_or_else(|| ProofError::Location(format!("{part:?} has no finite value")))?;
            Ok((tag.trim().to_string(), value))
        })
        .collect()
}
