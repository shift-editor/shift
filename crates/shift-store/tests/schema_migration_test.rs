//! Documents, working stores, and recovery overlays at schema version 2
//! open in this version and gain glyph categories.

use std::path::Path;

use shift_font::test_support::sample_font;
use shift_font::{GlyphCategory, GlyphSubcategory};
use shift_store::{SHIFT_DOCUMENT_SCHEMA_VERSION, ShiftStore};

/// Rewrites a current database into the version 2 shape, before glyph
/// categories.
fn downgrade_to_version_2(path: &Path) {
    let conn = rusqlite::Connection::open(path).unwrap();
    conn.execute_batch(
        "ALTER TABLE glyphs DROP COLUMN category;
         ALTER TABLE glyphs DROP COLUMN sub_category;
         PRAGMA user_version = 2;",
    )
    .unwrap();
}

fn user_version(path: &Path) -> i64 {
    rusqlite::Connection::open(path)
        .unwrap()
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap()
}

#[test]
fn opening_a_version_2_document_upgrades_it_and_keeps_its_glyphs() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Old.shift");
    let font = sample_font();
    drop(ShiftStore::create_document(&path, &font).unwrap());
    downgrade_to_version_2(&path);

    let store = ShiftStore::open_document(&path).unwrap();
    let loaded = store.load_font_state().unwrap();

    assert_eq!(loaded.glyph_count(), font.glyph_count());
    assert!(loaded.glyphs().all(|glyph| glyph.category().is_none()));
    drop(store);
    assert_eq!(user_version(&path), SHIFT_DOCUMENT_SCHEMA_VERSION);
}

fn font_with_mark() -> (shift_font::Font, shift_font::GlyphId) {
    let mut font = sample_font();
    let mut mark = shift_font::Glyph::with_unicode("dotaccentcomb", 0x0307);
    mark.set_category(Some(GlyphCategory::Mark));
    mark.set_sub_category(Some(GlyphSubcategory::Nonspacing));
    let id = font.insert_glyph(mark).unwrap();
    (font, id)
}

#[test]
fn glyph_categories_round_trip_through_a_document() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Marks.shift");
    let (font, id) = font_with_mark();
    drop(ShiftStore::create_document(&path, &font).unwrap());

    let loaded = ShiftStore::open_document(&path)
        .unwrap()
        .load_font_state()
        .unwrap();

    let mark = loaded.glyph(&id).unwrap();
    assert_eq!(mark.category(), Some(GlyphCategory::Mark));
    assert_eq!(mark.sub_category(), Some(GlyphSubcategory::Nonspacing));
}

#[test]
fn rewriting_a_glyph_clears_a_removed_category() {
    let mut store = ShiftStore::open_memory_for_test().unwrap();
    let (mut font, id) = font_with_mark();
    store.replace_font_state(&font).unwrap();

    font.set_glyph_category(id.clone(), None, None).unwrap();
    store.replace_font_state(&font).unwrap();

    let loaded = store.load_font_state().unwrap();
    assert_eq!(loaded.glyph(&id).unwrap().category(), None);
    assert_eq!(loaded.glyph(&id).unwrap().sub_category(), None);
}

#[test]
fn opening_a_version_2_working_store_upgrades_it() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("working.sqlite");
    drop(ShiftStore::open(&path).unwrap());
    downgrade_to_version_2(&path);

    drop(ShiftStore::open(&path).unwrap());

    assert_eq!(user_version(&path), SHIFT_DOCUMENT_SCHEMA_VERSION);
}

#[test]
fn reopening_a_version_2_document_with_its_recovery_overlay_upgrades_both() {
    let temp = tempfile::tempdir().unwrap();
    let document = temp.path().join("Old.shift");
    let recovery = temp.path().join("recovery.sqlite");
    let font = sample_font();
    drop(ShiftStore::create_document(&document, &font).unwrap());
    drop(ShiftStore::open_document_with_recovery(&document, &recovery).unwrap());
    downgrade_to_version_2(&document);
    downgrade_to_version_2(&recovery);

    let store = ShiftStore::open_document_with_recovery(&document, &recovery).unwrap();

    assert_eq!(
        store.load_font_state().unwrap().glyph_count(),
        font.glyph_count()
    );
    drop(store);
    assert_eq!(user_version(&document), SHIFT_DOCUMENT_SCHEMA_VERSION);
    assert_eq!(user_version(&recovery), SHIFT_DOCUMENT_SCHEMA_VERSION);
}
