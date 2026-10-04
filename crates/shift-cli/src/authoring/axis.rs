//! Axis edits preserve identity, role, labels, visibility, and dependent coordinates.

use miette::{Result, bail, miette};
use shift_font::{Axis, AxisKind, FontIntent, FontIntentSet};

use crate::cli::SetAxisArgs;

use super::{AuthoringReport, apply_mutation, glyph::load_font};

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
    let current = font
        .axes()
        .iter()
        .find(|axis| axis.tag() == args.axis || axis.id().to_string() == args.axis)
        .ok_or_else(|| {
            miette!(
                "axis {:?} does not exist; use its tag or full id",
                args.axis
            )
        })?;
    let changes_range = args.minimum.is_some() || args.default.is_some() || args.maximum.is_some();
    if args.tag.is_none() && args.name.is_none() && !changes_range {
        bail!("axis set requires a name, tag, or range edit");
    }
    let tag = args.tag.unwrap_or_else(|| current.tag().to_string());
    let name = args.name.unwrap_or_else(|| current.name().to_string());
    let mut axis = match current.kind() {
        AxisKind::Continuous {
            minimum,
            default,
            maximum,
        } => Axis::continuous_with_id(
            current.id(),
            tag,
            name,
            args.minimum.unwrap_or(*minimum),
            args.default.unwrap_or(*default),
            args.maximum.unwrap_or(*maximum),
        ),
        AxisKind::Discrete { values, default } => {
            if changes_range {
                bail!("discrete axes permit name/tag edits only");
            }
            Axis::discrete_with_id(current.id(), tag, name, values.clone(), *default)
        }
    };
    axis.set_role(current.role());
    axis.set_hidden(current.is_hidden());
    axis.set_labels(current.labels().to_vec());
    apply_mutation(
        &args.path,
        &args.mutation,
        FontIntentSet {
            intents: vec![FontIntent::UpdateAxis { axis }],
        },
    )
}
