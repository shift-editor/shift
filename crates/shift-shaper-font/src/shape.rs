use std::collections::HashMap;
use std::sync::Arc;

use shift_font::{AxisId, ExternalLocation, GlyphId};
use shift_shape::{
    AxisNormalization, GlyphSource, NOTDEF, NormalizedCoord, ParagraphHook, Shaper,
    character_glyphs,
};

use shift_shape::Tag;
pub use shift_shape::{FeatureSetting, ShapeError, TextDirection};

use super::positioning::{GeneratedPositioning, LiveAdvances, MarkerHook};
use super::{ShaperFont, ShaperGlyphOrder};

/// One unit of text to shape, inserting glyphs by Shift glyph id.
pub type ShapeUnit = shift_shape::Unit<GlyphId>;
/// A run of text to shape at a user-space location; axes it omits are at
/// their default, and values outside an axis are clamped to it.
pub type ShapeRequest<'a> = shift_shape::ShapeRequest<'a, GlyphId, ExternalLocation>;
/// A paragraph to shape at a user-space location, as in [`ShapeRequest`].
pub type ParagraphRequest<'a> = shift_shape::ParagraphRequest<'a, GlyphId, ExternalLocation>;
pub type ShapedRun = shift_shape::ShapedRun<GlyphId>;
/// A shaped paragraph: its base direction and its runs in logical order.
pub type ShapedParagraph = shift_shape::ShapedParagraph<GlyphId>;
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
    /// Makes a shaper for `font`, mapping each character to the glyph that
    /// claims it in `characters`, the live font's Unicode values. A character
    /// two glyphs claim maps to the first in the shaper font's glyph order.
    ///
    /// # Errors
    ///
    /// Returns [`ShapeError::InvalidFont`] when the shaper font's bytes
    /// cannot be read.
    pub fn new(
        font: Arc<ShaperFont>,
        characters: impl IntoIterator<Item = (u32, GlyphId)>,
    ) -> Result<Self, ShapeError> {
        let mut shaper = Self {
            shaper: Shaper::new(font.bytes().to_vec())?,
            axes: font.axis_normalizations(),
            glyphs: LiveGlyphs::new(font),
        };
        shaper.set_characters(characters);
        Ok(shaper)
    }

    /// Maps characters through `characters` instead, as after Unicode values
    /// change; see [`Self::new`].
    pub fn set_characters(&mut self, characters: impl IntoIterator<Item = (u32, GlyphId)>) {
        self.glyphs.set_characters(characters);
    }

    /// Shapes with `glyph_order` in place of the font's own, the Shift glyph
    /// at each shaper glyph id, and maps characters through `characters`.
    ///
    /// The order may extend past the font's glyph count: glyphs added since
    /// it compiled (see [`ShaperFontState::glyph_order`](crate::ShaperFontState::glyph_order)),
    /// which its lookups do not cover.
    pub fn set_glyphs(
        &mut self,
        glyph_order: &ShaperGlyphOrder,
        characters: impl IntoIterator<Item = (u32, GlyphId)>,
    ) {
        self.glyphs.set_glyph_order(glyph_order);
        self.glyphs.set_characters(characters);
    }

    /// Returns the glyph `codepoint` maps to through the live font's
    /// Unicode values, as shaping maps it.
    pub fn character_glyph(&self, codepoint: u32) -> Option<GlyphId> {
        let shaper_glyph = self.glyphs.characters.get(&codepoint)?;
        self.glyphs.order.glyph(*shaper_glyph)
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
            .shape(&self.glyphs, &request.at(coords.as_slice()), None)
    }

    /// Shapes one run of text, running `positioning` for each feature export
    /// generates at that feature's place among the font's lookups; see
    /// [`GeneratedPositioning`].
    ///
    /// # Errors
    ///
    /// Returns [`ShapeError`] for the reasons [`Self::shape`] gives.
    pub fn shape_positioned(
        &self,
        request: &ShapeRequest,
        positioning: &mut dyn GeneratedPositioning,
    ) -> Result<Vec<ShapedGlyph>, ShapeError> {
        let coords = self.normalized_coords(request.location);
        let mut hook = self.marker_hook(request.features, positioning);
        let direction = request.direction.unwrap_or(TextDirection::LeftToRight);
        hook.start_run(0..0, direction);
        self.shaper.shape(
            &self.glyphs,
            &request.at(coords.as_slice()),
            Some(&mut hook),
        )
    }

    /// Shapes a paragraph, run by run; see [`Shaper::shape_paragraph`].
    ///
    /// # Errors
    ///
    /// Returns [`ShapeError`] for the reasons [`Self::shape`] gives.
    pub fn shape_paragraph(
        &self,
        request: &ParagraphRequest,
    ) -> Result<ShapedParagraph, ShapeError> {
        let coords = self.normalized_coords(request.location);
        self.shaper
            .shape_paragraph(&self.glyphs, &request.at(coords.as_slice()), None)
    }

    /// Shapes a paragraph, run by run, the way export would with its
    /// generated features: each glyph starts from its live advance in
    /// `advances`, and `positioning` runs in each run as
    /// [`Self::shape_positioned`] does. Clusters `positioning` sees index the
    /// paragraph's units.
    ///
    /// # Errors
    ///
    /// Returns [`ShapeError`] for the reasons [`Self::shape`] gives.
    pub fn shape_paragraph_live(
        &self,
        request: &ParagraphRequest,
        advances: &dyn LiveAdvances,
        positioning: &mut dyn GeneratedPositioning,
    ) -> Result<ShapedParagraph, ShapeError> {
        let coords = self.normalized_coords(request.location);
        let mut hook = self.marker_hook(request.features, positioning);
        let glyphs = AdvancedGlyphs {
            glyphs: &self.glyphs,
            advances,
        };
        self.shaper
            .shape_paragraph(&glyphs, &request.at(coords.as_slice()), Some(&mut hook))
    }

    /// Whether shaping with `features` runs the generated `feature`: the
    /// font leaves it to the editor (it has an insert marker, not the
    /// feature source's own lookups) and `features` leaves it on.
    pub fn runs_generated(&self, feature: Tag, features: &[FeatureSetting]) -> bool {
        self.glyphs
            .font
            .insert_markers()
            .iter()
            .any(|marker| marker.tag == feature)
            && feature_enabled(features, feature)
    }

    /// A hook running `positioning` at the font's insert markers, for each
    /// generated feature `features` leaves on.
    fn marker_hook<'a>(
        &'a self,
        features: &[FeatureSetting],
        positioning: &'a mut dyn GeneratedPositioning,
    ) -> MarkerHook<'a> {
        let enabled = |tag| feature_enabled(features, tag);
        MarkerHook::new(
            self.glyphs.font.insert_markers(),
            enabled,
            &self.glyphs.order,
            positioning,
        )
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
    order: ShaperGlyphOrder,
    /// Shaper glyph id each character maps to.
    characters: HashMap<u32, u32>,
}

impl LiveGlyphs {
    fn new(font: Arc<ShaperFont>) -> Self {
        Self {
            order: font.glyph_order().clone(),
            font,
            characters: HashMap::new(),
        }
    }

    fn set_glyph_order(&mut self, glyph_order: &ShaperGlyphOrder) {
        self.order = glyph_order.clone();
    }

    fn set_characters(&mut self, characters: impl IntoIterator<Item = (u32, GlyphId)>) {
        let order = &self.order;
        self.characters = character_glyphs(
            characters
                .into_iter()
                .filter_map(|(codepoint, glyph)| Some((codepoint, order.shaper_glyph(glyph)?))),
        );
    }
}

impl GlyphSource for LiveGlyphs {
    type Glyph = GlyphId;

    fn shaper_glyph(&self, glyph: &GlyphId) -> Option<u32> {
        self.order.shaper_glyph(*glyph)
    }

    fn host_glyph(&self, shaper_glyph: u32) -> Option<GlyphId> {
        if shaper_glyph == NOTDEF {
            return None;
        }
        self.order.glyph(shaper_glyph)
    }

    fn character_glyph(&self, codepoint: u32) -> Option<u32> {
        self.characters.get(&codepoint).copied()
    }

    fn advance(&self, _shaper_glyph: u32) -> Option<i32> {
        Some(0)
    }
}

/// The live glyphs with each glyph's own advance from the live font.
struct AdvancedGlyphs<'a> {
    glyphs: &'a LiveGlyphs,
    advances: &'a dyn LiveAdvances,
}

impl GlyphSource for AdvancedGlyphs<'_> {
    type Glyph = GlyphId;

    fn shaper_glyph(&self, glyph: &GlyphId) -> Option<u32> {
        self.glyphs.shaper_glyph(glyph)
    }

    fn host_glyph(&self, shaper_glyph: u32) -> Option<GlyphId> {
        self.glyphs.host_glyph(shaper_glyph)
    }

    fn character_glyph(&self, codepoint: u32) -> Option<u32> {
        self.glyphs.character_glyph(codepoint)
    }

    fn advance(&self, shaper_glyph: u32) -> Option<i32> {
        let glyph = self.glyphs.order.glyph(shaper_glyph)?;
        Some(self.advances.advance(glyph).unwrap_or(0))
    }
}

/// Whether `features` leaves `tag` on: its last setting for it is not 0.
fn feature_enabled(features: &[FeatureSetting], tag: Tag) -> bool {
    features
        .iter()
        .rev()
        .find(|setting| setting.tag == tag)
        .is_none_or(|setting| setting.value != 0)
}
