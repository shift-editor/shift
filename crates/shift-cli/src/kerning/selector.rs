//! Resolves command-line kerning selectors to stable identities.

use miette::{Result, bail, miette};
use shift_font::{Font, KerningGroupId, KerningPosition, KerningSide};

use crate::authoring::resolve_glyph_id;
use crate::cli::KerningPositionArg;

/// Prefix that marks a pair side as a group name rather than a glyph.
pub(crate) const GROUP_PREFIX: char = '@';

impl From<KerningPositionArg> for KerningPosition {
    fn from(position: KerningPositionArg) -> Self {
        match position {
            KerningPositionArg::First => Self::First,
            KerningPositionArg::Second => Self::Second,
        }
    }
}

/// Returns the stable lowercase label for a pair position.
pub(crate) fn position_label(position: KerningPosition) -> &'static str {
    match position {
        KerningPosition::First => "first",
        KerningPosition::Second => "second",
    }
}

/// Resolves a group by its name at `position`, or by its full stable id.
///
/// # Errors
///
/// Returns an error when no group matches, or when an id names a group at the
/// other position.
pub(crate) fn resolve_group_id(
    font: &Font,
    position: KerningPosition,
    selector: &str,
) -> Result<KerningGroupId> {
    let kerning = font.kerning();
    if let Ok(group_id) = selector.parse::<KerningGroupId>()
        && let Some(group) = kerning.group(&group_id)
    {
        if group.position != position {
            bail!(
                "group {selector:?} is a {} group, not a {} group",
                position_label(group.position),
                position_label(position)
            );
        }
        return Ok(group_id);
    }

    kerning
        .group_id(position, selector)
        .cloned()
        .ok_or_else(|| {
            miette!(
                "{} group {selector:?} does not exist; use its name or full kerningGroup_ id",
                position_label(position)
            )
        })
}

/// Resolves one side of a pair at `position`: `@NAME` or a group id selects a
/// group, anything else a glyph by name or id.
///
/// # Errors
///
/// Returns an error when the glyph or group does not exist.
pub(crate) fn resolve_side(
    font: &Font,
    position: KerningPosition,
    selector: &str,
) -> Result<KerningSide> {
    if let Some(name) = selector.strip_prefix(GROUP_PREFIX) {
        return Ok(KerningSide::Group(resolve_group_id(font, position, name)?));
    }
    if let Ok(group_id) = selector.parse::<KerningGroupId>()
        && font.kerning().group(&group_id).is_some()
    {
        return Ok(KerningSide::Group(resolve_group_id(
            font, position, selector,
        )?));
    }

    Ok(KerningSide::Glyph(resolve_glyph_id(font, selector)?))
}
