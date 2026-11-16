//! A glyph's drawings, each with the place it sits in the design space.
//!
//! Readers that blend, project or check a glyph's drawings ask the glyph for
//! them through [`Glyph::located_layers`] instead of looping over the font's
//! masters and asking for "the layer on this master". Today every drawing sits
//! exactly on a master, so a location is just that master. Glyph-local sources
//! will add drawings that sit off the font's masters; they arrive through the
//! same call, so its readers don't change again.

use std::sync::Arc;

use crate::axis::DesignLocation;
use crate::entity::SourceId;
use crate::font::Font;
use crate::glyph::{Glyph, GlyphLayer};
use crate::source::Source;

/// Where one of a glyph's layers sits: a base source, plus sparse design
/// coordinates that move it off that source.
///
/// Every layer today has a base source and no coordinates of its own.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct LayerLocation {
    base: Option<SourceId>,
    coordinates: DesignLocation,
}

impl LayerLocation {
    /// A layer that sits exactly on `source_id`.
    pub fn at_source(source_id: SourceId) -> Self {
        Self {
            base: Some(source_id),
            coordinates: DesignLocation::new(),
        }
    }

    /// The source this location starts from, if any.
    pub fn base_source_id(&self) -> Option<SourceId> {
        self.base
    }

    /// The base source in `font`, or `None` when there is no base or `font`
    /// lacks it.
    pub fn base_source<'f>(&self, font: &'f Font) -> Option<&'f Source> {
        font.source(self.base?)
    }

    /// The coordinates that move this layer off its base source, keyed by axis.
    pub fn coordinates(&self) -> &DesignLocation {
        &self.coordinates
    }

    /// The full design location: the base source's location with this
    /// location's own coordinates laid over it. Without a base it is the
    /// coordinates alone. `None` when the base names a source `font` lacks.
    pub fn design_location(&self, font: &Font) -> Option<DesignLocation> {
        let mut location = match self.base {
            Some(source_id) => font.source(source_id)?.location().clone(),
            None => DesignLocation::new(),
        };
        location.extend(
            self.coordinates
                .iter()
                .map(|(axis_id, value)| (*axis_id, *value)),
        );
        Some(location)
    }
}

/// One of a glyph's layers and where it sits.
#[derive(Clone, Debug)]
pub struct LocatedLayer<'a> {
    /// The drawing, as the shared handle the glyph holds.
    pub layer: &'a Arc<GlyphLayer>,
    pub location: LayerLocation,
}

impl Glyph {
    /// The layers that take part in interpolation, each with its location, in
    /// the font's source order: one per [master](Font::masters) this glyph
    /// draws. A master the glyph has no layer on is skipped.
    pub fn located_layers<'a>(&'a self, font: &'a Font) -> impl Iterator<Item = LocatedLayer<'a>> {
        font.masters().filter_map(move |source| {
            let layer = self.shared_layer_for_source(source.id())?;
            Some(LocatedLayer {
                layer,
                location: LayerLocation::at_source(source.id()),
            })
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn located_layers_follow_source_order_and_skip_undrawn_masters() {
        let font = crate::test_support::sample_variable_font();
        let glyph = font.glyphs().find(|glyph| glyph.name() == "A").unwrap();

        let located = glyph.located_layers(&font).collect::<Vec<_>>();
        let names = located
            .iter()
            .map(|located| located.location.base_source(&font).unwrap().name())
            .collect::<Vec<_>>();

        let drawn_masters = font
            .masters()
            .filter(|source| glyph.layer_for_source(source.id()).is_some())
            .map(Source::name)
            .collect::<Vec<_>>();
        assert_eq!(names, drawn_masters);
        assert!(
            !names.contains(&"Medium"),
            "the Medium master has no layer for A: {names:?}"
        );
        assert_eq!(located.len(), 2);
    }

    #[test]
    fn a_layer_on_a_source_sits_at_that_source() {
        let font = crate::test_support::sample_variable_font();
        let glyph = font.glyphs().find(|glyph| glyph.name() == "A").unwrap();

        for located in glyph.located_layers(&font) {
            let source = located.location.base_source(&font).unwrap();
            assert_eq!(located.layer.source_id(), source.id());
            assert!(located.location.coordinates().is_empty());
            assert_eq!(
                located.location.design_location(&font).as_ref(),
                Some(source.location())
            );
        }
    }

    #[test]
    fn coordinates_override_the_base_source() {
        let font = crate::test_support::sample_variable_font();
        let source = font.masters().next().unwrap();
        let axis = font.axes().first().unwrap();
        let mut location = LayerLocation::at_source(source.id());
        location.coordinates.set(axis.id(), axis.maximum());

        let design = location.design_location(&font).unwrap();

        assert_eq!(design.get(&axis.id()), Some(axis.maximum()));
    }

    #[test]
    fn a_base_the_font_lacks_has_no_design_location() {
        let font = crate::test_support::sample_variable_font();
        let location = LayerLocation::at_source(SourceId::new());

        assert_eq!(location.design_location(&font), None);
        assert!(location.base_source(&font).is_none());
    }
}
