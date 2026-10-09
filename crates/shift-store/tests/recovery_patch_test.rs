use std::sync::Arc;

use shift_font::test_support::sample_font;
use shift_store::ShiftStore;

fn source_collection(font: &shift_font::Font) -> shift_font::SourceCollection {
    shift_font::SourceCollection {
        sources: font.sources().to_vec(),
        default_source_id: font.default_source_id(),
    }
}

fn glyph_created(glyph: &shift_font::Glyph) -> shift_font::FontChange {
    shift_font::FontChange::Glyph(shift_font::Replacement::new(None, Some(glyph.clone())))
}

fn glyph_deleted(glyph: &shift_font::Glyph) -> shift_font::FontChange {
    shift_font::FontChange::Glyph(shift_font::Replacement::new(Some(glyph.clone()), None))
}

fn layer_deleted(
    glyph_id: shift_font::GlyphId,
    layer: &shift_font::GlyphLayer,
) -> shift_font::FontChange {
    shift_font::FontChange::Layer {
        glyph_id,
        layer: shift_font::Replacement::new(Some(Arc::new(layer.clone())), None),
        structural: true,
    }
}

#[test]
fn recovery_preserves_store_only_font_and_source_fields() {
    let temp = tempfile::tempdir().expect("temp dir");
    let working_path = temp.path().join("working.sqlite");
    let document_path = temp.path().join("Dogfood.shift");
    let recovery_path = temp.path().join("recovery.sqlite");
    let original = sample_font();
    let mut working = ShiftStore::open(&working_path).expect("open working store");
    working
        .replace_font_state(&original)
        .expect("write original font");
    let mut info = working.get_font_info().unwrap().unwrap();
    info.sample_text = Some("Store sample".to_string());
    info.vendor_id = Some("SHFT".to_string());
    working
        .set_font_info(info)
        .expect("write store-only sentinels");
    drop(working);
    let conn = rusqlite::Connection::open(&working_path).expect("open raw working store");
    conn.execute(
        "UPDATE sources SET family_name = 'Source Family', style_name = 'Source Style' WHERE id = 'source_regular'",
        [],
    )
    .expect("write source-only sentinels");
    drop(conn);
    let working = ShiftStore::open(&working_path).expect("reopen working store");
    working
        .save_as_document(&document_path)
        .expect("publish canonical document");
    drop(working);

    let mut post = original.clone();
    post.metadata_mut().family_name = Some("Recovered Sans".to_string());
    let source_id = shift_font::SourceId::from_raw("regular");
    post.source_mut(source_id.clone())
        .expect("regular source")
        .set_line_gap(Some(99.0));
    let change = shift_font::FontChangeSet::new(vec![
        shift_font::FontChange::Metadata(Box::new(shift_font::Replacement::new(
            original.metadata().clone(),
            post.metadata().clone(),
        ))),
        shift_font::FontChange::Sources(shift_font::Replacement::new(
            source_collection(&original),
            source_collection(&post),
        )),
    ]);
    let mut document = ShiftStore::open_document_with_recovery(&document_path, &recovery_path)
        .expect("open with recovery");
    document
        .apply_change_set_with_font(&change, &post, true)
        .unwrap();
    let merged_source = document
        .get_source(&shift_store::SourceId::new("source_regular"))
        .unwrap()
        .unwrap();
    assert_eq!(merged_source.family_name.as_deref(), Some("Source Family"));
    assert_eq!(merged_source.style_name.as_deref(), Some("Source Style"));
    document.save_document().unwrap();
    drop(document);

    let saved = ShiftStore::open_document(&document_path).expect("open saved document");
    let info = saved.get_font_info().unwrap().unwrap();
    assert_eq!(info.family_name.as_deref(), Some("Recovered Sans"));
    assert_eq!(info.sample_text.as_deref(), Some("Store sample"));
    assert_eq!(info.vendor_id.as_deref(), Some("SHFT"));
    let source = saved
        .get_source(&shift_store::SourceId::new("source_regular"))
        .unwrap()
        .unwrap();
    assert_eq!(source.family_name.as_deref(), Some("Source Family"));
    assert_eq!(source.style_name.as_deref(), Some("Source Style"));
}

#[test]
fn recovery_overlay_reopens_and_saves_semantic_directory_changes() {
    let temp = tempfile::tempdir().expect("temp dir");
    let document_path = temp.path().join("Dogfood.shift");
    let recovery_path = temp.path().join("Dogfood.recovery.sqlite");
    let original = sample_font();
    drop(ShiftStore::create_document(&document_path, &original).expect("create document"));

    let mut post = original.clone();
    post.metadata_mut().family_name = Some("Recovered Sans".to_string());
    let weight_id = shift_font::AxisId::from_raw("weight");
    let mut weight = post
        .axes()
        .iter()
        .find(|axis| axis.id() == weight_id)
        .expect("weight axis")
        .clone();
    weight.set_hidden(false);
    post.replace_axis(weight.clone())
        .expect("replace weight axis");
    let regular_source_id = shift_font::SourceId::from_raw("regular");
    post.source_mut(regular_source_id.clone())
        .expect("regular source")
        .set_line_gap(Some(99.0));
    post.set_axis_mappings(Vec::new()).expect("clear mappings");
    post.set_named_instances(Vec::new())
        .expect("clear instances");
    let mut metric_definitions = post.metric_definitions().to_vec();
    metric_definitions[0].set_name("Recovered Ascender".to_string());
    post.set_metric_definitions(metric_definitions.clone())
        .expect("replace metric definitions");
    let changes = shift_font::FontChangeSet::new(vec![
        shift_font::FontChange::Metadata(Box::new(shift_font::Replacement::new(
            original.metadata().clone(),
            post.metadata().clone(),
        ))),
        shift_font::FontChange::Axes(shift_font::Replacement::new(
            original.axes().to_vec(),
            post.axes().to_vec(),
        )),
        shift_font::FontChange::AxisMappings(shift_font::Replacement::new(
            original.axis_mappings().to_vec(),
            post.axis_mappings().to_vec(),
        )),
        shift_font::FontChange::NamedInstances(shift_font::Replacement::new(
            original.named_instances().to_vec(),
            post.named_instances().to_vec(),
        )),
        shift_font::FontChange::MetricDefinitions(shift_font::Replacement::new(
            original.metric_definitions().to_vec(),
            metric_definitions,
        )),
        shift_font::FontChange::Sources(shift_font::Replacement::new(
            source_collection(&original),
            source_collection(&post),
        )),
    ]);

    let mut document = ShiftStore::open_document_with_recovery(&document_path, &recovery_path)
        .expect("open with recovery");
    document
        .apply_change_set_with_font(&changes, &post, true)
        .expect("write semantic recovery changes");
    drop(document);

    let canonical = ShiftStore::open_document(&document_path).expect("open canonical");
    assert_eq!(canonical.load_font_state().unwrap(), original);
    drop(canonical);

    let mut reopened = ShiftStore::open_document_with_recovery(&document_path, &recovery_path)
        .expect("reopen recovered document");
    assert_eq!(reopened.load_font_state().unwrap(), post);
    reopened.save_document().expect("save recovered document");
    drop(reopened);

    let saved = ShiftStore::open_document(&document_path).expect("open saved document");
    assert_eq!(saved.load_font_state().unwrap(), post);
}

#[test]
fn metric_definition_replacement_preserves_untouched_source_values() {
    let temp = tempfile::tempdir().expect("temp dir");
    let document_path = temp.path().join("Dogfood.shift");
    let recovery_path = temp.path().join("recovery.sqlite");
    let original = sample_font();
    drop(ShiftStore::create_document(&document_path, &original).expect("create document"));

    let mut post = original.clone();
    let mut definitions = post.metric_definitions().to_vec();
    definitions[0].set_name("Recovered Ascender".to_string());
    post.set_metric_definitions(definitions.clone())
        .expect("replace metric definitions");
    let changes = shift_font::FontChangeSet::from(shift_font::FontChange::MetricDefinitions(
        shift_font::Replacement::new(original.metric_definitions().to_vec(), definitions),
    ));

    let mut document = ShiftStore::open_document_with_recovery(&document_path, &recovery_path)
        .expect("open with recovery");
    document
        .apply_change_set_with_font(&changes, &post, true)
        .expect("write metric recovery change");
    document.save_document().expect("save recovered document");
    drop(document);

    let saved = ShiftStore::open_document(&document_path).expect("open saved document");
    assert_eq!(saved.load_font_state().unwrap(), post);
}

#[test]
fn recovery_persists_collection_reordering_without_entity_updates() {
    let temp = tempfile::tempdir().expect("temp dir");
    let document_path = temp.path().join("Dogfood.shift");
    let recovery_path = temp.path().join("recovery.sqlite");
    let original = sample_font();
    drop(ShiftStore::create_document(&document_path, &original).expect("create document"));

    let mut post = original.clone();
    let axis_order = post
        .axes()
        .iter()
        .rev()
        .map(shift_font::Axis::id)
        .collect::<Vec<_>>();
    post.set_axis_order(&axis_order).expect("reorder axes");
    let source_order = post
        .sources()
        .iter()
        .rev()
        .map(shift_font::Source::id)
        .collect::<Vec<_>>();
    post.set_source_order(&source_order)
        .expect("reorder sources");
    let changes = shift_font::FontChangeSet::new(vec![
        shift_font::FontChange::Axes(shift_font::Replacement::new(
            original.axes().to_vec(),
            post.axes().to_vec(),
        )),
        shift_font::FontChange::Sources(shift_font::Replacement::new(
            source_collection(&original),
            source_collection(&post),
        )),
    ]);
    assert!(changes.entity_changes().is_empty());

    let mut document = ShiftStore::open_document_with_recovery(&document_path, &recovery_path)
        .expect("open with recovery");
    document
        .apply_change_set_with_font(&changes, &post, true)
        .expect("persist reordered collections");
    drop(document);

    let mut reopened = ShiftStore::open_document_with_recovery(&document_path, &recovery_path)
        .expect("reopen recovered document");
    assert_eq!(reopened.load_font_state().unwrap(), post);
    reopened.save_document().expect("save recovered document");
    drop(reopened);

    let saved = ShiftStore::open_document(&document_path).expect("open saved document");
    assert_eq!(saved.load_font_state().unwrap(), post);
}

#[test]
fn recovery_save_replaces_reordered_component_collections() {
    let temp = tempfile::tempdir().expect("temp dir");
    let document_path = temp.path().join("Dogfood.shift");
    let recovery_path = temp.path().join("recovery.sqlite");
    let layer_id = shift_font::LayerId::from_raw("A_regular");
    drop(ShiftStore::create_document(&document_path, &sample_font()).expect("create document"));

    let mut document = ShiftStore::open_document_with_recovery(&document_path, &recovery_path)
        .expect("open with recovery");
    let mut layer = document.load_glyph_layer(&layer_id).unwrap().unwrap();
    let first_id = layer.components_iter().next().unwrap().id();
    let first = layer.remove_component(first_id).unwrap();
    layer.add_component(first);
    let reordered = layer
        .components_iter()
        .map(|component| component.id())
        .collect::<Vec<_>>();
    document.replace_glyph_layer(&layer).unwrap();
    document.save_document().unwrap();
    drop(document);

    let saved = ShiftStore::open_document(&document_path).expect("open saved document");
    let saved_layer = saved.load_glyph_layer(&layer_id).unwrap().unwrap();
    assert_eq!(
        saved_layer
            .components_iter()
            .map(|component| component.id())
            .collect::<Vec<_>>(),
        reordered
    );
}

#[test]
fn recovered_directory_open_remains_payload_lazy() {
    let temp = tempfile::tempdir().expect("temp dir");
    let document_path = temp.path().join("Dogfood.shift");
    let recovery_path = temp.path().join("recovery.sqlite");
    let layer_id = shift_font::LayerId::from_raw("A_regular");
    drop(ShiftStore::create_document(&document_path, &sample_font()).expect("create document"));

    let mut document = ShiftStore::open_document_with_recovery(&document_path, &recovery_path)
        .expect("open with recovery");
    let mut layer = document.load_glyph_layer(&layer_id).unwrap().unwrap();
    layer.set_width(777.0);
    document.replace_glyph_layer(&layer).unwrap();
    drop(document);
    let conn = rusqlite::Connection::open(&recovery_path).expect("open raw recovery");
    conn.execute(
        "UPDATE glyph_layer_payloads SET payload = x'00', stored_byte_length = 1 WHERE layer_id = ?1",
        [layer_id.to_string()],
    )
    .expect("corrupt recovery payload");
    drop(conn);

    let recovered = ShiftStore::open_document_with_recovery(&document_path, &recovery_path)
        .expect("reopen recovered document");
    assert_eq!(
        recovered
            .load_font_directory()
            .expect("load directory")
            .glyph_count(),
        sample_font().glyph_count()
    );
    assert!(recovered.load_glyph_layer(&layer_id).is_err());
}

#[test]
fn recovery_overlay_adds_a_new_glyph_and_layer_without_copying_the_directory() {
    let temp = tempfile::tempdir().expect("temp dir");
    let document_path = temp.path().join("Dogfood.shift");
    let recovery_path = temp.path().join("recovery.sqlite");
    let original = sample_font();
    drop(ShiftStore::create_document(&document_path, &original).expect("create document"));

    let glyph_id = shift_font::GlyphId::from_raw("B");
    let layer_id = shift_font::LayerId::from_raw("B_regular");
    let mut glyph = shift_font::Glyph::with_id(glyph_id.clone(), "B");
    glyph.set_unicodes(vec![0x42]);
    let layer = shift_font::GlyphLayer::with_width(
        layer_id.clone(),
        shift_font::SourceId::from_raw("regular"),
        620.0,
    );
    glyph.set_layer(layer.clone());
    let mut post = original.clone();
    post.insert_glyph(glyph.clone()).expect("insert glyph");
    let changes = shift_font::FontChangeSet::from(glyph_created(&glyph));

    let mut document = ShiftStore::open_document_with_recovery(&document_path, &recovery_path)
        .expect("open with recovery");
    let non_tail = original.glyphs().next().expect("sample glyph");
    let non_tail_id = non_tail.id();
    let tail_id = original.glyphs().last().expect("sample tail glyph").id();
    assert_ne!(non_tail_id, tail_id);
    let mut invalid_post = original.clone();
    invalid_post.pop_glyph(tail_id).expect("pop tail glyph");
    let error = document
        .apply_change_set_with_font(&glyph_deleted(non_tail).into(), &invalid_post, true)
        .unwrap_err();
    assert!(matches!(
        error,
        shift_store::StoreError::Font(shift_font::CoreError::InvalidEntityOrder {
            kind: "glyph",
            ..
        })
    ));

    document
        .apply_change_set_with_font(&changes, &post, true)
        .unwrap();
    let directory = document.load_font_directory().unwrap();
    assert_eq!(directory.glyph_count(), post.glyph_count());
    assert_eq!(
        directory
            .glyph(&glyph_id)
            .expect("new glyph in merged directory")
            .layers()
            .get(&layer_id)
            .expect("new layer in merged directory")
            .width(),
        620.0
    );
    assert_eq!(
        document
            .load_glyph_layer(&layer_id)
            .unwrap()
            .unwrap()
            .width(),
        620.0
    );

    let recovery = rusqlite::Connection::open(&recovery_path).expect("inspect recovery");
    assert_eq!(
        recovery
            .query_row("SELECT COUNT(*) FROM glyphs", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        recovery
            .query_row("SELECT COUNT(*) FROM glyph_layer_payloads", [], |row| row
                .get::<_, i64>(
                0
            ))
            .unwrap(),
        1
    );
    drop(recovery);

    let mut reverted = post.clone();
    reverted.pop_glyph(glyph_id.clone()).expect("pop glyph");
    document
        .apply_change_set_with_font(&glyph_deleted(&glyph).into(), &reverted, true)
        .unwrap();
    assert_eq!(
        document.load_font_directory().unwrap().glyph_count(),
        original.glyph_count()
    );
    let recovery = rusqlite::Connection::open(&recovery_path).expect("inspect reverted recovery");
    assert_eq!(
        recovery
            .query_row("SELECT COUNT(*) FROM glyphs", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(
        recovery
            .query_row(
                "SELECT COUNT(*) FROM recovery_tombstones WHERE entity_kind = 'glyph'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
        1
    );
    drop(recovery);

    document
        .apply_change_set_with_font(&changes, &post, true)
        .unwrap();
    document.save_document().expect("save additions");

    document
        .apply_change_set_with_font(&glyph_deleted(&glyph).into(), &reverted, true)
        .expect("pop the saved tail glyph");
    assert_eq!(document.load_font_state().unwrap(), reverted);
    let recovery = rusqlite::Connection::open(&recovery_path).expect("inspect saved pop");
    assert_eq!(
        recovery
            .query_row("SELECT COUNT(*) FROM glyphs", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(
        recovery
            .query_row(
                "SELECT COUNT(*) FROM recovery_tombstones WHERE entity_kind = 'glyph'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
        1
    );
    drop(recovery);

    document
        .apply_change_set_with_font(&changes, &post, true)
        .expect("redo the saved append");
    document.save_document().expect("save redone addition");
    drop(document);
    let saved = ShiftStore::open_document(&document_path).expect("open saved document");
    assert_eq!(saved.load_font_state().unwrap(), post);
}

#[test]
fn parent_deletion_does_not_reinsert_an_earlier_layer_override() {
    let temp = tempfile::tempdir().expect("temp dir");
    let document_path = temp.path().join("Dogfood.shift");
    let recovery_path = temp.path().join("recovery.sqlite");
    let glyph_id = shift_font::GlyphId::from_raw("A");
    let layer_id = shift_font::LayerId::from_raw("A_bold");
    let source_id = shift_font::SourceId::from_raw("bold");
    let original = sample_font();
    drop(ShiftStore::create_document(&document_path, &original).expect("create document"));

    let mut document = ShiftStore::open_document_with_recovery(&document_path, &recovery_path)
        .expect("open with recovery");
    let mut layer = document.load_glyph_layer(&layer_id).unwrap().unwrap();
    layer.set_width(777.0);
    document.replace_glyph_layer(&layer).unwrap();

    let mut post = original.clone();
    let removed_layer = post
        .remove_glyph_layer(layer_id.clone())
        .expect("remove glyph layer");
    post.remove_source(source_id.clone())
        .expect("remove source");
    let changes = shift_font::FontChangeSet::new(vec![
        layer_deleted(glyph_id, &removed_layer),
        shift_font::FontChange::Sources(shift_font::Replacement::new(
            source_collection(&original),
            source_collection(&post),
        )),
    ]);
    document
        .apply_change_set_with_font(&changes, &post, true)
        .unwrap();
    assert!(document.load_glyph_layer(&layer_id).unwrap().is_none());

    document.save_document().expect("save deletion");
    drop(document);

    let saved = ShiftStore::open_document(&document_path).expect("open saved document");
    assert_eq!(saved.load_font_state().unwrap(), post);
}

fn kerning_edit(
    font: &mut shift_font::Font,
    source_id: &str,
    value: Option<f64>,
) -> shift_font::FontChangeSet {
    font.apply_intents(shift_font::FontIntentSet {
        intents: vec![shift_font::FontIntent::SetKerningValues {
            edits: vec![shift_font::KerningValueEdit {
                source_id: shift_font::SourceId::from_raw(source_id),
                pair: shift_font::KerningPair::groups(
                    shift_font::KerningGroupId::from_raw("first_A"),
                    shift_font::KerningGroupId::from_raw("second_A"),
                ),
                value,
            }],
        }],
    })
    .expect("kerning edit applies")
    .changes
}

fn stored_kerning(store: &ShiftStore, source_id: &str) -> Option<f64> {
    store.load_font_state().unwrap().kerning().value(
        &shift_font::SourceId::from_raw(source_id),
        &shift_font::KerningPair::groups(
            shift_font::KerningGroupId::from_raw("first_A"),
            shift_font::KerningGroupId::from_raw("second_A"),
        ),
    )
}

#[test]
fn kerning_edits_persist_in_a_working_store() {
    let temp = tempfile::tempdir().expect("temp dir");
    let path = temp.path().join("working.sqlite");
    let mut font = sample_font();
    let mut store = ShiftStore::open(&path).expect("open working store");
    store.replace_font_state(&font).expect("write font");

    let set = kerning_edit(&mut font, "regular", Some(-40.0));
    store.apply_change_set_with_font(&set, &font, true).unwrap();
    let removed = kerning_edit(&mut font, "bold", None);
    store
        .apply_change_set_with_font(&removed, &font, true)
        .unwrap();
    drop(store);

    let reopened = ShiftStore::open(&path).expect("reopen working store");
    assert_eq!(stored_kerning(&reopened, "regular"), Some(-40.0));
    assert_eq!(stored_kerning(&reopened, "bold"), None);
    assert_eq!(reopened.load_font_state().unwrap(), font);
}

#[test]
fn recovery_overlay_keeps_unsaved_kerning_until_saved() {
    let temp = tempfile::tempdir().expect("temp dir");
    let document_path = temp.path().join("Dogfood.shift");
    let recovery_path = temp.path().join("Dogfood.recovery.sqlite");
    let mut font = sample_font();
    drop(ShiftStore::create_document(&document_path, &font).expect("create document"));

    let mut document = ShiftStore::open_document_with_recovery(&document_path, &recovery_path)
        .expect("open with recovery");
    let changes = kerning_edit(&mut font, "regular", Some(-40.0));
    document
        .apply_change_set_with_font(&changes, &font, true)
        .unwrap();
    drop(document);

    let canonical = ShiftStore::open_document(&document_path).expect("open canonical");
    assert_eq!(stored_kerning(&canonical, "regular"), Some(-80.0));
    assert_eq!(stored_kerning(&canonical, "bold"), Some(-120.0));
    drop(canonical);

    let mut recovered = ShiftStore::open_document_with_recovery(&document_path, &recovery_path)
        .expect("reopen with recovery");
    assert_eq!(stored_kerning(&recovered, "regular"), Some(-40.0));
    assert_eq!(stored_kerning(&recovered, "bold"), Some(-120.0));
    recovered.save_document().unwrap();
    drop(recovered);

    let saved = ShiftStore::open_document(&document_path).expect("open saved document");
    assert_eq!(saved.load_font_state().unwrap(), font);
}
