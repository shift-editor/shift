//! Lays out text over the live font, in one call: [`shape`](crate::shape) itemizes and
//! shapes each paragraph (bidi levels, scripts, the shaper font's authored
//! features), shift-font positions what export generates from kerning and
//! anchors at each feature's insert marker, and this crate breaks lines,
//! orders each line's runs for display, aligns lines, and places glyphs,
//! carets and boxes.
//!
//! The editor draws, hit-tests and edits from what [`TextLayout`] returns;
//! it applies no layout rule of its own.

#[cfg(feature = "layout")]
mod carets;
#[cfg(feature = "layout")]
mod font;
#[cfg(feature = "layout")]
mod lines;
#[cfg(feature = "layout")]
mod paragraph;
#[cfg(feature = "layout")]
mod placement;
mod request;
#[cfg(feature = "layout")]
mod units;
#[cfg(feature = "layout")]
mod words;

#[cfg(feature = "layout")]
pub use font::LayoutFont;
#[cfg(feature = "layout")]
pub use placement::PlacementKeys;
pub use request::{
    CharacterGlyph, FeatureSetting, LayoutError, LayoutRequest, LayoutUnit, LineHeight,
    LineMetrics, TextAlign, TextOptions, TypedFont, TypedGlyph,
};

use std::collections::BTreeSet;

use shift_font::GlyphId;

// Unit and glyph indices are `u32`; every target Shift builds for has a
// `usize` at least that wide.
const _: () = assert!(usize::BITS >= u32::BITS);

/// A count of units, glyphs or lines as the `u32` index layout names them by.
///
/// # Errors
///
/// Returns [`LayoutError::TooLong`] past `u32::MAX`.
#[cfg(feature = "layout")]
pub(crate) fn index_count(count: usize) -> Result<u32, LayoutError> {
    u32::try_from(count).map_err(|_| LayoutError::TooLong)
}

/// A unit or glyph index as a slice index, which never loses data (see the
/// assertion above).
#[cfg(feature = "layout")]
#[allow(
    clippy::as_conversions,
    reason = "widening: usize is at least 32 bits on every target, asserted above"
)]
pub(crate) const fn slice_index(index: u32) -> usize {
    index as usize
}

/// The direction a line, run or glyph reads in.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
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
    /// The words, in reading order, with their edges on screen.
    pub words: Vec<LayoutWord>,
    /// The width lines align in: the request's width, or the widest line.
    pub width: f64,
    /// Why some text was laid out as typed instead of shaped, when it was.
    pub unshaped: Option<String>,
    /// A key that two layouts share exactly when they place every line,
    /// run, glyph and caret alike, glyph bounds aside, so a reader can tell
    /// an edit that moved nothing in the text without comparing them; set
    /// by [`PlacementKeys::assign`], empty until then.
    pub placement: String,
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

/// A word: a UAX #29 word segment that holds a letter, digit or the like,
/// not spaces or punctuation.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct LayoutWord {
    /// The units it covers, from `start` up to `end`.
    pub start: u32,
    pub end: u32,
    /// The direction it reads in, as its first unit's glyph is laid out.
    pub direction: Direction,
    /// The boundaries at its left and right edges on screen: its start and
    /// end left to right, its end and start right to left.
    pub left: u32,
    pub right: u32,
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
    /// Its place among its line's caret places left to right on screen,
    /// from 0, counting each stop's and each second place's: by `x`, and
    /// where places meet at one `x` (beside a glyph of no advance, or where
    /// directions meet) in the order their glyphs are drawn.
    pub screen: u32,
}

/// The second place a caret stop shows at a direction boundary.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct SecondaryCaret {
    pub x: f64,
    pub direction: Direction,
    /// Its place among its line's caret places left to right, numbered
    /// with the stops' ([`CaretStop::screen`]).
    pub screen: u32,
}

impl TextLayout {
    /// The glyphs the layout shows, each once, in id order.
    pub fn glyph_ids(&self) -> BTreeSet<GlyphId> {
        self.glyphs
            .iter()
            .filter_map(|glyph| glyph.glyph_id)
            .collect()
    }
}

#[cfg(feature = "layout")]
impl TextLayout {
    /// Lays out `request` over `font`.
    ///
    /// # Errors
    ///
    /// Returns [`LayoutError::TooLong`] when the text has more units, or
    /// lays out into more glyphs or lines, than a `u32` index can name.
    pub fn new(font: &LayoutFont<'_>, request: &LayoutRequest) -> Result<Self, LayoutError> {
        let mut unshaped = None;
        let paragraphs = paragraph::Paragraph::split(&request.units)?;
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
        let mut layout =
            lines::Placement::new(font, &request.options).place(&paragraphs, &shaped)?;
        layout.unit_glyphs = layout.glyphs_by_unit(request.units.len());
        layout.carets = carets::Carets::new(font, &layout).stops(&paragraphs);
        layout.words = layout.words_of(&paragraphs);
        layout.unshaped = unshaped;
        Ok(layout)
    }
}

#[cfg(test)]
#[cfg(feature = "layout")]
mod tests;
