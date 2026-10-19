//! Item 2: garbage intents and stale changesets must error, never panic.
//! A panic in wasm32 aborts the module instance, so every panic is an engine crash.

mod anchors_support {
    include!("anchors.rs");
}
use anchors_support::anchor_font;

use shift_font::{
    Anchor, AnchorId, AnchorSeed, BooleanOp, Component, ComponentId, Contour, ContourId,
    DesignLocation, Font, FontChangeSet, FontIntent, FontIntentSet, GlyphId, GlyphName,
    KerningGroupId, KerningPair, KerningPosition, KerningValueEdit, LayerId, PointId, PointSeed,
    PointType, SourceId, Transform,
};
use std::panic::{catch_unwind, AssertUnwindSafe};

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n.max(1) as u64) as usize
    }
    fn pick<T: Clone>(&mut self, v: &[T]) -> Option<T> {
        (!v.is_empty()).then(|| v[self.below(v.len())].clone())
    }
    fn num(&mut self) -> f64 {
        match self.below(10) {
            0 => f64::NAN,
            1 => f64::INFINITY,
            2 => -f64::INFINITY,
            3 => 1e300,
            4 => 0.0,
            5 => -0.0,
            _ => (self.next() % 2000) as f64 - 1000.0,
        }
    }
    fn nums(&mut self, n: usize) -> Vec<f64> {
        // Sometimes the wrong length on purpose.
        let n = match self.below(5) { 0 => n + 1, 1 => n.saturating_sub(1), _ => n };
        (0..n).map(|_| self.num()).collect()
    }
}

struct Pools {
    layers: Vec<LayerId>,
    glyphs: Vec<GlyphId>,
    sources: Vec<SourceId>,
    contours: Vec<(LayerId, ContourId)>,
    points: Vec<(LayerId, PointId)>,
    anchors: Vec<(LayerId, AnchorId)>,
    components: Vec<(LayerId, ComponentId)>,
    groups: Vec<KerningGroupId>,
}

fn pools(font: &Font) -> Pools {
    let mut p = Pools { layers: vec![LayerId::new()], glyphs: vec![GlyphId::new()], sources: vec![SourceId::new()], contours: vec![], points: vec![], anchors: vec![], components: vec![], groups: vec![KerningGroupId::new()] };
    p.sources.extend(font.sources().iter().map(|s| s.id()));
    for g in font.glyphs() {
        p.glyphs.push(g.id());
        for l in g.layers().values() {
            p.layers.push(l.id());
            for c in l.contours_iter() {
                p.contours.push((l.id(), c.id()));
                for pt in c.points() {
                    p.points.push((l.id(), pt.id()));
                }
            }
            for a in l.anchors_iter() {
                p.anchors.push((l.id(), a.id()));
            }
            for c in l.components_iter() {
                p.components.push((l.id(), c.id()));
            }
        }
    }
    p
}

fn layer_of<T: Clone>(rng: &mut Rng, p: &Pools, v: &[(LayerId, T)]) -> (LayerId, Vec<T>) {
    // Mostly the owning layer; sometimes a mismatched one.
    let Some((layer, _)) = rng.pick(v) else { return (rng.pick(&p.layers).unwrap(), vec![]) };
    let layer = if rng.below(6) == 0 { rng.pick(&p.layers).unwrap() } else { layer };
    let n = rng.below(4);
    let items = (0..n).filter_map(|_| rng.pick(v).map(|(_, t)| t)).collect();
    (layer, items)
}

fn random_intent(rng: &mut Rng, p: &Pools) -> FontIntent {
    let layer = rng.pick(&p.layers).unwrap();
    match rng.below(30) {
        0 => {
            let (layer_id, before) = layer_of(rng, p, &p.points);
            let contour_id = if rng.below(2) == 0 { rng.pick(&p.contours).map(|c| c.1) } else { None };
            let points = (0..rng.below(3)).map(|_| PointSeed { id: if rng.below(8) == 0 { rng.pick(&p.points).unwrap().1 } else { PointId::new() }, x: rng.num(), y: rng.num(), point_type: [PointType::OnCurve, PointType::OffCurve, PointType::QCurve][rng.below(3)], smooth: rng.below(2) == 0 }).collect();
            FontIntent::AddPoints { layer_id, contour_id, before: before.into_iter().next(), points }
        }
        1 => FontIntent::AddContour { layer_id: layer, contour_id: if rng.below(4) == 0 { rng.pick(&p.contours).map(|c| c.1).unwrap_or_default() } else { ContourId::new() }, closed: rng.below(2) == 0 },
        2 => { let (layer_id, c) = layer_of(rng, p, &p.contours); FontIntent::SetContourClosed { layer_id, contour_id: c.into_iter().next().unwrap_or_default(), closed: rng.below(2) == 0 } }
        3 => { let (layer_id, ids) = layer_of(rng, p, &p.points); let coords = rng.nums(ids.len() * 2); FontIntent::MovePoints { layer_id, point_ids: ids, coords } }
        4 => { let (layer_id, ids) = layer_of(rng, p, &p.points); FontIntent::SetPointSmooth { layer_id, point_id: ids.into_iter().next().unwrap_or_default(), smooth: true } }
        5 => { let (layer_id, ids) = layer_of(rng, p, &p.points); FontIntent::RemovePoints { layer_id, point_ids: ids } }
        6 => FontIntent::AddAnchors { layer_id: layer, anchors: (0..rng.below(3)).map(|_| AnchorSeed { id: AnchorId::new(), name: if rng.below(2) == 0 { Some(["top", "_top", "", "top_1"][rng.below(4)].to_string()) } else { None }, x: rng.num(), y: rng.num() }).collect() },
        7 => { let (layer_id, ids) = layer_of(rng, p, &p.anchors); let coords = rng.nums(ids.len() * 2); FontIntent::MoveAnchors { layer_id, anchor_ids: ids, coords } }
        8 => { let (layer_id, ids) = layer_of(rng, p, &p.anchors); FontIntent::RemoveAnchors { layer_id, anchor_ids: ids } }
        9 => { let (layer_id, ids) = layer_of(rng, p, &p.anchors); let names = (0..ids.len() + rng.below(2)).map(|_| ["top", "", "_top", "x"][rng.below(4)].to_string()).collect(); FontIntent::RenameAnchors { layer_id, anchor_ids: ids, names } }
        10 => FontIntent::AddComponent { layer_id: layer, component_id: ComponentId::new(), base_glyph_id: rng.pick(&p.glyphs).unwrap() },
        11 => { let (layer_id, ids) = layer_of(rng, p, &p.components); FontIntent::SetComponentAlignment { layer_id, component_ids: ids, alignment: [shift_font::ComponentAlignment::Unset, shift_font::ComponentAlignment::Anchored, shift_font::ComponentAlignment::Free][rng.below(3)] } }
        12 => { let (layer_id, ids) = layer_of(rng, p, &p.components); let transforms = rng.nums(ids.len() * 9); FontIntent::SetComponentTransforms { layer_id, component_ids: ids, transforms } }
        13 => { let (layer_id, ids) = layer_of(rng, p, &p.components); FontIntent::RemoveComponents { layer_id, component_ids: ids } }
        14 => { let (layer_id, ids) = layer_of(rng, p, &p.components); FontIntent::DecomposeComponents { layer_id, component_ids: ids } }
        15 => { let (layer_id, c) = layer_of(rng, p, &p.contours); FontIntent::ReverseContour { layer_id, contour_id: c.into_iter().next().unwrap_or_default() } }
        16 => { let (layer_id, c) = layer_of(rng, p, &p.contours); FontIntent::SetContourStart { layer_id, contour_id: c.into_iter().next().unwrap_or_default(), point_id: rng.pick(&p.points).map(|x| x.1).unwrap_or_default() } }
        17 => { let (layer_id, ids) = layer_of(rng, p, &p.points); FontIntent::TranslatePoints { layer_id, point_ids: ids, dx: rng.num(), dy: rng.num() } }
        18 => FontIntent::TransformLayer { layer_id: layer, transform: Transform { xx: rng.num(), xy: rng.num(), yx: rng.num(), yy: rng.num(), dx: rng.num(), dy: rng.num() } },
        19 => FontIntent::SetXAdvance { layer_id: layer, width: rng.num() },
        20 => { let (layer_id, c) = layer_of(rng, p, &p.contours); let b = rng.pick(&p.contours).map(|x| x.1).unwrap_or_default(); FontIntent::ApplyBooleanOp { layer_id, contour_id_a: c.into_iter().next().unwrap_or_default(), contour_id_b: b, operation: [BooleanOp::Union, BooleanOp::Subtract, BooleanOp::Intersect, BooleanOp::Difference][rng.below(4)] } }
        21 => {
            let mut c = Contour::new();
            for _ in 0..rng.below(5) { c.add_point(rng.num(), rng.num(), [PointType::OnCurve, PointType::OffCurve, PointType::QCurve][rng.below(3)], false); }
            if rng.below(2) == 0 { c.close(); }
            let components = if rng.below(2) == 0 { vec![Component::new(rng.pick(&p.glyphs).unwrap(), "x")] } else { vec![] };
            FontIntent::ReplaceGlyphLayerContent { layer_id: layer, width: rng.num(), contours: vec![c], anchors: vec![Anchor::new(Some("top".to_string()), rng.num(), rng.num())], components }
        }
        22 => FontIntent::CreateGlyph { glyph_id: if rng.below(3) == 0 { Some(rng.pick(&p.glyphs).unwrap()) } else { None }, name: ["a", "", "new", "c0001", " ", "a.b"][rng.below(6)].to_string(), unicodes: vec![rng.next() as u32 % 0x11_0000] },
        23 => FontIntent::UpdateGlyph { glyph_id: rng.pick(&p.glyphs).unwrap(), new_name: GlyphName::new(["a", "acutecomb", "z", "c0002"][rng.below(4)]).unwrap(), new_unicodes: vec![] },
        24 => FontIntent::CreateGlyphLayer { layer_id: if rng.below(4) == 0 { layer } else { LayerId::new() }, glyph_id: rng.pick(&p.glyphs).unwrap(), source_id: rng.pick(&p.sources).unwrap() },
        25 => FontIntent::CloneGlyphLayer { layer_id: LayerId::new(), glyph_id: rng.pick(&p.glyphs).unwrap(), source_id: rng.pick(&p.sources).unwrap(), from_layer_id: layer },
        26 => FontIntent::DeleteSource { source_id: rng.pick(&p.sources).unwrap() },
        27 => FontIntent::CreateSource { source_id: if rng.below(4) == 0 { rng.pick(&p.sources).unwrap() } else { SourceId::new() }, name: "N".into(), location: DesignLocation::new() },
        28 => FontIntent::SetKerningValues { edits: (0..rng.below(3)).map(|_| KerningValueEdit { source_id: rng.pick(&p.sources).unwrap(), pair: KerningPair::glyphs(rng.pick(&p.glyphs).unwrap(), rng.pick(&p.glyphs).unwrap()), value: if rng.below(3) == 0 { None } else { Some(rng.num()) } }).collect() },
        _ => match rng.below(3) {
            0 => FontIntent::CreateKerningGroup { group_id: rng.pick(&p.groups).unwrap(), position: KerningPosition::First, name: "g".into() },
            1 => FontIntent::SetKerningGroupMember { position: KerningPosition::Second, glyph_id: rng.pick(&p.glyphs).unwrap(), group_id: rng.pick(&p.groups) },
            _ => FontIntent::DeleteKerningGroup { group_id: rng.pick(&p.groups).unwrap() },
        },
    }
}

#[test]
fn garbage_intents_and_stale_changesets_never_panic() {
    if std::env::var("FUZZ_LOUD").is_err() { std::panic::set_hook(Box::new(|_| {})); }
    let base = anchor_font(2, 6, 4).font;
    let mut panics: Vec<String> = Vec::new();
    let (mut applied, mut errored, mut changesets_tried) = (0, 0, 0);

    for seed in 1..=5000u64 {
        let mut rng = Rng(seed.wrapping_mul(0x9E3779B97F4A7C15) | 1);
        let mut font = base.clone();
        let mut history: Vec<FontChangeSet> = Vec::new();
        for _ in 0..25 {
            let p = pools(&font);
            let set = FontIntentSet { intents: (0..1 + rng.below(3)).map(|_| random_intent(&mut rng, &p)).collect() };
            let desc = format!("{set:?}");
            if std::env::var("FUZZ_TRACE").is_ok() { std::fs::write(std::env::temp_dir().join("shift_fuzz_last.txt"), format!("seed={seed}\n{desc}\nLAYERS:\n{}", font.glyphs().flat_map(|g| g.layers().values()).filter(|l| desc.contains(l.id().as_str())).map(|l| format!("{:?}", l.contours())).collect::<Vec<_>>().join("\n"))).unwrap(); }
            let mut work = font.clone();
            match catch_unwind(AssertUnwindSafe(|| work.apply_intents(set))) {
                Ok(Ok(a)) => { applied += 1; history.push(a.changes); font = work; }
                Ok(Err(_)) => errored += 1,
                Err(e) => panics.push(format!("apply_intents seed={seed}: {} :: {}", panic_msg(&e), &desc[..desc.len().min(400)])),
            }
            // Stale replay: apply a random past changeset or its inverse out of order.
            if let Some(cs) = rng.pick(&history) {
                changesets_tried += 1;
                let cs = if rng.below(2) == 0 { cs.inverted() } else { cs };
                if std::env::var("FUZZ_TRACE").is_ok() { std::fs::write(std::env::temp_dir().join("shift_fuzz_last.txt"), format!("seed={seed} CHANGESET\n{cs:?}")).unwrap(); }
                let mut work = font.clone();
                if let Err(e) = catch_unwind(AssertUnwindSafe(|| work.apply_change_set(&cs))) {
                    panics.push(format!("apply_change_set seed={seed}: {}", panic_msg(&e)));
                }
            }
        }
    }
    let _ = std::panic::take_hook();
    let mut unique: Vec<String> = panics.iter().map(|p| p.split(" :: ").next().unwrap().split(": ").nth(1).unwrap_or("").to_string()).collect();
    unique.sort();
    unique.dedup();
    eprintln!("applied={applied} errored={errored} stale_changesets={changesets_tried} panics={} unique_messages={}", panics.len(), unique.len());
    for u in &unique { eprintln!("  MSG: {u}"); }
    for p in panics.iter().take(4) { eprintln!("  EX: {p}"); }
    assert!(panics.is_empty());
}

fn panic_msg(e: &Box<dyn std::any::Any + Send>) -> String {
    e.downcast_ref::<String>().cloned().or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default()
}
