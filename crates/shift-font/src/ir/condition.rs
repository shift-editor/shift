//! Conditions: where in a design space something applies.
//!
//! A [`Condition`] is a conjunction of [`ConditionRange`]s, each an
//! inclusive range on one axis, open on either side. It holds at a location
//! when every range does; an empty condition always holds. Values are in
//! each axis's own design units, the units of source locations, layer
//! coordinates and component locations. A location that doesn't name an
//! axis is at that axis's default.
//!
//! An axis is a font axis or a glyph axis, by its [`AxisId`]: the two share
//! one namespace, so no reference type is needed to tell them apart.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::axis::{Axis, AxisList, DesignLocation};
use crate::entity::AxisId;
use crate::error::{CoreError, CoreResult};

/// An inclusive range on one axis, in that axis's design units. `None` on a
/// side leaves the range open there.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
#[serde(rename_all = "camelCase")]
pub struct ConditionRange {
    // Read under its earlier snake_case name too, as it was first written.
    #[serde(alias = "axis_id")]
    pub axis_id: AxisId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
}

impl ConditionRange {
    /// The range `min..=max` on `axis_id`.
    pub fn new(axis_id: AxisId, min: Option<f64>, max: Option<f64>) -> Self {
        Self { axis_id, min, max }
    }

    /// Whether `value` lies in the range, its ends included.
    pub fn contains(&self, value: f64) -> bool {
        self.min.is_none_or(|min| value >= min) && self.max.is_none_or(|max| value <= max)
    }

    /// Checks the range on its own; see [`Condition::check_well_formed`].
    fn check_well_formed(&self) -> CoreResult<()> {
        let ends = [self.min, self.max];
        if ends.into_iter().flatten().any(|value| !value.is_finite()) {
            return Err(CoreError::ConditionValueNotFinite {
                axis_id: self.axis_id,
            });
        }
        if let (Some(min), Some(max)) = (self.min, self.max)
            && min > max
        {
            return Err(CoreError::ConditionRangeReversed {
                axis_id: self.axis_id,
                min,
                max,
            });
        }
        Ok(())
    }
}

/// Where something applies: every one of its ranges must hold.
///
/// The ranges are kept behind constructors so other forms (any of, not) can
/// join them without changing how callers build or evaluate a condition.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct Condition {
    // Written even when empty, so every reader of the serialized form, the
    // editor's included, finds the list; a container that leaves out a
    // condition that always holds skips the whole field.
    #[serde(default)]
    all: Vec<ConditionRange>,
}

impl Condition {
    /// The condition that always holds.
    pub fn always() -> Self {
        Self::default()
    }

    /// The condition that holds where every one of `ranges` does.
    pub fn all(ranges: impl IntoIterator<Item = ConditionRange>) -> Self {
        Self {
            all: ranges.into_iter().collect(),
        }
    }

    /// Whether the condition holds everywhere: it has no ranges.
    pub fn is_always(&self) -> bool {
        self.all.is_empty()
    }

    /// The ranges that must all hold, in authored order.
    pub fn ranges(&self) -> &[ConditionRange] {
        &self.all
    }

    /// The axes the condition reads, in authored order.
    pub fn axis_ids(&self) -> impl Iterator<Item = AxisId> + '_ {
        self.all.iter().map(|range| range.axis_id)
    }

    /// Whether the condition holds at `location`, which takes each axis it
    /// doesn't name at that axis's default in `axes`. A range on an axis
    /// `axes` lacks doesn't hold: a condition is checked against its space
    /// when it is authored, so that axis has been removed since.
    pub fn holds_at(&self, location: &DesignLocation, axes: &[Axis]) -> bool {
        self.all.iter().all(|range| {
            axes.axis(range.axis_id)
                .is_some_and(|axis| range.contains(location.value_on(axis)))
        })
    }

    /// Whether the condition holds at `values`, a value per axis; a range on
    /// an axis `values` lacks doesn't.
    pub(crate) fn holds_on(&self, values: &BTreeMap<AxisId, f64>) -> bool {
        self.all.iter().all(|range| {
            values
                .get(&range.axis_id)
                .is_some_and(|value| range.contains(*value))
        })
    }

    /// Checks every range on its own: finite ends, and `min` not above
    /// `max`.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::ConditionValueNotFinite`] for an end that is not
    /// finite and [`CoreError::ConditionRangeReversed`] for `min > max`, for
    /// the first range that fails.
    pub fn check_well_formed(&self) -> CoreResult<()> {
        self.all
            .iter()
            .try_for_each(ConditionRange::check_well_formed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bleed_0_to_100() -> Axis {
        Axis::new("BLED".into(), "Bleed".into(), 0.0, 0.0, 100.0)
    }

    #[test]
    fn a_range_includes_its_ends_and_is_open_where_unset() {
        let axis = AxisId::new();
        let closed = ConditionRange::new(axis, Some(70.0), Some(100.0));
        let from = ConditionRange::new(axis, Some(70.0), None);

        assert_eq!(
            [69.9, 70.0, 100.0, 100.1].map(|value| closed.contains(value)),
            [false, true, true, false]
        );
        assert!(from.contains(1e9));
    }

    #[test]
    fn a_condition_holds_where_every_range_does_and_unset_axes_are_at_their_defaults() {
        let bleed = bleed_0_to_100();
        let other = Axis::new("OTHR".into(), "Other".into(), 0.0, 50.0, 100.0);
        let axes = [bleed.clone(), other.clone()];
        let condition = Condition::all([
            ConditionRange::new(bleed.id(), Some(70.0), None),
            ConditionRange::new(other.id(), Some(40.0), Some(60.0)),
        ]);

        let at = |value: f64| DesignLocation::from([(bleed.id(), value)]);

        assert!(condition.holds_at(&at(80.0), &axes));
        assert!(!condition.holds_at(&at(60.0), &axes));
        let off_other = DesignLocation::from([(bleed.id(), 80.0), (other.id(), 90.0)]);
        assert!(!condition.holds_at(&off_other, &axes));
        assert!(Condition::always().holds_at(&at(0.0), &axes));
    }

    #[test]
    fn a_range_on_an_axis_the_space_lacks_does_not_hold() {
        let condition = Condition::all([ConditionRange::new(AxisId::new(), None, None)]);

        assert!(!condition.holds_at(&DesignLocation::new(), &[bleed_0_to_100()]));
    }

    #[test]
    fn reversed_and_non_finite_ranges_are_refused() {
        let axis_id = AxisId::new();

        let reversed = Condition::all([ConditionRange::new(axis_id, Some(2.0), Some(1.0))]);
        let infinite = ConditionRange::new(axis_id, Some(f64::NAN), None);

        assert!(matches!(
            reversed.check_well_formed(),
            Err(CoreError::ConditionRangeReversed {
                min: 2.0,
                max: 1.0,
                ..
            })
        ));
        assert!(matches!(
            infinite.check_well_formed(),
            Err(CoreError::ConditionValueNotFinite { .. })
        ));
    }
}
