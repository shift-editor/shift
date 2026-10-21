//! The report `shift proof` prints after writing an image.

use serde::Serialize;
use shift_proof::{ImageFormat, ProofMode, ProofReport};

/// A written proof: where the image went plus everything it shows.
#[derive(Debug, Serialize)]
pub(crate) struct ProofSummary {
    pub output: String,
    #[serde(flatten)]
    pub report: ProofReport,
}

impl ProofSummary {
    /// Formats the report as short plain-text lines for terminals.
    pub(crate) fn render(&self) -> String {
        let report = &self.report;
        let format = match report.format {
            ImageFormat::Png => "png",
            ImageFormat::Svg => "svg",
        };
        let sizes: Vec<String> = report
            .sizes
            .iter()
            .map(|size| format!("{size}px"))
            .collect();
        let mut lines = vec![format!(
            "{}  {}x{} {format}",
            self.output, report.width, report.height
        )];
        lines.push(match report.mode {
            ProofMode::Text => format!(
                "rows  {} ({} lines at {}, {} locations)",
                report.rows.len(),
                report.lines.len(),
                sizes.join(", "),
                report.locations.len()
            ),
            ProofMode::Grid => format!(
                "grid  {} cells at {}, {} locations",
                report.grids.first().map_or(0, |grid| grid.cells.len()),
                sizes.join(", "),
                report.locations.len()
            ),
        });
        for location in &report.locations {
            let axes: Vec<String> = location.axes.iter().map(ToString::to_string).collect();
            lines.push(format!("location  {}  {}", location.label, axes.join(", ")));
        }
        let shaping = self.shaping();
        if !shaping.is_empty() {
            lines.push(format!("shaping  {}", shaping.join(", ")));
        }
        if let Some(location) = report.locations.first() {
            for guide in &location.guides {
                lines.push(format!(
                    "guide  {:<10} {}  {}",
                    guide.name, guide.color, guide.font_units
                ));
            }
        }
        lines.push(self.missing_line());
        if !report.missing_glyph_names.is_empty() {
            lines.push(format!(
                "missing  {} glyph names (drawn red): {}",
                report.missing_glyph_names.len(),
                report.missing_glyph_names.join(", ")
            ));
        }
        lines.join("\n")
    }

    fn shaping(&self) -> Vec<String> {
        let report = &self.report;
        let mut shaping: Vec<String> = report.features.iter().map(ToString::to_string).collect();
        if let Some(script) = &report.script {
            shaping.push(format!("script {script}"));
        }
        if let Some(language) = &report.language {
            shaping.push(format!("language {language}"));
        }
        if let Some(direction) = report.direction {
            shaping.push(format!("direction {direction}"));
        }
        shaping
    }

    fn missing_line(&self) -> String {
        let report = &self.report;
        if report.missing_characters.is_empty() {
            return "missing  none".to_string();
        }

        let missing: Vec<String> = report
            .missing_characters
            .iter()
            .map(|missing| {
                let character = match missing.character.as_str() {
                    " " => "space",
                    other => other,
                };
                format!("{character} {}", missing.unicode)
            })
            .collect();
        format!(
            "missing  {} characters (drawn red): {}",
            report.missing_characters.len(),
            missing.join(", ")
        )
    }
}
