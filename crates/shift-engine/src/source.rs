use shift_font::{GlyphId, GlyphLayer, LayerId};

/// Where a session reads layers it has not loaded yet: the saved and
/// persisted state of the font.
///
/// Reads are synchronous, so an edit can load what it needs and apply in one
/// step. Answers describe persisted state; the session combines them with its
/// own loaded layers, which may hold edits that are not persisted yet.
pub trait LayerSource {
    type Error;

    /// The content of `layer_ids`.
    ///
    /// # Errors
    ///
    /// Returns the source's error when a layer cannot be read.
    fn load_layers(&mut self, layer_ids: &[LayerId]) -> Result<Vec<GlyphLayer>, Self::Error>;

    /// Every glyph the components of `glyph_ids` use, transitively, other
    /// than `glyph_ids` themselves.
    ///
    /// # Errors
    ///
    /// Returns the source's error when the component references cannot be read.
    fn bases_of(&mut self, glyph_ids: &[GlyphId]) -> Result<Vec<GlyphId>, Self::Error>;

    /// Glyphs with a component whose base is one of `glyph_ids`, directly;
    /// not the composites of those composites.
    ///
    /// # Errors
    ///
    /// Returns the source's error when the component references cannot be read.
    fn composites_of(&mut self, glyph_ids: &[GlyphId]) -> Result<Vec<GlyphId>, Self::Error>;
}
