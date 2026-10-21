//! Checks on kerning groups and per-master pair values.

use std::collections::BTreeMap;

use crate::{Font, KerningPair, KerningPosition, KerningSide};

use super::{Check, Finding};

/// How many example pairs a finding names.
const EXAMPLES: usize = 5;

pub(super) fn check(font: &Font) -> Vec<Finding> {
    let used = used_pairs(font);
    empty_groups(font, &used)
        .chain(unresolved(font, &used))
        .collect()
}

/// Every pair with a value in some master, and how many masters kern it.
fn used_pairs(font: &Font) -> BTreeMap<&KerningPair, usize> {
    let mut used = BTreeMap::new();
    for source in font.masters() {
        let Some(kerning) = font.kerning().source(&source.id()) else {
            continue;
        };
        for (pair, _) in kerning.pairs() {
            *used.entry(pair).or_default() += 1;
        }
    }
    used
}

fn empty_groups<'a>(
    font: &'a Font,
    used: &'a BTreeMap<&KerningPair, usize>,
) -> impl Iterator<Item = Finding> + 'a {
    let empty = font
        .kerning()
        .all_groups()
        .filter(|(_, group)| group.members.is_empty());
    empty.filter_map(|(group_id, group)| {
        let side = KerningSide::Group(group_id.clone());
        let pairs = used
            .keys()
            .filter(|pair| pair.first == side || pair.second == side)
            .count();
        if pairs == 0 {
            return None;
        }

        Some(Finding::font(
            Check::EmptyKerningGroup,
            format!(
                "kerning group '{}' has no glyphs, so its {pairs} pair{} do nothing",
                group.name,
                plural(pairs)
            ),
        ))
    })
}

fn unresolved(font: &Font, used: &BTreeMap<&KerningPair, usize>) -> Option<Finding> {
    let kerning = font.kerning();
    let resolves = |side: &KerningSide, position: KerningPosition| match side {
        KerningSide::Glyph(glyph_id) => font.glyph(glyph_id).is_some(),
        KerningSide::Group(group_id) => kerning
            .group(group_id)
            .is_some_and(|group| group.position == position),
    };

    let broken = used
        .keys()
        .filter(|pair| {
            !resolves(&pair.first, KerningPosition::First)
                || !resolves(&pair.second, KerningPosition::Second)
        })
        .collect::<Vec<_>>();
    if broken.is_empty() {
        return None;
    }

    let examples = broken
        .iter()
        .take(EXAMPLES)
        .map(|pair| label(font, pair))
        .collect::<Vec<_>>()
        .join(", ");
    Some(Finding::font(
        Check::UnresolvedKerning,
        format!(
            "{} kerning pair{} never apply because a side isn't in the font or is on the wrong side: {examples}",
            broken.len(),
            plural(broken.len())
        ),
    ))
}

fn label(font: &Font, pair: &KerningPair) -> String {
    let side = |side: &KerningSide| match side {
        KerningSide::Glyph(glyph_id) => font
            .glyph(glyph_id)
            .map_or_else(|| glyph_id.to_string(), |glyph| glyph.name().to_string()),
        KerningSide::Group(group_id) => font.kerning().group(group_id).map_or_else(
            || format!("@{group_id}"),
            |group| format!("@{}", group.name),
        ),
    };
    format!("{}/{}", side(&pair.first), side(&pair.second))
}

fn plural(count: usize) -> &'static str {
    if count == 1 { "" } else { "s" }
}
