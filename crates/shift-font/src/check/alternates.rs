//! Checks on a glyph's alternates.

use std::collections::BTreeMap;

use crate::{AlternateId, CoreResult, Font, Glyph, NeverUsedReason};

use super::{Check, Finding};

impl Font {
    /// A finding for each of `glyph`'s alternates that never wins anywhere on
    /// the font's axes; see [`crate::never_used_alternates`].
    pub(super) fn never_used_alternate_findings(&self, glyph: &Glyph) -> CoreResult<Vec<Finding>> {
        let unused = self.never_used_alternates(glyph.id())?;
        // Each alternate as a finding names it: `dollar.bled (alternate 2)`.
        let described: BTreeMap<AlternateId, String> = glyph
            .alternates()
            .iter()
            .enumerate()
            .map(|(index, alternate)| {
                let name = self.glyph(alternate.glyph()).map_or("?", Glyph::name);
                (alternate.id(), format!("{name} (alternate {})", index + 1))
            })
            .collect();
        let describe =
            |alternate_id: &AlternateId| described.get(alternate_id).cloned().unwrap_or_default();
        Ok(unused
            .into_iter()
            .map(|unused| {
                let why = match &unused.reason {
                    NeverUsedReason::OutsideAxes => {
                        "its condition holds nowhere in the axes' ranges".to_string()
                    }
                    NeverUsedReason::Covered { by } => {
                        let earlier: Vec<String> = by.iter().map(describe).collect();
                        format!(
                            "{} already applies wherever its condition holds",
                            earlier.join(" and ")
                        )
                    }
                };
                Finding::glyph(
                    Check::NeverUsedAlternate,
                    glyph.id(),
                    format!(
                        "{}: {} is never used, because {why}",
                        glyph.name(),
                        describe(&unused.alternate_id)
                    ),
                )
            })
            .collect())
    }
}
