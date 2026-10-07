use shift_font::{
    Anchor, Component, Contour, FontIntent, FontIntentSet, GlyphId, LayerId, PointType,
    test_support::sample_font,
};
use shift_store::ShiftStore;
use shift_workspace::FontWorkspace;

#[test]
fn drawing_and_identity_batch_is_one_exact_undo_step_in_native_recovery() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    let recovery = temp.path().join("recovery.sqlite");
    let mut before = sample_font();
    let source_id = before.default_source_id().unwrap();
    let glyph_id = before.glyph_id_by_name("A").unwrap();
    let layer_id = before
        .layer_id_for_glyph_source(glyph_id.clone(), source_id.clone())
        .unwrap();
    before
        .layer_mut(&layer_id)
        .unwrap()
        .add_contour(Contour::new());
    drop(ShiftStore::create_document(&path, &before).unwrap());
    let mut workspace = FontWorkspace::open_document(&path, &recovery).unwrap();
    assert_eq!(workspace.loaded_layer_count(), 0);
    let mut contour = Contour::new();
    contour.add_point(30.0, 80.0, PointType::OnCurve, false);
    let new_glyph_id = GlyphId::new();
    let new_layer_id = LayerId::new();

    workspace
        .apply(
            FontIntentSet {
                intents: vec![
                    FontIntent::ReplaceGlyphLayerContent {
                        layer_id: layer_id.clone(),
                        width: 720.0,
                        contours: vec![contour.clone()],
                        anchors: vec![Anchor::new(Some("top".to_string()), 20.0, 90.0)],
                        components: Vec::new(),
                    },
                    FontIntent::UpdateGlyph {
                        glyph_id: glyph_id.clone(),
                        new_name: "A".into(),
                        new_unicodes: vec![0x41],
                    },
                    FontIntent::CreateGlyph {
                        glyph_id: Some(new_glyph_id.clone()),
                        name: "B".to_string(),
                        unicodes: vec![0x42],
                    },
                    FontIntent::CreateGlyphLayer {
                        layer_id: new_layer_id.clone(),
                        glyph_id: new_glyph_id,
                        source_id,
                    },
                    FontIntent::ReplaceGlyphLayerContent {
                        layer_id: new_layer_id.clone(),
                        width: 620.0,
                        contours: Vec::new(),
                        anchors: Vec::new(),
                        components: Vec::new(),
                    },
                ],
            },
            None,
        )
        .unwrap();

    assert_eq!(workspace.loaded_layer_count(), 2);
    let after = workspace.store().load_font_state().unwrap();
    let layer = after.layer(&layer_id).unwrap();
    let original = before.layer(&layer_id).unwrap();
    assert_eq!(layer.contours_iter().next().unwrap(), &contour);
    assert_eq!(layer.width(), 720.0);
    assert_eq!(layer.height(), original.height());
    assert_eq!(layer.guidelines(), original.guidelines());
    assert_eq!(layer.lib(), original.lib());
    assert_eq!(layer.anchors()[0].y(), 90.0);
    assert!(layer.components().is_empty());
    assert_eq!(after.glyph_by_name("A").unwrap().unicodes(), &[0x41]);
    assert_eq!(after.layer(&new_layer_id).unwrap().width(), 620.0);
    assert!(
        workspace
            .store()
            .referenced_glyph_ids_for_glyph(&glyph_id)
            .unwrap()
            .is_empty()
    );

    workspace.undo().unwrap().unwrap();
    assert_eq!(workspace.store().load_font_state().unwrap(), before);
    assert!(workspace.undo().unwrap().is_none());
    assert_eq!(
        workspace
            .store()
            .referenced_glyph_ids_for_glyph(&glyph_id)
            .unwrap()
            .len(),
        1
    );
    workspace.redo().unwrap().unwrap();
    assert_eq!(workspace.store().load_font_state().unwrap(), after);
    assert!(workspace.redo().unwrap().is_none());
    assert!(
        workspace
            .store()
            .referenced_glyph_ids_for_glyph(&glyph_id)
            .unwrap()
            .is_empty()
    );
    workspace.save().unwrap();
    drop(workspace);
    let mut reopened = FontWorkspace::open_document(&path, &recovery).unwrap();
    assert_eq!(reopened.store().load_font_state().unwrap(), after);
    reopened
        .acquire_glyphs(&[glyph_id], shift_workspace::AcquireScope::Glyphs)
        .unwrap();
    assert_eq!(
        reopened.font().layer(&layer_id).unwrap(),
        after.layer(&original.id()).unwrap()
    );
}

#[test]
fn invalid_second_replacement_leaves_live_durable_and_history_truth_unchanged() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    let before = sample_font();
    drop(ShiftStore::create_document(&path, &before).unwrap());
    let bytes = std::fs::read(&path).unwrap();
    let mut workspace =
        FontWorkspace::open_document(&path, temp.path().join("recovery.sqlite")).unwrap();
    let layer_id = before
        .glyph_by_name("A")
        .unwrap()
        .layer_for_source(before.default_source_id().unwrap())
        .unwrap()
        .id();
    let result = workspace.apply(
        FontIntentSet {
            intents: vec![
                FontIntent::ReplaceGlyphLayerContent {
                    layer_id: layer_id.clone(),
                    width: 720.0,
                    contours: Vec::new(),
                    anchors: Vec::new(),
                    components: Vec::new(),
                },
                FontIntent::ReplaceGlyphLayerContent {
                    layer_id: layer_id.clone(),
                    width: f64::INFINITY,
                    contours: Vec::new(),
                    anchors: Vec::new(),
                    components: Vec::new(),
                },
            ],
        },
        None,
    );
    assert!(result.is_err());
    assert_eq!(workspace.font().layer(&layer_id), before.layer(&layer_id));
    assert_eq!(workspace.store().load_font_state().unwrap(), before);
    assert_eq!(std::fs::read(path).unwrap(), bytes);
    assert!(!workspace.is_dirty().unwrap());
    assert!(workspace.undo().unwrap().is_none());
}

#[test]
fn component_replacement_acquires_the_dependency_closure_before_cycle_validation() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    let before = sample_font();
    drop(ShiftStore::create_document(&path, &before).unwrap());
    let mut workspace =
        FontWorkspace::open_document(&path, temp.path().join("recovery.sqlite")).unwrap();
    let glyph_id = before.glyph_id_by_name("A").unwrap();
    let layer_id = before
        .glyph_by_name("acute")
        .unwrap()
        .layer_for_source(before.default_source_id().unwrap())
        .unwrap()
        .id();
    assert!(
        workspace
            .apply(
                FontIntentSet {
                    intents: vec![FontIntent::ReplaceGlyphLayerContent {
                        layer_id,
                        width: 200.0,
                        contours: Vec::new(),
                        anchors: Vec::new(),
                        components: vec![Component::new(glyph_id, "A")],
                    }],
                },
                None
            )
            .is_err()
    );
    assert_eq!(workspace.store().load_font_state().unwrap(), before);
    assert!(workspace.undo().unwrap().is_none());
}
