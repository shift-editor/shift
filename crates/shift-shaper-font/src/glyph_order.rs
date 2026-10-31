//! The Shift glyph at each shaper glyph id, both ways.

use std::collections::{HashMap, HashSet};

use shift_font::GlyphId;

use super::ShaperFontError;

/// The Shift glyph at each shaper glyph id, `.notdef` at 0, and each Shift
/// glyph's shaper glyph id.
///
/// A shaper glyph id is a `u32`, so an order holds at most `u32::MAX`
/// glyphs; that is checked when the order is made or grows, never per
/// lookup.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ShaperGlyphOrder {
    /// `None` for a `.notdef` the font does not have, and for a slot whose
    /// glyph was removed.
    glyphs: Vec<Option<GlyphId>>,
    ids: HashMap<GlyphId, u32>,
}

impl ShaperGlyphOrder {
    /// The order `glyphs` gives, by shaper glyph id.
    ///
    /// # Errors
    ///
    /// Returns [`ShaperFontError::TooManyGlyphs`] when there are more glyphs
    /// than a shaper glyph id can number.
    pub fn new(glyphs: Vec<Option<GlyphId>>) -> Result<Self, ShaperFontError> {
        let mut order = Self::default();
        order.extend(glyphs)?;
        Ok(order)
    }

    /// The Shift glyph at `shaper_glyph`, if any.
    pub fn glyph(&self, shaper_glyph: u32) -> Option<GlyphId> {
        *self.glyphs.get(usize::try_from(shaper_glyph).ok()?)?
    }

    /// The shaper glyph id of `glyph`, if the order has it.
    pub fn shaper_glyph(&self, glyph: GlyphId) -> Option<u32> {
        self.ids.get(&glyph).copied()
    }

    /// Whether the order has `glyph`.
    pub fn contains(&self, glyph: GlyphId) -> bool {
        self.ids.contains_key(&glyph)
    }

    /// The Shift glyph at each shaper glyph id, in order.
    pub fn as_slice(&self) -> &[Option<GlyphId>] {
        &self.glyphs
    }

    /// Appends `glyphs`, numbered after the last glyph.
    ///
    /// # Errors
    ///
    /// Returns [`ShaperFontError::TooManyGlyphs`] when the order would hold
    /// more glyphs than a shaper glyph id can number; the order is then
    /// unchanged.
    pub fn extend(
        &mut self,
        glyphs: impl IntoIterator<Item = Option<GlyphId>>,
    ) -> Result<(), ShaperFontError> {
        let added: Vec<Option<GlyphId>> = glyphs.into_iter().collect();
        let first = u32::try_from(self.glyphs.len()).map_err(|_| ShaperFontError::TooManyGlyphs)?;
        let count = u32::try_from(added.len()).map_err(|_| ShaperFontError::TooManyGlyphs)?;
        first
            .checked_add(count)
            .ok_or(ShaperFontError::TooManyGlyphs)?;
        for (shaper_glyph, glyph) in (first..).zip(&added) {
            if let Some(glyph) = glyph {
                self.ids.entry(*glyph).or_insert(shaper_glyph);
            }
        }
        self.glyphs.extend(added);
        Ok(())
    }

    /// Unmaps every glyph not in `present`, keeping its slot; returns whether
    /// any was unmapped.
    pub fn unmap_absent(&mut self, present: &HashSet<GlyphId>) -> bool {
        let mut unmapped = false;
        for slot in &mut self.glyphs {
            if let Some(glyph) = *slot
                && !present.contains(&glyph)
            {
                self.ids.remove(&glyph);
                *slot = None;
                unmapped = true;
            }
        }
        unmapped
    }
}
