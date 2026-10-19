//! Repro found by spike 3: in a document with a recovery overlay, undoing a
//! source creation and a source update loses an anchor added before them on
//! a layer that is not resident when the undo runs. Native-only: no engine.

use engine_derisk::fixtures::{fixture, Document};
use shift_font::{AnchorId, AnchorSeed, DesignLocation, FontIntent, FontIntentSet, SourceId};
use shift_workspace::FontWorkspace;
use tempfile::TempDir;

fn apply(workspace: &mut FontWorkspace, intent: FontIntent) {
    workspace.apply(FontIntentSet { intents: vec![intent] }, None).unwrap();
}

fn run(evict_before_undo: bool, reopen_before_undo: bool) -> (usize, usize) {
    let document = Document::import(&fixture("Homenaje.glyphs"));
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("copy.shift");
    std::fs::copy(&document.path, &path).unwrap();
    let recovery = dir.path().join("recovery.sqlite");
    let mut workspace = FontWorkspace::open_document(&path, &recovery).unwrap();

    let glyph = workspace.font().glyph_by_name("Iu-cy").unwrap().clone();
    workspace.acquire_glyphs(&[glyph.id()], shift_workspace::AcquireScope::Glyphs).unwrap();
    let layer_id = glyph.layers().keys().next().unwrap().clone();
    let anchors_before = workspace.font().layer(&layer_id).unwrap().anchors().len();
    apply(&mut workspace, FontIntent::AddAnchors {
        layer_id: layer_id.clone(),
        anchors: vec![AnchorSeed { id: AnchorId::new(), name: Some("top".into()), x: 10.0, y: 700.0 }],
    });

    let source = workspace.font().sources()[0].clone();
    apply(&mut workspace, FontIntent::UpdateSource {
        source_id: source.id(),
        name: "Renamed".into(),
        location: source.location().clone(),
        metric_values: source.metric_values().clone(),
        italic_angle: source.italic_angle(),
        line_gap: source.line_gap(),
        underline_position: Some(-111.0),
        underline_thickness: source.underline_thickness(),
    });
    let mut location = DesignLocation::new();
    if let Some(axis) = workspace.font().axes().first().cloned() {
        location.set(axis.id(), axis.maximum());
    }
    apply(&mut workspace, FontIntent::CreateSource { source_id: SourceId::new(), name: "Added".into(), location });

    if evict_before_undo {
        workspace.evict_glyphs(&[glyph.id()]).unwrap();
    }
    let _ = reopen_before_undo;
    workspace.undo().unwrap(); // createSource
    workspace.undo().unwrap(); // updateSource
    workspace.acquire_glyphs(&[glyph.id()], shift_workspace::AcquireScope::Glyphs).unwrap();
    let live = workspace.font().layer(&layer_id).unwrap().anchors().len();
    drop(workspace);

    let mut reopened = FontWorkspace::open_document(&path, &recovery).unwrap();
    reopened.acquire_all_layers().unwrap();
    let on_disk = reopened.font().layer(&layer_id).unwrap().anchors().len();
    assert_eq!(live, anchors_before + 1, "live font after undoing the source edits");
    (live, on_disk)
}

#[test]
fn source_undo_keeps_unrelated_layer_edits_resident() {
    let (live, disk) = run(false, false);
    eprintln!("RESIDENT live anchors={live} on disk={disk}");
    assert_eq!(live, disk);
}

#[test]
fn source_undo_keeps_unrelated_layer_edits_evicted() {
    let (live, disk) = run(true, false);
    eprintln!("EVICTED live anchors={live} on disk={disk}");
    assert_eq!(live, disk);
}

/// The hazard behind the repro: in a document, persisting with `dirty: false`
/// discards the whole recovery overlay, so a renderer that reports clean too
/// early silently drops every unsaved edit.
#[test]
fn persisting_with_dirty_false_discards_unsaved_edits() {
    let document = Document::import(&fixture("Homenaje.glyphs"));
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("copy.shift");
    std::fs::copy(&document.path, &path).unwrap();
    let recovery = dir.path().join("recovery.sqlite");
    let mut workspace = FontWorkspace::open_document(&path, &recovery).unwrap();
    let glyph = workspace.font().glyph_by_name("Iu-cy").unwrap().clone();
    workspace.acquire_glyphs(&[glyph.id()], shift_workspace::AcquireScope::Glyphs).unwrap();
    let layer_id = glyph.layers().keys().next().unwrap().clone();

    let mut engine = workspace.font().clone();
    let applied = engine.apply_intents(FontIntentSet { intents: vec![FontIntent::AddAnchors {
        layer_id: layer_id.clone(),
        anchors: vec![AnchorSeed { id: AnchorId::new(), name: Some("top".into()), x: 10.0, y: 700.0 }],
    }] }).unwrap();
    workspace.persist_change_set(applied.changes, true).unwrap();
    let renamed = engine.apply_intents(FontIntentSet { intents: vec![FontIntent::SetFeatureSource { source: Some("# unsaved\n".into()) }] }).unwrap();
    // Wrong: the renderer claims the document is back at its saved state.
    workspace.persist_change_set(renamed.changes, false).unwrap();
    drop(workspace);

    let mut reopened = FontWorkspace::open_document(&path, &recovery).unwrap();
    reopened.acquire_all_layers().unwrap();
    let anchors = reopened.font().layer(&layer_id).unwrap().anchors().len();
    eprintln!("HAZARD anchors on disk after a mistaken clean write: {anchors} (engine has 1), feature source: {:?}", reopened.font().features().fea_source());
    assert_eq!(anchors, 0, "the mistaken clean write discarded the earlier unsaved anchor");
}
