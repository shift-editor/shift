use crate::length::OrOverflow;
use std::collections::HashMap;

use shift_font::piecewise_map;

use crate::SlugError;
use shift_font::AxisRange;

#[derive(Clone, Debug, PartialEq)]
pub struct AtlasAxis {
    user_mapping: Box<[(f64, f64)]>,
    range: AxisRange,
    normalized_mapping: Box<[(i16, i16)]>,
}

impl AtlasAxis {
    /// Makes an axis whose design coordinates normalize over `range`.
    pub fn new(
        user_mapping: Vec<(f64, f64)>,
        range: AxisRange,
        normalized_mapping: Vec<(i16, i16)>,
    ) -> Self {
        Self {
            user_mapping: user_mapping.into_boxed_slice(),
            range,
            normalized_mapping: normalized_mapping.into_boxed_slice(),
        }
    }

    fn normalize(&self, value: f64, axis_index: usize) -> Result<i16, SlugError> {
        if !value.is_finite() {
            return Err(SlugError::NonFiniteRetainedCoordinate { axis_index });
        }
        self.normalize_design(piecewise_map(value, &self.user_mapping), axis_index)
    }

    /// Normalizes a design-space `value` to this axis's F2Dot14 coordinate.
    ///
    /// # Errors
    ///
    /// Returns [`SlugError::NonFiniteRetainedCoordinate`] when `value` is not finite.
    pub fn normalize_design(&self, value: f64, axis_index: usize) -> Result<i16, SlugError> {
        if !value.is_finite() {
            return Err(SlugError::NonFiniteRetainedCoordinate { axis_index });
        }
        Ok(apply_mapping(
            quantize_f2dot14(self.range.normalize(value)),
            &self.normalized_mapping,
        ))
    }
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct AtlasRegion {
    axes: Box<[RegionAxis]>,
}

impl AtlasRegion {
    pub fn new(axes: Vec<RegionAxis>) -> Self {
        Self {
            axes: axes.into_boxed_slice(),
        }
    }

    pub fn axes(&self) -> &[RegionAxis] {
        &self.axes
    }

    /// Returns this region's scalar at normalized `coordinates`.
    ///
    /// # Errors
    ///
    /// Returns [`SlugError::RetainedRegionAxisCountMismatch`] when `coordinates` does not have one
    /// value per region axis.
    pub fn scalar(&self, coordinates: &[i16]) -> Result<f32, SlugError> {
        if self.axes.len() != coordinates.len() {
            return Err(SlugError::RetainedRegionAxisCountMismatch {
                expected: self.axes.len(),
                actual: coordinates.len(),
            });
        }
        let mut scalar = 1.0_f32;
        for (axis, coordinate) in self.axes.iter().zip(coordinates) {
            let start = i32::from(axis.start);
            let peak = i32::from(axis.peak);
            let end = i32::from(axis.end);
            let coordinate = i32::from(*coordinate);
            if peak == 0 || peak == coordinate {
                continue;
            }
            if start > peak || peak > end || (start < 0 && end > 0) {
                continue;
            }
            if coordinate < start || coordinate > end {
                return Ok(0.0);
            }
            if coordinate < peak {
                if peak != start {
                    scalar *= (coordinate - start) as f32 / (peak - start) as f32;
                }
            } else if peak != end {
                scalar *= (end - coordinate) as f32 / (end - peak) as f32;
            }
        }
        Ok(scalar)
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct RegionAxis {
    pub start: i16,
    pub peak: i16,
    pub end: i16,
}

#[derive(Debug, Default)]
pub struct RegionRegistry {
    regions: Vec<AtlasRegion>,
    indices: HashMap<AtlasRegion, u32>,
}

impl RegionRegistry {
    /// Returns the weight slot for `region`, registering it on first use.
    ///
    /// # Errors
    ///
    /// Returns [`SlugError::LengthOverflow`] when the slot index overflows `u32`.
    pub fn weight_index(&mut self, region: AtlasRegion) -> Result<u32, SlugError> {
        if let Some(index) = self.indices.get(&region) {
            return Ok(*index);
        }
        let index = u32::try_from(self.regions.len())
            .or_overflow()?
            .checked_add(1)
            .or_overflow()?;
        self.regions.push(region.clone());
        self.indices.insert(region, index);
        Ok(index)
    }

    pub fn len(&self) -> usize {
        self.regions.len()
    }

    pub fn is_empty(&self) -> bool {
        self.regions.is_empty()
    }

    pub fn regions(&self) -> &[AtlasRegion] {
        &self.regions
    }

    pub fn into_regions(self) -> Vec<AtlasRegion> {
        self.regions
    }
}

pub struct ComplementRegistry {
    start: u32,
    indices: HashMap<Vec<u32>, u32>,
    complements: Vec<Box<[u32]>>,
}

impl ComplementRegistry {
    /// Starts complement slots after `region_count` region slots.
    ///
    /// # Errors
    ///
    /// Returns [`SlugError::LengthOverflow`] when the first slot index overflows `u32`.
    pub fn new(region_count: usize) -> Result<Self, SlugError> {
        let start = u32::try_from(region_count)
            .or_overflow()?
            .checked_add(1)
            .or_overflow()?;
        Ok(Self {
            start,
            indices: HashMap::new(),
            complements: Vec::new(),
        })
    }

    /// Returns the slot of one minus the sum of `source_weights`, registering it on first use.
    ///
    /// # Errors
    ///
    /// Returns [`SlugError::LengthOverflow`] when the slot index overflows `u32`.
    pub fn weight_index(&mut self, source_weights: &[u32]) -> Result<u32, SlugError> {
        if source_weights.is_empty() {
            return Ok(0);
        }
        if let Some(weight) = self.indices.get(source_weights) {
            return Ok(*weight);
        }
        let weight = self
            .start
            .checked_add(u32::try_from(self.complements.len()).or_overflow()?)
            .or_overflow()?;
        self.complements
            .push(source_weights.to_vec().into_boxed_slice());
        self.indices.insert(source_weights.to_vec(), weight);
        Ok(weight)
    }

    pub fn into_complements(self) -> Vec<Box<[u32]>> {
        self.complements
    }
}

pub(super) fn weights(
    axes: &[AtlasAxis],
    regions: &[AtlasRegion],
    complements: &[Box<[u32]>],
    location: &[f64],
) -> Result<Vec<f32>, SlugError> {
    weights_with(axes, regions, complements, location, AtlasAxis::normalize)
}

pub(super) fn design_weights(
    axes: &[AtlasAxis],
    regions: &[AtlasRegion],
    complements: &[Box<[u32]>],
    location: &[f64],
) -> Result<Vec<f32>, SlugError> {
    weights_with(
        axes,
        regions,
        complements,
        location,
        AtlasAxis::normalize_design,
    )
}

fn weights_with(
    axes: &[AtlasAxis],
    regions: &[AtlasRegion],
    complements: &[Box<[u32]>],
    location: &[f64],
    normalize: impl Fn(&AtlasAxis, f64, usize) -> Result<i16, SlugError>,
) -> Result<Vec<f32>, SlugError> {
    if location.len() != axes.len() {
        return Err(SlugError::RetainedLocationAxisCountMismatch {
            expected: axes.len(),
            actual: location.len(),
        });
    }

    let coordinates = axes
        .iter()
        .zip(location)
        .enumerate()
        .map(|(axis_index, (axis, value))| normalize(axis, *value, axis_index))
        .collect::<Result<Vec<_>, _>>()?;
    let mut weights = Vec::with_capacity(
        1_usize
            .checked_add(regions.len())
            .and_then(|length| length.checked_add(complements.len()))
            .or_overflow()?,
    );
    weights.push(1.0);
    for region in regions {
        weights.push(region.scalar(&coordinates)?);
    }
    for complement in complements {
        let region_sum = complement.iter().try_fold(0.0_f32, |sum, index| {
            let weight = weights
                .get(*index as usize)
                .ok_or(SlugError::VariableWeightIndexOutOfRange(*index))?;
            Ok::<_, SlugError>(sum + weight)
        })?;
        weights.push(1.0 - region_sum);
    }
    Ok(weights)
}

fn apply_mapping(coordinate: i16, mapping: &[(i16, i16)]) -> i16 {
    let Some(position) = mapping.iter().position(|(source, _)| *source >= coordinate) else {
        return coordinate;
    };
    let (source, target) = mapping[position];
    if source == coordinate {
        return target;
    }
    let Some(&(previous_source, previous_target)) = position
        .checked_sub(1)
        .and_then(|previous| mapping.get(previous))
    else {
        return coordinate;
    };
    if source == previous_source {
        return previous_target;
    }
    let fraction = f64::from(i32::from(coordinate) - i32::from(previous_source))
        / f64::from(i32::from(source) - i32::from(previous_source));
    let mapped = f64::from(previous_target)
        + f64::from(i32::from(target) - i32::from(previous_target)) * fraction;
    quantize_f2dot14(mapped / 16384.0)
}

#[expect(
    clippy::cast_possible_truncation,
    reason = "clamped to the i16 range first"
)]
fn quantize_f2dot14(value: f64) -> i16 {
    (value * 16384.0)
        .round()
        .clamp(f64::from(i16::MIN), f64::from(i16::MAX)) as i16
}
