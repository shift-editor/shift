//! What text to lay out, and how.

use shift_font::GlyphId;

/// One unit of text.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub enum LayoutUnit {
    /// A Unicode scalar value.
    Character { codepoint: u32 },
    /// A glyph with no character to type, laid out as itself.
    Glyph { glyph_id: GlyphId },
    /// Ends a paragraph.
    LineBreak,
}

/// A feature to turn on, off, or to an alternate for the whole text.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct FeatureSetting {
    /// A feature tag such as `liga`.
    pub tag: String,
    /// `0` turns the feature off, `1` on; larger values pick an alternate.
    pub value: u32,
}

/// How lines sit in the width.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub enum TextAlign {
    /// Where the paragraph's direction starts: left for left-to-right.
    Start,
    /// Where it ends.
    End,
    Left,
    Center,
    Right,
}

/// How far apart baselines are.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub enum LineHeight {
    /// The font's ascender to descender, plus its line gap, at the location.
    #[default]
    Auto,
    /// A multiple of the font's units per em.
    Em { em: f64 },
}

/// How the text is laid out.
#[derive(Clone, Debug, Default, PartialEq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct TextOptions {
    /// A BCP 47 language tag; the default language system when `None`.
    pub language: Option<String>,
    /// An ISO 15924 script tag that every run shapes in; guessed from the
    /// characters when `None`.
    pub script: Option<String>,
    /// Settings over the features applied by default.
    pub features: Vec<FeatureSetting>,
    /// `false` lays the text out as typed: one glyph per unit, by the font's
    /// character map or the glyph inserted, with no features applied.
    pub shaping: bool,
    /// How lines sit in the width; `None` follows each line's direction.
    pub align: Option<TextAlign>,
    pub line_height: LineHeight,
    /// The width lines break at; `None` keeps each paragraph on one line.
    pub width: Option<f64>,
}

/// Text to lay out, and how.
#[derive(Clone, Debug, Default, PartialEq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct LayoutRequest {
    /// The text, with line breaks between paragraphs; every index in the
    /// layout counts these units.
    pub units: Vec<LayoutUnit>,
    pub options: TextOptions,
}

/// A font's vertical metrics at the location text is laid out at.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct LineMetrics {
    pub units_per_em: f64,
    pub ascender: f64,
    /// Below the baseline, so usually negative.
    pub descender: f64,
    pub line_gap: f64,
    /// The cap height, where a mark laid out as typed sits; the ascender
    /// stands in when the font has none.
    pub cap_height: Option<f64>,
}

/// What a window knows of a font it has no live font for, such as a
/// preview's, enough to lay text out as typed over it: the glyph each of
/// the text's characters maps to, the advance and mark class of each glyph
/// the text shows, and the line metrics, all at the location shown.
#[derive(Clone, Debug, Default, PartialEq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct TypedFont {
    pub characters: Vec<CharacterGlyph>,
    pub glyphs: Vec<TypedGlyph>,
    pub metrics: LineMetrics,
}

/// The glyph a character maps to.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct CharacterGlyph {
    pub codepoint: u32,
    pub glyph_id: GlyphId,
}

/// One glyph as text laid out as typed reads it.
#[derive(Clone, Copy, Debug, PartialEq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct TypedGlyph {
    pub glyph_id: GlyphId,
    /// Its advance at the location, in font units.
    pub advance: f64,
    /// Whether the font classes it a mark, as export resolves its category.
    pub is_mark: bool,
}

/// Why text could not be laid out.
#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub enum LayoutError {
    /// The text has more units, or lays out into more glyphs or lines, than
    /// a `u32` index can name.
    #[error(
        "the text is too long to lay out: more than {} units, glyphs or lines",
        u32::MAX
    )]
    TooLong,
}
