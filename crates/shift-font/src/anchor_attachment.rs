//! Keeps anchored components on their anchors when the anchors move.
//!
//! A component records whether it is placed by its anchors
//! ([`ComponentAlignment`]). Adding one on matching anchors anchors it; moving
//! one by hand frees it. A component with no record yet, as in imported
//! sources, counts as anchored while its placement is exactly the translation
//! that puts one of its `_name` anchors on the matching `name` anchor of an
//! earlier component in the same layer, and is recorded as anchored once it
//! follows. When an edit changes anchors, every anchored component is placed
//! again from the new anchors, in component order, so a mark stacked on a
//! moved mark follows it too.

use std::collections::{HashMap, HashSet};

use crate::composite::anchor_aligned_offset;
use crate::ir::{
    ComponentAlignment, ComponentId, DecomposedTransform, Font, GlyphId, GlyphLayer, LayerId,
};

/// Placements that differ by less than this are the same.
const EPSILON: f64 = 1e-6;

/// Frees components an edit moved and places anchored ones again; returns
/// each layer it changed, and whether its components' alignment changed.
///
/// `touched` lists the layers the edit itself changed. Candidates are those
/// layers and every layer, at any source, whose components reference a glyph
/// whose anchors changed; their component glyphs must be loaded in both fonts.
pub(crate) fn realign_attached_components<'a>(
    before: &Font,
    after: &mut Font,
    touched: impl IntoIterator<Item = &'a LayerId>,
) -> Vec<(LayerId, bool)> {
    let touched: HashSet<&LayerId> = touched.into_iter().collect();
    let mut anchor_glyphs = HashSet::new();
    for &layer_id in &touched {
        let (Some(old), Some(new)) = (before.layer(layer_id), after.layer(layer_id)) else {
            continue;
        };
        if old.anchors() != new.anchors() {
            anchor_glyphs.extend(after.glyph_id_by_layer(layer_id));
        }
    }
    // Most edits move points: nothing to follow unless anchors or stacked components changed.
    if anchor_glyphs.is_empty()
        && !touched.iter().any(|layer_id| {
            after
                .layer(layer_id)
                .is_some_and(|layer| layer.components_iter().nth(1).is_some())
        })
    {
        return Vec::new();
    }

    let candidates: Vec<LayerId> = after
        .glyphs()
        .flat_map(|glyph| glyph.layers().values())
        .filter(|layer| layer.components_iter().nth(1).is_some())
        .filter(|layer| {
            touched.contains(&layer.id())
                || layer
                    .components_iter()
                    .any(|component| anchor_glyphs.contains(&component.base_glyph_id()))
        })
        .map(|layer| layer.id())
        .collect();

    let mut changed_layers = Vec::new();
    for layer_id in candidates {
        let (Some(old), Some(new)) = (before.layer(&layer_id), after.layer(&layer_id)) else {
            continue;
        };
        let moved = |id: &ComponentId| {
            old.component(id).map(|c| c.transform()) != new.component(id).map(|c| c.transform())
        };
        let placed = sitting_on_anchors(before, old);
        let mut freed = HashSet::new();
        let mut anchored = HashSet::new();
        for component in new.components_iter() {
            let id = component.id();
            let existed = old.component(&id).is_some();
            match component.alignment() {
                ComponentAlignment::Free => {}
                // Moved by hand: it stays where it was put.
                _ if existed && moved(&id) => {
                    freed.insert(id);
                }
                ComponentAlignment::Anchored => {
                    anchored.insert(id);
                }
                ComponentAlignment::Unset if placed.contains(&id) => {
                    anchored.insert(id);
                }
                ComponentAlignment::Unset => {}
            }
        }
        if freed.is_empty() && anchored.is_empty() {
            continue;
        }

        let placements = anchored_placements(after, new, &anchored);
        let Some(layer) = after.layer_mut(&layer_id) else {
            continue;
        };
        let mut changed = false;
        let mut structural = false;
        for component in layer.components_iter_mut() {
            let id = component.id();
            let alignment = if freed.contains(&id) {
                ComponentAlignment::Free
            } else if anchored.contains(&id) {
                ComponentAlignment::Anchored
            } else {
                component.alignment()
            };
            if component.alignment() != alignment {
                component.set_alignment(alignment);
                structural = true;
            }
            if let Some(transform) = placements.get(&id) {
                if component.transform() != transform {
                    component.set_transform(*transform);
                    changed = true;
                }
            }
        }
        if changed || structural {
            changed_layers.push((layer_id, structural));
        }
    }
    changed_layers
}

/// Components of `layer` that sit exactly on their anchors in `font`.
fn sitting_on_anchors(font: &Font, layer: &GlyphLayer) -> HashSet<ComponentId> {
    let mut attached = HashSet::new();
    let mut placed = Vec::new();
    for component in layer.components_iter() {
        let Some(base) = base_layer(font, &component.base_glyph_id(), layer) else {
            continue;
        };
        let transform = component.transform();
        if is_translation(transform) {
            if let Some((dx, dy)) = anchor_aligned_offset(&placed, base) {
                if (transform.translate_x - dx).abs() < EPSILON
                    && (transform.translate_y - dy).abs() < EPSILON
                {
                    attached.insert(component.id());
                }
            }
        }
        placed.push((component.matrix(), base));
    }
    attached
}

/// Where each anchored component of `layer` goes, placed in order from `font`'s anchors.
fn anchored_placements(
    font: &Font,
    layer: &GlyphLayer,
    anchored: &HashSet<ComponentId>,
) -> HashMap<ComponentId, DecomposedTransform> {
    let mut placements = HashMap::new();
    let mut placed = Vec::new();
    for component in layer.components_iter() {
        let Some(base) = base_layer(font, &component.base_glyph_id(), layer) else {
            continue;
        };
        let mut transform = *component.transform();
        if anchored.contains(&component.id()) {
            if let Some((dx, dy)) = anchor_aligned_offset(&placed, base) {
                transform.translate_x = dx;
                transform.translate_y = dy;
                placements.insert(component.id(), transform);
            }
        }
        // Later components stack on this one where it now sits.
        placed.push((transform.to_matrix(), base));
    }
    placements
}

/// The component glyph's layer at `layer`'s source.
fn base_layer<'font>(
    font: &'font Font,
    glyph_id: &GlyphId,
    layer: &GlyphLayer,
) -> Option<&'font GlyphLayer> {
    font.glyph(glyph_id)?.layer_for_source(layer.source_id())
}

/// Whether the placement only moves the component, as anchor alignment places it.
fn is_translation(transform: &DecomposedTransform) -> bool {
    transform.rotation == 0.0
        && transform.scale_x == 1.0
        && transform.scale_y == 1.0
        && transform.skew_x == 0.0
        && transform.skew_y == 0.0
}
