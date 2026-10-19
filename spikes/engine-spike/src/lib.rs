//! Spike: cost of running shift-font's real `apply_intents` as the editor's
//! local engine, natively and in wasm32. Same code drives both targets; only
//! the clock differs.

use shift_font::{
    Contour, DecomposedTransform, DesignLocation, Font, FontIntent, FontIntentSet, Glyph,
    GlyphId, GlyphLayer, KerningPair, LayerId, PointId, PointSeed, PointType, Source, SourceId,
};

#[cfg(target_arch = "wasm32")]
mod clock {
    use wasm_bindgen::prelude::*;
    #[wasm_bindgen]
    extern "C" {
        #[wasm_bindgen(js_namespace = performance)]
        fn now() -> f64;
    }
    pub fn ms() -> f64 {
        now()
    }
}

#[cfg(not(target_arch = "wasm32"))]
mod clock {
    use std::sync::OnceLock;
    use std::time::Instant;
    static START: OnceLock<Instant> = OnceLock::new();
    pub fn ms() -> f64 {
        START.get_or_init(Instant::now).elapsed().as_secs_f64() * 1000.0
    }
}

pub use clock::ms;

/// One synthetic font shape.
#[derive(Clone, Copy, Debug)]
pub struct Shape {
    pub glyphs: usize,
    pub sources: usize,
    /// Glyphs carrying geometry; the rest are empty directory placeholders,
    /// as in the lazy workspace.
    pub resident: usize,
    pub contours: usize,
    pub points_per_contour: usize,
    pub kerning_pairs_per_source: usize,
    /// Points in the single contour of the glyph being edited.
    pub target_points: usize,
}

pub struct Scenario {
    pub font: Font,
    pub layer_id: LayerId,
    pub contour_id: shift_font::ContourId,
    pub point_ids: Vec<PointId>,
}

fn contour_ring(n: usize, r: f64) -> Contour {
    let mut c = Contour::new();
    for i in 0..n {
        let a = i as f64 / n as f64 * std::f64::consts::TAU;
        let t = if i % 3 == 0 { PointType::OnCurve } else { PointType::OffCurve };
        c.add_point(r * a.cos() + 300.0, r * a.sin() + 300.0, t, false);
    }
    c.close();
    c
}

pub fn build(shape: Shape) -> Scenario {
    let mut font = Font::empty();
    let mut source_ids: Vec<SourceId> = Vec::new();
    for s in 0..shape.sources {
        let id = font.add_source(Source::new(format!("S{s}"), DesignLocation::new()));
        source_ids.push(id);
    }
    font.set_default_source_id(source_ids[0].clone());

    let mut glyph_ids: Vec<GlyphId> = Vec::with_capacity(shape.glyphs + 1);
    for g in 0..shape.glyphs {
        let mut glyph = Glyph::new(format!("g{g:05}"));
        for sid in &source_ids {
            let mut layer = GlyphLayer::with_width(LayerId::new(), sid.clone(), 600.0);
            if g < shape.resident {
                for c in 0..shape.contours {
                    layer.add_contour(contour_ring(shape.points_per_contour, 50.0 + c as f64 * 40.0));
                }
            }
            glyph.set_layer(layer);
        }
        glyph_ids.push(font.insert_glyph(glyph).expect("insert glyph"));
    }

    // The glyph being edited.
    let mut target = Glyph::new("target");
    let layer_id = LayerId::new();
    let mut layer = GlyphLayer::with_width(layer_id.clone(), source_ids[0].clone(), 600.0);
    let ring = contour_ring(shape.target_points, 250.0);
    let contour_id = ring.id();
    let point_ids = ring.points().iter().map(|p| p.id()).collect();
    layer.add_contour(ring);
    target.set_layer(layer);
    for sid in source_ids.iter().skip(1) {
        target.set_layer(GlyphLayer::with_width(LayerId::new(), sid.clone(), 600.0));
    }
    font.insert_glyph(target).expect("insert target");

    let n = glyph_ids.len().max(1);
    for sid in &source_ids {
        for k in 0..shape.kerning_pairs_per_source {
            let a = glyph_ids[k % n].clone();
            let b = glyph_ids[(k / n + k * 7 + 1) % n].clone();
            font.kerning_mut()
                .set_value(sid.clone(), KerningPair::glyphs(a, b), -((k % 80) as f64));
        }
    }

    Scenario { font, layer_id, contour_id, point_ids }
}

fn apply(font: &mut Font, intent: FontIntent) {
    font.apply_intents(FontIntentSet { intents: vec![intent] })
        .expect("apply");
}

/// Result of one timed operation: mean and p95 in milliseconds.
#[derive(serde::Serialize)]
pub struct Timing {
    pub op: &'static str,
    pub mean_ms: f64,
    pub p95_ms: f64,
    pub iters: usize,
}

fn timed(op: &'static str, iters: usize, mut f: impl FnMut(usize)) -> Timing {
    f(0); // warm
    let mut samples = Vec::with_capacity(iters);
    for i in 0..iters {
        let t = ms();
        f(i + 1);
        samples.push(ms() - t);
    }
    samples.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let mean = samples.iter().sum::<f64>() / iters as f64;
    let p95 = samples[((iters as f64 * 0.95) as usize).min(iters - 1)];
    Timing { op, mean_ms: mean, p95_ms: p95, iters }
}

/// Times the edits a tool commits once per gesture, through the real engine.
pub fn run(shape: Shape, iters: usize) -> Vec<Timing> {
    let t = ms();
    let mut sc = build(shape);
    let build_ms = ms() - t;
    let mut out = vec![Timing { op: "build", mean_ms: build_ms, p95_ms: build_ms, iters: 1 }];

    let layer_id = sc.layer_id.clone();
    let first = sc.point_ids[0].clone();
    let all = sc.point_ids.clone();

    // Baseline: copy-on-write of the whole font state, the first step of any edit.
    {
        let font = sc.font.clone();
        out.push(timed("font_state_cow", iters, |_| {
            let mut f = font.clone();
            f.metadata_mut().note = Some("x".into());
            std::hint::black_box(&f);
        }));
    }

    out.push(timed("move_1_point", iters, |i| {
        apply(&mut sc.font, FontIntent::MovePoints {
            layer_id: layer_id.clone(),
            point_ids: vec![first.clone()],
            coords: vec![10.0 + i as f64, 20.0],
        });
    }));

    let coords: Vec<f64> = (0..all.len() * 2).map(|i| i as f64).collect();
    out.push(timed("move_all_points", iters, |i| {
        let c: Vec<f64> = coords.iter().map(|v| v + i as f64).collect();
        apply(&mut sc.font, FontIntent::MovePoints {
            layer_id: layer_id.clone(),
            point_ids: all.clone(),
            coords: c,
        });
    }));

    out.push(timed("reverse_contour", iters, |_| {
        apply(&mut sc.font, FontIntent::ReverseContour {
            layer_id: layer_id.clone(),
            contour_id: sc.contour_id.clone(),
        });
    }));

    // Add then remove one point; each sample is one add plus one remove.
    out.push(timed("add_then_remove_point", iters, |_| {
        let id = PointId::new();
        apply(&mut sc.font, FontIntent::AddPoints {
            layer_id: layer_id.clone(),
            contour_id: None,
            before: Some(first.clone()),
            points: vec![PointSeed { id: id.clone(), x: 1.0, y: 2.0, point_type: PointType::OnCurve, smooth: false }],
        });
        apply(&mut sc.font, FontIntent::RemovePoints {
            layer_id: layer_id.clone(),
            point_ids: vec![id],
        });
    }));

    // Undo path: apply an inverted changeset.
    {
        let applied = sc.font.apply_intents(FontIntentSet { intents: vec![FontIntent::MovePoints {
            layer_id: layer_id.clone(),
            point_ids: vec![first.clone()],
            coords: vec![-5.0, -5.0],
        }] }).expect("apply");
        let forward = applied.changes;
        let inverse = forward.inverted();
        out.push(timed("undo_redo_changeset", iters, |_| {
            sc.font.apply_change_set(&inverse).expect("undo");
            sc.font.apply_change_set(&forward).expect("redo");
        }));
    }

    // What the TS projection would need after a structural edit: the touched
    // layer as flat numbers (coords + point types).
    out.push(timed("export_layer_flat", iters, |_| {
        let layer = sc.font.layer(&layer_id).unwrap();
        let mut v = Vec::with_capacity(all.len() * 3);
        for c in layer.contours_iter() {
            for p in c.points() {
                v.push(p.x());
                v.push(p.y());
                v.push(if p.is_on_curve() { 1.0 } else { 0.0 });
            }
        }
        std::hint::black_box(v);
    }));

    out
}

/// Bit patterns of component transform round-trips over a sweep, for
/// comparing native and wasm32 arithmetic.
pub fn transform_bits() -> Vec<u64> {
    let mut out = Vec::new();
    for i in 0..2000 {
        let f = i as f64;
        let t = DecomposedTransform {
            translate_x: f * 1.37 - 400.0,
            translate_y: f * 0.73,
            rotation: (f * 7.919) % 360.0 - 180.0,
            scale_x: 0.5 + (f % 17.0) / 10.0,
            scale_y: 0.4 + (f % 13.0) / 9.0,
            skew_x: (f % 23.0) - 11.0,
            skew_y: (f % 19.0) - 9.0,
            t_center_x: (f % 7.0) * 10.0,
            t_center_y: (f % 5.0) * 10.0,
        };
        let m = t.to_matrix();
        for v in [m.xx, m.xy, m.yx, m.yy, m.dx, m.dy] {
            out.push(v.to_bits());
        }
        let back = DecomposedTransform::from_matrix(&m);
        for v in [back.rotation, back.scale_x, back.scale_y, back.skew_x, back.skew_y] {
            out.push(v.to_bits());
        }
    }
    out
}

pub fn fnv(bits: &[u64]) -> u64 {
    bits.iter().fold(0xcbf29ce484222325u64, |h, b| (h ^ b).wrapping_mul(0x100000001b3))
}

pub fn shapes() -> Vec<(&'static str, Shape)> {
    vec![
        ("latin_static", Shape { glyphs: 600, sources: 1, resident: 600, contours: 3, points_per_contour: 16, kerning_pairs_per_source: 3_000, target_points: 120 }),
        ("latin_variable_4src", Shape { glyphs: 1_500, sources: 4, resident: 1_500, contours: 3, points_per_contour: 16, kerning_pairs_per_source: 15_000, target_points: 300 }),
        ("cjk_lazy", Shape { glyphs: 30_000, sources: 2, resident: 300, contours: 6, points_per_contour: 24, kerning_pairs_per_source: 5_000, target_points: 600 }),
        ("cjk_all_resident", Shape { glyphs: 30_000, sources: 2, resident: 30_000, contours: 6, points_per_contour: 24, kerning_pairs_per_source: 5_000, target_points: 600 }),
        ("huge_glyph", Shape { glyphs: 600, sources: 1, resident: 600, contours: 3, points_per_contour: 16, kerning_pairs_per_source: 3_000, target_points: 20_000 }),
    ]
}

#[cfg(target_arch = "wasm32")]
mod wasm {
    use wasm_bindgen::prelude::*;

    #[wasm_bindgen]
    pub fn run_shape(name: &str, iters: usize) -> String {
        let (_, shape) = super::shapes().into_iter().find(|(n, _)| *n == name).expect("shape");
        let timings = super::run(shape, iters);
        let pages = core::arch::wasm32::memory_size(0);
        serde_json::json!({ "shape": name, "timings": timings, "wasm_memory_mb": pages as f64 * 64.0 / 1024.0 }).to_string()
    }

    #[wasm_bindgen]
    pub fn shape_names() -> String {
        serde_json::to_string(&super::shapes().iter().map(|(n, _)| *n).collect::<Vec<_>>()).unwrap()
    }

    #[wasm_bindgen]
    pub fn transform_hash() -> String {
        format!("{:016x}", super::fnv(&super::transform_bits()))
    }

    #[wasm_bindgen]
    pub fn transform_bits_json() -> String {
        serde_json::to_string(&super::transform_bits().iter().map(|b| format!("{b:016x}")).collect::<Vec<_>>()).unwrap()
    }

    /// Cost of handing a touched layer to JS as a structured value (tsify-style).
    #[wasm_bindgen]
    pub fn export_structured_ms(points: usize, iters: usize) -> f64 {
        let sc = super::build(super::Shape { glyphs: 1, sources: 1, resident: 0, contours: 0, points_per_contour: 0, kerning_pairs_per_source: 0, target_points: points });
        let layer = sc.font.layer(&sc.layer_id).unwrap().clone();
        let t = super::ms();
        for _ in 0..iters {
            let v = serde_wasm_bindgen::to_value(&layer).unwrap();
            std::hint::black_box(v);
        }
        (super::ms() - t) / iters as f64
    }
}

/// The same sweep as `transform_bits`, with trig from the pure-Rust `libm`
/// crate instead of std (which calls the platform libm natively).
pub fn transform_bits_libm() -> Vec<u64> {
    let mut out = Vec::new();
    for i in 0..2000 {
        let f = i as f64;
        let rotation: f64 = (f * 7.919) % 360.0 - 180.0;
        let (sx, sy) = (0.5 + (f % 17.0) / 10.0, 0.4 + (f % 13.0) / 9.0);
        let (kx, ky): (f64, f64) = ((f % 23.0) - 11.0, (f % 19.0) - 9.0);
        let cos_r = libm::cos(rotation.to_radians());
        let sin_r = libm::sin(rotation.to_radians());
        let tan_sx = libm::tan(kx.to_radians());
        let tan_sy = libm::tan(ky.to_radians());
        let xx = sx * cos_r + sy * tan_sx * sin_r;
        let xy = sx * sin_r - sy * tan_sx * cos_r;
        let yx = sy * -sin_r + sx * tan_sy * cos_r;
        let yy = sy * cos_r + sx * tan_sy * sin_r;
        let rot_back = libm::atan2(xy, xx).to_degrees();
        let skew_back = libm::atan((xx * yx + xy * yy) / (sx * sy)).to_degrees();
        for v in [xx, xy, yx, yy, rot_back, skew_back] {
            out.push(v.to_bits());
        }
    }
    out
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn transform_hash_libm() -> String {
    format!("{:016x}", fnv(&transform_bits_libm()))
}

/// Isolates what makes one edit scale with font size: each row varies one dimension.
pub fn sweep() -> Vec<serde_json::Value> {
    let base = Shape { glyphs: 100, sources: 1, resident: 0, contours: 3, points_per_contour: 16, kerning_pairs_per_source: 0, target_points: 120 };
    let rows: Vec<(&str, Shape)> = vec![
        ("baseline_100_glyphs", base),
        ("glyphs_10k_empty", Shape { glyphs: 10_000, ..base }),
        ("glyphs_30k_empty", Shape { glyphs: 30_000, ..base }),
        ("sources_x4_10k_empty", Shape { glyphs: 10_000, sources: 4, ..base }),
        ("kerning_50k_pairs", Shape { kerning_pairs_per_source: 50_000, ..base }),
        ("resident_1k_glyphs_48pts", Shape { glyphs: 1_000, resident: 1_000, ..base }),
        ("resident_5k_glyphs_48pts", Shape { glyphs: 5_000, resident: 5_000, ..base }),
    ];
    rows.into_iter().map(|(name, shape)| {
        let mut sc = build(shape);
        let layer_id = sc.layer_id.clone();
        let first = sc.point_ids[0].clone();
        let t = timed("move_1_point", 20, |i| {
            apply(&mut sc.font, FontIntent::MovePoints { layer_id: layer_id.clone(), point_ids: vec![first.clone()], coords: vec![i as f64, 0.0] });
        });
        serde_json::json!({ "row": name, "move_1_point_ms": t.mean_ms })
    }).collect()
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn sweep_json() -> String {
    serde_json::to_string(&sweep()).unwrap()
}

/// A stateful engine instance, as the renderer would hold one, for panic tests.
#[cfg(target_arch = "wasm32")]
mod engine {
    use std::cell::RefCell;
    use shift_font::{BooleanOp, Contour, Font, FontIntent, FontIntentSet, LayerId, PointType};
    use wasm_bindgen::prelude::*;

    thread_local! {
        static ENGINE: RefCell<Option<(Font, LayerId)>> = const { RefCell::new(None) };
    }

    pub fn engine_init_font(font: Font, layer_id: &str) {
        ENGINE.with(|e| *e.borrow_mut() = Some((font, layer_id.parse().unwrap())));
    }

    #[wasm_bindgen]
    pub fn engine_init(json: &str, layer_id: &str) {
        let font: Font = serde_json::from_str(json).expect("font json");
        ENGINE.with(|e| *e.borrow_mut() = Some((font, layer_id.parse().unwrap())));
    }

    /// A small font for the test plus the layer id to edit, as JSON.
    #[wasm_bindgen]
    pub fn engine_fixture() -> String {
        let sc = super::build(super::Shape { glyphs: 50, sources: 1, resident: 50, contours: 2, points_per_contour: 8, kerning_pairs_per_source: 20, target_points: 12 });
        serde_json::json!({ "font": serde_json::to_string(&sc.font).unwrap(), "layer": sc.layer_id.to_string() }).to_string()
    }

    #[wasm_bindgen]
    pub fn engine_snapshot() -> String {
        ENGINE.with(|e| serde_json::to_string(&e.borrow().as_ref().unwrap().0).unwrap())
    }

    #[wasm_bindgen]
    pub fn engine_hash() -> String {
        let json = engine_snapshot();
        format!("{:016x}", super::fnv(&json.bytes().map(u64::from).collect::<Vec<_>>()))
    }

    /// Moves the layer's first point; returns Ok/Err text.
    #[wasm_bindgen]
    pub fn engine_move_first_point(x: f64) -> String {
        ENGINE.with(|e| {
            let mut guard = e.borrow_mut();
            let (font, layer_id) = guard.as_mut().unwrap();
            let point = font.layer(layer_id).unwrap().contours_iter().next().unwrap().points()[0].id();
            format!("{:?}", font.apply_intents(FontIntentSet { intents: vec![FontIntent::MovePoints { layer_id: layer_id.clone(), point_ids: vec![point], coords: vec![x, 1.0] }] }).map(|_| ()))
        })
    }

    /// A panic in the middle of an edit, while the engine is borrowed.
    #[wasm_bindgen]
    pub fn engine_panic_mid_edit() {
        ENGINE.with(|e| {
            let mut guard = e.borrow_mut();
            let _ = guard.as_mut().unwrap();
            let v: Vec<u32> = Vec::new();
            let i = v.len() + 3;
            std::hint::black_box(v[i]);
        })
    }

    /// The stack-overflowing boolean op found by the fuzzer, through the engine.
    #[wasm_bindgen]
    pub fn engine_overflowing_boolean() -> String {
        ENGINE.with(|e| {
            let mut guard = e.borrow_mut();
            let (font, layer_id) = guard.as_mut().unwrap();
            let mut c = Contour::new();
            c.add_point(0.0, 0.0, PointType::OnCurve, false);
            c.add_point(400.0, 0.0, PointType::OnCurve, false);
            c.add_point(1e300, -0.0, PointType::OffCurve, true);
            c.add_point(f64::NAN, f64::NAN, PointType::OffCurve, true);
            c.add_point(200.0, 500.0, PointType::OnCurve, false);
            c.close();
            let id = c.id();
            font.layer_mut(layer_id).unwrap().add_contour(c);
            format!("{:?}", font.apply_intents(FontIntentSet { intents: vec![FontIntent::ApplyBooleanOp { layer_id: layer_id.clone(), contour_id_a: id.clone(), contour_id_b: id, operation: BooleanOp::Union }] }).map(|_| ()))
        })
    }
}

#[cfg(target_arch = "wasm32")]
mod load {
    use wasm_bindgen::prelude::*;

    #[wasm_bindgen]
    pub fn wasm_memory_mb() -> f64 {
        core::arch::wasm32::memory_size(0) as f64 * 64.0 / 1024.0
    }

    /// Loads a serialized font and edits its first glyph that has outlines.
    #[wasm_bindgen]
    pub fn engine_init_auto(json: &str) -> String {
        engine_init_auto_bytes(json.as_bytes())
    }

    #[wasm_bindgen]
    pub fn engine_init_auto_bytes(json: &[u8]) -> String {
        let font: shift_font::Font = serde_json::from_slice(json).expect("font json");
        let layer = font
            .glyphs()
            .flat_map(|g| g.layers().values())
            .find(|l| l.contours_iter().next().is_some())
            .map(|l| l.id().to_string())
            .unwrap_or_default();
        let json_again = String::new();
        let _ = json_again;
        super::engine::engine_init_font(font, &layer);
        layer
    }
}
