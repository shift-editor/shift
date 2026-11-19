//! Checks on a glyph's swaps and component conditions.

use std::collections::BTreeMap;

use crate::{CoreResult, Font, Glyph, NeverUsedReason, SwapId};

use super::{Check, Finding};

impl Font {
    /// A finding for each of `glyph`'s swaps that never wins anywhere on
    /// the font's axes; see [`crate::never_used_swaps`].
    pub(super) fn never_used_swap_findings(&self, glyph: &Glyph) -> CoreResult<Vec<Finding>> {
        let unused = self.never_used_swaps(glyph.id())?;
        // Each swap as a finding names it: `dollar.bled (swap 2)`.
        let described: BTreeMap<SwapId, String> = glyph
            .swaps()
            .iter()
            .enumerate()
            .map(|(index, swap)| {
                let name = self.glyph(swap.glyph()).map_or("?", Glyph::name);
                (swap.id(), format!("{name} (swap {})", index + 1))
            })
            .collect();
        let describe = |swap_id: &SwapId| described.get(swap_id).cloned().unwrap_or_default();
        Ok(unused
            .into_iter()
            .map(|unused| {
                let why = match &unused.reason {
                    NeverUsedReason::OutsideAxes => {
                        "its condition holds nowhere in the axes' ranges".to_string()
                    }
                    NeverUsedReason::Covered { by } => {
                        let earlier: Vec<String> = by.iter().map(describe).collect();
                        // `dollar.heavy (swap 1) applies`, `… and … apply`.
                        let verb = if earlier.len() == 1 {
                            "applies"
                        } else {
                            "apply"
                        };
                        format!(
                            "{} already {verb} wherever its condition holds",
                            earlier.join(" and ")
                        )
                    }
                };
                Finding::glyph(
                    Check::NeverUsedSwap,
                    glyph.id(),
                    format!(
                        "{}: {} is never used, because {why}",
                        glyph.name(),
                        describe(&unused.swap_id)
                    ),
                )
            })
            .collect())
    }
}

impl Font {
    /// A finding when the font has swaps and its feature code writes a
    /// `variation rvrn` block of its own. Export compiles swaps as `rvrn`
    /// feature variations too, and a shaper applies only the first `rvrn`
    /// record that holds at a location, so wherever a swap's region and
    /// the block's condition set overlap, one of the two is dropped.
    pub(super) fn feature_rvrn_findings(&self) -> Vec<Finding> {
        let has_swaps = self.glyphs().any(|glyph| !glyph.swaps().is_empty());
        let writes_rvrn = self
            .features()
            .fea_source()
            .is_some_and(writes_rvrn_variation);
        if !has_swaps || !writes_rvrn {
            return Vec::new();
        }
        vec![Finding::font(
            Check::SwapsBesideFeatureRvrn,
            "the feature code writes its own `variation rvrn` block, and the font's swaps compile to \
             `rvrn` too: where both apply, only one of them is drawn; move the block's substitutions \
             into swaps, or into another feature",
        )]
    }
}

/// Whether feature code `source` writes a `variation rvrn` block, its
/// comments left out.
fn writes_rvrn_variation(source: &str) -> bool {
    let words: Vec<&str> = source
        .lines()
        .map(|line| line.split('#').next().unwrap_or_default())
        .flat_map(|line| line.split(|c: char| c.is_whitespace() || c == '{' || c == ';'))
        .filter(|word| !word.is_empty())
        .collect();
    words
        .windows(2)
        .any(|pair| matches!(pair, ["variation", "rvrn"]))
}

impl Glyph {
    /// A finding for each component that carries a condition: compiled
    /// fonts can't hold component conditions yet, so export refuses them.
    pub(super) fn component_condition_findings(&self) -> Vec<Finding> {
        self.conditional_components()
            .into_iter()
            .map(|component| {
                Finding::glyph(
                    Check::ComponentConditionNotExported,
                    self.id(),
                    format!(
                        "{}: component {} ({}) has a condition; component conditions can't be exported yet",
                        self.name(),
                        component.position,
                        component.base
                    ),
                )
            })
            .collect()
    }
}
