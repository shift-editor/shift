//! The structured description of a rendered proof.

use serde::Serialize;

use crate::layout::{Guide, LocatedFont, Page};
use crate::palette::Rgb;
use crate::shape::GlyphReport;
use crate::text::line_characters;
use crate::{
    AxisValue, FeatureSetting, ImageFormat, LanguageSetting, ProofMetrics, ProofMode,
    ScriptSetting, ShapingOptions, TextDirection,
};

/// Describes a rendered proof image so a reader who cannot see it knows
/// what it shows.
///
/// Pixel values are in image pixels from the top-left corner; font-unit
/// values are at the row's location with y up.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofReport {
    pub format: ImageFormat,
    pub mode: ProofMode,
    /// Image width in pixels.
    pub width: u32,
    /// Image height in pixels.
    pub height: u32,
    /// Sizes in pixels per em, in the order each line was set.
    pub sizes: Vec<f32>,
    /// Feature settings applied on top of the font's defaults.
    pub features: Vec<FeatureSetting>,
    pub script: Option<ScriptSetting>,
    pub language: Option<LanguageSetting>,
    /// Direction requested; each row reports the direction it was set in.
    pub direction: Option<TextDirection>,
    /// Every location set, in order; rows and grids refer to them by index.
    pub locations: Vec<LocationReport>,
    pub lines: Vec<LineReport>,
    /// Text rows drawn top to bottom (or columns left to right): every line
    /// at every size at every location, split further when a fixed width
    /// wraps text. Empty for a grid.
    pub rows: Vec<RowReport>,
    /// One grid per location; empty for text.
    pub grids: Vec<GridReport>,
    /// Unmapped characters across all lines, in order of first appearance.
    pub missing_characters: Vec<MissingCharacter>,
    /// `/name` tokens the font has no glyph for, in order of first
    /// appearance.
    pub missing_glyph_names: Vec<String>,
}

/// One location a proof is set at.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocationReport {
    pub label: String,
    /// Every font axis at the user-space value used.
    pub axes: Vec<AxisValue>,
    pub metrics: ProofMetrics,
    /// Guides drawn at this location; empty unless guides were asked for.
    pub guides: Vec<GuideReport>,
}

/// One requested proof line.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LineReport {
    pub text: String,
    pub missing_characters: Vec<MissingCharacter>,
    pub missing_glyph_names: Vec<String>,
}

/// One drawn text row.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RowReport {
    /// Index into [`ProofReport::lines`].
    pub line: usize,
    /// Index into [`ProofReport::locations`].
    pub location: usize,
    pub text: String,
    /// Pixels per em.
    pub size: f32,
    /// Pen origin of the first glyph, in pixels; the column centre for
    /// vertical text.
    pub x: f32,
    /// Baseline in pixels; the column top for vertical text.
    pub baseline: f32,
    /// Advance of the set text along the line, in pixels.
    pub width: f32,
    pub direction: TextDirection,
    /// Glyphs in visual order.
    pub glyphs: Vec<GlyphReport>,
}

/// The glyph grid at one location.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GridReport {
    /// Index into [`ProofReport::locations`].
    pub location: usize,
    pub cells: Vec<CellReport>,
}

/// One grid cell.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CellReport {
    /// Name printed under the glyph: its glyph name, or what was asked for
    /// when the font lacks it.
    pub label: String,
    /// Pen origin in pixels.
    pub x: f32,
    /// Baseline in pixels.
    pub baseline: f32,
    #[serde(flatten)]
    pub glyph: GlyphReport,
}

/// A character the font's character map does not cover.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct MissingCharacter {
    pub character: String,
    /// Code point as `U+XXXX`.
    pub unicode: String,
}

impl MissingCharacter {
    fn new(character: char) -> Self {
        Self {
            character: character.to_string(),
            unicode: format!("U+{:04X}", u32::from(character)),
        }
    }
}

/// A metric guide and where it sits above the baseline.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuideReport {
    pub name: &'static str,
    /// Stroke color.
    pub color: Rgb,
    pub font_units: f32,
}

/// The parts of a report that come from the request rather than the page.
pub(crate) struct ReportContext<'r> {
    pub format: ImageFormat,
    pub mode: ProofMode,
    pub sizes: Vec<f32>,
    pub shaping: &'r ShapingOptions,
    pub guides: bool,
}

pub(crate) fn build_report(
    fonts: &[LocatedFont],
    page: &Page,
    lines: &[String],
    context: ReportContext,
) -> ProofReport {
    let locations = fonts
        .iter()
        .map(|located| location_report(located, context.guides))
        .collect();
    let font = &fonts[0].font;
    let missing = |text: &str| -> Vec<MissingCharacter> {
        font.missing_characters(&line_characters(text))
            .into_iter()
            .map(MissingCharacter::new)
            .collect()
    };
    let line_reports: Vec<LineReport> = lines
        .iter()
        .map(|text| LineReport {
            text: text.clone(),
            missing_characters: missing(text),
            missing_glyph_names: font.missing_glyph_names(text),
        })
        .collect();

    let mut rows = Vec::new();
    let mut grids: Vec<GridReport> = Vec::new();
    for row in &page.rows {
        let located = &fonts[row.location].font;
        let glyphs = located.glyph_reports(&row.run);
        if context.mode == ProofMode::Grid {
            if grids
                .last()
                .is_none_or(|grid| grid.location != row.location)
            {
                grids.push(GridReport {
                    location: row.location,
                    cells: Vec::new(),
                });
            }
            if let (Some(grid), Some(glyph)) = (grids.last_mut(), glyphs.into_iter().next()) {
                grid.cells.push(CellReport {
                    label: row.text.clone(),
                    x: row.origin_x,
                    baseline: row.baseline,
                    glyph,
                });
            }
            continue;
        }
        rows.push(RowReport {
            line: row.line,
            location: row.location,
            text: row.text.clone(),
            size: row.size,
            x: row.origin_x,
            baseline: row.baseline,
            width: row.run.advance * row.scale,
            direction: row.run.direction,
            glyphs,
        });
    }

    ProofReport {
        format: context.format,
        mode: context.mode,
        width: page.width,
        height: page.height,
        sizes: context.sizes,
        features: context.shaping.features.clone(),
        script: context.shaping.script.clone(),
        language: context.shaping.language.clone(),
        direction: context.shaping.direction,
        locations,
        missing_characters: first_appearances(
            line_reports
                .iter()
                .flat_map(|line| &line.missing_characters),
        ),
        missing_glyph_names: first_appearances(
            line_reports
                .iter()
                .flat_map(|line| &line.missing_glyph_names),
        ),
        lines: line_reports,
        rows,
        grids,
    }
}

fn location_report(located: &LocatedFont, guides: bool) -> LocationReport {
    let metrics = located.font.metrics();
    let guides = if guides {
        Guide::ALL
            .into_iter()
            .filter_map(|guide| {
                Some(GuideReport {
                    name: guide.name(),
                    color: guide.color(),
                    font_units: guide.position(&metrics)?,
                })
            })
            .collect()
    } else {
        Vec::new()
    };
    LocationReport {
        label: located.label.clone(),
        axes: located.font.location().to_vec(),
        metrics,
        guides,
    }
}

fn first_appearances<'t, T: Clone + PartialEq + 't>(items: impl Iterator<Item = &'t T>) -> Vec<T> {
    let mut unique: Vec<T> = Vec::new();
    for item in items {
        if !unique.contains(item) {
            unique.push(item.clone());
        }
    }
    unique
}
