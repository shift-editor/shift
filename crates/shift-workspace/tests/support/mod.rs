//! Helpers the workspace recovery tests share.

use shift_font::{Font, FontChange, FontChangeSet, Glyph, Replacement};
use shift_store::{SaveState, ShiftStore};
use shift_workspace::FontWorkspace;
use tempfile::TempDir;

/// Whether `workspace`, every layer loaded, holds each of `glyphs` exactly.
fn holds(workspace: &mut FontWorkspace, glyphs: &[Glyph]) -> bool {
    workspace.acquire_all_layers().is_ok()
        && glyphs
            .iter()
            .all(|glyph| workspace.font().glyph(glyph.id()) == Some(glyph))
}

/// Saves `full` without the glyphs `tail` names (taken off its end, last
/// first), adds them back as unsaved edits and drops the store, as a crash
/// would; then reopens the document in a workspace and saves it. Returns,
/// on reopening and again after saving in a fresh workspace, whether the
/// workspace is dirty and whether it holds those glyphs exactly through its
/// lazily loaded directory.
///
/// # Errors
///
/// Returns the first step that fails.
pub(crate) fn unsaved_glyphs_reopen_and_save(
    full: &Font,
    tail: &[&str],
) -> Result<[(bool, bool); 2], Box<dyn std::error::Error>> {
    let dir = TempDir::new()?;
    let (document, recovery) = (dir.path().join("S.shift"), dir.path().join("r.sqlite"));
    let mut saved = full.clone();
    let mut added = Vec::new();
    for name in tail {
        let glyph_id = saved.glyph_id_by_name(name).ok_or("no such glyph")?;
        added.insert(0, saved.pop_glyph(glyph_id)?);
    }
    drop(ShiftStore::create_document(&document, &saved)?);
    let changes = added
        .iter()
        .map(|glyph| FontChange::Glyph(Box::new(Replacement::new(None, Some(glyph.clone())))))
        .collect();
    let mut store = ShiftStore::open_document_with_recovery(&document, &recovery)?;
    store.apply_change_set_with_font(&FontChangeSet::new(changes), full, SaveState::Unsaved)?;
    drop(store);

    let mut recovered = FontWorkspace::open_document(&document, &recovery)?;
    let on_reopening = (recovered.is_dirty()?, holds(&mut recovered, &added));
    recovered.save()?;
    drop(recovered);

    let mut reopened = FontWorkspace::open_document(&document, &recovery)?;
    let after_saving = (reopened.is_dirty()?, holds(&mut reopened, &added));
    Ok([on_reopening, after_saving])
}
