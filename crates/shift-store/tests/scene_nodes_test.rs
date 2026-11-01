//! A document's scene is stored one row per node, carried by recovery, Save,
//! Save As and Discard like the font, and never advances the font revision.

use std::path::Path;

use shift_engine::scene::{NodeContent, Scene, SceneChangeSet, SceneIntent, SceneNode};
use shift_font::test_support::sample_font;
use shift_font::{FontChangeSet, NodeId, RunId};
use shift_store::{RecoveryState, SaveState, ShiftStore, WorkspaceState};

/// The sibling key at `position`: ascending keys made one after another.
fn key(position: usize) -> String {
    let mut key = shift_font::index_key::between(None, None).unwrap();
    for _ in 0..position {
        key = shift_font::index_key::between(Some(&key), None).unwrap();
    }
    key
}

fn page(id: &str, position: usize) -> SceneNode {
    SceneNode {
        id: NodeId::from_raw(id),
        parent_id: None,
        index: key(position),
        x: 0.0,
        y: 0.0,
        content: NodeContent::Page {
            name: id.into(),
            role: None,
        },
    }
}

fn run(id: &str, page: &str) -> SceneNode {
    SceneNode {
        id: NodeId::from_raw(id),
        parent_id: Some(NodeId::from_raw(page)),
        index: key(0),
        x: 120.0,
        y: -40.0,
        content: NodeContent::TextRun {
            run_id: RunId::from_raw(id),
            size: 1000.0,
            items: Vec::new(),
        },
    }
}

/// Applies `intents` to `scene` and writes what they changed to `store`.
fn edit(store: &mut ShiftStore, scene: &mut Scene, intents: &[SceneIntent], save_state: SaveState) {
    let changes = scene.apply_intents(intents).unwrap();
    write(store, &changes, save_state);
}

fn write(store: &mut ShiftStore, changes: &SceneChangeSet, save_state: SaveState) {
    let font = store.load_font_state().unwrap();
    store
        .apply_document_change_set(&FontChangeSet::default(), &font, changes, save_state)
        .unwrap();
}

/// Two pages, a run on each.
fn two_pages_and_runs() -> Vec<SceneIntent> {
    vec![
        SceneIntent::CreateNode(page("one", 1)),
        SceneIntent::CreateNode(page("two", 2)),
        SceneIntent::CreateNode(run("first", "one")),
        SceneIntent::CreateNode(run("second", "two")),
    ]
}

/// Each node by name: a page's name, any other node's id.
fn node_ids(scene: &Scene) -> Vec<String> {
    scene
        .nodes()
        .iter()
        .map(|node| match &node.content {
            NodeContent::Page { name, .. } if node.id.as_str() == format!("node_{name}") => {
                node.id.to_string()
            }
            NodeContent::Page { name, .. } => name.clone(),
            _ => node.id.to_string(),
        })
        .collect()
}

/// The new document's page, then the two pages and runs [`two_pages_and_runs`] adds.
const STORED: [&str; 5] = [
    "Page 1",
    "node_one",
    "node_first",
    "node_two",
    "node_second",
];

fn open(document: &Path, recovery: &Path) -> ShiftStore {
    ShiftStore::open_document_with_recovery(document, recovery).unwrap()
}

#[test]
fn a_scene_edit_is_unsaved_work_that_survives_a_kill_and_keeps_the_revision() {
    let temp = tempfile::tempdir().unwrap();
    let (document, recovery) = (
        temp.path().join("Doc.shift"),
        temp.path().join("Doc.recovery"),
    );
    drop(ShiftStore::create_document(&document, &sample_font()).unwrap());
    let mut store = open(&document, &recovery);
    let revision = store.recovery_revision().unwrap();
    let mut scene = store.load_scene().unwrap();

    edit(
        &mut store,
        &mut scene,
        &two_pages_and_runs(),
        SaveState::Unsaved,
    );

    assert_eq!(store.recovery_state().unwrap(), Some(RecoveryState::Dirty));
    assert_eq!(store.recovery_revision().unwrap(), revision);
    // The process dies without saving; the next open recovers the scene.
    drop(store);
    let store = open(&document, &recovery);
    assert_eq!(node_ids(&store.load_scene().unwrap()), STORED);
    assert_eq!(store.load_scene().unwrap(), scene);
}

#[test]
fn save_keeps_the_scene_in_the_document_and_discard_returns_to_it() {
    let temp = tempfile::tempdir().unwrap();
    let (document, recovery) = (
        temp.path().join("Doc.shift"),
        temp.path().join("Doc.recovery"),
    );
    drop(ShiftStore::create_document(&document, &sample_font()).unwrap());
    let mut store = open(&document, &recovery);
    let mut scene = store.load_scene().unwrap();
    edit(
        &mut store,
        &mut scene,
        &two_pages_and_runs(),
        SaveState::Unsaved,
    );

    store.save_document().unwrap();
    edit(
        &mut store,
        &mut scene,
        &[SceneIntent::DeleteNode(shift_engine::scene::DeleteNode {
            id: NodeId::from_raw("two"),
        })],
        SaveState::Unsaved,
    );
    assert_eq!(
        node_ids(&store.load_scene().unwrap()),
        ["Page 1", "node_one", "node_first"]
    );
    store.discard_recovery().unwrap();

    assert_eq!(node_ids(&store.load_scene().unwrap()), STORED);
    drop(store);
    let saved = ShiftStore::open_document(&document).unwrap();
    assert_eq!(node_ids(&saved.load_scene().unwrap()), STORED);
}

#[test]
fn undoing_a_scene_edit_back_to_the_save_leaves_the_document_clean() {
    let temp = tempfile::tempdir().unwrap();
    let (document, recovery) = (
        temp.path().join("Doc.shift"),
        temp.path().join("Doc.recovery"),
    );
    drop(ShiftStore::create_document(&document, &sample_font()).unwrap());
    let mut store = open(&document, &recovery);
    let mut scene = store.load_scene().unwrap();
    edit(
        &mut store,
        &mut scene,
        &two_pages_and_runs(),
        SaveState::Unsaved,
    );
    store.save_document().unwrap();

    let moved = scene
        .apply_intents(&[SceneIntent::UpdateNode(SceneNode {
            x: 500.0,
            ..run("first", "one")
        })])
        .unwrap();
    write(&mut store, &moved, SaveState::Unsaved);
    assert_eq!(store.recovery_state().unwrap(), Some(RecoveryState::Dirty));
    scene.apply_change_set(&moved.inverted()).unwrap();
    write(&mut store, &moved.inverted(), SaveState::MatchesSaved);

    assert_eq!(store.recovery_state().unwrap(), Some(RecoveryState::Clean));
    assert_eq!(store.load_scene().unwrap(), scene);
}

#[test]
fn save_as_carries_the_unsaved_scene_into_the_new_document() {
    let temp = tempfile::tempdir().unwrap();
    let (document, recovery) = (
        temp.path().join("Doc.shift"),
        temp.path().join("Doc.recovery"),
    );
    drop(ShiftStore::create_document(&document, &sample_font()).unwrap());
    let mut store = open(&document, &recovery);
    let mut scene = store.load_scene().unwrap();
    edit(
        &mut store,
        &mut scene,
        &two_pages_and_runs(),
        SaveState::Unsaved,
    );

    let copy = temp.path().join("Copy.shift");
    store.save_as_document(&copy).unwrap();

    let copied = ShiftStore::open_document(&copy).unwrap();
    assert_eq!(copied.load_scene().unwrap(), scene);
}

#[test]
fn a_working_store_marks_a_scene_edit_unsaved_without_a_new_revision() {
    let temp = tempfile::tempdir().unwrap();
    let mut store = ShiftStore::open(temp.path().join("work.db")).unwrap();
    store.replace_font_state(&sample_font()).unwrap();
    store
        .set_workspace_state(&WorkspaceState::untitled(None))
        .unwrap();
    store.ensure_scene_page().unwrap();
    let mut scene = store.load_scene().unwrap();

    edit(
        &mut store,
        &mut scene,
        &two_pages_and_runs(),
        SaveState::Unsaved,
    );

    let state = store.workspace_state().unwrap().unwrap();
    assert!(state.dirty);
    assert_eq!(state.revision, 0);
    assert_eq!(store.load_scene().unwrap(), scene);
}

#[test]
fn a_version_3_document_upgrades_to_one_page_and_keeps_its_scene_edits() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Old.shift");
    drop(ShiftStore::create_document(&path, &sample_font()).unwrap());
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute_batch("DROP TABLE scene_nodes; PRAGMA user_version = 3;")
        .unwrap();
    drop(conn);

    let recovery = temp.path().join("Old.recovery");
    let mut store = open(&path, &recovery);
    assert_eq!(node_ids(&store.load_scene().unwrap()), ["Page 1"]);
    let mut scene = store.load_scene().unwrap();
    edit(
        &mut store,
        &mut scene,
        &two_pages_and_runs(),
        SaveState::Unsaved,
    );
    store.save_document().unwrap();

    drop(store);
    let saved = ShiftStore::open_document(&path).unwrap();
    assert_eq!(node_ids(&saved.load_scene().unwrap()), STORED);
}
