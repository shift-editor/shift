//! A glyph axis and drawings off the font's sources, left as unsaved edits
//! in a document's recovery overlay by a crash, reopen in a workspace
//! exactly, through its lazily loaded directory, and saving keeps them.

use shift_font::test_support::glyph_axis_font;
use shift_font::{Font, FontChange, FontChangeSet, Glyph, Replacement};
use shift_store::{SaveState, ShiftStore};
use shift_workspace::FontWorkspace;
use tempfile::TempDir;

/// `dot` and `H` of the glyph-axis font, taken off its tail, and the font
/// left without them.
fn split_off_dot_and_h() -> Result<(Font, Vec<Glyph>), shift_font::CoreError> {
    let mut saved = glyph_axis_font();
    let mut added = Vec::new();
    for name in ["H", "dot"] {
        if let Some(glyph_id) = saved.glyph_id_by_name(name) {
            added.insert(0, saved.pop_glyph(glyph_id)?);
        }
    }
    Ok((saved, added))
}

/// Whether `workspace`, every layer loaded, holds each of `glyphs` exactly.
fn holds(workspace: &mut FontWorkspace, glyphs: &[Glyph]) -> bool {
    workspace.acquire_all_layers().is_ok()
        && glyphs
            .iter()
            .all(|glyph| workspace.font().glyph(glyph.id()) == Some(glyph))
}

#[test]
fn unsaved_glyph_axes_and_drawings_off_the_sources_reopen_and_save_in_a_workspace() {
    let dir = TempDir::new().unwrap();
    let (document, recovery) = (dir.path().join("S.shift"), dir.path().join("r.sqlite"));
    let (saved, added) = split_off_dot_and_h().unwrap();
    drop(ShiftStore::create_document(&document, &saved).unwrap());
    let mut after = saved;
    for glyph in &added {
        after.insert_glyph(glyph.clone()).unwrap();
    }
    let changes = added
        .iter()
        .map(|glyph| FontChange::Glyph(Box::new(Replacement::new(None, Some(glyph.clone())))))
        .collect();
    let mut store = ShiftStore::open_document_with_recovery(&document, &recovery).unwrap();
    store
        .apply_change_set_with_font(&FontChangeSet::new(changes), &after, SaveState::Unsaved)
        .unwrap();
    drop(store);

    let mut recovered = FontWorkspace::open_document(&document, &recovery).unwrap();
    assert!(recovered.is_dirty().unwrap() && holds(&mut recovered, &added));
    recovered.save().unwrap();
    drop(recovered);

    let mut reopened = FontWorkspace::open_document(&document, &recovery).unwrap();
    assert!(!reopened.is_dirty().unwrap() && holds(&mut reopened, &added));
}
