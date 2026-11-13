//! What the editor shows of a glyph's links: each linked side's key, where
//! it is set, and why it cannot be applied when it cannot.

use std::collections::BTreeSet;

use super::parse;
use super::syntax::candidate_names;
use crate::{Font, GlyphId, MetricsKeySide, SourceId};

/// Where a key that applies in a source is set.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub enum KeyLevel {
    /// On the glyph, for every source its layers do not override.
    Glyph,
    /// On the layer, for its source only.
    Layer,
}

/// One linked side of a glyph in a source.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct SideLink {
    pub side: MetricsKeySide,
    /// The key as written.
    pub key: String,
    pub level: KeyLevel,
    /// Why the key cannot be applied, so the side keeps its value; `None`
    /// when the side follows the key.
    pub problem: Option<String>,
}

impl Font {
    /// The linked sides of `glyph_id` in `source_id`, left, right, then
    /// width. Empty for a glyph with no keys there or no layer there.
    pub fn linked_sides(&self, glyph_id: GlyphId, source_id: SourceId) -> Vec<SideLink> {
        let Some(glyph) = self.glyph(glyph_id) else {
            return Vec::new();
        };
        let Some(layer) = glyph.layer_for_source(source_id) else {
            return Vec::new();
        };
        let keyed: Vec<(MetricsKeySide, String, KeyLevel)> = MetricsKeySide::ALL
            .into_iter()
            .filter_map(|side| {
                if let Some(key) = layer.metrics_keys().get(side) {
                    return Some((side, key.to_string(), KeyLevel::Layer));
                }
                let key = glyph.metrics_keys().get(side)?;
                Some((side, key.to_string(), KeyLevel::Glyph))
            })
            .collect();
        if keyed.is_empty() {
            return Vec::new();
        }

        let order = self.linked_metrics_order_of(source_id, self.keyed_reach(source_id, glyph_id));
        keyed
            .into_iter()
            .map(|(side, key, level)| {
                let problem = order
                    .problems
                    .iter()
                    .find(|(linked, _)| linked.glyph_id == glyph_id && linked.side == side)
                    .map(|(_, error)| error.to_string());
                SideLink {
                    side,
                    key,
                    level,
                    problem,
                }
            })
            .collect()
    }

    /// `glyph_id` and every keyed glyph its keys may reach in `source_id`:
    /// the glyphs they name, the glyphs those draw as components, and so on
    /// through those glyphs' keys. Ordering only these finds every problem
    /// the glyph's keys have, cycles included, without ordering the font.
    fn keyed_reach(&self, source_id: SourceId, glyph_id: GlyphId) -> BTreeSet<GlyphId> {
        let mut reach = BTreeSet::new();
        let mut pending = vec![glyph_id];
        while let Some(next) = pending.pop() {
            if !reach.insert(next) {
                continue;
            }
            let Some(glyph) = self.glyph(next) else {
                continue;
            };
            let named = MetricsKeySide::ALL
                .into_iter()
                .filter_map(|side| glyph.metrics_key(source_id, side))
                .flat_map(|key| candidate_names(key.as_str()))
                .filter_map(|name| self.glyph_id_by_name(name));
            for named in named {
                pending.push(named);
                pending.extend(self.component_bases_in(source_id, named));
            }
        }
        reach
    }

    /// Why `text` is not a key this font can read, or `None` when it is:
    /// the check a field makes before it sets a key. Blank text is no key,
    /// which [`crate::LinkMetricsSide`] takes as removing one.
    pub fn metrics_key_problem(&self, text: &str) -> Option<String> {
        if text.trim().is_empty() {
            return None;
        }
        let has_glyph = |name: &str| self.glyph_id_by_name(name).is_some();
        parse(text, &has_glyph).err().map(|error| error.to_string())
    }
}
