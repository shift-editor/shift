//! A compiled font (TrueType, OpenType) as its own shaper font.
//!
//! A compiled font needs no feature compile: its `GSUB`, `GPOS` and `GDEF`
//! are already built, and its `cmap` and `hmtx` (with `HVAR`) map characters
//! and give advances. So the binary itself is the shaper font, and shaping
//! with it applies every lookup the font ships: kerning and mark attachment
//! included, since they are in its `GPOS`.

use read_fonts::{FontRef, ReadError, TableProvider};
use shift_font::{Axis, AxisMapping, GlyphId};

use super::{ShaperFont, ShaperFontError, ShaperGlyphOrder, axes::to_ir_axes, axis_tag};

/// A compiled font's vertical metrics, as a proof sets lines from them: the
/// `OS/2` typo values, or `hhea`'s when the font has no `OS/2`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BinaryLineMetrics {
    pub units_per_em: f64,
    pub ascender: f64,
    /// Below the baseline, so usually negative.
    pub descender: f64,
    pub line_gap: f64,
    pub cap_height: Option<f64>,
}

/// Why a compiled font cannot be its own shaper font.
#[derive(Debug, thiserror::Error)]
pub enum BinaryShaperError {
    #[error("the font binary cannot be read: {0}")]
    Unreadable(#[from] ReadError),

    #[error("the font has {font} glyphs, but {given} glyph ids were given for them")]
    GlyphCount { font: usize, given: usize },

    #[error("the font's axes are {font:?}, but the session's are {session:?}")]
    Axes {
        font: Vec<String>,
        session: Vec<String>,
    },
}

impl ShaperFont {
    /// The compiled font `bytes` as its own shaper font, the Shift glyph at
    /// each of its glyph ids in `glyph_ids` (`None` for one the session does
    /// not name, such as `.notdef`).
    ///
    /// Shaping with it maps characters through the font's own `cmap` and
    /// starts each glyph from its own advance (`hmtx`, `HVAR`), not the live
    /// font's, and has no insert markers: every feature the font ships runs
    /// as compiled, and none is generated. `axes` and `mappings` are the
    /// session's, in `fvar` order, which user locations normalize through.
    ///
    /// # Errors
    ///
    /// Returns [`ShaperFontError::Binary`] when `bytes` is not a font, when
    /// `glyph_ids` does not number its glyphs, or when `axes` are not its
    /// `fvar` axes in order; and [`ShaperFontError::InvalidAxes`] when an
    /// axis or its mapping cannot normalize.
    pub fn from_binary(
        bytes: Vec<u8>,
        glyph_ids: Vec<Option<GlyphId>>,
        axes: &[Axis],
        mappings: &[AxisMapping],
    ) -> Result<Self, ShaperFontError> {
        let font = FontRef::new(&bytes).map_err(BinaryShaperError::from)?;
        let glyph_count = usize::from(font.maxp().map_err(BinaryShaperError::from)?.num_glyphs());
        if glyph_count != glyph_ids.len() {
            return Err(BinaryShaperError::GlyphCount {
                font: glyph_count,
                given: glyph_ids.len(),
            }
            .into());
        }
        let font_tags: Vec<String> = match font.fvar() {
            Ok(fvar) => fvar
                .axes()
                .map_err(BinaryShaperError::from)?
                .iter()
                .map(|axis| axis.axis_tag().to_string())
                .collect(),
            Err(ReadError::TableIsMissing(_)) => Vec::new(),
            Err(error) => return Err(BinaryShaperError::from(error).into()),
        };
        let session_tags: Vec<String> = axes.iter().map(|axis| axis.tag().to_string()).collect();
        if font_tags != session_tags {
            return Err(BinaryShaperError::Axes {
                font: font_tags,
                session: session_tags,
            }
            .into());
        }
        for axis in axes {
            axis_tag(axis)?;
        }
        Ok(Self {
            glyph_names: Vec::new(),
            glyph_order: ShaperGlyphOrder::new(glyph_ids)?,
            axes: to_ir_axes(axes, mappings)?,
            axis_ids: axes.iter().map(Axis::id).collect(),
            insert_markers: Vec::new(),
            whole: true,
            bytes,
        })
    }

    /// Whether this is a whole compiled font ([`Self::from_binary`]), which
    /// maps characters and advances glyphs itself, rather than layout
    /// tables compiled from feature source.
    pub fn is_whole(&self) -> bool {
        self.whole
    }

    /// A whole font's vertical metrics; `None` for a shaper font compiled
    /// from feature source, which has none, or a font whose `head` cannot
    /// be read.
    pub fn line_metrics(&self) -> Option<BinaryLineMetrics> {
        if !self.whole {
            return None;
        }
        let font = FontRef::new(&self.bytes).ok()?;
        let units_per_em = f64::from(font.head().ok()?.units_per_em());
        if let Ok(os2) = font.os2() {
            return Some(BinaryLineMetrics {
                units_per_em,
                ascender: f64::from(os2.s_typo_ascender()),
                descender: f64::from(os2.s_typo_descender()),
                line_gap: f64::from(os2.s_typo_line_gap()),
                cap_height: os2.s_cap_height().map(f64::from),
            });
        }
        let hhea = font.hhea().ok()?;
        Some(BinaryLineMetrics {
            units_per_em,
            ascender: f64::from(hhea.ascender().to_i16()),
            descender: f64::from(hhea.descender().to_i16()),
            line_gap: f64::from(hhea.line_gap().to_i16()),
            cap_height: None,
        })
    }

    /// The glyph each character maps to through a whole font's own `cmap`,
    /// by shaper glyph id; empty for a shaper font compiled from feature
    /// source, which has no `cmap`.
    pub(crate) fn own_characters(&self) -> Vec<(u32, u32)> {
        if !self.whole {
            return Vec::new();
        }
        let Ok(font) = FontRef::new(&self.bytes) else {
            return Vec::new();
        };
        let Ok(cmap) = font.cmap() else {
            return Vec::new();
        };
        let mut characters = Vec::new();
        for record in cmap.encoding_records() {
            let Ok(subtable) = record.subtable(cmap.offset_data()) else {
                continue;
            };
            characters.extend(
                subtable
                    .iter()
                    .map(|(codepoint, glyph)| (codepoint, glyph.to_u32())),
            );
        }
        characters
    }
}
