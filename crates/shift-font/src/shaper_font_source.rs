//! What a font's shaper font is compiled from, as plain data.
//!
//! A shaper font holds only what authored feature code compiles to (see the
//! shift-shaper-font crate), so it depends on little of the font: units per
//! em, the glyph order, the feature source, the axes with their mappings, and
//! each glyph's `GDEF` class. A source is read from the font wherever the font
//! lives and compiled wherever the compiler is linked; equal sources compile to
//! the same shaper font, so a caller compares them to skip a rebuild.

use crate::{Axis, AxisMapping, Font, Glyph, GlyphId, GlyphName, OpenTypeCategory};

/// Everything a shaper font is compiled from.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct ShaperFontSource {
    pub units_per_em: f64,
    /// The font's glyphs, in glyph order.
    pub glyphs: Vec<ShaperFontGlyph>,
    /// The authored feature source; empty when the font has none.
    pub feature_source: String,
    pub axes: Vec<Axis>,
    pub axis_mappings: Vec<AxisMapping>,
}

/// One glyph of a [`ShaperFontSource`].
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct ShaperFontGlyph {
    pub id: GlyphId,
    pub name: GlyphName,
    /// The glyph's `GDEF` class, or `None` when it has none.
    pub gdef_class: Option<OpenTypeCategory>,
}

impl Font {
    /// Reads what this font's shaper font is compiled from, with each glyph's
    /// `GDEF` class as `class` gives it ([`OpenTypeCategory::of`]).
    pub fn shaper_font_source(
        &self,
        mut class: impl FnMut(&Glyph) -> Option<OpenTypeCategory>,
    ) -> ShaperFontSource {
        ShaperFontSource {
            units_per_em: self.metrics().units_per_em,
            glyphs: self
                .glyphs()
                .map(|glyph| ShaperFontGlyph {
                    id: glyph.id(),
                    name: glyph.glyph_name().clone(),
                    gdef_class: class(glyph),
                })
                .collect(),
            feature_source: self.features().fea_source().unwrap_or_default().to_string(),
            axes: self.axes().to_vec(),
            axis_mappings: self.axis_mappings().to_vec(),
        }
    }
}
