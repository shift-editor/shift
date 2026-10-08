//! UFO `groups.plist` and `kerning.plist` conversion.
//!
//! UFO names kerning groups with a `public.kern1.` or `public.kern2.` prefix
//! that encodes the pair position. Shift stores group names without it.

use std::collections::HashMap;

use norad::Font as NoradFont;
use shift_font::{GlyphId, Kerning, KerningPosition, KerningSide, SourceId};

use crate::errors::FormatBackendResult;
use crate::kerning_import::{KerningImport, NamedKerningSide};

const FIRST_GROUP_PREFIX: &str = "public.kern1.";
const SECOND_GROUP_PREFIX: &str = "public.kern2.";

/// Kerning groups and pairs read from one UFO, still keyed by glyph name.
///
/// Groups without a kerning prefix are not kerning groups and are ignored.
#[derive(Clone, Debug, Default)]
pub(crate) struct UfoKerning {
    groups: norad::Groups,
    pairs: norad::Kerning,
}

impl UfoKerning {
    pub(crate) fn from_norad(font: &NoradFont) -> Self {
        Self {
            groups: font.groups.clone(),
            pairs: font.kerning.clone(),
        }
    }

    /// Adds this UFO's kerning groups to `import`.
    pub(crate) fn add_groups(&self, import: &mut KerningImport<'_>) {
        for (name, members) in &self.groups {
            let Some((position, bare)) = group_position(name.as_str()) else {
                continue;
            };
            import.add_group(position, bare, members.iter().map(|member| member.as_str()));
        }
    }

    /// Adds this UFO's pairs to `import` as the values of `source_id`.
    pub(crate) fn add_pairs(&self, import: &mut KerningImport<'_>, source_id: &SourceId) {
        for (first, seconds) in &self.pairs {
            for (second, value) in seconds {
                import.add_pair(
                    source_id,
                    named_side(first.as_str(), FIRST_GROUP_PREFIX),
                    named_side(second.as_str(), SECOND_GROUP_PREFIX),
                    *value,
                );
            }
        }
    }
}

fn group_position(name: &str) -> Option<(KerningPosition, &str)> {
    name.strip_prefix(FIRST_GROUP_PREFIX)
        .map(|bare| (KerningPosition::First, bare))
        .or_else(|| {
            name.strip_prefix(SECOND_GROUP_PREFIX)
                .map(|bare| (KerningPosition::Second, bare))
        })
}

fn named_side<'a>(name: &'a str, group_prefix: &str) -> NamedKerningSide<'a> {
    match name.strip_prefix(group_prefix) {
        Some(group) => NamedKerningSide::Group(group),
        None => NamedKerningSide::Glyph(name),
    }
}

/// Builds the UFO groups and pairs that represent `source_id`'s kerning.
///
/// Group members and pair sides naming a glyph outside `glyph_names` are left
/// out, so a UFO never references a glyph it does not contain.
///
/// # Errors
///
/// Returns an error when a group or glyph name is not a valid UFO name.
pub(crate) fn ufo_kerning(
    kerning: &Kerning,
    source_id: Option<&SourceId>,
    glyph_names: &HashMap<GlyphId, &str>,
) -> FormatBackendResult<(norad::Groups, norad::Kerning)> {
    let mut groups = norad::Groups::new();
    for (position, prefix) in [
        (KerningPosition::First, FIRST_GROUP_PREFIX),
        (KerningPosition::Second, SECOND_GROUP_PREFIX),
    ] {
        for (name, members) in kerning.groups(position) {
            let members = members
                .iter()
                .filter_map(|member| glyph_names.get(member))
                .map(|member| super::writer::ufo_name("kerning group member", member))
                .collect::<FormatBackendResult<_>>()?;
            groups.insert(
                super::writer::ufo_name("kerning group", &format!("{prefix}{name}"))?,
                members,
            );
        }
    }

    let mut pairs = norad::Kerning::new();
    let Some(source) = source_id.and_then(|source_id| kerning.source(source_id)) else {
        return Ok((groups, pairs));
    };
    for (pair, value) in source.pairs() {
        let (Some(first), Some(second)) = (
            ufo_side(&pair.first, FIRST_GROUP_PREFIX, glyph_names),
            ufo_side(&pair.second, SECOND_GROUP_PREFIX, glyph_names),
        ) else {
            continue;
        };
        pairs
            .entry(super::writer::ufo_name("kerning glyph", &first)?)
            .or_default()
            .insert(super::writer::ufo_name("kerning glyph", &second)?, value);
    }
    Ok((groups, pairs))
}

fn ufo_side(
    side: &KerningSide,
    group_prefix: &str,
    glyph_names: &HashMap<GlyphId, &str>,
) -> Option<String> {
    match side {
        KerningSide::Glyph(glyph_id) => glyph_names.get(glyph_id).map(|name| name.to_string()),
        KerningSide::Group(name) => Some(format!("{group_prefix}{name}")),
    }
}
