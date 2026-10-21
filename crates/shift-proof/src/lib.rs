//! Shapes, lays out, and renders proof text and glyph grids from compiled
//! font bytes.
//!
//! The capability sits below every host: callers compile a font however
//! they like and hand over TrueType or OpenType bytes. A [`ProofFont`] binds
//! those bytes to one variation location; text is shaped there with
//! HarfRust (so kerning and features apply as compiled, adjusted by
//! [`ShapingOptions`]) and outlined with skrifa, unhinted, in font units
//! with y up. Lines may name glyphs directly with `/name` tokens.
//!
//! On top of that primitive, [`layout_text`] sets a waterfall of sizes and
//! locations and [`layout_grid`] sets named glyph cells, both into a pixel
//! [`Page`] that [`render_svg`] and [`render_png`] draw. [`render_proof`]
//! runs the whole pipeline from a [`ProofRequest`] and returns the image
//! with a serialisable [`ProofReport`].
//!
//! Characters the font does not map and glyph names it lacks are never
//! silently dropped: they are drawn as red placeholders and listed per line
//! and overall in the report.

mod bidi;
mod error;
mod font;
mod grid;
mod label;
mod layout;
mod location;
mod numeric;
mod options;
mod palette;
mod proof;
mod raster;
mod report;
mod shape;
mod svg;
mod text;

pub use error::ProofError;
pub use font::{ProofFont, ProofMetrics};
pub use grid::{GridLayout, layout_grid};
pub use layout::{Guide, GuideLine, Label, LocatedFont, Page, Row, TextLayout, layout_text};
pub use location::{AxisValue, Coordinates, ProofLocation, named_instances};
pub use options::{FeatureSetting, LanguageSetting, ScriptSetting, ShapingOptions, TextDirection};
pub use palette::Rgb;
pub use proof::{
    DEFAULT_GRID_WIDTH, DEFAULT_TEXT, ImageFormat, MAX_SIZE, Proof, ProofMode, ProofRequest,
    render_proof,
};
pub use raster::render_png;
pub use report::{
    CellReport, GridReport, GuideReport, LineReport, LocationReport, MissingCharacter, ProofReport,
    RowReport,
};
pub use shape::{
    GlyphReport, PlacedGlyph, Segment, ShapedGlyph, ShapedRun, ShapedText, hollow_box,
};
pub use svg::render_svg;
pub use text::line_characters;

#[cfg(test)]
mod tests;
