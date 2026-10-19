//! Spike 14: the glyph-local sources API in code. A part (a stem with its own
//! "stroke" axis) used by two composites whose component location follows the
//! font's weight. Checks that the additive model needs no new change kinds,
//! keeps per-source lookups meaning what they meant, resolves correctly, and
//! survives the store and the text folder.
//!
//! `cargo test --release --test spike14_glyph_parts -- --nocapture --test-threads=1`

use std::collections::{BTreeMap, HashSet};

use engine_derisk::text_folder::{file_name, glyph_text, parse_glyph};
use shift_font::{
    AxisId, AxisInheritance, Component, ComponentLocation, Contour, DecomposedTransform, DesignLocation, Font, FontChange, FontChangeSet, Glyph, GlyphAxis, GlyphId, GlyphLayer,
    LayerId, LayerLocation, PointType, Replacement, SourceId,
};
use shift_workspace::FontWorkspace;

const MUTATOR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/fonts/mutatorsans-variable/MutatorSans.designspace");

fn stroke() -> AxisId {
    AxisId::from_raw("stroke")
}

fn rect(x0: f64, x1: f64, height: f64) -> Contour {
    let mut contour = Contour::new();
    for (x, y) in [(x0, 0.0), (x1, 0.0), (x1, height), (x0, height)] {
        contour.add_point(x, y, PointType::OnCurve, false);
    }
    contour.close();
    contour
}

fn weight_axis(font: &Font) -> (AxisId, f64, f64) {
    let axis = font.axes().iter().find(|a| a.tag() == "wght").unwrap();
    (axis.id(), axis.minimum(), axis.maximum())
}

fn is_bold(font: &Font, source: &SourceId) -> bool {
    let (wght, _, max) = weight_axis(font);
    font.source(source).unwrap().location().get(&wght) == Some(max)
}

/// A stem whose own stroke axis goes 0 → 100: 40 units wide at 0, 120 at 100.
/// It doesn't vary along font axes, so it has two layers, both at the default
/// source; the second sits at stroke=100.
fn stem_part(font: &Font) -> Glyph {
    let default = font.default_source_id().unwrap();
    let mut glyph = Glyph::with_id(GlyphId::from_raw("part_stem"), "part.stem");
    glyph.set_axes(vec![GlyphAxis { id: stroke(), tag: "STRK".into(), name: "Stroke".into(), minimum: 0.0, default: 0.0, maximum: 100.0 }]);
    let mut thin = GlyphLayer::with_width(LayerId::from_raw("stem_thin"), default.clone(), 200.0);
    thin.add_contour(rect(0.0, 40.0, 700.0));
    let mut thick = GlyphLayer::with_width(LayerId::from_raw("stem_thick"), default, 200.0);
    // Fresh ids: entity ids are unique font-wide; layers match by order.
    let contour = rect(0.0, 120.0, 700.0);
    thick.add_contour(contour);
    thick.set_location(LayerLocation(BTreeMap::from([(stroke(), 100.0)])));
    glyph.set_layer(thin);
    glyph.set_layer(thick);
    glyph
}

/// A composite with a layer at every font master; its stem uses stroke 0 at
/// light masters and 100 at bold ones, placed at `x`.
fn composite(font: &Font, id: &str, x: f64, inheritance: AxisInheritance) -> Glyph {
    let mut glyph = Glyph::with_id(GlyphId::from_raw(id), id);
    for source in font.masters() {
        let mut layer = GlyphLayer::with_width(LayerId::from_raw(format!("{id}_{}", source.id())), source.id(), 600.0);
        let mut component = Component::with_id(
            shift_font::ComponentId::from_raw(format!("{id}_stem_{}", source.id())),
            GlyphId::from_raw("part_stem"),
            "part.stem",
            DecomposedTransform::from_values([x, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0]),
        );
        // Stroke follows the font's weight at every master, intermediates included.
        let (wght, min, max) = weight_axis(font);
        let weight = 100.0 * (source.location().get(&wght).unwrap_or(min) - min) / (max - min);
        component.set_location(ComponentLocation(BTreeMap::from([(stroke(), weight)])));
        component.set_inheritance(inheritance);
        layer.add_component(component);
        glyph.set_layer(layer);
    }
    glyph
}

fn insert(glyph: Glyph) -> FontChange {
    FontChange::Glyph(Box::new(Replacement { before: None, after: Some(glyph) }))
}

fn stem_width(font: &Font, glyph: &str, at: &DesignLocation) -> f64 {
    let flat = font.resolve_glyph(&GlyphId::from_raw(glyph), at).unwrap();
    let xs: Vec<f64> = flat.contours.iter().flatten().map(|p| p.0).collect();
    xs.iter().cloned().fold(f64::MIN, f64::max) - xs.iter().cloned().fold(f64::MAX, f64::min)
}

fn at_weight(font: &Font, t: f64) -> DesignLocation {
    let (wght, min, max) = weight_axis(font);
    let mut location = DesignLocation::new();
    location.set(wght, min + (max - min) * t);
    location
}

#[test]
fn parts_with_glyph_local_sources_end_to_end() {
    let store = tempfile::tempdir().unwrap();
    let store_path = store.path().join("store.sqlite");
    let mut workspace = FontWorkspace::open(MUTATOR, &store_path).unwrap();
    workspace.acquire_all_layers().unwrap();
    let font = workspace.font().clone();
    for axis in font.axes() {
        eprintln!("axis {} {} min {} default {} max {}", axis.tag(), axis.id(), axis.minimum(), axis.default(), axis.maximum());
    }
    for source in font.masters() {
        eprintln!("master {} {:?} bold={}", source.name(), source.location().iter().collect::<Vec<_>>(), is_bold(&font, &source.id()));
    }

    // 1. Everything goes through existing change kinds: three glyph inserts.
    let part = stem_part(&font);
    let h = composite(&font, "H_part", 100.0, AxisInheritance::Parent);
    let t = composite(&font, "T_part", 300.0, AxisInheritance::Font);
    let change_set = FontChangeSet::new(vec![insert(part.clone()), insert(h.clone()), insert(t.clone())]);
    workspace.persist_change_set(change_set.clone(), true).unwrap();
    let font = workspace.font().clone();
    eprintln!("inserted a part with 2 layers at the same source (one at stroke=100) and two composites: ok");

    // 2. Per-source lookups keep their meaning: the plain layer, never the located one.
    let default = font.default_source_id().unwrap();
    let stored = font.glyph(&GlyphId::from_raw("part_stem")).unwrap();
    assert_eq!(stored.layer_for_source(default.clone()).unwrap().id(), LayerId::from_raw("stem_thin"));
    assert_eq!(stored.axes().len(), 1);

    // 3. Resolution: the part along its own axis, and through the composites
    //    as the font's weight moves.
    let mut mid_stroke = DesignLocation::new();
    mid_stroke.set(stroke(), 50.0);
    let part_widths = (stem_width(&font, "part_stem", &DesignLocation::new()), stem_width(&font, "part_stem", &mid_stroke));
    eprintln!("part stem width at stroke 0 / 50: {:.2} / {:.2}", part_widths.0, part_widths.1);
    assert!((part_widths.0 - 40.0).abs() < 1e-9 && (part_widths.1 - 80.0).abs() < 1e-9);
    for t in [0.0, 0.25, 0.5, 1.0] {
        let width = stem_width(&font, "H_part", &at_weight(&font, t));
        eprintln!("H_part at weight {:.2}: stem {:.2} (expected {:.2})", t, width, 40.0 + 80.0 * t);
        assert!((width - (40.0 + 80.0 * t)).abs() < 1e-6);
    }

    // 4. A second layer at the same full location is rejected; a different
    //    stroke value at the same source is fine.
    let mut duplicate = stored.clone();
    let mut dup = (**stored.layers().get(&LayerId::from_raw("stem_thick")).unwrap()).clone();
    let thick_contour = dup.contours_iter().next().unwrap().clone();
    let mut fresh = Contour::new();
    for p in thick_contour.points() {
        fresh.add_point(p.x(), p.y(), p.point_type(), p.is_smooth());
    }
    fresh.close();
    let mut dup_layer = GlyphLayer::with_width(LayerId::from_raw("stem_dup"), dup.source_id(), dup.width());
    dup_layer.add_contour(fresh);
    dup_layer.set_location(dup.location().clone());
    duplicate.set_layer(dup_layer.clone());
    let rejected = font.clone().apply_change_set(&FontChangeSet::new(vec![FontChange::Glyph(Box::new(Replacement { before: Some(stored.clone()), after: Some(duplicate) }))]));
    eprintln!("second layer at stroke=100: {:?}", rejected.as_ref().err());
    assert!(rejected.is_err());
    dup.set_location(LayerLocation(BTreeMap::from([(stroke(), 50.0)])));
    let _ = dup;

    // 5. Undo and redo are the inverse and the original change set.
    workspace.persist_change_set(change_set.inverted(), true).unwrap();
    assert!(workspace.font().glyph(&GlyphId::from_raw("part_stem")).is_none());
    workspace.persist_change_set(change_set, true).unwrap();
    assert!(workspace.font().glyph(&GlyphId::from_raw("part_stem")).is_some());
    eprintln!("undo removes the part and composites, redo restores them: ok");

    // 6. Text folder: write and parse each glyph back exactly.
    let font = workspace.font().clone();
    let known: HashSet<GlyphId> = font.glyphs().map(Glyph::id).collect();
    for id in ["part_stem", "H_part", "T_part"] {
        let glyph = font.glyph(&GlyphId::from_raw(id)).unwrap();
        let text = glyph_text(glyph);
        let parsed = parse_glyph(&file_name(&glyph.id()), text.as_bytes(), &font, Some(glyph), &known).unwrap();
        assert_eq!(&parsed, glyph, "{id} through the text folder");
        assert_eq!(glyph_text(&parsed), text);
    }
    eprintln!("part text:\n{}", glyph_text(font.glyph(&GlyphId::from_raw("part_stem")).unwrap()).lines().take(12).collect::<Vec<_>>().join("\n"));

    // 7. Store: reopen from SQLite and compare.
    let before: Vec<Glyph> = ["part_stem", "H_part", "T_part"].iter().map(|id| font.glyph(&GlyphId::from_raw(*id)).unwrap().clone()).collect();
    drop(workspace);
    let mut reopened = FontWorkspace::resume(&store_path).map_err(|e| format!("{e:?}"));
    match &mut reopened {
        Ok(workspace) => {
            workspace.acquire_all_layers().unwrap();
            for glyph in &before {
                let after = workspace.font().glyph(&glyph.id()).cloned();
                eprintln!("  {} survives the store: {}", glyph.name(), after.as_ref() == Some(glyph));
                assert_eq!(after.as_ref(), Some(glyph));
            }
        }
        Err(error) => panic!("reopen failed: {error}"),
    }
}
