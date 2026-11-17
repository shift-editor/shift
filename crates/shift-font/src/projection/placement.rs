//! Where components sit: anchored ones placed from their anchors, read where
//! each glyph is drawn, whenever a reader asks.

use std::collections::HashMap;

use crate::anchor_attachment::{PlacingComponent, anchored_placements};
use crate::{
    Anchor, Component, CoreResult, DecomposedTransform, DesignLocation, Font, Glyph, GlyphId,
    GlyphLayer, SourceId, Transform,
};

use super::FontProjection;

impl FontProjection<'_> {
    /// Where `component` draws its base glyph, when that is not this
    /// projection's location.
    pub(super) fn moved_location(&self, component: &Component) -> Option<DesignLocation> {
        if !component.moves_base() {
            return None;
        }
        // An empty location is the font's default location.
        let location = component.base_location(&self.location, &DesignLocation::new());
        (!location.is_equivalent_to(&self.location, self.font.axes())).then_some(location)
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
    /// its anchors place it at each layer's source, for a reader that takes
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
                let Some(source) = self.source(layer.source_id()) else {
                    continue;
                };
                let projection = projections
                    .entry(source.id())
                    .or_insert_with(|| self.projection(source.location()));
                placed.push((*layer_id, projection.component_transforms(layer)?));
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
