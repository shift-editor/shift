//! Which glyphs each unit shows.

use crate::{Direction, TextLayout, UnitGlyphs};

impl TextLayout {
    /// For each of `unit_count` units, the glyphs that show it, in logical
    /// order: a right-to-left run's glyphs read from its last, on screen.
    pub(crate) fn glyphs_by_unit(&self, unit_count: usize) -> Vec<UnitGlyphs> {
        let layout = self;
        let mut units = vec![UnitGlyphs::default(); unit_count];
        for (index, glyph) in (0u32..).zip(&layout.glyphs) {
            for unit in glyph.start..glyph.end {
                if let Some(shown) = usize::try_from(unit)
                    .ok()
                    .and_then(|unit| units.get_mut(unit))
                {
                    shown.glyphs.push(index);
                }
            }
        }
        for shown in &mut units {
            let reversed = shown.glyphs.first().is_some_and(|&first| {
                usize::try_from(first)
                    .ok()
                    .and_then(|first| layout.glyphs.get(first))
                    .is_some_and(|glyph| glyph.direction == Direction::Rtl)
            });
            if reversed {
                shown.glyphs.reverse();
            }
        }
        units
    }
}
