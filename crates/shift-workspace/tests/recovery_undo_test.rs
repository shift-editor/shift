//! Undoing font-level edits in a document must keep earlier unsaved edits,
//! on disk as well as in memory.

use shift_font::test_support::fixtures;
use shift_font::{AddAnchors, CreateSource, UpdateSource};
use std::path::PathBuf;

use shift_font::{AnchorId, AnchorSeed, DesignLocation, FontIntent, FontIntentSet, SourceId};
use shift_workspace::{AcquireScope, FontWorkspace};
use tempfile::TempDir;

fn apply(workspace: &mut FontWorkspace, intent: FontIntent) {
    workspace.apply(&FontIntentSet::from(intent), None).unwrap();
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

/// Adds an anchor, then edits sources twice and undoes both source edits.
/// Returns the anchor counts before, live after the undos, and after reopening.
fn undo_source_edits_after_an_anchor(evict_before_undo: bool) -> (usize, usize, usize) {
    let dir = TempDir::new().unwrap();
    let (mut workspace, path, recovery) = open_document(&dir);
    let glyph = workspace.font().glyph_by_name("Iu-cy").unwrap().clone();
    workspace
        .acquire_glyphs(&[glyph.id()], AcquireScope::Glyphs)
        .unwrap();
    let layer_id = glyph.layers().keys().next().unwrap().clone();
    let before = workspace.font().layer(&layer_id).unwrap().anchors().len();

    apply(
        &mut workspace,
        AddAnchors {
            layer_id: layer_id.clone(),
            anchors: vec![AnchorSeed {
                id: AnchorId::new(),
                name: Some("top".into()),
                x: 10.0,
                y: 700.0,
            }],
        }
        .into(),
    );
    let source = workspace.font().sources()[0].clone();
    apply(
        &mut workspace,
        UpdateSource {
            source_id: source.id(),
            name: "Renamed".into(),
            location: source.location().clone(),
            metric_values: source.metric_values().clone(),
            italic_angle: source.italic_angle(),
            line_gap: source.line_gap(),
            underline_position: Some(-111.0),
            underline_thickness: source.underline_thickness(),
        }
        .into(),
    );
    let mut location = DesignLocation::new();
    if let Some(axis) = workspace.font().axes().first() {
        location.set(axis.id(), axis.maximum());
    }
    apply(
        &mut workspace,
        CreateSource {
            source_id: SourceId::new(),
            name: "Added".into(),
            location,
        }
        .into(),
    );

    if evict_before_undo {
        workspace.evict_glyphs(&[glyph.id()]).unwrap();
    }
    workspace.undo().unwrap();
    workspace.undo().unwrap();
    workspace
        .acquire_glyphs(&[glyph.id()], AcquireScope::Glyphs)
        .unwrap();
    let live = workspace.font().layer(&layer_id).unwrap().anchors().len();
    drop(workspace);

    let mut reopened = FontWorkspace::open_document(&path, &recovery).unwrap();
    reopened.acquire_all_layers().unwrap();
    let on_disk = reopened.font().layer(&layer_id).unwrap().anchors().len();
    (before, live, on_disk)
}

#[test]
fn undoing_source_edits_keeps_an_earlier_unsaved_anchor() {
    let (before, live, on_disk) = undo_source_edits_after_an_anchor(false);
    assert_eq!(live, before + 1, "in memory");
    assert_eq!(on_disk, before + 1, "after reopening");
}

#[test]
fn undoing_source_edits_keeps_an_earlier_unsaved_anchor_on_an_evicted_glyph() {
    let (before, live, on_disk) = undo_source_edits_after_an_anchor(true);
    assert_eq!(live, before + 1, "in memory");
    assert_eq!(on_disk, before + 1, "after reopening");
}
