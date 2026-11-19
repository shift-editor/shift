//! The report `shift proof` prints after writing an image.

use crate::Report;
use serde::Serialize;
use shift_backends::ConditionalComponentRef;
use shift_proof::{ImageFormat, ProofMode, ProofReport};

/// A written proof: where the image went plus everything it shows.
#[derive(Debug, Serialize)]
pub(crate) struct ProofSummary {
    pub output: String,
    #[serde(flatten)]
    pub report: ProofReport,
    /// Where the proof draws the font differently from the editor.
    pub warnings: Vec<ProofWarning>,
}

/// Conditional components named in a warning's text before the rest are
/// counted.
const LISTED_COMPONENTS: usize = 5;

/// Something the proof draws differently from the editor.
#[derive(Debug, Serialize)]
#[serde(tag = "code", rename_all = "kebab-case")]
pub(crate) enum ProofWarning {
    /// The compiled font has no place for component conditions, so it draws
    /// these components everywhere, where the editor draws each only where
    /// its condition holds.
    ComponentConditionsDrawnEverywhere {
        message: String,
        components: Vec<ConditionalComponentRef>,
    },
}

impl ProofWarning {
    /// The warning for `components`, drawn everywhere; `None` when there are
    /// none.
    pub(crate) fn components_drawn_everywhere(
        components: &[ConditionalComponentRef],
    ) -> Option<Self> {
        if components.is_empty() {
            return None;
        }
        let mut listed: Vec<String> = components
            .iter()
            .take(LISTED_COMPONENTS)
            .map(|component| {
                format!(
                    "{}: component {} ({})",
                    component.glyph, component.position, component.base
                )
            })
            .collect();
        if let Some(more) = components.len().checked_sub(LISTED_COMPONENTS)
            && more > 0
        {
            listed.push(format!("and {more} more"));
        }
        let count = components.len();
        let plural = if count == 1 { "" } else { "s" };
        Some(Self::ComponentConditionsDrawnEverywhere {
            message: format!(
                "compiled fonts can't hold component conditions yet, so this proof draws {count} conditional component{plural} everywhere: {}",
                listed.join(", ")
            ),
            components: components.to_vec(),
        })
    }

    /// The warning as one line of text.
    pub(crate) fn message(&self) -> &str {
        match self {
            Self::ComponentConditionsDrawnEverywhere { message, .. } => message,
        }
    }
}

impl ProofSummary {
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

impl Report for ProofSummary {
    /// Formats the report as short plain-text lines for terminals.
    fn render(&self) -> String {
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
}
