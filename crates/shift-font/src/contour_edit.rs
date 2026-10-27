//! Edits that rework a contour's points as a whole: deleting points and
//! reconnecting what survives, splitting a segment, raising a line to a
//! cubic, and closing or joining contours by their ends.

use std::collections::{HashMap, HashSet};

use kurbo::{CubicBez, Line, ParamCurve, PathSeg, Point as KurboPoint, QuadBez};

use crate::curve_fit::{CurveFitError, fit_cubic, fit_quadratic};
use crate::error::{CoreError, CoreResult, Require};
use crate::{
    Contour, ContourId, GlyphLayer, Point, PointId, PointType, SegmentIndexIter, SegmentIndices,
};

/// Which of the edit options in this module and `point_arrange` a name
/// failed to parse as.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EditOption {
    DeleteMode,
    ContourSide,
    JoinMode,
    PointAlignment,
    DistributeAxis,
    Sidebearing,
}

impl std::fmt::Display for EditOption {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::DeleteMode => "delete mode",
            Self::ContourSide => "contour side",
            Self::JoinMode => "join mode",
            Self::PointAlignment => "point alignment",
            Self::DistributeAxis => "distribute axis",
            Self::Sidebearing => "sidebearing",
        })
    }
}

/// A name that is none of an edit option's variants.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("unknown {option}: {text:?}")]
pub struct UnknownEditOption {
    pub option: EditOption,
    pub text: String,
}

impl UnknownEditOption {
    pub(crate) fn new(option: EditOption, text: &str) -> Self {
        Self {
            option,
            text: text.to_owned(),
        }
    }
}

crate::string_enum! {
    /// How deleting points reconnects the points that survive.
    #[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
    pub enum DeleteMode {
        /// Each removed span becomes one segment that approximates it.
        #[default]
        Fit => "fit",
        /// Each removed span leaves a gap, opening or splitting the contour.
        Gap => "gap",
    }
    parse_error: UnknownEditOption = |text| UnknownEditOption::new(EditOption::DeleteMode, text);
}

crate::string_enum! {
    /// Which end of an open contour.
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum ContourSide {
        Start => "start",
        End => "end",
    }
    parse_error: UnknownEditOption = |text| UnknownEditOption::new(EditOption::ContourSide, text);
}

crate::string_enum! {
    /// How [`GlyphLayer::join_contours`] connects two ends.
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum JoinMode {
        /// `from`'s end point is dropped and `to`'s takes its place, as
        /// dropping one end onto another does.
        Merge => "merge",
        /// A line connects the two end points.
        Connect => "connect",
    }
    parse_error: UnknownEditOption = |text| UnknownEditOption::new(EditOption::JoinMode, text);
}

/// One open end of a contour.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContourEnd {
    pub contour_id: ContourId,
    pub side: ContourSide,
}

/// Why a contour edit cannot apply.
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum ContourEditError {
    #[error("no segment runs from {start} to {end}")]
    SegmentNotFound { start: PointId, end: PointId },

    #[error("the segment from {start} to {end} is not a line")]
    NotALine { start: PointId, end: PointId },

    #[error("a segment splits strictly between its ends, not at {0}")]
    SplitOutsideSegment(f64),

    #[error("contour {0} has a span between surviving points that its segments do not cover")]
    IncompleteSpan(ContourId),

    #[error("the deleted span cannot be fitted: {0}")]
    Fit(#[from] CurveFitError),

    #[error("contour {0} is closed and has no ends to join")]
    ClosedContour(ContourId),

    #[error("both ends are the {side} of contour {contour_id}")]
    SameEnd {
        contour_id: ContourId,
        side: ContourSide,
    },

    #[error("contour {0} needs two on-curve points to close")]
    TooFewOnCurvePoints(ContourId),
}

impl GlyphLayer {
    /// Deletes `point_ids`, reconnecting what survives contour by contour.
    ///
    /// Each run of removed on-curve points between two surviving ones goes
    /// as one span: with [`DeleteMode::Fit`], a span of lines becomes a line,
    /// one without cubics a quadratic with one fitted control
    /// ([`fit_quadratic`]), and any other a cubic fitted with its end
    /// tangents ([`fit_cubic`]); with [`DeleteMode::Gap`] it leaves a gap. A
    /// removed handle outside such a span turns its segment into a line. A
    /// contour with no surviving on-curve point goes. The fragments a gap
    /// leaves become open contours: the one holding the first surviving point
    /// keeps the contour's identity, and the others are added after the
    /// layer's contours. Surviving points keep their identities; fitted
    /// controls and split-off contours get new ones.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::PointInContourNotFound`] when a point is not in
    /// the layer, and [`ContourEditError::IncompleteSpan`] or
    /// [`ContourEditError::Fit`] when a span cannot be followed or fitted.
    /// The layer is unchanged on failure.
    pub fn delete_points(&mut self, point_ids: &[PointId], mode: DeleteMode) -> CoreResult<()> {
        self.require_point_contours(point_ids)?;
        let selected: HashSet<PointId> = point_ids.iter().cloned().collect();

        let mut edited = self.clone();
        for contour in self.contours_iter() {
            if contour
                .points()
                .iter()
                .any(|point| selected.contains(&point.id()))
            {
                edited.delete_from_contour(contour, &selected, mode)?;
            }
        }
        *self = edited;
        Ok(())
    }

    /// Splits the segment from `start_id` to `end_id` at `t`, keeping its
    /// shape: a line gains an on-curve point; a quadratic or cubic is cut in
    /// two by de Casteljau, its new on-curve point smooth, its new controls
    /// minted and its old ones moved. The new on-curve point is `point_id`.
    ///
    /// # Errors
    ///
    /// Returns [`ContourEditError::SplitOutsideSegment`] when `t` is not
    /// strictly between 0 and 1, [`CoreError::DuplicatePointId`] when
    /// `point_id` is taken, [`CoreError::PointInContourNotFound`] when
    /// `start_id` is not in the layer, and
    /// [`ContourEditError::SegmentNotFound`] when no segment of its contour
    /// runs from `start_id` to `end_id`.
    pub fn split_segment(
        &mut self,
        start_id: &PointId,
        end_id: &PointId,
        t: f64,
        point_id: PointId,
    ) -> CoreResult<()> {
        if !(t > 0.0 && t < 1.0) {
            return Err(ContourEditError::SplitOutsideSegment(t).into());
        }
        if self.has_point(&point_id) {
            return Err(CoreError::DuplicatePointId(point_id));
        }
        let contour_id = self.require_point_contour(start_id)?;
        let contour = self.require_contour_mut(&contour_id)?;
        let segment = contour.segment_between(start_id, end_id)?;
        let points = contour.points().to_vec();
        let at = |index: usize| &points[index];

        match segment {
            SegmentIndices::Line([a, b]) => {
                let position = at(a).position().lerp(at(b).position(), t);
                contour.insert_before_end(
                    b,
                    [Point::at(point_id, position, PointType::OnCurve, false)],
                )?;
            }
            SegmentIndices::Quad([a, c, b]) => {
                let curve = QuadBez::new(at(a).position(), at(c).position(), at(b).position());
                let (left, right) = (curve.subsegment(0.0..t), curve.subsegment(t..1.0));
                contour.insert_before_end(
                    b,
                    [
                        Point::at(point_id, left.p2, at(b).point_type(), true),
                        Point::off_curve_at(right.p1),
                    ],
                )?;
                contour.move_point_to(&at(c).id(), left.p1)?;
            }
            SegmentIndices::Cubic([a, c0, c1, b]) => {
                let curve = CubicBez::new(
                    at(a).position(),
                    at(c0).position(),
                    at(c1).position(),
                    at(b).position(),
                );
                let (left, right) = (curve.subsegment(0.0..t), curve.subsegment(t..1.0));
                let control_end = at(c1).id();
                contour.insert_before_id(&control_end, Point::off_curve_at(left.p2))?;
                contour.insert_before_id(
                    &control_end,
                    Point::at(point_id, left.p3, PointType::OnCurve, true),
                )?;
                contour.insert_before_id(&control_end, Point::off_curve_at(right.p1))?;
                contour.move_point_to(&at(c0).id(), left.p1)?;
                contour.move_point_to(&control_end, right.p2)?;
            }
        }
        Ok(())
    }

    /// Raises the line from `start_id` to `end_id` to a cubic of the same
    /// shape, with new controls at a third and two thirds of the way.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::PointInContourNotFound`] when `start_id` is not in
    /// the layer, [`ContourEditError::SegmentNotFound`] when no segment of its
    /// contour runs from `start_id` to `end_id`, and
    /// [`ContourEditError::NotALine`] when that segment is a curve.
    pub fn upgrade_line_to_cubic(
        &mut self,
        start_id: &PointId,
        end_id: &PointId,
    ) -> CoreResult<()> {
        let contour_id = self.require_point_contour(start_id)?;
        let contour = self.require_contour_mut(&contour_id)?;
        let SegmentIndices::Line([a, b]) = contour.segment_between(start_id, end_id)? else {
            return Err(ContourEditError::NotALine {
                start: start_id.clone(),
                end: end_id.clone(),
            }
            .into());
        };
        let start = contour.points()[a].position();
        let end = contour.points()[b].position();
        contour.insert_before_end(
            b,
            [
                Point::off_curve_at(start.lerp(end, 1.0 / 3.0)),
                Point::off_curve_at(start.lerp(end, 2.0 / 3.0)),
            ],
        )?;
        Ok(())
    }

    /// Connects two open contour ends.
    ///
    /// Two ends of one contour close it. Ends of two contours join them into
    /// one open contour that keeps `from`'s identity, running from `from`'s
    /// other end through `to`'s points to `to`'s other end; the points keep
    /// their identities. `mode` says whether `to`'s end replaces `from`'s or
    /// a line connects them.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::ContourNotFound`] when a contour is not in the
    /// layer, [`ContourEditError::ClosedContour`] when one is closed,
    /// [`ContourEditError::SameEnd`] when both ends are the same end, and
    /// [`ContourEditError::TooFewOnCurvePoints`] when a contour to close has
    /// fewer than two on-curve points. The layer is unchanged on failure.
    pub fn join_contours(
        &mut self,
        from: &ContourEnd,
        to: &ContourEnd,
        mode: JoinMode,
    ) -> CoreResult<()> {
        let mut edited = self.clone();
        for end in [from, to] {
            if edited.require_contour_mut(&end.contour_id)?.is_closed() {
                return Err(ContourEditError::ClosedContour(end.contour_id.clone()).into());
            }
        }

        if from.contour_id == to.contour_id {
            edited.close_by_ends(from, to, mode)?;
        } else {
            edited.join_two(from, to, mode)?;
        }
        *self = edited;
        Ok(())
    }

    /// Deletes the selected points of `contour`, as it was before the
    /// deletion, from this layer's copy of it.
    fn delete_from_contour(
        &mut self,
        contour: &Contour,
        selected: &HashSet<PointId>,
        mode: DeleteMode,
    ) -> CoreResult<()> {
        let points = contour.points();
        let on_curve: Vec<usize> = (0..points.len())
            .filter(|&index| points[index].is_on_curve())
            .collect();
        let surviving: Vec<usize> = on_curve
            .iter()
            .copied()
            .filter(|&index| !selected.contains(&points[index].id()))
            .collect();
        let contour_id = contour.id();

        if surviving.is_empty() {
            self.remove_contour_checked(&contour_id)?;
            return Ok(());
        }

        let segments: Vec<SegmentIndices> =
            SegmentIndexIter::new(points, contour.is_closed()).collect();
        if surviving.len() == on_curve.len() {
            // Only handles were selected: a segment losing one loses them all.
            let removed: HashSet<PointId> = segments
                .iter()
                .filter(|segment| segment.loses_a_control(points, selected))
                .flat_map(|segment| segment.controls(points).map(Point::id))
                .collect();
            let kept: Vec<Point> = points
                .iter()
                .filter(|point| !removed.contains(&point.id()))
                .cloned()
                .collect();
            *self.require_contour_mut(&contour_id)?.points_mut() = kept;
            return Ok(());
        }

        let fragments = contour.surviving_fragments(&surviving, &segments, selected, mode)?;
        let closed = contour.is_closed() && mode == DeleteMode::Fit && surviving.len() > 1;
        let pivot = points[surviving[0]].id();
        let (retained, others): (Vec<_>, Vec<_>) = fragments
            .into_iter()
            .partition(|fragment| fragment.iter().any(|point| point.id() == pivot));

        let target = self.require_contour_mut(&contour_id)?;
        *target.points_mut() = retained.into_iter().next().unwrap_or_default();
        if closed {
            target.close();
        } else {
            target.open();
        }
        for fragment in others {
            self.add_contour(Contour::from_points(fragment, false));
        }
        Ok(())
    }

    /// Closes one contour by its two ends.
    fn close_by_ends(
        &mut self,
        from: &ContourEnd,
        to: &ContourEnd,
        mode: JoinMode,
    ) -> CoreResult<()> {
        let contour_id = &from.contour_id;
        if from.side == to.side {
            return Err(ContourEditError::SameEnd {
                contour_id: contour_id.clone(),
                side: from.side,
            }
            .into());
        }
        let contour = self.require_contour_mut(contour_id)?;
        let on_curve = contour
            .points()
            .iter()
            .filter(|point| point.is_on_curve())
            .count();
        // Two on-curve points mean the contour has a first and a last point.
        let (true, Some(first), Some(last)) =
            (on_curve >= 2, contour.first_point(), contour.last_point())
        else {
            return Err(ContourEditError::TooFewOnCurvePoints(contour_id.clone()).into());
        };

        let dropping_start = from.side == ContourSide::Start;
        let (dropped, survivor) = if dropping_start {
            (first.id(), last.id())
        } else {
            (last.id(), first.id())
        };
        if mode == JoinMode::Merge {
            contour.remove_point(&dropped);
        }
        contour.close();
        // Dropping the start leaves its outgoing handle first; a contour starts on-curve.
        if mode == JoinMode::Merge && dropping_start {
            let index = contour.point_index(&survivor).require(&survivor)?;
            contour.points_mut().rotate_left(index);
        }
        Ok(())
    }

    /// Joins two contours into `from`'s, `to`'s points after `from`'s.
    fn join_two(&mut self, from: &ContourEnd, to: &ContourEnd, mode: JoinMode) -> CoreResult<()> {
        if from.side == ContourSide::Start {
            self.require_contour_mut(&from.contour_id)?.reverse();
        }
        if to.side == ContourSide::End {
            self.require_contour_mut(&to.contour_id)?.reverse();
        }
        if mode == JoinMode::Merge && self.require_contour_mut(&from.contour_id)?.len() == 1 {
            // Merging a lone point onto another end just drops it; the other contour stays.
            self.remove_contour_checked(&from.contour_id)?;
            return Ok(());
        }
        let joined = self.remove_contour_checked(&to.contour_id)?;
        let target = self.require_contour_mut(&from.contour_id)?;
        if mode == JoinMode::Merge {
            target.points_mut().pop();
        }
        target.points_mut().extend(joined.points().iter().cloned());
        Ok(())
    }
}

impl Contour {
    /// The segment from `start_id` to `end_id`.
    fn segment_between(&self, start_id: &PointId, end_id: &PointId) -> CoreResult<SegmentIndices> {
        let points = self.points();
        SegmentIndexIter::new(points, self.is_closed())
            .find(|segment| {
                points[segment.first()].id() == *start_id
                    && segment
                        .points()
                        .last()
                        .is_some_and(|&last| points[last].id() == *end_id)
            })
            .ok_or_else(|| {
                ContourEditError::SegmentNotFound {
                    start: start_id.clone(),
                    end: end_id.clone(),
                }
                .into()
            })
    }

    /// Inserts `points` before the point at index `end`, a segment's end. A
    /// closed contour's closing segment ends at its first point; its new
    /// points go after its last point instead, so the start stays the same.
    fn insert_before_end(
        &mut self,
        end: usize,
        points: impl IntoIterator<Item = Point>,
    ) -> CoreResult<()> {
        if self.is_closed() && end == 0 {
            points.into_iter().for_each(|point| self.push_point(point));
            return Ok(());
        }
        let end_id = self.points()[end].id();
        for point in points {
            self.insert_before_id(&end_id, point)?;
        }
        Ok(())
    }

    fn insert_before_id(&mut self, before: &PointId, point: Point) -> CoreResult<()> {
        let index = self.point_index(before).require(before)?;
        self.insert_point(index, point);
        Ok(())
    }

    fn move_point_to(&mut self, id: &PointId, position: KurboPoint) -> CoreResult<()> {
        self.get_point_mut(id)
            .require(id)?
            .set_position(position.x, position.y);
        Ok(())
    }

    /// The point lists a deletion leaves of this contour, each surviving
    /// on-curve point joined to the next by the controls its span becomes,
    /// or cut where it becomes a gap.
    fn surviving_fragments(
        &self,
        surviving: &[usize],
        segments: &[SegmentIndices],
        selected: &HashSet<PointId>,
        mode: DeleteMode,
    ) -> CoreResult<Vec<Vec<Point>>> {
        let points = self.points();
        if let [only] = surviving {
            return Ok(vec![vec![points[*only].clone()]]);
        }

        let by_start = SegmentsByStart::new(segments);
        let count = surviving.len();
        let edge_count = if self.is_closed() { count } else { count - 1 };
        let mut edges: Vec<Option<Vec<Point>>> = Vec::with_capacity(edge_count);

        for index in 0..edge_count {
            let span = by_start
                .between(surviving[index], surviving[(index + 1) % count])
                .ok_or_else(|| ContourEditError::IncompleteSpan(self.id()))?;
            if let [segment] = span.as_slice() {
                edges.push(Some(if segment.loses_a_control(points, selected) {
                    Vec::new()
                } else {
                    segment.controls(points).cloned().collect()
                }));
                continue;
            }
            edges.push(match mode {
                DeleteMode::Gap => None,
                DeleteMode::Fit => Some(fitted_controls(points, &span)?),
            });
        }

        let mut fragments = Vec::new();
        let gap = edges.iter().position(Option::is_none);
        // Start after a cut, so a closed contour's wrapped surviving run stays together.
        let start_index = match (self.is_closed(), gap) {
            (true, Some(gap)) => (gap + 1) % count,
            _ => 0,
        };
        let mut fragment = vec![points[surviving[start_index]].clone()];
        for offset in 0..edge_count {
            let index = (start_index + offset) % count;
            let wraps = self.is_closed() && offset == edge_count - 1;
            match &edges[index] {
                None => fragments.push(std::mem::take(&mut fragment)),
                Some(controls) => fragment.extend(controls.iter().cloned()),
            }
            if !wraps {
                fragment.push(points[surviving[(index + 1) % count]].clone());
            }
        }
        if !fragment.is_empty() {
            fragments.push(fragment);
        }
        Ok(fragments)
    }
}

impl SegmentIndices {
    /// This segment's off-curve points in `points`.
    fn controls<'a>(&self, points: &'a [Point]) -> impl Iterator<Item = &'a Point> + use<'a> {
        let indices = self.points().to_vec();
        indices
            .into_iter()
            .map(|index| &points[index])
            .filter(|point| !point.is_on_curve())
    }

    /// Whether `selected` holds one of this segment's off-curve points.
    fn loses_a_control(&self, points: &[Point], selected: &HashSet<PointId>) -> bool {
        self.controls(points)
            .any(|point| selected.contains(&point.id()))
    }

    /// This segment as a curve through `points`.
    fn path_segment(&self, points: &[Point]) -> PathSeg {
        let at = |index: usize| points[index].position();
        match *self {
            Self::Line([a, b]) => Line::new(at(a), at(b)).into(),
            Self::Quad([a, c, b]) => QuadBez::new(at(a), at(c), at(b)).into(),
            Self::Cubic([a, c0, c1, b]) => CubicBez::new(at(a), at(c0), at(c1), at(b)).into(),
        }
    }
}

/// A contour's segments by the index of their first point.
struct SegmentsByStart<'a>(HashMap<usize, &'a SegmentIndices>);

impl<'a> SegmentsByStart<'a> {
    fn new(segments: &'a [SegmentIndices]) -> Self {
        Self(
            segments
                .iter()
                .map(|segment| (segment.first(), segment))
                .collect(),
        )
    }

    /// The segments from on-curve index `start` to `end`, each following the
    /// last; `None` when they break off before `end`.
    fn between(&self, start: usize, end: usize) -> Option<Vec<&'a SegmentIndices>> {
        let mut span = Vec::new();
        let mut cursor = start;
        while cursor != end {
            if span.len() >= self.0.len() {
                return None;
            }
            let segment = *self.0.get(&cursor)?;
            span.push(segment);
            cursor = *segment.points().last()?;
        }
        Some(span)
    }
}

/// The controls one segment approximating `span` takes: none for lines, one
/// fitted control without cubics, two otherwise. Each is a new point.
fn fitted_controls(points: &[Point], span: &[&SegmentIndices]) -> CoreResult<Vec<Point>> {
    let curves: Vec<PathSeg> = span
        .iter()
        .map(|segment| segment.path_segment(points))
        .collect();
    if curves.iter().all(|curve| matches!(curve, PathSeg::Line(_))) {
        return Ok(Vec::new());
    }
    if !curves
        .iter()
        .any(|curve| matches!(curve, PathSeg::Cubic(_)))
    {
        let fitted = fit_quadratic(&curves).map_err(ContourEditError::from)?;
        return Ok(vec![Point::off_curve_at(fitted.p1)]);
    }
    let fitted = fit_cubic(&curves).map_err(ContourEditError::from)?;
    Ok(vec![
        Point::off_curve_at(fitted.p1),
        Point::off_curve_at(fitted.p2),
    ])
}

#[cfg(test)]
mod tests;
