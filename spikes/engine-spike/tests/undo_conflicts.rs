//! Item 4: the user's undo, replayed as native's ledger does (apply the
//! inverted changeset of the user's last entry), after an agent edited.
//! Categorizes when undo fails on expected-original mismatch.

use engine_spike::{build, Shape};
use shift_font::{Font, FontChangeSet, FontIntent, FontIntentSet, LayerId, PointId};
use std::collections::BTreeMap;

fn move_point(font: &mut Font, layer: &LayerId, point: &PointId, x: f64) -> FontChangeSet {
    font.apply_intents(FontIntentSet { intents: vec![FontIntent::MovePoints { layer_id: layer.clone(), point_ids: vec![point.clone()], coords: vec![x, x] }] })
        .unwrap()
        .changes
}

#[test]
fn undo_after_agent_edit() {
    let sc = build(Shape { glyphs: 3, sources: 1, resident: 3, contours: 1, points_per_contour: 8, kerning_pairs_per_source: 3, target_points: 8 });
    let user_layer = sc.layer_id.clone();
    let (p_user, p_other) = (sc.point_ids[0].clone(), sc.point_ids[4].clone());
    // A layer in another glyph.
    let other_layer = sc.font.glyphs().next().unwrap().layers().values().next().unwrap().id();
    let other_point = sc.font.layer(&other_layer).unwrap().contours_iter().next().unwrap().points()[0].id();

    let mut results: BTreeMap<&str, (String, String)> = BTreeMap::new();
    for case in ["no agent edit", "agent: other glyph", "agent: same layer, other point", "agent: same point", "agent: kerning only"] {
        let mut native = sc.font.clone();
        let user_entry = move_point(&mut native, &user_layer, &p_user, 111.0);
        match case {
            "agent: other glyph" => { move_point(&mut native, &other_layer, &other_point, 7.0); }
            "agent: same layer, other point" => { move_point(&mut native, &user_layer, &p_other, 7.0); }
            "agent: same point" => { move_point(&mut native, &user_layer, &p_user, 7.0); }
            "agent: kerning only" => {
                let g: Vec<_> = native.glyphs().map(|g| g.id()).collect();
                let src = native.default_source_id().unwrap();
                native.apply_intents(FontIntentSet { intents: vec![FontIntent::SetKerningValues { edits: vec![shift_font::KerningValueEdit { source_id: src, pair: shift_font::KerningPair::glyphs(g[0].clone(), g[1].clone()), value: Some(-33.0) }] }] }).unwrap();
            }
            _ => {}
        }
        let undo = native.apply_change_set(&user_entry.inverted());
        let undo_txt = match &undo { Ok(()) => "ok".to_string(), Err(e) => format!("FAILS: {e}") };
        let redo_txt = if undo.is_ok() {
            match native.apply_change_set(&user_entry) { Ok(()) => "ok".to_string(), Err(e) => format!("FAILS: {e}") }
        } else {
            "-".to_string()
        };
        results.insert(case, (undo_txt, redo_txt));
    }
    for (case, (u, r)) in &results {
        println!("{case:34} undo: {u:70} redo: {r}");
    }
}

/// Random interleaving: how often does the user's undo fail, and why.
#[test]
fn undo_failure_rate_under_random_agent_edits() {
    let sc = build(Shape { glyphs: 3, sources: 1, resident: 3, contours: 1, points_per_contour: 8, kerning_pairs_per_source: 3, target_points: 8 });
    let layers: Vec<LayerId> = std::iter::once(sc.layer_id.clone())
        .chain(sc.font.glyphs().take(2).map(|g| g.layers().values().next().unwrap().id()))
        .collect();
    let mut s = 0x2545F4914F6CDD1Du64;
    let mut rnd = |n: u64| { s ^= s << 13; s ^= s >> 7; s ^= s << 17; s % n };
    let (mut undos, mut failed, mut failed_same_layer_disjoint, mut ok_despite_touch, mut ok_touch_was_noop) = (0, 0, 0, 0, 0);
    for _ in 0..2000 {
        let mut native = sc.font.clone();
        let points = |f: &Font, l: &LayerId| f.layer(l).unwrap().contours_iter().flat_map(|c| c.points().iter().map(|p| p.id())).collect::<Vec<_>>();
        let user_point = points(&native, &layers[0])[rnd(8) as usize].clone();
        let entry = move_point(&mut native, &layers[0], &user_point, 300.0);
        let mut agent_touched_user_point = false;
        let mut agent_touched_user_layer = false;
        for _ in 0..rnd(3) {
            let layer = layers[rnd(layers.len() as u64) as usize].clone();
            let point = points(&native, &layer)[rnd(8) as usize].clone();
            if layer == layers[0] { agent_touched_user_layer = true; agent_touched_user_point |= point == user_point; }
            move_point(&mut native, &layer, &point, rnd(500) as f64);
        }
        undos += 1;
        let layer_unchanged_since_entry = format!("{:?}", native.layer(&layers[0])) == format!("{:?}", entry.changes.iter().find_map(|c| match c { shift_font::FontChange::Layer { layer, .. } => layer.after.as_deref().map(|l| Some(l.clone())), _ => None }).flatten().as_ref());
        if native.apply_change_set(&entry.inverted()).is_err() {
            failed += 1;
            if agent_touched_user_layer && !agent_touched_user_point { failed_same_layer_disjoint += 1; }
        } else {
            if agent_touched_user_layer { ok_despite_touch += 1; if layer_unchanged_since_entry { ok_touch_was_noop += 1; } }
        }
    }
    println!("undos={undos} failed={failed} ({:.0}%), of which agent edited only OTHER points in the same layer: {failed_same_layer_disjoint}; undo ok although agent touched the layer: {ok_despite_touch} (layer value unchanged by those edits: {ok_touch_was_noop})", 100.0 * failed as f64 / undos as f64);
}
