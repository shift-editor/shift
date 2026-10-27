use crate::Require;
use std::collections::{HashMap, HashSet};
use std::str::FromStr;

use fontdrasil::{
    coords::{NormalizedCoord, NormalizedLocation},
    types::Tag,
    variations::{RoundingBehaviour, VariationModel},
};

use crate::{
    Axis, AxisId, AxisList, AxisMapping, AxisMappingId, AxisRole, CoreError, CoreResult,
    DesignLocation, ExternalLocation, Font, Location, VariationBasis,
};

/// One axis's design-space bounds used to normalize authored source locations.
///
/// These bounds are derived from compiled independent mappings, not from the
/// user-facing axis range or from the subset of masters belonging to a glyph.
#[derive(Clone, Debug, PartialEq)]
pub struct DesignNormalization {
    pub axis_id: AxisId,
    pub minimum: f64,
    pub default: f64,
    pub maximum: f64,
}

impl DesignNormalization {
    /// Normalizes a design coordinate around the mapped default without clamping.
    pub fn normalize(&self, value: f64) -> f64 {
        let tolerance = 1e-9 * (1.0 + self.default.abs());
        let range = if value < self.default {
            self.default - self.minimum
        } else {
            self.maximum - self.default
        };
        if range.abs() < tolerance || (value - self.default).abs() < tolerance {
            return 0.0;
        }

        snap((value - self.default) / range)
    }
}

/// Snaps a normalized coordinate to `0` or `±1` when it misses by rounding.
///
/// Mapped defaults and extremes are computed through compiled mapping bases,
/// so a master authored exactly at the default can normalize to `1e-15`. The
/// variation model treats only an exact `0` as the default location.
fn snap(normalized: f64) -> f64 {
    const TOLERANCE: f64 = 1e-9;
    for anchor in [-1.0, 0.0, 1.0] {
        if (normalized - anchor).abs() < TOLERANCE {
            return anchor;
        }
    }
    normalized
}

impl Font {
    /// Derives design-space normalization in authoring-axis order.
    ///
    /// Independent mappings define the numerical design extrema over each axis's
    /// authored range and its mapped default. Compiled support boundaries include
    /// reversed mappings and interior extrema. Unmapped and internal axes retain
    /// their authored bounds. Cross-axis
    /// mappings move locations within this design space; they do not redefine
    /// its normalization. The returned values are derived, never persisted.
    ///
    /// # Errors
    ///
    /// Returns an axis-mapping error when an authored mapping cannot compile.
    pub fn design_normalization(&self) -> CoreResult<Vec<DesignNormalization>> {
        let bases = self.axis_mapping_bases()?;
        self.axes()
            .iter()
            .map(|axis| {
                let mut values = vec![axis.minimum(), axis.default(), axis.maximum()];
                let mut default = axis.default();
                if let Some(basis) = bases
                    .iter()
                    .find(|basis| basis.is_independent() && basis.output_axis_ids[0] == axis.id())
                {
                    let location = Location::from([(axis.id(), default)]);
                    default = basis
                        .evaluate(&location, self.axes())?
                        .get(axis.id())
                        .unwrap_or(default);
                    for delta in basis.basis().deltas() {
                        for support in delta.region().supports() {
                            if support.axis_id() != axis.id() {
                                continue;
                            }
                            for boundary in [support.minimum(), support.peak(), support.maximum()] {
                                if (-1.0..=1.0).contains(&boundary) {
                                    values.push(axis.denormalize(boundary));
                                }
                            }
                        }
                    }
                    values.sort_by(f64::total_cmp);
                    values.dedup();
                    for value in &mut values {
                        let location = Location::from([(axis.id(), *value)]);
                        *value = basis
                            .evaluate(&location, self.axes())?
                            .get(axis.id())
                            .unwrap_or(*value);
                    }
                }

                Ok(DesignNormalization {
                    axis_id: axis.id(),
                    minimum: values.iter().copied().fold(default, f64::min),
                    default,
                    maximum: values.iter().copied().fold(default, f64::max),
                })
            })
            .collect()
    }
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
    /// Rebuilds a mapping basis compiled elsewhere, such as one the editor received.
    pub fn new(
        mapping_id: AxisMappingId,
        input_axis_ids: Vec<AxisId>,
        output_axis_ids: Vec<AxisId>,
        basis: VariationBasis,
    ) -> Self {
        Self {
            mapping_id,
            input_axis_ids,
            output_axis_ids,
            basis,
        }
    }

    /// Returns the authored mapping identity that produced this basis.
    pub fn mapping_id(&self) -> AxisMappingId {
        self.mapping_id
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

    /// Whether the mapping maps one axis onto itself.
    pub fn is_independent(&self) -> bool {
        self.input_axis_ids.len() == 1 && self.output_axis_ids == self.input_axis_ids
    }

    /// Maps a location through this basis, returning its output axes only.
    ///
    /// # Errors
    ///
    /// Returns [`crate::CoreError::AxisNotFound`] when an output or region axis
    /// is missing from `axes`.
    pub fn evaluate(&self, location: &Location, axes: &[Axis]) -> CoreResult<Location> {
        let adjustments = self.basis.evaluate(location, axes, None)?;
        let mut result = Location::new();

        for (axis_id, adjustment) in self.output_axis_ids.iter().zip(adjustments) {
            let axis = axes.axis(*axis_id).require(&axis_id)?;
            let base = location.value_on(axis);
            result.set(*axis_id, base + adjustment);
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
                    let base = point.input.value_on(axis);
                    let output = point.output.get(axis.id()).unwrap_or(base);
                    output - base
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

/// Maps `external` through `mappings` into a design-space location.
///
/// # Errors
///
/// Returns [`CoreError::InvalidAxisMapping`] when a mapping does not fit `axes`, and
/// [`CoreError::AxisNotFound`] when a mapping's output axis is missing.
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
///
/// # Errors
///
/// Returns [`CoreError::AxisNotFound`] when a basis's output or region axis is missing from `axes`.
pub fn map_location_with_bases(
    external: &ExternalLocation,
    axes: &[Axis],
    bases: &[AxisMappingBasis],
) -> CoreResult<DesignLocation> {
    let mut mapped = DesignLocation::new();
    for axis in axes {
        let value = match axis.role() {
            AxisRole::External => external.value_on(axis),
            AxisRole::Internal => axis.default(),
        };
        mapped.set(axis.id(), value);
    }

    for basis in bases.iter().filter(|basis| basis.is_independent()) {
        let outputs = basis.evaluate(external.as_untyped(), axes)?;
        for (axis_id, value) in outputs.iter() {
            mapped.set(*axis_id, *value);
        }
    }

    let independently_mapped = mapped.clone();
    for basis in bases.iter().filter(|basis| !basis.is_independent()) {
        let outputs = basis.evaluate(independently_mapped.as_untyped(), axes)?;
        for (axis_id, value) in outputs.iter() {
            mapped.set(*axis_id, *value);
        }
    }

    Ok(mapped)
}

/// The external location whose mapping through `bases` reaches `design`, on
/// the external axes alone: [`map_location_with_bases`] run backwards.
///
/// Independent mappings are piecewise linear, so their compiled support
/// boundaries give an exact inverse without the authored points: each
/// external axis takes the candidate that maps closest to its design value,
/// the first of equals in ascending order. A discrete axis's candidates are
/// its values; a continuous axis's are its bounds, its default and each
/// support boundary, with the points between neighbours that map exactly to
/// the target. An external axis no independent mapping outputs keeps its
/// design value. A design location that is not externally reachable keeps
/// its externally controlled values; the derived internal axes stay the
/// forward mapping's.
pub fn unmap_location_with_bases(
    design: &DesignLocation,
    axes: &[Axis],
    bases: &[AxisMappingBasis],
) -> ExternalLocation {
    axes.iter()
        .filter(|axis| axis.role() == AxisRole::External)
        .map(|axis| {
            let target = design.value_on(axis);
            let mapping = bases
                .iter()
                .find(|basis| basis.is_independent() && basis.output_axis_ids() == [axis.id()]);
            let value = mapping.map_or(target, |basis| basis.unmap_independent(axis, axes, target));
            (axis.id(), value)
        })
        .collect()
}

impl AxisMappingBasis {
    /// The value on `axis` that this independent mapping takes closest to `target`.
    fn unmap_independent(&self, axis: &Axis, axes: &[Axis], target: f64) -> f64 {
        let error = |value: f64| (self.map_one(axis, axes, value) - target).abs();
        self.inverse_candidates(axis, axes, target)
            .into_iter()
            .fold(None, |best: Option<(f64, f64)>, candidate| {
                let candidate_error = error(candidate);
                match best {
                    Some((_, best_error)) if best_error <= candidate_error => best,
                    _ => Some((candidate, candidate_error)),
                }
            })
            .map_or_else(|| axis.default(), |(value, _)| value)
    }

    /// Where `value` on `axis` maps to through this independent mapping;
    /// `value` itself when the mapping cannot evaluate it.
    fn map_one(&self, axis: &Axis, axes: &[Axis], value: f64) -> f64 {
        self.evaluate(&Location::from([(axis.id(), value)]), axes)
            .ok()
            .and_then(|mapped| mapped.get(axis.id()))
            .unwrap_or(value)
    }

    /// The values on `axis` the inverse chooses among, ascending.
    fn inverse_candidates(&self, axis: &Axis, axes: &[Axis], target: f64) -> Vec<f64> {
        if let Some(values) = axis.discrete_values().filter(|values| !values.is_empty()) {
            let mut sorted = values.to_vec();
            sorted.sort_by(f64::total_cmp);
            return sorted;
        }

        let supports = self
            .basis()
            .deltas()
            .iter()
            .flat_map(|delta| delta.region().supports())
            .filter(|support| support.axis_id() == axis.id())
            .flat_map(|support| [support.minimum(), support.peak(), support.maximum()])
            .map(|normalized| axis.denormalize(normalized));
        let mut breakpoints: Vec<f64> = [axis.minimum(), axis.default(), axis.maximum()]
            .into_iter()
            .chain(supports)
            .collect();
        breakpoints.sort_by(f64::total_cmp);
        breakpoints.dedup();

        let mut candidates = breakpoints.clone();
        for pair in breakpoints.windows(2) {
            let (left, right) = (pair[0], pair[1]);
            let left_mapped = self.map_one(axis, axes, left);
            let mapped_range = self.map_one(axis, axes, right) - left_mapped;
            if mapped_range.abs() < f64::EPSILON {
                continue;
            }
            let ratio = (target - left_mapped) / mapped_range;
            if ratio > 0.0 && ratio < 1.0 {
                candidates.push(left + ratio * (right - left));
            }
        }
        candidates.sort_by(f64::total_cmp);
        candidates
    }
}

fn resolve_axes<'a>(
    ids: &[AxisId],
    axes: &'a [Axis],
    mapping: &AxisMapping,
) -> CoreResult<Vec<&'a Axis>> {
    ids.iter()
        .map(|axis_id| {
            axes.axis(*axis_id)
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
            let value = location.value_on(axis);
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
    fn design_normalization_uses_compiled_extrema_for_reversed_and_nonmonotonic_mappings() {
        for (points, minimum, default, maximum) in [
            (
                vec![(100.0, 900.0), (400.0, 400.0), (900.0, 100.0)],
                100.0,
                400.0,
                900.0,
            ),
            (
                vec![(100.0, 30.0), (400.0, 86.0), (700.0, 180.0), (900.0, 160.0)],
                30.0,
                86.0,
                180.0,
            ),
        ] {
            let mut font = Font::empty();
            let axis = Axis::weight();
            font.add_axis(axis.clone()).unwrap();
            font.set_axis_mappings(vec![AxisMapping::new(
                "Weight mapping".to_string(),
                vec![axis.id()],
                vec![axis.id()],
                points
                    .into_iter()
                    .map(|(input, output)| point(&[(axis.id(), input)], &[(axis.id(), output)]))
                    .collect(),
            )])
            .unwrap();
            let normalization = font.design_normalization().unwrap();
            assert!((normalization[0].minimum - minimum).abs() < 1e-9);
            assert!((normalization[0].default - default).abs() < 1e-9);
            assert!((normalization[0].maximum - maximum).abs() < 1e-9);
            assert!((normalization[0].normalize(minimum) + 1.0).abs() < 1e-9);
            assert!(normalization[0].normalize(default).abs() < 1e-9);
            assert!((normalization[0].normalize(maximum) - 1.0).abs() < 1e-9);
        }
    }

    #[test]
    fn design_normalization_keeps_unmapped_and_internal_axis_bounds() {
        let mut font = Font::empty();
        let weight = Axis::weight();
        let mut width = Axis::width();
        width.set_role(AxisRole::Internal);
        font.add_axis(weight.clone()).unwrap();
        font.add_axis(width.clone()).unwrap();
        let normalization = font.design_normalization().unwrap();
        for (axis, normalization) in [weight, width].iter().zip(normalization) {
            assert_eq!(normalization.axis_id, axis.id());
            assert_eq!(normalization.minimum, axis.minimum());
            assert_eq!(normalization.default, axis.default());
            assert_eq!(normalization.maximum, axis.maximum());
        }
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
    fn unmapping_recovers_the_external_controls_a_mapping_took() {
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
        let mappings = [
            AxisMapping::new(
                "Weight curve".to_string(),
                vec![weight.id()],
                vec![weight.id()],
                vec![
                    point(&[(weight.id(), 100.0)], &[(weight.id(), 100.0)]),
                    point(&[(weight.id(), 400.0)], &[(weight.id(), 400.0)]),
                    point(&[(weight.id(), 700.0)], &[(weight.id(), 520.0)]),
                    point(&[(weight.id(), 900.0)], &[(weight.id(), 800.0)]),
                ],
            ),
            AxisMapping::new(
                "Optical compensation".to_string(),
                vec![weight.id(), width.id()],
                vec![optical.id()],
                vec![point(
                    &[(weight.id(), 800.0), (width.id(), 125.0)],
                    &[(optical.id(), 72.0)],
                )],
            ),
        ];
        let bases: Vec<AxisMappingBasis> = mappings
            .iter()
            .map(|mapping| AxisMappingBasis::try_from((mapping, axes.as_slice())).unwrap())
            .collect();

        for (controlled_weight, controlled_width) in [
            (100.0, 75.0),
            (250.0, 100.0),
            (650.0, 110.0),
            (900.0, 125.0),
        ] {
            let external = external_location(&[
                (weight.id(), controlled_weight),
                (width.id(), controlled_width),
            ]);
            let design = map_location_with_bases(&external, &axes, &bases).unwrap();

            let recovered = unmap_location_with_bases(&design, &axes, &bases);

            assert!((recovered.value_on(&weight) - controlled_weight).abs() < 1e-9);
            assert!((recovered.value_on(&width) - controlled_width).abs() < 1e-9);
            assert_eq!(recovered.get(&optical.id()), None);
        }
    }

    #[test]
    fn an_axis_no_mapping_outputs_keeps_its_design_value() {
        let mut axis = Axis::discrete_with_id(
            AxisId::from_raw("ital"),
            "ital".to_string(),
            "Italic".to_string(),
            vec![0.0, 1.0],
            0.0,
        );
        axis.set_role(AxisRole::External);
        let design = DesignLocation::from([(axis.id(), 0.8)]);

        let recovered = unmap_location_with_bases(&design, std::slice::from_ref(&axis), &[]);

        assert_eq!(recovered.get(&axis.id()), Some(0.8));
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
        let location: Location = values
            .iter()
            .map(|(axis_id, value)| (*axis_id, *value))
            .collect();
        location
    }
}
