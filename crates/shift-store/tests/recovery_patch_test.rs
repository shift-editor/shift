use shift_font::test_support::sample_font;
use shift_store::ShiftStore;

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

    let mut post = original;
    post.metadata_mut().family_name = Some("Recovered Sans".to_string());
    let source_id = shift_font::SourceId::from_raw("regular");
    post.source_mut(source_id.clone())
        .expect("regular source")
        .set_line_gap(Some(99.0));
    let source = post
        .sources()
        .iter()
        .find(|source| source.id() == source_id)
        .expect("updated source")
        .clone();
    let change = shift_font::FontChangeSet::new(vec![
        shift_font::FontChange::font_metadata_updated(post.metadata()),
        shift_font::FontChange::source_updated(&source),
    ]);
    let mut document = ShiftStore::open_document_with_recovery(&document_path, &recovery_path)
        .expect("open with recovery");
    document.apply_change_set_with_font(&change, &post).unwrap();
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
    let deleted_glyph_id = shift_font::GlyphId::from_raw("acute");
    post.remove_glyph(deleted_glyph_id.clone())
        .expect("sample glyph");
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
    let regular_source = post
        .sources()
        .iter()
        .find(|source| source.id() == regular_source_id)
        .expect("updated source")
        .clone();
    post.set_axis_mappings(Vec::new()).expect("clear mappings");
    post.set_named_instances(Vec::new())
        .expect("clear instances");
    let mut metric_definitions = post.metric_definitions().to_vec();
    metric_definitions[0].set_name("Recovered Ascender".to_string());
    post.set_metric_definitions(metric_definitions.clone())
        .expect("replace metric definitions");
    let changes = shift_font::FontChangeSet::new(vec![
        shift_font::FontChange::font_metadata_updated(post.metadata()),
        shift_font::FontChange::axis_updated(&weight),
        shift_font::FontChange::axis_mappings_updated(post.axis_mappings()),
        shift_font::FontChange::named_instances_updated(post.named_instances()),
        shift_font::FontChange::metric_definitions_updated(&metric_definitions),
        shift_font::FontChange::source_updated(&regular_source),
        shift_font::FontChange::glyph_deleted(deleted_glyph_id),
    ]);

    let mut document = ShiftStore::open_document_with_recovery(&document_path, &recovery_path)
        .expect("open with recovery");
    document
        .apply_change_set_with_font(&changes, &post)
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

    let mut post = original;
    let mut definitions = post.metric_definitions().to_vec();
    definitions[0].set_name("Recovered Ascender".to_string());
    post.set_metric_definitions(definitions.clone())
        .expect("replace metric definitions");
    let changes = shift_font::FontChangeSet::from(
        shift_font::FontChange::metric_definitions_updated(&definitions),
    );

    let mut document = ShiftStore::open_document_with_recovery(&document_path, &recovery_path)
        .expect("open with recovery");
    document
        .apply_change_set_with_font(&changes, &post)
        .expect("write metric recovery change");
    document.save_document().expect("save recovered document");
    drop(document);

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
    let mut post = original;
    post.insert_glyph(glyph.clone()).expect("insert glyph");
    let changes = shift_font::FontChangeSet::new(vec![
        shift_font::FontChange::glyph_created(&glyph),
        shift_font::FontChange::glyph_layer_created(glyph_id.clone(), &layer),
    ]);

    let mut document = ShiftStore::open_document_with_recovery(&document_path, &recovery_path)
        .expect("open with recovery");
    document
        .apply_change_set_with_font(&changes, &post)
        .unwrap();
    let directory = document.load_font_directory().unwrap();
    assert_eq!(directory.glyph_count(), post.glyph_count());
    assert_eq!(
        directory
            .glyph(glyph_id)
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

    document.save_document().expect("save additions");
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
    let layer_id = shift_font::LayerId::from_raw("A_regular");
    let original = sample_font();
    drop(ShiftStore::create_document(&document_path, &original).expect("create document"));

    let mut document = ShiftStore::open_document_with_recovery(&document_path, &recovery_path)
        .expect("open with recovery");
    let mut layer = document.load_glyph_layer(&layer_id).unwrap().unwrap();
    layer.set_width(777.0);
    document.replace_glyph_layer(&layer).unwrap();

    let mut post = original;
    post.remove_glyph(glyph_id.clone()).expect("remove glyph");
    let changes = shift_font::FontChangeSet::from(shift_font::FontChange::glyph_deleted(glyph_id));
    document
        .apply_change_set_with_font(&changes, &post)
        .unwrap();
    assert!(document.load_glyph_layer(&layer_id).unwrap().is_none());

    document.save_document().expect("save deletion");
    drop(document);

    let saved = ShiftStore::open_document(&document_path).expect("open saved document");
    assert_eq!(saved.load_font_state().unwrap(), post);
}
