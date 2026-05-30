use shift_store::{GlyphId, NewGlyph, ShiftStore};

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
