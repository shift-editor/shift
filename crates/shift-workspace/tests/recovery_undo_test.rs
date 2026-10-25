//! Undoing font-level edits in a document must keep earlier unsaved edits,
//! on disk as well as in memory.

use shift_font::test_support::fixtures;
use shift_font::{
    AddAnchors, CreateGlyph, CreateSource, KerningPair, KerningValueEdit, MovePoints,
    SetKerningValues, UpdateSource,
};
use shift_store::{RecoveryState, SaveState};
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

/// The first glyph with a contour, and that contour's layer.
fn drawn_layer(font: &shift_font::Font) -> (shift_font::GlyphId, shift_font::GlyphLayer) {
    font.glyphs()
        .find_map(|glyph| {
            glyph
                .layers()
                .values()
                .find(|layer| layer.contours_iter().next().is_some())
                .map(|layer| (glyph.id(), shift_font::GlyphLayer::clone(layer)))
        })
        .unwrap()
}

fn first_glyph(font: &shift_font::Font) -> shift_font::GlyphId {
    font.glyphs().next().unwrap().id()
}

/// Moves a point, renames a source, kerns a pair and creates a glyph: a layer
/// payload, a source row with store-only columns, a replaced kerning
/// collection, and rows the saved document doesn't have.
fn edit_layer_source_and_kerning(workspace: &mut FontWorkspace) {
    workspace.acquire_all_layers().unwrap();
    let (glyph_id, layer) = drawn_layer(workspace.font());
    let point = layer.contours_iter().next().unwrap().points()[0].clone();
    apply(
        workspace,
        MovePoints {
            layer_id: layer.id(),
            point_ids: vec![point.id()],
            coords: vec![point.x() + 15.0, point.y()],
        }
        .into(),
    );
    let source = workspace.font().sources()[0].clone();
    apply(
        workspace,
        UpdateSource {
            source_id: source.id(),
            name: "Renamed".into(),
            location: source.location().clone(),
            metric_values: source.metric_values().clone(),
            italic_angle: source.italic_angle(),
            line_gap: source.line_gap(),
            underline_position: source.underline_position(),
            underline_thickness: source.underline_thickness(),
        }
        .into(),
    );
    let other = first_glyph(workspace.font());
    apply(
        workspace,
        SetKerningValues {
            edits: vec![KerningValueEdit {
                source_id: source.id(),
                pair: KerningPair::glyphs(other, glyph_id),
                value: Some(-40.0),
            }],
        }
        .into(),
    );
    apply(
        workspace,
        CreateGlyph {
            glyph_id: None,
            name: "created".into(),
            unicodes: vec![0xE000],
        }
        .into(),
    );
}

#[test]
fn undoing_every_edit_returns_the_document_to_saved() {
    let dir = TempDir::new().unwrap();
    let (mut workspace, _, _) = open_document(&dir);
    edit_layer_source_and_kerning(&mut workspace);
    assert!(workspace.is_dirty().unwrap());

    while workspace.undo().unwrap().is_some() {}

    assert!(!workspace.is_dirty().unwrap());
    assert_eq!(
        workspace.store().recovery_state().unwrap(),
        Some(RecoveryState::Clean)
    );
}

#[test]
fn a_wrong_claim_to_match_the_saved_document_keeps_unsaved_edits() {
    let dir = TempDir::new().unwrap();
    let (mut workspace, path, recovery) = open_document(&dir);
    edit_layer_source_and_kerning(&mut workspace);

    // A caller that wrongly believes it is back at the saved position, as a
    // second timeline could, persists one more edit claiming a clean result.
    let mut next = workspace.font().clone();
    let source = next.sources()[0].clone();
    let changes = next
        .apply_intents(&FontIntentSet::from(FontIntent::from(UpdateSource {
            source_id: source.id(),
            name: "Claimed clean".into(),
            location: source.location().clone(),
            metric_values: source.metric_values().clone(),
            italic_angle: source.italic_angle(),
            line_gap: source.line_gap(),
            underline_position: source.underline_position(),
            underline_thickness: source.underline_thickness(),
        })))
        .unwrap()
        .changes;
    workspace
        .store_mut()
        .apply_change_set_with_font(&changes, &next, SaveState::MatchesSaved)
        .unwrap();

    assert_eq!(
        workspace.store().recovery_state().unwrap(),
        Some(RecoveryState::Dirty)
    );
    drop(workspace);
    let mut reopened = FontWorkspace::open_document(&path, &recovery).unwrap();
    reopened.acquire_all_layers().unwrap();
    assert!(reopened.is_dirty().unwrap());
    assert_eq!(reopened.font().sources()[0].name(), "Claimed clean");
    let font = reopened.font();
    let pair = KerningPair::glyphs(first_glyph(font), drawn_layer(font).0);
    assert_eq!(font.kerning().value(&source.id(), &pair), Some(-40.0));
}
