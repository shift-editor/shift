//! Minimal inputs that crash the engine through ApplyBooleanOp (found by tests/fuzz.rs).
//! Run each case in its own process: a stack overflow aborts the process.

use engine_spike::{build, Shape};
use shift_font::{BooleanOp, Contour, FontIntent, FontIntentSet, PointType};

fn case(name: &str) {
    let mut sc = build(Shape { glyphs: 1, sources: 1, resident: 0, contours: 0, points_per_contour: 0, kerning_pairs_per_source: 0, target_points: 0 });
    let layer_id = sc.layer_id.clone();
    let square = |x: f64, y: f64, s: f64| {
        let mut c = Contour::new();
        for (px, py) in [(x, y), (x + s, y), (x + s, y + s), (x, y + s)] {
            c.add_point(px, py, PointType::OnCurve, false);
        }
        c.close();
        c
    };
    let (a, b) = match name {
        "self_intersect" => { let a = square(0.0, 0.0, 100.0); (a.clone(), a) }
        "huge_coords" => (square(1e300, 0.0, 100.0), square(1e300 + 50.0, 50.0, 100.0)),
        "huge_offset_pair" => (square(0.0, 0.0, 100.0), square(1e300, 0.0, 100.0)),
        "huge_size" => (square(0.0, 0.0, 1e300), square(10.0, 10.0, 100.0)),
        "degenerate" => (square(0.0, 0.0, 0.0), square(0.0, 0.0, 100.0)),
        _ => unreachable!(),
    };
    let same = name == "self_intersect";
    sc.font.apply_intents(FontIntentSet { intents: vec![FontIntent::ReplaceGlyphLayerContent {
        layer_id: layer_id.clone(), width: 500.0,
        contours: if same { vec![a] } else { vec![a, b] }, anchors: vec![], components: vec![],
    }] }).expect("setup");
    let ids: Vec<_> = sc.font.layer(&layer_id).unwrap().contours_iter().map(|c| c.id()).collect();
    let a_id = ids[0].clone();
    let b_id = ids.get(1).cloned().unwrap_or_else(|| a_id.clone());
    for op in [BooleanOp::Union, BooleanOp::Subtract, BooleanOp::Intersect, BooleanOp::Difference] {
        let r = sc.font.clone().apply_intents(FontIntentSet { intents: vec![FontIntent::ApplyBooleanOp {
            layer_id: layer_id.clone(), contour_id_a: a_id.clone(), contour_id_b: if same { a_id.clone() } else { b_id.clone() }, operation: op,
        }] });
        println!("{name} {op:?}: {}", if r.is_ok() { "ok".to_string() } else { format!("err {:?}", r.err()) });
    }
}

#[test]
#[ignore]
fn one_case() {
    case(&std::env::var("CASE").unwrap());
}

/// Which intents store non-finite numbers instead of rejecting them.
#[test]
fn nonfinite_acceptance() {
    use shift_font::{AnchorSeed, AnchorId, PointSeed, PointId, Transform};
    let sc = build(Shape { glyphs: 1, sources: 1, resident: 0, contours: 0, points_per_contour: 0, kerning_pairs_per_source: 0, target_points: 8 });
    let l = sc.layer_id.clone();
    let p0 = sc.point_ids[0].clone();
    for (label, bad) in [("NaN", f64::NAN), ("inf", f64::INFINITY)] {
        let cases: Vec<(&str, FontIntent)> = vec![
            ("MovePoints", FontIntent::MovePoints { layer_id: l.clone(), point_ids: vec![p0.clone()], coords: vec![bad, 0.0] }),
            ("TranslatePoints", FontIntent::TranslatePoints { layer_id: l.clone(), point_ids: vec![p0.clone()], dx: bad, dy: 0.0 }),
            ("AddPoints", FontIntent::AddPoints { layer_id: l.clone(), contour_id: Some(sc.contour_id.clone()), before: None, points: vec![PointSeed { id: PointId::new(), x: bad, y: 0.0, point_type: PointType::OnCurve, smooth: false }] }),
            ("AddAnchors", FontIntent::AddAnchors { layer_id: l.clone(), anchors: vec![AnchorSeed { id: AnchorId::new(), name: None, x: bad, y: 0.0 }] }),
            ("SetXAdvance", FontIntent::SetXAdvance { layer_id: l.clone(), width: bad }),
            ("TransformLayer", FontIntent::TransformLayer { layer_id: l.clone(), transform: Transform { xx: bad, xy: 0.0, yx: 0.0, yy: 1.0, dx: 0.0, dy: 0.0 } }),
        ];
        for (name, intent) in cases {
            let ok = sc.font.clone().apply_intents(FontIntentSet { intents: vec![intent] }).is_ok();
            println!("{label} {name}: {}", if ok { "ACCEPTED" } else { "rejected" });
        }
    }
}

/// Two contours, one with a NaN point stored through MovePoints, then a boolean op.
#[test]
#[ignore]
fn nan_point_then_boolean() {
    let mut sc = build(Shape { glyphs: 1, sources: 1, resident: 0, contours: 0, points_per_contour: 0, kerning_pairs_per_source: 0, target_points: 6 });
    let l = sc.layer_id.clone();
    let mut b = Contour::new();
    for (x, y) in [(0.0, 0.0), (300.0, 0.0), (300.0, 300.0), (0.0, 300.0)] { b.add_point(x, y, PointType::OnCurve, false); }
    b.close();
    let b_id = b.id();
    sc.font.layer_mut(&l).unwrap().add_contour(b);
    let op = match std::env::var("OP").as_deref() { Ok("union") => BooleanOp::Union, Ok("subtract") => BooleanOp::Subtract, Ok("difference") => BooleanOp::Difference, _ => BooleanOp::Intersect };
    let value = match std::env::var("BAD").as_deref() { Ok("huge") => 1e300, _ => f64::NAN };
    sc.font.apply_intents(FontIntentSet { intents: vec![FontIntent::MovePoints { layer_id: l.clone(), point_ids: vec![sc.point_ids[1].clone()], coords: vec![value, value] }] }).expect("stores");
    let r = sc.font.apply_intents(FontIntentSet { intents: vec![FontIntent::ApplyBooleanOp { layer_id: l, contour_id_a: sc.contour_id.clone(), contour_id_b: b_id, operation: op }] });
    println!("result: {:?}", r.map(|_| ()));
}

/// The exact contour the fuzzer reached (fuzz seed 3911), booleaned with itself.
#[test]
#[ignore]
fn fuzz_seed_3911_contour() {
    let mut sc = build(Shape { glyphs: 1, sources: 1, resident: 0, contours: 0, points_per_contour: 0, kerning_pairs_per_source: 0, target_points: 3 });
    let l = sc.layer_id.clone();
    let mut c = Contour::new();
    c.add_point(0.0, 0.0, PointType::OnCurve, false);
    c.add_point(400.0, 0.0, PointType::OnCurve, false);
    c.add_point(1e300, -0.0, PointType::OffCurve, true);
    let v = if std::env::var("FINITE").is_ok() { 5.0 } else { f64::NAN }; c.add_point(v, v, PointType::OffCurve, true);
    c.add_point(200.0, 500.0, PointType::OnCurve, false);
    c.close();
    let id = c.id();
    sc.font.layer_mut(&l).unwrap().add_contour(c);
    let op = match std::env::var("OP").as_deref() { Ok("union") => BooleanOp::Union, Ok("subtract") => BooleanOp::Subtract, Ok("difference") => BooleanOp::Difference, _ => BooleanOp::Intersect };
    let other = if std::env::var("OTHER").is_ok() { sc.contour_id.clone() } else { id.clone() };
    let r = sc.font.apply_intents(FontIntentSet { intents: vec![FontIntent::ApplyBooleanOp { layer_id: l, contour_id_a: id, contour_id_b: other, operation: op }] });
    println!("result: {:?}", r.map(|_| ()));
}
