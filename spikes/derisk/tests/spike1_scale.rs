//! SPIKE 1, at scale: how much one anchor edit must load when a base glyph
//! is shared by many anchored, stacked composites (a Latin base under its
//! accented forms; a CJK radical under thousands of ideographs), and what
//! the load-before-apply step costs.

use std::time::{Duration, Instant};

use engine_derisk::engine::{Engine, LoadPolicy};
use shift_font::{
    Anchor, AnchorId, Component, ComponentAlignment, ComponentId, Contour, DecomposedTransform,
    DesignLocation, Font, FontIntent, FontIntentSet, Glyph, GlyphId, GlyphLayer, LayerId,
    PointType, Source,
};
use shift_store::{ShiftStore, WorkspaceState};
use shift_workspace::FontWorkspace;
use tempfile::TempDir;

fn square(x: f64, size: f64) -> Contour {
    let mut contour = Contour::new();
    for (dx, dy) in [(0.0, 0.0), (size, 0.0), (size, size), (0.0, size)] {
        contour.add_point(x + dx, dy, PointType::OnCurve, false);
    }
    contour.close();
    contour
}

/// `composites` glyphs each stacking `mark` on `base`'s `top`, across `sources`
/// masters, plus `filler` unrelated glyphs; every layer carries an outline.
fn synthetic(composites: usize, filler: usize, sources: usize) -> Font {
    let mut font = Font::empty();
    let source_ids: Vec<_> = (0..sources)
        .map(|s| font.add_source(Source::new(format!("S{s}"), DesignLocation::new())))
        .collect();
    font.set_default_source_id(source_ids[0].clone());
    let base_id = GlyphId::from_raw("base");
    let mark_id = GlyphId::from_raw("mark");

    let mut base = Glyph::with_id(base_id.clone(), "base");
    let mut mark = Glyph::with_id(mark_id.clone(), "mark");
    for (s, source) in source_ids.iter().enumerate() {
        let mut layer = GlyphLayer::with_width(LayerId::from_raw(format!("base_{s}")), source.clone(), 600.0);
        for c in 0..4 {
            layer.add_contour(square(c as f64 * 120.0, 100.0));
        }
        layer.add_anchor(Anchor::with_id(AnchorId::from_raw(format!("base_top_{s}")), Some("top".into()), 300.0, 700.0));
        base.set_layer(layer);
        let mut layer = GlyphLayer::with_width(LayerId::from_raw(format!("mark_{s}")), source.clone(), 0.0);
        layer.add_contour(square(0.0, 50.0));
        layer.add_anchor(Anchor::with_id(AnchorId::from_raw(format!("mark_attach_{s}")), Some("_top".into()), 25.0, 0.0));
        mark.set_layer(layer);
    }
    font.insert_glyph(base).unwrap();
    font.insert_glyph(mark).unwrap();

    for g in 0..composites {
        let mut glyph = Glyph::with_id(GlyphId::from_raw(format!("composite{g}")), format!("composite{g}"));
        for (s, source) in source_ids.iter().enumerate() {
            let mut layer = GlyphLayer::with_width(LayerId::from_raw(format!("composite{g}_{s}")), source.clone(), 600.0);
            let mut on_base = Component::with_id(ComponentId::from_raw(format!("c{g}_{s}_base")), base_id.clone(), "base", DecomposedTransform::identity());
            on_base.set_alignment(ComponentAlignment::Free);
            layer.add_component(on_base);
            let mut on_top = Component::with_id(
                ComponentId::from_raw(format!("c{g}_{s}_mark")),
                mark_id.clone(),
                "mark",
                DecomposedTransform { translate_x: 275.0, translate_y: 700.0, ..DecomposedTransform::identity() },
            );
            on_top.set_alignment(ComponentAlignment::Anchored);
            layer.add_component(on_top);
            glyph.set_layer(layer);
        }
        font.insert_glyph(glyph).unwrap();
    }
    for g in 0..filler {
        let mut glyph = Glyph::with_id(GlyphId::from_raw(format!("filler{g}")), format!("filler{g}"));
        for (s, source) in source_ids.iter().enumerate() {
            let mut layer = GlyphLayer::with_width(LayerId::from_raw(format!("filler{g}_{s}")), source.clone(), 500.0);
            for c in 0..3 {
                layer.add_contour(square(c as f64 * 150.0, 120.0));
            }
            glyph.set_layer(layer);
        }
        font.insert_glyph(glyph).unwrap();
    }
    font
}

/// A store holding `font`, resumed as a lazy workspace (no payloads resident).
fn lazy_workspace(font: &Font) -> (TempDir, FontWorkspace) {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("synthetic.sqlite");
    {
        let mut store = ShiftStore::open(&path).unwrap();
        store.replace_font_state(font).unwrap();
        store.set_workspace_state(WorkspaceState::untitled(None)).unwrap();
    }
    let workspace = FontWorkspace::resume(&path).unwrap();
    assert_eq!(workspace.loaded_layer_count(), 0, "resume should be lazy");
    (dir, workspace)
}

#[test]
fn anchor_edit_load_set_and_cost_at_scale() {
    for (composites, filler, sources) in [(30, 300, 4), (1_000, 5_000, 2), (5_000, 25_000, 2)] {
        let font = synthetic(composites, filler, sources);
        let (_dir, mut native) = lazy_workspace(&font);
        let mut engine = Engine::open(&native, LoadPolicy::RequiredLoads);
        engine.load(&mut native, [GlyphId::from_raw("base")]);

        let intent = FontIntent::MoveAnchors {
            layer_id: LayerId::from_raw("base_0"),
            anchor_ids: vec![AnchorId::from_raw("base_top_0")],
            coords: vec![320.0, 720.0],
        };
        let started = Instant::now();
        let required = engine.required_loads(std::slice::from_ref(&intent));
        let compute = started.elapsed();

        let load_before = engine.load_time;
        let started = Instant::now();
        let applied = engine.apply(&mut native, std::slice::from_ref(&intent)).unwrap();
        let engine_total = started.elapsed();
        let load = engine.load_time - load_before;

        let started = Instant::now();
        let native_applied = native
            .apply(FontIntentSet { intents: vec![intent.clone()] }, None)
            .unwrap();
        let native_total = started.elapsed();

        assert_eq!(format!("{:?}", applied.changes), format!("{:?}", native_applied.changes));
        let ms = |d: Duration| d.as_secs_f64() * 1000.0;
        eprintln!(
            "SCALE composites={composites} glyphs={} sources={sources}: required_loads={} glyphs (computed in {:.2} ms), \
             load {:.1} ms, engine apply incl. load {:.1} ms, native apply {:.1} ms, realigned layers {}",
            font.glyph_count(),
            required.len(),
            ms(compute),
            ms(load),
            ms(engine_total),
            ms(native_total),
            applied.layers.len() - 1,
        );

        // A second move: everything is resident now, so the edit is engine-speed.
        let again = FontIntent::MoveAnchors {
            layer_id: LayerId::from_raw("base_0"),
            anchor_ids: vec![AnchorId::from_raw("base_top_0")],
            coords: vec![330.0, 730.0],
        };
        let started = Instant::now();
        engine.apply(&mut native, std::slice::from_ref(&again)).unwrap();
        eprintln!("SCALE   second move (all resident): {:.1} ms", ms(started.elapsed()));
    }
}
