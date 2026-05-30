use shift_store::{
    AxisId, GlyphId, NewAxis, NewGlyph, NewSource, ShiftStore, SourceId, SourceKind,
};

#[test]
fn opens_memory_store() {
    ShiftStore::open_memory_for_test().expect("memory store should open");
}

#[test]
fn creates_and_reads_glyph() {
    let mut store = ShiftStore::open_memory_for_test().expect("memory store should open");
    let glyph_id = GlyphId::new("glyph-A");

    store
        .create_glyph(NewGlyph {
            id: glyph_id.clone(),
            name: Some("A".to_string()),
        })
        .expect("glyph should be created");

    let glyph = store
        .get_glyph(&glyph_id)
        .expect("glyph query should succeed")
        .expect("glyph should exist");

    assert_eq!(glyph.id, glyph_id);
    assert_eq!(glyph.name.as_deref(), Some("A"));
}

#[test]
fn creates_and_reads_axis() {
    let mut store = ShiftStore::open_memory_for_test().expect("memory store should open");

    let axis_id = create_weight_axis(&mut store);

    let axis = store
        .get_axis(&axis_id)
        .expect("axis query should succeed")
        .expect("axis should exist");

    assert_eq!(axis.id, axis_id);
    assert_eq!(axis.tag, "wght");
    assert_eq!(axis.name, "Weight");
    assert_eq!(axis.min_value, 100.0);
    assert_eq!(axis.default_value, 400.0);
    assert_eq!(axis.max_value, 800.0);
    assert!(!axis.hidden);
}

#[test]
fn creates_and_reads_source() {
    let mut store = ShiftStore::open_memory_for_test().expect("memory store should open");
    let source_id = create_regular_source(&mut store);

    let source = store
        .get_source(&source_id)
        .expect("source query should succeed")
        .expect("source should exist");

    assert_eq!(source.id, source_id);
    assert_eq!(source.name.as_deref(), Some("Regular"));
    assert_eq!(source.family_name.as_deref(), Some("Shift Sans"));
    assert_eq!(source.style_name.as_deref(), Some("Regular"));
    assert_eq!(source.kind, SourceKind::Master);
}

#[test]
fn sets_and_reads_source_location() {
    let mut store = ShiftStore::open_memory_for_test().expect("memory store should open");
    let axis_id = create_weight_axis(&mut store);
    let source_id = create_regular_source(&mut store);

    store
        .set_source_location(&source_id, &axis_id, 400.0)
        .expect("source location should be set");

    let locations = store
        .get_source_locations(&source_id)
        .expect("source locations query should succeed");

    assert_eq!(locations.len(), 1);
    assert_eq!(locations[0].source_id, source_id);
    assert_eq!(locations[0].axis_id, axis_id);
    assert_eq!(locations[0].value, 400.0);
}

#[test]
fn source_location_requires_existing_source_and_axis() {
    let mut store = ShiftStore::open_memory_for_test().expect("memory store should open");

    let result = store.set_source_location(
        &SourceId::new("source-missing"),
        &AxisId::new("axis-wght"),
        400.0,
    );

    assert!(result.is_err());
}

fn create_weight_axis(store: &mut ShiftStore) -> AxisId {
    let axis_id = AxisId::new("axis-wght");

    store
        .create_axis(NewAxis {
            id: axis_id.clone(),
            tag: "wght".to_string(),
            name: "Weight".to_string(),
            min_value: 100.0,
            default_value: 400.0,
            max_value: 800.0,
            hidden: false,
        })
        .expect("axis should be created");

    axis_id
}

fn create_regular_source(store: &mut ShiftStore) -> SourceId {
    let source_id = SourceId::new("source-regular");

    store
        .create_source(NewSource {
            id: source_id.clone(),
            name: Some("Regular".to_string()),
            family_name: Some("Shift Sans".to_string()),
            style_name: Some("Regular".to_string()),
            kind: SourceKind::Master,
        })
        .expect("source should be created");

    source_id
}
