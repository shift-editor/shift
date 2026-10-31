use std::str::FromStr;

use fontdrasil::coords::{
    DesignCoord, DesignLocation, NormalizedLocation, UserCoord, UserLocation,
};
use fontdrasil::types::{Axes, Tag};
use fontir::error::Error;
use shift_font::{Axis, AxisList, NamedInstance, Source};
use shift_shaper_font::{AxisConversionError, axis_tag};

/// Lowers authored product presets without exposing fontir types to Shift's IR.
///
/// Instance locations are already in external/user coordinates. Internal axes
/// remain absent so fontir fills them from the axis defaults when constructing
/// `fvar` records.
///
/// # Errors
///
/// Returns [`AxisConversionError`] when an instance does not validate against
/// `axes` or one of its axes has an invalid OpenType tag.
pub(super) fn to_ir_named_instances(
    instances: &[NamedInstance],
    axes: &[Axis],
) -> Result<Vec<fontir::ir::NamedInstance>, AxisConversionError> {
    instances
        .iter()
        .map(|instance| {
            instance.validate(axes)?;
            let location = instance
                .location()
                .iter()
                .map(|(axis_id, value)| {
                    let axis = axes
                        .axis(*axis_id)
                        .expect("named instances were validated against these axes");
                    Ok((axis_tag(axis)?, UserCoord::new(*value)))
                })
                .collect::<Result<UserLocation, AxisConversionError>>()?;

            Ok(fontir::ir::NamedInstance {
                name: instance.name().to_string(),
                postscript_name: instance.postscript_name().map(str::to_string),
                location,
            })
        })
        .collect()
}

/// Converts one Shift master location from design space to normalized space.
///
/// An omitted axis coordinate resolves to that axis's mapped design-space
/// default. Coordinates explicitly stored on the source are interpreted as
/// design coordinates, not external user coordinates.
///
/// # Errors
///
/// Returns an error when the source references an axis outside `shift_axes`.
///
/// # Panics
///
/// Panics when `shift_axes` was not validated or `ir_axes` was not derived from
/// the same Shift axes.
pub(super) fn normalized_source_location(
    source: &Source,
    shift_axes: &[Axis],
    ir_axes: &Axes,
) -> Result<NormalizedLocation, Error> {
    if let Some((unknown, _)) = source
        .location()
        .iter()
        .find(|(axis_id, _)| !shift_axes.contains_axis(**axis_id))
    {
        return Err(Error::InvalidEntry(
            "Shift source location",
            format!(
                "source '{}' references unknown axis {unknown}",
                source.name()
            ),
        ));
    }

    let design_location: DesignLocation = shift_axes
        .iter()
        .map(|axis| {
            let tag = Tag::from_str(axis.tag()).expect("Shift axes were validated in the snapshot");
            let ir_axis = ir_axes
                .get(&tag)
                .expect("Shift and fontir axes were created together");
            let value = source
                .location()
                .get(&axis.id())
                .unwrap_or_else(|| ir_axis.default.to_design(&ir_axis.converter).to_f64());
            (tag, DesignCoord::new(value))
        })
        .collect();

    Ok(design_location.to_normalized(ir_axes)?)
}
