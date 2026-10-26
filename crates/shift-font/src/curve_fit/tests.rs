use kurbo::{ParamCurveArclen, ParamCurveNearest};

use super::*;

fn point(x: f64, y: f64) -> Point {
    Point::new(x, y)
}

fn arch() -> CubicBez {
    CubicBez::new(
        point(0.0, 0.0),
        point(0.0, 160.0),
        point(200.0, 160.0),
        point(200.0, 0.0),
    )
}

fn inflection() -> CubicBez {
    CubicBez::new(
        point(0.0, 0.0),
        point(50.0, 150.0),
        point(150.0, -150.0),
        point(200.0, 0.0),
    )
}

/// `curve` split at `t`, as two segments.
fn split(curve: impl Into<PathSeg>, t: f64) -> Vec<PathSeg> {
    let curve = curve.into();
    vec![curve.subsegment(0.0..t), curve.subsegment(t..1.0)]
}

fn samples(curve: &impl ParamCurve, count: u32) -> Vec<Point> {
    (0..=count)
        .map(|index| curve.eval(f64::from(index) / f64::from(count)))
        .collect()
}

/// The largest distance from a sample of either curve to the other, each
/// drawn as a dense polyline.
fn maximum_error(original: &CubicBez, fitted: &CubicBez) -> f64 {
    let one_way = |source: &CubicBez, target: &CubicBez| {
        let polygon = samples(target, 2048);
        samples(source, 100)
            .into_iter()
            .map(|point| {
                polygon
                    .windows(2)
                    .map(|edge| Line::new(edge[0], edge[1]).nearest(point, 1e-9).distance_sq)
                    .fold(f64::INFINITY, f64::min)
                    .sqrt()
            })
            .fold(0.0, f64::max)
    };
    one_way(original, fitted).max(one_way(fitted, original))
}

fn cross(a: Vec2, b: Vec2) -> f64 {
    a.x * b.y - a.y * b.x
}

fn tangent(curve: &CubicBez, t: f64) -> Vec2 {
    curve.deriv().eval(t).to_vec2()
}

#[test]
fn a_cubic_recovers_an_arch_split_anywhere() {
    for t in [0.17, 0.5, 0.83] {
        let fitted = fit_cubic(&split(arch(), t)).unwrap();

        assert_eq!(fitted.p0, arch().p0);
        assert_eq!(fitted.p3, arch().p3);
        assert!(maximum_error(&arch(), &fitted) < 0.1, "split at {t}");
        assert!(cross(tangent(&arch(), 0.0), tangent(&fitted, 0.0)).abs() < 1e-6);
        assert!(cross(tangent(&arch(), 1.0), tangent(&fitted, 1.0)).abs() < 1e-6);
    }
}

#[test]
fn a_cubic_recovers_an_inflection_without_jumping_branch() {
    let fitted = fit_cubic(&split(inflection(), 0.37)).unwrap();

    assert!(maximum_error(&inflection(), &fitted) < 0.1);
    assert!(tangent(&inflection(), 0.0).dot(tangent(&fitted, 0.0)) > 0.0);
}

#[test]
fn several_segments_are_fitted_together() {
    let halves = split(arch(), 0.4);
    let segments: Vec<PathSeg> = [split(halves[0], 0.3), split(halves[1], 0.6)].concat();

    assert!(maximum_error(&arch(), &fit_cubic(&segments).unwrap()) < 0.1);
}

#[test]
fn one_cubic_is_kept_exactly() {
    assert_eq!(fit_cubic(&[inflection().into()]).unwrap(), inflection());
}

#[test]
fn a_collinear_run_stays_on_its_line() {
    let fitted = fit_cubic(&[
        Line::new(point(0.0, 0.0), point(25.0, 0.0)).into(),
        Line::new(point(25.0, 0.0), point(100.0, 0.0)).into(),
    ])
    .unwrap();

    assert!(
        samples(&fitted, 10)
            .iter()
            .all(|sample| sample.y == 0.0 && (0.0..=100.0).contains(&sample.x))
    );
    assert_eq!(fitted.p3, point(100.0, 0.0));
}

#[test]
fn a_singular_solve_with_parallel_tangents_gives_finite_handles() {
    let fitted = fit_cubic(&[
        CubicBez::new(
            point(0.0, 0.0),
            point(80.0, 0.0),
            point(20.0, 100.0),
            point(50.0, 100.0),
        )
        .into(),
        CubicBez::new(
            point(50.0, 100.0),
            point(80.0, 100.0),
            point(20.0, 0.0),
            point(100.0, 0.0),
        )
        .into(),
    ])
    .unwrap();

    assert!(fitted.p1.is_finite() && fitted.p2.is_finite());
    assert_eq!(fitted.p1.y, 0.0);
    assert_eq!(fitted.p2.y, 0.0);
}

#[test]
fn zero_length_handles_take_their_direction_from_the_polygon() {
    let original = CubicBez::new(
        point(0.0, 0.0),
        point(0.0, 0.0),
        point(100.0, 100.0),
        point(100.0, 100.0),
    );
    let fitted = fit_cubic(&split(original, 0.5)).unwrap();

    assert!(maximum_error(&original, &fitted) < 0.1);
    assert!((fitted.p1.x - fitted.p1.y).abs() < 1e-6);
    assert!((fitted.p2.x - fitted.p2.y).abs() < 1e-6);
}

#[test]
fn tiny_authored_handles_keep_their_direction() {
    let original = CubicBez::new(
        point(0.0, 0.0),
        point(1e-8, 0.0),
        point(200.0, 100.0),
        point(200.0, 0.0),
    );
    let fitted = fit_cubic(&split(original, 0.5)).unwrap();

    assert!(fitted.p1.x > 0.0);
    assert_eq!(fitted.p1.y, 0.0);
    assert!((fitted.p2.x - 200.0).abs() < 1e-9);
    assert!(fitted.p2.y > 0.0);
    assert!(maximum_error(&original, &fitted) < 0.1);
}

#[test]
fn collapsed_segments_do_not_lose_the_run() {
    let start = arch().p0;
    let end = arch().p3;
    let segments: Vec<PathSeg> = [
        vec![Line::new(start, start).into()],
        split(arch(), 0.5),
        vec![Line::new(end, end).into()],
    ]
    .concat();

    assert!(maximum_error(&arch(), &fit_cubic(&segments).unwrap()) < 0.1);
}

#[test]
fn a_reversed_run_fits_the_same_curve() {
    let original = inflection();
    let reversed = CubicBez::new(original.p3, original.p2, original.p1, original.p0);
    let forward = fit_cubic(&split(original, 0.37)).unwrap();
    let backward = fit_cubic(&split(reversed, 0.63)).unwrap();

    assert!(forward.p1.distance(backward.p2) < 1e-6);
    assert!(forward.p2.distance(backward.p1) < 1e-6);
}

#[test]
fn a_loop_whose_ends_meet_is_not_collapsed() {
    let fitted_loop = CubicBez::new(
        point(0.0, 0.0),
        point(150.0, 200.0),
        point(-150.0, 200.0),
        point(0.0, 0.0),
    );
    let fitted = fit_cubic(&split(fitted_loop, 0.5)).unwrap();

    assert!(fitted.p1.distance(fitted_loop.p1) < 0.001);
    assert!(fitted.p2.distance(fitted_loop.p2) < 0.001);
    assert!(fitted.arclen(1e-6) > 100.0);
}

#[test]
fn coincident_geometry_gives_a_collapsed_cubic() {
    let at = point(15.0, 25.0);

    assert_eq!(
        fit_cubic(&[Line::new(at, at).into(), Line::new(at, at).into()]).unwrap(),
        CubicBez::new(at, at, at, at)
    );
}

#[test]
fn the_cubic_solve_is_normalized_for_scale() {
    let offset = Vec2::new(5000.0, -7000.0);
    for scale in [1e-6, 1e6] {
        let moved = |at: Point| ((at + offset).to_vec2() * scale).to_point();
        let curve = arch();
        let original = CubicBez::new(
            moved(curve.p0),
            moved(curve.p1),
            moved(curve.p2),
            moved(curve.p3),
        );
        let fitted = fit_cubic(&split(original, 0.37)).unwrap();

        assert!(
            fitted.p1.distance(original.p1) / scale < 0.5,
            "scale {scale}"
        );
        assert!(
            fitted.p2.distance(original.p2) / scale < 0.5,
            "scale {scale}"
        );
    }
}

#[test]
fn empty_disconnected_and_infinite_runs_are_refused() {
    let arch = PathSeg::from(arch());
    let infinite = PathSeg::from(Line::new(point(f64::NAN, 0.0), point(0.0, 0.0)));

    for fit in [fit_cubic_error, fit_quadratic_error] {
        assert_eq!(fit(&[]), Some(CurveFitError::Empty));
        assert_eq!(fit(&[arch, arch]), Some(CurveFitError::Disconnected));
        assert_eq!(fit(&[infinite]), Some(CurveFitError::NotFinite));
    }
}

fn fit_cubic_error(segments: &[PathSeg]) -> Option<CurveFitError> {
    fit_cubic(segments).err()
}

fn fit_quadratic_error(segments: &[PathSeg]) -> Option<CurveFitError> {
    fit_quadratic(segments).err()
}

fn quad_arch() -> QuadBez {
    QuadBez::new(point(0.0, 0.0), point(100.0, 200.0), point(200.0, 0.0))
}

#[test]
fn a_quadratic_approximates_an_arch_split_anywhere() {
    for t in [0.2, 0.5, 0.8] {
        let fitted = fit_quadratic(&split(quad_arch(), t)).unwrap();

        assert_eq!(fitted.p0, quad_arch().p0);
        assert_eq!(fitted.p2, quad_arch().p2);
        let worst = samples(&quad_arch(), 40)
            .iter()
            .enumerate()
            .map(|(index, sample)| sample.distance(fitted.eval(index as f64 / 40.0)))
            .fold(0.0, f64::max);
        assert!(worst < 20.0, "split at {t}");
    }
}

#[test]
fn one_quadratic_is_kept_exactly() {
    assert_eq!(fit_quadratic(&[quad_arch().into()]).unwrap(), quad_arch());
}

#[test]
fn lines_and_quadratics_fit_without_constrained_tangents() {
    let fitted = fit_quadratic(&[
        quad_arch().into(),
        Line::new(quad_arch().p2, point(300.0, 0.0)).into(),
    ])
    .unwrap();

    assert_eq!(fitted.p0, quad_arch().p0);
    assert_eq!(fitted.p2, point(300.0, 0.0));
    assert!(fitted.p1.y > 0.0 && fitted.p1.is_finite());
}

#[test]
fn a_quadratic_keeps_collinear_samples_on_their_line() {
    let fitted = fit_quadratic(&[
        Line::new(point(0.0, 0.0), point(25.0, 0.0)).into(),
        Line::new(point(25.0, 0.0), point(100.0, 0.0)).into(),
    ])
    .unwrap();

    assert!((fitted.p1.x - 50.0).abs() < 1e-6);
    assert_eq!(fitted.p1.y, 0.0);
}

#[test]
fn a_quadratic_of_coincident_geometry_stays_collapsed() {
    let at = point(10.0, 20.0);

    assert_eq!(
        fit_quadratic(&[Line::new(at, at).into(), Line::new(at, at).into()]).unwrap(),
        QuadBez::new(at, at, at)
    );
}

#[test]
fn the_quadratic_fit_is_the_same_after_translation_and_scaling() {
    let offset = Vec2::new(5000.0, -7000.0);
    let expected = fit_quadratic(&split(quad_arch(), 0.3)).unwrap();
    for scale in [1e-6, 1e6] {
        let moved = |at: Point| ((at + offset).to_vec2() * scale).to_point();
        let arch = quad_arch();
        let original = QuadBez::new(moved(arch.p0), moved(arch.p1), moved(arch.p2));
        let fitted = fit_quadratic(&split(original, 0.3)).unwrap();
        let back = (fitted.p1.to_vec2() / scale - offset).to_point();

        assert!(back.distance(expected.p1) < 1e-6, "scale {scale}");
    }
}
