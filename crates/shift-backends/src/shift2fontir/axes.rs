use std::str::FromStr;

use fontdrasil::coords::{
    CoordConverter, DesignCoord, DesignLocation, NormalizedLocation, UserCoord, UserLocation,
};
use fontdrasil::types::{Axes, Axis as IrAxis, Tag};
use fontir::error::Error;
use shift_font::{Axis, AxisList, AxisMapping, CoreError, NamedInstance, Source};
use write_fonts::types::InvalidTag;

/// Describes Shift axes, mappings, or named instances that cannot define
/// fontir axes and instance locations.
#[derive(Debug, thiserror::Error)]
pub enum AxisConversionError {
    #[error(transparent)]
    Invalid(#[from] CoreError),

    #[error("axis '{axis}' has an invalid tag: {source}")]
    InvalidTag {
        axis: String,
        #[source]
        source: InvalidTag,
    },

    #[error("mapping '{mapping}' is missing an {side} value for axis '{axis}'")]
    MissingMappingValue {
        mapping: String,
        axis: String,
        side: MappingSide,
    },

    #[error("mapping '{mapping}' must have strictly increasing {side} values")]
    NonIncreasingMapping { mapping: String, side: MappingSide },

    #[error(
        "mapping '{mapping}' must define the minimum, default, and maximum user values for axis '{axis}'"
    )]
    MappingMissingBounds { mapping: String, axis: String },

    #[error("mapping '{mapping}' is invalid: {source}")]
    InvalidConverter {
        mapping: String,
        #[source]
        source: fontdrasil::error::Error,
    },
}

/// Which side of an axis mapping a value belongs to: user-space input or
/// design-space output.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MappingSide {
    Input,
    Output,
}

impl std::fmt::Display for MappingSide {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Input => "input",
            Self::Output => "output",
        })
    }
}

/// Parses an axis's OpenType tag.
fn axis_tag(axis: &Axis) -> Result<Tag, AxisConversionError> {
    Tag::from_str(axis.tag()).map_err(|source| AxisConversionError::InvalidTag {
        axis: axis.name().to_string(),
        source,
    })
}

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

/// Converts Shift axes and independent mappings into fontir axis definitions.
///
/// Mapping inputs are user coordinates and outputs are design coordinates.
/// Each mapped axis must define strictly increasing values at its user-space
/// minimum, default, and maximum. A point repeated exactly counts once.
///
/// # Errors
///
/// Returns [`AxisConversionError`] when an axis, OpenType tag, or independent
/// mapping cannot define a valid fontir coordinate converter.
pub(crate) fn to_ir_axes(
    axes: &[Axis],
    mappings: &[AxisMapping],
) -> Result<Vec<IrAxis>, AxisConversionError> {
    axes.iter()
        .map(|axis| to_ir_axis(axis, independent_mapping(axis, mappings)))
        .collect()
}

fn independent_mapping<'a>(axis: &Axis, mappings: &'a [AxisMapping]) -> Option<&'a AxisMapping> {
    mappings
        .iter()
        .find(|mapping| mapping.is_independent() && mapping.outputs() == [axis.id()])
}

fn to_ir_axis(axis: &Axis, mapping: Option<&AxisMapping>) -> Result<IrAxis, AxisConversionError> {
    axis.validate()?;
    let tag = axis_tag(axis)?;
    let min = UserCoord::new(axis.minimum());
    let default = UserCoord::new(axis.default());
    let max = UserCoord::new(axis.maximum());
    let converter = match mapping {
        Some(mapping) => mapped_converter(axis, mapping, min, default, max)?,
        None => CoordConverter::unmapped(min, default, max),
    };

    Ok(IrAxis {
        name: axis.name().to_string(),
        tag,
        min,
        default,
        max,
        hidden: axis.is_hidden() || axis.role() == shift_font::AxisRole::Internal,
        converter,
        localized_names: Default::default(),
    })
}

fn mapped_converter(
    axis: &Axis,
    mapping: &AxisMapping,
    min: UserCoord,
    default: UserCoord,
    max: UserCoord,
) -> Result<CoordConverter, AxisConversionError> {
    mapping.validate(std::slice::from_ref(axis))?;

    let missing = |side| AxisConversionError::MissingMappingValue {
        mapping: mapping.name().to_string(),
        axis: axis.name().to_string(),
        side,
    };
    let mut values = mapping
        .points()
        .iter()
        .map(|point| {
            let input = point
                .input
                .get(axis.id())
                .ok_or_else(|| missing(MappingSide::Input))?;
            let output = point
                .output
                .get(axis.id())
                .ok_or_else(|| missing(MappingSide::Output))?;
            Ok((input, output))
        })
        .collect::<Result<Vec<_>, AxisConversionError>>()?;
    values.sort_by(|left, right| left.0.total_cmp(&right.0));
    // Fonts imported before duplicate avar points were dropped may repeat a
    // point; a repeat says nothing new, so only conflicting inputs fail.
    values.dedup();

    let non_increasing = |side| AxisConversionError::NonIncreasingMapping {
        mapping: mapping.name().to_string(),
        side,
    };
    if values.windows(2).any(|pair| pair[0].0 >= pair[1].0) {
        return Err(non_increasing(MappingSide::Input));
    }
    if values.windows(2).any(|pair| pair[0].1 >= pair[1].1) {
        return Err(non_increasing(MappingSide::Output));
    }

    let required = [min.to_f64(), default.to_f64(), max.to_f64()];
    if required
        .iter()
        .any(|required| !values.iter().any(|(input, _)| input == required))
    {
        return Err(AxisConversionError::MappingMissingBounds {
            mapping: mapping.name().to_string(),
            axis: axis.name().to_string(),
        });
    }

    let default_idx = values
        .iter()
        .position(|(input, _)| *input == default.to_f64())
        .expect("the default mapping was checked above");
    let values = values
        .into_iter()
        .map(|(user, design)| (UserCoord::new(user), DesignCoord::new(design)))
        .collect();
    CoordConverter::new(values, default_idx).map_err(|source| {
        AxisConversionError::InvalidConverter {
            mapping: mapping.name().to_string(),
            source,
        }
    })
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

#[cfg(test)]
mod tests {
    use shift_font::{AxisMappingPoint, Location};

    use super::*;

    fn weight_mapping(axis: &Axis, points: &[(f64, f64)]) -> AxisMapping {
        let points = points
            .iter()
            .map(|&(user, design)| {
                let input = Location::from([(axis.id(), user)]);
                let output = Location::from([(axis.id(), design)]);
                AxisMappingPoint {
                    description: None,
                    input,
                    output,
                }
            })
            .collect();
        AxisMapping::new(
            "Weight".to_string(),
            vec![axis.id()],
            vec![axis.id()],
            points,
        )
    }

    #[test]
    fn mapping_converts_user_to_design_coordinates() {
        let axis = Axis::weight();
        let mapping = weight_mapping(&axis, &[(100.0, 20.0), (400.0, 80.0), (900.0, 200.0)]);

        let axes = to_ir_axes(std::slice::from_ref(&axis), &[mapping]).unwrap();

        assert_eq!(
            UserCoord::new(400.0).to_design(&axes[0].converter),
            DesignCoord::new(80.0)
        );
    }

    #[test]
    fn mapping_without_axis_bounds_is_rejected() {
        let axis = Axis::weight();
        let mapping = weight_mapping(&axis, &[(100.0, 20.0), (400.0, 80.0)]);

        let error = to_ir_axes(std::slice::from_ref(&axis), &[mapping]).unwrap_err();

        assert!(matches!(
            error,
            AxisConversionError::MappingMissingBounds { mapping, axis }
                if mapping == "Weight" && axis == "Weight"
        ));
    }

    #[test]
    fn mapping_repeating_a_point_converts_but_conflicting_points_do_not() {
        let axis = Axis::weight();
        let repeated = weight_mapping(
            &axis,
            &[
                (100.0, 100.0),
                (400.0, 400.0),
                (400.0, 400.0),
                (900.0, 900.0),
            ],
        );
        let conflicting = weight_mapping(
            &axis,
            &[
                (100.0, 100.0),
                (400.0, 400.0),
                (400.0, 500.0),
                (900.0, 900.0),
            ],
        );

        to_ir_axes(std::slice::from_ref(&axis), &[repeated]).unwrap();
        assert!(matches!(
            to_ir_axes(std::slice::from_ref(&axis), &[conflicting]).unwrap_err(),
            AxisConversionError::NonIncreasingMapping {
                side: MappingSide::Input,
                ..
            }
        ));
    }

    #[test]
    fn mapping_with_decreasing_outputs_is_rejected() {
        let axis = Axis::weight();
        let mapping = weight_mapping(&axis, &[(100.0, 200.0), (400.0, 80.0), (900.0, 20.0)]);

        let error = to_ir_axes(std::slice::from_ref(&axis), &[mapping]).unwrap_err();

        assert!(matches!(
            error,
            AxisConversionError::NonIncreasingMapping {
                side: MappingSide::Output,
                ..
            }
        ));
        assert_eq!(
            error.to_string(),
            "mapping 'Weight' must have strictly increasing output values"
        );
    }
}
