use shift_font::{GlyphId, KerningPair, KerningPosition, SourceId, test_support::sample_font};
use shift_store::{SHIFT_DOCUMENT_SCHEMA_VERSION, ShiftStore};

/// Rewrites current kerning tables into the empty version 1 shape, where
/// pairs had no source and named glyphs and prefixed groups.
const V1_KERNING_TABLES: &str = r#"
DROP TABLE kerning_group_members;
DROP TABLE kerning_groups;
DROP TABLE kerning_pairs;

CREATE TABLE kerning_groups (
    side INTEGER NOT NULL CHECK (side IN (1, 2)),
    name TEXT NOT NULL,
    PRIMARY KEY (side, name)
);

CREATE TABLE kerning_group_members (
    side INTEGER NOT NULL CHECK (side IN (1, 2)),
    group_name TEXT NOT NULL,
    glyph_name TEXT NOT NULL,
    order_index INTEGER NOT NULL,
    PRIMARY KEY (side, group_name, order_index),
    FOREIGN KEY (side, group_name) REFERENCES kerning_groups(side, name) ON DELETE CASCADE
);

CREATE TABLE kerning_pairs (
    order_index INTEGER PRIMARY KEY,
    first_kind TEXT NOT NULL CHECK (first_kind IN ('glyph', 'group')),
    first_value TEXT NOT NULL,
    second_kind TEXT NOT NULL CHECK (second_kind IN ('glyph', 'group')),
    second_value TEXT NOT NULL,
    value REAL NOT NULL
);

PRAGMA user_version = 1;
"#;

/// Version 1 kerning rows as a 0.1 release wrote them.
const V1_KERNING_ROWS: &str = r#"
INSERT INTO kerning_groups (side, name) VALUES
    (1, 'public.kern1.A'),
    (2, 'public.kern2.A'),
    (1, 'public.kern1.Ghost');

INSERT INTO kerning_group_members (side, group_name, glyph_name, order_index) VALUES
    (1, 'public.kern1.A', 'A', 0),
    (2, 'public.kern2.A', 'A', 0),
    (1, 'public.kern1.Ghost', 'missing', 0);

INSERT INTO kerning_pairs (
    order_index, first_kind, first_value, second_kind, second_value, value
) VALUES
    (0, 'group', 'public.kern1.A', 'group', 'public.kern2.A', -80),
    (1, 'glyph', 'A', 'glyph', 'acute', -15),
    (2, 'glyph', 'missing', 'group', 'public.kern2.A', -5);
"#;

fn write_version_1_document(path: &std::path::Path) {
    drop(ShiftStore::create_document(path, &sample_font()).expect("create document"));
    let conn = rusqlite::Connection::open(path).expect("raw open");
    conn.execute_batch(V1_KERNING_TABLES)
        .expect("write version 1 kerning tables");
    conn.execute_batch(V1_KERNING_ROWS)
        .expect("write version 1 kerning rows");
}

fn assert_migrated_kerning(font: &shift_font::Font) {
    let regular = SourceId::from_raw("regular");
    let a = GlyphId::from_raw("A");
    let acute = GlyphId::from_raw("acute");
    let kerning = font.kerning();
    let members = |position, name| {
        let group_id = kerning.group_id(position, name).expect("group migrated");
        kerning
            .group(group_id)
            .expect("group exists")
            .members
            .clone()
    };
    assert_eq!(members(KerningPosition::First, "A"), vec![a.clone()]);
    assert!(members(KerningPosition::First, "Ghost").is_empty());
    let first_a = kerning.group_id(KerningPosition::First, "A").unwrap();
    let second_a = kerning.group_id(KerningPosition::Second, "A").unwrap();
    assert_ne!(first_a, second_a);
    assert_eq!(
        kerning.value(
            &regular,
            &KerningPair::groups(first_a.clone(), second_a.clone())
        ),
        Some(-80.0)
    );
    assert_eq!(
        kerning.value(&regular, &KerningPair::glyphs(a, acute)),
        Some(-15.0)
    );
    assert_eq!(kerning.source(&regular).map(|pairs| pairs.len()), Some(2));
    assert_eq!(kerning.sources().count(), 1);
}

fn user_version(path: &std::path::Path) -> i64 {
    rusqlite::Connection::open(path)
        .expect("raw reopen")
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("user_version")
}

#[test]
fn opening_a_version_1_document_moves_kerning_to_ids_and_the_default_source() {
    let temp = tempfile::tempdir().expect("temp dir");
    let path = temp.path().join("Alpha.shift");
    write_version_1_document(&path);

    let store = ShiftStore::open_document(&path).expect("open version 1 document");
    assert_migrated_kerning(&store.load_font_state().expect("load migrated font"));
    drop(store);

    assert_eq!(user_version(&path), SHIFT_DOCUMENT_SCHEMA_VERSION);
}

#[test]
fn a_version_1_recovery_overlay_reopens_against_the_migrated_document() {
    let temp = tempfile::tempdir().expect("temp dir");
    let path = temp.path().join("Alpha.shift");
    let recovery_path = temp.path().join("Alpha.recovery.sqlite");
    let layer_id = shift_font::LayerId::from_raw("A_regular");
    write_version_1_document(&path);

    let mut document =
        ShiftStore::open_document_with_recovery(&path, &recovery_path).expect("open with recovery");
    let mut changed = document
        .load_glyph_layer(&layer_id)
        .expect("load layer")
        .expect("layer exists");
    changed.set_width(777.0);
    document
        .replace_glyph_layer(&changed)
        .expect("persist recovery edit");
    drop(document);
    rusqlite::Connection::open(&path)
        .expect("raw open document")
        .execute_batch(&format!("{V1_KERNING_TABLES}{V1_KERNING_ROWS}"))
        .expect("restore version 1 document kerning");
    rusqlite::Connection::open(&recovery_path)
        .expect("raw open recovery")
        .execute_batch(V1_KERNING_TABLES)
        .expect("write version 1 recovery kerning tables");

    let document = ShiftStore::open_document_with_recovery(&path, &recovery_path)
        .expect("reopen version 1 document and recovery");
    let recovered = document
        .load_glyph_layer(&layer_id)
        .expect("load recovered layer")
        .expect("layer exists");
    assert_eq!(recovered.width(), 777.0);
    assert_migrated_kerning(&document.load_font_state().expect("load migrated font"));
}
