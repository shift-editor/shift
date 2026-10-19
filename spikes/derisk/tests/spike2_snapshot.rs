//! Spike 2: the engine opens from a complete native snapshot (everything but
//! layer payloads), and kerning-heavy fonts stay cheap to edit.
//!
//! Run one font: `SPIKE_FONT=<path> cargo test --release --test spike2_snapshot -- --nocapture`

use std::time::{Duration, Instant};

use shift_font::{
    Font, FontIntent, FontIntentSet, GlyphLayer, KerningPair, KerningSide, KerningValueEdit,
    PointId,
};
use shift_workspace::{AcquireScope, FontWorkspace};

fn ms(duration: Duration) -> f64 {
    (duration.as_secs_f64() * 1000.0 * 1000.0).round() / 1000.0
}

fn median(mut samples: Vec<Duration>) -> f64 {
    samples.sort();
    ms(samples[samples.len() / 2])
}

fn kerning_pairs(font: &Font) -> usize {
    font.kerning()
        .sources()
        .map(|(_, source)| source.len())
        .sum()
}

fn layer_points(font: &Font) -> usize {
    font.glyphs()
        .flat_map(|glyph| glyph.layers().values())
        .map(|layer| layer.contours_iter().map(|c| c.points().len()).sum::<usize>())
        .sum()
}

/// The first loaded layer with a point, for edit timing.
fn editable_point(font: &Font) -> Option<(shift_font::LayerId, PointId)> {
    font.glyphs()
        .flat_map(|glyph| glyph.layers().values())
        .find_map(|layer: &std::sync::Arc<GlyphLayer>| {
            let point = layer.contours_iter().next()?.points().first()?.id();
            Some((layer.id(), point))
        })
}

#[test]
fn snapshot_size_load_and_edit_cost() {
    let Ok(path) = std::env::var("SPIKE_FONT") else {
        eprintln!("set SPIKE_FONT to a font source to measure");
        return;
    };
    let dir = tempfile::tempdir().unwrap();
    let start = Instant::now();
    let mut workspace = FontWorkspace::open(&path, dir.path().join("w.sqlite")).unwrap();
    let import = start.elapsed();

    // Load a few glyphs, as an editor session would before its first edit.
    let some: Vec<_> = workspace.font().glyphs().take(40).map(|glyph| glyph.id()).collect();
    workspace.acquire_glyphs(&some, AcquireScope::ComponentClosure).unwrap();
    let font = workspace.font().clone();

    println!(
        "font {path}\n  import {} ms | glyphs {} | sources {} | axes {} | kerning pairs {} (groups {}) | loaded points {}",
        ms(import),
        font.glyph_count(),
        font.sources().len(),
        font.axes().len(),
        kerning_pairs(&font),
        font.kerning().groups(shift_font::KerningPosition::First).count()
            + font.kerning().groups(shift_font::KerningPosition::Second).count(),
        layer_points(&font),
    );

    // The engine's opening snapshot: the directory-form font native holds.
    let t = Instant::now();
    let json = serde_json::to_vec(&font).unwrap();
    let json_encode = t.elapsed();
    let t = Instant::now();
    let postcard = postcard::to_stdvec(&font).unwrap();
    let postcard_encode = t.elapsed();
    let t = Instant::now();
    let msgpack = rmp_serde::to_vec_named(&font).unwrap();
    let msgpack_encode = t.elapsed();
    if let Ok(out) = std::env::var("SPIKE_SNAPSHOT_OUT") {
        std::fs::write(out, &msgpack).unwrap();
    }

    let t = Instant::now();
    let from_json: Font = serde_json::from_slice(&json).unwrap();
    let json_decode = t.elapsed();
    let t = Instant::now();
    let postcard_result: Result<Font, _> = postcard::from_bytes(&postcard);
    let postcard_decode = t.elapsed();
    if let Err(error) = &postcard_result {
        println!("  postcard cannot decode the snapshot: {error}");
    }
    let t = Instant::now();
    let from_msgpack: Font = rmp_serde::from_slice(&msgpack).unwrap();
    let msgpack_decode = t.elapsed();
    if from_json != font || from_msgpack != font {
        let parts: [(&str, bool); 10] = [
            ("metadata", from_json.metadata() == font.metadata()),
            ("metrics", from_json.metrics() == font.metrics()),
            ("metric definitions", from_json.metric_definitions() == font.metric_definitions()),
            ("axes", from_json.axes() == font.axes()),
            ("axis mappings", from_json.axis_mappings() == font.axis_mappings()),
            ("named instances", from_json.named_instances() == font.named_instances()),
            ("sources", from_json.sources() == font.sources()),
            ("kerning", from_json.kerning() == font.kerning()),
            ("features", from_json.features() == font.features()),
            ("lib", from_json.lib() == font.lib()),
        ];
        let differing: Vec<_> = parts.iter().filter(|(_, same)| !same).map(|(name, _)| *name).collect();
        let glyphs = font
            .glyphs()
            .filter(|glyph| from_json.glyph(&glyph.id()) != Some(*glyph))
            .count();
        println!(
            "  ROUND TRIP: json exact {} | msgpack exact {} | json differs in parts {differing:?} and {glyphs} glyphs",
            from_json == font,
            from_msgpack == font,
        );
        if let Some(glyph) = font.glyphs().find(|glyph| from_json.glyph(&glyph.id()) != Some(*glyph)) {
            let other = from_json.glyph(&glyph.id()).unwrap();
            for (id, layer) in glyph.layers() {
                if other.layers().get(id) != Some(layer) {
                    let a = serde_json::to_string(layer.as_ref()).unwrap();
                    let b = serde_json::to_string(other.layers()[id].as_ref()).unwrap();
                    let at = a.bytes().zip(b.bytes()).position(|(x, y)| x != y);
                    println!("  first differing layer of {}: json equal {} first byte diff {:?}", glyph.name(), a == b, at);
                    if let Some(at) = at {
                        let from = at.saturating_sub(120);
                        println!("    original: …{}…", &a[from..(at + 80).min(a.len())]);
                        println!("    decoded:  …{}…", &b[from..(at + 80).min(b.len())]);
                    }
                }
            }
        }
    }

    println!(
        "  snapshot json {:.1} MB enc {} dec {} | postcard {:.1} MB enc {} dec {} | msgpack {:.1} MB enc {} dec {}",
        json.len() as f64 / 1e6, ms(json_encode), ms(json_decode),
        postcard.len() as f64 / 1e6, ms(postcard_encode), ms(postcard_decode),
        msgpack.len() as f64 / 1e6, ms(msgpack_encode), ms(msgpack_decode),
    );

    // Per-edit cost on this font, in the engine's copy.
    let mut engine = from_msgpack;
    if let Some((layer_id, point_id)) = editable_point(&engine) {
        let samples = (0..15)
            .map(|i| {
                let t = Instant::now();
                engine
                    .apply_intents(FontIntentSet {
                        intents: vec![FontIntent::MovePoints {
                            layer_id: layer_id.clone(),
                            point_ids: vec![point_id.clone()],
                            coords: vec![i as f64, 0.0],
                        }],
                    })
                    .unwrap();
                t.elapsed()
            })
            .collect();
        println!("  move one point: {} ms", median(samples));
    }

    let glyphs: Vec<_> = engine.glyphs().take(2).map(|glyph| glyph.id()).collect();
    if let (Some(source), [first, second]) = (engine.default_source_id(), glyphs.as_slice()) {
        let pair = KerningPair::new(KerningSide::Glyph(first.clone()), KerningSide::Glyph(second.clone()));
        let samples = (0..15)
            .map(|i| {
                let t = Instant::now();
                engine
                    .apply_intents(FontIntentSet {
                        intents: vec![FontIntent::SetKerningValues {
                            edits: vec![KerningValueEdit {
                                source_id: source.clone(),
                                pair: pair.clone(),
                                value: Some(-(i as f64)),
                            }],
                        }],
                    })
                    .unwrap();
                t.elapsed()
            })
            .collect();
        println!("  set one kerning value: {} ms", median(samples));
    }
}

/// MutatorSans's real sources and glyphs, with `pairs_per_source` synthetic
/// kerning pairs added at every source through `SetKerningValues`.
fn kerning_heavy_font(pairs_per_source: usize) -> Font {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/fonts/mutatorsans-variable/MutatorSans.designspace");
    let dir = tempfile::tempdir().unwrap();
    let mut workspace = FontWorkspace::open(path, dir.path().join("w.sqlite")).unwrap();
    let ids: Vec<_> = workspace.font().glyphs().map(|glyph| glyph.id()).collect();
    workspace.acquire_glyphs(&ids, AcquireScope::ComponentClosure).unwrap();
    let mut font = workspace.font().clone();
    // 49 glyphs give 2,401 ordered glyph pairs; widen with synthetic glyphs.
    let mut glyph_ids = ids.clone();
    let mut index = 0;
    while glyph_ids.len() * glyph_ids.len() < pairs_per_source {
        let glyph = shift_font::Glyph::new(format!("kern{index:05}"));
        glyph_ids.push(font.insert_glyph(glyph).unwrap());
        index += 1;
    }
    let sources: Vec<_> = font.sources().iter().map(|source| source.id()).collect();
    for source in &sources {
        let edits: Vec<_> = (0..pairs_per_source)
            .map(|k| KerningValueEdit {
                source_id: source.clone(),
                pair: KerningPair::new(
                    KerningSide::Glyph(glyph_ids[k % glyph_ids.len()].clone()),
                    KerningSide::Glyph(glyph_ids[k / glyph_ids.len()].clone()),
                ),
                value: Some(-((k % 90) as f64) - 1.0),
            })
            .collect();
        font.apply_intents(FontIntentSet { intents: vec![FontIntent::SetKerningValues { edits }] }).unwrap();
    }
    font
}

#[test]
fn kerning_heavy_edit_cost() {
    for pairs in [1_000, 10_000, 40_000] {
        let mut font = kerning_heavy_font(pairs);
        let (layer_id, point_id) = editable_point(&font).unwrap();
        let moves = (0..15)
            .map(|i| {
                let t = Instant::now();
                font.apply_intents(FontIntentSet {
                    intents: vec![FontIntent::MovePoints {
                        layer_id: layer_id.clone(),
                        point_ids: vec![point_id.clone()],
                        coords: vec![i as f64, 0.0],
                    }],
                })
                .unwrap();
                t.elapsed()
            })
            .collect();
        let source = font.default_source_id().unwrap();
        let first = font.glyphs().next().unwrap().id();
        let kerns = (0..15)
            .map(|i| {
                let t = Instant::now();
                font.apply_intents(FontIntentSet {
                    intents: vec![FontIntent::SetKerningValues {
                        edits: vec![KerningValueEdit {
                            source_id: source.clone(),
                            pair: KerningPair::new(KerningSide::Glyph(first.clone()), KerningSide::Glyph(first.clone())),
                            value: Some(-(i as f64) - 1.0),
                        }],
                    }],
                })
                .unwrap();
                t.elapsed()
            })
            .collect();
        let msgpack = rmp_serde::to_vec_named(&font).unwrap();
        if let Ok(dir) = std::env::var("SPIKE_SNAPSHOT_DIR") {
            std::fs::write(format!("{dir}/kerning-{pairs}.msgpack"), &msgpack).unwrap();
        }
        let t = Instant::now();
        let decoded: Font = rmp_serde::from_slice(&msgpack).unwrap();
        let decode = t.elapsed();
        assert!(decoded == font, "msgpack snapshot must round-trip exactly");
        println!(
            "kerning {pairs} pairs x {} sources = {} total | move one point {} ms | set one kerning value {} ms | snapshot msgpack {:.1} MB, decode {} ms",
            font.sources().len(),
            kerning_pairs(&font),
            median(moves),
            median(kerns),
            msgpack.len() as f64 / 1e6,
            ms(decode),
        );
    }
}
