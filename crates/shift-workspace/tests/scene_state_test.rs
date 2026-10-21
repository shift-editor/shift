//! The editor's scene state is document content without font history: it
//! makes the document unsaved, survives saving and reopening, and never
//! enters the undo ledger.

use std::path::PathBuf;

use shift_font::test_support::fixtures;
use shift_font::{FontIntent, FontIntentSet, UpdateSource};
use shift_store::SceneState;
use shift_workspace::FontWorkspace;
use tempfile::TempDir;

fn scene(payload: &str) -> SceneState {
    SceneState {
        version: 1,
        payload: payload.to_string(),
    }
}

/// A saved document opened with a recovery overlay.
fn open_document(dir: &TempDir) -> (FontWorkspace, PathBuf, PathBuf) {
    let path = dir.path().join("Homenaje.shift");
    let recovery = dir.path().join("recovery.sqlite");
    let mut imported = FontWorkspace::open(
        fixtures::font("Homenaje.glyphs"),
        dir.path().join("import.sqlite"),
    )
    .unwrap();
    imported
        .save_as_document(&path, dir.path().join("save-recovery.sqlite"))
        .unwrap();
    drop(imported);
    let workspace = FontWorkspace::open_document(&path, &recovery).unwrap();
    (workspace, path, recovery)
}

fn rename_first_source(workspace: &mut FontWorkspace) {
    let source = workspace.font().sources()[0].clone();
    let rename = UpdateSource {
        source_id: source.id(),
        name: "Renamed".into(),
        location: source.location().clone(),
        metric_values: source.metric_values().clone(),
        italic_angle: source.italic_angle(),
        line_gap: source.line_gap(),
        underline_position: source.underline_position(),
        underline_thickness: source.underline_thickness(),
    };
    workspace
        .apply(&FontIntentSet::from(FontIntent::from(rename)), None)
        .unwrap();
}

#[test]
fn a_scene_change_marks_the_document_unsaved_without_an_undo_entry() {
    let dir = TempDir::new().unwrap();
    let (mut workspace, _, _) = open_document(&dir);
    let revision = workspace.slug_atlas_cache_revision().unwrap();

    workspace.set_scene_state(&scene("canvas")).unwrap();

    assert!(workspace.is_dirty().unwrap());
    assert_eq!(workspace.slug_atlas_cache_revision().unwrap(), revision);
    assert!(workspace.undo().unwrap().is_none());
}

#[test]
fn undoing_back_to_the_saved_font_keeps_an_unsaved_scene() {
    let dir = TempDir::new().unwrap();
    let (mut workspace, path, recovery) = open_document(&dir);
    rename_first_source(&mut workspace);
    workspace.set_scene_state(&scene("canvas")).unwrap();

    workspace.undo().unwrap();

    assert!(workspace.is_dirty().unwrap());
    drop(workspace);
    let reopened = FontWorkspace::open_document(&path, &recovery).unwrap();
    assert_eq!(reopened.scene_state().unwrap(), Some(scene("canvas")));
}

#[test]
fn a_saved_scene_reopens_with_the_document() {
    let dir = TempDir::new().unwrap();
    let (mut workspace, path, _) = open_document(&dir);
    workspace.set_scene_state(&scene("canvas")).unwrap();

    workspace.save().unwrap();

    assert!(!workspace.is_dirty().unwrap());
    drop(workspace);
    let reopened =
        FontWorkspace::open_document(&path, dir.path().join("fresh-recovery.sqlite")).unwrap();
    assert_eq!(reopened.scene_state().unwrap(), Some(scene("canvas")));
}

#[test]
fn an_imported_font_keeps_its_scene_through_save_as() {
    let dir = TempDir::new().unwrap();
    let mut workspace = FontWorkspace::open(
        fixtures::font("Homenaje.glyphs"),
        dir.path().join("import.sqlite"),
    )
    .unwrap();
    workspace.set_scene_state(&scene("canvas")).unwrap();
    assert!(workspace.is_dirty().unwrap());

    let path = dir.path().join("Imported.shift");
    workspace
        .save_as_document(&path, dir.path().join("recovery.sqlite"))
        .unwrap();

    assert!(!workspace.is_dirty().unwrap());
    assert_eq!(workspace.scene_state().unwrap(), Some(scene("canvas")));
}
