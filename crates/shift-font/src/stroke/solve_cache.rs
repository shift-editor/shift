//! A bounded memo of solved stroke outlines, keyed by everything the solver reads.
//!
//! A drag moves one contour of a glyph at a time, so a read of every live
//! stroke on its layer re-solves the one that moved and finds the rest here.
//! The key is the solver's whole input (the skeleton path, the style and the
//! tolerance), so an answer cannot be stale: any change to what the solver
//! reads is a different key.

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use kurbo::{BezPath, Cap, Join, PathEl};

use crate::CoreResult;
use crate::contour::SubpathPoints;

use super::exact_offset::ExactStrokeStyle;

/// How many outline points a [`StrokeOutlineCache`] keeps by default: about
/// fourteen glyphs of five dense contours, a few megabytes.
const DEFAULT_CACHED_POINTS: usize = 200_000;

/// One skeleton's solved fill outlines as plain points, with the largest
/// width and height of any of them in font units.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct SolvedOutline {
    pub(super) width: f64,
    pub(super) height: f64,
    pub(super) outlines: Vec<SubpathPoints>,
}

impl SolvedOutline {
    fn point_count(&self) -> usize {
        self.outlines
            .iter()
            .map(|subpath| subpath.point_types.len())
            .sum()
    }
}

/// The words that identify one solve: style and tolerance, then the skeleton
/// path element by element, each led by a tag so lengths cannot run together.
type SolveKey = Arc<[u64]>;

struct CachedOutline {
    /// When the entry was last used, as a tick of the cache's clock.
    used: u64,
    outline: SolvedOutline,
}

/// A least-recently-used memo of solved outlines, bounded by the number of
/// outline points it holds.
///
/// One cache belongs to one consumer, such as a session's engine; it is not
/// shared between threads. An outline larger than the whole cache is solved
/// each time and never stored.
pub struct StrokeOutlineCache {
    max_points: usize,
    points: usize,
    clock: u64,
    solves: u64,
    entries: HashMap<SolveKey, CachedOutline>,
    /// Keys by last use, so the oldest is the first.
    by_use: BTreeMap<u64, SolveKey>,
}

impl Default for StrokeOutlineCache {
    fn default() -> Self {
        Self::with_capacity(DEFAULT_CACHED_POINTS)
    }
}

impl StrokeOutlineCache {
    /// An empty cache that keeps up to `max_points` outline points. With
    /// zero it keeps nothing and every read solves.
    pub fn with_capacity(max_points: usize) -> Self {
        Self {
            max_points,
            points: 0,
            clock: 0,
            solves: 0,
            entries: HashMap::new(),
            by_use: BTreeMap::new(),
        }
    }

    /// How many solves this cache has had to run: its misses. A work counter
    /// for tests and profiles.
    pub fn solves(&self) -> u64 {
        self.solves
    }

    /// How many outline points the cache holds now.
    pub fn points(&self) -> usize {
        self.points
    }

    /// The outline for `skeleton` at `style` and `tolerance`: the stored one,
    /// or `solve`'s, stored when it fits.
    ///
    /// # Errors
    ///
    /// Returns `solve`'s error; nothing is stored then.
    pub(super) fn outline(
        &mut self,
        skeleton: &BezPath,
        style: &ExactStrokeStyle,
        tolerance: f64,
        solve: impl FnOnce() -> CoreResult<SolvedOutline>,
    ) -> CoreResult<SolvedOutline> {
        if self.max_points == 0 {
            self.solves += 1;
            return solve();
        }

        let key = solve_key(skeleton, style, tolerance);
        if let Some(outline) = self.reuse(&key) {
            return Ok(outline);
        }

        self.solves += 1;
        let outline = solve()?;
        self.store(key.into(), outline.clone());
        Ok(outline)
    }

    /// The stored outline for `key`, marked as just used.
    fn reuse(&mut self, key: &[u64]) -> Option<SolvedOutline> {
        let (stored_key, entry) = self.entries.get_key_value(key)?;
        let stored_key = Arc::clone(stored_key);
        let previous_use = entry.used;

        self.by_use.remove(&previous_use);
        self.clock += 1;
        self.by_use.insert(self.clock, stored_key);

        let entry = self.entries.get_mut(key)?;
        entry.used = self.clock;
        Some(entry.outline.clone())
    }

    fn store(&mut self, key: SolveKey, outline: SolvedOutline) {
        let points = outline.point_count();
        if points > self.max_points {
            return;
        }

        if let Some(replaced) = self.entries.remove(&key) {
            self.points -= replaced.outline.point_count();
            self.by_use.remove(&replaced.used);
        }

        self.clock += 1;
        self.by_use.insert(self.clock, Arc::clone(&key));
        self.points += points;
        self.entries.insert(
            key,
            CachedOutline {
                used: self.clock,
                outline,
            },
        );
        self.evict_down_to_capacity();
    }

    fn evict_down_to_capacity(&mut self) {
        while self.points > self.max_points {
            let Some((_, oldest)) = self.by_use.pop_first() else {
                return;
            };
            if let Some(evicted) = self.entries.remove(&oldest) {
                self.points -= evicted.outline.point_count();
            }
        }
    }
}

fn solve_key(skeleton: &BezPath, style: &ExactStrokeStyle, tolerance: f64) -> Vec<u64> {
    let mut key = Vec::with_capacity(6 + 3 * skeleton.elements().len());
    key.extend([
        style.width.to_bits(),
        cap_tag(style.cap),
        join_tag(style.join),
        style.miter_limit.to_bits(),
        style.position.to_bits(),
        tolerance.to_bits(),
    ]);

    for element in skeleton.elements() {
        match *element {
            PathEl::MoveTo(point) => key.extend([0, point.x.to_bits(), point.y.to_bits()]),
            PathEl::LineTo(point) => key.extend([1, point.x.to_bits(), point.y.to_bits()]),
            PathEl::QuadTo(control, point) => key.extend([
                2,
                control.x.to_bits(),
                control.y.to_bits(),
                point.x.to_bits(),
                point.y.to_bits(),
            ]),
            PathEl::CurveTo(first, second, point) => key.extend([
                3,
                first.x.to_bits(),
                first.y.to_bits(),
                second.x.to_bits(),
                second.y.to_bits(),
                point.x.to_bits(),
                point.y.to_bits(),
            ]),
            PathEl::ClosePath => key.push(4),
        }
    }

    key
}

fn cap_tag(cap: Cap) -> u64 {
    match cap {
        Cap::Butt => 0,
        Cap::Square => 1,
        Cap::Round => 2,
    }
}

fn join_tag(join: Join) -> u64 {
    match join {
        Join::Bevel => 0,
        Join::Miter => 1,
        Join::Round => 2,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::PointType;

    fn outline_with(points: usize) -> SolvedOutline {
        SolvedOutline {
            width: 1.0,
            height: 1.0,
            outlines: vec![SubpathPoints {
                closed: false,
                point_types: vec![PointType::OnCurve; points],
                coordinates: vec![0.0; points * 2],
            }],
        }
    }

    /// `store` is only called after a miss, but the cache's counts must not
    /// depend on that: a second store under one key replaces the first.
    #[test]
    fn storing_a_key_again_replaces_it_without_double_counting() {
        let mut cache = StrokeOutlineCache::with_capacity(100);
        let key: SolveKey = Arc::from(vec![1_u64, 2, 3]);

        cache.store(Arc::clone(&key), outline_with(10));
        cache.store(Arc::clone(&key), outline_with(4));

        assert_eq!(cache.points(), 4);
        assert_eq!(cache.entries.len(), 1);
        assert_eq!(cache.by_use.len(), 1);
    }

    #[test]
    fn reusing_a_key_keeps_one_use_slot_per_entry() {
        let mut cache = StrokeOutlineCache::with_capacity(100);
        let key: SolveKey = Arc::from(vec![7_u64]);
        cache.store(Arc::clone(&key), outline_with(3));

        for _ in 0..3 {
            assert!(cache.reuse(&key).is_some());
        }

        assert_eq!(cache.by_use.len(), 1);
        assert_eq!(cache.points(), 3);
    }
}
