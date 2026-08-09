use std::{
    ffi::OsString,
    path::{Path, PathBuf},
};

use shift_font::test_support::sample_font;
use shift_store::{RecoveryState, ShiftStore, StoreError};

#[test]
fn recovery_overlay_reopens_unsaved_layer_edits_and_save_commits_only_the_overlay() {
    let temp = tempfile::tempdir().expect("temp dir");
    let document_path = temp.path().join("Dogfood.shift");
    let recovery_path = temp.path().join("Dogfood.recovery.sqlite");
    let layer_id = shift_font::LayerId::from_raw("A_regular");
    let original = sample_font();
    let original_metadata = ShiftStore::create_document(&document_path, &original)
        .expect("create document")
        .document_metadata()
        .expect("document metadata");
    let unrelated_layer_id = shift_font::LayerId::from_raw("acute_regular");
    let unrelated_before = stored_payload(&document_path, &unrelated_layer_id);

    let mut document = ShiftStore::open_document_with_recovery(&document_path, &recovery_path)
        .expect("open with recovery");
    assert_eq!(
        document.recovery_state().unwrap(),
        Some(RecoveryState::Clean)
    );
    let mut changed = document
        .load_glyph_layer(&layer_id)
        .expect("load layer")
        .expect("layer exists");
    changed.set_width(777.0);
    document
        .replace_glyph_layer(&changed)
        .expect("persist recovery edit");
    assert_eq!(
        document.recovery_state().unwrap(),
        Some(RecoveryState::Dirty)
    );
    drop(document);

    let canonical = ShiftStore::open_document(&document_path).expect("open canonical document");
    assert_eq!(
        canonical
            .load_glyph_layer(&layer_id)
            .unwrap()
            .unwrap()
            .width(),
        600.0,
        "unsaved edit must not mutate the canonical document"
    );
    assert_eq!(
        canonical.document_metadata().unwrap(),
        original_metadata,
        "recovery writes must not advance the saved commit"
    );
    drop(canonical);

    let recovery = rusqlite::Connection::open(&recovery_path).expect("inspect recovery database");
    assert_eq!(
        recovery
            .query_row("SELECT COUNT(*) FROM glyph_layer_payloads", [], |row| row
                .get::<_, i64>(
                0
            ))
            .unwrap(),
        1,
        "one edited layer must not copy unrelated payloads"
    );
    drop(recovery);

    let mut reopened = ShiftStore::open_document_with_recovery(&document_path, &recovery_path)
        .expect("reopen recovered document");
    assert_eq!(
        reopened.recovery_state().unwrap(),
        Some(RecoveryState::Dirty)
    );
    assert_eq!(
        reopened
            .load_glyph_layer(&layer_id)
            .unwrap()
            .unwrap()
            .width(),
        777.0,
        "the editable view should merge the persisted overlay"
    );

    let saved_metadata = reopened.save_document().expect("save recovered edits");
    assert_eq!(saved_metadata.document_id, original_metadata.document_id);
    assert_ne!(
        saved_metadata.saved_commit_id,
        original_metadata.saved_commit_id
    );
    assert_eq!(
        reopened.recovery_state().unwrap(),
        Some(RecoveryState::Clean)
    );
    drop(reopened);

    assert!(!sqlite_sidecar_path(&document_path, "-journal").exists());
    assert!(!sqlite_sidecar_path(&document_path, "-wal").exists());
    assert!(!sqlite_sidecar_path(&document_path, "-shm").exists());

    let saved = ShiftStore::open_document(&document_path).expect("open saved document");
    assert_eq!(saved.document_metadata().unwrap(), saved_metadata);
    assert_eq!(
        stored_payload(&document_path, &unrelated_layer_id),
        unrelated_before,
        "Save must not rewrite an unrelated layer payload"
    );
    assert_eq!(
        saved.load_glyph_layer(&layer_id).unwrap().unwrap().width(),
        777.0
    );
    drop(saved);

    let recovery = rusqlite::Connection::open(&recovery_path).expect("inspect cleared recovery");
    assert_eq!(
        recovery
            .query_row("SELECT COUNT(*) FROM glyph_layer_payloads", [], |row| row
                .get::<_, i64>(
                0
            ))
            .unwrap(),
        0,
        "successful Save should clear recovery payloads"
    );
}

#[test]
fn save_as_document_includes_recovery_without_mutating_its_source() {
    let temp = tempfile::tempdir().expect("temp dir");
    let document_path = temp.path().join("Dogfood.shift");
    let recovery_path = temp.path().join("Dogfood.recovery.sqlite");
    let saved_as_path = temp.path().join("Dogfood Copy.shift");
    let layer_id = shift_font::LayerId::from_raw("A_regular");
    let source_metadata = ShiftStore::create_document(&document_path, &sample_font())
        .expect("create document")
        .document_metadata()
        .expect("source metadata");

    let mut source = ShiftStore::open_document_with_recovery(&document_path, &recovery_path)
        .expect("open with recovery");
    let mut changed = source.load_glyph_layer(&layer_id).unwrap().unwrap();
    changed.set_width(777.0);
    source.replace_glyph_layer(&changed).unwrap();

    let saved_as_metadata = source
        .save_as_document(&saved_as_path)
        .expect("save recovered view as a new document");

    assert_eq!(source.recovery_state().unwrap(), Some(RecoveryState::Dirty));
    assert_eq!(source.document_metadata().unwrap(), source_metadata);
    assert_ne!(saved_as_metadata.document_id, source_metadata.document_id);
    drop(source);

    let canonical_source = ShiftStore::open_document(&document_path).expect("open source");
    assert_eq!(
        canonical_source
            .load_glyph_layer(&layer_id)
            .unwrap()
            .unwrap()
            .width(),
        600.0
    );
    let saved_as = ShiftStore::open_document(&saved_as_path).expect("open saved-as document");
    assert_eq!(saved_as.document_metadata().unwrap(), saved_as_metadata);
    assert_eq!(
        saved_as
            .load_glyph_layer(&layer_id)
            .unwrap()
            .unwrap()
            .width(),
        777.0
    );
}

#[test]
fn canonical_document_rejects_an_invalid_saved_commit_id() {
    let temp = tempfile::tempdir().expect("temp dir");
    let document_path = temp.path().join("Dogfood.shift");
    drop(ShiftStore::create_document(&document_path, &sample_font()).expect("create document"));
    let conn = rusqlite::Connection::open(&document_path).expect("open raw document");
    conn.execute(
        "UPDATE document_metadata SET saved_commit_id = 'invalid' WHERE id = 1",
        [],
    )
    .expect("corrupt commit ID");
    drop(conn);

    let error = match ShiftStore::open_document(&document_path) {
        Ok(_) => panic!("invalid saved commit ID must be refused"),
        Err(error) => error,
    };

    assert!(matches!(error, StoreError::InvalidCommitId(_)));
}

#[test]
fn recovery_overlay_refuses_a_different_document_identity() {
    let temp = tempfile::tempdir().expect("temp dir");
    let first_path = temp.path().join("First.shift");
    let second_path = temp.path().join("Second.shift");
    let recovery_path = temp.path().join("recovery.sqlite");
    drop(ShiftStore::create_document(&first_path, &sample_font()).expect("create first"));
    drop(ShiftStore::create_document(&second_path, &sample_font()).expect("create second"));
    drop(
        ShiftStore::open_document_with_recovery(&first_path, &recovery_path)
            .expect("bind first document"),
    );

    let error = match ShiftStore::open_document_with_recovery(&second_path, &recovery_path) {
        Ok(_) => panic!("recovery overlay must not bind to another document"),
        Err(error) => error,
    };

    assert!(matches!(error, StoreError::RecoveryDocumentMismatch { .. }));
}

#[test]
fn recovery_overlay_detects_a_changed_canonical_base_before_save() {
    let temp = tempfile::tempdir().expect("temp dir");
    let document_path = temp.path().join("Dogfood.shift");
    let first_recovery_path = temp.path().join("first.recovery.sqlite");
    let second_recovery_path = temp.path().join("second.recovery.sqlite");
    let layer_id = shift_font::LayerId::from_raw("A_regular");
    drop(ShiftStore::create_document(&document_path, &sample_font()).expect("create document"));

    let mut first = ShiftStore::open_document_with_recovery(&document_path, &first_recovery_path)
        .expect("open first editor");
    let mut first_layer = first.load_glyph_layer(&layer_id).unwrap().unwrap();
    first_layer.set_width(700.0);
    first.replace_glyph_layer(&first_layer).unwrap();
    drop(first);

    let mut second = ShiftStore::open_document_with_recovery(&document_path, &second_recovery_path)
        .expect("open second editor");
    let mut second_layer = second.load_glyph_layer(&layer_id).unwrap().unwrap();
    second_layer.set_width(800.0);
    second.replace_glyph_layer(&second_layer).unwrap();
    second.save_document().expect("save second editor");
    drop(second);

    let mut conflicted =
        ShiftStore::open_document_with_recovery(&document_path, &first_recovery_path)
            .expect("reopen first editor");
    assert_eq!(
        conflicted.recovery_state().unwrap(),
        Some(RecoveryState::Conflict)
    );
    assert_eq!(
        conflicted
            .load_glyph_layer(&layer_id)
            .unwrap()
            .unwrap()
            .width(),
        700.0,
        "conflict recovery must remain inspectable"
    );
    assert!(conflicted.save_document().is_err());

    conflicted
        .discard_recovery()
        .expect("discard conflicting recovery");
    assert_eq!(
        conflicted.recovery_state().unwrap(),
        Some(RecoveryState::Clean)
    );
    assert_eq!(
        conflicted
            .load_glyph_layer(&layer_id)
            .unwrap()
            .unwrap()
            .width(),
        800.0
    );
}

#[test]
fn discarding_recovery_restores_the_canonical_layer_without_reopening() {
    let temp = tempfile::tempdir().expect("temp dir");
    let document_path = temp.path().join("Dogfood.shift");
    let recovery_path = temp.path().join("Dogfood.recovery.sqlite");
    let layer_id = shift_font::LayerId::from_raw("A_regular");
    drop(ShiftStore::create_document(&document_path, &sample_font()).expect("create document"));

    let mut document = ShiftStore::open_document_with_recovery(&document_path, &recovery_path)
        .expect("open with recovery");
    let mut changed = document.load_glyph_layer(&layer_id).unwrap().unwrap();
    changed.set_width(888.0);
    document.replace_glyph_layer(&changed).unwrap();
    assert_eq!(
        document
            .load_glyph_layer(&layer_id)
            .unwrap()
            .unwrap()
            .width(),
        888.0
    );

    document.discard_recovery().expect("discard recovery");

    assert_eq!(
        document.recovery_state().unwrap(),
        Some(RecoveryState::Clean)
    );
    assert_eq!(
        document
            .load_glyph_layer(&layer_id)
            .unwrap()
            .unwrap()
            .width(),
        600.0
    );
}

fn stored_payload(path: &Path, layer_id: &shift_font::LayerId) -> Vec<u8> {
    let conn = rusqlite::Connection::open(path).expect("open raw document");
    conn.query_row(
        "SELECT payload FROM glyph_layer_payloads WHERE layer_id = ?1",
        [layer_id.to_string()],
        |row| row.get(0),
    )
    .expect("stored layer payload")
}

fn sqlite_sidecar_path(path: &Path, suffix: &str) -> PathBuf {
    let mut sidecar = OsString::from(path.as_os_str());
    sidecar.push(suffix);
    PathBuf::from(sidecar)
}
