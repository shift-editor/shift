//! Re-applying keys after an edit, so linked glyphs follow what they read.

use std::collections::{BTreeMap, BTreeSet, HashSet};

use super::MetricsKeyEvaluator;
use super::order::OrderedKey;
use super::syntax::candidate_names;
use crate::{CoreResult, Font, GlyphId, LayerId, MetricsKeySide, Sidebearing, SourceId};

/// A difference below this many units is already what the key gives.
const SETTLED: f64 = 1e-6;

/// The glyphs an edit changed, by the source they changed in.
pub type ChangedGlyphs = BTreeMap<SourceId, BTreeSet<GlyphId>>;

impl Font {
    /// Applies, in each source of `changed`, every key on a changed glyph or
    /// reading one, in dependency order, and returns the layers it moved.
    ///
    /// A glyph a key moves counts as changed for the keys after it, so
    /// chains follow through. A key that cannot be evaluated, such as one in
    /// a cycle or naming a missing glyph, is left as it is: the side keeps
    /// its value, and [`Font::linked_metrics_order`] reports why.
    ///
    /// # Errors
    ///
    /// Returns the font's error when a layer the order names is missing.
    pub fn follow_linked_metrics(&mut self, changed: ChangedGlyphs) -> CoreResult<Vec<LayerId>> {
        let mut moved = Vec::new();
        if self.metrics_keyed_glyph_ids().next().is_none() {
            return Ok(moved);
        }

        for (source_id, mut changed_here) in changed {
            let affected = self.keyed_glyphs_affected_by(source_id, &changed_here);
            if affected.is_empty() {
                continue;
            }
            for ordered in self.linked_metrics_order_of(source_id, affected).keys {
                if !is_affected(&ordered, &changed_here) {
                    continue;
                }
                let glyph_id = ordered.linked.glyph_id;
                let Some(layer_id) = self
                    .glyph(glyph_id)
                    .and_then(|glyph| glyph.layer_for_source(source_id))
                    .map(crate::GlyphLayer::id)
                else {
                    continue;
                };
                let Some(delta) = self.correction(source_id, &ordered) else {
                    continue;
                };
                self.move_side(layer_id, ordered.linked.side, delta)?;
                changed_here.insert(glyph_id);
                moved.push(layer_id);
            }
        }
        Ok(moved)
    }

    /// The keyed glyphs in `source_id` that `changed` may move: those that
    /// changed, those whose keys may name a glyph that changed or that draws
    /// one as a component, and so on through the glyphs those keys move.
    ///
    /// Names are read off the keys' words without parsing, which may take
    /// in a key that names nothing that changed; ordering then skips it.
    fn keyed_glyphs_affected_by(
        &self,
        source_id: SourceId,
        changed: &BTreeSet<GlyphId>,
    ) -> BTreeSet<GlyphId> {
        let keyed: Vec<(GlyphId, Vec<&str>)> = self
            .metrics_keyed_glyph_ids()
            .filter_map(|glyph_id| {
                let glyph = self.glyph(glyph_id)?;
                let names: Vec<&str> = MetricsKeySide::ALL
                    .into_iter()
                    .filter_map(|side| glyph.metrics_key(source_id, side))
                    .flat_map(|key| candidate_names(key.as_str()))
                    .collect();
                Some((glyph_id, names))
            })
            .collect();

        let mut moved = self.with_composites(changed.iter().copied());
        let mut affected = BTreeSet::new();
        loop {
            let moved_names: HashSet<&str> = moved
                .iter()
                .filter_map(|glyph_id| self.glyph(*glyph_id))
                .map(crate::Glyph::name)
                .collect();
            let newly: Vec<GlyphId> = keyed
                .iter()
                .filter(|(glyph_id, names)| {
                    !affected.contains(glyph_id)
                        && (moved.contains(glyph_id)
                            || names.iter().any(|name| moved_names.contains(name)))
                })
                .map(|(glyph_id, _)| *glyph_id)
                .collect();
            if newly.is_empty() {
                return affected;
            }
            affected.extend(newly.iter().copied());
            moved.extend(self.with_composites(newly));
        }
    }

    /// `glyph_ids` and every glyph that draws one of them as a component,
    /// nested ones included.
    fn with_composites(&self, glyph_ids: impl IntoIterator<Item = GlyphId>) -> BTreeSet<GlyphId> {
        let mut found: BTreeSet<GlyphId> = BTreeSet::new();
        let mut pending: Vec<GlyphId> = glyph_ids.into_iter().collect();
        while let Some(glyph_id) = pending.pop() {
            if !found.insert(glyph_id) {
                continue;
            }
            pending.extend(
                self.layers_using_component_base(&glyph_id)
                    .filter_map(|layer_id| self.glyph_id_by_layer(*layer_id)),
            );
        }
        found
    }

    /// How far the key's side must move to equal the key, or `None` when it
    /// already does or the key cannot be evaluated.
    fn correction(&self, source_id: SourceId, ordered: &OrderedKey) -> Option<f64> {
        let mut evaluator = MetricsKeyEvaluator::new(self, source_id).ok()?;
        let glyph_id = ordered.linked.glyph_id;
        let side = ordered.linked.side;
        let target = evaluator.evaluate(glyph_id, side, &ordered.key).ok()?;
        let current = evaluator.current(glyph_id, side).ok()?;
        let delta = target - current;
        (delta.abs() > SETTLED).then_some(delta)
    }

    /// Moves `side` of the layer by `delta`: a left sidebearing moves the
    /// outline and keeps the right one, a right sidebearing moves the
    /// advance, and a width sets the advance.
    fn move_side(&mut self, layer_id: LayerId, side: MetricsKeySide, delta: f64) -> CoreResult<()> {
        let layer = self.require_layer_mut(layer_id)?;
        match side {
            MetricsKeySide::Left => layer.shift_sidebearing(Sidebearing::Left, delta),
            MetricsKeySide::Right => layer.shift_sidebearing(Sidebearing::Right, delta),
            MetricsKeySide::Width => layer.set_x_advance(layer.width() + delta),
        }
        Ok(())
    }
}

fn is_affected(ordered: &OrderedKey, changed: &BTreeSet<GlyphId>) -> bool {
    changed.contains(&ordered.linked.glyph_id) || !ordered.reads.is_disjoint(changed)
}
