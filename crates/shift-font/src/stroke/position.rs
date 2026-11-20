//! Strokes placed on a side of their skeleton, and one-sided offsets.
//!
//! The side comes from the path's direction, as in Glyphs' Offset Curve
//! `Position`: **left** is the left of the direction of travel, in a y-up
//! coordinate system. A closed counter-clockwise contour has its inside on
//! the left, so left reads as inside there. A position is a fraction of the
//! way from the centre: `-1` is entirely left, `0` centred, `+1` entirely
//! right (shown as −100 % … +100 %).
//!
//! [`offset_path`] is the primitive: the parallel curve of an open or closed
//! path at a signed distance, joined at corners as a stroke joins them.
//! [`aligned_outline`] builds the stroke from two offsets of the skeleton, at
//! `−position × width / 2 ± width / 2`, joined by the caps; `position = 0` is
//! the centred stroke. [`super::exact_offset::outline`] calls it for every
//! style. (Shifting the skeleton and then stroking it centred gives the same
//! shape at three times the points; the spike compares them.)

use kurbo::{
    Arc, BezPath, Cap, CubicBez, Join, ParamCurve, PathEl, PathSeg, Point, Vec2,
    offset::offset_cubic,
};

use super::exact_offset::{ExactStrokeStyle, centred_outline};

/// The stroke of `skeleton` at `style`, placed by `style.position`: `0.0`
/// centred, `-1.0` entirely left of its direction, `1.0` entirely right.
/// Values between slide it.
pub fn aligned_outline(skeleton: &BezPath, style: &ExactStrokeStyle, tolerance: f64) -> BezPath {
    let position = style.position;
    if position == 0.0 {
        return centred_outline(skeleton, style, tolerance);
    }

    let side = -position;
    let half = style.width / 2.0;
    let left = side * half + half;
    let right = side * half - half;
    let mut result = BezPath::new();

    for subpath in subpaths(skeleton) {
        let mut left_edge = BezPath::new();
        let mut right_edge = BezPath::new();
        offset_subpath(
            &subpath,
            left,
            style.join,
            style.miter_limit,
            tolerance,
            &mut left_edge,
        );
        offset_subpath(
            &subpath,
            right,
            style.join,
            style.miter_limit,
            tolerance,
            &mut right_edge,
        );

        if subpath.closed {
            result.extend(left_edge.elements().iter().copied());
            result.extend(right_edge.reverse_subpaths().elements().iter().copied());
            continue;
        }

        let (first_tangent, _) = unit_tangents(&subpath.segments[0]);
        let (_, last_tangent) = unit_tangents(&subpath.segments[subpath.segments.len() - 1]);
        let start = subpath.segments[0].start();
        let end = subpath.segments[subpath.segments.len() - 1].end();
        let shift = side * half;

        result.extend(left_edge.elements().iter().copied());
        add_cap(
            &mut result,
            end + shift * last_tangent.turn_90(),
            half * last_tangent.turn_90(),
            last_tangent,
            style.cap,
            tolerance,
        );
        result.extend(
            right_edge
                .reverse_subpaths()
                .elements()
                .iter()
                .copied()
                .skip(1),
        );
        add_cap(
            &mut result,
            start + shift * first_tangent.turn_90(),
            -half * first_tangent.turn_90(),
            -first_tangent,
            style.cap,
            tolerance,
        );
        result.close_path();
    }

    result
}

/// Closes an open stroke's end: from `center + from` round to `center - from`
/// through the side `outward` points to.
fn add_cap(
    result: &mut BezPath,
    center: Point,
    from: Vec2,
    outward: Vec2,
    cap: Cap,
    tolerance: f64,
) {
    let to = -from;

    match cap {
        Cap::Butt => result.line_to(center + to),
        Cap::Square => {
            let push = outward * from.hypot();
            result.line_to(center + from + push);
            result.line_to(center + to + push);
            result.line_to(center + to);
        }
        Cap::Round => {
            let radius = from.hypot();
            let sweep = if from.cross(outward) >= 0.0 {
                std::f64::consts::PI
            } else {
                -std::f64::consts::PI
            };
            let arc = Arc::new(
                center,
                (radius, radius),
                libm::atan2(from.y, from.x),
                sweep,
                0.0,
            );
            arc.to_cubic_beziers(tolerance, |first, second, point| {
                result.curve_to(first, second, point);
            });
        }
    }
}

/// The parallel curve of `path` at signed `distance`: positive to the left of
/// the direction of travel, negative to the right.
///
/// Every subpath keeps its openness. Where the offset opens a gap at a corner
/// it is filled as `join` says; where it overlaps, the two offset segments
/// meet in a line, as kurbo's stroker does, and a nonzero fill reads it right.
pub fn offset_path(
    path: &BezPath,
    distance: f64,
    join: Join,
    miter_limit: f64,
    tolerance: f64,
) -> BezPath {
    let mut result = BezPath::new();

    for subpath in subpaths(path) {
        offset_subpath(
            &subpath,
            distance,
            join,
            miter_limit,
            tolerance,
            &mut result,
        );
    }

    result
}

struct Subpath {
    segments: Vec<PathSeg>,
    closed: bool,
}

fn subpaths(path: &BezPath) -> Vec<Subpath> {
    let mut found = Vec::new();
    let mut segments: Vec<PathSeg> = Vec::new();
    let mut start = Point::ZERO;
    let mut current = Point::ZERO;

    let finish = |segments: &mut Vec<PathSeg>, closed: bool, found: &mut Vec<Subpath>| {
        if !segments.is_empty() {
            found.push(Subpath {
                segments: std::mem::take(segments),
                closed,
            });
        }
    };

    for element in path.elements() {
        match *element {
            PathEl::MoveTo(point) => {
                finish(&mut segments, false, &mut found);
                start = point;
                current = point;
            }
            PathEl::LineTo(point) => {
                push_segment(
                    &mut segments,
                    PathSeg::Line(kurbo::Line::new(current, point)),
                );
                current = point;
            }
            PathEl::QuadTo(control, point) => {
                push_segment(
                    &mut segments,
                    PathSeg::Quad(kurbo::QuadBez::new(current, control, point)),
                );
                current = point;
            }
            PathEl::CurveTo(first, second, point) => {
                push_segment(
                    &mut segments,
                    PathSeg::Cubic(CubicBez::new(current, first, second, point)),
                );
                current = point;
            }
            PathEl::ClosePath => {
                push_segment(
                    &mut segments,
                    PathSeg::Line(kurbo::Line::new(current, start)),
                );
                finish(&mut segments, true, &mut found);
                current = start;
            }
        }
    }
    finish(&mut segments, false, &mut found);

    found
}

fn push_segment(segments: &mut Vec<PathSeg>, segment: PathSeg) {
    let degenerate = segment.start() == segment.end()
        && match segment {
            PathSeg::Line(_) => true,
            PathSeg::Quad(quad) => quad.p1 == quad.p0,
            PathSeg::Cubic(cubic) => cubic.p1 == cubic.p0 && cubic.p2 == cubic.p0,
        };
    if !degenerate {
        segments.push(segment);
    }
}

fn offset_subpath(
    subpath: &Subpath,
    distance: f64,
    join: Join,
    miter_limit: f64,
    tolerance: f64,
    result: &mut BezPath,
) {
    let segments = &subpath.segments;
    let Some(first) = segments.first() else {
        return;
    };

    let mut start_point = None;

    for (index, segment) in segments.iter().enumerate() {
        let (start_tangent, _) = unit_tangents(segment);

        if index == 0 {
            let start = segment.start() + distance * start_tangent.turn_90();
            result.move_to(start);
            start_point = Some(start);
        } else {
            let previous = segments[index - 1];
            let (_, previous_end) = unit_tangents(&previous);
            add_join(
                result,
                segment.start(),
                previous_end,
                start_tangent,
                distance,
                join,
                miter_limit,
                tolerance,
            );
        }

        append_offset(result, segment, distance, tolerance);
    }

    if !subpath.closed {
        return;
    }

    let last = segments[segments.len() - 1];
    let (_, last_end) = unit_tangents(&last);
    let (first_start, _) = unit_tangents(first);
    add_join(
        result,
        first.start(),
        last_end,
        first_start,
        distance,
        join,
        miter_limit,
        tolerance,
    );
    if let Some(start) = start_point
        && let Some(PathEl::LineTo(end)) = result.elements().last().copied()
        && end.distance(start) <= tolerance * 1e-3
    {
        result.pop();
    }
    result.close_path();
}

/// Unit tangents at the start and the end of `segment`, taken from the first
/// control point that is not on the end, as a stroke does.
fn unit_tangents(segment: &PathSeg) -> (Vec2, Vec2) {
    let (start, end) = match *segment {
        PathSeg::Line(line) => (line.p1 - line.p0, line.p1 - line.p0),
        PathSeg::Quad(quad) => (
            first_nonzero(&[quad.p1 - quad.p0, quad.p2 - quad.p0]),
            first_nonzero(&[quad.p2 - quad.p1, quad.p2 - quad.p0]),
        ),
        PathSeg::Cubic(cubic) => (
            first_nonzero(&[
                cubic.p1 - cubic.p0,
                cubic.p2 - cubic.p0,
                cubic.p3 - cubic.p0,
            ]),
            first_nonzero(&[
                cubic.p3 - cubic.p2,
                cubic.p3 - cubic.p1,
                cubic.p3 - cubic.p0,
            ]),
        ),
    };

    (start.normalize(), end.normalize())
}

fn first_nonzero(candidates: &[Vec2]) -> Vec2 {
    candidates
        .iter()
        .copied()
        .find(|vector| vector.hypot2() > 1e-18)
        .unwrap_or(Vec2::new(1.0, 0.0))
}

fn append_offset(result: &mut BezPath, segment: &PathSeg, distance: f64, tolerance: f64) {
    if distance == 0.0 {
        match *segment {
            PathSeg::Line(line) => result.line_to(line.p1),
            PathSeg::Quad(quad) => result.quad_to(quad.p1, quad.p2),
            PathSeg::Cubic(cubic) => result.curve_to(cubic.p1, cubic.p2, cubic.p3),
        }
        return;
    }

    match *segment {
        PathSeg::Line(line) => {
            let normal = (line.p1 - line.p0).normalize().turn_90() * distance;
            result.line_to(line.p1 + normal);
        }
        PathSeg::Quad(quad) => append_cubic_offset(result, quad.raise(), distance, tolerance),
        PathSeg::Cubic(cubic) => append_cubic_offset(result, cubic, distance, tolerance),
    }
}

fn append_cubic_offset(result: &mut BezPath, cubic: CubicBez, distance: f64, tolerance: f64) {
    if is_straight(&cubic, tolerance) {
        let normal = (cubic.p3 - cubic.p0).normalize().turn_90() * distance;
        result.line_to(cubic.p3 + normal);
        return;
    }

    let mut offset = BezPath::new();
    offset_cubic(cubic, distance, tolerance, &mut offset);
    for element in offset.elements().iter().skip(1) {
        result.push(*element);
    }
}

/// Whether both control points lie within `tolerance` of the chord, which
/// `offset_cubic` does not accept.
fn is_straight(cubic: &CubicBez, tolerance: f64) -> bool {
    let chord = cubic.p3 - cubic.p0;
    let length = chord.hypot();
    if length < 1e-12 {
        return false;
    }

    let off = |p: Point| ((p - cubic.p0).cross(chord) / length).abs();
    off(cubic.p1) <= tolerance * 0.1 && off(cubic.p2) <= tolerance * 0.1
}

/// Connects the offset of the segment ending at `corner` to the offset of the
/// one starting there.
#[allow(clippy::too_many_arguments)]
fn add_join(
    result: &mut BezPath,
    corner: Point,
    end_tangent: Vec2,
    start_tangent: Vec2,
    distance: f64,
    join: Join,
    miter_limit: f64,
    tolerance: f64,
) {
    let from = distance * end_tangent.turn_90();
    let to = distance * start_tangent.turn_90();
    if (to - from).hypot() <= tolerance * 1e-3 {
        return;
    }

    let cross = end_tangent.cross(start_tangent);
    let opens_a_gap = cross * distance < 0.0;
    if !opens_a_gap {
        result.line_to(corner + to);
        return;
    }

    match join {
        Join::Bevel => result.line_to(corner + to),
        Join::Miter => {
            let cosine = end_tangent.dot(start_tangent);
            let half_cosine = ((1.0 + cosine) / 2.0).max(0.0).sqrt();
            let within_limit = half_cosine > 1e-9 && 1.0 / half_cosine <= miter_limit;
            if within_limit {
                let tip = (from + to) / (1.0 + cosine);
                result.line_to(corner + tip);
            }
            result.line_to(corner + to);
        }
        Join::Round => {
            let radius = distance.abs();
            let start_angle = libm::atan2(from.y, from.x);
            let sweep = libm::atan2(from.cross(to), from.dot(to));
            let arc = Arc::new(corner, (radius, radius), start_angle, sweep, 0.0);
            arc.to_cubic_beziers(tolerance, |first, second, point| {
                result.curve_to(first, second, point);
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use kurbo::{Cap, ParamCurveNearest, Shape};

    use super::super::exact_offset::outline;
    use super::*;

    /// `style` placed at `position`.
    fn aligned_outline(
        skeleton: &BezPath,
        style: &ExactStrokeStyle,
        position: f64,
        tolerance: f64,
    ) -> BezPath {
        let placed = ExactStrokeStyle { position, ..*style };
        super::aligned_outline(skeleton, &placed, tolerance)
    }

    const TOLERANCE: f64 = 0.25;

    fn style(width: f64, cap: Cap, join: Join) -> ExactStrokeStyle {
        ExactStrokeStyle {
            width,
            cap,
            join,
            miter_limit: 4.0,
            position: 0.0,
        }
    }

    fn line(from: (f64, f64), to: (f64, f64)) -> BezPath {
        let mut path = BezPath::new();
        path.move_to(from);
        path.line_to(to);
        path
    }

    fn polyline(points: &[(f64, f64)], close: bool) -> BezPath {
        let mut path = BezPath::new();
        path.move_to(points[0]);
        for point in &points[1..] {
            path.line_to(*point);
        }
        if close {
            path.close_path();
        }
        path
    }

    /// A circle of `radius` about the origin, counter-clockwise.
    fn circle(radius: f64) -> BezPath {
        kurbo::Circle::new((0.0, 0.0), radius).to_path(0.01)
    }

    /// Points inside `path` (nonzero fill), sampled on a grid of `step`.
    fn covered_area(path: &BezPath, step: f64) -> f64 {
        let bounds = path.bounding_box();
        let mut count = 0_u64;
        let mut x = bounds.x0;
        while x <= bounds.x1 {
            let mut y = bounds.y0;
            while y <= bounds.y1 {
                if path.winding(Point::new(x + step / 2.0, y + step / 2.0)) != 0 {
                    count += 1;
                }
                y += step;
            }
            x += step;
        }

        count as f64 * step * step
    }

    fn bounds(path: &BezPath) -> (f64, f64, f64, f64) {
        let rect = path.bounding_box();
        (rect.x0, rect.y0, rect.x1, rect.y1)
    }

    fn close(actual: f64, expected: f64, tolerance: f64) -> bool {
        (actual - expected).abs() <= tolerance
    }

    #[test]
    fn a_line_strokes_to_the_left_or_right_of_its_direction() {
        let skeleton = line((0.0, 0.0), (100.0, 0.0));
        let butt = style(20.0, Cap::Butt, Join::Round);

        let left = aligned_outline(&skeleton, &butt, -1.0, TOLERANCE);
        let right = aligned_outline(&skeleton, &butt, 1.0, TOLERANCE);
        let centred = aligned_outline(&skeleton, &butt, 0.0, TOLERANCE);

        let (_, bottom, _, top) = bounds(&left);
        assert!(
            close(bottom, 0.0, 0.01) && close(top, 20.0, 0.01),
            "{:?}",
            bounds(&left)
        );
        let (_, bottom, _, top) = bounds(&right);
        assert!(
            close(bottom, -20.0, 0.01) && close(top, 0.0, 0.01),
            "{:?}",
            bounds(&right)
        );
        let (_, bottom, _, top) = bounds(&centred);
        assert!(close(bottom, -10.0, 0.01) && close(top, 10.0, 0.01));
        assert!(close(covered_area(&left, 0.5), 2000.0, 20.0));
    }

    #[test]
    fn reversing_the_path_swaps_the_side() {
        let forward = line((0.0, 0.0), (100.0, 0.0));
        let backward = line((100.0, 0.0), (0.0, 0.0));
        let butt = style(20.0, Cap::Butt, Join::Round);

        let (_, bottom, _, top) = bounds(&aligned_outline(&backward, &butt, -1.0, TOLERANCE));

        assert!(close(bottom, -20.0, 0.01) && close(top, 0.0, 0.01));
        let _ = forward;
    }

    #[test]
    fn a_half_position_slides_the_stroke_half_way() {
        let skeleton = line((0.0, 0.0), (100.0, 0.0));
        let butt = style(20.0, Cap::Butt, Join::Round);

        let (_, bottom, _, top) = bounds(&aligned_outline(&skeleton, &butt, -0.5, TOLERANCE));

        assert!(close(bottom, -5.0, 0.01) && close(top, 15.0, 0.01));
    }

    #[test]
    fn round_caps_stay_centred_on_the_shifted_line() {
        let skeleton = line((0.0, 0.0), (100.0, 0.0));
        let round = style(20.0, Cap::Round, Join::Round);

        let (left, bottom, right, top) =
            bounds(&aligned_outline(&skeleton, &round, -1.0, TOLERANCE));

        assert!(close(left, -10.0, 0.1) && close(right, 110.0, 0.1));
        assert!(close(bottom, 0.0, 0.1) && close(top, 20.0, 0.1));
    }

    #[test]
    fn a_counter_clockwise_circle_has_its_left_inside() {
        let skeleton = circle(100.0);
        let round = style(20.0, Cap::Butt, Join::Round);

        let left = aligned_outline(&skeleton, &round, -1.0, TOLERANCE);
        let right = aligned_outline(&skeleton, &round, 1.0, TOLERANCE);

        let (min_x, _, max_x, _) = bounds(&left);
        assert!(close(max_x, 100.0, 0.3) && close(min_x, -100.0, 0.3));
        assert!(winding_at(&left, 90.0, 0.0) != 0, "inside ring is filled");
        assert!(winding_at(&left, 70.0, 0.0) == 0, "hole stays open");
        assert!(winding_at(&left, 110.0, 0.0) == 0, "outside stays empty");

        let (_, _, outer, _) = bounds(&right);
        assert!(close(outer, 120.0, 0.3));
        assert!(winding_at(&right, 110.0, 0.0) != 0);
        assert!(winding_at(&right, 90.0, 0.0) == 0);
    }

    fn winding_at(path: &BezPath, x: f64, y: f64) -> i32 {
        path.winding(Point::new(x, y))
    }

    /// For each point of `outline`, its distance to `skeleton` is one of
    /// `expected` within the returned error; points near an open end are
    /// skipped because caps live there.
    fn distance_error(
        skeleton: &BezPath,
        outline: &BezPath,
        expected: &[f64],
        skip_near: &[Point],
        skip_radius: f64,
    ) -> f64 {
        let mut worst = 0.0_f64;
        let flat = flatten_points(outline, 0.05);
        for point in flat {
            if skip_near
                .iter()
                .any(|end| end.distance(point) < skip_radius)
            {
                continue;
            }
            let distance = skeleton
                .segments()
                .map(|segment| segment.nearest(point, 1e-4).distance_sq.sqrt())
                .fold(f64::INFINITY, f64::min);
            let off = expected
                .iter()
                .map(|value| (distance - value).abs())
                .fold(f64::INFINITY, f64::min);
            worst = worst.max(off);
        }

        worst
    }

    fn flatten_points(path: &BezPath, tolerance: f64) -> Vec<Point> {
        let mut points = Vec::new();
        kurbo::flatten(path.iter(), tolerance, |element| match element {
            PathEl::MoveTo(point) | PathEl::LineTo(point) => points.push(point),
            _ => {}
        });

        points
    }

    /// A tight alternating skeleton: curvature radius under 10 units.
    fn wavy(cubics: usize) -> BezPath {
        let mut path = BezPath::new();
        path.move_to((0.0, 0.0));
        for index in 0..cubics {
            let x = (index + 1) as f64 * 12.0;
            let bend = if index % 2 == 0 { 40.0 } else { -40.0 };
            path.curve_to((x - 9.0, bend), (x - 3.0, -bend), (x, bend * 0.5));
        }
        path
    }

    /// A glyph-like skeleton: a sine of amplitude 30 and wavelength 251,
    /// one cubic per 8 units.
    fn smooth(cubics: usize) -> BezPath {
        let height = |x: f64| 30.0 * libm::sin(x / 40.0);
        let slope = |x: f64| 30.0 / 40.0 * libm::cos(x / 40.0);
        let mut path = BezPath::new();
        path.move_to((0.0, 0.0));
        for index in 0..cubics {
            let x0 = index as f64 * 8.0;
            let x1 = x0 + 8.0;
            path.curve_to(
                (x0 + 8.0 / 3.0, height(x0) + slope(x0) * 8.0 / 3.0),
                (x1 - 8.0 / 3.0, height(x1) - slope(x1) * 8.0 / 3.0),
                (x1, height(x1)),
            );
        }
        path
    }

    fn end_points(skeleton: &BezPath) -> [Point; 2] {
        let first = skeleton.segments().next().unwrap().start();
        [first, skeleton.segments().last().unwrap().end()]
    }

    #[test]
    fn a_curved_skeleton_has_its_edges_at_zero_and_full_width() {
        let skeleton = smooth(30);
        let butt = style(6.0, Cap::Butt, Join::Round);
        let ends = end_points(&skeleton);

        for side in [1.0, -1.0] {
            let outline = aligned_outline(&skeleton, &butt, side, TOLERANCE);
            let error = distance_error(&skeleton, &outline, &[0.0, 6.0], &ends, 7.0);
            println!("SPIKE smooth side={side} max deviation from {{0, width}} = {error:.3}");
            assert!(error <= TOLERANCE * 2.0, "side {side}: {error}");
        }
    }

    #[test]
    fn an_open_offset_sits_at_the_distance_on_the_left_and_right() {
        let skeleton = smooth(30);
        let ends = end_points(&skeleton);

        for distance in [4.0, -4.0] {
            let offset = offset_path(&skeleton, distance, Join::Round, 4.0, TOLERANCE);
            let error = distance_error(&skeleton, &offset, &[distance.abs()], &ends, 0.0);
            println!("SPIKE offset d={distance} max deviation = {error:.3}");
            assert!(error <= TOLERANCE * 2.0, "d {distance}: {error}");
            assert!(
                !matches!(offset.elements().last(), Some(PathEl::ClosePath)),
                "an open path stays open"
            );
        }
    }

    /// Shifting the skeleton and stroking centred: the construction the
    /// direct one replaced.
    fn by_shifting(skeleton: &BezPath, style: &ExactStrokeStyle, position: f64) -> BezPath {
        let side = -position;
        let shifted = offset_path(
            skeleton,
            side * style.width / 2.0,
            style.join,
            style.miter_limit,
            TOLERANCE,
        );
        outline(&shifted, style, TOLERANCE)
    }

    /// Fraction of `step`-grid cells where exactly one of the two fills.
    fn disagreement(a: &BezPath, b: &BezPath, step: f64) -> f64 {
        let bounds = a.bounding_box().union(b.bounding_box());
        let (mut differ, mut total) = (0_u64, 0_u64);
        let mut x = bounds.x0;
        while x <= bounds.x1 {
            let mut y = bounds.y0;
            while y <= bounds.y1 {
                let point = Point::new(x + step / 2.0, y + step / 2.0);
                let in_a = a.winding(point) != 0;
                let in_b = b.winding(point) != 0;
                if in_a || in_b {
                    total += 1;
                    if in_a != in_b {
                        differ += 1;
                    }
                }
                y += step;
            }
            x += step;
        }

        differ as f64 / total as f64
    }

    #[test]
    fn building_from_two_offsets_agrees_with_shifting_then_stroking() {
        let skeleton = smooth(30);

        for cap in [Cap::Butt, Cap::Square, Cap::Round] {
            for side in [1.0, -0.5] {
                let wide = style(14.0, cap, Join::Round);
                let direct = aligned_outline(&skeleton, &wide, side, TOLERANCE);
                let shifted = by_shifting(&skeleton, &wide, side);
                let gap = disagreement(&direct, &shifted, 0.5);
                println!(
                    "SPIKE direct vs shifted {cap:?} side={side}: {:.3}% differ",
                    gap * 100.0
                );
                assert!(gap < 0.01, "{cap:?} {side}: {gap}");
            }
        }
    }

    #[test]
    fn a_vanishing_position_meets_the_centred_stroke() {
        let skeleton = smooth(30);

        for cap in [Cap::Butt, Cap::Square, Cap::Round] {
            let wide = style(14.0, cap, Join::Round);
            let nearly = aligned_outline(&skeleton, &wide, 1e-9, TOLERANCE);
            let centred = aligned_outline(&skeleton, &wide, 0.0, TOLERANCE);
            let gap = disagreement(&nearly, &centred, 0.5);
            println!(
                "SPIKE side→0 vs centred {cap:?}: {:.3}% differ",
                gap * 100.0
            );
            assert!(gap < 0.01, "{cap:?}: {gap}");
        }
    }

    #[test]
    fn a_closed_contour_keeps_its_ring_on_the_chosen_side() {
        let skeleton = polyline(
            &[(0.0, 0.0), (100.0, 0.0), (100.0, 100.0), (0.0, 100.0)],
            true,
        );
        let mitred = style(20.0, Cap::Butt, Join::Miter);

        let inside = aligned_outline(&skeleton, &mitred, -1.0, TOLERANCE);
        let outside = aligned_outline(&skeleton, &mitred, 1.0, TOLERANCE);

        assert!(close(
            covered_area(&inside, 0.5),
            100.0 * 100.0 - 60.0 * 60.0,
            60.0
        ));
        assert!(close(
            covered_area(&outside, 0.5),
            140.0 * 140.0 - 100.0 * 100.0,
            60.0
        ));
    }

    #[test]
    fn square_caps_extend_the_shifted_line_by_the_half_width() {
        let skeleton = line((0.0, 0.0), (100.0, 0.0));
        let square = style(20.0, Cap::Square, Join::Round);

        let (left, bottom, right, top) =
            bounds(&aligned_outline(&skeleton, &square, -1.0, TOLERANCE));

        assert!(close(left, -10.0, 0.01) && close(right, 110.0, 0.01));
        assert!(close(bottom, 0.0, 0.01) && close(top, 20.0, 0.01));
    }

    #[test]
    fn an_outer_corner_follows_the_join_and_an_inner_corner_does_not_add_one() {
        // Turns left at (100, 0); left is the inside of the turn.
        let skeleton = polyline(&[(0.0, 0.0), (100.0, 0.0), (100.0, 100.0)], false);
        let round = Join::Round;

        let outer = offset_path(&skeleton, -20.0, round, 4.0, TOLERANCE);
        let inner = offset_path(&skeleton, 20.0, round, 4.0, TOLERANCE);

        let round_count = outer
            .elements()
            .iter()
            .filter(|element| matches!(element, PathEl::CurveTo(..)))
            .count();
        assert!(round_count >= 1, "outer corner is rounded");
        assert!(
            inner
                .elements()
                .iter()
                .all(|element| !matches!(element, PathEl::CurveTo(..))),
            "inner corner has no arc"
        );

        // Miter reaches the true corner of the offset lines; bevel cuts it.
        let miter = offset_path(&skeleton, -20.0, Join::Miter, 4.0, TOLERANCE);
        let bevel = offset_path(&skeleton, -20.0, Join::Bevel, 4.0, TOLERANCE);
        let (_, miter_bottom, miter_right, _) = bounds(&miter);
        let (_, bevel_bottom, bevel_right, _) = bounds(&bevel);
        assert!(close(miter_bottom, -20.0, 0.01) && close(miter_right, 120.0, 0.01));
        assert!(close(bevel_bottom, -20.0, 0.01) && close(bevel_right, 120.0, 0.01));
        assert!(miter.elements().len() > bevel.elements().len());
    }

    #[test]
    fn a_miter_past_the_limit_falls_back_to_a_bevel() {
        let sharp = polyline(&[(0.0, 0.0), (100.0, 0.0), (0.0, 5.0)], false);

        let limited = offset_path(&sharp, -10.0, Join::Miter, 2.0, TOLERANCE);
        let unlimited = offset_path(&sharp, -10.0, Join::Miter, 100.0, TOLERANCE);

        assert!(bounds(&unlimited).2 > bounds(&limited).2 + 10.0);
    }

    #[test]
    fn a_closed_offset_matches_the_expand_the_app_already_uses() {
        let skeleton = circle(100.0);

        let outward = offset_path(&skeleton, -20.0, Join::Round, 4.0, TOLERANCE);
        let inward = offset_path(&skeleton, 20.0, Join::Round, 4.0, TOLERANCE);

        assert!(close(bounds(&outward).2, 120.0, 0.3));
        assert!(close(bounds(&inward).2, 80.0, 0.3));
        assert!(matches!(outward.elements().last(), Some(PathEl::ClosePath)));
    }

    #[test]
    fn a_stroke_wider_than_the_curvature_behaves_as_the_centred_one_does() {
        // Inside of a radius-10 circle shifted 30: the sweep reaches radius
        // 20 and covers the middle. Report whether the stroker agrees, and
        // whether the centred stroke it builds on already differs.
        let skeleton = circle(10.0);
        let round = style(30.0, Cap::Butt, Join::Round);

        let left = aligned_outline(&skeleton, &round, -1.0, TOLERANCE);
        let centred = aligned_outline(&circle(5.0), &round, 0.0, TOLERANCE);

        println!(
            "SPIKE tight circle: left winding at centre {}, centred r=5 winding at centre {}",
            winding_at(&left, 0.0, 0.0),
            winding_at(&centred, 0.0, 0.0)
        );
        assert_eq!(
            winding_at(&left, 0.0, 0.0) != 0,
            winding_at(&centred, 0.0, 0.0) != 0,
            "both fill or both leave the middle open"
        );
        assert!(winding_at(&left, 19.0, 0.0) != 0);
        assert!(winding_at(&left, 21.0, 0.0) == 0);
    }

    #[test]
    fn perf_mark_one_sided_stroke_costs_about_what_a_centred_one_does() {
        for (name, skeleton) in [("smooth", smooth(67)), ("tight", wavy(67))] {
            perf_mark(name, &skeleton);
        }
    }

    fn perf_mark(name: &str, skeleton: &BezPath) {
        const RUNS: usize = 21;
        use std::time::Instant;

        let round = style(20.0, Cap::Round, Join::Round);

        let time = |build: &dyn Fn() -> BezPath| {
            let mut samples = Vec::new();
            let mut points = 0;
            for _ in 0..RUNS {
                let started = Instant::now();
                let outline = build();
                samples.push(started.elapsed().as_secs_f64() * 1000.0);
                points = super::super::count_on_curve(&outline);
            }
            samples.sort_by(f64::total_cmp);
            (samples[RUNS / 2], points)
        };

        let (centred_ms, centred_points) =
            time(&|| aligned_outline(skeleton, &round, 0.0, TOLERANCE));
        let (left_ms, left_points) = time(&|| aligned_outline(skeleton, &round, -1.0, TOLERANCE));
        let (shifted_ms, shifted_points) = time(&|| by_shifting(skeleton, &round, -1.0));
        println!(
            "SPIKE perf {name} 67 cubics: centred {centred_ms:.3} ms / {centred_points} on-curve; \
             direct left {left_ms:.3} ms / {left_points}; shift-then-stroke {shifted_ms:.3} ms / {shifted_points}"
        );
    }
}
