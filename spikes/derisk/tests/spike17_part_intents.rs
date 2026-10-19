//! Spike 17: building and editing parts only through intents, the real editing
//! path with undo, and the validation rules for glyph-local axes.
//!
//! `cargo test --release --test spike17_part_intents -- --nocapture`

use std::collections::BTreeMap;

use shift_font::{
    AxisId, AxisInheritance, Component, ComponentLocation, Contour, DecomposedTransform, DesignLocation, FontChange, FontChangeSet, FontIntent, FontIntentSet, Glyph, GlyphAxis, GlyphId, GlyphLayer,
    LayerId, LayerLocation, PointType, Replacement,
};
use shift_workspace::FontWorkspace;

const MUTATOR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/fonts/mutatorsans-variable/MutatorSans.designspace");

fn stroke() -> AxisId {
    AxisId::from_raw("stroke")
}

fn axis(tag: &str) -> GlyphAxis {
    GlyphAxis { id: stroke(), tag: tag.into(), name: "Stroke".into(), minimum: 0.0, default: 0.0, maximum: 100.0 }
}

fn apply(workspace: &mut FontWorkspace, intents: Vec<FontIntent>) -> Result<(), String> {
    let set = FontIntentSet { intents, ..Default::default() };
    workspace.apply(set, None).map(|_| ()).map_err(|e| e.to_string())
}

fn width(workspace: &FontWorkspace, glyph: &str, at: &DesignLocation) -> f64 {
    let xs: Vec<f64> = workspace.font().resolve_glyph(&GlyphId::from_raw(glyph), at).unwrap().points().iter().map(|p| p.0).collect();
    xs.iter().cloned().fold(f64::MIN, f64::max) - xs.iter().cloned().fold(f64::MAX, f64::min)
}

#[test]
fn parts_through_intents_with_validation() {
    let store = tempfile::tempdir().unwrap();
    let mut workspace = FontWorkspace::open(MUTATOR, store.path().join("store.sqlite")).unwrap();
    workspace.acquire_all_layers().unwrap();
    let font = workspace.font().clone();
    let default = font.default_source_id().unwrap();
    let wght = font.axes().iter().find(|a| a.tag() == "wght").unwrap().id();

    // A plain stem glyph and a composite using it, as existing documents have.
    let mut stem = Glyph::with_id(GlyphId::from_raw("part_stem"), "part.stem");
    let mut thin = GlyphLayer::with_width(LayerId::from_raw("stem_thin"), default.clone(), 200.0);
    let mut contour = Contour::new();
    for (x, y) in [(0.0, 0.0), (40.0, 0.0), (40.0, 700.0), (0.0, 700.0)] {
        contour.add_point(x, y, PointType::OnCurve, false);
    }
    contour.close();
    thin.add_contour(contour);
    stem.set_layer(thin);
    let mut composite = Glyph::with_id(GlyphId::from_raw("H_part"), "H_part");
    for source in font.masters() {
        let mut layer = GlyphLayer::with_width(LayerId::from_raw(format!("H_{}", source.id())), source.id(), 600.0);
        layer.add_component(Component::with_id(
            shift_font::ComponentId::from_raw(format!("H_c_{}", source.id())),
            GlyphId::from_raw("part_stem"),
            "part.stem",
            DecomposedTransform::from_values([100.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0]),
        ));
        composite.set_layer(layer);
    }
    let insert = |g: Glyph| FontChange::Glyph(Box::new(Replacement { before: None, after: Some(g) }));
    workspace.persist_change_set(FontChangeSet::new(vec![insert(stem), insert(composite)]), true).unwrap();

    // 1. Turn the stem into a part: an axis, a glyph-local source, its shape.
    apply(&mut workspace, vec![FontIntent::SetGlyphAxes { glyph_id: GlyphId::from_raw("part_stem"), axes: vec![axis("STRK")] }]).unwrap();
    apply(
        &mut workspace,
        vec![FontIntent::CreateGlyphSource {
            layer_id: LayerId::from_raw("stem_thick"),
            glyph_id: GlyphId::from_raw("part_stem"),
            source_id: default.clone(),
            from_layer_id: LayerId::from_raw("stem_thin"),
            location: LayerLocation(BTreeMap::from([(stroke(), 100.0)])),
        }],
    )
    .unwrap();
    let thick = workspace.font().layer(&LayerId::from_raw("stem_thick")).unwrap().clone();
    let right: Vec<_> = thick.contours_iter().next().unwrap().points().iter().filter(|p| p.x() > 0.0).map(|p| (p.id(), p.y())).collect();
    apply(
        &mut workspace,
        vec![FontIntent::MovePoints {
            layer_id: LayerId::from_raw("stem_thick"),
            point_ids: right.iter().map(|(id, _)| id.clone()).collect(),
            coords: right.iter().flat_map(|(_, y)| [120.0, *y]).collect(),
        }],
    )
    .unwrap();

    // 2. Each composite layer samples the part at its weight.
    let locations: Vec<FontIntent> = font
        .masters()
        .map(|source| {
            let t = source.location().get(&wght).unwrap_or(0.0) / 1000.0;
            FontIntent::SetComponentLocations {
                layer_id: LayerId::from_raw(format!("H_{}", source.id())),
                component_ids: vec![shift_font::ComponentId::from_raw(format!("H_c_{}", source.id()))],
                locations: vec![ComponentLocation(BTreeMap::from([(stroke(), 100.0 * t)]))],
            }
        })
        .collect();
    apply(&mut workspace, locations).unwrap();
    let mut mid = DesignLocation::new();
    mid.set(wght.clone(), 500.0);
    eprintln!("built through intents: H_part stem at weight 500 is {:.2} (expected 80)", width(&workspace, "H_part", &mid));
    assert!((width(&workspace, "H_part", &mid) - 80.0).abs() < 1e-6);

    // 3. Undo the locations: the stem stops following weight.
    workspace.undo().unwrap();
    eprintln!("after undo: {:.2} (expected 40)", width(&workspace, "H_part", &mid));
    assert!((width(&workspace, "H_part", &mid) - 40.0).abs() < 1e-6);
    workspace.redo().unwrap();
    assert!((width(&workspace, "H_part", &mid) - 80.0).abs() < 1e-6);

    // 4. Validation.
    let first_layer = LayerId::from_raw(format!("H_{}", default));
    let first_component = shift_font::ComponentId::from_raw(format!("H_c_{}", default));
    let cases: Vec<(&str, Vec<FontIntent>)> = vec![
        ("a glyph axis reusing a font axis tag", vec![FontIntent::SetGlyphAxes { glyph_id: GlyphId::from_raw("H_part"), axes: vec![GlyphAxis { id: AxisId::from_raw("other"), ..axis("wght") }] }]),
        ("a glyph axis reusing a font axis id", vec![FontIntent::SetGlyphAxes { glyph_id: GlyphId::from_raw("H_part"), axes: vec![GlyphAxis { id: wght.clone(), ..axis("ZZZZ") }] }]),
        ("a component location out of range", vec![FontIntent::SetComponentLocations { layer_id: first_layer.clone(), component_ids: vec![first_component.clone()], locations: vec![ComponentLocation(BTreeMap::from([(stroke(), 150.0)]))] }]),
        ("a component location naming an unknown axis", vec![FontIntent::SetComponentLocations { layer_id: first_layer.clone(), component_ids: vec![first_component.clone()], locations: vec![ComponentLocation(BTreeMap::from([(AxisId::from_raw("nope"), 1.0)]))] }]),
        ("removing an axis composites still use", vec![FontIntent::SetGlyphAxes { glyph_id: GlyphId::from_raw("part_stem"), axes: vec![] }]),
        ("moving a source onto another's location (stroke 0 = the plain layer)", vec![FontIntent::SetLayerLocation { layer_id: LayerId::from_raw("stem_thick"), location: LayerLocation(BTreeMap::from([(stroke(), 0.0)])) }]),
        ("a layer location out of range", vec![FontIntent::SetLayerLocation { layer_id: LayerId::from_raw("stem_thick"), location: LayerLocation(BTreeMap::from([(stroke(), 101.0)])) }]),
    ];
    let before = workspace.font().clone();
    for (name, intents) in cases {
        let outcome = apply(&mut workspace, intents);
        eprintln!("rejects {name}: {}", outcome.as_ref().err().map(String::as_str).unwrap_or("ACCEPTED"));
        assert!(outcome.is_err(), "{name} was accepted");
        assert_eq!(workspace.font().glyph(&GlyphId::from_raw("part_stem")), before.glyph(&GlyphId::from_raw("part_stem")));
    }

    // The composite check on its own: the part drops its axis and its located
    // layer together, but composites still name the axis.
    let part = workspace.font().glyph(&GlyphId::from_raw("part_stem")).unwrap().clone();
    let mut plain = part.clone();
    plain.set_axes(Vec::new());
    plain.remove_layer(LayerId::from_raw("stem_thick"));
    let outcome = workspace.font().clone().apply_change_set(&FontChangeSet::new(vec![FontChange::Glyph(Box::new(Replacement { before: Some(part), after: Some(plain) }))]));
    eprintln!("rejects un-parting a glyph composites still sample: {}", outcome.as_ref().err().map(|e| e.to_string()).unwrap_or("ACCEPTED".into()));
    assert!(outcome.is_err());

    // 5. And a valid edit still goes through: inheritance, and a new stroke value.
    apply(&mut workspace, vec![FontIntent::SetComponentInheritance { layer_id: first_layer, component_ids: vec![first_component], inheritance: AxisInheritance::Font }]).unwrap();
    apply(&mut workspace, vec![FontIntent::SetLayerLocation { layer_id: LayerId::from_raw("stem_thick"), location: LayerLocation(BTreeMap::from([(stroke(), 80.0)])) }]).unwrap();
    eprintln!("valid edits after rejections: ok");
}
