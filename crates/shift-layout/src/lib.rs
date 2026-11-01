//! Lays out text over the live font, in one call: shift-shape itemizes and
//! shapes each paragraph (bidi levels, scripts, the shaper font's authored
//! features), shift-font positions what export generates from kerning and
//! anchors at each feature's insert marker, and this crate breaks lines,
//! orders each line's runs for display, aligns lines, and places glyphs,
//! carets and boxes.
//!
//! The editor draws, hit-tests and edits from what [`TextLayout`] returns;
//! it applies no layout rule of its own.

// Library code returns errors instead of panicking: a panic kills the
// WebAssembly engine. Tests may unwrap (clippy.toml).
#![warn(clippy::unwrap_used, clippy::print_stdout)]

#[cfg(feature = "layout")]
mod carets;
#[cfg(feature = "layout")]
mod font;
#[cfg(feature = "layout")]
mod lines;
#[cfg(feature = "layout")]
mod paragraph;
mod request;
#[cfg(feature = "layout")]
mod units;

#[cfg(feature = "layout")]
pub use font::{LayoutFont, LineMetrics};
pub use request::{FeatureSetting, LayoutRequest, LayoutUnit, LineHeight, TextAlign, TextOptions};

use shift_font::GlyphId;

/// The direction a line, run or glyph reads in.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub enum Direction {
    #[default]
    Ltr,
    Rtl,
}

/// Text laid out: its lines, glyphs, carets, and which glyphs each unit
/// shows. Font units, y up; line 0's baseline is at 0 and each later line's
/// one line height lower.
#[derive(Clone, Debug, Default, PartialEq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct TextLayout {
    pub lines: Vec<LayoutLine>,
    /// Every glyph, line by line, each line's in display order, left to
    /// right.
    pub glyphs: Vec<PlacedGlyph>,
    /// For each unit, the glyphs it shows, by index into `glyphs`, in
    /// logical order: a decomposed character's base before its mark, in
    /// either direction. A line break shows none.
    pub unit_glyphs: Vec<UnitGlyphs>,
    /// A caret stop at each grapheme boundary of each line, in logical
    /// order, line by line.
    pub carets: Vec<CaretStop>,
    /// The width lines align in: the request's width, or the widest line.
    pub width: f64,
    /// Why some text was laid out as typed instead of shaped, when it was.
    pub unshaped: Option<String>,
}

/// One line: a paragraph, or the part of one that fits the width.
#[derive(Clone, Debug, Default, PartialEq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct LayoutLine {
    /// The paragraph it belongs to, counted from 0.
    pub paragraph: u32,
    /// The units it covers, from `start` up to `end`; a paragraph's last
    /// line also covers the line break that ends it.
    pub start: u32,
    pub end: u32,
    /// The baseline's height.
    pub baseline: f64,
    /// How far the line reaches above and below its baseline: the font's
    /// ascender and descender (negative) at the location.
    pub ascent: f64,
    pub descent: f64,
    /// Where the line starts after alignment, and how far it advances.
    pub left: f64,
    pub advance: f64,
    /// The paragraph's base direction.
    pub direction: Direction,
    /// The line's runs in display order, left to right.
    pub runs: Vec<LineRun>,
}

/// A run of one bidi level and script on one line.
#[derive(Clone, Debug, Default, PartialEq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct LineRun {
    /// The units it covers, from `start` up to `end`.
    pub start: u32,
    pub end: u32,
    /// Its resolved bidi level; odd levels read right to left.
    pub level: u32,
    pub direction: Direction,
    /// Its ISO 15924 script tag, such as `Arab`; `None` for characters
    /// common to all scripts.
    pub script: Option<String>,
    /// Its glyphs, from `glyph_start` up to `glyph_end` in
    /// [`TextLayout::glyphs`].
    pub glyph_start: u32,
    pub glyph_end: u32,
}

/// One glyph where it is drawn.
#[derive(Clone, Debug, Default, PartialEq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct PlacedGlyph {
    /// `None` for a character the font has no glyph for.
    pub glyph_id: Option<GlyphId>,
    /// The units it shows, from `start` up to `end`: one for a plain glyph,
    /// several for a ligature.
    pub start: u32,
    pub end: u32,
    pub line: u32,
    /// The pen position before it: the left of its advance box.
    pub left: f64,
    /// Its line's baseline.
    pub baseline: f64,
    /// How far its outline is drawn from the pen position; the outline's
    /// origin is (`left + x_offset`, `baseline + y_offset`).
    pub x_offset: f64,
    pub y_offset: f64,
    /// Its advance, without kerning.
    pub advance: f64,
    /// The kerning after it on screen, before the next glyph: the pen moves
    /// by `advance + kern`.
    pub kern: f64,
    /// The direction of the run it is in.
    pub direction: Direction,
    /// Whether the font's `GDEF` classes it a mark.
    pub is_mark: bool,
    /// Its outline's bounds, from its origin; `None` for an empty glyph.
    pub bounds: Option<GlyphBounds>,
}

/// An outline's bounds, in its own coordinates.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct GlyphBounds {
    pub x_min: f64,
    pub y_min: f64,
    pub x_max: f64,
    pub y_max: f64,
}

/// The glyphs one unit shows.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct UnitGlyphs {
    pub glyphs: Vec<u32>,
}

/// Where the caret goes at one grapheme boundary of a line.
#[derive(Clone, Debug, Default, PartialEq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct CaretStop {
    /// The boundary, as the unit after it: 0 is before the first unit.
    pub unit: u32,
    pub line: u32,
    /// Where the caret goes: the leading edge of the unit after the
    /// boundary, or the trailing edge of the one before it at a line's end.
    pub x: f64,
    /// The direction of the text at `x`.
    pub direction: Direction,
    /// At a direction boundary, the other place the same boundary shows:
    /// the trailing edge of the unit before it.
    pub secondary: Option<SecondaryCaret>,
}

/// The second place a caret stop shows at a direction boundary.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct SecondaryCaret {
    pub x: f64,
    pub direction: Direction,
}

#[cfg(feature = "layout")]
impl TextLayout {
    /// Lays out `request` over `font`.
    pub fn new(font: &LayoutFont<'_>, request: &LayoutRequest) -> Self {
        let mut unshaped = None;
        let paragraphs = paragraph::Paragraph::split(&request.units);
        let shaped: Vec<paragraph::ShapedText> = paragraphs
            .iter()
            .map(|paragraph| {
                let (shaped, reason) = paragraph.shape(font, &request.options);
                if let Some(reason) = reason {
                    unshaped.get_or_insert(reason);
                }
                shaped
            })
            .collect();
        let mut layout = lines::Placement::new(font, &request.options).place(&paragraphs, &shaped);
        layout.unit_glyphs = layout.glyphs_by_unit(request.units.len());
        layout.carets = carets::Carets::new(font, &layout).stops(&paragraphs);
        layout.unshaped = unshaped;
        layout
    }
}

#[cfg(test)]
#[cfg(feature = "layout")]
mod tests;
