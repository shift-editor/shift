//! Kerning counts per master, for spotting gaps before reading pairs.

use serde::Serialize;
use shift_font::{Font, KerningPosition, KerningSide};

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KerningSummary {
    pub first_group_count: usize,
    pub second_group_count: usize,
    /// Groups with no members, which no pair can apply through.
    pub empty_group_count: usize,
    /// One row per master, in source order, including masters with no kerning.
    pub sources: Vec<SourceKerningSummary>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceKerningSummary {
    pub source_id: String,
    pub name: String,
    pub pair_count: usize,
    pub glyph_pair_count: usize,
    pub exception_count: usize,
    pub group_pair_count: usize,
    /// Pairs naming a glyph or group the font no longer has; they never apply.
    pub unresolved_count: usize,
}

impl KerningSummary {
    pub(crate) fn from_font(font: &Font) -> Self {
        let kerning = font.kerning();
        let group_count = |position| kerning.groups(position).count();
        let resolves = |side: &KerningSide| match side {
            KerningSide::Glyph(glyph_id) => font.glyph(glyph_id).is_some(),
            KerningSide::Group(group_id) => kerning.group(group_id).is_some(),
        };

        let sources = font
            .masters()
            .map(|source| {
                let mut summary = SourceKerningSummary {
                    source_id: source.id().to_string(),
                    name: source.name().to_string(),
                    pair_count: 0,
                    glyph_pair_count: 0,
                    exception_count: 0,
                    group_pair_count: 0,
                    unresolved_count: 0,
                };
                let Some(source_kerning) = kerning.source(&source.id()) else {
                    return summary;
                };
                for (pair, _) in source_kerning.pairs() {
                    summary.pair_count += 1;
                    if !resolves(&pair.first) || !resolves(&pair.second) {
                        summary.unresolved_count += 1;
                    }
                    match (&pair.first, &pair.second) {
                        (KerningSide::Glyph(_), KerningSide::Glyph(_)) => {
                            summary.glyph_pair_count += 1;
                        }
                        (KerningSide::Group(_), KerningSide::Group(_)) => {
                            summary.group_pair_count += 1;
                        }
                        _ => summary.exception_count += 1,
                    }
                }
                summary
            })
            .collect();

        Self {
            first_group_count: group_count(KerningPosition::First),
            second_group_count: group_count(KerningPosition::Second),
            empty_group_count: kerning
                .all_groups()
                .filter(|(_, group)| group.members.is_empty())
                .count(),
            sources,
        }
    }

    pub(crate) fn pair_count(&self) -> usize {
        self.sources.iter().map(|source| source.pair_count).sum()
    }
}
