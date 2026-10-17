//! Keeps components that sit on their anchors attached when the anchors move.
//!
//! A component is attached when its placement is exactly the translation that
//! puts one of its `_name` anchors on the matching `name` anchor of an earlier
//! component in the same layer, as adding a component places it. When an edit
//! moves, adds, removes, or renames anchors, every component that was attached
//! before the edit is placed again from the new anchors, in component order,
//! so a mark stacked on a moved mark follows it too. A component the edit
//! itself moved was placed by hand and stays where it was put; once off its
//! anchors, a component no longer follows them.

use std::collections::{HashMap, HashSet};

use crate::composite::anchor_aligned_offset;
use crate::ir::{ComponentId, DecomposedTransform, Font, GlyphId, GlyphLayer, LayerId};

/// Placements that differ by less than this are the same.
const EPSILON: f64 = 1e-6;

/// Places attached components again after an edit and returns the layers it changed.
///
/// `touched` lists the layers the edit itself changed. Candidates are those
/// layers and every layer, at any source, whose components reference a glyph
/// whose anchors changed; their component glyphs must be loaded in both fonts.
pub(crate) fn realign_attached_components<'a>(
    before: &Font,
    after: &mut Font,
    touched: impl IntoIterator<Item = &'a LayerId>,
) -> Vec<LayerId> {
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

    let mut realigned = Vec::new();
    for layer_id in candidates {
        let (Some(old), Some(new)) = (before.layer(&layer_id), after.layer(&layer_id)) else {
            continue;
        };
        let attached = attached_components(before, old)
            .into_iter()
            // A component the edit moved was placed by hand.
            .filter(|id| {
                old.component(id).map(|c| c.transform()) == new.component(id).map(|c| c.transform())
            })
            .collect::<HashSet<_>>();
        if attached.is_empty() {
            continue;
        }

        let placements = attached_placements(after, new, &attached);
        let Some(layer) = after.layer_mut(&layer_id) else {
            continue;
        };
        let mut changed = false;
        for component in layer.components_iter_mut() {
            let Some(transform) = placements.get(&component.id()) else {
                continue;
            };
            if component.transform() != transform {
                component.set_transform(*transform);
                changed = true;
            }
        }
        if changed {
            realigned.push(layer_id);
        }
    }
    realigned
}

/// Components of `layer` that sit exactly on their anchors in `font`.
fn attached_components(font: &Font, layer: &GlyphLayer) -> HashSet<ComponentId> {
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

/// Where each attached component of `layer` goes, placed in order from `font`'s anchors.
fn attached_placements(
    font: &Font,
    layer: &GlyphLayer,
    attached: &HashSet<ComponentId>,
) -> HashMap<ComponentId, DecomposedTransform> {
    let mut placements = HashMap::new();
    let mut placed = Vec::new();
    for component in layer.components_iter() {
        let Some(base) = base_layer(font, &component.base_glyph_id(), layer) else {
            continue;
        };
        let mut transform = *component.transform();
        if attached.contains(&component.id()) {
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
