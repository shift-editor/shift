//! A font's glyph alternates and the conditions on its components.
//!
//! Alternates swap a glyph for another where text is drawn
//! ([`crate::glyph_alternate`]); component conditions say where a component
//! draws at all. The font checks both against its axes when a glyph or layer
//! is added or replaced.

use std::collections::BTreeSet;

use crate::Require;
use crate::axis::{AxisList, DesignLocation};
use crate::component::Component;
use crate::entity::GlyphId;
use crate::error::{CoreError, CoreResult};
use crate::glyph::{Glyph, GlyphLayer};
use crate::glyph_alternate::GlyphAlternate;

use super::Font;

impl Font {
    /// The glyph drawn for `glyph_id` at `location`: the glyph of its first
    /// alternate whose condition holds there, else the glyph itself. This is
    /// what text, previews and the glyph open for editing draw there; a
    /// component of `glyph_id` still draws `glyph_id`.
    /// Only font axes are read, each at its default when `location` doesn't
    /// name it. One step: the alternate glyph's own alternates are not
    /// applied.
    ///
    /// A glyph the font lacks draws as itself, so a caller looks it up as
    /// it would have.
    pub fn drawn_glyph_at(&self, glyph_id: GlyphId, location: &DesignLocation) -> GlyphId {
        let Some(glyph) = self.glyph(glyph_id) else {
            return glyph_id;
        };
        glyph
            .alternates()
            .iter()
            .find(|alternate| alternate.condition().holds_at(location, self.axes()))
            .map_or(glyph_id, GlyphAlternate::glyph)
    }

    /// Every alternate glyph of one of `glyph_ids`: what a reader that draws
    /// those glyphs must have loaded besides them.
    pub fn alternate_glyphs_of<'a>(
        &self,
        glyph_ids: impl IntoIterator<Item = &'a GlyphId>,
    ) -> BTreeSet<GlyphId> {
        glyph_ids
            .into_iter()
            .filter_map(|glyph_id| self.glyph(*glyph_id))
            .flat_map(Glyph::alternates)
            .map(GlyphAlternate::glyph)
            .collect()
    }

    /// Replaces `glyph_id`'s alternates with `alternates`, tried in order.
    /// The font is unchanged on failure.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::GlyphNotFound`] for an unknown glyph, the errors
    /// of [`Self::check_glyph_alternates`], and
    /// [`CoreError::DuplicateAlternateId`] for an alternate id the font
    /// already uses.
    // Only tests set alternates on a glyph in the font until the authoring
    // intent that calls this exists.
    #[cfg(test)]
    pub(crate) fn set_glyph_alternates(
        &mut self,
        glyph_id: GlyphId,
        alternates: Vec<GlyphAlternate>,
    ) -> CoreResult<()> {
        let mut glyph = self.require_glyph(glyph_id)?.clone();
        glyph.set_alternates(alternates);
        self.check_glyph_alternates(&glyph)?;
        let alternates = glyph.alternates().to_vec();
        self.edit_indexed_glyph(glyph_id, |glyph| glyph.set_alternates(alternates))
    }

    /// Checks `glyph`'s alternates: each draws a glyph the font has, other
    /// than `glyph`, and its condition is well formed and reads font axes
    /// only.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::AlternateIsItself`], [`CoreError::GlyphNotFound`]
    /// for an alternate glyph the font lacks,
    /// [`CoreError::AlternateConditionOffFontAxes`], or a condition's own
    /// error ([`crate::Condition::check_well_formed`]) for the first
    /// alternate that fails.
    pub(super) fn check_glyph_alternates(&self, glyph: &Glyph) -> CoreResult<()> {
        for alternate in glyph.alternates() {
            let alternate_id = alternate.id();
            if alternate.glyph() == glyph.id() {
                return Err(CoreError::AlternateIsItself {
                    alternate_id,
                    glyph_id: glyph.id(),
                });
            }
            self.require_glyph(alternate.glyph())?;
            alternate.condition().check_well_formed()?;
            if let Some(axis_id) = alternate
                .condition()
                .axis_ids()
                .find(|axis_id| !self.axes().contains_axis(*axis_id))
            {
                return Err(CoreError::AlternateConditionOffFontAxes {
                    alternate_id,
                    axis_id,
                });
            }
        }
        Ok(())
    }

    /// Checks that `glyph_id` is no other glyph's alternate, before it goes.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::GlyphIsAlternate`] naming a glyph it is an
    /// alternate of.
    pub(super) fn check_not_an_alternate(&self, glyph_id: GlyphId) -> CoreResult<()> {
        match self
            .index()
            .glyphs_with_alternate(&glyph_id)
            .find(|owner| **owner != glyph_id)
        {
            Some(owner) => Err(CoreError::GlyphIsAlternate {
                glyph_id,
                alternate_of: *owner,
            }),
            None => Ok(()),
        }
    }

    /// Checks the condition of every component in `layer`; see
    /// [`Self::check_component_condition`].
    ///
    /// # Errors
    ///
    /// As [`Self::check_component_condition`], for the first component.
    pub(crate) fn check_layer_conditions(&self, layer: &GlyphLayer) -> CoreResult<()> {
        layer
            .components_iter()
            .try_for_each(|component| self.check_component_condition(component))
    }

    /// Checks that `component`'s condition is well formed and reads only
    /// axes its base glyph draws along: font axes and the base glyph's own,
    /// the axes of the location the condition is evaluated at.
    ///
    /// # Errors
    ///
    /// Returns a condition's own error ([`crate::Condition::check_well_formed`]),
    /// [`CoreError::AxisNotFound`] for an axis the font has nowhere, and
    /// [`CoreError::ComponentConditionOffSpace`] for another glyph's axis.
    pub(crate) fn check_component_condition(&self, component: &Component) -> CoreResult<()> {
        let condition = component.condition();
        condition.check_well_formed()?;
        for axis_id in condition.axis_ids() {
            if self.axes().contains_axis(axis_id) {
                continue;
            }
            let owner = self.glyph_axis_owner(axis_id).require(&axis_id)?;
            if owner != component.base_glyph_id() {
                return Err(CoreError::ComponentConditionOffSpace {
                    component_id: component.id(),
                    axis_id,
                });
            }
        }
        Ok(())
    }
}
