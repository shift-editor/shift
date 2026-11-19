//! Checks on a glyph's alternates.

use crate::{CoreResult, Font, Glyph, NeverUsedReason};

use super::{Check, Finding};

/// A finding for each of `glyph`'s alternates that never wins anywhere on
/// the font's axes; see [`crate::never_used_alternates`].
pub(super) fn check(font: &Font, glyph: &Glyph) -> CoreResult<Vec<Finding>> {
    let unused = font.never_used_alternates(glyph.id())?;
    let alternates = glyph.alternates();
    let describe = |alternate_id| {
        let position = alternates
            .iter()
            .position(|alternate| alternate.id() == alternate_id)
            .unwrap_or_default();
        let name = alternates
            .get(position)
            .and_then(|alternate| font.glyph(alternate.glyph()))
            .map_or("?", Glyph::name);
        format!("{name} (alternate {})", position + 1)
    };
    Ok(unused
        .into_iter()
        .map(|unused| {
            let why = match &unused.reason {
                NeverUsedReason::OutsideAxes => {
                    "its condition holds nowhere in the axes' ranges".to_string()
                }
                NeverUsedReason::Covered { by } => {
                    let earlier: Vec<String> = by.iter().map(|id| describe(*id)).collect();
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
                    describe(unused.alternate_id)
                ),
            )
        })
        .collect())
}
