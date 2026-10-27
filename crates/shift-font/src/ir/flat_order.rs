//! A layer's points numbered across all its contours.
//!
//! Point positions cross the WebAssembly and NAPI boundary as one flat run,
//! contour after contour, in contour order. [`FlatOrder`] converts between
//! that flat index and a contour-relative [`PointRef`].

use std::ops::Range;

/// A point addressed by its contour's position and its position in that
/// contour.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PointRef {
    pub contour: usize,
    pub point: usize,
}

/// The flat order of a layer's points: every contour's points, contour after
/// contour, numbered from zero.
///
/// This is the order point positions cross the WebAssembly and NAPI boundary
/// in. Collect one from each contour's point count, in contour order. Empty
/// contours take up no flat indices.
#[derive(Clone, Debug, Default)]
pub struct FlatOrder {
    /// The flat index of each contour's first point; an empty contour starts
    /// where the next contour does.
    starts: Vec<usize>,
    len: usize,
}

impl FlatOrder {
    /// Returns the number of points across all contours.
    pub fn len(&self) -> usize {
        self.len
    }

    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    /// Returns the flat index of `point`, or `None` when its contour does not
    /// exist or the point is past that contour's end.
    pub fn flat(&self, point: PointRef) -> Option<usize> {
        let range = self.contour_range(point.contour)?;
        (point.point < range.len()).then(|| range.start + point.point)
    }

    /// Returns the contour and contour-relative position of the point at
    /// `flat`, or `None` when `flat` is past the last point.
    pub fn point_ref(&self, flat: usize) -> Option<PointRef> {
        if flat >= self.len {
            return None;
        }
        // The last contour starting at or before `flat`: an empty contour
        // shares its start with the contour after it, so it is never chosen.
        let contour = self
            .starts
            .partition_point(|&start| start <= flat)
            .checked_sub(1)?;
        let start = self.starts.get(contour)?;
        Some(PointRef {
            contour,
            point: flat - start,
        })
    }

    /// Returns the flat indices of `contour`'s points, or `None` when the
    /// contour does not exist.
    pub fn contour_range(&self, contour: usize) -> Option<Range<usize>> {
        let start = *self.starts.get(contour)?;
        let end = self.starts.get(contour + 1).copied().unwrap_or(self.len);
        Some(start..end)
    }

    /// Returns each contour's flat indices, in contour order.
    pub fn ranges(&self) -> impl Iterator<Item = Range<usize>> + '_ {
        (0..self.starts.len()).filter_map(|contour| self.contour_range(contour))
    }
}

impl FromIterator<usize> for FlatOrder {
    /// Collects contour point counts, in contour order.
    fn from_iter<I: IntoIterator<Item = usize>>(point_counts: I) -> Self {
        let mut order = Self::default();
        for count in point_counts {
            order.starts.push(order.len);
            order.len += count;
        }
        order
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn point(contour: usize, point: usize) -> PointRef {
        PointRef { contour, point }
    }

    #[test]
    fn flat_and_point_ref_round_trip() {
        let order: FlatOrder = [2, 3].into_iter().collect();

        let points: Vec<PointRef> = (0..order.len())
            .filter_map(|flat| order.point_ref(flat))
            .collect();
        assert_eq!(
            points,
            vec![
                point(0, 0),
                point(0, 1),
                point(1, 0),
                point(1, 1),
                point(1, 2)
            ]
        );
        for (flat, point) in points.into_iter().enumerate() {
            assert_eq!(order.flat(point), Some(flat));
        }
    }

    #[test]
    fn empty_contours_take_no_flat_indices() {
        let order: FlatOrder = [0, 2, 0, 1, 0].into_iter().collect();

        assert_eq!(order.len(), 3);
        assert_eq!(order.point_ref(0), Some(point(1, 0)));
        assert_eq!(order.point_ref(1), Some(point(1, 1)));
        assert_eq!(order.point_ref(2), Some(point(3, 0)));
        assert_eq!(order.flat(point(0, 0)), None);
        assert_eq!(order.flat(point(2, 0)), None);
        assert_eq!(order.flat(point(4, 0)), None);
        assert_eq!(order.flat(point(3, 0)), Some(2));
    }

    #[test]
    fn out_of_range_positions_have_no_counterpart() {
        let order: FlatOrder = [2, 1].into_iter().collect();

        assert_eq!(order.point_ref(3), None);
        assert_eq!(order.flat(point(0, 2)), None);
        assert_eq!(order.flat(point(2, 0)), None);
        assert_eq!(order.contour_range(2), None);
        assert_eq!(FlatOrder::default().point_ref(0), None);
    }

    #[test]
    fn ranges_cover_each_contour_in_order() {
        let order: FlatOrder = [2, 0, 3].into_iter().collect();

        assert_eq!(order.ranges().collect::<Vec<_>>(), vec![0..2, 2..2, 2..5]);
    }
}
