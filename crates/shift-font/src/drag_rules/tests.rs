use super::*;

fn on(x: f64, y: f64) -> DragPoint {
    DragPoint {
        position: Point::new(x, y),
        point_type: PointType::OnCurve,
        smooth: false,
    }
}

fn smooth(x: f64, y: f64) -> DragPoint {
    DragPoint {
        smooth: true,
        ..on(x, y)
    }
}

fn handle(x: f64, y: f64) -> DragPoint {
    DragPoint {
        point_type: PointType::OffCurve,
        ..on(x, y)
    }
}

fn contour(points: Vec<DragPoint>) -> DragContour {
    DragContour {
        closed: false,
        points,
    }
}

fn at(point: usize) -> PointRef {
    PointRef { contour: 0, point }
}

fn pattern(template: &str) -> Vec<String> {
    expand_pattern(template)
        .into_iter()
        .map(|pattern| String::from_utf8(pattern).unwrap())
        .collect()
}

/// Corner, handle, smooth, handle, corner.
fn smooth_bezier() -> DragContour {
    contour(vec![
        on(0.0, 0.0),
        handle(50.0, 0.0),
        smooth(100.0, 50.0),
        handle(150.0, 100.0),
        on(200.0, 100.0),
    ])
}

/// Corner, smooth, handle, handle, corner.
fn collinearity() -> DragContour {
    contour(vec![
        on(-20.0, 0.0),
        smooth(0.0, 0.0),
        handle(10.0, 10.0),
        handle(20.0, 10.0),
        on(30.0, 0.0),
    ])
}

/// Corner, handle, handle, smooth, corner.
fn collinearity_left() -> DragContour {
    contour(vec![
        on(-20.0, 0.0),
        handle(-10.0, 10.0),
        handle(0.0, 20.0),
        smooth(10.0, 20.0),
        on(20.0, 0.0),
    ])
}

fn drag(contour: DragContour, selected: &[usize]) -> PreparedDrag {
    PreparedDrag::new(vec![contour], selected.iter().map(|&point| at(point)))
}

fn only_rule(drag: &PreparedDrag) -> &MatchedRule {
    assert_eq!(drag.matched().len(), 1, "{:?}", drag.matched());
    &drag.matched()[0]
}

/// The contour's points after `moves`.
fn moved(contour: &DragContour, moves: &[PointMove]) -> Vec<Point> {
    contour
        .points
        .iter()
        .enumerate()
        .map(|(index, point)| {
            moves
                .iter()
                .find(|candidate| candidate.point == at(index))
                .map_or(point.position, |found| found.position)
        })
        .collect()
}

fn cross(a: Vec2, b: Vec2) -> f64 {
    a.x * b.y - a.y * b.x
}

#[test]
fn templates_expand_sets_and_any() {
    assert_eq!(pattern("CSH"), ["CSH"]);
    assert_eq!(pattern("[CS]H"), ["CH", "SH"]);
    assert_eq!(pattern("X"), ["N", "C", "S", "H"]);
    assert_eq!(pattern("[X@]").len(), 5);
    assert_eq!(pattern("[CS][CS]").len(), 4);
    assert!(pattern("[]H").is_empty());
}

#[test]
fn shift_rules_build_into_the_expected_patterns() {
    let table = RuleTable::from_specs(RULE_SPECS).unwrap();

    assert_eq!(table.rule("NCH"), Some(RuleId::MoveRightHandle));
    assert_eq!(table.rule("HCN"), Some(RuleId::MoveLeftHandle));
    assert_eq!(table.rule("HSH"), Some(RuleId::MoveBothHandles));
    assert_eq!(table.rule("CHHSC"), Some(RuleId::MaintainCollinearity));
    assert_eq!(table.rule("CSHHC"), Some(RuleId::MaintainCollinearity));
    assert_eq!(table.rule("HSHNN"), Some(RuleId::MaintainTangencyRight));
    for found in ["HSC", "CSC", "CSH"] {
        assert_eq!(
            table.rule(found),
            Some(RuleId::MaintainTangencyBoth),
            "{found}"
        );
    }
    for present in ["@SH", "HCC", "HCS", "HSHCN", "HSH@N"] {
        assert!(table.rule(present).is_some(), "{present}");
    }
}

const RIGHT: RuleSpec = RuleSpec {
    id: RuleId::MoveRightHandle,
    priority: 0,
    allow_override: false,
    entries: &[RuleEntry {
        template: "NCH",
        affected: &[(RightHandle, 1)],
    }],
};

fn left(priority: i32, allow_override: bool) -> RuleSpec {
    RuleSpec {
        id: RuleId::MoveLeftHandle,
        priority,
        allow_override,
        entries: &[RuleEntry {
            template: "NCH",
            affected: &[(LeftHandle, -1)],
        }],
    }
}

#[test]
fn a_pattern_two_rules_claim_needs_an_override_with_higher_precedence() {
    assert!(matches!(
        RuleTable::from_specs(&[RIGHT, left(0, false)]),
        Err(RuleTableError::Duplicate { .. })
    ));
    assert!(matches!(
        RuleTable::from_specs(&[RIGHT, left(0, true)]),
        Err(RuleTableError::Ambiguous { .. })
    ));
    assert!(matches!(
        RuleTable::from_specs(&[
            RuleSpec {
                priority: 1,
                ..RIGHT
            },
            left(0, true)
        ]),
        Err(RuleTableError::LowerPrecedence { .. })
    ));
    let table = RuleTable::from_specs(&[RIGHT, left(1, true)]).unwrap();
    assert_eq!(table.rule("NCH"), Some(RuleId::MoveLeftHandle));
}

#[test]
fn a_smooth_anchor_moves_both_handles() {
    let drag = drag(smooth_bezier(), &[2]);
    let rule = only_rule(&drag);

    assert_eq!(rule.rule, RuleId::MoveBothHandles);
    assert_eq!(rule.affected, [(LeftHandle, at(1)), (RightHandle, at(3))]);

    let moves = drag.moves(Vec2::new(10.0, 10.0));
    assert_eq!(moves.len(), 3);
    let after = moved(&smooth_bezier(), &moves);
    assert_eq!(after[1], Point::new(60.0, 10.0));
    assert_eq!(after[2], Point::new(110.0, 60.0));
    assert_eq!(after[3], Point::new(160.0, 110.0));
    assert!(!drag.is_uniform_translation());
}

#[test]
fn a_corner_moves_its_right_handle() {
    let drag = drag(smooth_bezier(), &[0]);
    let rule = only_rule(&drag);

    assert_eq!(rule.rule, RuleId::MoveRightHandle);
    assert_eq!(rule.affected, [(RightHandle, at(1))]);
    let moves = drag.moves(Vec2::new(10.0, 20.0));
    assert_eq!(
        moves[0],
        PointMove {
            point: at(0),
            position: Point::new(10.0, 20.0)
        }
    );
}

#[test]
fn a_handle_of_a_smooth_point_turns_the_opposite_handle() {
    let right = drag(smooth_bezier(), &[3]);
    assert_eq!(only_rule(&right).rule, RuleId::MaintainTangencyRight);

    let left = drag(smooth_bezier(), &[1]);
    let rule = only_rule(&left);
    assert_eq!(rule.rule, RuleId::MaintainTangencyLeft);
    assert_eq!(rule.affected, [(Smooth, at(2)), (OppositeHandle, at(3))]);

    let after = moved(&smooth_bezier(), &right.moves(Vec2::new(10.0, 0.0)));
    assert_ne!(after[1], smooth_bezier().points[1].position);
    assert!((after[1] - after[2]).dot(after[3] - after[2]) < 0.0);
}

#[test]
fn a_smooth_point_between_a_handle_and_a_corner_keeps_its_tangent() {
    let shape = contour(vec![handle(-10.0, 0.0), smooth(0.0, 0.0), on(10.0, 0.0)]);
    let drag = drag(shape.clone(), &[1]);
    let rule = only_rule(&drag);
    assert_eq!(rule.rule, RuleId::MaintainTangencyBoth);
    assert_eq!(rule.pattern, "HSC");
    assert_eq!(rule.affected, [(Target, at(0)), (Reference, at(2))]);

    let moves = drag.moves(Vec2::new(0.0, 10.0));
    assert!(moves.iter().all(|found| found.point != at(2)));
    let after = moved(&shape, &moves);
    let to_target = after[0] - after[1];
    let to_reference = after[2] - after[1];
    assert!((length(to_target) - 10.0).abs() < 1e-8);
    assert!(cross(to_target, to_reference).abs() < 1e-8);
    assert!(to_target.dot(to_reference) <= 0.0);
}

#[test]
fn a_corner_between_smooth_points_keeps_both_smooth() {
    let shape = contour(vec![
        handle(-15.0, 12.0),
        smooth(-10.0, 10.0),
        on(0.0, 0.0),
        smooth(10.0, 10.0),
        handle(15.0, 12.0),
    ]);
    let drag = drag(shape.clone(), &[2]);
    let rule = only_rule(&drag);
    assert_eq!(rule.rule, RuleId::MaintainTangencyBoth);
    assert_eq!(rule.pattern, "HSCSH");

    let after = moved(&shape, &drag.moves(Vec2::new(0.0, 5.0)));
    for (smooth, handle) in [(1, 0), (3, 4)] {
        let to_selected = after[2] - after[smooth];
        let to_handle = after[handle] - after[smooth];
        assert!(cross(to_selected, to_handle).abs() < 1e-8);
        assert!(to_selected.dot(to_handle) <= 0.0);
    }
}

#[test]
fn two_smooth_points_in_a_row_turn_both_handles_to_their_line() {
    let shape = contour(vec![
        handle(-25.0, 0.0),
        handle(-10.0, 0.0),
        smooth(0.0, 0.0),
        smooth(20.0, 0.0),
        handle(30.0, 0.0),
    ]);
    let drag = drag(shape.clone(), &[2]);
    let rule = only_rule(&drag);
    assert_eq!(rule.rule, RuleId::MaintainTangencyBoth);
    assert_eq!(rule.pattern, "HHSSH");
    assert_eq!(
        rule.affected,
        [
            (AssociatedHandle, at(1)),
            (OtherSmooth, at(3)),
            (OtherHandle, at(4))
        ]
    );

    let after = moved(&shape, &drag.moves(Vec2::new(0.0, 10.0)));
    let between = after[3] - after[2];
    let associated = after[1] - after[2];
    let other = after[4] - after[3];
    assert!((length(associated) - 10.0).abs() < 1e-8);
    assert!((length(other) - 10.0).abs() < 1e-8);
    assert!(cross(between, associated).abs() < 1e-8);
    assert!(between.dot(associated) <= 0.0);
    assert!(cross(between, other).abs() < 1e-8);
    assert!(between.dot(other) >= 0.0);
}

#[test]
fn a_handle_stays_in_line_with_its_smooth_point_and_the_corner_past_it() {
    let one = drag(collinearity(), &[2]);
    let rule = only_rule(&one);
    assert_eq!(rule.rule, RuleId::MaintainCollinearity);
    assert_eq!(rule.pattern, "CSHHC");
    assert_eq!(rule.affected, [(Smooth, at(1)), (End, at(0))]);

    let both = drag(collinearity(), &[2, 3]);
    assert_eq!(both.matched()[0].pattern, "CSH@C");

    // Past the smooth point the handle reflects instead of crossing it.
    for delta in [
        Vec2::new(0.0, 10.0),
        Vec2::new(10.0, 5.0),
        Vec2::new(-40.0, -5.0),
    ] {
        let after = moved(&collinearity(), &one.moves(delta));
        let away = after[1] - after[0];
        let to_handle = after[2] - after[1];
        assert!(cross(away, to_handle).abs() < 1e-8, "{delta:?}");
        assert!(away.dot(to_handle) >= 0.0, "{delta:?}");
    }
}

#[test]
fn collinearity_matches_from_either_side_and_across_the_seam() {
    let left = drag(collinearity_left(), &[2]);
    let rule = only_rule(&left);
    assert_eq!(rule.pattern, "CHHSC");
    assert_eq!(rule.affected, [(Smooth, at(3)), (End, at(4))]);
    let moves = left.moves(Vec2::new(5.0, 0.0));
    assert!(moves.iter().all(|found| found.point != at(4)));

    let seam = DragContour {
        closed: true,
        points: vec![
            handle(0.0, 20.0),
            smooth(10.0, 20.0),
            on(20.0, 0.0),
            on(-20.0, 0.0),
            handle(-10.0, 10.0),
        ],
    };
    let rule = only_rule(&drag(seam, &[0])).clone();
    assert_eq!(rule.rule, RuleId::MaintainCollinearity);
    assert_eq!(rule.pattern, "CHHSC");
    assert_eq!(rule.affected, [(Smooth, at(1)), (End, at(2))]);
}

#[test]
fn a_collapsed_collinearity_axis_leaves_the_handle_translated() {
    let shape = contour(vec![
        on(-20.0, 0.0),
        handle(-10.0, 10.0),
        handle(0.0, 20.0),
        smooth(10.0, 20.0),
        on(10.0, 20.0),
    ]);
    let drag = drag(shape, &[2]);
    assert_eq!(only_rule(&drag).rule, RuleId::MaintainCollinearity);

    let moves = drag.moves(Vec2::new(5.0, 0.0));
    assert!(moves.iter().all(|found| found.position.is_finite()));
    assert_eq!(
        moves[0],
        PointMove {
            point: at(2),
            position: Point::new(5.0, 20.0)
        }
    );
}

#[test]
fn corners_with_nothing_beside_them_just_translate() {
    let shape = contour(vec![on(0.0, 0.0), on(100.0, 0.0), on(200.0, 50.0)]);
    let drag = drag(shape, &[0, 1]);

    assert!(drag.matched().is_empty());
    assert!(drag.is_uniform_translation());
    assert_eq!(
        drag.moves(Vec2::new(15.0, -5.0)),
        [
            PointMove {
                point: at(0),
                position: Point::new(15.0, -5.0)
            },
            PointMove {
                point: at(1),
                position: Point::new(115.0, -5.0)
            },
        ]
    );
}

#[test]
fn an_isolated_corner_matches_no_rule() {
    let drag = drag(contour(vec![on(0.0, 0.0), on(100.0, 0.0)]), &[0]);

    assert!(drag.matched().is_empty());
}

#[test]
fn selected_points_outside_the_contours_are_ignored() {
    let drag = PreparedDrag::new(
        vec![smooth_bezier()],
        [
            at(2),
            PointRef {
                contour: 3,
                point: 0,
            },
            at(9),
        ],
    );

    assert_eq!(drag.moves(Vec2::new(1.0, 0.0)).len(), 3);
}
