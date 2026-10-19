//! Option (b) from the architecture discussion: the renderer runs the same
//! engine optimistically, native stays authoritative, and the renderer
//! rebases its pending edits whenever native reports someone else's change.
//!
//! The invariant: once every message is delivered, the renderer's font equals
//! native's font exactly, for any interleaving of local edits, agent edits,
//! acknowledgements and rejections.

use engine_spike::{build, Shape};
use shift_font::{
    Font, FontChangeSet, FontIntent, FontIntentSet, LayerId, PointId, PointSeed, PointType,
    Transform,
};
use std::collections::VecDeque;

struct Lcg(u64);
impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        self.0 >> 33
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
    fn f(&mut self) -> f64 {
        (self.next() % 10_000) as f64 / 10.0
    }
}

/// A random but valid-at-generation-time edit against `font`'s target layer.
fn random_intent(font: &Font, layer_id: &LayerId, rng: &mut Lcg) -> FontIntentSet {
    let layer = font.layer(layer_id).unwrap();
    let points: Vec<PointId> = layer.contours_iter().flat_map(|c| c.points().iter().map(|p| p.id())).collect();
    let contours: Vec<_> = layer.contours_iter().map(|c| c.id()).collect();
    let pick = |rng: &mut Lcg| points[rng.below(points.len())].clone();
    let intent = match rng.below(7) {
        _ if points.len() < 4 => FontIntent::AddPoints {
            layer_id: layer_id.clone(),
            contour_id: Some(contours[0].clone()),
            before: None,
            points: vec![PointSeed { id: PointId::new(), x: rng.f(), y: rng.f(), point_type: PointType::OnCurve, smooth: false }],
        },
        0 | 1 => FontIntent::MovePoints { layer_id: layer_id.clone(), point_ids: vec![pick(rng)], coords: vec![rng.f(), rng.f()] },
        2 => FontIntent::RemovePoints { layer_id: layer_id.clone(), point_ids: vec![pick(rng)] },
        3 => FontIntent::AddPoints {
            layer_id: layer_id.clone(),
            contour_id: None,
            before: Some(pick(rng)),
            points: vec![PointSeed { id: PointId::new(), x: rng.f(), y: rng.f(), point_type: PointType::OnCurve, smooth: false }],
        },
        4 => FontIntent::ReverseContour { layer_id: layer_id.clone(), contour_id: contours[rng.below(contours.len())].clone() },
        5 => FontIntent::SetPointSmooth { layer_id: layer_id.clone(), point_id: pick(rng), smooth: rng.below(2) == 0 },
        _ => {
            let a = (rng.f() / 1000.0) * std::f64::consts::TAU;
            FontIntent::TransformLayer {
                layer_id: layer_id.clone(),
                transform: Transform { xx: a.cos(), xy: a.sin(), yx: -a.sin(), yy: a.cos(), dx: rng.f(), dy: 0.0 },
            }
        }
    };
    FontIntentSet { intents: vec![intent] }
}

enum ToRenderer {
    Ack { changes: FontChangeSet },
    Reject,
    Remote { changes: FontChangeSet },
}

struct Pending {
    intents: FontIntentSet,
    /// What the renderer last applied for this edit; `None` when it no longer applies locally.
    changes: Option<FontChangeSet>,
}

#[derive(Default, Debug)]
struct Stats {
    local: usize,
    remote: usize,
    rebases: usize,
    rejected: usize,
    local_drop_matched_reject: usize,
}

/// Undoes every pending local edit, runs `between`, then reapplies the pending edits.
fn rebase(font: &mut Font, pending: &mut VecDeque<Pending>, between: impl FnOnce(&mut Font)) {
    for p in pending.iter().rev() {
        if let Some(changes) = &p.changes {
            font.apply_change_set(&changes.inverted()).expect("undo pending");
        }
    }
    between(font);
    for p in pending.iter_mut() {
        p.changes = font.apply_intents(p.intents.clone()).ok().map(|a| a.changes);
    }
}

fn simulate(seed: u64, steps: usize) -> Stats {
    let mut rng = Lcg(seed);
    let sc = build(Shape { glyphs: 20, sources: 1, resident: 20, contours: 2, points_per_contour: 8, kerning_pairs_per_source: 10, target_points: 12 });
    let layer_id = sc.layer_id.clone();
    // Native loads the font independently, as a separate engine would: fresh hash seeds.
    let mut native: Font = serde_json::from_str(&serde_json::to_string(&sc.font).unwrap()).unwrap();
    assert!(native == sc.font);
    let mut renderer = sc.font;
    let mut pending: VecDeque<Pending> = VecDeque::new();
    let mut to_native: VecDeque<FontIntentSet> = VecDeque::new();
    let mut to_renderer: VecDeque<ToRenderer> = VecDeque::new();
    let mut stats = Stats::default();

    let mut step = |rng: &mut Lcg, drain: bool, stats: &mut Stats, native: &mut Font, renderer: &mut Font| -> bool {
        let choice = if drain {
            if !to_native.is_empty() { 1 } else if !to_renderer.is_empty() { 3 } else { return false }
        } else {
            rng.below(4)
        };
        match choice {
            0 => {
                // User edits locally: apply now, send to native.
                let intents = random_intent(renderer, &layer_id, rng);
                if let Ok(applied) = renderer.apply_intents(intents.clone()) {
                    stats.local += 1;
                    pending.push_back(Pending { intents: intents.clone(), changes: Some(applied.changes) });
                    to_native.push_back(intents);
                }
            }
            1 => {
                // Native processes the oldest local edit.
                if let Some(intents) = to_native.pop_front() {
                    match native.apply_intents(intents) {
                        Ok(applied) => to_renderer.push_back(ToRenderer::Ack { changes: applied.changes }),
                        Err(_) => to_renderer.push_back(ToRenderer::Reject),
                    }
                }
            }
            2 => {
                // An agent edits native directly.
                let intents = random_intent(native, &layer_id, rng);
                if let Ok(applied) = native.apply_intents(intents) {
                    stats.remote += 1;
                    to_renderer.push_back(ToRenderer::Remote { changes: applied.changes });
                }
            }
            _ => match to_renderer.pop_front() {
                Some(ToRenderer::Ack { changes }) => {
                    let front = pending.pop_front().expect("ack without pending");
                    // Same engine, same base, same intents: the renderer's result must be native's.
                    assert_eq!(front.changes.as_ref().map(|c| format!("{c:?}")), Some(format!("{changes:?}")), "seed {seed}: ack diverged");
                }
                Some(ToRenderer::Reject) => {
                    stats.rejected += 1;
                    let front = pending.front().expect("reject without pending");
                    if front.changes.is_none() {
                        stats.local_drop_matched_reject += 1;
                    }
                    rebase(renderer, &mut pending, |_| {});
                    // Drop the rejected edit: rebuild without it.
                    let mut rest: VecDeque<Pending> = pending.drain(..).collect();
                    let rejected = rest.pop_front().unwrap();
                    if let Some(c) = &rejected.changes {
                        // Undo the rest, undo rejected, reapply the rest.
                        for p in rest.iter().rev() {
                            if let Some(pc) = &p.changes { renderer.apply_change_set(&pc.inverted()).unwrap(); }
                        }
                        renderer.apply_change_set(&c.inverted()).unwrap();
                        for p in rest.iter_mut() {
                            p.changes = renderer.apply_intents(p.intents.clone()).ok().map(|a| a.changes);
                        }
                    }
                    pending = rest;
                }
                Some(ToRenderer::Remote { changes }) => {
                    stats.rebases += 1;
                    rebase(renderer, &mut pending, |font| font.apply_change_set(&changes).expect("remote applies to confirmed state"));
                }
                None => {}
            },
        }
        true
    };

    for _ in 0..steps {
        step(&mut rng, false, &mut stats, &mut native, &mut renderer);
    }
    while step(&mut rng, true, &mut stats, &mut native, &mut renderer) {}

    assert!(pending.is_empty(), "seed {seed}: pending left");
    assert!(renderer == native, "seed {seed}: renderer diverged from native");
    stats
}

#[test]
fn renderer_converges_with_native_under_random_interleavings() {
    let mut total = Stats::default();
    for seed in 1..=300 {
        let s = simulate(seed, 200);
        total.local += s.local;
        total.remote += s.remote;
        total.rebases += s.rebases;
        total.rejected += s.rejected;
        total.local_drop_matched_reject += s.local_drop_matched_reject;
    }
    eprintln!("{total:?}");
    assert!(total.rejected > 0, "the run never exercised a conflict");
}
