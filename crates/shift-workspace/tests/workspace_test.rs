use std::{fs, path::PathBuf};

use shift_font::{
    Axis, AxisId, FontChange, FontIntent, FontIntentSet, GlyphId, LayerId, Location,
    error::CoreError,
};
use shift_source::ShiftSourcePackage;
use shift_workspace::{
    FontWorkspace, NewWorkspace, RecoverySelection, SourceMatchKind, WorkspaceError,
    WorkspaceRecoveryCandidate, WorkspaceSource,
};

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

#[test]
fn save_and_save_as_write_the_live_font_to_the_source_package() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let save_path = temp.path().join("SavedFont.shift");

    let mut workspace =
        FontWorkspace::create_untitled(&store_path, NewWorkspace::with_family_name("Saved Font"))
            .unwrap();
    create_glyph(&mut workspace, "A", vec![65]);

    workspace.save_as(&save_path).unwrap();

    let saved = ShiftSourcePackage::load_font(&save_path).unwrap();
    assert_eq!(saved.metadata().family_name.as_deref(), Some("Saved Font"));
    assert!(saved.glyph_id_by_name("A").is_some());

    create_glyph(&mut workspace, "B", vec![66]);
    workspace.save().unwrap();

    let saved = ShiftSourcePackage::load_font(&save_path).unwrap();
    assert!(saved.glyph_id_by_name("A").is_some());
    assert!(saved.glyph_id_by_name("B").is_some());
}

#[test]
fn resume_rebuilds_dirty_untitled_workspace_from_store() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");

    {
        let mut workspace =
            FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
        create_glyph(&mut workspace, "A", vec![65]);
        assert!(workspace.is_dirty().unwrap());
    }

    let workspace = FontWorkspace::resume(&store_path).unwrap();

    assert_eq!(workspace.source(), &WorkspaceSource::Untitled);
    assert!(workspace.is_dirty().unwrap());
    assert!(workspace.font().glyph_id_by_name("A").is_some());
}

#[test]
fn resume_package_workspace_can_save_unsaved_store_state() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let save_path = temp.path().join("SavedFont.shift");

    {
        let mut workspace =
            FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
        create_glyph(&mut workspace, "A", vec![65]);
        workspace.save_as(&save_path).unwrap();
        create_glyph(&mut workspace, "B", vec![66]);
        assert!(workspace.is_dirty().unwrap());
    }

    let mut workspace = FontWorkspace::resume(&store_path).unwrap();
    assert_eq!(workspace.save_target(), Some(save_path.as_path()));
    assert!(workspace.font().glyph_id_by_name("B").is_some());

    workspace.save().unwrap();

    let saved = ShiftSourcePackage::load_font(&save_path).unwrap();
    assert!(saved.glyph_id_by_name("A").is_some());
    assert!(saved.glyph_id_by_name("B").is_some());
    assert!(!workspace.is_dirty().unwrap());
}

#[test]
fn save_rejects_missing_package_target_without_recreating_it() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let save_path = temp.path().join("SavedFont.shift");

    let mut workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
    workspace.save_as(&save_path).unwrap();
    fs::remove_file(&save_path).unwrap();

    let error = workspace.save().unwrap_err();

    assert!(matches!(error, WorkspaceError::SourceMissing(path) if path == save_path));
    assert!(!save_path.exists());
}

#[test]
fn save_rejects_package_target_replaced_by_another_file() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let save_path = temp.path().join("SavedFont.shift");

    let mut workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
    workspace.save_as(&save_path).unwrap();
    ShiftSourcePackage::save_font(&save_path, &shift_font::Font::new()).unwrap();

    let error = workspace.save().unwrap_err();

    assert!(matches!(error, WorkspaceError::SourceIdentityConflict(path) if path == save_path));
}

#[test]
fn moved_package_open_can_recover_dirty_workspace_by_file_identity() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let save_path = temp.path().join("SavedFont.shift");
    let moved_path = temp.path().join("MovedFont.shift");

    {
        let mut workspace =
            FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
        workspace.save_as(&save_path).unwrap();
        create_glyph(&mut workspace, "B", vec![66]);
    }
    fs::rename(&save_path, &moved_path).unwrap();

    let RecoverySelection::One(recovery) = FontWorkspace::find_recoverable_package_workspace(
        &moved_path,
        &[WorkspaceRecoveryCandidate {
            document_id: "doc-1".to_string(),
            store_path: store_path.clone(),
        }],
    )
    .unwrap() else {
        panic!("renamed source should match retained dirty store");
    };

    assert_eq!(recovery.document_id, "doc-1");
    assert_eq!(recovery.match_kind, SourceMatchKind::SameFileMoved);

    let mut workspace = FontWorkspace::resume_for_source(&store_path, &moved_path).unwrap();
    assert_eq!(workspace.save_target(), Some(moved_path.as_path()));
    assert!(workspace.font().glyph_id_by_name("B").is_some());

    workspace.save().unwrap();

    let saved = ShiftSourcePackage::load_font(&moved_path).unwrap();
    assert!(saved.glyph_id_by_name("B").is_some());
}

#[test]
fn copied_then_deleted_package_can_recover_dirty_workspace_by_fingerprint() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let save_path = temp.path().join("SavedFont.shift");
    let moved_path = temp.path().join("MovedFont.shift");

    {
        let mut workspace =
            FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
        workspace.save_as(&save_path).unwrap();
        create_glyph(&mut workspace, "B", vec![66]);
    }
    fs::copy(&save_path, &moved_path).unwrap();
    fs::remove_file(&save_path).unwrap();

    let RecoverySelection::One(recovery) = FontWorkspace::find_recoverable_package_workspace(
        &moved_path,
        &[WorkspaceRecoveryCandidate {
            document_id: "doc-1".to_string(),
            store_path,
        }],
    )
    .unwrap() else {
        panic!("moved source with new file identity should match by fingerprint");
    };

    assert_eq!(recovery.document_id, "doc-1");
    assert_eq!(recovery.match_kind, SourceMatchKind::PossiblePackageMove);
}

#[test]
fn copied_package_does_not_recover_original_dirty_workspace_while_original_exists() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let save_path = temp.path().join("SavedFont.shift");
    let copy_path = temp.path().join("CopyFont.shift");

    {
        let mut workspace =
            FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
        workspace.save_as(&save_path).unwrap();
        create_glyph(&mut workspace, "B", vec![66]);
    }
    fs::copy(&save_path, &copy_path).unwrap();

    let recovery = FontWorkspace::find_recoverable_package_workspace(
        &copy_path,
        &[WorkspaceRecoveryCandidate {
            document_id: "doc-1".to_string(),
            store_path,
        }],
    )
    .unwrap();

    assert_eq!(recovery, RecoverySelection::None);
}

#[test]
fn clean_package_workspace_is_not_recovered_after_source_file_changes() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let save_path = temp.path().join("SavedFont.shift");
    let replacement_path = temp.path().join("Replacement.shift");

    {
        let mut workspace =
            FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
        workspace.save_as(&save_path).unwrap();
        assert!(!workspace.is_dirty().unwrap());
    }
    let mut replacement = shift_font::Font::new();
    replacement.metadata_mut().family_name = Some("Replacement".to_string());
    ShiftSourcePackage::save_font(&replacement_path, &replacement).unwrap();
    fs::copy(&replacement_path, &save_path).unwrap();

    let recovery = FontWorkspace::find_recoverable_package_workspace(
        &save_path,
        &[WorkspaceRecoveryCandidate {
            document_id: "doc-1".to_string(),
            store_path,
        }],
    )
    .unwrap();

    assert_eq!(recovery, RecoverySelection::None);
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

    let axis_id = AxisId::from_raw("axis_weight");
    let mut location = Location::new();
    location.set(axis_id.clone(), 700.0);
    workspace
        .apply(
            FontIntentSet {
                intents: vec![
                    FontIntent::CreateAxis {
                        axis: Axis::with_id(
                            axis_id,
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
