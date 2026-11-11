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
use super::evaluate::measured_metric;
use super::measure::Metric;
use super::syntax::{Expr, KeyBody, Measure, ParsedMetricsKey, parse};
use crate::{Font, GlyphId, MetricsKeySide, SourceId};

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
    pub keys: Vec<(LinkedSide, ParsedMetricsKey)>,
    /// Keys that cannot be evaluated, and why.
    pub problems: Vec<(LinkedSide, MetricsKeyError)>,
}

/// Orders the keys of every glyph drawn in `source_id`.
///
/// A layer's key for a side wins over its glyph's.
pub fn linked_metrics_order(font: &Font, source_id: SourceId) -> LinkedMetricsOrder {
    let has_glyph = |name: &str| font.glyph_id_by_name(name).is_some();
    let mut order = LinkedMetricsOrder::default();
    let mut keyed: BTreeMap<LinkedSide, ParsedMetricsKey> = BTreeMap::new();

    for glyph in font.glyphs() {
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
    }

    let mut waiting_on: BTreeMap<LinkedSide, BTreeSet<LinkedSide>> = BTreeMap::new();
    for (linked, key) in &keyed {
        match reads(font, source_id, *linked, key) {
            Ok(reads) => {
                let prerequisites = reads
                    .into_iter()
                    .filter(|read| keyed.contains_key(read))
                    .collect();
                waiting_on.insert(*linked, prerequisites);
            }
            Err(error) => order.problems.push((*linked, error)),
        }
    }

    let mut done: HashSet<LinkedSide> = HashSet::new();
    loop {
        let ready: Vec<LinkedSide> = waiting_on
            .iter()
            .filter(|(_, prerequisites)| prerequisites.iter().all(|read| done.contains(read)))
            .map(|(linked, _)| *linked)
            .collect();
        if ready.is_empty() {
            break;
        }
        for linked in ready {
            waiting_on.remove(&linked);
            done.insert(linked);
            if let Some(key) = keyed.remove(&linked) {
                order.keys.push((linked, key));
            }
        }
    }

    // What is left waits on a cycle, or on a key that waits on one.
    let stuck: Vec<String> = waiting_on
        .keys()
        .map(|linked| describe(font, *linked))
        .collect();
    for linked in waiting_on.into_keys() {
        order
            .problems
            .push((linked, MetricsKeyError::Cycle(stuck.clone())));
    }
    order
}

fn describe(font: &Font, linked: LinkedSide) -> String {
    let name = font.glyph(linked.glyph_id).map_or_else(
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

/// Every keyed side whose result `key` on `linked` reads.
fn reads(
    font: &Font,
    source_id: SourceId,
    linked: LinkedSide,
    key: &ParsedMetricsKey,
) -> Result<BTreeSet<LinkedSide>, MetricsKeyError> {
    let KeyBody::Expr(expr) = &key.body else {
        return Err(MetricsKeyError::AutoOffset);
    };
    let mut measures = Vec::new();
    collect_measures(expr, &mut measures);

    let mut reads = BTreeSet::new();
    for measure in measures {
        let target = measure.glyph_id(font, linked.glyph_id)?;
        let metric = measured_metric(linked.side, measure.side)?;
        reads.extend(sides_moving(target, metric));
        for base in component_bases(font, source_id, target) {
            reads.insert(LinkedSide {
                glyph_id: base,
                side: MetricsKeySide::Left,
            });
        }
    }
    Ok(reads)
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

fn collect_measures<'a>(expr: &'a Expr, measures: &mut Vec<&'a Measure>) {
    match expr {
        Expr::Number(_) => {}
        Expr::Measure(measure) => measures.push(measure),
        Expr::Negate(inner) | Expr::Round(inner) => collect_measures(inner, measures),
        Expr::Binary { left, right, .. } => {
            collect_measures(left, measures);
            collect_measures(right, measures);
        }
        Expr::Call { args, .. } => {
            for arg in args {
                collect_measures(arg, measures);
            }
        }
    }
}

/// Every glyph `glyph_id` draws as a component in `source_id`, nested ones
/// included.
fn component_bases(font: &Font, source_id: SourceId, glyph_id: GlyphId) -> BTreeSet<GlyphId> {
    let mut bases = BTreeSet::new();
    let mut pending = vec![glyph_id];
    while let Some(next) = pending.pop() {
        let Some(layer) = font
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
