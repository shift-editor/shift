//! The order a source's keys must be evaluated in, and the keys that cannot
//! be: unparsable ones and ones that depend on each other.
//!
//! A key reads other metrics, and applying a key changes metrics, so a key
//! is evaluated after every key whose result it reads:
//!
//! - a left sidebearing moves when its own key moves the outline;
//! - a right sidebearing changes with a right or width key;
//! - a width changes with any of the glyph's keys, since setting the left
//!   sidebearing keeps the right one and so changes the advance;
//! - every measurement of a glyph moves when one of its component bases has
//!   a left-sidebearing key, since that moves the base's outline.

use std::collections::{BTreeMap, BTreeSet, HashSet};

use super::MetricsKeyError;
use super::measure::Metric;
use super::syntax::{Expr, KeyBody, Measure, ParsedMetricsKey, candidate_names, parse};
use crate::{Font, Glyph, GlyphId, MetricsKey, MetricsKeySide, SourceId};

/// One side of one glyph that has a key in a source.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct LinkedSide {
    pub glyph_id: GlyphId,
    pub side: MetricsKeySide,
}

/// A source's keys, ready to evaluate.
#[derive(Debug, Default)]
pub struct LinkedMetricsOrder {
    /// Keys in an order where each comes after every key it reads.
    pub keys: Vec<OrderedKey>,
    /// Keys that cannot be evaluated, and why.
    pub problems: Vec<(LinkedSide, MetricsKeyError)>,
}

/// One key in [`LinkedMetricsOrder::keys`].
#[derive(Debug)]
pub struct OrderedKey {
    pub linked: LinkedSide,
    pub key: ParsedMetricsKey,
    /// Every glyph whose outline or advance the key's value depends on: the
    /// glyphs it measures and the glyphs their components draw.
    pub reads: BTreeSet<GlyphId>,
}

/// A key not yet ordered, with the keys it must come after.
struct Waiting {
    key: ParsedMetricsKey,
    prerequisites: BTreeSet<LinkedSide>,
    reads: BTreeSet<GlyphId>,
}

/// What one key reads.
struct KeyReads {
    /// The keyed-or-not sides whose keys change what it measures.
    sides: BTreeSet<LinkedSide>,
    glyphs: BTreeSet<GlyphId>,
}

impl Font {
    /// Orders the keys of every glyph drawn in `source_id`.
    ///
    /// A layer's key for a side wins over its glyph's.
    pub fn linked_metrics_order(&self, source_id: SourceId) -> LinkedMetricsOrder {
        self.linked_metrics_order_of(source_id, self.metrics_keyed_glyph_ids())
    }

    /// Orders the keys of `glyph_ids` in `source_id`, as if they were the
    /// font's only keys: a key they read that is not among them is read as it
    /// stands.
    pub(super) fn linked_metrics_order_of(
        &self,
        source_id: SourceId,
        glyph_ids: impl IntoIterator<Item = GlyphId>,
    ) -> LinkedMetricsOrder {
        let has_glyph = |name: &str| self.glyph_id_by_name(name).is_some();
        let mut order = LinkedMetricsOrder::default();
        let mut keyed: BTreeMap<LinkedSide, ParsedMetricsKey> = BTreeMap::new();

        for glyph in glyph_ids.into_iter().filter_map(|id| self.glyph(id)) {
            for side in MetricsKeySide::ALL {
                let Some(key) = glyph.metrics_key(source_id, side) else {
                    continue;
                };
                let linked = LinkedSide {
                    glyph_id: glyph.id(),
                    side,
                };
                match parse(key.as_str(), &has_glyph) {
                    Ok(parsed) => {
                        keyed.insert(linked, parsed);
                    }
                    Err(error) => order.problems.push((linked, error)),
                }
            }
            report_right_and_width(&mut keyed, &mut order.problems, glyph.id());
        }

        let keyed_sides: BTreeSet<LinkedSide> = keyed.keys().copied().collect();
        let mut waiting: BTreeMap<LinkedSide, Waiting> = BTreeMap::new();
        for (linked, key) in keyed {
            match self.key_reads(source_id, linked, &key) {
                Ok(reads) => {
                    let prerequisites = reads
                        .sides
                        .into_iter()
                        .filter(|read| keyed_sides.contains(read))
                        .collect();
                    waiting.insert(
                        linked,
                        Waiting {
                            key,
                            prerequisites,
                            reads: reads.glyphs,
                        },
                    );
                }
                Err(error) => order.problems.push((linked, error)),
            }
        }

        let mut done: HashSet<LinkedSide> = HashSet::new();
        loop {
            let ready: Vec<LinkedSide> = waiting
                .iter()
                .filter(|(_, key)| key.prerequisites.iter().all(|read| done.contains(read)))
                .map(|(linked, _)| *linked)
                .collect();
            if ready.is_empty() {
                break;
            }
            for linked in ready {
                done.insert(linked);
                if let Some(Waiting { key, reads, .. }) = waiting.remove(&linked) {
                    order.keys.push(OrderedKey { linked, key, reads });
                }
            }
        }

        // What is left waits on a cycle, or on a key that waits on one.
        let stuck: Vec<String> = waiting
            .keys()
            .map(|linked| self.describe(*linked))
            .collect();
        for linked in waiting.into_keys() {
            order
                .problems
                .push((linked, MetricsKeyError::Cycle(stuck.clone())));
        }
        order
    }

    /// Every glyph with a key and every glyph a key may name, in any source:
    /// what re-applying keys after an edit may read or move, before
    /// components. Names are read off the keys' words without parsing, so a
    /// glyph a key only seems to name is included too.
    pub fn linked_glyph_ids(&self) -> BTreeSet<GlyphId> {
        let mut linked = BTreeSet::new();
        for glyph in self
            .metrics_keyed_glyph_ids()
            .filter_map(|id| self.glyph(id))
        {
            linked.insert(glyph.id());
            for key in glyph.all_metrics_keys() {
                linked.extend(
                    candidate_names(key.as_str()).filter_map(|name| self.glyph_id_by_name(name)),
                );
            }
        }
        linked
    }

    fn describe(&self, linked: LinkedSide) -> String {
        let name = self.glyph(linked.glyph_id).map_or_else(
            || linked.glyph_id.to_string(),
            |glyph| glyph.name().to_owned(),
        );
        let side = match linked.side {
            MetricsKeySide::Left => "left",
            MetricsKeySide::Right => "right",
            MetricsKeySide::Width => "width",
        };
        format!("{name} {side}")
    }

    /// The sides whose keys change what `key` on `linked` measures, and the
    /// glyphs it reads.
    fn key_reads(
        &self,
        source_id: SourceId,
        linked: LinkedSide,
        key: &ParsedMetricsKey,
    ) -> Result<KeyReads, MetricsKeyError> {
        let KeyBody::Expr(expr) = &key.body else {
            return Err(MetricsKeyError::AutoOffset);
        };

        let mut reads = KeyReads {
            sides: BTreeSet::new(),
            glyphs: BTreeSet::new(),
        };
        for measure in expr.measures() {
            let target = measure.glyph_id(self, linked.glyph_id)?;
            let metric = linked.side.metric_read(measure.side)?;
            reads.sides.extend(sides_moving(target, metric));
            reads.glyphs.insert(target);
            for base in self.component_bases_in(source_id, target) {
                reads.sides.insert(LinkedSide {
                    glyph_id: base,
                    side: MetricsKeySide::Left,
                });
                reads.glyphs.insert(base);
            }
        }
        Ok(reads)
    }

    /// Every glyph `glyph_id` draws as a component in `source_id`, nested
    /// ones included.
    pub(super) fn component_bases_in(
        &self,
        source_id: SourceId,
        glyph_id: GlyphId,
    ) -> BTreeSet<GlyphId> {
        let mut bases = BTreeSet::new();
        let mut pending = vec![glyph_id];
        while let Some(next) = pending.pop() {
            let Some(layer) = self
                .glyph(next)
                .and_then(|glyph| glyph.layer_for_source(source_id))
            else {
                continue;
            };
            for component in layer.components_iter() {
                if bases.insert(component.base_glyph_id()) {
                    pending.push(component.base_glyph_id());
                }
            }
        }
        bases
    }
}

impl Glyph {
    /// The glyph's own keys and every layer's.
    fn all_metrics_keys(&self) -> impl Iterator<Item = &MetricsKey> {
        let layer_keys = self.layers().values().map(|layer| layer.metrics_keys());
        std::iter::once(self.metrics_keys())
            .chain(layer_keys)
            .flat_map(|keys| keys.iter().map(|(_, key)| key))
    }
}

/// Takes a glyph's right and width keys out of `keyed` when it has both:
/// each sets where the advance falls, so neither can be applied.
fn report_right_and_width(
    keyed: &mut BTreeMap<LinkedSide, ParsedMetricsKey>,
    problems: &mut Vec<(LinkedSide, MetricsKeyError)>,
    glyph_id: GlyphId,
) {
    let right = LinkedSide {
        glyph_id,
        side: MetricsKeySide::Right,
    };
    let width = LinkedSide {
        glyph_id,
        side: MetricsKeySide::Width,
    };
    if !(keyed.contains_key(&right) && keyed.contains_key(&width)) {
        return;
    }
    for linked in [right, width] {
        keyed.remove(&linked);
        problems.push((linked, MetricsKeyError::RightAndWidthBothLinked));
    }
}

/// The sides whose keys change `metric` of `glyph_id`.
fn sides_moving(glyph_id: GlyphId, metric: Metric) -> Vec<LinkedSide> {
    let sides: &[MetricsKeySide] = match metric {
        Metric::LeftSidebearing => &[MetricsKeySide::Left],
        Metric::RightSidebearing => &[MetricsKeySide::Right, MetricsKeySide::Width],
        Metric::Width => &MetricsKeySide::ALL,
    };
    sides
        .iter()
        .map(|&side| LinkedSide { glyph_id, side })
        .collect()
}

impl Expr {
    /// Every measurement in the expression, left to right.
    pub fn measures(&self) -> Vec<&Measure> {
        let mut measures = Vec::new();
        let mut pending = vec![self];
        while let Some(expr) = pending.pop() {
            match expr {
                Self::Number(_) => {}
                Self::Measure(measure) => measures.push(measure),
                Self::Negate(inner) | Self::Round(inner) => pending.push(inner),
                Self::Binary { left, right, .. } => pending.extend([&**right, &**left]),
                Self::Call { args, .. } => pending.extend(args.iter().rev()),
            }
        }
        measures
    }
}
