//! What a window's engine opens for a compiled font (TrueType, OpenType).

use serde::{Deserialize, Serialize};

use crate::{Font, GlyphId};

/// A compiled font's header: its font without glyphs (names, units per em,
/// axes, axis mappings and sources), and the glyph id the session names
/// each of its glyphs by, in the binary's glyph order, so the shaper's glyph
/// ids map to the glyphs a preview draws.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CompiledHeader {
    pub font: Font,
    /// The glyph at each glyph id of the binary.
    pub glyph_ids: Vec<GlyphId>,
}
