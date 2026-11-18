//! A font's glyph axes and the drawings located on them.
//!
//! [`GlyphAxis`] ids and tags are unique across the font's axes and every
//! glyph's axes; the font enforces both. Edits to an axis's range never move a
//! stored value: [`GlyphAxisEdit::Range`] is refused when it would leave a
//! drawing or a component outside the range, and [`GlyphAxisEdit::Rescale`]
//! moves every stored value with the range.

use std::sync::Arc;

use super::index::IndexEntries;
use crate::Require;
use crate::axis::{Axis, AxisList, DesignLocation};
use crate::component::ComponentInheritance;
use crate::entity::{AxisId, ComponentId, GlyphId, LayerId, SourceId};
use crate::error::{CoreError, CoreResult};
use crate::glyph::{Glyph, GlyphLayer};
use crate::glyph_axis::{
    AxisValueUse, GlyphAxis, GlyphAxisEdit, private_tag, rescale_value, values_outside_range,
};
use crate::interpolation::InterpolationSample;
use crate::located_layer::LayerLocation;
use crate::variation::{AxisRange, DesignNormalization};

use super::Font;

impl Font {
    /// The glyph axis with `axis_id`, whichever glyph owns it.
    pub fn glyph_axis(&self, axis_id: AxisId) -> Option<&GlyphAxis> {
        let glyph_id = self.index().glyph_axis_owner(axis_id)?;
        self.glyph(*glyph_id)?.axis(axis_id)
    }

    /// The glyph that owns the glyph axis `axis_id`.
    pub fn glyph_axis_owner(&self, axis_id: AxisId) -> Option<GlyphId> {
        self.index().glyph_axis_owner(axis_id).copied()
    }

    /// The axis tagged `tag` in `glyph_id`'s design space: a font axis, else
    /// one of the glyph's own axes. Without a glyph, font axes only.
    pub fn axis_id_in_glyph_space(&self, glyph_id: Option<GlyphId>, tag: &str) -> Option<AxisId> {
        if let Some(axis_id) = self.axis_id_by_tag(tag) {
            return Some(axis_id);
        }
        let axis_id = *self.index().glyph_axis_by_tag(tag)?;
        (self.glyph_axis_owner(axis_id) == Some(glyph_id?)).then_some(axis_id)
    }

    /// Whether a font axis or a glyph axis already uses `tag`.
    pub fn is_axis_tag_taken(&self, tag: &str) -> bool {
        self.axes().iter().any(|axis| axis.tag() == tag)
            || self.index().glyph_axis_by_tag(tag).is_some()
    }

    /// Checks that a font axis may take `axis_id` and `tag` without clashing
    /// with a glyph axis.
    pub(super) fn check_font_axis_against_glyph_axes(
        &self,
        axis_id: AxisId,
        tag: &str,
    ) -> CoreResult<()> {
        if self.index().glyph_axis_owner(axis_id).is_some() {
            return Err(CoreError::DuplicateAxisId(axis_id));
        }
        if self.index().glyph_axis_by_tag(tag).is_some() {
            return Err(CoreError::DuplicateAxisTag(tag.to_string()));
        }
        Ok(())
    }

    /// Adds `axis` to the glyph `glyph_id` and returns its id. An axis
    /// without a tag gets a deterministic private one from its name.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::GlyphNotFound`] for an unknown glyph,
    /// [`CoreError::InvalidAxis`] when the axis is invalid on its own, and
    /// [`CoreError::DuplicateAxisId`] or [`CoreError::DuplicateAxisTag`] when
    /// a font axis or another glyph axis already has its id or tag.
    pub fn add_glyph_axis(&mut self, glyph_id: GlyphId, axis: GlyphAxis) -> CoreResult<AxisId> {
        self.require_glyph(glyph_id)?;
        let axis = if axis.tag().is_empty() {
            let tag = private_tag(axis.name(), |tag| self.is_axis_tag_taken(tag));
            axis.with_tag(tag)
        } else {
            axis
        };
        axis.as_axis().validate()?;
        if self.axes().contains_axis(axis.id()) {
            return Err(CoreError::DuplicateAxisId(axis.id()));
        }
        if self
            .axes()
            .iter()
            .any(|font_axis| font_axis.tag() == axis.tag())
        {
            return Err(CoreError::DuplicateAxisTag(axis.tag().to_string()));
        }

        let mut index = self.index().clone();
        index.try_insert(IndexEntries::of_glyph_axis(glyph_id, &axis))?;
        let axis_id = axis.id();
        let state = self.state_mut();
        state.index = index;
        let glyph = state.data.glyphs.get_mut(&glyph_id).require(&glyph_id)?;
        Arc::make_mut(glyph).axes_mut().push(axis);
        Ok(axis_id)
    }

    /// Applies `edit` to the glyph axis `axis_id`. A failed edit leaves the
    /// font unchanged.
    ///
    /// - [`GlyphAxisEdit::Name`] changes its name, which must not be blank.
    /// - [`GlyphAxisEdit::Tag`] changes its tag, which must stay four ASCII
    ///   characters and unique across font and glyph axes.
    /// - [`GlyphAxisEdit::Range`] changes its range without moving any
    ///   stored value, and is refused when a value would fall outside it.
    /// - [`GlyphAxisEdit::Rescale`] changes its range and moves every stored
    ///   value with it, piecewise-linearly on each side of the default.
    /// - [`GlyphAxisEdit::Remove`] removes it, and is refused while any value
    ///   is stored on it.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::AxisNotFound`] for an unknown glyph axis,
    /// [`CoreError::InvalidAxis`] for a blank name, an invalid tag or a range not ordered
    /// around its default, [`CoreError::DuplicateAxisTag`] for a tag in use,
    /// [`CoreError::AxisValuesOutsideRange`] listing the values a range would
    /// strand, [`CoreError::DuplicateLayerLocation`] when a new default puts a
    /// drawing where another one is, and [`CoreError::GlyphAxisInUse`]
    /// listing the values that keep an axis from being removed.
    pub fn edit_glyph_axis(&mut self, axis_id: AxisId, edit: GlyphAxisEdit) -> CoreResult<()> {
        match edit {
            GlyphAxisEdit::Name(name) => self.set_glyph_axis_name(axis_id, name),
            GlyphAxisEdit::Tag(tag) => self.set_glyph_axis_tag(axis_id, tag),
            GlyphAxisEdit::Range(range) => self.set_glyph_axis_range(axis_id, range),
            GlyphAxisEdit::Rescale(range) => self.rescale_glyph_axis(axis_id, range),
            GlyphAxisEdit::Remove => self.remove_glyph_axis(axis_id),
        }
    }

    /// Changes a glyph axis's name, keeping its tag.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::AxisNotFound`] for an unknown glyph axis and
    /// [`CoreError::InvalidAxis`] for a blank name.
    fn set_glyph_axis_name(&mut self, axis_id: AxisId, name: String) -> CoreResult<()> {
        let (glyph_id, axis) = self.require_glyph_axis(axis_id)?;
        let renamed = axis.with_name(name);
        renamed.as_axis().validate()?;
        self.replace_glyph_axis(glyph_id, renamed)
    }

    /// Changes a glyph axis's tag.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::AxisNotFound`] for an unknown glyph axis,
    /// [`CoreError::InvalidAxis`] for a tag that isn't four ASCII characters,
    /// and [`CoreError::DuplicateAxisTag`] when another axis has it.
    fn set_glyph_axis_tag(&mut self, axis_id: AxisId, tag: String) -> CoreResult<()> {
        let (glyph_id, axis) = self.require_glyph_axis(axis_id)?;
        let renamed = axis.clone().with_tag(tag);
        renamed.as_axis().validate()?;
        if renamed.tag() == axis.tag() {
            return Ok(());
        }
        if self.is_axis_tag_taken(renamed.tag()) {
            return Err(CoreError::DuplicateAxisTag(renamed.tag().to_string()));
        }
        self.replace_glyph_axis(glyph_id, renamed)
    }

    /// Removes a glyph axis that no drawing or component sets a value on.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::AxisNotFound`] for an unknown glyph axis, and
    /// [`CoreError::GlyphAxisInUse`] listing every stored value on it.
    fn remove_glyph_axis(&mut self, axis_id: AxisId) -> CoreResult<()> {
        let (glyph_id, axis) = self.require_glyph_axis(axis_id)?;
        let uses = self.glyph_axis_uses(axis_id)?;
        if !uses.is_empty() {
            return Err(CoreError::GlyphAxisInUse { axis_id, uses });
        }
        let axis = axis.clone();

        let state = self.state_mut();
        state
            .index
            .remove(&IndexEntries::of_glyph_axis(glyph_id, &axis));
        let glyph = state.data.glyphs.get_mut(&glyph_id).require(&glyph_id)?;
        Arc::make_mut(glyph)
            .axes_mut()
            .retain(|existing| existing.id() != axis_id);
        Ok(())
    }

    /// Every value stored on the glyph axis `axis_id`: the coordinates of its
    /// glyph's located drawings, then the locations of components in the
    /// font that draw that glyph and set the axis.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::AxisNotFound`] for an unknown glyph axis.
    pub fn glyph_axis_uses(&self, axis_id: AxisId) -> CoreResult<Vec<AxisValueUse>> {
        let (glyph_id, _) = self.require_glyph_axis(axis_id)?;
        let glyph = self.require_glyph(glyph_id)?;
        let mut uses: Vec<AxisValueUse> = glyph
            .layers()
            .values()
            .filter_map(|layer| {
                let value = layer.location().coordinates().get(&axis_id)?;
                Some(AxisValueUse::Layer {
                    glyph_id,
                    layer_id: layer.id(),
                    value,
                })
            })
            .collect();

        for layer_id in self.layers_using_component_base(&glyph_id).copied() {
            let Some(owner) = self.glyph_id_by_layer(layer_id) else {
                continue;
            };
            let Some(layer) = self.layer(layer_id) else {
                continue;
            };
            uses.extend(
                layer
                    .components_iter()
                    .filter(|component| component.base_glyph_id() == glyph_id)
                    .filter_map(|component| {
                        let value = component.location().get(&axis_id)?;
                        Some(AxisValueUse::Component {
                            glyph_id: owner,
                            layer_id,
                            component_id: component.id(),
                            value,
                        })
                    }),
            );
        }
        Ok(uses)
    }

    /// Changes a glyph axis's range without moving any stored value.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::AxisNotFound`] for an unknown glyph axis,
    /// [`CoreError::InvalidAxis`] for a range that isn't ordered around its
    /// default, [`CoreError::AxisValuesOutsideRange`] listing every drawing
    /// coordinate and component location the new range would leave outside
    /// it, and [`CoreError::DuplicateLayerLocation`] when a new default puts
    /// a drawing where another one is. The font is unchanged on failure.
    fn set_glyph_axis_range(&mut self, axis_id: AxisId, range: AxisRange) -> CoreResult<()> {
        let (glyph_id, axis) = self.require_glyph_axis(axis_id)?;
        let edited = axis.with_range(range);
        edited.as_axis().validate()?;
        let stranded: Vec<AxisValueUse> = self
            .glyph_axis_uses(axis_id)?
            .into_iter()
            .filter(|value_use| !edited.contains(value_use.value()))
            .collect();
        if !stranded.is_empty() {
            return Err(values_outside_range(axis_id, stranded));
        }

        let before = self.clone();
        self.replace_glyph_axis(glyph_id, edited)?;
        let glyph = self.require_glyph(glyph_id)?;
        if let Err(error) = self.check_distinct_locations(glyph) {
            *self = before;
            return Err(error);
        }
        Ok(())
    }

    /// Changes a glyph axis's range and moves every value stored on it with
    /// the range, piecewise-linearly on each side of the default: the
    /// coordinates of its glyph's drawings and the locations of every
    /// component in the font that sets the axis. A drawing or component keeps
    /// its place relative to the range.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::AxisNotFound`] for an unknown glyph axis and
    /// [`CoreError::InvalidAxis`] for a range that isn't ordered around its
    /// default. The font is unchanged on failure.
    fn rescale_glyph_axis(&mut self, axis_id: AxisId, range: AxisRange) -> CoreResult<()> {
        let (glyph_id, axis) = self.require_glyph_axis(axis_id)?;
        let from = axis.as_axis().kind().range();
        let edited = axis.with_range(range);
        edited.as_axis().validate()?;
        let uses = self.glyph_axis_uses(axis_id)?;

        let before = self.clone();
        let rescaled = self.rescale_values(glyph_id, edited, uses, from);
        if rescaled.is_err() {
            *self = before;
        }
        rescaled
    }

    fn rescale_values(
        &mut self,
        glyph_id: GlyphId,
        edited: GlyphAxis,
        uses: Vec<AxisValueUse>,
        from: AxisRange,
    ) -> CoreResult<()> {
        let axis_id = edited.id();
        let range = edited.as_axis().kind().range();
        self.replace_glyph_axis(glyph_id, edited)?;
        let rescale = |value: f64| rescale_value(value, from, range);
        for value_use in uses {
            match value_use {
                AxisValueUse::Layer { layer_id, .. } => {
                    let layer = self.require_layer_mut(layer_id)?;
                    if let Some(location) = layer.own_location_mut() {
                        rescale_coordinate(location.coordinates_mut(), axis_id, rescale);
                    }
                }
                AxisValueUse::Component {
                    layer_id,
                    component_id,
                    ..
                } => {
                    let layer = self.require_layer_mut(layer_id)?;
                    let component = layer.component_mut(&component_id).require(&component_id)?;
                    let mut location = component.location().clone();
                    rescale_coordinate(&mut location, axis_id, rescale);
                    component.set_location(location);
                }
            }
        }
        Ok(())
    }

    /// The value a component that doesn't set `axis_id` draws its base glyph
    /// at on that axis, when the glyph it is placed in draws at `parent`: a
    /// font axis follows `inheritance`, and a glyph axis is never inherited,
    /// so it is the axis default. `None` for an axis the font doesn't have.
    pub fn inherited_value(
        &self,
        axis_id: AxisId,
        inheritance: ComponentInheritance,
        parent: &DesignLocation,
    ) -> Option<f64> {
        if let Some(axis) = self.axes().axis(axis_id) {
            return Some(inheritance.inherited_value(axis, parent));
        }
        self.glyph_axis(axis_id)
            .map(|axis| axis.as_axis().default())
    }

    /// The axes `glyph` is drawn along: the font's axes, then the glyph's own.
    pub fn glyph_space_axes(&self, glyph: &Glyph) -> Vec<Axis> {
        self.axes()
            .iter()
            .chain(glyph.axes().iter().map(GlyphAxis::as_axis))
            .cloned()
            .collect()
    }

    /// The design-space bounds of [`Self::glyph_space_axes`], in the same
    /// order: the font's [design normalization](Self::design_normalization),
    /// then each glyph axis over its own range.
    ///
    /// # Errors
    ///
    /// Returns the font's error when its axis mappings cannot be compiled.
    pub fn glyph_space_normalization(&self, glyph: &Glyph) -> CoreResult<Vec<DesignNormalization>> {
        let mut normalization = self.design_normalization()?;
        normalization.extend(
            glyph
                .axes()
                .iter()
                .map(|axis| DesignNormalization::new(axis.id(), axis.as_axis().kind().range())),
        );
        Ok(normalization)
    }

    /// Where `layer` draws in its glyph's design space: its base source's
    /// location with its own coordinates laid over it.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::SourceNotFound`] when its base is a source the
    /// font lacks.
    pub fn layer_design_location(&self, layer: &GlyphLayer) -> CoreResult<DesignLocation> {
        let location = layer.location();
        let mut design = match location.base_source_id() {
            Some(base) => self.require_source(base)?.location().clone(),
            None => DesignLocation::new(),
        };
        design.extend(
            location
                .coordinates()
                .iter()
                .map(|(axis_id, value)| (*axis_id, *value)),
        );
        Ok(design)
    }

    /// The source a per-source read of `layer` uses, such as its structure
    /// or bounds: its base source, or the default source for a layer placed
    /// by coordinates alone.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::MissingDefaultSource`] for a layer with no base
    /// in a font with no default source.
    pub fn reading_source_id(&self, layer: &GlyphLayer) -> CoreResult<SourceId> {
        layer
            .source_id()
            .or_else(|| self.default_source_id())
            .ok_or(CoreError::MissingDefaultSource)
    }

    /// Where an interpolation sample draws: its source's location, or its
    /// layer's.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::SourceNotFound`] or [`CoreError::LayerNotFound`]
    /// for a sample the font lacks.
    pub fn sample_location(&self, sample: InterpolationSample) -> CoreResult<DesignLocation> {
        match sample {
            InterpolationSample::Source(source_id) => {
                Ok(self.require_source(source_id)?.location().clone())
            }
            InterpolationSample::Layer(layer_id) => {
                self.layer_design_location(self.require_layer(layer_id)?)
            }
        }
    }

    /// Checks that a layer of `glyph` may draw at `location`: its base is a
    /// source of the font, it names only font axes and `glyph`'s own axes,
    /// its glyph-axis values are inside their ranges, and no other drawing of
    /// `glyph` sits there.
    pub(super) fn check_layer_location(
        &self,
        glyph: &Glyph,
        layer_id: LayerId,
        location: &LayerLocation,
    ) -> CoreResult<()> {
        if let Some(base) = location.base_source_id() {
            self.require_source(base)?;
        }
        for (axis_id, value) in location.coordinates() {
            if self.axes().contains_axis(*axis_id) {
                continue;
            }
            let axis = glyph
                .axis(*axis_id)
                .ok_or(CoreError::LayerLocationOffSpace {
                    layer_id,
                    axis_id: *axis_id,
                })?;
            if !axis.contains(*value) {
                return Err(values_outside_range(
                    *axis_id,
                    vec![AxisValueUse::Layer {
                        glyph_id: glyph.id(),
                        layer_id,
                        value: *value,
                    }],
                ));
            }
        }

        let Some(full) = location.design_location(self) else {
            return Ok(());
        };
        let axes = self.glyph_space_axes(glyph);
        for other in glyph.located_layers(self) {
            if other.layer.id() == layer_id {
                continue;
            }
            let Some(other_location) = other.location.design_location(self) else {
                continue;
            };
            if full.is_equivalent_to(&other_location, &axes) {
                return Err(CoreError::DuplicateLayerLocation {
                    glyph_id: glyph.id(),
                    first: other.layer.id(),
                    second: layer_id,
                });
            }
        }
        Ok(())
    }

    /// Moves the drawing `layer_id` to `location`, keeping its content.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::LayerNotFound`] for an unknown layer,
    /// [`CoreError::SourceNotFound`] for a base the font lacks,
    /// [`CoreError::LayerLocationOffSpace`] for an axis that is neither a font
    /// axis nor one of the glyph's, [`CoreError::AxisValuesOutsideRange`] for a
    /// glyph-axis value outside its range, and
    /// [`CoreError::DuplicateLayerLocation`] or
    /// [`CoreError::DuplicateGlyphLayer`] when another drawing of the glyph
    /// already sits there. The font is unchanged on failure.
    pub fn set_layer_location(
        &mut self,
        layer_id: LayerId,
        location: LayerLocation,
    ) -> CoreResult<()> {
        let glyph_id = self.require_layer_owner(layer_id)?;
        let glyph = self.require_glyph(glyph_id)?;
        let previous = Arc::clone(glyph.layers().get(&layer_id).require(&layer_id)?);
        if *previous.location() == location {
            return Ok(());
        }
        self.check_layer_location(glyph, layer_id, &location)?;
        let mut moved = (*previous).clone();
        moved.relocate(location);

        let mut index = self.index().clone();
        index.remove(&IndexEntries::records_of_layer(glyph_id, &previous));
        index.try_insert(IndexEntries::records_of_layer(glyph_id, &moved))?;
        let state = self.state_mut();
        state.index = index;
        let glyph = state.data.glyphs.get_mut(&glyph_id).require(&glyph_id)?;
        Arc::make_mut(glyph).set_layer(moved);
        Ok(())
    }

    /// Checks that a component of `base_glyph_id` in `layer_id` may draw its
    /// base at `location`: each axis is a font axis or one of the base glyph's
    /// own axes, and a value on a glyph axis lies inside its range.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::AxisNotFound`] for an axis the font has nowhere,
    /// [`CoreError::ComponentLocationOffSpace`] for another glyph's axis,
    /// [`CoreError::AxisValuesOutsideRange`] for a glyph-axis value outside its
    /// range, and [`CoreError::LayerNotFound`] for an unknown layer.
    pub(crate) fn check_component_location(
        &self,
        layer_id: LayerId,
        component_id: &ComponentId,
        base_glyph_id: GlyphId,
        location: &DesignLocation,
    ) -> CoreResult<()> {
        for (axis_id, value) in location.iter() {
            if self.axes().contains_axis(*axis_id) {
                continue;
            }
            let owner = self.glyph_axis_owner(*axis_id).require(axis_id)?;
            if owner != base_glyph_id {
                return Err(CoreError::ComponentLocationOffSpace {
                    component_id: component_id.clone(),
                    axis_id: *axis_id,
                });
            }
            let (_, axis) = self.require_glyph_axis(*axis_id)?;
            if !axis.contains(*value) {
                return Err(values_outside_range(
                    *axis_id,
                    vec![AxisValueUse::Component {
                        glyph_id: self.require_layer_owner(layer_id)?,
                        layer_id,
                        component_id: component_id.clone(),
                        value: *value,
                    }],
                ));
            }
        }
        Ok(())
    }

    /// Checks that no two of `glyph`'s drawings sit at one location, where
    /// one of them is located off the masters. Masters sharing a location
    /// were accepted before glyphs could have located drawings, so two of
    /// them alone are not refused.
    fn check_distinct_locations(&self, glyph: &Glyph) -> CoreResult<()> {
        for located in glyph.located_layers(self) {
            if located.layer.is_located() {
                self.check_layer_location(glyph, located.layer.id(), &located.location)?;
            }
        }
        Ok(())
    }

    fn require_glyph_axis(&self, axis_id: AxisId) -> CoreResult<(GlyphId, &GlyphAxis)> {
        let glyph_id = self.glyph_axis_owner(axis_id).require(&axis_id)?;
        let axis = self
            .require_glyph(glyph_id)?
            .axis(axis_id)
            .require(&axis_id)?;
        Ok((glyph_id, axis))
    }

    /// Replaces the glyph axis with `axis`'s id on `glyph_id`, keeping its
    /// place among the glyph's axes and updating the tag index.
    fn replace_glyph_axis(&mut self, glyph_id: GlyphId, axis: GlyphAxis) -> CoreResult<()> {
        let previous = self.require_glyph_axis(axis.id())?.1.clone();
        let mut index = self.index().clone();
        index.remove(&IndexEntries::of_glyph_axis(glyph_id, &previous));
        index.try_insert(IndexEntries::of_glyph_axis(glyph_id, &axis))?;
        let state = self.state_mut();
        state.index = index;
        let glyph = state.data.glyphs.get_mut(&glyph_id).require(&glyph_id)?;
        if let Some(slot) = Arc::make_mut(glyph)
            .axes_mut()
            .iter_mut()
            .find(|existing| existing.id() == axis.id())
        {
            *slot = axis;
        }
        Ok(())
    }
}

fn rescale_coordinate(
    location: &mut DesignLocation,
    axis_id: AxisId,
    rescale: impl Fn(f64) -> f64,
) {
    if let Some(value) = location.get(&axis_id) {
        location.set(axis_id, rescale(value));
    }
}
