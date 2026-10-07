//! Reports of authored metadata and source metrics, never compiled line-height estimates.

use std::path::PathBuf;

use serde::Serialize;
use shift_font::{Font, FontMetadata, MetricKind, Source, SourceRole};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontInfoReport {
    pub document: PathBuf,
    #[serde(flatten)]
    pub metadata: FontMetadata,
    pub version: Option<String>,
    pub units_per_em: f64,
    pub source: SourceMetrics,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceMetrics {
    pub source_id: String,
    pub name: String,
    pub role: SourceRole,
    pub ascender: Option<f64>,
    pub descender: Option<f64>,
    pub x_height: Option<f64>,
    pub cap_height: Option<f64>,
    pub line_gap: Option<f64>,
    pub italic_angle: Option<f64>,
}

impl FontInfoReport {
    pub fn render(&self) -> String {
        let metadata = &self.metadata;
        let mut lines = vec![self.document.display().to_string(), String::new()];
        for (label, value) in [
            ("Family", metadata.family_name.as_deref()),
            ("Style", metadata.style_name.as_deref()),
            ("Version", self.version.as_deref()),
            ("Copyright", metadata.copyright.as_deref()),
            ("Designer", metadata.designer.as_deref()),
            ("Designer URL", metadata.designer_url.as_deref()),
            ("License", metadata.license.as_deref()),
            ("License URL", metadata.license_url.as_deref()),
        ] {
            if let Some(value) = value {
                lines.push(format!("{label}: {value}"));
            }
        }
        lines.push(format!("Units per em: {}", self.units_per_em));
        lines.push(String::new());
        lines.push(self.source.render());
        lines.join("\n")
    }
}

impl SourceMetrics {
    pub(crate) fn from_source(font: &Font, source: &Source) -> Self {
        let position = |kind| {
            font.metric_value(source.id(), kind)
                .map(|value| value.position)
        };
        Self {
            source_id: source.id().to_string(),
            name: source.name().to_string(),
            role: source.role(),
            ascender: position(MetricKind::Ascender),
            descender: position(MetricKind::Descender),
            x_height: position(MetricKind::XHeight),
            cap_height: position(MetricKind::CapHeight),
            line_gap: source.line_gap(),
            italic_angle: source.italic_angle(),
        }
    }

    pub(crate) fn render(&self) -> String {
        let mut lines = vec![format!("Source: {} ({})", self.name, self.source_id)];
        for (label, value) in [
            ("Ascender", self.ascender),
            ("Descender", self.descender),
            ("x-height", self.x_height),
            ("Cap height", self.cap_height),
            ("Line gap", self.line_gap),
            ("Italic angle", self.italic_angle),
        ] {
            if let Some(value) = value {
                lines.push(format!("  {label}: {value}"));
            }
        }
        lines.join("\n")
    }
}

pub(crate) fn format_version(major: Option<i32>, minor: Option<i32>) -> Option<String> {
    major.map(|major| format!("{major}.{:03}", minor.unwrap_or_default()))
}
