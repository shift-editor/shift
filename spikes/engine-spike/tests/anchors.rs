// Item 1: two independently loaded engines (fresh HashMap seeds) apply the
// same anchor and component edits. Both fonts and changesets must match.
// Composites have one layer per source, so a multi-source anchor edit makes
// `realign_attached_components` change several layers of one glyph, whose
// order comes from iterating `Glyph::layers` (a HashMap).

use shift_font::{
    Anchor, AnchorId, Component, ComponentAlignment, ComponentId, Contour, DesignLocation, Font,
    FontChange, FontChangeSet, FontIntent, FontIntentSet, Glyph, GlyphId, GlyphLayer, LayerId,
    PointType, Source, SourceId,
};

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
        (self.next() % 1000) as f64
    }
}

pub struct AnchorFont {
    pub font: Font,
    pub sources: Vec<SourceId>,
    pub base: GlyphId,
    pub mark: GlyphId,
    /// Per source: base layer and its "top" anchor.
    pub base_layers: Vec<(LayerId, AnchorId)>,
    /// Per source: mark layer and its "top" anchor (stacking anchor).
    pub mark_layers: Vec<(LayerId, AnchorId)>,
    /// Composite layers (all sources).
    pub composite_layers: Vec<LayerId>,
}

pub fn anchor_font(sources: usize, composites: usize, filler_glyphs: usize) -> AnchorFont {
    let mut font = Font::empty();
    let source_ids: Vec<SourceId> = (0..sources)
        .map(|s| font.add_source(Source::new(format!("S{s}"), DesignLocation::new())))
        .collect();
    font.set_default_source_id(source_ids[0].clone());

    for g in 0..filler_glyphs {
        let mut glyph = Glyph::new(format!("f{g:05}"));
        for sid in &source_ids {
            glyph.set_layer(GlyphLayer::with_width(LayerId::new(), sid.clone(), 500.0));
        }
        font.insert_glyph(glyph).unwrap();
    }

    let mut base = Glyph::new("a");
    let mut base_layers = Vec::new();
    for sid in &source_ids {
        let mut layer = GlyphLayer::with_width(LayerId::new(), sid.clone(), 500.0);
        let mut c = Contour::new();
        c.add_point(0.0, 0.0, PointType::OnCurve, false);
        c.add_point(400.0, 0.0, PointType::OnCurve, false);
        c.add_point(200.0, 500.0, PointType::OnCurve, false);
        c.close();
        layer.add_contour(c);
        let anchor_id = layer.add_anchor(Anchor::new(Some("top".to_string()), 250.0, 500.0));
        base_layers.push((layer.id(), anchor_id));
        base.set_layer(layer);
    }
    let base_id = font.insert_glyph(base).unwrap();

    let mut mark = Glyph::new("acutecomb");
    let mut mark_layers = Vec::new();
    for sid in &source_ids {
        let mut layer = GlyphLayer::with_width(LayerId::new(), sid.clone(), 0.0);
        layer.add_anchor(Anchor::new(Some("_top".to_string()), 100.0, 0.0));
        let top = layer.add_anchor(Anchor::new(Some("top".to_string()), 100.0, 200.0));
        mark_layers.push((layer.id(), top));
        mark.set_layer(layer);
    }
    let mark_id = font.insert_glyph(mark).unwrap();

    let mut composite_layers = Vec::new();
    for i in 0..composites {
        let mut glyph = Glyph::new(format!("c{i:04}"));
        for sid in &source_ids {
            let mut layer = GlyphLayer::with_width(LayerId::new(), sid.clone(), 500.0);
            let mut b = Component::new(base_id.clone(), "a");
            b.set_alignment(ComponentAlignment::Anchored);
            layer.add_component(b);
            for _ in 0..2 {
                let mut m = Component::new(mark_id.clone(), "acutecomb");
                m.set_alignment(ComponentAlignment::Anchored);
                layer.add_component(m);
            }
            composite_layers.push(layer.id());
            glyph.set_layer(layer);
        }
        font.insert_glyph(glyph).unwrap();
    }

    AnchorFont {
        font,
        sources: source_ids,
        base: base_id,
        mark: mark_id,
        base_layers,
        mark_layers,
        composite_layers,
    }
}

/// A random edit; anchor moves span every source in one set (multi-source editing).
fn random_set(af: &AnchorFont, font: &Font, rng: &mut Lcg) -> FontIntentSet {
    let intents = match rng.below(5) {
        0 | 1 => af
            .base_layers
            .iter()
            .chain(if rng.below(2) == 0 { af.mark_layers.iter() } else { [].iter() })
            .map(|(layer_id, anchor_id)| FontIntent::MoveAnchors {
                layer_id: layer_id.clone(),
                anchor_ids: vec![anchor_id.clone()],
                coords: vec![rng.f(), 400.0 + rng.f()],
            })
            .collect(),
        2 => af
            .mark_layers
            .iter()
            .map(|(layer_id, anchor_id)| FontIntent::RenameAnchors {
                layer_id: layer_id.clone(),
                anchor_ids: vec![anchor_id.clone()],
                names: vec![if rng.below(2) == 0 { "top".into() } else { "top_alt".into() }],
            })
            .collect(),
        3 => {
            let layer_id = af.composite_layers[rng.below(af.composite_layers.len())].clone();
            let ids: Vec<ComponentId> =
                font.layer(&layer_id).unwrap().components_iter().map(|c| c.id()).collect();
            let alignment = if rng.below(2) == 0 { ComponentAlignment::Anchored } else { ComponentAlignment::Free };
            vec![FontIntent::SetComponentAlignment { layer_id, component_ids: vec![ids[rng.below(ids.len())].clone()], alignment }]
        }
        _ => {
            let layer_id = af.composite_layers[rng.below(af.composite_layers.len())].clone();
            vec![FontIntent::AddComponent { layer_id, component_id: ComponentId::new(), base_glyph_id: af.mark.clone() }]
        }
    };
    FontIntentSet { intents }
}

fn change_keys(cs: &FontChangeSet) -> Vec<String> {
    cs.changes
        .iter()
        .map(|c| match c {
            FontChange::Layer { layer, .. } => {
                format!("layer:{}", layer.after.as_ref().or(layer.before.as_ref()).unwrap().id())
            }
            other => format!("{:?}", std::mem::discriminant(other)),
        })
        .collect()
}

fn fresh(font: &Font) -> Font {
    serde_json::from_str(&serde_json::to_string(font).unwrap()).unwrap()
}

#[derive(Default, Debug)]
struct Outcome {
    sets: usize,
    multi_layer_changesets: usize,
    order_mismatches: usize,
    debug_mismatches: usize,
    echo_order_mismatches: usize,
    font_mismatches: usize,
}

fn run(af: &AnchorFont, seeds: std::ops::RangeInclusive<u64>, steps: usize) -> Outcome {
    let mut out = Outcome::default();
    for seed in seeds {
        let mut rng = Lcg(seed);
        let mut renderer = fresh(&af.font);
        let mut native = fresh(&af.font);
        for _ in 0..steps {
            let set = random_set(af, &renderer, &mut rng);
            let (Ok(r), Ok(n)) = (renderer.apply_intents(set.clone()), native.apply_intents(set)) else {
                continue;
            };
            out.sets += 1;
            if r.changes.changes.len() > 1 {
                out.multi_layer_changesets += 1;
            }
            if change_keys(&r.changes) != change_keys(&n.changes) {
                out.order_mismatches += 1;
            }
            if format!("{:?}", r.changes) != format!("{:?}", n.changes) {
                out.debug_mismatches += 1;
            }
            let ids = |a: &shift_font::AppliedIntents| a.layers.iter().map(|l| l.layer.id()).collect::<Vec<_>>();
            if ids(&r) != ids(&n) {
                out.echo_order_mismatches += 1;
            }
            if renderer != native {
                out.font_mismatches += 1;
            }
        }
    }
    out
}

#[test]
fn independently_loaded_engines_agree_on_anchor_edits() {
    let af = anchor_font(3, 12, 0);
    let out = run(&af, 1..=60, 80);
    eprintln!("{out:?}");
    assert!(out.multi_layer_changesets > 0);
    assert_eq!(out.font_mismatches, 0, "fonts diverged");
    assert_eq!(out.order_mismatches, 0, "changeset order diverged");
    assert_eq!(out.echo_order_mismatches, 0, "echo layer order diverged");
    assert_eq!(out.debug_mismatches, 0, "changesets differ");
}

/// Times one anchor move on a base glyph used by composites, against a point
/// move on the same font, to isolate realign's all-layers scan.
#[test]
#[ignore]
fn realign_scan_cost() {
    for filler in [0usize, 10_000, 30_000] {
        let af = anchor_font(2, 50, filler);
        let mut font = af.font.clone();
        let (layer_id, anchor_id) = af.base_layers[0].clone();
        let point_id = font.layer(&layer_id).unwrap().contours_iter().next().unwrap().points()[0].id();
        let time = |font: &mut Font, f: &dyn Fn(usize) -> FontIntent| {
            let t = std::time::Instant::now();
            for i in 0..10 {
                font.apply_intents(FontIntentSet { intents: vec![f(i)] }).unwrap();
            }
            t.elapsed().as_secs_f64() * 100.0
        };
        let anchor_ms = time(&mut font, &|i| FontIntent::MoveAnchors { layer_id: layer_id.clone(), anchor_ids: vec![anchor_id.clone()], coords: vec![i as f64, 500.0] });
        let point_ms = time(&mut font, &|i| FontIntent::MovePoints { layer_id: layer_id.clone(), point_ids: vec![point_id.clone()], coords: vec![i as f64, 0.0] });
        eprintln!("filler={filler} glyphs={} move_anchor_ms={anchor_ms:.2} move_point_ms={point_ms:.2}", font.glyph_count());
    }
}

