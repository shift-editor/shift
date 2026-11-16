use kurbo::{BezPath, ParamCurve};

use super::*;

/// glyphsLib's `hasCornerGlyph`: a triangle whose apex is an open corner.
fn open_corner_triangle(stretch: f64) -> BezPath {
    let mut path = BezPath::new();
    path.move_to((20.0 * stretch, 0.0));
    path.line_to((179.0 * stretch, 0.0));
    path.line_to((60.0 * stretch, 353.0));
    path.line_to((198.0 * stretch, 360.0));
    path.line_to((20.0 * stretch, 0.0));
    path.close_path();
    path
}

fn closed_triangle() -> BezPath {
    let mut path = BezPath::new();
    path.move_to((20.0, 0.0));
    path.line_to((179.0, 0.0));
    path.line_to((114.5, 191.2));
    path.line_to((20.0, 0.0));
    path.close_path();
    path
}

#[test]
fn an_open_corner_is_erased_at_the_crossing_as_fontc_erases_it() {
    let erased = erase_open_corners(&open_corner_triangle(1.0)).expect("an open corner");

    let corner = erased.segments().nth(1).expect("a second segment").end();
    assert!((corner.x - 114.5417).abs() < 1e-3, "{corner:?}");
    assert!((corner.y - 191.2080).abs() < 1e-3, "{corner:?}");
}

#[test]
fn a_path_without_open_corners_has_nothing_to_erase() {
    assert_eq!(erase_open_corners(&closed_triangle()), None);
}

#[test]
fn a_corner_open_in_every_master_is_erased_in_every_master() {
    let mut masters = vec![
        vec![open_corner_triangle(1.0)],
        vec![open_corner_triangle(1.2)],
    ];

    erase_open_corners_in_masters(&mut masters);

    assert_eq!(
        masters[0][0],
        erase_open_corners(&open_corner_triangle(1.0)).unwrap()
    );
    assert_eq!(
        masters[1][0],
        erase_open_corners(&open_corner_triangle(1.2)).unwrap()
    );
}

#[test]
fn a_corner_open_in_only_one_master_stays_as_authored_so_the_masters_still_match() {
    let mut masters = vec![vec![open_corner_triangle(1.0)], vec![closed_triangle()]];

    erase_open_corners_in_masters(&mut masters);

    assert_eq!(
        masters,
        vec![vec![open_corner_triangle(1.0)], vec![closed_triangle()]]
    );
}
