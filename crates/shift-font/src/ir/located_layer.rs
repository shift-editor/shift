//! A glyph's drawings, each with the place it sits in the design space.
//!
//! Readers that blend, project or check a glyph's drawings ask the glyph for
//! them through [`Glyph::located_layers`] instead of looping over the font's
//! masters and asking for "the layer on this master". A drawing sits exactly
//! on a master, or at a [`LayerLocation`] of its own: coordinates on the
//! glyph's own axes, on the font's axes, or both, optionally laid over a base
//! source. A glyph source on a glyph axis (a `dot` at Spread 100) and a
//! glyph-specific intermediate on a font axis (an `a` at Weight 550, a
//! Glyphs "brace layer") are the same thing: a drawing at a location.

use std::fmt;
use std::sync::Arc;

use serde::de::{self, MapAccess, SeqAccess, Visitor};
use serde::ser::SerializeStruct;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::axis::DesignLocation;
use crate::entity::SourceId;
use crate::font::Font;
use crate::glyph::{Glyph, GlyphLayer};
use crate::source::Source;

/// Where one of a glyph's layers sits: an optional base source, plus sparse
/// design coordinates that move it off that source.
///
/// Coordinates name font axes or the glyph's own axes, in each axis's own
/// units. Without a base, the coordinates alone place the layer and every
/// axis they don't name is at its default.
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

    /// `coordinates` laid over `base`'s location.
    pub fn new(base: Option<SourceId>, coordinates: DesignLocation) -> Self {
        Self { base, coordinates }
    }

    /// `coordinates` alone, on no base source.
    pub fn at(coordinates: DesignLocation) -> Self {
        Self::new(None, coordinates)
    }

    /// The source this location starts from, if any.
    pub fn base_source_id(&self) -> Option<SourceId> {
        self.base
    }

    /// The base source when the location is exactly that source, with no
    /// coordinates of its own.
    pub fn exact_source_id(&self) -> Option<SourceId> {
        self.coordinates.is_empty().then_some(self.base).flatten()
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

    pub(crate) fn coordinates_mut(&mut self) -> &mut DesignLocation {
        &mut self.coordinates
    }

    /// This location on `base` instead of its own base, with the same
    /// coordinates.
    #[must_use]
    pub fn on_base(&self, base: Option<SourceId>) -> Self {
        Self::new(base, self.coordinates.clone())
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

/// A location exactly on a source is written as that source's id alone, the
/// way layers were written when every layer sat on a source, so those
/// layers keep their bytes. A location without coordinates or a base is
/// written as nothing (`nil`, `null`). Any other is written as its base and
/// coordinates, `{ base, coordinates }`.
impl Serialize for LayerLocation {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        if self.coordinates.is_empty() {
            return self.base.serialize(serializer);
        }
        let mut location = serializer.serialize_struct("LayerLocation", 2)?;
        location.serialize_field("base", &self.base)?;
        location.serialize_field("coordinates", &self.coordinates)?;
        location.end()
    }
}

impl<'de> Deserialize<'de> for LayerLocation {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_any(LayerLocationVisitor)
    }
}

/// Reads each form [`LayerLocation`]'s `Serialize` writes: a source id, no
/// value, or a base and coordinates as a sequence (positional encodings) or
/// a map (named ones).
struct LayerLocationVisitor;

impl<'de> Visitor<'de> for LayerLocationVisitor {
    type Value = LayerLocation;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a source id, nothing, or a base and coordinates")
    }

    fn visit_str<E: de::Error>(self, value: &str) -> Result<Self::Value, E> {
        let source_id = value.parse().map_err(E::custom)?;
        Ok(LayerLocation::at_source(source_id))
    }

    fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
        Ok(LayerLocation::default())
    }

    fn visit_none<E: de::Error>(self) -> Result<Self::Value, E> {
        self.visit_unit()
    }

    fn visit_some<D: Deserializer<'de>>(self, deserializer: D) -> Result<Self::Value, D::Error> {
        deserializer.deserialize_any(self)
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
        let base = seq
            .next_element()?
            .ok_or_else(|| de::Error::invalid_length(0, &self))?;
        let coordinates = seq
            .next_element()?
            .ok_or_else(|| de::Error::invalid_length(1, &self))?;
        if seq.next_element::<de::IgnoredAny>()?.is_some() {
            return Err(de::Error::invalid_length(3, &self));
        }
        Ok(LayerLocation::new(base, coordinates))
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
        let mut base = None;
        let mut coordinates = None;
        while let Some(key) = map.next_key::<String>()? {
            match key.as_str() {
                "base" => base = Some(map.next_value()?),
                "coordinates" => coordinates = Some(map.next_value()?),
                other => return Err(de::Error::unknown_field(other, &["base", "coordinates"])),
            }
        }
        let coordinates = coordinates.ok_or_else(|| de::Error::missing_field("coordinates"))?;
        Ok(LayerLocation::new(base.flatten(), coordinates))
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
    /// The layers that take part in interpolation, each with its location:
    /// first one per [master](Font::masters) this glyph draws exactly on, in
    /// the font's source order, then every layer located off the masters, in
    /// layer id order. A master the glyph has no layer on is skipped, and so
    /// is a located layer whose base is not a master.
    pub fn located_layers<'a>(&'a self, font: &'a Font) -> impl Iterator<Item = LocatedLayer<'a>> {
        let on_masters = self.located_layers_on(font.masters());
        let off_masters = self
            .layers()
            .values()
            .filter(|layer| layer.is_located())
            .filter_map(move |layer| {
                let location = layer.location().clone();
                if let Some(base) = location.base_source_id()
                    && !font.source(base).is_some_and(Source::is_master)
                {
                    return None;
                }
                Some(LocatedLayer { layer, location })
            });
        on_masters.chain(off_masters)
    }

    /// The layers that sit exactly on `masters`, the font's master sources in
    /// source order, for a reader that holds them without the font, such as
    /// a compiler snapshot. Layers located off the masters are left out:
    /// placing them needs the font's axes, through [`Self::located_layers`].
    pub fn located_layers_on<'a>(
        &'a self,
        masters: impl IntoIterator<Item = &'a Source> + 'a,
    ) -> impl Iterator<Item = LocatedLayer<'a>> {
        masters.into_iter().filter_map(move |source| {
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
    use crate::entity::AxisId;

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
            assert_eq!(located.layer.source_id(), Some(source.id()));
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
    fn a_location_on_a_source_is_written_as_the_source_id_alone() {
        let source_id = SourceId::new();

        let written = serde_json::to_value(LayerLocation::at_source(source_id)).unwrap();

        assert_eq!(written, serde_json::to_value(source_id).unwrap());
    }

    #[test]
    fn every_form_of_location_reads_back_as_written() {
        let source_id = SourceId::new();
        let axis_id = AxisId::new();
        let coordinates = DesignLocation::from([(axis_id, 50.0)]);
        let locations = [
            LayerLocation::at_source(source_id),
            LayerLocation::new(Some(source_id), coordinates.clone()),
            LayerLocation::at(coordinates),
            LayerLocation::default(),
        ];

        for location in locations {
            let json = serde_json::to_string(&location).unwrap();
            let read: LayerLocation = serde_json::from_str(&json).unwrap();
            assert_eq!(read, location, "{json}");
        }
    }

    #[test]
    fn a_location_with_a_field_it_does_not_have_is_refused() {
        let json = r#"{"base":null,"coordinates":{},"extra":1}"#;

        let error = serde_json::from_str::<LayerLocation>(json).unwrap_err();

        assert_eq!(error.classify(), serde_json::error::Category::Data);
    }

    #[test]
    fn a_base_the_font_lacks_has_no_design_location() {
        let font = crate::test_support::sample_variable_font();
        let location = LayerLocation::at_source(SourceId::new());

        assert_eq!(location.design_location(&font), None);
        assert!(location.base_source(&font).is_none());
    }
}
