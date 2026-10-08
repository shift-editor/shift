use shift_font::{
    Axis, ExternalLocation, FontIntent, FontIntentSet, NamedInstance,
    test_support::sample_variable_font,
};
use shift_store::ShiftStore;
use shift_workspace::FontWorkspace;

#[test]
fn axis_and_product_batch_has_one_exact_undo_step_without_loading_geometry() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    let recovery = temp.path().join("recovery.sqlite");
    let before = sample_variable_font();
    drop(ShiftStore::create_document(&path, &before).unwrap());
    let mut workspace = FontWorkspace::open_document(&path, &recovery).unwrap();
    let original = &before.axes()[0];
    let mut axis = Axis::with_id(
        original.id(),
        "WGHT".to_string(),
        "Mass".to_string(),
        original.minimum(),
        original.default(),
        original.maximum(),
    );
    axis.set_labels(original.labels().to_vec());
    let mut location = ExternalLocation::new();
    location.set(original.id(), 700.0);
    let book = NamedInstance::new("Book".to_string(), location, None);
    workspace
        .apply(
            FontIntentSet {
                intents: vec![
                    FontIntent::UpdateAxis { axis },
                    FontIntent::CreateNamedInstance {
                        instance: book.clone(),
                    },
                ],
            },
            None,
        )
        .unwrap();
    let after = workspace.store().load_font_state().unwrap();
    assert_eq!(after.axes()[0].tag(), "WGHT");
    assert_eq!(&after.named_instances()[1], &book);
    assert_eq!(after.sources(), before.sources());
    assert_eq!(
        after.glyphs().collect::<Vec<_>>(),
        before.glyphs().collect::<Vec<_>>()
    );
    assert_eq!(workspace.loaded_layer_count(), 0);
    workspace.undo().unwrap().unwrap();
    assert_eq!(workspace.store().load_font_state().unwrap(), before);
    assert_eq!(workspace.font().axes(), before.axes());
    assert_eq!(workspace.font().named_instances(), before.named_instances());
    assert_eq!(workspace.loaded_layer_count(), 0);
    assert!(workspace.undo().unwrap().is_none());
    workspace.redo().unwrap().unwrap();
    assert_eq!(workspace.store().load_font_state().unwrap(), after);
    assert_eq!(workspace.font().axes(), after.axes());
    assert_eq!(workspace.font().named_instances(), after.named_instances());
    assert_eq!(workspace.loaded_layer_count(), 0);
    assert!(workspace.redo().unwrap().is_none());
    workspace.save().unwrap();
    drop(workspace);
    let reopened = FontWorkspace::open_document(&path, &recovery).unwrap();
    assert_eq!(reopened.store().load_font_state().unwrap(), after);
    assert_eq!(reopened.loaded_layer_count(), 0);
}

#[test]
fn invalid_origin_edit_rolls_back_earlier_metadata_and_preserves_ledger_and_store() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    let mut before = sample_variable_font();
    before.set_axis_mappings(Vec::new()).unwrap();
    drop(ShiftStore::create_document(&path, &before).unwrap());
    let mut workspace =
        FontWorkspace::open_document(&path, temp.path().join("recovery.sqlite")).unwrap();
    let live_before = workspace.font().clone();
    let original = &before.axes()[0];
    let axis = Axis::with_id(
        original.id(),
        "wght".to_string(),
        "Weight".to_string(),
        original.minimum(),
        500.0,
        original.maximum(),
    );
    let mut metadata = before.metadata().clone();
    metadata.family_name = Some("Must Not Persist".to_string());
    let result = workspace.apply(
        FontIntentSet {
            intents: vec![
                FontIntent::UpdateFontMetadata { metadata },
                FontIntent::UpdateAxis { axis },
            ],
        },
        None,
    );
    assert!(result.is_err());
    assert_eq!(workspace.font(), &live_before);
    assert_eq!(workspace.store().load_font_state().unwrap(), before);
    assert_eq!(workspace.loaded_layer_count(), 0);
    assert!(!workspace.is_dirty().unwrap());
    assert!(workspace.undo().unwrap().is_none());
    assert!(workspace.redo().unwrap().is_none());
}

#[test]
fn explicit_origin_relocation_batch_restores_the_complete_pair_on_undo_and_redo() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    let mut before = shift_font::Font::new();
    let original = Axis::weight();
    before.add_axis(original.clone()).unwrap();
    drop(ShiftStore::create_document(&path, &before).unwrap());
    let mut workspace =
        FontWorkspace::open_document(&path, temp.path().join("recovery.sqlite")).unwrap();
    let source = before.default_source().unwrap();
    let mut location = source.location().clone();
    location.set(original.id(), 500.0);
    let axis = Axis::with_id(
        original.id(),
        "wght".to_string(),
        "Weight".to_string(),
        100.0,
        500.0,
        900.0,
    );
    workspace
        .apply(
            FontIntentSet {
                intents: vec![
                    FontIntent::UpdateSource {
                        source_id: source.id(),
                        name: source.name().to_string(),
                        location,
                        metric_values: source.metric_values().clone(),
                        italic_angle: source.italic_angle(),
                        line_gap: source.line_gap(),
                        underline_position: source.underline_position(),
                        underline_thickness: source.underline_thickness(),
                    },
                    FontIntent::UpdateAxis { axis },
                ],
            },
            None,
        )
        .unwrap();
    let after = workspace.store().load_font_state().unwrap();
    assert_eq!(after.axes()[0].default(), 500.0);
    assert_eq!(
        after
            .default_source()
            .unwrap()
            .location()
            .get(&original.id()),
        Some(500.0)
    );
    workspace.undo().unwrap().unwrap();
    assert_eq!(workspace.store().load_font_state().unwrap(), before);
    workspace.redo().unwrap().unwrap();
    assert_eq!(workspace.store().load_font_state().unwrap(), after);
}
