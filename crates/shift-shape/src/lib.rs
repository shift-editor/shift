//! Shapes text with compiled OpenType features.
//!
//! One implementation of text shaping for every Shift host: the editor's
//! workspace (through NAPI), the editor itself (through WebAssembly), and the
//! command line. A paragraph is split into runs of one script, each run is
//! shaped with HarfRust, and runs come back in logical order. [`line_breaks`]
//! gives the places a line may break
//! ([UAX #14](https://www.unicode.org/reports/tr14/)).
//!
//! What differs between hosts is how glyphs are identified, where characters
//! map, and what a glyph's own advance is; a [`GlyphSource`] supplies all
//! three. The editor maps characters through the live font, names glyphs by
//! Shift glyph id, and shapes with zero advances, adding live ones itself; a
//! compiled font ([`FontGlyphs`]) answers from its own tables.

// Library code returns errors instead of panicking: a panic kills the
// WebAssembly engine. Tests may unwrap (clippy.toml).
#![warn(clippy::unwrap_used, clippy::print_stdout)]

mod axis;
mod breaks;
mod itemize;
mod shape;
mod source;

pub use axis::AxisNormalization;
pub use breaks::{LineBreak, line_breaks};
pub use harfrust::{NormalizedCoord, Tag};
pub use shape::{
    FeatureSetting, ParagraphRequest, ShapeError, ShapeRequest, ShapedGlyph, ShapedRun, Shaper,
    TextDirection,
};
pub use source::{FontGlyphs, GlyphSource, NOTDEF, character_glyphs};

/// One unit of text to shape, naming inserted glyphs by `G`, the host's
/// glyph identity.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Unit<G> {
    /// A character, mapped to a glyph through the [`GlyphSource`].
    Character(char),
    /// A glyph inserted by name, such as an alternate with no Unicode value.
    /// It is shaped as itself: features can still substitute or position it,
    /// but it never joins or forms context the way a character would, and
    /// line breaking reads it as an inline object (U+FFFC).
    Glyph(G),
}
