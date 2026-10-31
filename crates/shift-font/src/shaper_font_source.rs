//! What a font's shaper font is compiled from, as plain data.
//!
//! A shaper font holds only what authored feature code compiles to (see the
//! shift-shaper-font crate), so it depends on little of the font: units per
//! em, the glyph order, the feature source, the axes with their mappings, and
//! each glyph's `GDEF` class. A source is read from the font wherever the font
//! lives and compiled wherever the compiler is linked; equal sources compile to
//! the same shaper font, so a caller compares them to skip a rebuild.

use crate::{Axis, AxisMapping, Font, GlyphClasses, GlyphId, GlyphName, OpenTypeCategory};

/// The glyph every shaper font places at glyph id 0.
pub const NOTDEF: &str = ".notdef";

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

/// One glyph of a [`ShaperFontSource`]'s glyph order.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GlyphOrderEntry<'a> {
    pub name: &'a str,
    /// `None` for a `.notdef` the font does not have.
    pub id: Option<GlyphId>,
    pub gdef_class: Option<OpenTypeCategory>,
}

impl ShaperFontSource {
    /// The shaper font's glyph order: [`NOTDEF`] first, the font's own when
    /// it has one, then every other glyph in the font's order.
    pub fn glyph_order(&self) -> impl Iterator<Item = GlyphOrderEntry<'_>> {
        let notdef = self
            .glyphs
            .iter()
            .find(|glyph| glyph.name.as_str() == NOTDEF);
        let first = GlyphOrderEntry {
            name: NOTDEF,
            id: notdef.map(|glyph| glyph.id),
            gdef_class: notdef.and_then(|glyph| glyph.gdef_class),
        };
        let rest = self
            .glyphs
            .iter()
            .filter(|glyph| glyph.name.as_str() != NOTDEF)
            .map(|glyph| GlyphOrderEntry {
                name: glyph.name.as_str(),
                id: Some(glyph.id),
                gdef_class: glyph.gdef_class,
            });
        std::iter::once(first).chain(rest)
    }
}

impl Font {
    /// Reads what this font's shaper font is compiled from, with each glyph's
    /// `GDEF` class as `classes` gives it.
    pub fn shaper_font_source(&self, classes: &GlyphClasses) -> ShaperFontSource {
        ShaperFontSource {
            units_per_em: self.metrics().units_per_em,
            glyphs: self
                .glyphs()
                .map(|glyph| ShaperFontGlyph {
                    id: glyph.id(),
                    name: glyph.glyph_name().clone(),
                    gdef_class: classes.class(glyph),
                })
                .collect(),
            feature_source: self.features().fea_source().unwrap_or_default().to_string(),
            axes: self.axes().to_vec(),
            axis_mappings: self.axis_mappings().to_vec(),
        }
    }
}
