//! Shapes text with compiled OpenType features.
//!
//! One implementation of text shaping for every Shift host: the editor's
//! workspace (through NAPI), the editor itself (through WebAssembly), and the
//! command line. A paragraph is split into runs of one bidi level and script
//! ([UAX #9](https://www.unicode.org/reports/tr9/)), each run is shaped with
//! HarfRust in its level's direction, and runs come back in logical order
//! with their levels for the line to reorder. [`line_breaks`] gives the
//! places a line may break ([UAX #14](https://www.unicode.org/reports/tr14/)).
//!
//! What differs between hosts is only where characters map to glyphs and
//! what a glyph's own advance is, which a [`GlyphSource`] supplies: the
//! editor maps characters through the live font and shapes with zero
//! advances, adding live ones itself, while a compiled font answers from its
//! own `cmap` and `hmtx`.
//!
//! Glyphs are shaper glyph ids, indices into the shaping font's glyph order.
//! Hosts map them to their own glyph identities.

mod breaks;
mod itemize;
mod shape;

pub use breaks::{line_breaks, LineBreak};
pub use harfrust::NormalizedCoord;
pub use shape::{
    FeatureSetting, GlyphSource, ParagraphRequest, ShapeError, ShapeRequest, ShapedGlyph,
    ShapedParagraph, ShapedRun, Shaper, Substitution, TextDirection, NOTDEF,
};

/// One unit of text to shape.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Unit {
    /// A character, mapped to a glyph through the [`GlyphSource`].
    Character(char),
    /// A glyph inserted by name, as its shaper glyph id. It is shaped as
    /// itself: features can still substitute or position it, but it never
    /// joins or forms context the way a character would, and bidi and line
    /// breaking read it as an inline object (U+FFFC).
    Glyph(u32),
}
