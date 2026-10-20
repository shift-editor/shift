use std::collections::HashMap;
use std::sync::Arc;

use shift_font::{AxisId, ExternalLocation, GlyphId};
use shift_shape::{
    AxisNormalization, GlyphSource, NOTDEF, NormalizedCoord, Shaper, character_glyphs,
};

pub use shift_shape::{FeatureSetting, ShapeError, TextDirection};

use super::ShaperFont;
use crate::traits::FontView;

/// One unit of text to shape, inserting glyphs by Shift glyph id.
pub type ShapeUnit = shift_shape::Unit<GlyphId>;
/// A run of text to shape at a user-space location; axes it omits are at
/// their default, and values outside an axis are clamped to it.
pub type ShapeRequest<'a> = shift_shape::ShapeRequest<'a, GlyphId, ExternalLocation>;
/// A paragraph to shape at a user-space location, as in [`ShapeRequest`].
pub type ParagraphRequest<'a> = shift_shape::ParagraphRequest<'a, GlyphId, ExternalLocation>;
pub type ShapedRun = shift_shape::ShapedRun<GlyphId>;
/// One glyph of shaped text. Advances and offsets hold only what `GPOS` in
/// the feature source contributes: every glyph's own advance is zero while
/// shaping, so the caller adds live advances, kerning, and mark attachment.
pub type ShapedGlyph = shift_shape::ShapedGlyph<GlyphId>;

/// Shapes text with a [`ShaperFont`], taking characters from the live font.
///
/// The character mapping is captured when the shaper is made; make a new one
/// after Unicode values change.
pub struct LiveShaper {
    shaper: Shaper,
    glyphs: LiveGlyphs,
    /// Each shaper font axis, in `fvar` order, with how it normalizes.
    axes: Vec<(AxisId, AxisNormalization)>,
}

impl LiveShaper {
    /// Makes a shaper for `font`, mapping characters through the Unicode
    /// values of `view`'s glyphs. A character two glyphs claim maps to the
    /// first in glyph order.
    ///
    /// # Errors
    ///
    /// Returns [`ShapeError::InvalidFont`] when the shaper font's bytes
    /// cannot be read.
    pub fn new(font: Arc<ShaperFont>, view: &impl FontView) -> Result<Self, ShapeError> {
        Ok(Self {
            shaper: Shaper::new(font.bytes().to_vec())?,
            axes: font.axis_normalizations(),
            glyphs: LiveGlyphs::new(font, view),
        })
    }

    /// Returns the shaper font this shaper uses.
    pub fn font(&self) -> &Arc<ShaperFont> {
        &self.glyphs.font
    }

    /// Shapes one run of text.
    ///
    /// # Errors
    ///
    /// Returns [`ShapeError`] when the run is too long to index, inserts more
    /// distinct glyphs by name than there are stand-in characters, or names a
    /// script or language the shaper does not know.
    pub fn shape(&self, request: &ShapeRequest) -> Result<Vec<ShapedGlyph>, ShapeError> {
        let coords = self.normalized_coords(request.location);
        self.shaper
            .shape(&self.glyphs, &request.at(coords.as_slice()))
    }

    /// Shapes a paragraph, run by run; see [`Shaper::shape_paragraph`].
    ///
    /// # Errors
    ///
    /// Returns [`ShapeError`] for the reasons [`Self::shape`] gives.
    pub fn shape_paragraph(
        &self,
        request: &ParagraphRequest,
    ) -> Result<Vec<ShapedRun>, ShapeError> {
        let coords = self.normalized_coords(request.location);
        self.shaper
            .shape_paragraph(&self.glyphs, &request.at(coords.as_slice()))
    }

    /// Normalizes `location` on the shaper font's axes, in `fvar` order.
    fn normalized_coords(&self, location: &ExternalLocation) -> Vec<NormalizedCoord> {
        self.axes
            .iter()
            .map(|(axis_id, normalization)| normalization.normalize(location.get(axis_id)))
            .collect()
    }
}

/// The live font's glyphs as the shaper sees them: Shift glyph ids at their
/// place in the shaper font's glyph order, characters mapped through live
/// Unicode values, and zero advances, which the editor replaces with live
/// ones.
struct LiveGlyphs {
    font: Arc<ShaperFont>,
    /// Shaper glyph id of each Shift glyph in the shaper font.
    shaper_glyphs: HashMap<GlyphId, u32>,
    /// Shaper glyph id each character maps to.
    characters: HashMap<u32, u32>,
}

impl LiveGlyphs {
    fn new(font: Arc<ShaperFont>, view: &impl FontView) -> Self {
        let shaper_glyphs: HashMap<GlyphId, u32> = font
            .glyph_ids
            .iter()
            .enumerate()
            .filter_map(|(index, glyph_id)| Some((glyph_id.clone()?, u32::try_from(index).ok()?)))
            .collect();

        let characters = character_glyphs(view.glyphs().into_iter().flat_map(|glyph| {
            let shaper_glyph = shaper_glyphs.get(&glyph.id()).copied();
            glyph
                .unicodes()
                .iter()
                .filter_map(move |&codepoint| Some((codepoint, shaper_glyph?)))
                .collect::<Vec<_>>()
        }));

        Self {
            font,
            shaper_glyphs,
            characters,
        }
    }
}

impl GlyphSource for LiveGlyphs {
    type Glyph = GlyphId;

    fn shaper_glyph(&self, glyph: &GlyphId) -> Option<u32> {
        self.shaper_glyphs.get(glyph).copied()
    }

    fn host_glyph(&self, shaper_glyph: u32) -> Option<GlyphId> {
        if shaper_glyph == NOTDEF {
            return None;
        }
        let index = usize::try_from(shaper_glyph).ok()?;
        self.font.glyph_ids.get(index)?.clone()
    }

    fn character_glyph(&self, codepoint: u32) -> Option<u32> {
        self.characters.get(&codepoint).copied()
    }

    fn advance(&self, _shaper_glyph: u32) -> Option<i32> {
        Some(0)
    }
}
