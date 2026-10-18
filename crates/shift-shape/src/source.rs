//! How a host identifies glyphs and supplies characters and advances.

/// Shaper glyph id of `.notdef`, which a character the font does not map
/// shapes to.
pub const NOTDEF: u32 = 0;

/// A host's view of the shaping font's glyphs.
///
/// Shaping works in shaper glyph ids, indices into the shaping font's glyph
/// order; a source translates them to and from [`Self::Glyph`], the host's
/// own identity, and may override the font's character mapping and
/// advances.
pub trait GlyphSource {
    /// How the host names a glyph.
    type Glyph: Clone;

    /// Returns the shaper glyph a host glyph is; `None` when the shaping font
    /// does not have it, which shapes as `.notdef`.
    fn shaper_glyph(&self, glyph: &Self::Glyph) -> Option<u32>;

    /// Returns the host glyph a shaper glyph is; `None` for `.notdef` and
    /// for glyphs the host does not know.
    fn host_glyph(&self, shaper_glyph: u32) -> Option<Self::Glyph>;

    /// Returns the shaper glyph a character maps to; `None` defers to the
    /// shaping font's own `cmap`.
    fn character_glyph(&self, codepoint: u32) -> Option<u32> {
        let _ = codepoint;
        None
    }

    /// Returns a glyph's own advance, in font units; `None` defers to the
    /// shaping font's own `hmtx`.
    fn advance(&self, shaper_glyph: u32) -> Option<i32> {
        let _ = shaper_glyph;
        None
    }
}

/// A compiled font's own glyphs: identified by glyph id, mapped and
/// advanced by the font's `cmap` and `hmtx`.
#[derive(Clone, Copy, Debug, Default)]
pub struct FontGlyphs;

impl GlyphSource for FontGlyphs {
    type Glyph = u32;

    fn shaper_glyph(&self, glyph: &u32) -> Option<u32> {
        Some(*glyph)
    }

    fn host_glyph(&self, shaper_glyph: u32) -> Option<u32> {
        (shaper_glyph != NOTDEF).then_some(shaper_glyph)
    }
}

/// Maps characters to the glyphs that claim them, from `(codepoint,
/// shaper_glyph)` pairs in any order: a character two glyphs claim maps to
/// the first in glyph order, the lower shaper glyph id.
pub fn character_glyphs(
    claims: impl IntoIterator<Item = (u32, u32)>,
) -> std::collections::HashMap<u32, u32> {
    let mut characters = std::collections::HashMap::new();
    for (codepoint, glyph) in claims {
        characters
            .entry(codepoint)
            .and_modify(|current: &mut u32| *current = (*current).min(glyph))
            .or_insert(glyph);
    }
    characters
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_character_two_glyphs_claim_maps_to_the_first_in_glyph_order() {
        let characters = character_glyphs([(0x41, 7), (0x42, 3), (0x41, 2), (0x41, 9)]);

        assert_eq!(characters.get(&0x41), Some(&2));
        assert_eq!(characters.get(&0x42), Some(&3));
    }
}
