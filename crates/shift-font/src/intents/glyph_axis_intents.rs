//! Intents for a glyph's own axes and for drawings placed anywhere in its
//! design space.
//!
//! Every value on a glyph axis is in the axis's own units. A drawing's place
//! is a base source, coordinates on font axes and the glyph's own axes, or
//! both; see [`LayerLocation`].

use super::*;
use crate::{AxisRange, AxisValueUse, GlyphAxis, GlyphAxisEdit};

/// Adds an axis to one glyph, such as Spread on `dot`. Without a tag, the
/// axis gets a private one from its name (`Spread` is `SPRD`).
#[derive(Clone, Debug)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct CreateGlyphAxis {
    pub glyph_id: GlyphId,
    /// Caller-minted id, unique among font axes and every glyph's axes.
    pub axis_id: AxisId,
    pub name: String,
    /// A four-character tag; `None` picks one from the name.
    pub tag: Option<String>,
    /// In the axis's own units.
    pub range: AxisRange,
}

impl FontLevelIntent for CreateGlyphAxis {
    fn apply(&self, font: &mut Font) -> CoreResult<(Vec<LayerId>, Vec<GlyphId>)> {
        let Self {
            glyph_id,
            axis_id,
            name,
            tag,
            range,
        } = self;
        let axis = GlyphAxis::with_id(
            *axis_id,
            tag.clone().unwrap_or_default(),
            name.clone(),
            range.minimum,
            range.default,
            range.maximum,
        );
        font.add_glyph_axis(*glyph_id, axis)?;
        Ok((Vec::new(), vec![*glyph_id]))
    }
}

/// Renames, retags, changes the range of, rescales or removes a glyph axis:
/// see [`Font::edit_glyph_axis`]. A range edit that would leave a drawing or
/// a component outside the range is refused, rescaling moves every stored
/// value with the range, and an axis is removed only once no drawing or
/// component sets a value on it.
#[derive(Clone, Debug)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct EditGlyphAxis {
    pub axis_id: AxisId,
    pub edit: GlyphAxisEdit,
}

impl EditGlyphAxis {
    /// Whether the edit reads or moves the values stored on the axis, which
    /// live in its glyph's drawings and in components across the font.
    fn reads_values(&self) -> bool {
        match self.edit {
            GlyphAxisEdit::Name(_) | GlyphAxisEdit::Tag(_) => false,
            GlyphAxisEdit::Range(_) | GlyphAxisEdit::Rescale(_) | GlyphAxisEdit::Remove => true,
        }
    }
}

impl FontLevelIntent for EditGlyphAxis {
    fn required_layer_ids(&self, font: &Font) -> Vec<LayerId> {
        let Some(glyph_id) = font.glyph_axis_owner(self.axis_id) else {
            return Vec::new();
        };
        if !self.reads_values() {
            return Vec::new();
        }
        let mut layer_ids: Vec<LayerId> =
            font.layer_ids_of_glyphs([&glyph_id]).into_iter().collect();
        layer_ids.extend(font.layers_using_component_base(&glyph_id).copied());
        layer_ids
    }

    fn composites_read(&self, font: &Font) -> Vec<GlyphId> {
        if !self.reads_values() {
            return Vec::new();
        }
        font.glyph_axis_owner(self.axis_id).into_iter().collect()
    }

    fn apply(&self, font: &mut Font) -> CoreResult<(Vec<LayerId>, Vec<GlyphId>)> {
        let glyph_id = font.glyph_axis_owner(self.axis_id).require(&self.axis_id)?;
        // A rescale moves component locations in other glyphs' layers.
        let component_layers = font
            .glyph_axis_uses(self.axis_id)?
            .into_iter()
            .filter_map(|value_use| match value_use {
                AxisValueUse::Component { layer_id, .. } => Some(layer_id),
                AxisValueUse::Layer { .. } => None,
            })
            .collect();
        font.edit_glyph_axis(self.axis_id, self.edit.clone())?;
        Ok((component_layers, vec![glyph_id]))
    }
}

/// Creates one empty drawing of a glyph at a location: coordinates laid over
/// a base source, or coordinates alone with every axis they don't name at its
/// default. A `dot` drawn at Spread 100 on Regular and an `H` drawn at Bleed
/// 50 with no base are both made this way.
#[derive(Clone, Debug)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct CreateLocatedGlyphLayer {
    pub layer_id: LayerId,
    pub glyph_id: GlyphId,
    pub base_source_id: Option<SourceId>,
    /// Values on font axes and the glyph's own axes, in each axis's units.
    pub coordinates: DesignLocation,
}

impl FontLevelIntent for CreateLocatedGlyphLayer {
    fn apply(&self, font: &mut Font) -> CoreResult<(Vec<LayerId>, Vec<GlyphId>)> {
        let Self {
            layer_id,
            glyph_id,
            base_source_id,
            coordinates,
        } = self;
        if font.glyph_id_by_layer(*layer_id).is_some() {
            return Err(CoreError::DuplicateLayerId(*layer_id));
        }
        coordinates
            .iter()
            .map(|(_, value)| *value)
            .require_finite(Coordinates::LayerLocation)?;
        let location = LayerLocation::new(*base_source_id, coordinates.clone());
        let mut layer = GlyphLayer::located(*layer_id, location);
        layer.set_width(font.default_layer_width());
        font.insert_glyph_layer(*glyph_id, layer)?;
        Ok((vec![*layer_id], Vec::new()))
    }
}

/// Moves one drawing to a new location, keeping its content and identity.
#[derive(Clone, Debug)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct SetGlyphLayerLocation {
    pub layer_id: LayerId,
    pub base_source_id: Option<SourceId>,
    /// Values on font axes and the glyph's own axes, in each axis's units.
    pub coordinates: DesignLocation,
}

impl FontLevelIntent for SetGlyphLayerLocation {
    fn required_layer_ids(&self, _font: &Font) -> Vec<LayerId> {
        vec![self.layer_id]
    }

    fn apply(&self, font: &mut Font) -> CoreResult<(Vec<LayerId>, Vec<GlyphId>)> {
        let Self {
            layer_id,
            base_source_id,
            coordinates,
        } = self;
        coordinates
            .iter()
            .map(|(_, value)| *value)
            .require_finite(Coordinates::LayerLocation)?;
        let location = LayerLocation::new(*base_source_id, coordinates.clone());
        font.set_layer_location(*layer_id, location)?;
        Ok((vec![*layer_id], Vec::new()))
    }
}

/// Removes one drawing of a glyph, wherever it sits.
#[derive(Clone, Debug)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct DeleteGlyphLayer {
    pub layer_id: LayerId,
}

impl FontLevelIntent for DeleteGlyphLayer {
    fn required_layer_ids(&self, _font: &Font) -> Vec<LayerId> {
        vec![self.layer_id]
    }

    fn apply(&self, font: &mut Font) -> CoreResult<(Vec<LayerId>, Vec<GlyphId>)> {
        font.remove_glyph_layer(self.layer_id)?;
        Ok((vec![self.layer_id], Vec::new()))
    }
}
