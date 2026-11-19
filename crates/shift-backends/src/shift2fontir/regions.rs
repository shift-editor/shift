//! Regions of the font's axes as `GSUB` conditions read them.
//!
//! A `FeatureVariations` condition and the coordinates a shaper tests it
//! against are both F2Dot14 normalized values, so a condition can only tell
//! apart the 32769 values `-1..=1` of that lattice on each axis. A
//! [`Region`] is an inclusive box on it, and [`Region::partition`] cuts the axes
//! into disjoint regions that every given box either contains or misses.
//! On the lattice "above 700" is exact: it is "from the next value up", so
//! the difference of two boxes is again a union of boxes and no two regions
//! share a boundary.
//!
//! Disjoint regions matter because fontc 2.0.1 writes the
//! `FeatureVariationRecord`s of one table in no fixed order (fea-rs keeps
//! them in a `HashMap`). A shaper uses the first record whose conditions
//! hold, so records whose regions overlap could pick either; records over
//! disjoint regions can't disagree.

use std::str::FromStr;

use fontdrasil::coords::{DesignCoord, NormalizedCoord};
use fontdrasil::types::{Axis as IrAxis, Tag};
use fontir::ir::{Condition as IrCondition, ConditionSet};
use shift_font::{Axis, AxisId, Condition};
use write_fonts::types::F2Dot14;

/// The most regions [`Region::partition`] cuts the axes into before giving up.
pub(super) const MAX_REGIONS: usize = 4096;

/// One font axis on the lattice.
#[derive(Debug)]
struct LatticeAxis {
    id: AxisId,
    ir_axis: IrAxis,
    /// The axis's design range, lowest value first.
    design: (f64, f64),
    /// The normalized range on the lattice, lowest value first.
    range: (i32, i32),
}

/// The font's axes as F2Dot14 normalized values.
#[derive(Debug, Default)]
pub(crate) struct Lattice {
    axes: Vec<LatticeAxis>,
}

/// An inclusive box on the [`Lattice`]: one range of F2Dot14 values per
/// font axis, in the font's axis order.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub(super) struct Region(Vec<(i32, i32)>);

impl Lattice {
    /// The lattice of `axes`, normalized through `ir_axes` as the compiled
    /// font normalizes them (the axis mappings included). An axis without
    /// a compiled counterpart is left out.
    pub(crate) fn new(axes: &[Axis], ir_axes: &[IrAxis]) -> Self {
        let axes = axes
            .iter()
            .filter_map(|axis| {
                let tag = Tag::from_str(axis.tag()).ok()?;
                let ir_axis = ir_axes.iter().find(|ir_axis| ir_axis.tag == tag)?.clone();
                let ends = [ir_axis.min, ir_axis.max]
                    .map(|user| user.to_design(&ir_axis.converter).to_f64());
                let design = (ends[0].min(ends[1]), ends[0].max(ends[1]));
                let bits = |value: f64| lattice_value(&ir_axis, value);
                let ends = [bits(design.0), bits(design.1)];
                Some(LatticeAxis {
                    id: axis.id(),
                    design,
                    range: (ends[0].min(ends[1]), ends[0].max(ends[1])),
                    ir_axis,
                })
            })
            .collect();
        Self { axes }
    }

    /// Every location on the axes.
    pub(super) fn everywhere(&self) -> Region {
        Region(self.axes.iter().map(|axis| axis.range).collect())
    }

    /// Where `condition` holds, or `None` where it holds nowhere. Each
    /// range normalizes like a source location; a range on an axis the
    /// lattice lacks holds nowhere, as [`Condition::holds_at`] reads one.
    pub(super) fn region(&self, condition: &Condition) -> Option<Region> {
        let mut region = self.everywhere();
        let mut placed = 0;
        for (axis, (low, high)) in self.axes.iter().zip(region.0.iter_mut()) {
            for range in condition
                .ranges()
                .iter()
                .filter(|range| range.axis_id == axis.id)
            {
                placed += 1;
                let min = range.min.unwrap_or(axis.design.0);
                let max = range.max.unwrap_or(axis.design.1);
                if min > axis.design.1 || max < axis.design.0 {
                    return None;
                }
                let ends = [
                    normalized(&axis.ir_axis, min.max(axis.design.0)),
                    normalized(&axis.ir_axis, max.min(axis.design.1)),
                ];
                *low = (*low).max(lattice_floor(ends[0].min(ends[1])));
                *high = (*high).min(lattice_ceil(ends[0].max(ends[1])));
                if low > high {
                    return None;
                }
            }
        }
        // A range on an axis the lattice lacks holds nowhere.
        (placed == condition.ranges().len()).then_some(region)
    }

    /// `condition`'s ranges as fontir's conditions, in the design units they
    /// were authored in and in axis order, leaving out ranges open on both
    /// sides and ranges on an axis the lattice lacks.
    pub(super) fn authored_condition_set(&self, condition: &Condition) -> ConditionSet {
        self.axes
            .iter()
            .flat_map(|axis| {
                condition
                    .ranges()
                    .iter()
                    .filter(move |range| range.axis_id == axis.id)
                    .filter(|range| range.min.is_some() || range.max.is_some())
                    .map(|range| {
                        IrCondition::new(
                            axis.ir_axis.tag,
                            range.min.map(DesignCoord::new),
                            range.max.map(DesignCoord::new),
                        )
                    })
            })
            .collect()
    }

    /// `region` as fontir's conditions, in design units, leaving out each
    /// axis it covers whole. The design values normalize back to the
    /// region's lattice values exactly.
    pub(super) fn condition_set(&self, region: &Region) -> ConditionSet {
        self.axes
            .iter()
            .zip(&region.0)
            .filter(|(axis, range)| axis.range != **range)
            .map(|(axis, (low, high))| {
                let design = |bits: i32| {
                    NormalizedCoord::new(f64::from(bits) / 16384.0)
                        .to_design(&axis.ir_axis.converter)
                };
                let (low, high) = (design(*low), design(*high));
                let (min, max) = (low.min(high), low.max(high));
                IrCondition::new(axis.ir_axis.tag, Some(min), Some(max))
            })
            .collect()
    }
}

/// `value`, in `axis`'s design units, normalized as the compiled font
/// normalizes it.
fn normalized(axis: &IrAxis, value: f64) -> f64 {
    DesignCoord::new(value)
        .to_normalized(&axis.converter)
        .to_f64()
}

/// `value`, in `axis`'s design units, as the F2Dot14 value it rounds to.
fn lattice_value(axis: &IrAxis, value: f64) -> i32 {
    i32::from(F2Dot14::from_f64(normalized(axis, value)).to_bits())
}

/// How far a normalized value may lie from a lattice value and still count
/// as on it, so float error in normalization doesn't move a bound.
const ON_LATTICE: f64 = 1e-6;

/// The lattice value at or below `normalized`.
///
/// Shapers don't agree on how a user value between two lattice values
/// rounds: HarfBuzz rounds the float to the nearest, HarfRust and skrifa
/// round through 16.16 fixed point, and the two differ by one where the
/// value is near a half. A condition's lower bound rounds down and its
/// upper bound up, so a location exactly on the bound holds in either. A
/// value less than one lattice step (1/16384 of the axis's half range)
/// outside the bound may hold too.
fn lattice_floor(normalized: f64) -> i32 {
    lattice_rounded((normalized * 16384.0 + ON_LATTICE).floor())
}

/// The lattice value at or above `normalized`; see [`lattice_floor`].
fn lattice_ceil(normalized: f64) -> i32 {
    lattice_rounded((normalized * 16384.0 - ON_LATTICE).ceil())
}

#[expect(
    clippy::cast_possible_truncation,
    reason = "the value is whole and clamped to the F2Dot14 range"
)]
fn lattice_rounded(whole: f64) -> i32 {
    whole.clamp(-32768.0, 32767.0) as i32
}

impl Region {
    /// Whether every location in `other` lies in this region.
    pub(super) fn contains(&self, other: &Self) -> bool {
        self.0
            .iter()
            .zip(&other.0)
            .all(|((low, high), (other_low, other_high))| low <= other_low && other_high <= high)
    }

    /// The locations in both regions, or `None` when they share none.
    pub(super) fn intersection(&self, other: &Self) -> Option<Self> {
        self.0
            .iter()
            .zip(&other.0)
            .map(|((low, high), (other_low, other_high))| {
                let range = (*low.max(other_low), *high.min(other_high));
                (range.0 <= range.1).then_some(range)
            })
            .collect::<Option<Vec<_>>>()
            .map(Self)
    }

    /// Cuts the region by `by`: the part inside `by` and the parts outside
    /// it, all disjoint, or the region itself when `by` contains or misses
    /// it whole.
    fn split(&self, by: &Self) -> Vec<Self> {
        let Some(inside) = self.intersection(by) else {
            return vec![self.clone()];
        };
        if inside == *self {
            return vec![inside];
        }
        let mut parts = vec![inside];
        let mut rest = self.clone();
        for (index, (low, high)) in by.0.iter().enumerate() {
            let Some(&(rest_low, rest_high)) = rest.0.get(index) else {
                continue;
            };
            if rest_low < *low {
                parts.push(rest.with_range(index, (rest_low, low - 1)));
                rest = rest.with_range(index, (*low, rest_high));
            }
            if rest_high > *high {
                parts.push(rest.with_range(index, (high + 1, rest_high)));
                rest = rest.with_range(index, (rest_low.max(*low), *high));
            }
        }
        parts
    }

    /// The region with its range on the axis at `index` replaced.
    fn with_range(&self, index: usize, range: (i32, i32)) -> Self {
        Self(
            self.0
                .iter()
                .enumerate()
                .map(|(at, own)| if at == index { range } else { *own })
                .collect(),
        )
    }

    /// The regions cut from this one by `boxes`: disjoint, covering it,
    /// each inside or outside every box whole. `None` when that takes more
    /// than [`MAX_REGIONS`].
    pub(super) fn partition<'a>(
        self,
        boxes: impl IntoIterator<Item = &'a Self>,
    ) -> Option<Vec<Self>> {
        let mut regions = vec![self];
        for by in boxes {
            regions = regions.iter().flat_map(|region| region.split(by)).collect();
            if regions.len() > MAX_REGIONS {
                return None;
            }
        }
        Some(regions)
    }
}
