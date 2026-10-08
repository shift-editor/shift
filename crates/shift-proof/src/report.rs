//! A structured description of a rendered proof: what was set where, and
//! what the font could not show.

use serde::Serialize;

use crate::layout::{ProofPage, Row};

/// Describes a rendered proof for scripts and agents.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofReport {
    /// Image size in pixels.
    pub width: u32,
    pub height: u32,
    pub units_per_em: u16,
    pub sections: Vec<SectionReport>,
    /// Characters any row could not show, in order of first appearance.
    pub missing_characters: Vec<String>,
    /// Glyph names a `glyphs` section asked for that the font lacks.
    pub missing_glyphs: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionReport {
    pub rows: Vec<RowReport>,
    pub missing_glyphs: Vec<String>,
}

/// One rendered row.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RowReport {
    /// The text set; empty for a glyph grid row.
    pub text: String,
    /// Glyph IDs in visual order.
    pub glyphs: Vec<u32>,
    /// Pixels per em.
    pub size: f32,
    /// Every axis at the user-space value this row was shaped at.
    pub location: Vec<AxisValue>,
    /// Total advance in font units.
    pub advance: f32,
    /// Baseline in pixels from the top of the image.
    pub baseline: f32,
    pub missing_characters: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct AxisValue {
    pub tag: String,
    pub value: f32,
}

impl ProofReport {
    /// Describes `page` and the sections it was laid out from.
    pub fn new(page: &ProofPage, section_count: usize) -> Self {
        let mut sections: Vec<SectionReport> = (0..section_count)
            .map(|_| SectionReport {
                rows: Vec::new(),
                missing_glyphs: Vec::new(),
            })
            .collect();
        let mut missing_characters: Vec<String> = Vec::new();
        for row in &page.rows {
            for character in &row.missing_characters {
                let character = character.to_string();
                if !missing_characters.contains(&character) {
                    missing_characters.push(character);
                }
            }
            sections[row.section].rows.push(row_report(row));
        }
        for (section, name) in &page.missing_glyphs {
            sections[*section].missing_glyphs.push(name.clone());
        }

        Self {
            width: page.width,
            height: page.height,
            units_per_em: page.units_per_em,
            missing_glyphs: page
                .missing_glyphs
                .iter()
                .map(|(_, name)| name.clone())
                .collect(),
            missing_characters,
            sections,
        }
    }
}

fn row_report(row: &Row) -> RowReport {
    RowReport {
        text: row.text.clone(),
        glyphs: row.run.glyphs.iter().map(|glyph| glyph.glyph_id).collect(),
        size: row.size,
        location: row
            .location
            .iter()
            .map(|(tag, value)| AxisValue {
                tag: tag.clone(),
                value: *value,
            })
            .collect(),
        advance: row.run.advance,
        baseline: row.baseline,
        missing_characters: row.missing_characters.iter().map(char::to_string).collect(),
    }
}
