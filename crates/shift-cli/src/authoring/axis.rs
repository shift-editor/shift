//! Axis edits preserve identity, role, labels, visibility, and dependent coordinates.

use miette::{Result, bail, miette};
use shift_font::{AxisKind, FontIntent, FontIntentSet};

use crate::cli::SetAxisArgs;

use super::{AuthoringReport, apply_mutation, glyph::load_font, resolve_axis_id};

/// Edits axis naming or continuous range through domain validation.
///
/// No source, label, instance coordinate, or mapping point is moved to make an
/// edit fit. Discrete axes permit naming edits only.
///
/// # Errors
///
/// Returns an error for an unknown selector, empty edit, unsupported discrete
/// range edit, invalid dependent authoring, or document/persistence failure.
pub fn set_axis(args: SetAxisArgs) -> Result<AuthoringReport> {
    let font = load_font(&args.path)?;
    let axis_id = resolve_axis_id(&font, &args.axis)?;
    let current = font
        .axis(&axis_id)
        .ok_or_else(|| miette!("axis {:?} does not exist", args.axis))?;
    let changes_range = args.minimum.is_some() || args.default.is_some() || args.maximum.is_some();
    if args.tag.is_none() && args.name.is_none() && !changes_range {
        bail!("axis set requires a name, tag, or range edit");
    }

    let mut axis = current.clone();
    if let Some(tag) = args.tag {
        axis.set_tag(tag);
    }
    if let Some(name) = args.name {
        axis.set_name(name);
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
        FontIntentSet {
            intents: vec![FontIntent::UpdateAxis { axis }],
        },
    )
}
