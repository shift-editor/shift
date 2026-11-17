//! Metrics keys in glyph and layer payloads: lowering them to the intents the
//! app uses, and checking after the edit that every key written can be evaluated.

use std::collections::BTreeSet;

use miette::{Result, bail};
use shift_font::linked_metrics::MetricsKeyEvaluator;
use shift_font::{
    Font, FontIntent, GlyphId, LayerId, MetricsKeySide, SetGlyphMetricsKey, SetLayerMetricsKey,
    Source,
};

use super::input::MetricsKeysInput;

/// One glyph side whose key a payload wrote, checked once the edit is applied.
pub(super) type WrittenKey = (GlyphId, MetricsKeySide);

impl MetricsKeysInput {
    /// Each side the payload names, with its text; blank text clears the key.
    fn sides(&self) -> impl Iterator<Item = (MetricsKeySide, &str)> {
        self.0.iter().map(|(side, text)| (*side, text.as_str()))
    }

    /// Intents setting these keys on the glyph, for every source.
    pub(super) fn glyph_intents(
        &self,
        glyph_id: GlyphId,
        written: &mut BTreeSet<WrittenKey>,
    ) -> Vec<FontIntent> {
        self.sides()
            .map(|(side, text)| {
                written.insert((glyph_id, side));
                SetGlyphMetricsKey {
                    glyph_id,
                    side,
                    key: Some(text.to_string()),
                }
                .into()
            })
            .collect()
    }

    /// Intents setting these keys on one layer, for its source only.
    pub(super) fn layer_intents(
        &self,
        glyph_id: GlyphId,
        layer_id: LayerId,
        written: &mut BTreeSet<WrittenKey>,
    ) -> Vec<FontIntent> {
        self.sides()
            .map(|(side, text)| {
                written.insert((glyph_id, side));
                SetLayerMetricsKey {
                    layer_id,
                    side,
                    key: Some(text.to_string()),
                }
                .into()
            })
            .collect()
    }
}

/// Fails, naming each one, when a key in `written` cannot be evaluated in some
/// source of `font`: unreadable text, a missing glyph, keys that depend on each
/// other, or a glyph with nothing to measure. The app keeps such a side where
/// it is; a script asking for a key wants to know it did nothing.
///
/// # Errors
///
/// Returns one error listing every key that cannot be evaluated.
pub(super) fn check_written_keys(font: &Font, written: &BTreeSet<WrittenKey>) -> Result<()> {
    if written.is_empty() {
        return Ok(());
    }
    let mut problems = Vec::new();
    for source in font.sources() {
        let order = font.linked_metrics_order(source.id());
        for (linked, error) in &order.problems {
            if written.contains(&(linked.glyph_id, linked.side)) {
                problems.push(describe(font, linked.glyph_id, linked.side, source, error));
            }
        }
        let Ok(mut evaluator) = MetricsKeyEvaluator::new(font, source.id()) else {
            continue;
        };
        for ordered in &order.keys {
            let (glyph_id, side) = (ordered.linked.glyph_id, ordered.linked.side);
            if !written.contains(&(glyph_id, side)) {
                continue;
            }
            if let Err(error) = evaluator.evaluate(glyph_id, side, &ordered.key) {
                problems.push(describe(font, glyph_id, side, source, &error));
            }
        }
    }
    if problems.is_empty() {
        return Ok(());
    }
    bail!(
        "metrics keys cannot be evaluated:\n  {}",
        problems.join("\n  ")
    )
}

fn describe(
    font: &Font,
    glyph_id: GlyphId,
    side: MetricsKeySide,
    source: &Source,
    error: &dyn std::fmt::Display,
) -> String {
    let glyph = font.glyph(glyph_id);
    let name = glyph.map_or_else(|| glyph_id.to_string(), |glyph| glyph.name().to_string());
    let key = glyph
        .and_then(|glyph| glyph.metrics_key(source.id(), side))
        .map(|key| format!(" `{key}`"))
        .unwrap_or_default();
    format!(
        "{name} {}{key} in {}: {error}",
        side_name(side),
        source.name()
    )
}

/// The payload field a side is written under.
pub(super) fn side_name(side: MetricsKeySide) -> &'static str {
    match side {
        MetricsKeySide::Left => "left",
        MetricsKeySide::Right => "right",
        MetricsKeySide::Width => "width",
    }
}
