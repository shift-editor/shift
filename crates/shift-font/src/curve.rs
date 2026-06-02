use crate::CurveSegment;

/// Tight axis-aligned bounding box for a curve segment.
/// Returns `(min_x, min_y, max_x, max_y)`.
pub fn segment_bounds(segment: &CurveSegment) -> (f64, f64, f64, f64) {
    match segment {
        CurveSegment::Line(p0, p1) => line_bounds(p0.x(), p0.y(), p1.x(), p1.y()),
        CurveSegment::Quad(p0, c, p1) => quad_bounds(p0.x(), p0.y(), c.x(), c.y(), p1.x(), p1.y()),
        CurveSegment::Cubic(p0, c0, c1, p1) => cubic_bounds(
            [p0.x(), c0.x(), c1.x(), p1.x()],
            [p0.y(), c0.y(), c1.y(), p1.y()],
        ),
    }
}

fn line_bounds(x0: f64, y0: f64, x1: f64, y1: f64) -> (f64, f64, f64, f64) {
    (x0.min(x1), y0.min(y1), x0.max(x1), y0.max(y1))
}

fn quad_bounds(x0: f64, y0: f64, cx: f64, cy: f64, x1: f64, y1: f64) -> (f64, f64, f64, f64) {
    let mut min_x = x0.min(x1);
    let mut max_x = x0.max(x1);
    let mut min_y = y0.min(y1);
    let mut max_y = y0.max(y1);

    if let Some(t) = find_quad_extremum_1d(x0, cx, x1) {
        let v = quad_eval_1d(x0, cx, x1, t);
        min_x = min_x.min(v);
        max_x = max_x.max(v);
    }

    if let Some(t) = find_quad_extremum_1d(y0, cy, y1) {
        let v = quad_eval_1d(y0, cy, y1, t);
        min_y = min_y.min(v);
        max_y = max_y.max(v);
    }

    (min_x, min_y, max_x, max_y)
}

fn cubic_bounds(xs: [f64; 4], ys: [f64; 4]) -> (f64, f64, f64, f64) {
    let mut min_x = xs[0].min(xs[3]);
    let mut max_x = xs[0].max(xs[3]);
    let mut min_y = ys[0].min(ys[3]);
    let mut max_y = ys[0].max(ys[3]);

    for t in find_cubic_extrema_1d(xs[0], xs[1], xs[2], xs[3]) {
        let v = cubic_eval_1d(xs[0], xs[1], xs[2], xs[3], t);
        min_x = min_x.min(v);
        max_x = max_x.max(v);
    }

    for t in find_cubic_extrema_1d(ys[0], ys[1], ys[2], ys[3]) {
        let v = cubic_eval_1d(ys[0], ys[1], ys[2], ys[3], t);
        min_y = min_y.min(v);
        max_y = max_y.max(v);
    }

    (min_x, min_y, max_x, max_y)
}

/// Solve derivative of quadratic Bézier for one axis.
/// Derivative: 2(1-t)(c - p0) + 2t(p1 - c) = 0
/// => t = (p0 - c) / (p0 - 2c + p1)
fn find_quad_extremum_1d(p0: f64, c: f64, p1: f64) -> Option<f64> {
    let denom = p0 - 2.0 * c + p1;
    if denom.abs() < 1e-12 {
        return None;
    }
    let t = (p0 - c) / denom;
    if t > 0.0 && t < 1.0 {
        Some(t)
    } else {
        None
    }
}

/// Solve derivative of cubic Bézier for one axis.
/// Derivative coefficients:
///   a = -3·p0 + 9·c0 - 9·c1 + 3·p1
///   b =  6·p0 - 12·c0 + 6·c1
///   c = -3·p0 + 3·c0
/// Solve at² + bt + c = 0, keep roots in (0, 1).
fn find_cubic_extrema_1d(p0: f64, c0: f64, c1: f64, p1: f64) -> Vec<f64> {
    let a = -3.0 * p0 + 9.0 * c0 - 9.0 * c1 + 3.0 * p1;
    let b = 6.0 * p0 - 12.0 * c0 + 6.0 * c1;
    let c = -3.0 * p0 + 3.0 * c0;

    let mut roots = Vec::with_capacity(2);

    if a.abs() < 1e-12 {
        // Linear: bt + c = 0
        if b.abs() > 1e-12 {
            let t = -c / b;
            if t > 0.0 && t < 1.0 {
                roots.push(t);
            }
        }
        return roots;
    }

    let discriminant = b * b - 4.0 * a * c;
    if discriminant < 0.0 {
        return roots;
    }

    let sqrt_d = discriminant.sqrt();
    let t1 = (-b + sqrt_d) / (2.0 * a);
    let t2 = (-b - sqrt_d) / (2.0 * a);

    if t1 > 0.0 && t1 < 1.0 {
        roots.push(t1);
    }
    if t2 > 0.0 && t2 < 1.0 {
        roots.push(t2);
    }

    roots
}

fn quad_eval_1d(p0: f64, c: f64, p1: f64, t: f64) -> f64 {
    let mt = 1.0 - t;
    mt * mt * p0 + 2.0 * mt * t * c + t * t * p1
}

fn cubic_eval_1d(p0: f64, c0: f64, c1: f64, p1: f64, t: f64) -> f64 {
    let mt = 1.0 - t;
    mt * mt * mt * p0 + 3.0 * mt * mt * t * c0 + 3.0 * mt * t * t * c1 + t * t * t * p1
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Point;

    fn on(x: f64, y: f64) -> Point {
        Point::on_curve(x, y)
    }

    fn off(x: f64, y: f64) -> Point {
        Point::off_curve(x, y)
    }

    const EPS: f64 = 1e-6;

    fn assert_bbox_approx(actual: (f64, f64, f64, f64), expected: (f64, f64, f64, f64)) {
        assert!(
            (actual.0 - expected.0).abs() < EPS
                && (actual.1 - expected.1).abs() < EPS
                && (actual.2 - expected.2).abs() < EPS
                && (actual.3 - expected.3).abs() < EPS,
            "bbox mismatch: actual={actual:?}, expected={expected:?}",
        );
    }

    #[test]
    fn line_horizontal() {
        let p0 = on(10.0, 50.0);
        let p1 = on(90.0, 50.0);
        let seg = CurveSegment::Line(&p0, &p1);
        assert_bbox_approx(segment_bounds(&seg), (10.0, 50.0, 90.0, 50.0));
    }

    #[test]
    fn line_vertical() {
        let p0 = on(50.0, 10.0);
        let p1 = on(50.0, 90.0);
        let seg = CurveSegment::Line(&p0, &p1);
        assert_bbox_approx(segment_bounds(&seg), (50.0, 10.0, 50.0, 90.0));
    }

    #[test]
    fn line_diagonal() {
        let p0 = on(100.0, 0.0);
        let p1 = on(0.0, 100.0);
        let seg = CurveSegment::Line(&p0, &p1);
        assert_bbox_approx(segment_bounds(&seg), (0.0, 0.0, 100.0, 100.0));
    }

    #[test]
    fn quad_control_outside_endpoints() {
        // Control point at y=100, endpoints at y=0 — curve peak is at y=50
        let p0 = on(0.0, 0.0);
        let c = off(50.0, 100.0);
        let p1 = on(100.0, 0.0);
        let seg = CurveSegment::Quad(&p0, &c, &p1);
        let bbox = segment_bounds(&seg);

        // Tight y-max should be 50, not 100 (control point hull)
        assert!(bbox.3 < 51.0, "tight y-max should be ~50, got {}", bbox.3);
        assert!(bbox.3 > 49.0, "tight y-max should be ~50, got {}", bbox.3);
        assert_bbox_approx(bbox, (0.0, 0.0, 100.0, 50.0));
    }

    #[test]
    fn cubic_bulging_curve() {
        // Classic cubic: control points bulge outward in y
        // p0=(0,0), c0=(0,200), c1=(100,200), p1=(100,0)
        // Curve stays well below y=200
        let p0 = on(0.0, 0.0);
        let c0 = off(0.0, 200.0);
        let c1 = off(100.0, 200.0);
        let p1 = on(100.0, 0.0);
        let seg = CurveSegment::Cubic(&p0, &c0, &c1, &p1);
        let bbox = segment_bounds(&seg);

        // Control-point hull would give y_max=200, tight bounds should be 150
        assert!(
            bbox.3 < 200.0,
            "tight y-max should be < 200, got {}",
            bbox.3
        );
        // For this symmetric cubic, the max y is at t=0.5: 0.125*0 + 0.375*200 + 0.375*200 + 0.125*0 = 150
        assert_bbox_approx(bbox, (0.0, 0.0, 100.0, 150.0));
    }

    #[test]
    fn cubic_s_curve() {
        // S-curve with extrema in both axes
        let p0 = on(0.0, 0.0);
        let c0 = off(100.0, 200.0);
        let c1 = off(-100.0, -200.0);
        let p1 = on(100.0, 0.0);
        let seg = CurveSegment::Cubic(&p0, &c0, &c1, &p1);
        let bbox = segment_bounds(&seg);

        // Tight bounds should be smaller than control-point hull [-100, -200, 100, 200]
        assert!(
            bbox.0 > -100.0,
            "tight x-min should be > -100, got {}",
            bbox.0
        );
        assert!(
            bbox.1 > -200.0,
            "tight y-min should be > -200, got {}",
            bbox.1
        );
        assert!(bbox.2 <= 100.0);
        assert!(
            bbox.3 < 200.0,
            "tight y-max should be < 200, got {}",
            bbox.3
        );
    }

    #[test]
    fn degenerate_all_same_point() {
        let p = on(42.0, 42.0);
        let seg = CurveSegment::Line(&p, &p);
        assert_bbox_approx(segment_bounds(&seg), (42.0, 42.0, 42.0, 42.0));

        let seg = CurveSegment::Cubic(&p, &p, &p, &p);
        assert_bbox_approx(segment_bounds(&seg), (42.0, 42.0, 42.0, 42.0));
    }

    #[test]
    fn cubic_collinear_control_points() {
        // All points on a straight line — behaves like a line
        let p0 = on(0.0, 0.0);
        let c0 = off(25.0, 25.0);
        let c1 = off(75.0, 75.0);
        let p1 = on(100.0, 100.0);
        let seg = CurveSegment::Cubic(&p0, &c0, &c1, &p1);
        assert_bbox_approx(segment_bounds(&seg), (0.0, 0.0, 100.0, 100.0));
    }

    #[test]
    fn tight_bounds_always_within_control_point_hull() {
        // Verify property: tight bounds ≤ control-point bounds
        let p0 = on(10.0, 20.0);
        let c0 = off(-50.0, 300.0);
        let c1 = off(200.0, -100.0);
        let p1 = on(80.0, 40.0);
        let seg = CurveSegment::Cubic(&p0, &c0, &c1, &p1);
        let (min_x, min_y, max_x, max_y) = segment_bounds(&seg);

        // Control-point hull
        let hull_min_x = 10.0_f64.min(-50.0).min(200.0).min(80.0);
        let hull_min_y = 20.0_f64.min(300.0).min(-100.0).min(40.0);
        let hull_max_x = 10.0_f64.max(-50.0).max(200.0).max(80.0);
        let hull_max_y = 20.0_f64.max(300.0).max(-100.0).max(40.0);

        assert!(min_x >= hull_min_x - EPS);
        assert!(min_y >= hull_min_y - EPS);
        assert!(max_x <= hull_max_x + EPS);
        assert!(max_y <= hull_max_y + EPS);

        // And they should be tighter (strictly inside for this case)
        assert!(
            min_x > hull_min_x + 1.0,
            "should be tighter than hull min_x"
        );
        assert!(
            max_x < hull_max_x - 1.0,
            "should be tighter than hull max_x"
        );
    }
}
