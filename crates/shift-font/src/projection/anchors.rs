//! A glyph's anchors as export compiles them, at a projection's location.

use std::collections::HashSet;
use std::sync::Arc;

use super::FontProjection;
use crate::anchor_propagation::{
    PropagatedAnchors, PropagationAnchor, PropagationComponent, PropagationGlyph, compiled_anchors,
};
use crate::{CoreResult, GlyphId, OpenTypeCategory};

impl FontProjection<'_> {
    /// Returns `glyph_id`'s anchors as export compiles them at this
    /// projection's location, with its components' anchors propagated in
    /// (shift-font's [`compiled_anchors`]); `None` when the glyph has no
    /// shape here. `class` gives each glyph's `GDEF` class, which decides
    /// whether propagation treats it as a mark or a ligature.
    ///
    /// Each glyph's anchors are resolved once per projection; a component
    /// cycle contributes no anchors.
    ///
    /// # Errors
    ///
    /// Returns the projection's resolution errors, as [`Self::glyph`].
    pub fn compiled_anchors(
        &mut self,
        glyph_id: GlyphId,
        class: &impl Fn(GlyphId) -> Option<OpenTypeCategory>,
    ) -> CoreResult<Option<Arc<PropagatedAnchors>>> {
        self.compiled_anchors_within(glyph_id, class, &mut HashSet::new())
    }

    fn compiled_anchors_within(
        &mut self,
        glyph_id: GlyphId,
        class: &impl Fn(GlyphId) -> Option<OpenTypeCategory>,
        visiting: &mut HashSet<GlyphId>,
    ) -> CoreResult<Option<Arc<PropagatedAnchors>>> {
        if let Some(anchors) = self.anchors.get(&glyph_id) {
            return Ok(Some(Arc::clone(anchors)));
        }
        if !visiting.insert(glyph_id) || !self.prepare_layer_tree(glyph_id)? {
            return Ok(None);
        }
        let layer = &self.layers[&glyph_id];
        let own: Vec<PropagationAnchor> = layer
            .anchors_iter()
            .filter_map(|anchor| {
                Some(PropagationAnchor {
                    name: anchor.name()?.to_string(),
                    x: anchor.x(),
                    y: anchor.y(),
                })
            })
            .collect();
        let placements: Vec<_> = layer
            .components_iter()
            .map(|component| (component.base_glyph_id(), component.matrix()))
            .collect();

        let mut components = Vec::with_capacity(placements.len());
        for (base, transform) in placements {
            let anchors = self.compiled_anchors_within(base, class, visiting)?;
            components.push((anchors, transform));
        }
        let propagation_components: Vec<PropagationComponent<'_>> = components
            .iter()
            .map(|(anchors, transform)| PropagationComponent {
                anchors: anchors.as_deref().map(|anchors| anchors.anchors.as_slice()),
                base_glyph_count: anchors
                    .as_deref()
                    .map_or(0, |anchors| anchors.base_glyph_count),
                transform: *transform,
            })
            .collect();
        let category = class(glyph_id);
        let compiled = Arc::new(compiled_anchors(&PropagationGlyph {
            anchors: &own,
            components: &propagation_components,
            is_mark: category == Some(OpenTypeCategory::Mark),
            is_ligature: category == Some(OpenTypeCategory::Ligature),
        }));
        visiting.remove(&glyph_id);
        self.anchors.insert(glyph_id, Arc::clone(&compiled));
        Ok(Some(compiled))
    }
}
