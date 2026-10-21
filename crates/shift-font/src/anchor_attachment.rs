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

use std::collections::{BTreeSet, HashSet};

use kurbo::{Point, Vec2};

use crate::ir::{
    Anchor, Component, ComponentAlignment, DecomposedTransform, Font, GlyphLayer, LayerId,
    Transform,
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
    let touched: BTreeSet<&LayerId> = touched.into_iter().collect();
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
        let inputs: Vec<_> = new
            .components_iter()
            .map(|component| {
                let accepted = old.component(&component.id());
                FollowingComponent {
                    alignment: component.alignment(),
                    transform: *component.transform(),
                    accepted_transform: accepted.map(|accepted| *accepted.transform()),
                    anchors: base_anchors(after, component, new),
                    accepted_anchors: base_anchors(before, component, new),
                }
            })
            .collect();
        let following = follow_anchors(&inputs);

        let Some(layer) = after.layer_mut(&layer_id) else {
            continue;
        };
        let mut changed = false;
        let mut structural = false;
        for (component, follow) in layer.components_iter_mut().zip(following) {
            if component.alignment() != follow.alignment {
                component.set_alignment(follow.alignment);
                structural = true;
            }
            if *component.transform() != follow.transform {
                component.set_transform(follow.transform);
                changed = true;
            }
        }
        if changed || structural {
            changed_layers.push((layer_id, structural));
        }
    }
    changed_layers
}

/// The component glyph's own anchors at `layer`'s source; none when it has no layer there.
fn base_anchors<'font>(
    font: &'font Font,
    component: &Component,
    layer: &GlyphLayer,
) -> &'font [Anchor] {
    font.glyph(&component.base_glyph_id())
        .and_then(|glyph| glyph.layer_for_source(&layer.source_id()))
        .map_or(&[], GlyphLayer::anchors)
}

/// An anchor as alignment reads it: a name and a position in its glyph.
pub trait AnchorLike {
    fn anchor_name(&self) -> Option<&str>;
    fn position(&self) -> Point;
}

impl AnchorLike for Anchor {
    fn anchor_name(&self) -> Option<&str> {
        self.name()
    }

    fn position(&self) -> Point {
        Self::position(self)
    }
}

/// Returns the translation that puts a component's `_name` anchor on the
/// matching `name` anchor of the most recently placed earlier component.
///
/// `placed` lists the earlier components with their absolute transforms and
/// their glyphs' own anchors. The component's first `_name` anchor that finds a
/// match wins, and within one placed glyph the last anchor with the name does.
/// Returns `None` when no anchor pair matches.
pub fn aligned_offset<A: AnchorLike>(placed: &[(Transform, &[A])], anchors: &[A]) -> Option<Vec2> {
    for anchor in anchors {
        let Some(target_name) = anchor.anchor_name().and_then(|name| name.strip_prefix('_')) else {
            continue;
        };
        if target_name.is_empty() {
            continue;
        }

        let target = placed.iter().rev().find_map(|(transform, anchors)| {
            anchors
                .iter()
                .rev()
                .find(|placed| placed.anchor_name() == Some(target_name))
                .map(|placed| transform.transform_point(placed.position()))
        });
        if let Some(target) = target {
            return Some(target - anchor.position());
        }
    }

    None
}

/// One component of a composite, as it is now and as the workspace last accepted it.
#[derive(Clone, Copy, Debug)]
pub struct FollowingComponent<'a, A> {
    pub alignment: ComponentAlignment,
    pub transform: DecomposedTransform,
    /// `None` for a component the edit added.
    pub accepted_transform: Option<DecomposedTransform>,
    /// The component glyph's own anchors now, and as last accepted.
    pub anchors: &'a [A],
    pub accepted_anchors: &'a [A],
}

/// Where a component goes after an edit, and whether it is anchored.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Following {
    pub transform: DecomposedTransform,
    pub alignment: ComponentAlignment,
}

/// Returns where each component of a composite goes after an edit.
///
/// The one rule for anchored components, applied by the workspace when an
/// edit lands and by the editor while one is in progress. A free component,
/// or one the edit moved by hand, stays where it was put and is then free. An
/// anchored component, or an unset one whose accepted placement sat exactly on
/// its anchors, is placed on the current anchors, in component order, so marks
/// stacked on a moving mark follow it too; an unset one is then anchored.
pub fn follow_anchors<A: AnchorLike>(components: &[FollowingComponent<'_, A>]) -> Vec<Following> {
    let mut placed_accepted: Vec<(Transform, &[A])> = Vec::with_capacity(components.len());
    let mut placed_now: Vec<(Transform, &[A])> = Vec::with_capacity(components.len());
    let mut following = Vec::with_capacity(components.len());
    for component in components {
        let accepted = component.accepted_transform.unwrap_or(component.transform);
        let moved = accepted != component.transform;
        let alignment = match component.alignment {
            ComponentAlignment::Free => ComponentAlignment::Free,
            _ if moved => ComponentAlignment::Free,
            ComponentAlignment::Anchored => ComponentAlignment::Anchored,
            ComponentAlignment::Unset
                if sits_on_anchors(&accepted, &placed_accepted, component.accepted_anchors) =>
            {
                ComponentAlignment::Anchored
            }
            ComponentAlignment::Unset => ComponentAlignment::Unset,
        };

        let mut transform = component.transform;
        if alignment == ComponentAlignment::Anchored
            && let Some(offset) = aligned_offset(&placed_now, component.anchors)
        {
            transform.set_offset(offset);
        }
        following.push(Following {
            transform,
            alignment,
        });
        placed_accepted.push((accepted.to_matrix(), component.accepted_anchors));
        // Later components stack on this one where it now sits.
        placed_now.push((transform.to_matrix(), component.anchors));
    }
    following
}

fn sits_on_anchors<A: AnchorLike>(
    transform: &DecomposedTransform,
    placed: &[(Transform, &[A])],
    anchors: &[A],
) -> bool {
    transform.is_translation()
        && aligned_offset(placed, anchors).is_some_and(|offset| {
            let gap = transform.offset() - offset;
            gap.x.abs() < EPSILON && gap.y.abs() < EPSILON
        })
}
