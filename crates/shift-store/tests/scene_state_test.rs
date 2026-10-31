//! The editor's scene state travels with a document: working stores,
//! recovery overlays, saves, and Save As keep it, and Rust never reads it.

use std::path::Path;

use shift_font::test_support::sample_font;
use shift_store::{
    RecoveryState, SceneState, SceneStateWrite, ShiftStore, StoreError, WorkspaceState,
};

fn scene(payload: &str) -> SceneState {
    SceneState {
        version: 1,
        payload: payload.to_string(),
    }
}

fn working_store() -> ShiftStore {
    let mut store = ShiftStore::open_memory_for_test().unwrap();
    store.replace_font_state(&sample_font()).unwrap();
    store
        .set_workspace_state(&WorkspaceState::untitled(None))
        .unwrap();
    store
}

fn create_document(path: &Path) {
    drop(ShiftStore::create_document(path, &sample_font()).unwrap());
}

#[test]
fn a_working_store_round_trips_the_scene_state_and_marks_it_unsaved() {
    let mut store = working_store();
    assert_eq!(store.scene_state().unwrap(), None);

    let written = store.set_scene_state(&scene(r#"{"records":[]}"#)).unwrap();

    assert_eq!(written, SceneStateWrite::Written);
    assert_eq!(
        store.scene_state().unwrap(),
        Some(scene(r#"{"records":[]}"#))
    );
    let workspace = store.workspace_state().unwrap().unwrap();
    assert!(workspace.dirty);
    assert_eq!(workspace.revision, 0, "the font revision must not advance");
}

#[test]
fn writing_the_stored_scene_state_again_changes_nothing() {
    let mut store = working_store();
    store.set_scene_state(&scene("a")).unwrap();
    let mut clean = store.workspace_state().unwrap().unwrap();
    clean.dirty = false;
    store.set_workspace_state(&clean).unwrap();

    let written = store.set_scene_state(&scene("a")).unwrap();

    assert_eq!(written, SceneStateWrite::Unchanged);
    assert!(!store.workspace_state().unwrap().unwrap().dirty);
}

#[test]
fn a_scene_state_version_below_one_is_rejected() {
    let mut store = working_store();

    let result = store.set_scene_state(&SceneState {
        version: 0,
        payload: "a".to_string(),
    });

    assert!(matches!(result, Err(StoreError::Sqlite(_))));
    assert_eq!(store.scene_state().unwrap(), None);
}

#[test]
fn a_document_keeps_an_unsaved_scene_state_in_recovery_until_saved() {
    let temp = tempfile::tempdir().unwrap();
    let document = temp.path().join("Scene.shift");
    let recovery = temp.path().join("recovery.sqlite");
    create_document(&document);

    let mut store = ShiftStore::open_document_with_recovery(&document, &recovery).unwrap();
    store.set_scene_state(&scene("unsaved")).unwrap();
    assert_eq!(store.recovery_state().unwrap(), Some(RecoveryState::Dirty));
    assert_eq!(store.recovery_revision().unwrap(), Some(0));
    drop(store);
    assert_eq!(
        ShiftStore::open_document(&document)
            .unwrap()
            .scene_state()
            .unwrap(),
        None,
        "the canonical document is unchanged before a save"
    );

    let mut recovered = ShiftStore::open_document_with_recovery(&document, &recovery).unwrap();
    assert_eq!(recovered.scene_state().unwrap(), Some(scene("unsaved")));
    recovered.save_document().unwrap();
    drop(recovered);

    let saved = ShiftStore::open_document(&document).unwrap();
    assert_eq!(saved.scene_state().unwrap(), Some(scene("unsaved")));
}

#[test]
fn discarding_recovery_restores_the_saved_scene_state() {
    let temp = tempfile::tempdir().unwrap();
    let document = temp.path().join("Scene.shift");
    let recovery = temp.path().join("recovery.sqlite");
    create_document(&document);
    let mut store = ShiftStore::open_document_with_recovery(&document, &recovery).unwrap();
    store.set_scene_state(&scene("saved")).unwrap();
    store.save_document().unwrap();
    store.set_scene_state(&scene("unsaved")).unwrap();

    store.discard_recovery().unwrap();

    assert_eq!(store.scene_state().unwrap(), Some(scene("saved")));
    assert_eq!(store.recovery_state().unwrap(), Some(RecoveryState::Clean));
}

#[test]
fn save_as_keeps_the_scene_state_of_a_working_store() {
    let temp = tempfile::tempdir().unwrap();
    let document = temp.path().join("SavedAs.shift");
    let mut store = working_store();
    store.set_scene_state(&scene("canvas")).unwrap();

    store.save_as_document(&document).unwrap();

    let saved = ShiftStore::open_document(&document).unwrap();
    assert_eq!(saved.scene_state().unwrap(), Some(scene("canvas")));
}

#[test]
fn save_as_keeps_an_unsaved_scene_state_of_a_document() {
    let temp = tempfile::tempdir().unwrap();
    let document = temp.path().join("Scene.shift");
    let copy = temp.path().join("Copy.shift");
    let recovery = temp.path().join("recovery.sqlite");
    create_document(&document);
    let mut store = ShiftStore::open_document_with_recovery(&document, &recovery).unwrap();
    store.set_scene_state(&scene("unsaved")).unwrap();

    store.save_as_document(&copy).unwrap();

    let saved = ShiftStore::open_document(&copy).unwrap();
    assert_eq!(saved.scene_state().unwrap(), Some(scene("unsaved")));
}

#[test]
fn a_document_written_before_the_scene_state_opens_without_one() {
    let temp = tempfile::tempdir().unwrap();
    let document = temp.path().join("Old.shift");
    let recovery = temp.path().join("recovery.sqlite");
    create_document(&document);
    let conn = rusqlite::Connection::open(&document).unwrap();
    conn.execute_batch("DROP TABLE scene_state; PRAGMA user_version = 3;")
        .unwrap();
    drop(conn);

    let mut store = ShiftStore::open_document_with_recovery(&document, &recovery).unwrap();

    assert_eq!(store.scene_state().unwrap(), None);
    store.set_scene_state(&scene("first")).unwrap();
    assert_eq!(store.scene_state().unwrap(), Some(scene("first")));
}
