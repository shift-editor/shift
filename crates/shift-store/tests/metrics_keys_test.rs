//! Metrics keys on glyphs and layers survive saving and reopening a
//! document, and documents from before them open with none.

use std::path::Path;

use shift_font::test_support::sample_font;
use shift_font::{
    Font, Glyph, GlyphId, GlyphLayer, LayerId, MetricsKey, MetricsKeySide, MetricsKeys,
};
use shift_store::{SHIFT_DOCUMENT_SCHEMA_VERSION, ShiftStore};

fn keys(entries: &[(MetricsKeySide, &str)]) -> MetricsKeys {
    entries
        .iter()
        .map(|(side, text)| (*side, MetricsKey::new(*text).unwrap()))
        .collect()
}

/// The sample font plus an `o` whose glyph links both sides to `n` and whose
/// default-source layer centres itself, as Glyphs writes such a glyph.
fn font_with_keyed_o(glyph_keys: MetricsKeys) -> (Font, GlyphId, LayerId) {
    let mut font = sample_font();
    let source_id = font.default_source_id().unwrap();

    let mut glyph = Glyph::with_id(GlyphId::from_raw("o"), "o");
    glyph.set_unicodes(vec![0x006F]);
    *glyph.metrics_keys_mut() = glyph_keys;
    let glyph_id = font.insert_glyph(glyph).unwrap();

    let layer_id = LayerId::from_raw("o-regular");
    let mut layer = GlyphLayer::with_width(layer_id, source_id, 560.0);
    *layer.metrics_keys_mut() = keys(&[
        (MetricsKeySide::Right, "=|"),
        (MetricsKeySide::Width, "==n*1.05"),
    ]);
    font.insert_glyph_layer(glyph_id, layer).unwrap();
    (font, glyph_id, layer_id)
}

fn o_glyph_keys() -> MetricsKeys {
    keys(&[
        (MetricsKeySide::Left, "=n"),
        (MetricsKeySide::Right, "=n+10"),
    ])
}

fn user_version(path: &Path) -> i64 {
    rusqlite::Connection::open(path)
        .unwrap()
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap()
}

#[test]
fn glyph_and_layer_keys_round_trip_through_a_document() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Keys.shift");
    let (font, glyph_id, layer_id) = font_with_keyed_o(o_glyph_keys());
    drop(ShiftStore::create_document(&path, &font).unwrap());

    let loaded = ShiftStore::open_document(&path)
        .unwrap()
        .load_font_state()
        .unwrap();

    assert_eq!(
        loaded.glyph(glyph_id).unwrap().metrics_keys(),
        &o_glyph_keys()
    );
    assert_eq!(
        loaded.layer(layer_id).unwrap().metrics_keys(),
        &keys(&[
            (MetricsKeySide::Right, "=|"),
            (MetricsKeySide::Width, "==n*1.05"),
        ])
    );
}

#[test]
fn a_directory_read_without_payloads_still_has_layer_keys() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Keys.shift");
    let (font, glyph_id, layer_id) = font_with_keyed_o(o_glyph_keys());
    drop(ShiftStore::create_document(&path, &font).unwrap());

    let directory = ShiftStore::open_document(&path)
        .unwrap()
        .load_font_directory()
        .unwrap();

    let placeholder = directory.layer(layer_id).unwrap();
    assert!(placeholder.contours().is_empty());
    assert_eq!(
        placeholder.metrics_keys(),
        font.layer(layer_id).unwrap().metrics_keys()
    );
    assert_eq!(
        directory.glyph(glyph_id).unwrap().metrics_keys(),
        &o_glyph_keys()
    );
}

#[test]
fn rewriting_a_glyph_clears_a_removed_key() {
    let mut store = ShiftStore::open_memory_for_test().unwrap();
    let (font, glyph_id, _) = font_with_keyed_o(o_glyph_keys());
    store.replace_font_state(&font).unwrap();

    let (font, ..) = font_with_keyed_o(MetricsKeys::new());
    store.replace_font_state(&font).unwrap();

    let loaded = store.load_font_state().unwrap();
    assert!(loaded.glyph(glyph_id).unwrap().metrics_keys().is_empty());
}

#[test]
fn opening_a_version_4_document_upgrades_it_with_no_keys() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Old.shift");
    let font = sample_font();
    drop(ShiftStore::create_document(&path, &font).unwrap());
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute_batch(
        "ALTER TABLE glyphs DROP COLUMN left_metrics_key;
         ALTER TABLE glyphs DROP COLUMN right_metrics_key;
         ALTER TABLE glyphs DROP COLUMN width_metrics_key;
         ALTER TABLE glyph_layers DROP COLUMN left_metrics_key;
         ALTER TABLE glyph_layers DROP COLUMN right_metrics_key;
         ALTER TABLE glyph_layers DROP COLUMN width_metrics_key;
         PRAGMA user_version = 4;",
    )
    .unwrap();
    drop(conn);

    let store = ShiftStore::open_document(&path).unwrap();
    let loaded = store.load_font_state().unwrap();

    assert_eq!(loaded.glyph_count(), font.glyph_count());
    assert!(loaded.glyphs().all(|glyph| glyph.metrics_keys().is_empty()));
    drop(store);
    assert_eq!(user_version(&path), SHIFT_DOCUMENT_SCHEMA_VERSION);
}
