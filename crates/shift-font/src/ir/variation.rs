use crate::Require;
use std::collections::{HashMap, HashSet};
use std::str::FromStr;

use fontdrasil::{
    coords::{CoordConverter, DesignCoord, NormalizedCoord, NormalizedLocation, UserCoord},
    types::Tag,
    variations::{RoundingBehaviour, VariationModel},
};

use crate::{
    Axis, AxisId, AxisList, AxisMapping, AxisMappingId, AxisRole, CoreError, CoreResult,
    DesignLocation, ExternalLocation, Font, Location, VariationBasis,
};

/// An axis's minimum, default and maximum in one coordinate space, and the
/// rule that maps a coordinate in that space to `-1..=1`.
///
/// The space is the caller's: user coordinates for an axis's authored range,
/// design coordinates for [`DesignNormalization`].
///
/// `minimum` is the value that normalizes to `-1` and `maximum` the one that
/// normalizes to `1`. In user space `minimum <= default <= maximum`; a design
/// range under a decreasing axis mapping runs the other way, `minimum` above
/// `maximum`, because normalized signs follow the user axis.
#[derive(Clone, Copy, Debug, PartialEq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct AxisRange {
    pub minimum: f64,
    pub default: f64,
    pub maximum: f64,
}

impl AxisRange {
    /// Maps `value` to `-1..=1` through fontdrasil's `CoordConverter`, as
    /// fontc normalizes: the default to `0`, the minimum to `-1` and the
    /// maximum to `1`, linearly on each side; outside the range a value keeps
    /// its distance from the nearest end, as fontTools extrapolates.
    ///
    /// A value within a relative `1e-9` of the default maps to exactly `0`,
    /// and a result within `1e-9` of `-1`, `0` or `1` snaps to it, because
    /// mapped anchors carry rounding error and the variation model only
    /// recognises an exact default. A range fontdrasil rejects, whose minimum
    /// and maximum share one value away from the default, normalizes
    /// everything to `0`; compiling such a font fails in fontc.
    ///
    /// Builds fontdrasil's converter on each call; a caller that normalizes
    /// many values through one range keeps a [`DesignNormalization`], which
    /// builds it once.
    pub fn normalize(&self, value: f64) -> f64 {
        self.normalize_through(self.converter().as_ref(), value)
    }

    /// [`Self::normalize`] through `converter`, this range's own.
    fn normalize_through(&self, converter: Option<&CoordConverter>, value: f64) -> f64 {
        let tolerance = 1e-9 * (1.0 + self.default.abs());
        if (value - self.default).abs() < tolerance {
            return 0.0;
        }
        let Some(converter) = converter else {
            return 0.0;
        };
        snap(DesignCoord::new(value).to_normalized(converter).to_f64())
    }

    /// The lowest and highest value the range spans, whichever way it runs:
    /// what a range check compares against.
    pub fn bounds(&self) -> RangeBounds {
        RangeBounds {
            lowest: self.minimum.min(self.maximum),
            highest: self.minimum.max(self.maximum),
        }
    }

    /// Maps a normalized `value` back into the range's space through
    /// fontdrasil's `CoordConverter`: the inverse of [`Self::normalize`] on a
    /// side with extent.
    pub fn denormalize(&self, value: f64) -> f64 {
        let Some(converter) = self.converter() else {
            return self.default;
        };
        NormalizedCoord::new(value).to_design(&converter).to_f64()
    }

    /// fontdrasil's converter for this range: the minimum, default and
    /// maximum as the design values at user `-1`, `0` and `1`, so normalized
    /// signs follow the range's own direction even when it runs backwards.
    /// A side with no extent is left out, as fontdrasil leaves it out.
    ///
    /// Returns `None` for a range fontdrasil rejects.
    fn converter(&self) -> Option<CoordConverter> {
        let mut mappings = Vec::with_capacity(3);
        if self.minimum != self.default {
            mappings.push((UserCoord::new(-1.0), DesignCoord::new(self.minimum)));
        }
        let default_index = mappings.len();
        mappings.push((UserCoord::new(0.0), DesignCoord::new(self.default)));
        if self.maximum != self.default {
            mappings.push((UserCoord::new(1.0), DesignCoord::new(self.maximum)));
        }
        CoordConverter::new(mappings, default_index).ok()
    }
}

/// The lowest and highest value an [`AxisRange`] spans, in either direction.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RangeBounds {
    pub lowest: f64,
    pub highest: f64,
}

/// One axis's design-space bounds used to normalize authored source locations.
///
/// These bounds are derived from compiled independent mappings, not from the
/// user-facing axis range or from the subset of masters belonging to a glyph.
#[derive(Clone, Debug, PartialEq)]
pub struct DesignNormalization {
    axis_id: AxisId,
    range: AxisRange,
    /// fontdrasil's converter for `range`, built once: region evaluation
    /// normalizes through it for every support it weighs.
    converter: Option<CoordConverter>,
}

impl DesignNormalization {
    /// The axis this normalization is for.
    pub fn axis_id(&self) -> AxisId {
        self.axis_id
    }

    /// The axis's design anchors: the design values at its user minimum,
    /// default and maximum.
    pub fn range(&self) -> AxisRange {
        self.range
    }

    /// `axis_id`'s normalization over `range`.
    pub fn new(axis_id: AxisId, range: AxisRange) -> Self {
        Self {
            axis_id,
            range,
            converter: range.converter(),
        }
    }

    /// Normalizes a design coordinate around the mapped default without
    /// clamping; see [`AxisRange::normalize`].
    pub fn normalize(&self, value: f64) -> f64 {
        self.range.normalize_through(self.converter.as_ref(), value)
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
    /// As fontdrasil's `CoordConverter` normalizes, an independently mapped
    /// axis normalizes to `-1` at the design value of its user minimum, `0` at
    /// its mapped default and `1` at the design value of its user maximum:
    /// normalized signs follow the user axis, even when the mapping makes
    /// design values decrease. Unmapped and internal axes keep their authored
    /// bounds. Cross-axis mappings move locations within this design space;
    /// they do not redefine its normalization. The returned values are
    /// derived, never persisted.
    ///
    /// # Errors
    ///
    /// Returns an axis-mapping error when an authored mapping cannot compile.
    pub fn design_normalization(&self) -> CoreResult<Vec<DesignNormalization>> {
        let bases = self.axis_mapping_bases()?;
        self.axes()
            .iter()
            .map(|axis| {
                let user = axis.kind().range();
                let Some(basis) = bases
                    .iter()
                    .find(|basis| basis.is_independent() && basis.output_axis_ids[0] == axis.id())
                else {
                    return Ok(DesignNormalization::new(axis.id(), user));
                };
                let design = |value: f64| -> CoreResult<f64> {
                    let location = Location::from([(axis.id(), value)]);
                    Ok(basis
                        .evaluate(&location, self.axes())?
                        .get(axis.id())
                        .unwrap_or(value))
                };
                Ok(DesignNormalization::new(
                    axis.id(),
                    AxisRange {
                        minimum: design(user.minimum)?,
                        default: design(user.default)?,
                        maximum: design(user.maximum)?,
                    },
                ))
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
        let input_axes = mapping.resolve_axes(mapping.inputs(), axes)?;
        let output_axes = mapping.resolve_axes(mapping.outputs(), axes)?;
        let tagged_axes = input_axes
            .iter()
            .map(|axis| Ok((mapping.axis_tag(axis)?, axis.id())))
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
                    return Err(
                        mapping.invalid("normalized mapping point inputs have conflicting outputs")
                    );
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
            .map_err(|error| mapping.invalid(error.to_string()))?;

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

impl AxisMapping {
    /// The axes `ids` name, in order.
    fn resolve_axes<'a>(&self, ids: &[AxisId], axes: &'a [Axis]) -> CoreResult<Vec<&'a Axis>> {
        ids.iter()
            .map(|axis_id| {
                axes.axis(*axis_id)
                    .ok_or_else(|| self.invalid(format!("unknown axis {axis_id}")))
            })
            .collect()
    }

    /// The OpenType tag of input `axis`.
    fn axis_tag(&self, axis: &Axis) -> CoreResult<Tag> {
        Tag::from_str(axis.tag()).map_err(|_| {
            self.invalid(format!(
                "axis {} has invalid tag {:?}",
                axis.id(),
                axis.tag()
            ))
        })
    }
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

#[cfg(test)]
mod tests;
