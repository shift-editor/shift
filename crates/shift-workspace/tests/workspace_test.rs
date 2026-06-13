use std::path::PathBuf;

use shift_font::{
    Axis, FontChange, FontIntent, FontIntentSet, GlyphId, LayerId, Location, error::CoreError,
};
use shift_workspace::{FontWorkspace, NewWorkspace, WorkspaceError, WorkspaceSource};

fn create_glyph_intent(name: &str, unicodes: Vec<u32>) -> FontIntent {
    FontIntent::CreateGlyph {
        glyph_id: None,
        name: name.to_string(),
        unicodes,
    }
}

fn create_glyph(workspace: &mut FontWorkspace, name: &str, unicodes: Vec<u32>) -> GlyphId {
    workspace
        .apply(
            FontIntentSet {
                intents: vec![create_glyph_intent(name, unicodes)],
            },
            None,
        )
        .unwrap();

    workspace.font().glyph_id_by_name(name).unwrap()
}

#[test]
fn creates_untitled_workspace_with_working_store_only() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");

    let workspace =
        FontWorkspace::create_untitled(&store_path, NewWorkspace::with_family_name("Test Font"))
            .unwrap();

    assert_eq!(workspace.source(), &WorkspaceSource::Untitled);
    assert_eq!(workspace.save_target(), None);
    assert!(store_path.is_file());
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
fn creates_package_workspace_with_source_package_and_working_store() {
    let temp = tempfile::tempdir().unwrap();
    let source_path = temp.path().join("TestFont.shift");
    let store_path = temp.path().join("working.sqlite");

    let workspace = FontWorkspace::create_package(
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
    assert!(source_path.is_file());
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

    FontWorkspace::create_package(&source_path, &store_path, NewWorkspace::new()).unwrap();

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
fn save_requires_save_as_for_untitled_workspaces() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");

    let mut workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();

    let error = workspace.save().unwrap_err();

    assert!(matches!(error, WorkspaceError::NeedsSaveAs));
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
    assert!(save_path.is_file());
    workspace.save().unwrap();
}

fn set_x_advance_intents(layer_id: LayerId, width: f64) -> FontIntentSet {
    FontIntentSet {
        intents: vec![FontIntent::SetXAdvance { layer_id, width }],
    }
}

#[test]
fn apply_set_x_advance_updates_existing_layer() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let mut workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
    let source_id = workspace.font().default_source_id().unwrap();
    let glyph_id = create_glyph(&mut workspace, "A", vec![65]);
    let layer_id = workspace
        .font()
        .layer_id_for_glyph_source(glyph_id, source_id)
        .unwrap();

    let outcome = workspace
        .apply(set_x_advance_intents(layer_id.clone(), 640.0), None)
        .unwrap();

    assert_eq!(outcome.layers[0].layer.width(), 640.0);
    assert_eq!(workspace.font().layer(layer_id).unwrap().width(), 640.0);
}

#[test]
fn create_glyph_undo_redo_removes_and_restores_glyph_with_layers() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let mut workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
    let source_count = workspace.font().sources().len();

    let applied = workspace
        .apply(
            FontIntentSet {
                intents: vec![create_glyph_intent("A", vec![65])],
            },
            Some("Add Glyph".to_string()),
        )
        .unwrap();
    let glyph_id = workspace.font().glyph_id_by_name("A").unwrap();

    assert_eq!(workspace.font().glyph_count(), 1);
    assert_eq!(applied.layers.len(), source_count);

    let undone = workspace.undo().unwrap().expect("createGlyph should undo");
    assert_eq!(workspace.font().glyph_count(), 0);
    assert!(undone.changes.changes.iter().any(
        |change| matches!(change, FontChange::GlyphDeleted(change) if change.glyph_id == glyph_id)
    ));

    let redone = workspace.redo().unwrap().expect("createGlyph should redo");
    assert_eq!(workspace.font().glyph_count(), 1);
    assert_eq!(redone.layers.len(), source_count);
    assert!(workspace.font().glyph(glyph_id).is_some());
}

#[test]
fn batched_create_glyphs_undo_as_one_step() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let mut workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();

    workspace
        .apply(
            FontIntentSet {
                intents: vec![
                    create_glyph_intent("A", vec![65]),
                    create_glyph_intent("B", vec![66]),
                    create_glyph_intent("C", vec![67]),
                ],
            },
            Some("Add Glyphs".to_string()),
        )
        .unwrap();
    assert_eq!(workspace.font().glyph_count(), 3);

    workspace.undo().unwrap().expect("batch should undo");
    assert_eq!(workspace.font().glyph_count(), 0);
    assert!(workspace.undo().unwrap().is_none());

    workspace.redo().unwrap().expect("batch should redo");
    assert_eq!(workspace.font().glyph_count(), 3);
    assert!(workspace.font().glyph_id_by_name("B").is_some());
}

#[test]
fn mixed_font_level_batch_undoes_axis_source_and_glyph_together() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let mut workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
    create_glyph(&mut workspace, "A", vec![65]);
    let base_sources = workspace.font().sources().len();

    let mut location = Location::new();
    location.set("wght".to_string(), 700.0);
    workspace
        .apply(
            FontIntentSet {
                intents: vec![
                    FontIntent::CreateAxis {
                        axis: Axis::new(
                            "wght".to_string(),
                            "Weight".to_string(),
                            100.0,
                            400.0,
                            900.0,
                        ),
                    },
                    FontIntent::CreateSource {
                        name: "Bold".to_string(),
                        location,
                    },
                    create_glyph_intent("B", vec![66]),
                ],
            },
            Some("Add Weight".to_string()),
        )
        .unwrap();

    assert_eq!(workspace.font().axes().len(), 1);
    assert_eq!(workspace.font().sources().len(), base_sources + 1);
    assert_eq!(workspace.font().glyph_count(), 2);
    // The pre-existing glyph gained an eager layer; the new glyph has one
    // layer per source.
    let glyph_a = workspace.font().glyph_by_name("A").unwrap();
    assert_eq!(glyph_a.layers().len(), base_sources + 1);
    let glyph_b = workspace.font().glyph_by_name("B").unwrap();
    assert_eq!(glyph_b.layers().len(), base_sources + 1);

    workspace.undo().unwrap().expect("batch should undo");
    assert_eq!(workspace.font().axes().len(), 0);
    assert_eq!(workspace.font().sources().len(), base_sources);
    assert_eq!(workspace.font().glyph_count(), 1);
    let glyph_a = workspace.font().glyph_by_name("A").unwrap();
    assert_eq!(glyph_a.layers().len(), base_sources);

    workspace.redo().unwrap().expect("batch should redo");
    assert_eq!(workspace.font().axes().len(), 1);
    assert_eq!(workspace.font().sources().len(), base_sources + 1);
    assert_eq!(workspace.font().glyph_count(), 2);
    let glyph_a = workspace.font().glyph_by_name("A").unwrap();
    assert_eq!(glyph_a.layers().len(), base_sources + 1);
}

#[test]
fn apply_set_x_advance_rejects_missing_layer() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let mut workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
    let layer_id = LayerId::new();

    let error = match workspace.apply(set_x_advance_intents(layer_id.clone(), 640.0), None) {
        Ok(_) => panic!("apply should reject a missing layer id"),
        Err(error) => error,
    };

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
