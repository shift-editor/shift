//! Alternates: where on the font's axes text draws another glyph in a
//! glyph's place.
//!
//! A glyph's alternates are ordered and the first whose condition holds is
//! the glyph text draws instead, the way a designspace rule or an `rvrn`
//! substitution swaps one glyph for another (`dollar.heavy` is an alternate
//! of `dollar`). When none holds, the glyph draws itself. It is one step: an
//! alternate glyph's own alternates are not applied. It applies wherever the
//! glyph is drawn as itself at a font location (text, previews, the glyph
//! open for editing), never to a component: a component of the glyph still
//! draws the glyph.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

use crate::condition::Condition;
use crate::entity::{AlternateId, AxisId, GlyphId};

/// One of a glyph's alternates: where its condition holds on the font's
/// axes, text draws `glyph` in the glyph's place.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct GlyphAlternate {
    id: AlternateId,
    condition: Condition,
    glyph: GlyphId,
}

impl GlyphAlternate {
    /// An alternate that draws `glyph_id` where `condition` holds.
    pub fn new(id: AlternateId, condition: Condition, glyph_id: GlyphId) -> Self {
        Self {
            id,
            condition,
            glyph: glyph_id,
        }
    }

    pub fn id(&self) -> AlternateId {
        self.id
    }

    /// Where the alternate applies, on font axes only.
    pub fn condition(&self) -> &Condition {
        &self.condition
    }

    /// The glyph drawn where the alternate applies.
    pub fn glyph(&self) -> GlyphId {
        self.glyph
    }
}

/// One axis of the space alternates are chosen in: its design-unit bounds.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AxisBounds {
    pub axis_id: AxisId,
    /// The lowest design value, not above `max`.
    pub min: f64,
    pub max: f64,
}

/// An alternate no location in the font's axes draws.
#[derive(Clone, Debug, PartialEq)]
pub struct NeverUsedAlternate {
    pub alternate_id: AlternateId,
    pub reason: NeverUsedReason,
}

/// Why an alternate is never used.
#[derive(Clone, Debug, PartialEq)]
pub enum NeverUsedReason {
    /// Its condition holds nowhere within the axes' ranges.
    OutsideAxes,
    /// Wherever its condition holds, an earlier alternate's does too, so the
    /// earlier one wins. `by` lists those earlier alternates, in order.
    Covered { by: Vec<AlternateId> },
}

/// The alternates in `alternates`, tried in order, that never win anywhere
/// in the box `space` bounds: those whose condition holds nowhere in it, and
/// those whose whole region the earlier alternates' regions cover. A
/// condition on an axis `space` lacks holds nowhere.
///
/// Exact for conjunctions of inclusive ranges: each condition is a box, and
/// the boxes' ends cut every axis into points and the open spans between
/// them, on each of which every condition is constant. A location at each
/// point and in each span stands for all of it, so the answer is the same
/// as checking every location. Discrete axes are treated as continuous.
pub fn never_used_alternates(
    alternates: &[GlyphAlternate],
    space: &[AxisBounds],
) -> Vec<NeverUsedAlternate> {
    (0..alternates.len())
        .filter_map(|index| {
            let reason = never_used_reason(&alternates[..=index], space)?;
            Some(NeverUsedAlternate {
                alternate_id: alternates[index].id(),
                reason,
            })
        })
        .collect()
}

/// Why the last of `alternates` never wins in `space`, or `None` when it
/// wins somewhere.
fn never_used_reason(
    alternates: &[GlyphAlternate],
    space: &[AxisBounds],
) -> Option<NeverUsedReason> {
    let (target, earlier) = alternates.split_last()?;
    let grid = RepresentativeGrid::new(alternates, space);
    let mut covering = vec![false; earlier.len()];
    let mut holds_somewhere = false;
    for cell in grid.cells() {
        if !grid.holds(target.condition(), &cell) {
            continue;
        }
        holds_somewhere = true;
        let winner = earlier
            .iter()
            .position(|alternate| grid.holds(alternate.condition(), &cell))?;
        covering[winner] = true;
    }
    if !holds_somewhere {
        return Some(NeverUsedReason::OutsideAxes);
    }
    let by = earlier
        .iter()
        .zip(covering)
        .filter(|(_, covers)| *covers)
        .map(|(alternate, _)| alternate.id())
        .collect();
    Some(NeverUsedReason::Covered { by })
}

/// One location for each piece the conditions' ends cut the space into,
/// along each axis a condition reads.
struct RepresentativeGrid {
    axes: Vec<AxisId>,
    /// Per axis: each end within its bounds, and the midpoint between
    /// neighbouring ends.
    values: Vec<Vec<f64>>,
}

impl RepresentativeGrid {
    fn new(alternates: &[GlyphAlternate], space: &[AxisBounds]) -> Self {
        let ranges = || {
            alternates
                .iter()
                .flat_map(|alternate| alternate.condition().ranges())
        };
        let read: BTreeSet<AxisId> = ranges().map(|range| range.axis_id).collect();
        let (axes, values) = space
            .iter()
            .filter(|bounds| read.contains(&bounds.axis_id))
            .map(|bounds| {
                let mut ends = vec![bounds.min, bounds.max];
                ends.extend(
                    ranges()
                        .filter(|range| range.axis_id == bounds.axis_id)
                        .flat_map(|range| [range.min, range.max])
                        .flatten()
                        .filter(|end| (bounds.min..=bounds.max).contains(end)),
                );
                ends.sort_by(f64::total_cmp);
                ends.dedup();
                let mut values = Vec::with_capacity(ends.len() * 2);
                for pair in ends.windows(2) {
                    values.extend([pair[0], f64::midpoint(pair[0], pair[1])]);
                }
                values.extend(ends.last());
                (bounds.axis_id, values)
            })
            .unzip();
        Self { axes, values }
    }

    /// Every location of the grid, as one value index per axis.
    fn cells(&self) -> impl Iterator<Item = Vec<f64>> + '_ {
        let count: usize = self.values.iter().map(Vec::len).product();
        (0..count).map(|mut cell| {
            self.values
                .iter()
                .map(|values| {
                    let value = values[cell % values.len()];
                    cell /= values.len();
                    value
                })
                .collect()
        })
    }

    /// Whether `condition` holds at `cell`; a range on an axis the grid
    /// lacks doesn't.
    fn holds(&self, condition: &Condition, cell: &[f64]) -> bool {
        condition.ranges().iter().all(|range| {
            self.axes
                .iter()
                .position(|axis_id| *axis_id == range.axis_id)
                .is_some_and(|index| range.contains(cell[index]))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ConditionRange;

    const WGHT: &str = "wght";
    const WDTH: &str = "wdth";

    fn axis(tag: &str) -> AxisId {
        AxisId::from_raw(tag)
    }

    fn space() -> [AxisBounds; 2] {
        [
            AxisBounds {
                axis_id: axis(WGHT),
                min: 100.0,
                max: 900.0,
            },
            AxisBounds {
                axis_id: axis(WDTH),
                min: 50.0,
                max: 100.0,
            },
        ]
    }

    fn range(tag: &str, min: Option<f64>, max: Option<f64>) -> ConditionRange {
        ConditionRange::new(axis(tag), min, max)
    }

    fn alternate(id: &str, ranges: impl IntoIterator<Item = ConditionRange>) -> GlyphAlternate {
        GlyphAlternate::new(
            AlternateId::from_raw(id),
            Condition::all(ranges),
            GlyphId::from_raw(id),
        )
    }

    /// The ids of the never-used alternates, with the alternates covering
    /// each (empty when it is outside the axes).
    fn never_used(alternates: &[GlyphAlternate]) -> Vec<(String, Vec<String>)> {
        never_used_alternates(alternates, &space())
            .into_iter()
            .map(|unused| {
                let by = match unused.reason {
                    NeverUsedReason::OutsideAxes => Vec::new(),
                    NeverUsedReason::Covered { by } => by,
                };
                // The raw text each test alternate was made from.
                let name = |id: &AlternateId| {
                    let text = id.as_str();
                    text.strip_prefix("alternate_").unwrap_or(text).to_string()
                };
                (name(&unused.alternate_id), by.iter().map(name).collect())
            })
            .collect()
    }

    #[test]
    fn a_narrower_alternate_after_a_wider_one_is_never_used() {
        let alternates = [
            alternate("heavy", [range(WGHT, Some(700.0), None)]),
            alternate(
                "compact-heavy",
                [
                    range(WGHT, Some(700.0), None),
                    range(WDTH, None, Some(80.0)),
                ],
            ),
        ];

        assert_eq!(
            never_used(&alternates),
            [("compact-heavy".into(), vec!["heavy".into()])]
        );
    }

    #[test]
    fn a_narrower_alternate_before_a_wider_one_leaves_both_used() {
        let alternates = [
            alternate(
                "compact-heavy",
                [
                    range(WGHT, Some(700.0), None),
                    range(WDTH, None, Some(80.0)),
                ],
            ),
            alternate("heavy", [range(WGHT, Some(700.0), None)]),
        ];

        assert!(never_used(&alternates).is_empty());
    }

    #[test]
    fn two_earlier_alternates_can_cover_a_later_one_together() {
        // Narrow heavy and wide heavy together cover all of heavy.
        let alternates = [
            alternate(
                "narrow",
                [
                    range(WGHT, Some(700.0), None),
                    range(WDTH, None, Some(80.0)),
                ],
            ),
            alternate(
                "wide",
                [
                    range(WGHT, Some(600.0), None),
                    range(WDTH, Some(80.0), None),
                ],
            ),
            alternate("heavy", [range(WGHT, Some(700.0), None)]),
        ];

        assert_eq!(
            never_used(&alternates),
            [("heavy".into(), vec!["narrow".into(), "wide".into()])]
        );
    }

    #[test]
    fn a_gap_of_one_point_or_one_open_span_leaves_a_later_alternate_used() {
        // 700 itself is left to the later alternate.
        let point = [
            alternate("below", [range(WGHT, None, Some(699.0))]),
            alternate("above", [range(WGHT, Some(700.5), None)]),
            alternate("any", []),
        ];
        // Only the open span between 80 and 90 is left.
        let span = [
            alternate("narrow", [range(WDTH, None, Some(80.0))]),
            alternate("wide", [range(WDTH, Some(90.0), None)]),
            alternate("any", []),
        ];
        let touching = [
            alternate("narrow", [range(WDTH, None, Some(80.0))]),
            alternate("wide", [range(WDTH, Some(80.0), None)]),
            alternate("any", []),
        ];

        assert!(never_used(&point).is_empty());
        assert!(never_used(&span).is_empty());
        assert_eq!(
            never_used(&touching),
            [("any".into(), vec!["narrow".into(), "wide".into()])]
        );
    }

    #[test]
    fn an_alternate_outside_the_axes_or_on_a_missing_axis_is_never_used() {
        let alternates = [
            alternate("beyond", [range(WGHT, Some(1000.0), None)]),
            alternate("missing", [range("opsz", Some(10.0), None)]),
            alternate("at-maximum", [range(WGHT, Some(900.0), Some(900.0))]),
        ];

        assert_eq!(
            never_used(&alternates),
            [("beyond".into(), vec![]), ("missing".into(), vec![]),]
        );
    }
}
