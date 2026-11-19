//! Intents for a glyph's alternates and for where its components draw.
//!
//! Conditions are in design units, as the font stores them; see
//! [`crate::condition`]. Text written in user units, such as `Weight ≥ 700`,
//! is turned into a [`Condition`] by [`crate::ConditionSpace`].

use super::*;
use crate::{AlternateId, Condition, GlyphAlternate};

/// Replaces a glyph's alternates with `alternates`, tried in order: the
/// whole list at once, as a batch import writes it.
#[derive(Clone, Debug)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct SetGlyphAlternates {
    pub glyph_id: GlyphId,
    /// Each with a caller-minted id unique in the font.
    pub alternates: Vec<GlyphAlternate>,
}

impl FontLevelIntent for SetGlyphAlternates {
    fn apply(&self, font: &mut Font) -> CoreResult<(Vec<LayerId>, Vec<GlyphId>)> {
        font.set_glyph_alternates(self.glyph_id, self.alternates.clone())?;
        Ok((Vec::new(), vec![self.glyph_id]))
    }
}

/// Adds one alternate to a glyph, such as `dollar.bled` where Bleed is at
/// least 70.
#[derive(Clone, Debug)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct AddGlyphAlternate {
    pub glyph_id: GlyphId,
    /// With a caller-minted id unique in the font.
    pub alternate: GlyphAlternate,
    /// Zero-based position in the list, which is tried in order; `None`
    /// adds it last, where it is tried after every other.
    pub position: Option<usize>,
}

impl FontLevelIntent for AddGlyphAlternate {
    fn apply(&self, font: &mut Font) -> CoreResult<(Vec<LayerId>, Vec<GlyphId>)> {
        let Self {
            glyph_id,
            alternate,
            position,
        } = self;
        font.edit_glyph_alternates(*glyph_id, |alternates| {
            let position = position.unwrap_or(alternates.len());
            if position > alternates.len() {
                return Err(CoreError::AlternatePositionOutOfRange {
                    glyph_id: *glyph_id,
                    position,
                    count: alternates.len(),
                });
            }
            alternates.insert(position, alternate.clone());
            Ok(())
        })?;
        Ok((Vec::new(), vec![*glyph_id]))
    }
}

/// What [`EditGlyphAlternate`] does to one alternate.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub enum GlyphAlternateEdit {
    /// Replaces where it applies.
    Condition(Condition),
    /// Replaces the glyph it draws.
    Glyph(GlyphId),
    /// Moves it to this zero-based position, counted after it leaves its
    /// current one.
    Move(usize),
    /// Removes it; its glyph stays in the font.
    Remove,
}

/// Edits or removes one alternate, wherever its glyph is.
#[derive(Clone, Debug)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct EditGlyphAlternate {
    pub alternate_id: AlternateId,
    pub edit: GlyphAlternateEdit,
}

impl FontLevelIntent for EditGlyphAlternate {
    fn apply(&self, font: &mut Font) -> CoreResult<(Vec<LayerId>, Vec<GlyphId>)> {
        let Self { alternate_id, edit } = self;
        let glyph_id = font.alternate_owner(*alternate_id).require(alternate_id)?;
        font.edit_glyph_alternates(glyph_id, |alternates| {
            let index = alternates
                .iter()
                .map(GlyphAlternate::id)
                .position(|id| id == *alternate_id)
                .require(alternate_id)?;
            let current = alternates.get_mut(index).require(alternate_id)?;
            match edit {
                GlyphAlternateEdit::Condition(condition) => {
                    *current =
                        GlyphAlternate::new(*alternate_id, condition.clone(), current.glyph());
                }
                GlyphAlternateEdit::Glyph(glyph) => {
                    *current =
                        GlyphAlternate::new(*alternate_id, current.condition().clone(), *glyph);
                }
                GlyphAlternateEdit::Move(position) => {
                    let alternate = alternates.remove(index);
                    if *position > alternates.len() {
                        return Err(CoreError::AlternatePositionOutOfRange {
                            glyph_id,
                            position: *position,
                            count: alternates.len() + 1,
                        });
                    }
                    alternates.insert(*position, alternate);
                }
                GlyphAlternateEdit::Remove => {
                    alternates.remove(index);
                }
            }
            Ok(())
        })?;
        Ok((Vec::new(), vec![glyph_id]))
    }
}

/// Sets where one component draws, the same in every drawing of its glyph.
///
/// The component is named by its id in one drawing; its counterparts are the
/// components at the same position in each other drawing whose components
/// draw the same glyphs in the same order, as interpolation matches them. A
/// drawing whose components differ is left as it is: it doesn't interpolate
/// with the others, and `check` reports it.
///
/// The condition is evaluated where the glyph is drawn, before the
/// component's own location applies (skrifa's rule), so it may read font axes and the glyph's
/// own axes, never the axes of the glyph the component draws.
#[derive(Clone, Debug)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct SetComponentCondition {
    pub layer_id: LayerId,
    pub component_id: ComponentId,
    /// In design units; [`Condition::always`] clears it.
    pub condition: Condition,
}

impl FontLevelIntent for SetComponentCondition {
    fn required_layer_ids(&self, font: &Font) -> Vec<LayerId> {
        let Some(glyph_id) = font.glyph_id_by_layer(self.layer_id) else {
            return vec![self.layer_id];
        };
        font.layer_ids_of_glyphs([&glyph_id]).into_iter().collect()
    }

    fn apply(&self, font: &mut Font) -> CoreResult<(Vec<LayerId>, Vec<GlyphId>)> {
        let Self {
            layer_id,
            component_id,
            condition,
        } = self;
        let glyph = font.require_glyph(font.require_layer_owner(*layer_id)?)?;
        let layer = font.require_layer(*layer_id)?;
        let mut component = layer.component(component_id).require(component_id)?.clone();
        component.set_condition(condition.clone());
        font.check_component_condition(glyph, &component)?;

        let position = layer
            .components()
            .index_of(component_id)
            .require(component_id)?;
        let counterparts: Vec<(LayerId, ComponentId)> = glyph
            .layers()
            .values()
            .filter(|candidate| {
                candidate
                    .component_glyph_ids()
                    .eq(layer.component_glyph_ids())
            })
            .filter_map(|candidate| {
                let counterpart = candidate.components_iter().nth(position)?;
                Some((candidate.id(), counterpart.id()))
            })
            .collect();
        for (layer_id, component_id) in &counterparts {
            let layer = font.require_layer_mut(*layer_id)?;
            if let Some(component) = layer.component_mut(component_id) {
                component.set_condition(condition.clone());
            }
        }
        let layer_ids = counterparts
            .into_iter()
            .map(|(layer_id, _)| layer_id)
            .collect();
        Ok((layer_ids, Vec::new()))
    }
}

impl Font {
    /// Edits `glyph_id`'s list of alternates through `edit`, then checks
    /// and keeps it; see [`Self::set_glyph_alternates`]. The font is
    /// unchanged on failure.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::GlyphNotFound`] for an unknown glyph, `edit`'s
    /// error, and the errors of [`Self::set_glyph_alternates`].
    fn edit_glyph_alternates(
        &mut self,
        glyph_id: GlyphId,
        edit: impl FnOnce(&mut Vec<GlyphAlternate>) -> CoreResult<()>,
    ) -> CoreResult<()> {
        let mut alternates = self.require_glyph(glyph_id)?.alternates().to_vec();
        edit(&mut alternates)?;
        self.set_glyph_alternates(glyph_id, alternates)
    }
}
