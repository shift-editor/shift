use std::collections::{HashMap, HashSet};
use std::str::FromStr;

use fontdrasil::{
    coords::{NormalizedCoord, NormalizedLocation},
    types::Tag,
    variations::{RoundingBehaviour, VariationModel},
};

use crate::{Axis, AxisMapping, AxisRole, CoreError, CoreResult, Location};

pub fn to_fd_location(loc: &Location, axes: &[Axis]) -> NormalizedLocation {
    let mut result = NormalizedLocation::new();

    for axis in axes {
        let value = loc.get(&axis.id()).unwrap_or(axis.default());
        let n = axis.normalize(value);
        let Ok(tag) = Tag::from_str(axis.tag()) else {
            continue;
        };

        result.insert(tag, NormalizedCoord::new(n));
    }

    result
}

pub fn map_location(
    external: &Location,
    axes: &[Axis],
    mappings: &[AxisMapping],
) -> CoreResult<Location> {
    let mut mapped = Location::new();
    for axis in axes {
        let value = match axis.role() {
            AxisRole::External => external.get(&axis.id()).unwrap_or(axis.default()),
            AxisRole::Internal => axis.default(),
        };
        mapped.set(axis.id(), value);
    }

    for mapping in mappings.iter().filter(|mapping| mapping.is_independent()) {
        let outputs = evaluate_mapping(mapping, external, axes)?;
        for (axis_id, value) in outputs.iter() {
            mapped.set(axis_id.clone(), *value);
        }
    }

    let independently_mapped = mapped.clone();
    for mapping in mappings.iter().filter(|mapping| !mapping.is_independent()) {
        let outputs = evaluate_mapping(mapping, &independently_mapped, axes)?;
        for (axis_id, value) in outputs.iter() {
            mapped.set(axis_id.clone(), *value);
        }
    }

    Ok(mapped)
}

fn evaluate_mapping(
    mapping: &AxisMapping,
    external: &Location,
    axes: &[Axis],
) -> CoreResult<Location> {
    mapping.validate(axes)?;
    let input_axes = resolve_axes(mapping.inputs(), axes, mapping)?;
    let output_axes = resolve_axes(mapping.outputs(), axes, mapping)?;
    let axis_order = input_axes
        .iter()
        .map(|axis| mapping_tag(axis, mapping))
        .collect::<CoreResult<Vec<_>>>()?;

    let mut sample_values: HashMap<NormalizedLocation, Vec<f64>> = HashMap::new();
    for point in mapping.points() {
        let input = normalized_input(&point.input, &input_axes, &axis_order);
        let deltas = output_axes
            .iter()
            .map(|axis| {
                let base = point.input.get(&axis.id()).unwrap_or(axis.default());
                let output = point.output.get(&axis.id()).unwrap_or(base);
                axis.normalize(output) - axis.normalize(base)
            })
            .collect();
        if sample_values.insert(input, deltas).is_some() {
            return Err(invalid_mapping(
                mapping,
                "mapping point inputs must be unique",
            ));
        }
    }

    let default_input: NormalizedLocation = axis_order
        .iter()
        .map(|tag| (*tag, NormalizedCoord::new(0.0)))
        .collect();
    sample_values
        .entry(default_input)
        .or_insert_with(|| vec![0.0; output_axes.len()]);

    let model = VariationModel::new(
        sample_values.keys().cloned().collect::<HashSet<_>>(),
        axis_order,
    );
    let deltas = model
        .deltas_with_rounding::<f64, f64>(&sample_values, RoundingBehaviour::None)
        .map_err(|error| invalid_mapping(mapping, error.to_string()))?;

    let target = normalized_input(external, &input_axes, model.axis_order());
    let adjustments = model.interpolate_from_deltas(&target, &deltas);
    let mut result = Location::new();
    for (axis, adjustment) in output_axes.iter().zip(adjustments) {
        let base = external.get(&axis.id()).unwrap_or(axis.default());
        result.set(
            axis.id(),
            axis.denormalize(axis.normalize(base) + adjustment),
        );
    }

    Ok(result)
}

fn resolve_axes<'a>(
    ids: &[crate::AxisId],
    axes: &'a [Axis],
    mapping: &AxisMapping,
) -> CoreResult<Vec<&'a Axis>> {
    ids.iter()
        .map(|axis_id| {
            axes.iter()
                .find(|axis| axis.id() == *axis_id)
                .ok_or_else(|| invalid_mapping(mapping, format!("unknown axis {axis_id}")))
        })
        .collect()
}

fn mapping_tag(axis: &Axis, mapping: &AxisMapping) -> CoreResult<Tag> {
    Tag::from_str(axis.tag()).map_err(|_| {
        invalid_mapping(
            mapping,
            format!("axis {} has invalid tag {:?}", axis.id(), axis.tag()),
        )
    })
}

fn normalized_input(location: &Location, axes: &[&Axis], tags: &[Tag]) -> NormalizedLocation {
    axes.iter()
        .zip(tags)
        .map(|(axis, tag)| {
            let value = location.get(&axis.id()).unwrap_or(axis.default());
            (*tag, NormalizedCoord::new(axis.normalize(value)))
        })
        .collect()
}

fn invalid_mapping(mapping: &AxisMapping, message: impl Into<String>) -> CoreError {
    CoreError::InvalidAxisMapping {
        mapping_id: mapping.id(),
        message: message.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AxisId, AxisMappingPoint};

    #[test]
    fn maps_independent_axes_before_cross_axis_mappings() {
        let weight = Axis::weight();
        let width = Axis::width();
        let mut optical = Axis::continuous_with_id(
            AxisId::new(),
            "opsz".to_string(),
            "Optical size".to_string(),
            8.0,
            12.0,
            72.0,
        );
        optical.set_role(AxisRole::Internal);
        let axes = vec![weight.clone(), width.clone(), optical.clone()];

        let independent = AxisMapping::new(
            "Weight curve".to_string(),
            vec![weight.id()],
            vec![weight.id()],
            vec![
                point(&[(weight.id(), 100.0)], &[(weight.id(), 100.0)]),
                point(&[(weight.id(), 400.0)], &[(weight.id(), 400.0)]),
                point(&[(weight.id(), 900.0)], &[(weight.id(), 800.0)]),
            ],
        );
        let cross = AxisMapping::new(
            "Optical compensation".to_string(),
            vec![weight.id(), width.id()],
            vec![optical.id()],
            vec![point(
                &[(weight.id(), 800.0), (width.id(), 125.0)],
                &[(optical.id(), 72.0)],
            )],
        );

        let external = location(&[
            (weight.id(), 900.0),
            (width.id(), 125.0),
            (optical.id(), 40.0),
        ]);
        let mapped = map_location(&external, &axes, &[independent, cross]).unwrap();

        assert!((mapped.get(&weight.id()).unwrap() - 800.0).abs() < 0.001);
        assert!((mapped.get(&width.id()).unwrap() - 125.0).abs() < 0.001);
        assert!((mapped.get(&optical.id()).unwrap() - 72.0).abs() < 0.001);
    }

    #[test]
    fn external_locations_cannot_set_internal_axes_directly() {
        let mut optical = Axis::continuous_with_id(
            AxisId::new(),
            "opsz".to_string(),
            "Optical size".to_string(),
            8.0,
            12.0,
            72.0,
        );
        optical.set_role(AxisRole::Internal);
        let external = location(&[(optical.id(), 40.0)]);

        let mapped = map_location(&external, &[optical.clone()], &[]).unwrap();

        assert_eq!(mapped.get(&optical.id()), Some(12.0));
    }

    fn point(input: &[(AxisId, f64)], output: &[(AxisId, f64)]) -> AxisMappingPoint {
        AxisMappingPoint {
            description: None,
            input: location(input),
            output: location(output),
        }
    }

    fn location(values: &[(AxisId, f64)]) -> Location {
        let mut location = Location::new();
        for (axis_id, value) in values {
            location.set(axis_id.clone(), *value);
        }
        location
    }
}
