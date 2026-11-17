//! Axis edits preserve identity, role, labels, visibility, and dependent coordinates.

use miette::{Result, bail, miette};
use shift_font::UpdateAxis;
use shift_font::{AxisKind, FontIntentSet};

use crate::cli::SetAxisArgs;

use super::{AuthoringReport, apply_mutation, glyph::load_font, resolve_axis_id};

/// Whether `axis set` hides or shows the axis in user interfaces.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Visibility {
    Hidden,
    Visible,
}

impl Visibility {
    /// Reads `--hidden` / `--visible`; clap rejects both together.
    fn from_flags(hidden: bool, visible: bool) -> Option<Self> {
        if hidden {
            return Some(Self::Hidden);
        }

        visible.then_some(Self::Visible)
    }
}

/// Edits axis naming, continuous range, or visibility through domain validation.
///
/// No source, label, instance coordinate, or mapping point is moved to make an
/// edit fit. Discrete axes permit naming edits only.
///
/// # Errors
///
/// Returns an error for an unknown selector, empty edit, unsupported discrete
/// range edit, invalid dependent authoring, or document/persistence failure.
pub(crate) fn set_axis(args: SetAxisArgs) -> Result<AuthoringReport> {
    let font = load_font(&args.path)?;
    let axis_id = resolve_axis_id(&font, &args.axis)?;
    let current = font
        .axis(axis_id)
        .ok_or_else(|| miette!("axis {:?} does not exist", args.axis))?;
    let changes_range = args.minimum.is_some() || args.default.is_some() || args.maximum.is_some();
    let visibility = Visibility::from_flags(args.hidden, args.visible);
    if args.tag.is_none() && args.name.is_none() && !changes_range && visibility.is_none() {
        bail!("axis set requires a name, tag, range, or visibility edit");
    }

    let mut axis = current.clone();
    if let Some(tag) = args.tag {
        axis.set_tag(tag);
    }
    if let Some(name) = args.name {
        axis.set_name(name);
    }
    if let Some(visibility) = visibility {
        axis.set_hidden(visibility == Visibility::Hidden);
    }
    if changes_range {
        match current.kind() {
            AxisKind::Continuous {
                minimum,
                default,
                maximum,
            } => axis.set_kind(AxisKind::Continuous {
                minimum: args.minimum.unwrap_or(*minimum),
                default: args.default.unwrap_or(*default),
                maximum: args.maximum.unwrap_or(*maximum),
            }),
            AxisKind::Discrete { .. } => {
                bail!("discrete axes permit name/tag edits only");
            }
        }
    }

    apply_mutation(
        &args.path,
        &args.mutation,
        &FontIntentSet::from(UpdateAxis { axis }),
    )
}
