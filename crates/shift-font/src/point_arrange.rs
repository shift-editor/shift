//! Edits that place selected points together: transforming them by one
//! matrix, aligning them to an edge or centre of their box, spacing them
//! evenly, and moving a sidebearing.

use std::collections::{HashMap, HashSet};

use kurbo::Point as KurboPoint;

use crate::contour_edit::{EditOption, UnknownEditOption};
use crate::error::{CoreError, CoreResult};
use crate::{Contour, GlyphLayer, Point, PointId, Transform};

crate::string_enum! {
    /// Where [`GlyphLayer::align_points`] puts the points, in their own box.
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum PointAlignment {
        Left => "left",
        CenterH => "center-h",
        Right => "right",
        Top => "top",
        CenterV => "center-v",
        Bottom => "bottom",
    }
    parse_error: UnknownEditOption = |text| UnknownEditOption::new(EditOption::PointAlignment, text);
}

crate::string_enum! {
    /// The axis [`GlyphLayer::distribute_points`] spaces the points along.
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum DistributeAxis {
        Horizontal => "horizontal",
        Vertical => "vertical",
    }
    parse_error: UnknownEditOption = |text| UnknownEditOption::new(EditOption::DistributeAxis, text);
}

crate::string_enum! {
    /// One sidebearing of a layer.
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum Sidebearing {
        Left => "lsb",
        Right => "rsb",
    }
    parse_error: UnknownEditOption = |text| UnknownEditOption::new(EditOption::Sidebearing, text);
}

impl GlyphLayer {
    /// Moves each of `point_ids` by `transform`.
    ///
    /// # Errors
    ///
    /// Returns [`crate::CoreError::PointInContourNotFound`] when a point is not in the
    /// layer; no point moves on failure.
    pub fn transform_points(
        &mut self,
        point_ids: &[PointId],
        transform: &Transform,
    ) -> CoreResult<()> {
        self.update_points(point_ids, |point| {
            let moved = transform.transform_point(point.position());
            point.set_position(moved.x, moved.y);
        })
    }

    /// Lines `point_ids` up on one edge or centre of the box around their
    /// positions, keeping their other coordinate. No points leaves the layer
    /// unchanged.
    ///
    /// # Errors
    ///
    /// Returns [`crate::CoreError::PointInContourNotFound`] when a point is not in the
    /// layer; no point moves on failure.
    pub fn align_points(
        &mut self,
        point_ids: &[PointId],
        alignment: PointAlignment,
    ) -> CoreResult<()> {
        let positions = self.point_positions(point_ids)?;
        let Some((min, max)) = bounds(positions.iter().copied()) else {
            return Ok(());
        };
        let center = min.midpoint(max);
        self.update_known_points(point_ids, |point| {
            let (x, y) = (point.x(), point.y());
            let (x, y) = match alignment {
                PointAlignment::Left => (min.x, y),
                PointAlignment::CenterH => (center.x, y),
                PointAlignment::Right => (max.x, y),
                PointAlignment::Top => (x, max.y),
                PointAlignment::CenterV => (x, center.y),
                PointAlignment::Bottom => (x, min.y),
            };
            point.set_position(x, y);
        });
        Ok(())
    }

    /// Spaces `point_ids` evenly along `axis` between the two outermost,
    /// keeping their order along it and their other coordinate. Points that
    /// tie keep the order they are given in. Fewer than three points are
    /// left as they are.
    ///
    /// # Errors
    ///
    /// Returns [`crate::CoreError::PointInContourNotFound`] when a point is not in the
    /// layer; no point moves on failure.
    pub fn distribute_points(
        &mut self,
        point_ids: &[PointId],
        axis: DistributeAxis,
    ) -> CoreResult<()> {
        let positions = self.point_positions(point_ids)?;
        if point_ids.len() < 3 {
            return Ok(());
        }
        let along = |position: KurboPoint| match axis {
            DistributeAxis::Horizontal => position.x,
            DistributeAxis::Vertical => position.y,
        };
        let mut order: Vec<usize> = (0..point_ids.len()).collect();
        order.sort_by(|&a, &b| along(positions[a]).total_cmp(&along(positions[b])));
        let (Some(&first), Some(&last)) = (order.first(), order.last()) else {
            return Ok(());
        };
        let start = along(positions[first]);
        let spacing = (along(positions[last]) - start) / (order.len() - 1) as f64;
        let targets: HashMap<PointId, f64> = order
            .iter()
            .enumerate()
            .skip(1)
            .take(order.len() - 2)
            .map(|(rank, &index)| (point_ids[index].clone(), start + spacing * rank as f64))
            .collect();

        self.update_known_points(point_ids, |point| {
            let Some(&target) = targets.get(&point.id()) else {
                return;
            };
            match axis {
                DistributeAxis::Horizontal => point.set_position(target, point.y()),
                DistributeAxis::Vertical => point.set_position(point.x(), target),
            }
        });
        Ok(())
    }

    /// Adds `delta` units to one sidebearing: the right one moves the
    /// advance; the left one moves the whole layer (points, anchors and
    /// components) and the advance together, so the right one stays.
    pub fn shift_sidebearing(&mut self, sidebearing: Sidebearing, delta: f64) {
        if sidebearing == Sidebearing::Left {
            self.transform_layer(&Transform::translate(delta, 0.0));
        }
        self.set_x_advance(self.width() + delta);
    }

    /// Where each of `point_ids` is, in their order, found in one pass.
    ///
    /// # Errors
    ///
    /// Returns [`crate::CoreError::PointInContourNotFound`] for the first id
    /// the layer does not hold.
    fn point_positions(&self, point_ids: &[PointId]) -> CoreResult<Vec<KurboPoint>> {
        let wanted: HashSet<&PointId> = point_ids.iter().collect();
        let found: HashMap<PointId, KurboPoint> = self
            .contours_iter()
            .flat_map(Contour::points)
            .filter(|point| wanted.contains(&point.id()))
            .map(|point| (point.id(), point.position()))
            .collect();
        point_ids
            .iter()
            .map(|id| {
                found
                    .get(id)
                    .copied()
                    .ok_or_else(|| CoreError::PointInContourNotFound(id.clone()))
            })
            .collect()
    }

    /// Updates each of `point_ids`, which [`Self::point_positions`] found.
    fn update_known_points(&mut self, point_ids: &[PointId], mut update: impl FnMut(&mut Point)) {
        let wanted: HashSet<&PointId> = point_ids.iter().collect();
        for point in self.contours_iter_mut().flat_map(Contour::points_mut) {
            if wanted.contains(&point.id()) {
                update(point);
            }
        }
    }
}

/// The corners of the box around `positions`, or `None` for no positions.
fn bounds(positions: impl Iterator<Item = KurboPoint>) -> Option<(KurboPoint, KurboPoint)> {
    positions.fold(None, |bounds, position| {
        Some(match bounds {
            None => (position, position),
            Some((min, max)) => (
                KurboPoint::new(min.x.min(position.x), min.y.min(position.y)),
                KurboPoint::new(max.x.max(position.x), max.y.max(position.y)),
            ),
        })
    })
}

#[cfg(test)]
mod tests;
