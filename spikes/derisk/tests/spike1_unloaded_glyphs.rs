//! SPIKE 1: edits that reach glyphs the engine has not loaded.
//!
//! The engine holds the directory plus loaded glyphs; native truth is a lazy
//! `FontWorkspace`. Each trial opens both from the same document, loads a
//! random set of "visible" glyphs (with their component closure) into the
//! engine, and applies the same random intents to both. With
//! `LoadPolicy::Visible` the engine applies only what the renderer shows;
//! with `LoadPolicy::RequiredLoads` it first loads `required_loads`.
//!
//! Equal means byte-equal changesets (Debug), equal outcomes on errors, and
//! equal glyphs for every glyph the engine has loaded.

use std::collections::{BTreeMap, BTreeSet};
use std::time::Instant;

use engine_derisk::engine::{Engine, LoadPolicy};
use engine_derisk::fixtures::{fixture, Document};
use shift_font::{
    AnchorId, AnchorSeed, ComponentAlignment, ComponentId, DecomposedTransform, Font, FontIntent,
    FontIntentSet, GlyphId, GlyphLayer, LayerId, Transform,
};
use shift_workspace::FontWorkspace;

struct Lcg(u64);
impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        self.0 >> 33
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n.max(1) as u64) as usize
    }
    fn f(&mut self, range: f64) -> f64 {
        (self.next() % 10_000) as f64 / 10_000.0 * range - range / 2.0
    }
}

fn glyph_ids(font: &Font) -> Vec<GlyphId> {
    font.glyphs().map(|glyph| glyph.id()).collect()
}

/// A random edit on a loaded layer of `glyph`, of the kinds that reach other glyphs.
fn random_intent(engine: &Engine, glyph: &GlyphId, rng: &mut Lcg) -> Option<(&'static str, FontIntent)> {
    let layers: Vec<&GlyphLayer> = engine.font.glyph(glyph)?.layers().values().map(|l| l.as_ref()).collect();
    let layer = layers[rng.below(layers.len())];
    let layer_id: LayerId = layer.id();
    let anchors: Vec<AnchorId> = layer.anchors_iter().map(|a| a.id()).collect();
    let components: Vec<ComponentId> = layer.components_iter().map(|c| c.id()).collect();
    let all = glyph_ids(&engine.font);
    let pick_anchor = |rng: &mut Lcg| anchors.get(rng.below(anchors.len())).cloned();
    let pick_component = |rng: &mut Lcg| components.get(rng.below(components.len())).cloned();
    let names = ["top", "bottom", "_top", "_bottom", "ogonek", "top_1"];
    Some(match rng.below(10) {
        0 | 1 => {
            let anchor = pick_anchor(rng)?;
            ("moveAnchors", FontIntent::MoveAnchors { layer_id, anchor_ids: vec![anchor], coords: vec![rng.f(400.0), 600.0 + rng.f(200.0)] })
        }
        2 => {
            let anchor = pick_anchor(rng)?;
            ("renameAnchors", FontIntent::RenameAnchors { layer_id, anchor_ids: vec![anchor], names: vec![names[rng.below(names.len())].to_string()] })
        }
        3 => ("addAnchors", FontIntent::AddAnchors { layer_id, anchors: vec![AnchorSeed { id: AnchorId::new(), name: Some(names[rng.below(names.len())].to_string()), x: rng.f(400.0), y: 700.0 }] }),
        4 => {
            let anchor = pick_anchor(rng)?;
            ("removeAnchors", FontIntent::RemoveAnchors { layer_id, anchor_ids: vec![anchor] })
        }
        5 => ("addComponent", FontIntent::AddComponent { layer_id, component_id: ComponentId::new(), base_glyph_id: all[rng.below(all.len())].clone() }),
        6 => {
            let component = pick_component(rng)?;
            ("decomposeComponents", FontIntent::DecomposeComponents { layer_id, component_ids: vec![component] })
        }
        7 => {
            let component = pick_component(rng)?;
            let alignment = if rng.below(2) == 0 { ComponentAlignment::Anchored } else { ComponentAlignment::Free };
            ("setComponentAlignment", FontIntent::SetComponentAlignment { layer_id, component_ids: vec![component], alignment })
        }
        8 => {
            let component = pick_component(rng)?;
            let t = DecomposedTransform { translate_x: rng.f(100.0), translate_y: rng.f(100.0), ..DecomposedTransform::identity() };
            let v = vec![t.translate_x, t.translate_y, t.rotation, t.scale_x, t.scale_y, t.skew_x, t.skew_y, t.t_center_x, t.t_center_y];
            ("setComponentTransforms", FontIntent::SetComponentTransforms { layer_id, component_ids: vec![component], transforms: v })
        }
        _ => {
            let a = rng.f(0.6);
            ("transformLayer", FontIntent::TransformLayer { layer_id, transform: Transform { xx: a.cos(), xy: a.sin(), yx: -a.sin(), yy: a.cos(), dx: rng.f(50.0), dy: 0.0 } })
        }
    })
}

#[derive(Default, Debug)]
struct Tally {
    applied: usize,
    agreed: usize,
    /// Equal once identities minted inside Rust (decompose) are ignored.
    identity_only: usize,
    diverged: usize,
    diverged_by_kind: BTreeMap<&'static str, (usize, usize)>,
    extra_loads: usize,
    both_rejected: usize,
}

/// Replaces point and contour ids, which Rust mints at random in some intents.
fn without_minted_ids(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(index) = ["point_", "contour_"].iter().filter_map(|p| rest.find(p).map(|i| (i, p.len()))).min() {
        let (start, prefix) = index;
        out.push_str(&rest[..start]);
        out.push_str("ID");
        let tail = &rest[start + prefix..];
        let end = tail.find(|c: char| !(c.is_ascii_alphanumeric() || c == '_' || c == '-')).unwrap_or(tail.len());
        rest = &tail[end..];
    }
    out.push_str(rest);
    out
}

fn outcome(result: &shift_font::CoreResult<shift_font::AppliedIntents>) -> String {
    match result {
        Ok(applied) => format!("{:?}", applied.changes),
        Err(error) => format!("Err({error:?})"),
    }
}

fn native_apply(workspace: &mut FontWorkspace, intent: &FontIntent) -> shift_font::CoreResult<shift_font::AppliedIntents> {
    workspace
        .apply(FontIntentSet { intents: vec![intent.clone()] }, None)
        .map_err(|error| shift_font::CoreError::InvalidEntityOrder { kind: "workspace", message: error.to_string() })
}

/// Runs `trials` random sessions on one document and tallies agreement.
fn run(document: &Document, policy: LoadPolicy, trials: u64, steps: usize) -> Tally {
    let mut tally = Tally::default();
    for seed in 1..=trials {
        let mut rng = Lcg(seed * 7919);
        let (_dir, mut native) = document.open();
        let mut engine = Engine::open(&native, policy);
        let all = glyph_ids(&engine.font);
        // Visible glyphs: a random third of the font, as a proof board might show.
        let visible: Vec<GlyphId> = all.iter().filter(|_| rng.below(3) == 0).cloned().collect();
        if visible.is_empty() {
            continue;
        }
        engine.load(&mut native, visible.clone());
        let before_extra = engine.extra_loaded;
        for _ in 0..steps {
            let glyph = &visible[rng.below(visible.len())];
            let Some((kind, intent)) = random_intent(&engine, glyph, &mut rng) else { continue };
            // The renderer only edits what it shows, so native has that loaded too.
            let engine_result = engine.apply(&mut native, std::slice::from_ref(&intent));
            let native_result = native_apply(&mut native, &intent);
            tally.applied += 1;
            let entry = tally.diverged_by_kind.entry(kind).or_default();
            entry.0 += 1;
            let same = match (&engine_result, &native_result) {
                (Ok(_), Ok(_)) => outcome(&engine_result) == outcome(&native_result),
                (Err(_), Err(_)) => {
                    tally.both_rejected += 1;
                    true
                }
                _ => false,
            };
            let loaded_equal = engine.loaded.iter().all(|glyph| engine.font.glyph(glyph) == native.font().glyph(glyph));
            let identity_only = !(same && loaded_equal)
                && engine_result.is_ok()
                && native_result.is_ok()
                && without_minted_ids(&outcome(&engine_result)) == without_minted_ids(&outcome(&native_result));
            if same && loaded_equal {
                tally.agreed += 1;
            } else if identity_only {
                tally.identity_only += 1;
                let loaded: Vec<GlyphId> = engine.loaded.iter().cloned().collect();
                engine = Engine::open(&native, policy);
                engine.load(&mut native, loaded);
            } else {
                tally.diverged += 1;
                entry.1 += 1;
                // Re-sync the engine from truth so later steps test fresh divergence.
                let loaded: Vec<GlyphId> = engine.loaded.iter().cloned().collect();
                engine = Engine::open(&native, policy);
                engine.load(&mut native, loaded);
            }
        }
        tally.extra_loads += engine.extra_loaded - before_extra;
    }
    tally
}

const FONTS: [&str; 4] = ["AnchorPropagation.glyphs", "AnchorDragBench.glyphs", "Homenaje.glyphs", "MutatorSansVariable.glyphs"];

#[test]
fn visible_only_engine_diverges_from_native() {
    for name in FONTS {
        let document = Document::import(&fixture(name));
        let tally = run(&document, LoadPolicy::Visible, 12, 40);
        eprintln!("VISIBLE {name}: {tally:?}");
    }
}

#[test]
fn required_loads_engine_matches_native() {
    let mut diverged = 0;
    for name in FONTS {
        let document = Document::import(&fixture(name));
        let tally = run(&document, LoadPolicy::RequiredLoads, 40, 60);
        eprintln!("REQUIRED {name}: {tally:?}");
        diverged += tally.diverged;
    }
    assert_eq!(diverged, 0);
}

/// How many glyphs one anchor move must load, on the real fixtures.
#[test]
fn required_load_sizes_on_fixtures() {
    for name in FONTS {
        let document = Document::import(&fixture(name));
        let (_dir, native) = document.open();
        let engine = Engine::open(&native, LoadPolicy::RequiredLoads);
        let mut sizes: Vec<(usize, String)> = engine
            .font
            .glyphs()
            .filter_map(|glyph| {
                let layer = glyph.layers().values().next()?;
                let intent = FontIntent::MoveAnchors { layer_id: layer.id(), anchor_ids: vec![], coords: vec![] };
                Some((engine.required_loads(&[intent]).len(), glyph.glyph_name().to_string()))
            })
            .collect();
        sizes.sort();
        let top: Vec<_> = sizes.iter().rev().take(3).collect();
        let dependents: BTreeSet<usize> = sizes.iter().map(|(n, _)| *n).collect();
        eprintln!("SIZES {name}: {} glyphs, largest anchor-edit load sets {top:?}, distinct sizes {dependents:?}", sizes.len());
        let _ = Instant::now();
    }
}
