use super::*;
use crate::{Contour, ContourId, LayerId, Point, PointType, SourceId};

/// A layer with one open contour of on-curve points named `p0`, `p1`, ...
fn layer(positions: &[(f64, f64)]) -> GlyphLayer {
    let mut contour = Contour::with_id(ContourId::from_raw("c"));
    for (index, &(x, y)) in positions.iter().enumerate() {
        contour.push_point(Point::new(id(index), x, y, PointType::OnCurve, false));
    }
    let mut layer = GlyphLayer::with_width(LayerId::from_raw("l"), SourceId::from_raw("s"), 500.0);
    layer.add_contour(contour);
    layer
}

fn id(index: usize) -> PointId {
    PointId::from_raw(format!("p{index}"))
}

fn positions(layer: &GlyphLayer) -> Vec<(f64, f64)> {
    layer
        .contours_iter()
        .flat_map(Contour::points)
        .map(|point| (point.x(), point.y()))
        .collect()
}

#[test]
fn a_transform_moves_only_the_named_points() {
    let mut layer = layer(&[(10.0, 0.0), (20.0, 5.0)]);

    layer
        .transform_points(&[id(1)], &Transform::translate(3.0, -2.0))
        .unwrap();

    assert_eq!(positions(&layer), [(10.0, 0.0), (23.0, 3.0)]);
}

#[test]
fn points_align_to_each_edge_and_centre_of_their_box() {
    let start = [(0.0, 10.0), (40.0, 30.0), (100.0, 0.0)];
    let ids = [id(0), id(1)];
    let cases = [
        (PointAlignment::Left, [(0.0, 10.0), (0.0, 30.0)]),
        (PointAlignment::CenterH, [(20.0, 10.0), (20.0, 30.0)]),
        (PointAlignment::Right, [(40.0, 10.0), (40.0, 30.0)]),
        (PointAlignment::Top, [(0.0, 30.0), (40.0, 30.0)]),
        (PointAlignment::CenterV, [(0.0, 20.0), (40.0, 20.0)]),
        (PointAlignment::Bottom, [(0.0, 10.0), (40.0, 10.0)]),
    ];
    for (alignment, expected) in cases {
        let mut layer = layer(&start);

        layer.align_points(&ids, alignment).unwrap();

        assert_eq!(positions(&layer)[..2], expected, "{alignment}");
        assert_eq!(positions(&layer)[2], (100.0, 0.0));
    }
}

#[test]
fn distributing_spaces_points_evenly_between_the_outermost() {
    let mut layer = layer(&[(90.0, 1.0), (0.0, 2.0), (10.0, 3.0), (30.0, 4.0)]);

    layer
        .distribute_points(&[id(0), id(1), id(2), id(3)], DistributeAxis::Horizontal)
        .unwrap();

    assert_eq!(
        positions(&layer),
        [(90.0, 1.0), (0.0, 2.0), (30.0, 3.0), (60.0, 4.0)]
    );
}

#[test]
fn fewer_than_three_points_are_not_distributed() {
    let mut layer = layer(&[(0.0, 0.0), (7.0, 9.0)]);

    layer
        .distribute_points(&[id(0), id(1)], DistributeAxis::Vertical)
        .unwrap();

    assert_eq!(positions(&layer), [(0.0, 0.0), (7.0, 9.0)]);
}

#[test]
fn distributing_vertically_spaces_y_and_keeps_x() {
    let mut layer = layer(&[(5.0, 90.0), (6.0, 0.0), (7.0, 10.0), (8.0, 30.0)]);

    layer
        .distribute_points(&[id(0), id(1), id(2), id(3)], DistributeAxis::Vertical)
        .unwrap();

    assert_eq!(
        positions(&layer),
        [(5.0, 90.0), (6.0, 0.0), (7.0, 30.0), (8.0, 60.0)]
    );
}

#[test]
fn aligning_no_points_leaves_the_layer_unchanged() {
    let mut layer = layer(&[(0.0, 10.0), (40.0, 30.0)]);

    layer.align_points(&[], PointAlignment::Left).unwrap();

    assert_eq!(positions(&layer), [(0.0, 10.0), (40.0, 30.0)]);
}

#[test]
fn arranging_an_unknown_point_moves_nothing() {
    let mut layer = layer(&[(0.0, 0.0), (5.0, 5.0), (9.0, 9.0)]);
    let missing = PointId::from_raw("gone");

    assert!(
        layer
            .align_points(&[id(0), missing.clone()], PointAlignment::Left)
            .is_err()
    );
    assert!(
        layer
            .distribute_points(&[id(0), id(1), missing], DistributeAxis::Vertical)
            .is_err()
    );
    assert_eq!(positions(&layer), [(0.0, 0.0), (5.0, 5.0), (9.0, 9.0)]);
}

#[test]
fn the_left_sidebearing_moves_the_outline_and_the_advance() {
    let mut layer = layer(&[(50.0, 0.0), (450.0, 0.0)]);

    layer.shift_sidebearing(Sidebearing::Left, 20.0);

    assert_eq!(positions(&layer), [(70.0, 0.0), (470.0, 0.0)]);
    assert_eq!(layer.width(), 520.0);
}

#[test]
fn the_right_sidebearing_moves_only_the_advance() {
    let mut layer = layer(&[(50.0, 0.0), (450.0, 0.0)]);

    layer.shift_sidebearing(Sidebearing::Right, -30.0);

    assert_eq!(positions(&layer), [(50.0, 0.0), (450.0, 0.0)]);
    assert_eq!(layer.width(), 470.0);
}
