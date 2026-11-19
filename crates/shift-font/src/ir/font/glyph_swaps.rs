//! A font's glyph swaps and the conditions on its components.
//!
//! Swaps draw another glyph in a glyph's place where text is drawn
//! ([`crate::glyph_swap`]); component conditions say where a component
//! draws at all. The font checks both against its axes when a glyph or layer
//! is added or replaced.

use std::collections::BTreeSet;

use crate::Require;
use crate::axis::{AxisList, DesignLocation};
use crate::component::Component;
use crate::contour::Contour;
use crate::entity::LayerId;
use crate::entity::{GlyphId, SwapId};
use crate::error::{CoreError, CoreResult};
use crate::glyph::{Glyph, GlyphLayer};
use crate::glyph_swap::{GlyphSwap, NeverUsedSwap, never_used_swaps};

use super::Font;

impl Font {
    /// The glyph drawn for `glyph_id` at `location`: the glyph of its first
    /// swap whose condition holds there, else the glyph itself. This is
    /// what text, previews and the glyph open for editing draw there; a
    /// component of `glyph_id` still draws `glyph_id`.
    /// Only font axes are read, each at its default when `location` doesn't
    /// name it. One step: the swap glyph's own swaps are not
    /// applied.
    ///
    /// A glyph the font lacks draws as itself, so a caller looks it up as
    /// it would have.
    pub fn drawn_glyph_at(&self, glyph_id: GlyphId, location: &DesignLocation) -> GlyphId {
        let Some(glyph) = self.glyph(glyph_id) else {
            return glyph_id;
        };
        glyph
            .swaps()
            .iter()
            .find(|swap| swap.condition().holds_at(location, self.axes()))
            .map_or(glyph_id, GlyphSwap::glyph)
    }

    /// `glyph_id`'s swaps that never win anywhere on the font's axes;
    /// see [`never_used_swaps`].
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::GlyphNotFound`] for an unknown glyph and an
    /// axis-mapping error when an authored mapping cannot compile.
    pub fn never_used_swaps(&self, glyph_id: GlyphId) -> CoreResult<Vec<NeverUsedSwap>> {
        let glyph = self.require_glyph(glyph_id)?;
        if glyph.swaps().is_empty() {
            return Ok(Vec::new());
        }
        Ok(never_used_swaps(
            glyph.swaps(),
            &self.design_normalization()?,
        ))
    }

    /// Every swap glyph of one of `glyph_ids`: what a reader that draws
    /// those glyphs must have loaded besides them.
    pub fn swap_glyphs_of<'a>(
        &self,
        glyph_ids: impl IntoIterator<Item = &'a GlyphId>,
    ) -> BTreeSet<GlyphId> {
        glyph_ids
            .into_iter()
            .filter_map(|glyph_id| self.glyph(*glyph_id))
            .flat_map(Glyph::swaps)
            .map(GlyphSwap::glyph)
            .collect()
    }

    /// Replaces `glyph_id`'s swaps with `swaps`, tried in order.
    /// The font is unchanged on failure.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::GlyphNotFound`] for an unknown glyph or swap
    /// glyph, [`CoreError::SwapIsItself`],
    /// [`CoreError::SwapConditionOffFontAxes`], [`CoreError::AxisNotFound`],
    /// a condition's own error, and
    /// [`CoreError::DuplicateSwapId`] for a swap id the font
    /// already uses.
    pub fn set_glyph_swaps(&mut self, glyph_id: GlyphId, swaps: Vec<GlyphSwap>) -> CoreResult<()> {
        let mut glyph = self.require_glyph(glyph_id)?.clone();
        glyph.set_swaps(swaps);
        self.check_glyph_swaps(&glyph)?;
        let swaps = glyph.swaps().to_vec();
        self.edit_indexed_glyph(glyph_id, |glyph| glyph.set_swaps(swaps))
    }

    /// The glyph that has the swap `swap_id`.
    pub fn swap_owner(&self, swap_id: SwapId) -> Option<GlyphId> {
        self.index().swap_owner(swap_id).copied()
    }

    /// Checks `glyph`'s swaps: each draws a glyph the font has, other
    /// than `glyph`, and its condition is well formed and reads font axes
    /// only.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::SwapIsItself`], [`CoreError::GlyphNotFound`]
    /// for a swap glyph the font lacks,
    /// [`CoreError::SwapConditionOffFontAxes`] for a glyph's own axis,
    /// [`CoreError::AxisNotFound`] for an axis the font has nowhere, or a condition's own
    /// error ([`crate::Condition::check_well_formed`]) for the first
    /// swap that fails.
    pub(super) fn check_glyph_swaps(&self, glyph: &Glyph) -> CoreResult<()> {
        for swap in glyph.swaps() {
            let swap_id = swap.id();
            if swap.glyph() == glyph.id() {
                return Err(CoreError::SwapIsItself {
                    swap_id,
                    glyph_id: glyph.id(),
                });
            }
            self.require_glyph(swap.glyph())?;
            swap.condition().check_well_formed()?;
            if let Some(axis_id) = swap
                .condition()
                .axis_ids()
                .find(|axis_id| !self.axes().contains_axis(*axis_id))
            {
                self.glyph_axis_owner(axis_id).require(&axis_id)?;
                return Err(CoreError::SwapConditionOffFontAxes { swap_id, axis_id });
            }
        }
        Ok(())
    }

    /// Checks that `glyph_id` is no other glyph's swap, before it goes.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::GlyphIsSwap`] naming a glyph it is a
    /// swap of.
    pub(super) fn check_not_a_swap(&self, glyph_id: GlyphId) -> CoreResult<()> {
        match self
            .index()
            .glyphs_with_swap(&glyph_id)
            .find(|owner| **owner != glyph_id)
        {
            Some(owner) => Err(CoreError::GlyphIsSwap {
                glyph_id,
                swap_of: *owner,
            }),
            None => Ok(()),
        }
    }

    /// Checks the condition of every component in `layer`, a layer of
    /// `parent`; see [`Self::check_component_condition`].
    ///
    /// # Errors
    ///
    /// As [`Self::check_component_condition`], for the first component.
    pub(crate) fn check_layer_conditions(
        &self,
        parent: &Glyph,
        layer: &GlyphLayer,
    ) -> CoreResult<()> {
        layer
            .components_iter()
            .try_for_each(|component| self.check_component_condition(parent, component))
    }

    /// Checks that `component`, placed in `parent`, has a well-formed
    /// condition that reads only axes `parent` draws along: font axes and
    /// `parent`'s own, the axes of the coordinates the condition is
    /// evaluated at (skrifa's rule; see `FontProjection::draws`). The
    /// component's base glyph's own axes are not among them.
    ///
    /// # Errors
    ///
    /// Returns a condition's own error ([`crate::Condition::check_well_formed`]),
    /// [`CoreError::AxisNotFound`] for an axis the font has nowhere, and
    /// [`CoreError::ComponentConditionOffSpace`] for another glyph's axis.
    pub(crate) fn check_component_condition(
        &self,
        parent: &Glyph,
        component: &Component,
    ) -> CoreResult<()> {
        let condition = component.condition();
        condition.check_well_formed()?;
        for axis_id in condition.axis_ids() {
            if self.axes().contains_axis(axis_id) || parent.axis(axis_id).is_some() {
                continue;
            }
            self.glyph_axis_owner(axis_id).require(&axis_id)?;
            return Err(CoreError::ComponentConditionOffSpace {
                component_id: component.id(),
                axis_id,
            });
        }
        Ok(())
    }
    /// This font with every glyph whose drawing reads a component condition,
    /// in its own components or theirs, replaced by its outline at design
    /// `location` as the editor draws it there ([`crate::FontProjection::glyph`]):
    /// one layer on the default source holding the flattened contours, with
    /// the advance and anchors the glyph has at `location`. Other glyphs are
    /// unchanged, so the result has no component conditions and compiles,
    /// and draws exactly as this font does at `location`, and only there.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::MissingDefaultSource`] when the font has no
    /// default source, and a projection's resolution errors.
    pub fn with_component_conditions_drawn_at(
        &self,
        location: &DesignLocation,
    ) -> CoreResult<Self> {
        let mut reading: BTreeSet<GlyphId> = self
            .glyphs()
            .filter(|glyph| !glyph.conditional_components().is_empty())
            .map(Glyph::id)
            .collect();
        if reading.is_empty() {
            return Ok(self.clone());
        }
        let mut added: Vec<GlyphId> = reading.iter().copied().collect();
        while let Some(base) = added.pop() {
            let composites: Vec<GlyphId> =
                self.index().composite_glyphs_of(&base).copied().collect();
            for composite in composites {
                if reading.insert(composite) {
                    added.push(composite);
                }
            }
        }

        let default_id = self
            .default_source_id()
            .ok_or(CoreError::MissingDefaultSource)?;
        let mut projection = self.projection(location);
        let mut flattened = Vec::new();
        for glyph_id in reading {
            let glyph = self.require_glyph(glyph_id)?;
            let (Some(drawn), Some(own)) =
                (projection.glyph(glyph_id)?, self.layer_at(glyph, location)?)
            else {
                continue;
            };
            let layer_id = self
                .default_master_layer(glyph)
                .map_or_else(LayerId::new, |layer| layer.id());
            let mut layer = GlyphLayer::with_width(layer_id, default_id, drawn.x_advance());
            for contour in drawn.contours() {
                let mut flat = Contour::new();
                for point in &contour.points {
                    flat.push_point(point.with_fresh_id());
                }
                if contour.closed {
                    flat.close();
                }
                layer.add_contour(flat);
            }
            for anchor in own.anchors_iter() {
                layer.add_anchor(anchor.clone());
            }
            let old_layers: Vec<LayerId> = glyph.layer_ids().collect();
            flattened.push((glyph_id, old_layers, layer));
        }

        let mut font = self.clone();
        for (glyph_id, old_layers, layer) in flattened {
            for layer_id in old_layers {
                font.remove_glyph_layer(layer_id)?;
            }
            font.insert_glyph_layer(glyph_id, layer)?;
        }
        Ok(font)
    }
}
