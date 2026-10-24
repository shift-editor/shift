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

    /// `roots` plus every glyph their components use, transitively.
    ///
    /// # Errors
    ///
    /// Returns the source's error when the component references cannot be read.
    fn component_closure(&mut self, roots: &[GlyphId]) -> Result<Vec<GlyphId>, Self::Error>;

    /// Glyphs with a component of a glyph that owns one of `layer_ids`.
    ///
    /// # Errors
    ///
    /// Returns the source's error when the component references cannot be read.
    fn dependents(&mut self, layer_ids: &[LayerId]) -> Result<Vec<GlyphId>, Self::Error>;
}
