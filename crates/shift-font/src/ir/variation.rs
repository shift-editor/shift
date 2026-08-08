use std::collections::{HashMap, HashSet};
use std::str::FromStr;

use fontdrasil::{
    coords::{NormalizedCoord, NormalizedLocation},
    types::Tag,
    variations::{RoundingBehaviour, VariationModel},
};

use crate::{
    Axis, AxisId, AxisMapping, AxisMappingId, AxisRole, CoreError, CoreResult, DesignLocation,
    ExternalLocation, Location, VariationBasis,
};

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

/// Fontdrasil-compiled external-to-internal mapping contribution.
#[derive(Clone, Debug, PartialEq)]
pub struct AxisMappingBasis {
    mapping_id: AxisMappingId,
    input_axis_ids: Vec<AxisId>,
    output_axis_ids: Vec<AxisId>,
    basis: VariationBasis,
}

impl AxisMappingBasis {
    /// Returns the authored mapping identity that produced this basis.
    pub fn mapping_id(&self) -> AxisMappingId {
        self.mapping_id.clone()
    }

    /// Returns the mapping's ordered input axes.
    pub fn input_axis_ids(&self) -> &[AxisId] {
        &self.input_axis_ids
    }

    /// Returns the mapping's ordered output axes.
    pub fn output_axis_ids(&self) -> &[AxisId] {
        &self.output_axis_ids
    }

    /// Returns the Fontdrasil-compiled numeric contribution basis.
    pub fn basis(&self) -> &VariationBasis {
        &self.basis
    }

    fn is_independent(&self) -> bool {
        self.input_axis_ids.len() == 1 && self.output_axis_ids == self.input_axis_ids
    }

    fn evaluate(&self, location: &Location, axes: &[Axis]) -> CoreResult<Location> {
        let adjustments = self.basis.evaluate(location, axes)?;
        let mut result = Location::new();

        for (axis_id, adjustment) in self.output_axis_ids.iter().zip(adjustments) {
            let axis = axes
                .iter()
                .find(|axis| axis.id() == *axis_id)
                .ok_or_else(|| CoreError::AxisNotFound(axis_id.clone()))?;
            let base = location.get(axis_id).unwrap_or(axis.default());
            result.set(
                axis_id.clone(),
                axis.denormalize(axis.normalize(base) + adjustment),
            );
        }

        Ok(result)
    }
}

impl TryFrom<(&AxisMapping, &[Axis])> for AxisMappingBasis {
    type Error = CoreError;

    fn try_from((mapping, axes): (&AxisMapping, &[Axis])) -> CoreResult<Self> {
        mapping.validate(axes)?;
        let input_axes = resolve_axes(mapping.inputs(), axes, mapping)?;
        let output_axes = resolve_axes(mapping.outputs(), axes, mapping)?;
        let tagged_axes = input_axes
            .iter()
            .map(|axis| Ok((mapping_tag(axis, mapping)?, axis.id())))
            .collect::<CoreResult<Vec<_>>>()?;
        let axis_order = tagged_axes.iter().map(|(tag, _)| *tag).collect::<Vec<_>>();
        let axis_ids_by_tag = tagged_axes.into_iter().collect::<HashMap<_, _>>();
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
            if let Some(previous) = sample_values.get(&input) {
                if previous != &deltas {
                    return Err(invalid_mapping(
                        mapping,
                        "normalized mapping point inputs have conflicting outputs",
                    ));
                }
                continue;
            }
            sample_values.insert(input, deltas);
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

        Ok(Self {
            mapping_id: mapping.id(),
            input_axis_ids: mapping.inputs().to_vec(),
            output_axis_ids: mapping.outputs().to_vec(),
            basis: VariationBasis::from_fontdrasil(deltas, &axis_ids_by_tag),
        })
    }
}

pub fn map_location(
    external: &ExternalLocation,
    axes: &[Axis],
    mappings: &[AxisMapping],
) -> CoreResult<DesignLocation> {
    let bases = mappings
        .iter()
        .map(|mapping| AxisMappingBasis::try_from((mapping, axes)))
        .collect::<CoreResult<Vec<_>>>()?;
    map_location_with_bases(external, axes, &bases)
}

/// Evaluates precompiled mapping bases without reconstructing their variation models.
pub fn map_location_with_bases(
    external: &ExternalLocation,
    axes: &[Axis],
    bases: &[AxisMappingBasis],
) -> CoreResult<DesignLocation> {
    let mut mapped = DesignLocation::new();
    for axis in axes {
        let value = match axis.role() {
            AxisRole::External => external.get(&axis.id()).unwrap_or(axis.default()),
            AxisRole::Internal => axis.default(),
        };
        mapped.set(axis.id(), value);
    }

    for basis in bases.iter().filter(|basis| basis.is_independent()) {
        let outputs = basis.evaluate(external.as_untyped(), axes)?;
        for (axis_id, value) in outputs.iter() {
            mapped.set(axis_id.clone(), *value);
        }
    }

    let independently_mapped = mapped.clone();
    for basis in bases.iter().filter(|basis| !basis.is_independent()) {
        let outputs = basis.evaluate(independently_mapped.as_untyped(), axes)?;
        for (axis_id, value) in outputs.iter() {
            mapped.set(axis_id.clone(), *value);
        }
    }

    Ok(mapped)
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
    use crate::{AxisId, AxisMappingId, AxisMappingPoint};

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

        let external = external_location(&[
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
    fn compiled_mapping_fixture_matches_fontdrasil() {
        let weight = Axis::with_id(
            AxisId::from_raw("weight"),
            "wght".to_string(),
            "Weight".to_string(),
            100.0,
            400.0,
            900.0,
        );
        let width = Axis::with_id(
            AxisId::from_raw("width"),
            "wdth".to_string(),
            "Width".to_string(),
            50.0,
            100.0,
            200.0,
        );
        let mut optical = Axis::with_id(
            AxisId::from_raw("optical"),
            "opsz".to_string(),
            "Optical size".to_string(),
            8.0,
            12.0,
            72.0,
        );
        optical.set_role(AxisRole::Internal);
        let axes = vec![weight.clone(), width.clone(), optical.clone()];
        let mappings = [
            AxisMapping::with_id(
                AxisMappingId::from_raw("weight"),
                "Weight curve".to_string(),
                vec![weight.id()],
                vec![weight.id()],
                vec![
                    point(&[(weight.id(), 100.0)], &[(weight.id(), 100.0)]),
                    point(&[(weight.id(), 400.0)], &[(weight.id(), 400.0)]),
                    point(&[(weight.id(), 900.0)], &[(weight.id(), 800.0)]),
                ],
            ),
            AxisMapping::with_id(
                AxisMappingId::from_raw("reversed"),
                "Reversed weight".to_string(),
                vec![weight.id()],
                vec![weight.id()],
                vec![
                    point(&[(weight.id(), 100.0)], &[(weight.id(), 900.0)]),
                    point(&[(weight.id(), 900.0)], &[(weight.id(), 100.0)]),
                ],
            ),
            AxisMapping::with_id(
                AxisMappingId::from_raw("optical"),
                "Optical compensation".to_string(),
                vec![weight.id(), width.id()],
                vec![optical.id()],
                vec![point(
                    &[(weight.id(), 800.0), (width.id(), 125.0)],
                    &[(optical.id(), 72.0)],
                )],
            ),
        ];
        let bases = mappings
            .iter()
            .map(|mapping| AxisMappingBasis::try_from((mapping, axes.as_slice())).unwrap())
            .collect::<Vec<_>>();
        let fixture = serde_json::json!({
            "axes": axes.iter().map(axis_fixture).collect::<Vec<_>>(),
            "bases": bases.iter().map(basis_fixture).collect::<Vec<_>>(),
            "cases": [
                {
                    "basisIds": [mappings[0].id().to_string()],
                    "location": { weight.id().to_string(): 650.0 },
                    "expected": { weight.id().to_string(): 600.0 },
                },
                {
                    "basisIds": [mappings[1].id().to_string()],
                    "location": { weight.id().to_string(): 250.0 },
                    "expected": { weight.id().to_string(): 650.0 },
                },
                {
                    "basisIds": [mappings[0].id().to_string(), mappings[2].id().to_string()],
                    "location": {
                        weight.id().to_string(): 900.0,
                        width.id().to_string(): 125.0,
                    },
                    "expected": {
                        weight.id().to_string(): 800.0,
                        optical.id().to_string(): 72.0,
                    },
                },
            ],
        });
        let generated = format!("{}\n", serde_json::to_string_pretty(&fixture).unwrap());
        if std::env::var_os("SHIFT_UPDATE_FIXTURES").is_some() {
            let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../packages/types/__fixtures__/axis_mapping_basis.json");
            std::fs::write(path, generated).unwrap();
            return;
        }

        assert_eq!(
            include_str!("../../../../packages/types/__fixtures__/axis_mapping_basis.json"),
            generated,
        );
    }

    #[test]
    fn one_sided_axes_merge_equivalent_normalized_mapping_points() {
        let axis = Axis::with_id(
            AxisId::from_raw("one-sided"),
            "wght".to_string(),
            "Weight".to_string(),
            300.0,
            300.0,
            800.0,
        );
        let mapping = AxisMapping::new(
            "Weight curve".to_string(),
            vec![axis.id()],
            vec![axis.id()],
            vec![
                point(&[(axis.id(), 300.0)], &[(axis.id(), 300.0)]),
                point(&[(axis.id(), 300.0)], &[(axis.id(), 300.0)]),
                point(&[(axis.id(), 800.0)], &[(axis.id(), 800.0)]),
            ],
        );

        let basis = AxisMappingBasis::try_from((&mapping, [axis].as_slice())).unwrap();

        assert_eq!(basis.basis().deltas().len(), 2);
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
        let external = external_location(&[(optical.id(), 40.0)]);

        let mapped = map_location(&external, &[optical.clone()], &[]).unwrap();

        assert_eq!(mapped.get(&optical.id()), Some(12.0));
    }

    fn axis_fixture(axis: &Axis) -> serde_json::Value {
        serde_json::json!({
            "id": axis.id().to_string(),
            "tag": axis.tag(),
            "name": axis.name(),
            "role": match axis.role() {
                AxisRole::External => "external",
                AxisRole::Internal => "internal",
            },
            "axisType": "continuous",
            "minimum": axis.minimum(),
            "default": axis.default(),
            "maximum": axis.maximum(),
            "labels": [],
            "hidden": false,
        })
    }

    fn basis_fixture(basis: &AxisMappingBasis) -> serde_json::Value {
        serde_json::json!({
            "mappingId": basis.mapping_id().to_string(),
            "inputAxisIds": basis
                .input_axis_ids()
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>(),
            "outputAxisIds": basis
                .output_axis_ids()
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>(),
            "basis": {
                "deltas": basis
                    .basis()
                    .deltas()
                    .iter()
                    .map(|delta| serde_json::json!({
                        "region": delta
                            .region()
                            .supports()
                            .iter()
                            .map(|support| serde_json::json!({
                                "axisId": support.axis_id().to_string(),
                                "lower": support.minimum(),
                                "peak": support.peak(),
                                "upper": support.maximum(),
                            }))
                            .collect::<Vec<_>>(),
                        "values": delta.values(),
                    }))
                    .collect::<Vec<_>>(),
            },
        })
    }

    fn point(input: &[(AxisId, f64)], output: &[(AxisId, f64)]) -> AxisMappingPoint {
        AxisMappingPoint {
            description: None,
            input: location(input),
            output: location(output),
        }
    }

    fn external_location(values: &[(AxisId, f64)]) -> ExternalLocation {
        ExternalLocation::from_untyped(location(values))
    }

    fn location(values: &[(AxisId, f64)]) -> Location {
        let mut location = Location::new();
        for (axis_id, value) in values {
            location.set(axis_id.clone(), *value);
        }
        location
    }
}
