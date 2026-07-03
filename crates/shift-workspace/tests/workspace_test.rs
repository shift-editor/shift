use std::{fs, path::PathBuf};

use shift_font::{
    AnchorId, AnchorSeed, AppliedIntents, Axis, AxisId, BooleanOp, ContourId, FontChange,
    FontIntent, FontIntentSet, GlyphId, GlyphName, LayerId, LibValue, Location, PointId, PointSeed,
    PointType, SourceId, error::CoreError, test_support::sample_font,
};
use shift_source::ShiftSourcePackage;
use shift_workspace::{
    FontWorkspace, NewWorkspace, RecoverySelection, SourceMatchKind, WorkspaceError,
    WorkspaceRecoveryCandidate, WorkspaceSource,
};

/// Reloads the font from the draft store and asserts it equals the
/// in-memory workspace font.
///
/// Apply and replay persist through the same change-set seam, so any field
/// a replay drops, wipes, or misorders shows up here — `Font` equality
/// covers every persisted field (index caches excluded). Route every
/// undo/redo in intent tests through [`undo_and_verify`] /
/// [`redo_and_verify`] so new intents inherit the store == memory
/// invariant.
fn assert_store_matches_font(workspace: &FontWorkspace) {
    let store_font = workspace.store().load_font_state().unwrap();
    assert_eq!(
        &store_font,
        workspace.font(),
        "draft store diverged from the in-memory font"
    );
}

fn undo_and_verify(workspace: &mut FontWorkspace, expectation: &str) -> AppliedIntents {
    let outcome = workspace.undo().unwrap().expect(expectation);
    assert_store_matches_font(workspace);
    outcome
}

fn redo_and_verify(workspace: &mut FontWorkspace, expectation: &str) -> AppliedIntents {
    let outcome = workspace.redo().unwrap().expect(expectation);
    assert_store_matches_font(workspace);
    outcome
}

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

fn create_glyph_layer(
    workspace: &mut FontWorkspace,
    glyph_id: GlyphId,
    source_id: SourceId,
) -> LayerId {
    let layer_id = LayerId::new();
    workspace
        .apply(
            FontIntentSet {
                intents: vec![FontIntent::CreateGlyphLayer {
                    layer_id: layer_id.clone(),
                    glyph_id,
                    source_id,
                }],
            },
            None,
        )
        .unwrap();
    layer_id
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
    let layer_id = create_glyph_layer(&mut workspace, glyph_id, source_id);

    let outcome = workspace
        .apply(set_x_advance_intents(layer_id.clone(), 640.0), None)
        .unwrap();

    assert_eq!(outcome.layers[0].layer.width(), 640.0);
    assert_eq!(workspace.font().layer(layer_id).unwrap().width(), 640.0);
}

#[test]
fn create_glyph_undo_redo_removes_and_restores_glyph_identity() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let mut workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
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
    assert!(applied.layers.is_empty());
    assert!(
        workspace
            .font()
            .glyph(glyph_id.clone())
            .unwrap()
            .layers()
            .is_empty()
    );

    let undone = undo_and_verify(&mut workspace, "createGlyph should undo");
    assert_eq!(workspace.font().glyph_count(), 0);
    assert!(undone.changes.changes.iter().any(
        |change| matches!(change, FontChange::GlyphDeleted(change) if change.glyph_id == glyph_id)
    ));

    let redone = redo_and_verify(&mut workspace, "createGlyph should redo");
    assert_eq!(workspace.font().glyph_count(), 1);
    assert!(redone.layers.is_empty());
    assert!(workspace.font().glyph(glyph_id).is_some());
}

#[test]
fn create_glyph_layer_undo_redo_removes_and_restores_sparse_layer() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let mut workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
    let source_id = workspace.font().default_source_id().unwrap();
    let glyph_id = create_glyph(&mut workspace, "A", vec![65]);
    let layer_id = LayerId::new();

    let applied = workspace
        .apply(
            FontIntentSet {
                intents: vec![FontIntent::CreateGlyphLayer {
                    layer_id: layer_id.clone(),
                    glyph_id: glyph_id.clone(),
                    source_id: source_id.clone(),
                }],
            },
            Some("Create Layer".to_string()),
        )
        .unwrap();

    assert_eq!(applied.layers.len(), 1);
    assert_eq!(
        workspace
            .font()
            .layer_id_for_glyph_source(glyph_id.clone(), source_id.clone()),
        Some(layer_id.clone())
    );

    let undone = undo_and_verify(&mut workspace, "createGlyphLayer should undo");
    assert!(undone.changes.changes.iter().any(
        |change| matches!(change, FontChange::GlyphLayerDeleted(change) if change.layer_id == layer_id)
    ));
    assert_eq!(
        workspace
            .font()
            .layer_id_for_glyph_source(glyph_id.clone(), source_id.clone()),
        None
    );

    let redone = redo_and_verify(&mut workspace, "createGlyphLayer should redo");
    assert_eq!(redone.layers.len(), 1);
    assert_eq!(
        workspace
            .font()
            .layer_id_for_glyph_source(glyph_id, source_id),
        Some(layer_id)
    );
}

#[test]
fn create_glyph_layer_initializes_width_from_font_upm() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let mut new_workspace = NewWorkspace::new();
    new_workspace.units_per_em = 2048;
    let mut workspace = FontWorkspace::create_untitled(&store_path, new_workspace).unwrap();
    let source_id = workspace.font().default_source_id().unwrap();
    let glyph_id = create_glyph(&mut workspace, "A", vec![65]);

    let layer_id = create_glyph_layer(&mut workspace, glyph_id, source_id);

    assert_eq!(workspace.font().layer(layer_id).unwrap().width(), 1024.0);
}

#[test]
fn delete_source_undo_redo_removes_and_restores_existing_sparse_layers() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let mut workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
    let glyph_a = create_glyph(&mut workspace, "A", vec![65]);
    let glyph_b = create_glyph(&mut workspace, "B", vec![66]);
    let source_id = SourceId::from_raw("source_alt");

    workspace
        .apply(
            FontIntentSet {
                intents: vec![FontIntent::CreateSource {
                    source_id: source_id.clone(),
                    name: "Alt".to_string(),
                    location: Location::new(),
                }],
            },
            Some("Create Source".to_string()),
        )
        .unwrap();
    let layer_id = create_glyph_layer(&mut workspace, glyph_a.clone(), source_id.clone());
    workspace
        .apply(set_x_advance_intents(layer_id.clone(), 640.0), None)
        .unwrap();
    assert_eq!(
        workspace
            .font()
            .layer_id_for_glyph_source(glyph_b.clone(), source_id.clone()),
        None
    );

    workspace
        .apply(
            FontIntentSet {
                intents: vec![FontIntent::DeleteSource {
                    source_id: source_id.clone(),
                }],
            },
            Some("Delete Source".to_string()),
        )
        .unwrap();

    assert!(
        workspace
            .font()
            .sources()
            .iter()
            .all(|source| source.id() != source_id)
    );
    assert!(workspace.font().layer(layer_id.clone()).is_none());

    let undone = undo_and_verify(&mut workspace, "deleteSource should undo");
    assert!(undone
        .changes
        .changes
        .iter()
        .any(|change| matches!(change, FontChange::SourceCreated(change) if change.source_id == source_id)));
    assert!(
        workspace
            .font()
            .sources()
            .iter()
            .any(|source| source.id() == source_id)
    );
    assert_eq!(
        workspace.font().layer(layer_id.clone()).unwrap().width(),
        640.0
    );
    assert_eq!(
        workspace
            .font()
            .layer_id_for_glyph_source(glyph_b, source_id.clone()),
        None
    );

    let redone = redo_and_verify(&mut workspace, "deleteSource should redo");
    assert!(redone
        .changes
        .changes
        .iter()
        .any(|change| matches!(change, FontChange::GlyphLayerDeleted(change) if change.layer_id == layer_id)));
    assert!(
        workspace
            .font()
            .sources()
            .iter()
            .all(|source| source.id() != source_id)
    );
    assert!(workspace.font().layer(layer_id).is_none());
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

    undo_and_verify(&mut workspace, "batch should undo");
    assert_eq!(workspace.font().glyph_count(), 0);
    assert!(workspace.undo().unwrap().is_none());

    redo_and_verify(&mut workspace, "batch should redo");
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
                        source_id: SourceId::from_raw("bold"),
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
    let glyph_a = workspace.font().glyph_by_name("A").unwrap();
    assert_eq!(glyph_a.layers().len(), 0);
    let glyph_b = workspace.font().glyph_by_name("B").unwrap();
    assert_eq!(glyph_b.layers().len(), 0);

    undo_and_verify(&mut workspace, "batch should undo");
    assert_eq!(workspace.font().axes().len(), 0);
    assert_eq!(workspace.font().sources().len(), base_sources);
    assert_eq!(workspace.font().glyph_count(), 1);
    let glyph_a = workspace.font().glyph_by_name("A").unwrap();
    assert_eq!(glyph_a.layers().len(), 0);

    redo_and_verify(&mut workspace, "batch should redo");
    assert_eq!(workspace.font().axes().len(), 1);
    assert_eq!(workspace.font().sources().len(), base_sources + 1);
    assert_eq!(workspace.font().glyph_count(), 2);
    let glyph_a = workspace.font().glyph_by_name("A").unwrap();
    assert_eq!(glyph_a.layers().len(), 0);
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

fn workspace_with_layer() -> (tempfile::TempDir, FontWorkspace, LayerId) {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let mut workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
    let source_id = workspace.font().default_source_id().unwrap();
    let glyph_id = create_glyph(&mut workspace, "A", vec![65]);
    let layer_id = create_glyph_layer(&mut workspace, glyph_id, source_id);

    (temp, workspace, layer_id)
}

fn add_square_contour(
    workspace: &mut FontWorkspace,
    layer_id: &LayerId,
    origin: (f64, f64),
    size: f64,
) -> (ContourId, Vec<PointId>) {
    let contour_id = ContourId::new();
    let point_ids: Vec<PointId> = (0..4).map(|_| PointId::new()).collect();
    let (x, y) = origin;
    let corners = [(x, y), (x + size, y), (x + size, y + size), (x, y + size)];
    let points = point_ids
        .iter()
        .zip(corners)
        .map(|(id, (px, py))| PointSeed {
            id: id.clone(),
            x: px,
            y: py,
            point_type: PointType::OnCurve,
            smooth: false,
        })
        .collect();

    workspace
        .apply(
            FontIntentSet {
                intents: vec![
                    FontIntent::AddContour {
                        layer_id: layer_id.clone(),
                        contour_id: contour_id.clone(),
                        closed: true,
                    },
                    FontIntent::AddPoints {
                        layer_id: layer_id.clone(),
                        contour_id: Some(contour_id.clone()),
                        before: None,
                        points,
                    },
                ],
            },
            None,
        )
        .unwrap();

    (contour_id, point_ids)
}

fn add_anchor(workspace: &mut FontWorkspace, layer_id: &LayerId) -> AnchorId {
    let anchor_id = AnchorId::new();
    workspace
        .apply(
            FontIntentSet {
                intents: vec![FontIntent::AddAnchors {
                    layer_id: layer_id.clone(),
                    anchors: vec![AnchorSeed {
                        id: anchor_id.clone(),
                        name: Some("top".to_string()),
                        x: 100.0,
                        y: 700.0,
                    }],
                }],
            },
            None,
        )
        .unwrap();

    anchor_id
}

/// Applies the intents to the layer, then verifies undo restores the exact
/// pre-apply layer and redo restores the exact post-apply layer.
fn assert_layer_undo_redo(
    workspace: &mut FontWorkspace,
    layer_id: &LayerId,
    intents: Vec<FontIntent>,
) {
    let pre = workspace.font().layer(layer_id.clone()).unwrap().clone();
    workspace.apply(FontIntentSet { intents }, None).unwrap();
    let post = workspace.font().layer(layer_id.clone()).unwrap().clone();
    assert_ne!(pre, post, "intent should change the layer");

    undo_and_verify(workspace, "intent should undo");
    assert_eq!(workspace.font().layer(layer_id.clone()).unwrap(), &pre);

    redo_and_verify(workspace, "intent should redo");
    assert_eq!(workspace.font().layer(layer_id.clone()).unwrap(), &post);
}

#[test]
fn add_contour_undo_redo_restores_layer() {
    let (_temp, mut workspace, layer_id) = workspace_with_layer();

    assert_layer_undo_redo(
        &mut workspace,
        &layer_id,
        vec![FontIntent::AddContour {
            layer_id: layer_id.clone(),
            contour_id: ContourId::new(),
            closed: true,
        }],
    );
}

#[test]
fn add_points_undo_redo_restores_layer() {
    let (_temp, mut workspace, layer_id) = workspace_with_layer();
    let contour_id = ContourId::new();
    workspace
        .apply(
            FontIntentSet {
                intents: vec![FontIntent::AddContour {
                    layer_id: layer_id.clone(),
                    contour_id: contour_id.clone(),
                    closed: false,
                }],
            },
            None,
        )
        .unwrap();

    assert_layer_undo_redo(
        &mut workspace,
        &layer_id,
        vec![FontIntent::AddPoints {
            layer_id: layer_id.clone(),
            contour_id: Some(contour_id),
            before: None,
            points: vec![PointSeed {
                id: PointId::new(),
                x: 10.0,
                y: 20.0,
                point_type: PointType::OnCurve,
                smooth: false,
            }],
        }],
    );
}

#[test]
fn set_contour_closed_undo_redo_restores_layer() {
    let (_temp, mut workspace, layer_id) = workspace_with_layer();
    let (contour_id, _) = add_square_contour(&mut workspace, &layer_id, (0.0, 0.0), 100.0);

    assert_layer_undo_redo(
        &mut workspace,
        &layer_id,
        vec![FontIntent::SetContourClosed {
            layer_id: layer_id.clone(),
            contour_id,
            closed: false,
        }],
    );
}

#[test]
fn move_points_undo_redo_restores_layer() {
    let (_temp, mut workspace, layer_id) = workspace_with_layer();
    let (_, point_ids) = add_square_contour(&mut workspace, &layer_id, (0.0, 0.0), 100.0);

    assert_layer_undo_redo(
        &mut workspace,
        &layer_id,
        vec![FontIntent::MovePoints {
            layer_id: layer_id.clone(),
            point_ids: vec![point_ids[0].clone(), point_ids[1].clone()],
            coords: vec![5.0, 6.0, 105.0, 6.0],
        }],
    );
}

#[test]
fn set_point_smooth_undo_redo_restores_layer() {
    let (_temp, mut workspace, layer_id) = workspace_with_layer();
    let (_, point_ids) = add_square_contour(&mut workspace, &layer_id, (0.0, 0.0), 100.0);

    assert_layer_undo_redo(
        &mut workspace,
        &layer_id,
        vec![FontIntent::SetPointSmooth {
            layer_id: layer_id.clone(),
            point_id: point_ids[0].clone(),
            smooth: true,
        }],
    );
}

#[test]
fn remove_points_undo_redo_restores_layer() {
    let (_temp, mut workspace, layer_id) = workspace_with_layer();
    let (_, point_ids) = add_square_contour(&mut workspace, &layer_id, (0.0, 0.0), 100.0);

    assert_layer_undo_redo(
        &mut workspace,
        &layer_id,
        vec![FontIntent::RemovePoints {
            layer_id: layer_id.clone(),
            point_ids: vec![point_ids[0].clone()],
        }],
    );
}

#[test]
fn add_anchors_undo_redo_restores_layer() {
    let (_temp, mut workspace, layer_id) = workspace_with_layer();

    assert_layer_undo_redo(
        &mut workspace,
        &layer_id,
        vec![FontIntent::AddAnchors {
            layer_id: layer_id.clone(),
            anchors: vec![AnchorSeed {
                id: AnchorId::new(),
                name: Some("top".to_string()),
                x: 100.0,
                y: 700.0,
            }],
        }],
    );
}

#[test]
fn move_anchors_undo_redo_restores_layer() {
    let (_temp, mut workspace, layer_id) = workspace_with_layer();
    let anchor_id = add_anchor(&mut workspace, &layer_id);

    assert_layer_undo_redo(
        &mut workspace,
        &layer_id,
        vec![FontIntent::MoveAnchors {
            layer_id: layer_id.clone(),
            anchor_ids: vec![anchor_id],
            coords: vec![150.0, 720.0],
        }],
    );
}

#[test]
fn remove_anchors_undo_redo_restores_layer() {
    let (_temp, mut workspace, layer_id) = workspace_with_layer();
    let anchor_id = add_anchor(&mut workspace, &layer_id);

    assert_layer_undo_redo(
        &mut workspace,
        &layer_id,
        vec![FontIntent::RemoveAnchors {
            layer_id: layer_id.clone(),
            anchor_ids: vec![anchor_id],
        }],
    );
}

#[test]
fn reverse_contour_undo_redo_restores_layer() {
    let (_temp, mut workspace, layer_id) = workspace_with_layer();
    let (contour_id, _) = add_square_contour(&mut workspace, &layer_id, (0.0, 0.0), 100.0);

    assert_layer_undo_redo(
        &mut workspace,
        &layer_id,
        vec![FontIntent::ReverseContour {
            layer_id: layer_id.clone(),
            contour_id,
        }],
    );
}

#[test]
fn translate_points_undo_redo_restores_layer() {
    let (_temp, mut workspace, layer_id) = workspace_with_layer();
    let (_, point_ids) = add_square_contour(&mut workspace, &layer_id, (0.0, 0.0), 100.0);

    assert_layer_undo_redo(
        &mut workspace,
        &layer_id,
        vec![FontIntent::TranslatePoints {
            layer_id: layer_id.clone(),
            point_ids,
            dx: 10.0,
            dy: -5.0,
        }],
    );
}

#[test]
fn set_x_advance_undo_redo_restores_layer() {
    let (_temp, mut workspace, layer_id) = workspace_with_layer();

    assert_layer_undo_redo(
        &mut workspace,
        &layer_id,
        vec![FontIntent::SetXAdvance {
            layer_id: layer_id.clone(),
            width: 640.0,
        }],
    );
}

#[test]
fn apply_boolean_op_undo_redo_restores_layer() {
    let (_temp, mut workspace, layer_id) = workspace_with_layer();
    let (contour_a, _) = add_square_contour(&mut workspace, &layer_id, (0.0, 0.0), 100.0);
    let (contour_b, _) = add_square_contour(&mut workspace, &layer_id, (50.0, 50.0), 100.0);

    assert_layer_undo_redo(
        &mut workspace,
        &layer_id,
        vec![FontIntent::ApplyBooleanOp {
            layer_id: layer_id.clone(),
            contour_id_a: contour_a,
            contour_id_b: contour_b,
            operation: BooleanOp::Union,
        }],
    );
}

#[test]
fn update_glyph_undo_redo_restores_old_identity() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let mut workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
    let glyph_id = create_glyph(&mut workspace, "A", vec![65]);

    workspace
        .apply(
            FontIntentSet {
                intents: vec![FontIntent::UpdateGlyph {
                    glyph_id: glyph_id.clone(),
                    new_name: GlyphName::new("A.alt").unwrap(),
                    new_unicodes: vec![97],
                }],
            },
            Some("Rename Glyph".to_string()),
        )
        .unwrap();

    let glyph = workspace.font().glyph(glyph_id.clone()).unwrap();
    assert_eq!(glyph.glyph_name().to_string(), "A.alt");
    assert_eq!(glyph.unicodes(), &[97]);

    let undone = undo_and_verify(&mut workspace, "updateGlyph should undo");
    assert!(undone.changes.changes.iter().any(|change| matches!(
        change,
        FontChange::GlyphIdentityChanged(change) if change.glyph_id == glyph_id
    )));
    let glyph = workspace.font().glyph(glyph_id.clone()).unwrap();
    assert_eq!(glyph.glyph_name().to_string(), "A");
    assert_eq!(glyph.unicodes(), &[65]);
    assert_eq!(
        workspace.font().glyph_id_by_name("A"),
        Some(glyph_id.clone())
    );

    let redone = redo_and_verify(&mut workspace, "updateGlyph should redo");
    assert!(redone.changes.changes.iter().any(|change| matches!(
        change,
        FontChange::GlyphIdentityChanged(change) if change.glyph_id == glyph_id
    )));
    let glyph = workspace.font().glyph(glyph_id.clone()).unwrap();
    assert_eq!(glyph.glyph_name().to_string(), "A.alt");
    assert_eq!(glyph.unicodes(), &[97]);
    assert_eq!(workspace.font().glyph_id_by_name("A.alt"), Some(glyph_id));
}

fn weight_axis(axis_id: AxisId) -> Axis {
    Axis::with_id(
        axis_id,
        "wght".to_string(),
        "Weight".to_string(),
        100.0,
        400.0,
        900.0,
    )
}

#[test]
fn create_axis_undo_redo_removes_and_restores_axis() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let mut workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
    let axis_id = AxisId::from_raw("axis_weight");

    workspace
        .apply(
            FontIntentSet {
                intents: vec![FontIntent::CreateAxis {
                    axis: weight_axis(axis_id.clone()),
                }],
            },
            Some("Create Axis".to_string()),
        )
        .unwrap();
    let created = workspace.font().axes()[0].clone();

    undo_and_verify(&mut workspace, "createAxis should undo");
    assert!(workspace.font().axes().is_empty());

    redo_and_verify(&mut workspace, "createAxis should redo");
    assert_eq!(workspace.font().axes(), &[created]);
}

#[test]
fn delete_axis_undo_redo_restores_full_axis_definition() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let mut workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
    let axis_id = AxisId::from_raw("axis_weight");
    let source_id = SourceId::from_raw("bold");
    let mut location = Location::new();
    location.set(axis_id.clone(), 700.0);

    workspace
        .apply(
            FontIntentSet {
                intents: vec![
                    FontIntent::CreateAxis {
                        axis: weight_axis(axis_id.clone()),
                    },
                    FontIntent::CreateSource {
                        source_id: source_id.clone(),
                        name: "Bold".to_string(),
                        location,
                    },
                ],
            },
            None,
        )
        .unwrap();
    let axis = workspace.font().axes()[0].clone();

    workspace
        .apply(
            FontIntentSet {
                intents: vec![FontIntent::DeleteAxis {
                    axis_id: axis_id.clone(),
                }],
            },
            Some("Delete Axis".to_string()),
        )
        .unwrap();
    assert!(workspace.font().axes().is_empty());

    let undone = undo_and_verify(&mut workspace, "deleteAxis should undo");
    assert!(undone.changes.changes.iter().any(|change| matches!(
        change,
        FontChange::AxisCreated(change) if change.axis_id == axis_id
    )));
    assert_eq!(workspace.font().axes(), std::slice::from_ref(&axis));

    // Deleting the axis also stripped source location values; undo must
    // bring them back both in memory and in the store.
    let restored = workspace
        .font()
        .sources()
        .iter()
        .find(|source| source.id() == source_id)
        .unwrap();
    assert_eq!(restored.location().get(&axis_id), Some(700.0));

    let store_source_id = shift_store::SourceId::new(source_id.to_string());
    let locations = workspace
        .store()
        .get_source_locations(&store_source_id)
        .unwrap();
    assert_eq!(locations.len(), 1);
    assert_eq!(locations[0].value, 700.0);

    let redone = redo_and_verify(&mut workspace, "deleteAxis should redo");
    assert!(redone.changes.changes.iter().any(|change| matches!(
        change,
        FontChange::AxisDeleted(change) if change.axis_id == axis_id
    )));
    assert!(workspace.font().axes().is_empty());

    undo_and_verify(&mut workspace, "deleteAxis should undo again");
    assert_eq!(workspace.font().axes(), &[axis]);
}

#[test]
fn create_source_undo_redo_removes_and_restores_source() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let mut workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
    let source_id = SourceId::from_raw("bold");
    let base_sources = workspace.font().sources().len();

    workspace
        .apply(
            FontIntentSet {
                intents: vec![FontIntent::CreateSource {
                    source_id: source_id.clone(),
                    name: "Bold".to_string(),
                    location: Location::new(),
                }],
            },
            Some("Create Source".to_string()),
        )
        .unwrap();
    let created = workspace
        .font()
        .sources()
        .iter()
        .find(|source| source.id() == source_id)
        .cloned()
        .unwrap();

    undo_and_verify(&mut workspace, "createSource should undo");
    assert_eq!(workspace.font().sources().len(), base_sources);
    assert!(
        workspace
            .font()
            .sources()
            .iter()
            .all(|source| source.id() != source_id)
    );

    redo_and_verify(&mut workspace, "createSource should redo");
    assert_eq!(
        workspace
            .font()
            .sources()
            .iter()
            .find(|source| source.id() == source_id),
        Some(&created)
    );
}

#[test]
fn failed_undo_replay_hands_the_entry_back_for_retry() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let mut workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
    create_glyph(&mut workspace, "A", vec![65]);

    // Wipe the store's font rows so the undo's GlyphDeleted change has no
    // row to delete and the replay fails at the persistence step.
    workspace
        .store_mut()
        .replace_font_state(&shift_font::Font::new())
        .unwrap();

    let error = match workspace.undo() {
        Ok(_) => panic!("undo should fail when the store rejects the replay"),
        Err(error) => error,
    };
    assert!(matches!(error, WorkspaceError::Store(_)));
    assert!(workspace.font().glyph_id_by_name("A").is_some());

    // Repair the store; the handed-back entry must still be undoable.
    let font = workspace.font().clone();
    workspace.store_mut().replace_font_state(&font).unwrap();

    undo_and_verify(
        &mut workspace,
        "failed undo should hand the entry back for retry",
    );
    assert_eq!(workspace.font().glyph_count(), 0);
}

#[test]
fn failed_redo_replay_hands_the_entry_back_for_retry() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let mut workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
    let source_id = SourceId::from_raw("bold");

    workspace
        .apply(
            FontIntentSet {
                intents: vec![FontIntent::CreateSource {
                    source_id: source_id.clone(),
                    name: "Bold".to_string(),
                    location: Location::new(),
                }],
            },
            None,
        )
        .unwrap();
    workspace
        .apply(
            FontIntentSet {
                intents: vec![FontIntent::DeleteSource {
                    source_id: source_id.clone(),
                }],
            },
            None,
        )
        .unwrap();
    undo_and_verify(&mut workspace, "deleteSource should undo");

    // Wipe the store's font rows so the redo's SourceDeleted change has no
    // row to delete and the replay fails at the persistence step.
    workspace
        .store_mut()
        .replace_font_state(&shift_font::Font::new())
        .unwrap();

    let error = match workspace.redo() {
        Ok(_) => panic!("redo should fail when the store rejects the replay"),
        Err(error) => error,
    };
    assert!(matches!(error, WorkspaceError::Store(_)));
    assert!(
        workspace
            .font()
            .sources()
            .iter()
            .any(|source| source.id() == source_id)
    );

    // Repair the store; the handed-back entry must still be redoable.
    let font = workspace.font().clone();
    workspace.store_mut().replace_font_state(&font).unwrap();

    redo_and_verify(
        &mut workspace,
        "failed redo should hand the entry back for retry",
    );
    assert!(
        workspace
            .font()
            .sources()
            .iter()
            .all(|source| source.id() != source_id)
    );
}

#[test]
fn ledger_trims_oldest_entries_beyond_max() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let mut workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();

    // One entry more than the ledger's MAX_ENTRIES bound of 100.
    for index in 0..101 {
        create_glyph(&mut workspace, &format!("g{index}"), vec![]);
    }

    let mut undone = 0;
    while workspace.undo().unwrap().is_some() {
        assert_store_matches_font(&workspace);
        undone += 1;
    }

    assert_eq!(undone, 100, "oldest entry should fall off the ledger");
    assert_eq!(workspace.font().glyph_count(), 1);
    assert!(workspace.font().glyph_id_by_name("g0").is_some());
}

/// Opens a workspace over the kitchen-sink corpus, whose sources carry
/// filenames, colors, libs, and axis locations — the fields font-level
/// replays must not drop.
fn sample_package_workspace(temp: &tempfile::TempDir) -> FontWorkspace {
    let package_path = temp.path().join("Sample.shift");
    ShiftSourcePackage::save_font(&package_path, &sample_font()).unwrap();
    FontWorkspace::open(&package_path, temp.path().join("working.sqlite")).unwrap()
}

fn source_by_name<'a>(workspace: &'a FontWorkspace, name: &str) -> &'a shift_font::Source {
    workspace
        .font()
        .sources()
        .iter()
        .find(|source| source.name() == name)
        .unwrap_or_else(|| panic!("source {name} should exist"))
}

#[test]
fn delete_axis_then_source_batch_undo_redo_round_trips() {
    let temp = tempfile::tempdir().unwrap();
    let mut workspace = sample_package_workspace(&temp);

    // The undo replays this batch reversed: the source is re-created
    // before the axis its location references exists again. The store
    // must tolerate that ordering instead of wedging undo on a
    // foreign-key violation.
    workspace
        .apply(
            FontIntentSet {
                intents: vec![
                    FontIntent::DeleteAxis {
                        axis_id: AxisId::from_raw("weight"),
                    },
                    FontIntent::DeleteSource {
                        source_id: SourceId::from_raw("bold"),
                    },
                ],
            },
            None,
        )
        .unwrap();

    undo_and_verify(&mut workspace, "axis-then-source batch should undo");
    let bold = source_by_name(&workspace, "Bold");
    assert_eq!(
        bold.location().get(&AxisId::from_raw("weight")),
        Some(900.0)
    );
    assert_eq!(bold.location().get(&AxisId::from_raw("width")), Some(112.5));

    redo_and_verify(&mut workspace, "batch should redo");
    assert!(
        workspace
            .font()
            .axes()
            .iter()
            .all(|axis| axis.tag() != "wght")
    );
    assert!(
        workspace
            .font()
            .sources()
            .iter()
            .all(|source| source.name() != "Bold")
    );

    undo_and_verify(&mut workspace, "batch should undo again after redo");
}

#[test]
fn delete_source_then_axis_batch_undo_restores_locations() {
    let temp = tempfile::tempdir().unwrap();
    let mut workspace = sample_package_workspace(&temp);

    workspace
        .apply(
            FontIntentSet {
                intents: vec![
                    FontIntent::DeleteSource {
                        source_id: SourceId::from_raw("bold"),
                    },
                    FontIntent::DeleteAxis {
                        axis_id: AxisId::from_raw("weight"),
                    },
                ],
            },
            None,
        )
        .unwrap();

    undo_and_verify(&mut workspace, "source-then-axis batch should undo");
    let bold = source_by_name(&workspace, "Bold");
    assert_eq!(
        bold.location().get(&AxisId::from_raw("weight")),
        Some(900.0)
    );
    let regular = source_by_name(&workspace, "Regular");
    assert_eq!(
        regular.location().get(&AxisId::from_raw("weight")),
        Some(400.0)
    );

    redo_and_verify(&mut workspace, "batch should redo");
    undo_and_verify(&mut workspace, "batch should undo again after redo");
}

#[test]
fn delete_source_undo_restores_full_source() {
    let temp = tempfile::tempdir().unwrap();
    let mut workspace = sample_package_workspace(&temp);

    workspace
        .apply(
            FontIntentSet {
                intents: vec![FontIntent::DeleteSource {
                    source_id: SourceId::from_raw("bold"),
                }],
            },
            None,
        )
        .unwrap();

    undo_and_verify(&mut workspace, "deleteSource should undo");
    let bold = source_by_name(&workspace, "Bold");
    assert_eq!(bold.color(), Some("1,0.75,0,0.7"));
    assert_eq!(bold.filename(), Some("Bold.ufo"));
    assert_eq!(
        bold.lib().get("com.shift.sourceNote"),
        Some(&LibValue::String("bold layer note".to_string()))
    );
}

#[test]
fn delete_axis_undo_keeps_source_fields_intact() {
    let temp = tempfile::tempdir().unwrap();
    let mut workspace = sample_package_workspace(&temp);

    // Undoing an axis delete re-emits every located source to restore the
    // stripped location values; that re-emission must carry the sources'
    // full state, not blank their colors, filenames, and libs.
    workspace
        .apply(
            FontIntentSet {
                intents: vec![FontIntent::DeleteAxis {
                    axis_id: AxisId::from_raw("width"),
                }],
            },
            None,
        )
        .unwrap();

    undo_and_verify(&mut workspace, "deleteAxis should undo");
    let bold = source_by_name(&workspace, "Bold");
    assert_eq!(bold.color(), Some("1,0.75,0,0.7"));
    assert_eq!(bold.filename(), Some("Bold.ufo"));
    assert_eq!(bold.location().get(&AxisId::from_raw("width")), Some(112.5));
}

fn fixture(path: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(path)
}
