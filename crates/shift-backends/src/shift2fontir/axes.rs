use std::str::FromStr;

use fontdrasil::coords::{
    CoordConverter, DesignCoord, DesignLocation, NormalizedLocation, UserCoord,
};
use fontdrasil::types::{Axes, Axis as IrAxis, Tag};
use fontir::error::Error;
use shift_font::{Axis, AxisMapping, Source};

pub(super) fn to_ir_axes(axes: &[Axis], mappings: &[AxisMapping]) -> Result<Vec<IrAxis>, String> {
    axes.iter()
        .map(|axis| to_ir_axis(axis, independent_mapping(axis, mappings)))
        .collect()
}

fn independent_mapping<'a>(axis: &Axis, mappings: &'a [AxisMapping]) -> Option<&'a AxisMapping> {
    mappings
        .iter()
        .find(|mapping| mapping.is_independent() && mapping.outputs() == [axis.id()])
}

fn to_ir_axis(axis: &Axis, mapping: Option<&AxisMapping>) -> Result<IrAxis, String> {
    axis.validate().map_err(|error| error.to_string())?;
    let tag = Tag::from_str(axis.tag())
        .map_err(|error| format!("axis '{}' has an invalid tag: {error}", axis.name()))?;
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
) -> Result<CoordConverter, String> {
    mapping
        .validate(std::slice::from_ref(axis))
        .map_err(|error| error.to_string())?;

    let mut values = mapping
        .points()
        .iter()
        .map(|point| {
            let input = point
                .input
                .get(&axis.id())
                .ok_or_else(|| format!("mapping '{}' is missing an input value", mapping.name()))?;
            let output = point.output.get(&axis.id()).ok_or_else(|| {
                format!("mapping '{}' is missing an output value", mapping.name())
            })?;
            Ok((input, output))
        })
        .collect::<Result<Vec<_>, String>>()?;
    values.sort_by(|left, right| left.0.total_cmp(&right.0));

    if values.windows(2).any(|pair| pair[0].0 >= pair[1].0) {
        return Err(format!(
            "mapping '{}' must have strictly increasing input values",
            mapping.name()
        ));
    }
    if values.windows(2).any(|pair| pair[0].1 >= pair[1].1) {
        return Err(format!(
            "mapping '{}' must have strictly increasing output values",
            mapping.name()
        ));
    }

    let required = [min.to_f64(), default.to_f64(), max.to_f64()];
    if required
        .iter()
        .any(|required| !values.iter().any(|(input, _)| input == required))
    {
        return Err(format!(
            "mapping '{}' must define the minimum, default, and maximum user values for axis '{}'",
            mapping.name(),
            axis.name()
        ));
    }

    let default_idx = values
        .iter()
        .position(|(input, _)| *input == default.to_f64())
        .expect("the default mapping was checked above");
    let values = values
        .into_iter()
        .map(|(user, design)| (UserCoord::new(user), DesignCoord::new(design)))
        .collect();
    Ok(CoordConverter::new(values, default_idx))
}

pub(super) fn normalized_source_location(
    source: &Source,
    shift_axes: &[Axis],
    ir_axes: &Axes,
) -> Result<NormalizedLocation, Error> {
    if let Some((unknown, _)) = source
        .location()
        .iter()
        .find(|(axis_id, _)| !shift_axes.iter().any(|axis| axis.id() == **axis_id))
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

    Ok(design_location.to_normalized(ir_axes))
}
