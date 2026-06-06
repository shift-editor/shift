use std::path::PathBuf;

use shift_font::{LayerId, error::CoreError};
use shift_workspace::{FontWorkspace, NewWorkspace, WorkspaceError, WorkspaceSource};

#[test]
fn creates_workspace_with_source_package_and_working_store() {
    let temp = tempfile::tempdir().unwrap();
    let source_path = temp.path().join("TestFont.shift");
    let store_path = temp.path().join("working.sqlite");

    let workspace = FontWorkspace::create(
        &source_path,
        &store_path,
        NewWorkspace::with_family_name("Test Font"),
    )
    .unwrap();

    assert_eq!(
        workspace.source(),
        &WorkspaceSource::Package {
            path: source_path.clone()
        }
    );
    assert_eq!(workspace.save_target(), Some(source_path.as_path()));
    assert!(source_path.join("manifest.json").is_file());
    assert_eq!(
        workspace
            .font_info()
            .unwrap()
            .unwrap()
            .family_name
            .as_deref(),
        Some("Test Font")
    );
    assert_eq!(workspace.font().glyph_count(), 0);
}

#[test]
fn opens_existing_workspace_paths() {
    let temp = tempfile::tempdir().unwrap();
    let source_path = temp.path().join("TestFont.shift");
    let store_path = temp.path().join("working.sqlite");

    FontWorkspace::create(&source_path, &store_path, NewWorkspace::new()).unwrap();

    let workspace = FontWorkspace::open(&source_path, &store_path).unwrap();

    assert_eq!(workspace.save_target(), Some(source_path.as_path()));
    assert!(workspace.font_info().unwrap().is_some());
}

#[test]
fn imports_external_fonts_without_a_save_target() {
    let temp = tempfile::tempdir().unwrap();
    let source_path = fixture("fixtures/fonts/mutatorsans-variable/MutatorSans.designspace");
    let store_path = temp.path().join("working.sqlite");

    let workspace = FontWorkspace::open(&source_path, &store_path).unwrap();

    assert_eq!(
        workspace.source(),
        &WorkspaceSource::Imported {
            original_path: source_path
        }
    );
    assert_eq!(workspace.save_target(), None);
    assert!(workspace.font().glyph_count() > 0);
    assert!(
        workspace
            .font_info()
            .unwrap()
            .unwrap()
            .family_name
            .is_some()
    );
}

#[test]
fn save_requires_save_as_for_imported_fonts() {
    let temp = tempfile::tempdir().unwrap();
    let source_path = fixture("fixtures/fonts/mutatorsans-variable/MutatorSans.designspace");
    let store_path = temp.path().join("working.sqlite");

    let mut workspace = FontWorkspace::open(&source_path, &store_path).unwrap();

    let error = workspace.save().unwrap_err();

    assert!(matches!(error, WorkspaceError::NeedsSaveAs));
}

#[test]
fn save_as_assigns_a_shift_package_save_target() {
    let temp = tempfile::tempdir().unwrap();
    let source_path = fixture("fixtures/fonts/mutatorsans-variable/MutatorSans.designspace");
    let store_path = temp.path().join("working.sqlite");
    let save_path = temp.path().join("SavedFont.shift");

    let mut workspace = FontWorkspace::open(&source_path, &store_path).unwrap();
    workspace.save_as(&save_path).unwrap();

    assert_eq!(
        workspace.source(),
        &WorkspaceSource::Package {
            path: save_path.clone()
        }
    );
    assert_eq!(workspace.save_target(), Some(save_path.as_path()));
    assert!(save_path.join("manifest.json").is_file());
    workspace.save().unwrap();
}

#[test]
fn set_x_advance_updates_existing_layer() {
    let temp = tempfile::tempdir().unwrap();
    let source_path = temp.path().join("TestFont.shift");
    let store_path = temp.path().join("working.sqlite");
    let mut workspace =
        FontWorkspace::create(&source_path, &store_path, NewWorkspace::new()).unwrap();
    let source_id = workspace.font().default_source_id().unwrap();
    let glyph = workspace.create_glyph("A".to_string(), vec![65]).unwrap();
    let layer = workspace.create_glyph_layer(glyph.id(), source_id).unwrap();
    let layer_id = layer.id();

    let edited_layer = workspace.set_x_advance(layer_id, 640.0).unwrap();

    assert_eq!(edited_layer.width(), 640.0);
    assert_eq!(workspace.font().layer(layer_id).unwrap().width(), 640.0);
}

#[test]
fn set_x_advance_rejects_missing_layer() {
    let temp = tempfile::tempdir().unwrap();
    let source_path = temp.path().join("TestFont.shift");
    let store_path = temp.path().join("working.sqlite");
    let mut workspace =
        FontWorkspace::create(&source_path, &store_path, NewWorkspace::new()).unwrap();
    let layer_id = LayerId::new();

    let error = workspace.set_x_advance(layer_id, 640.0).unwrap_err();

    assert!(matches!(
        error,
        WorkspaceError::Font(CoreError::LayerNotFound(missing_layer_id))
            if missing_layer_id == layer_id
    ));
    assert_eq!(workspace.font().glyph_count(), 0);
}

fn fixture(path: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(path)
}
