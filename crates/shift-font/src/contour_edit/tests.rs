use super::*;
use crate::{LayerId, SourceId};

/// One point spec: id, x, y, and whether it is on the curve.
type Spec = (&'static str, f64, f64, bool);

fn contour(id: &str, closed: bool, points: &[Spec]) -> Contour {
    let mut contour = Contour::with_id(ContourId::from_raw(id));
    for &(point, x, y, on) in points {
        let kind = if on {
            PointType::OnCurve
        } else {
            PointType::OffCurve
        };
        contour.push_point(Point::new(PointId::from_raw(point), x, y, kind, false));
    }
    if closed {
        contour.close();
    }
    contour
}

fn layer(contours: Vec<Contour>) -> GlyphLayer {
    let mut layer = GlyphLayer::with_width(LayerId::from_raw("l"), SourceId::from_raw("s"), 500.0);
    for contour in contours {
        layer.add_contour(contour);
    }
    layer
}

fn id(raw: &str) -> PointId {
    PointId::from_raw(raw)
}

fn ids(contour: &Contour) -> Vec<String> {
    contour
        .points()
        .iter()
        .map(|point| point.id().as_str().trim_start_matches("point_").to_string())
        .collect()
}

fn only(layer: &GlyphLayer) -> &Contour {
    let mut contours = layer.contours_iter();
    let first = contours.next().unwrap();
    assert!(contours.next().is_none());
    first
}

/// An arch as two cubics meeting at `mid`.
fn split_arch() -> GlyphLayer {
    let arch = CubicBez::new(
        KurboPoint::new(0.0, 0.0),
        KurboPoint::new(0.0, 160.0),
        KurboPoint::new(200.0, 160.0),
        KurboPoint::new(200.0, 0.0),
    );
    let (left, right) = (arch.subsegment(0.0..0.4), arch.subsegment(0.4..1.0));
    layer(vec![contour(
        "c",
        false,
        &[
            ("a", left.p0.x, left.p0.y, true),
            ("a1", left.p1.x, left.p1.y, false),
            ("a2", left.p2.x, left.p2.y, false),
            ("mid", left.p3.x, left.p3.y, true),
            ("b1", right.p1.x, right.p1.y, false),
            ("b2", right.p2.x, right.p2.y, false),
            ("b", right.p3.x, right.p3.y, true),
        ],
    )])
}

#[test]
fn deleting_a_point_between_cubics_fits_one_cubic() {
    let mut layer = split_arch();

    layer.delete_points(&[id("mid")], DeleteMode::Fit).unwrap();

    let contour = only(&layer);
    let kept = ids(contour);
    assert_eq!(kept.len(), 4);
    assert_eq!((kept[0].as_str(), kept[3].as_str()), ("a", "b"));
    let points = contour.points();
    assert_eq!(points[0].position(), KurboPoint::new(0.0, 0.0));
    assert_eq!(points[3].position(), KurboPoint::new(200.0, 0.0));
    // The fit recovers the arch's handles, which the split shortened.
    assert!(points[1].position().distance(KurboPoint::new(0.0, 160.0)) < 0.5);
    assert!(points[2].position().distance(KurboPoint::new(200.0, 160.0)) < 0.5);
}

#[test]
fn deleting_a_handle_makes_its_segment_a_line() {
    let mut layer = split_arch();

    layer.delete_points(&[id("a1")], DeleteMode::Fit).unwrap();

    assert_eq!(ids(only(&layer)), ["a", "mid", "b1", "b2", "b"]);
}

#[test]
fn a_gap_in_a_closed_contour_opens_it_after_the_cut() {
    let square = |closed| {
        contour(
            "c",
            closed,
            &[
                ("p0", 0.0, 0.0, true),
                ("p1", 100.0, 0.0, true),
                ("p2", 100.0, 100.0, true),
                ("p3", 0.0, 100.0, true),
            ],
        )
    };
    let mut closed = layer(vec![square(true)]);

    closed.delete_points(&[id("p1")], DeleteMode::Gap).unwrap();

    let contour = only(&closed);
    assert!(!contour.is_closed());
    assert_eq!(ids(contour), ["p2", "p3", "p0"]);

    let mut fitted = layer(vec![square(true)]);
    fitted.delete_points(&[id("p1")], DeleteMode::Fit).unwrap();
    assert!(only(&fitted).is_closed());
    assert_eq!(ids(only(&fitted)), ["p0", "p2", "p3"]);
}

#[test]
fn a_gap_in_an_open_contour_splits_off_the_rest() {
    let mut layer = layer(vec![contour(
        "c",
        false,
        &[
            ("p0", 0.0, 0.0, true),
            ("p1", 100.0, 0.0, true),
            ("p2", 200.0, 0.0, true),
            ("p3", 300.0, 0.0, true),
            ("p4", 400.0, 0.0, true),
        ],
    )]);

    layer.delete_points(&[id("p2")], DeleteMode::Gap).unwrap();

    let contours: Vec<&Contour> = layer.contours_iter().collect();
    assert_eq!(contours.len(), 2);
    assert_eq!(contours[0].id(), ContourId::from_raw("c"));
    assert_eq!(ids(contours[0]), ["p0", "p1"]);
    assert_eq!(ids(contours[1]), ["p3", "p4"]);
}

#[test]
fn deleting_every_on_curve_point_removes_the_contour() {
    let mut layer = split_arch();

    layer
        .delete_points(&[id("a"), id("mid"), id("b")], DeleteMode::Fit)
        .unwrap();

    assert_eq!(layer.contours_iter().count(), 0);
}

#[test]
fn deleting_an_unknown_point_changes_nothing() {
    let mut layer = split_arch();
    let before = layer.clone();

    assert!(
        layer
            .delete_points(&[id("mid"), id("gone")], DeleteMode::Fit)
            .is_err()
    );
    assert_eq!(layer, before);
}

#[test]
fn splitting_a_line_inserts_the_given_point() {
    let mut layer = layer(vec![contour(
        "c",
        false,
        &[("a", 0.0, 0.0, true), ("b", 100.0, 40.0, true)],
    )]);

    layer
        .split_segment(&id("a"), &id("b"), 0.25, id("new"))
        .unwrap();

    let contour = only(&layer);
    assert_eq!(ids(contour), ["a", "new", "b"]);
    assert_eq!(contour.points()[1].position(), KurboPoint::new(25.0, 10.0));
    assert!(!contour.points()[1].is_smooth());
}

#[test]
fn splitting_a_cubic_keeps_its_shape() {
    let mut layer = split_arch();
    let before = SegmentIndices::Cubic([3, 4, 5, 6]).path_segment(only(&layer).points());

    layer
        .split_segment(&id("mid"), &id("b"), 0.5, id("new"))
        .unwrap();

    let contour = only(&layer);
    let at = |raw: &str| contour.point_index(&id(raw)).unwrap();
    let new = &contour.points()[at("new")];
    assert!(new.is_smooth() && new.is_on_curve());
    assert_eq!(contour.len(), 10);
    let halves = [
        SegmentIndices::Cubic([at("mid"), at("b1"), at("new") - 1, at("new")])
            .path_segment(contour.points()),
        SegmentIndices::Cubic([at("new"), at("new") + 1, at("b2"), at("b")])
            .path_segment(contour.points()),
    ];
    for (half, range) in halves.iter().zip([0.0..0.5, 0.5..1.0]) {
        let expected = before.subsegment(range);
        for t in [0.0, 0.3, 0.7, 1.0] {
            assert!(half.eval(t).distance(expected.eval(t)) < 1e-9);
        }
    }
}

#[test]
fn splitting_a_quadratic_keeps_the_end_point_type() {
    let mut layer = layer(vec![contour(
        "c",
        false,
        &[
            ("a", 0.0, 0.0, true),
            ("c", 50.0, 100.0, false),
            ("b", 100.0, 0.0, true),
        ],
    )]);

    layer
        .split_segment(&id("a"), &id("b"), 0.5, id("new"))
        .unwrap();

    let contour = only(&layer);
    assert_eq!(ids(contour)[..3], ["a", "c", "new"]);
    assert_eq!(contour.points()[1].position(), KurboPoint::new(25.0, 50.0));
    assert_eq!(contour.points()[2].position(), KurboPoint::new(50.0, 50.0));
    assert_eq!(contour.points()[3].position(), KurboPoint::new(75.0, 50.0));
}

#[test]
fn a_segment_splits_only_strictly_between_its_ends() {
    let mut layer = split_arch();

    for t in [0.0, 1.0, f64::NAN] {
        assert!(
            matches!(
                layer.split_segment(&id("a"), &id("mid"), t, id("new")),
                Err(CoreError::ContourEdit(
                    ContourEditError::SplitOutsideSegment(_)
                ))
            ),
            "split at {t}"
        );
    }
    assert!(matches!(
        layer.split_segment(&id("a"), &id("b"), 0.5, id("new")),
        Err(CoreError::ContourEdit(
            ContourEditError::SegmentNotFound { .. }
        ))
    ));
}

#[test]
fn a_line_upgrades_to_a_cubic_with_thirds() {
    let mut open = layer(vec![contour(
        "c",
        false,
        &[("a", 0.0, 0.0, true), ("b", 90.0, 30.0, true)],
    )]);

    open.upgrade_line_to_cubic(&id("a"), &id("b")).unwrap();

    let points = only(&open).points();
    assert_eq!(points.len(), 4);
    assert_eq!(points[1].position(), KurboPoint::new(30.0, 10.0));
    assert_eq!(points[2].position(), KurboPoint::new(60.0, 20.0));
    assert!(points[1..3].iter().all(|point| !point.is_on_curve()));
}

#[test]
fn a_closing_line_upgrades_after_the_last_point() {
    let mut closed = layer(vec![contour(
        "c",
        true,
        &[
            ("a", 0.0, 0.0, true),
            ("b", 90.0, 0.0, true),
            ("c", 90.0, 90.0, true),
        ],
    )]);

    closed.upgrade_line_to_cubic(&id("c"), &id("a")).unwrap();

    let contour = only(&closed);
    assert_eq!(&ids(contour)[..3], ["a", "b", "c"]);
    assert_eq!(contour.points()[3].position(), KurboPoint::new(60.0, 60.0));
    assert!(contour.points()[0].is_on_curve());
}

fn end(contour: &str, side: ContourSide) -> ContourEnd {
    ContourEnd {
        contour_id: ContourId::from_raw(contour),
        side,
    }
}

fn open_pair() -> GlyphLayer {
    layer(vec![
        contour(
            "one",
            false,
            &[("a", 0.0, 0.0, true), ("b", 50.0, 0.0, true)],
        ),
        contour(
            "two",
            false,
            &[("c", 60.0, 0.0, true), ("d", 100.0, 0.0, true)],
        ),
    ])
}

#[test]
fn joining_two_contours_keeps_the_first_and_every_point() {
    let mut layer = open_pair();

    layer
        .join_contours(
            &end("one", ContourSide::End),
            &end("two", ContourSide::Start),
            JoinMode::Connect,
        )
        .unwrap();

    let contour = only(&layer);
    assert_eq!(contour.id(), ContourId::from_raw("one"));
    assert_eq!(ids(contour), ["a", "b", "c", "d"]);
}

#[test]
fn merging_ends_drops_the_from_end_and_reverses_as_needed() {
    let mut layer = open_pair();

    layer
        .join_contours(
            &end("one", ContourSide::Start),
            &end("two", ContourSide::End),
            JoinMode::Merge,
        )
        .unwrap();

    assert_eq!(ids(only(&layer)), ["b", "d", "c"]);
}

#[test]
fn closing_a_contour_by_its_ends() {
    let mut layer = layer(vec![contour(
        "c",
        false,
        &[
            ("a", 0.0, 0.0, true),
            ("h", 10.0, 50.0, false),
            ("b", 50.0, 50.0, true),
            ("z", 0.0, 0.0, true),
        ],
    )]);

    layer
        .join_contours(
            &end("c", ContourSide::Start),
            &end("c", ContourSide::End),
            JoinMode::Merge,
        )
        .unwrap();

    let contour = only(&layer);
    assert!(contour.is_closed());
    assert_eq!(ids(contour), ["z", "h", "b"]);
}

#[test]
fn ends_of_a_closed_contour_or_the_same_end_do_not_join() {
    let mut layer = open_pair();

    assert!(matches!(
        layer.join_contours(
            &end("one", ContourSide::End),
            &end("one", ContourSide::End),
            JoinMode::Connect
        ),
        Err(CoreError::ContourEdit(ContourEditError::SameEnd { .. }))
    ));
    layer
        .require_contour_mut(&ContourId::from_raw("two"))
        .unwrap()
        .close();
    assert!(matches!(
        layer.join_contours(
            &end("one", ContourSide::End),
            &end("two", ContourSide::Start),
            JoinMode::Connect
        ),
        Err(CoreError::ContourEdit(ContourEditError::ClosedContour(_)))
    ));
}

#[test]
fn deleting_between_quadratics_fits_one_quadratic_control() {
    let mut layer = layer(vec![contour(
        "c",
        false,
        &[
            ("a", 0.0, 0.0, true),
            ("q1", 50.0, 100.0, false),
            ("m", 100.0, 100.0, true),
            ("q2", 150.0, 100.0, false),
            ("b", 200.0, 0.0, true),
        ],
    )]);

    layer.delete_points(&[id("m")], DeleteMode::Fit).unwrap();

    let contour = only(&layer);
    let kept = ids(contour);
    assert_eq!(kept.len(), 3);
    assert_eq!((kept[0].as_str(), kept[2].as_str()), ("a", "b"));
    let control = &contour.points()[1];
    assert!(!control.is_on_curve());
    assert!(control.y() > 100.0, "the fitted control lifts the curve");
}

#[test]
fn a_fitted_span_through_the_start_of_a_closed_contour_keeps_it_closed() {
    let mut layer = layer(vec![contour(
        "c",
        true,
        &[
            ("p0", 0.0, 0.0, true),
            ("p1", 100.0, 0.0, true),
            ("p2", 100.0, 100.0, true),
            ("p3", 0.0, 100.0, true),
        ],
    )]);

    layer.delete_points(&[id("p0")], DeleteMode::Fit).unwrap();

    let contour = only(&layer);
    assert!(contour.is_closed());
    assert_eq!(ids(contour), ["p1", "p2", "p3"]);
}

#[test]
fn splitting_a_closing_segment_keeps_the_start_point() {
    let mut closed_line = layer(vec![contour(
        "c",
        true,
        &[
            ("a", 0.0, 0.0, true),
            ("b", 100.0, 0.0, true),
            ("c", 100.0, 100.0, true),
        ],
    )]);
    closed_line
        .split_segment(&id("c"), &id("a"), 0.5, id("new"))
        .unwrap();
    assert_eq!(ids(only(&closed_line)), ["a", "b", "c", "new"]);

    let mut closed_quad = layer(vec![contour(
        "c",
        true,
        &[
            ("a", 0.0, 0.0, true),
            ("b", 100.0, 0.0, true),
            ("q", 50.0, 100.0, false),
        ],
    )]);
    closed_quad
        .split_segment(&id("b"), &id("a"), 0.5, id("new"))
        .unwrap();
    let kept = ids(only(&closed_quad));
    assert_eq!(&kept[..4], ["a", "b", "q", "new"]);
    assert_eq!(kept.len(), 5);
}
