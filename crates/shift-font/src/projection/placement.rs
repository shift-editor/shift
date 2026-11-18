//! Where components sit: anchored ones placed from their anchors, read where
//! each glyph is drawn, whenever a reader asks.

use std::collections::HashMap;

use crate::anchor_attachment::{PlacingComponent, anchored_placements};
use crate::{
    Anchor, AxisList, Component, CoreResult, DecomposedTransform, DesignLocation, Font, Glyph,
    GlyphId, GlyphLayer, SourceId, Transform,
};

use super::FontProjection;

impl FontProjection<'_> {
    /// Where `component` draws its base glyph, when that is not this
    /// projection's location.
    ///
    /// Only font axes pass from a glyph to its components' bases: a base
    /// draws at the default of each of its own axes the component doesn't
    /// set, even when this projection's location sets that axis.
    pub(super) fn moved_location(&self, component: &Component) -> Option<DesignLocation> {
        let font_axes = self.font.axes();
        let only_font_axes = self
            .location
            .iter()
            .all(|(axis_id, _)| font_axes.contains_axis(*axis_id));
        if !component.moves_base() && only_font_axes {
            return None;
        }
        // An empty location is the font's default location.
        let location = component.base_location(&self.location, &DesignLocation::new(), font_axes);
        let base_axes = self
            .font
            .glyph(component.base_glyph_id())
            .map(Glyph::axes)
            .unwrap_or_default();
        let same_on_base_axes = base_axes.iter().all(|axis| {
            let axis = axis.as_axis();
            (location.value_on(axis) - self.location.value_on(axis)).abs() <= 1e-6
        });
        let same_place = same_on_base_axes && location.is_equivalent_to(&self.location, font_axes);
        (!same_place).then_some(location)
    }

    /// Runs `read` on a projection at `location` that shares this one's
    /// interpolation bases.
    pub(super) fn at<T>(
        &mut self,
        location: &DesignLocation,
        read: impl FnOnce(&mut Self) -> T,
    ) -> T {
        let mut moved = self.font.projection(location);
        moved.interpolation_bases = std::mem::take(&mut self.interpolation_bases);
        let value = read(&mut moved);
        self.interpolation_bases = moved.interpolation_bases;
        value
    }

    /// Each of `layer`'s components' placements here, as matrices.
    pub(super) fn component_placements(
        &mut self,
        layer: &GlyphLayer,
    ) -> CoreResult<Vec<Transform>> {
        Ok(self
            .component_transforms(layer)?
            .into_iter()
            .map(DecomposedTransform::to_matrix)
            .collect())
    }

    /// Each of `layer`'s components' transforms here: anchored components
    /// on anchors read where each glyph is drawn ([`anchored_placements`]),
    /// so a mark whose location is set elsewhere sits on its anchor there,
    /// and a mark stacked on it follows it. Others as authored.
    fn component_transforms(&mut self, layer: &GlyphLayer) -> CoreResult<Vec<DecomposedTransform>> {
        let authored = layer
            .components_iter()
            .map(|component| *component.transform());
        // A component aligns only to an earlier one.
        if layer.components_iter().nth(1).is_none() {
            return Ok(authored.collect());
        }

        let mut anchors = Vec::new();
        for component in layer.components_iter() {
            let base_glyph_id = component.base_glyph_id();
            let own = match self.moved_location(component) {
                Some(location) => self.at(&location, |moved| moved.own_anchors(base_glyph_id))?,
                None => self.own_anchors(base_glyph_id)?,
            };
            anchors.push(own);
        }
        let placing: Vec<_> = layer
            .components_iter()
            .zip(&anchors)
            .map(|(component, anchors)| PlacingComponent {
                alignment: component.alignment(),
                transform: *component.transform(),
                anchors,
            })
            .collect();
        Ok(anchored_placements(&placing))
    }

    /// `glyph_id`'s own anchors here; none when it has no shape here.
    fn own_anchors(&mut self, glyph_id: GlyphId) -> CoreResult<Vec<Anchor>> {
        if !self.prepare_layer_tree(glyph_id)? {
            return Ok(Vec::new());
        }
        Ok(self
            .layers
            .get(&glyph_id)
            .map(|layer| layer.anchors().to_vec())
            .unwrap_or_default())
    }
}

impl Font {
    /// The font's glyphs with each anchored component's transform set where
    /// its anchors place it at each layer's location, for a reader that takes
    /// stored transforms as they are, such as export.
    ///
    /// # Errors
    ///
    /// Returns a projection's resolution errors.
    pub fn glyphs_with_derived_placements(&self) -> CoreResult<Vec<Glyph>> {
        let mut projections: HashMap<SourceId, FontProjection<'_>> = HashMap::new();
        let mut glyphs = Vec::new();
        for glyph in self.glyphs() {
            let mut placed = Vec::new();
            for (layer_id, layer) in glyph.layers() {
                if layer.components_iter().nth(1).is_none() {
                    continue;
                }
                let Some(location) = layer.location().design_location(self) else {
                    continue;
                };
                let transforms = match layer.location().exact_source_id() {
                    Some(source_id) => projections
                        .entry(source_id)
                        .or_insert_with(|| self.projection(&location))
                        .component_transforms(layer)?,
                    None => self.projection(&location).component_transforms(layer)?,
                };
                placed.push((*layer_id, transforms));
            }
            let mut glyph = glyph.clone();
            for (layer_id, transforms) in placed {
                let Some(layer) = glyph.layer_mut(layer_id) else {
                    continue;
                };
                for (component, transform) in layer.components_iter_mut().zip(transforms) {
                    component.set_transform(transform);
                }
            }
            glyphs.push(glyph);
        }
        Ok(glyphs)
    }
}
