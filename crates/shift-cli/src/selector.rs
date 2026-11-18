//! Finds font entities from the names or ids a user types.

use miette::{Result, miette};
use shift_font::{AxisId, Font, GlyphId, SourceId};

/// Resolves command-line selectors against a font.
pub(crate) trait FontSelectors {
    /// Returns the glyph `selector` names: its full `glyph_` id or its name.
    fn glyph_id_for(&self, selector: &str) -> Result<GlyphId>;

    /// Returns the source `selector` names: its full `source_` id or its name.
    fn source_id_for(&self, selector: &str) -> Result<SourceId>;

    /// Returns `glyph_id`'s own axis `selector` names: its tag or full id.
    fn glyph_axis_id_for(&self, glyph_id: GlyphId, selector: &str) -> Result<AxisId>;
}

impl FontSelectors for Font {
    fn glyph_id_for(&self, selector: &str) -> Result<GlyphId> {
        if let Ok(glyph_id) = selector.parse::<GlyphId>()
            && self.glyph(glyph_id).is_some()
        {
            return Ok(glyph_id);
        }
        self.glyph_id_by_name(selector).ok_or_else(|| {
            miette!("glyph {selector:?} does not exist; use its name or full glyph_ id")
        })
    }

    fn source_id_for(&self, selector: &str) -> Result<SourceId> {
        if let Ok(source_id) = selector.parse::<SourceId>()
            && self.source(source_id).is_some()
        {
            return Ok(source_id);
        }
        self.sources()
            .iter()
            .find(|source| source.name() == selector)
            .map(shift_font::Source::id)
            .ok_or_else(|| {
                miette!("source {selector:?} does not exist; use its name or full source_ id")
            })
    }

    fn glyph_axis_id_for(&self, glyph_id: GlyphId, selector: &str) -> Result<AxisId> {
        let glyph = self
            .glyph(glyph_id)
            .ok_or_else(|| miette!("glyph {glyph_id} does not exist"))?;
        let own = |axis_id: &AxisId| glyph.axis(*axis_id).is_some();
        selector
            .parse::<AxisId>()
            .ok()
            .filter(own)
            .or_else(|| {
                self.axis_id_in_glyph_space(Some(glyph_id), selector)
                    .filter(own)
            })
            .ok_or_else(|| {
                miette!(
                    "glyph {:?} has no axis {selector:?}; use its tag or full id",
                    glyph.name()
                )
            })
    }
}
