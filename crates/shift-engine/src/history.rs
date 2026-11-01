use shift_font::{AppliedIntents, CoreResult, Font, FontChangeSet, NodeId};

use crate::scene::{Scene, SceneChangeSet};
use crate::{ApplyError, DocumentChangeSet, EditLocation, EngineSession, LayerSource};

/// Whether a closed edit becomes an undo step.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Recording {
    /// The edit is the latest undo step, and undone edits are forgotten.
    Undoable,
    /// The edit is kept and persisted but is not an undo step, as placing a
    /// text run is not: undo passes over it. The document no longer matches
    /// any saved position in the history.
    Unrecorded,
}

/// One undo step: what the edit changed, and where it was made.
#[derive(Clone, Debug)]
pub struct HistoryEntry {
    pub change_set: DocumentChangeSet,
    pub location: EditLocation,
}

/// What an undo or redo did: the font changes it installed, the scene
/// changes it installed, and where the edit it replayed was made, so the
/// editor can show that page first.
#[derive(Debug)]
pub struct Replayed {
    pub applied: AppliedIntents,
    pub scene: SceneChangeSet,
    pub location: EditLocation,
}

impl Replayed {
    /// The document change set the replay installed, to persist.
    pub fn change_set(&self) -> DocumentChangeSet {
        DocumentChangeSet {
            font: self.applied.changes.clone(),
            scene: self.scene.clone(),
        }
    }
}

/// One undo history for a document: its font and scene edits together, one
/// change set each, as they were persisted.
///
/// An edit opens with [`Self::begin`], records each apply, and closes with
/// [`Self::end`], which coalesces what it recorded into one change set. Undo
/// and redo replay a change set or its inverse through the session; the
/// caller persists what they return like any other edit. Every step carries
/// its [`EditLocation`]: the page it was made on and what it changed.
///
/// The history also remembers where the document was last saved, so an undo
/// or redo that lands there can say it matches the saved document.
#[derive(Clone, Debug, Default)]
pub struct EditHistory {
    open: Option<OpenEdit>,
    undo: Vec<HistoryEntry>,
    redo: Vec<HistoryEntry>,
    /// How many edits were undoable when the document was last saved;
    /// `None` when no position in the history is the saved one.
    saved: Option<usize>,
}

impl EditHistory {
    /// Opens an edit made on `page_id`, the page the editor shows, dropping
    /// any edit still open.
    pub fn begin(&mut self, page_id: Option<NodeId>) {
        self.open = Some(OpenEdit {
            page_id,
            font: OpenFontEdit::Empty,
            scene: Vec::new(),
        });
    }

    /// Drops what the open edit recorded so far and keeps it open on the same
    /// page, as a gesture does when it goes back to where it began.
    pub fn restart(&mut self) {
        if let Some(open) = self.open.as_mut() {
            open.font = OpenFontEdit::Empty;
            open.scene.clear();
        }
    }

    pub fn is_open(&self) -> bool {
        self.open.is_some()
    }

    /// Records that the document, where the history now stands, is the saved
    /// one: after a save, or on opening a document with no unsaved edits.
    pub fn mark_saved(&mut self) {
        self.saved = Some(self.undo.len());
    }

    /// Whether the document, where the history now stands, is the saved one.
    pub fn matches_saved(&self) -> bool {
        self.saved == Some(self.undo.len())
    }

    /// Adds one apply's font change set to the open edit.
    pub fn record(&mut self, change_set: FontChangeSet) {
        if let Some(open) = self.open.as_mut() {
            open.font = std::mem::take(&mut open.font).record(change_set);
        }
    }

    /// Adds one apply's scene change set to the open edit.
    pub fn record_scene(&mut self, change_set: SceneChangeSet) {
        if let Some(open) = self.open.as_mut()
            && !change_set.is_empty()
        {
            open.scene.push(change_set);
        }
    }

    /// The latest undo step, if any.
    pub fn latest(&self) -> Option<&HistoryEntry> {
        self.undo.last()
    }

    /// Closes the open edit and returns its change set, its font changes
    /// coalesced against `font` and its scene changes per node; `None` when
    /// it changed nothing. An [`Recording::Undoable`] edit becomes the latest
    /// undo step, located on the page it began on, or else the page of the
    /// first node it changed in `scene`, the scene it left.
    ///
    /// # Errors
    ///
    /// Returns the font's error when the edit's layers cannot be coalesced.
    pub fn end(
        &mut self,
        font: &Font,
        scene: &Scene,
        recording: Recording,
    ) -> CoreResult<Option<DocumentChangeSet>> {
        let Some(open) = self.open.take() else {
            return Ok(None);
        };
        let font_changes = match open.font {
            OpenFontEdit::Empty => FontChangeSet::default(),
            OpenFontEdit::One(change_set) => change_set,
            OpenFontEdit::Many(change_sets) => font.coalesce(&change_sets)?.changes,
        };
        let change_set = DocumentChangeSet {
            font: font_changes,
            scene: SceneChangeSet::coalesce(&open.scene),
        };
        if change_set.is_empty() {
            return Ok(None);
        }
        match recording {
            Recording::Undoable => {
                // A scene edit is shown on the page it changed, which a
                // deleted page's own entry needs: it was made from another.
                let page_id = scene.first_changed_page(&change_set.scene).or(open.page_id);
                self.discard_redo();
                self.undo.push(HistoryEntry {
                    location: EditLocation::of(page_id, &change_set),
                    change_set: change_set.clone(),
                });
            }
            Recording::Unrecorded => self.saved = None,
        }
        Ok(Some(change_set))
    }

    /// Drops the open edit without keeping it.
    pub fn cancel(&mut self) {
        self.open = None;
    }

    /// Takes back the latest edit: replays its inverse through `session`.
    /// `None` when there is nothing to undo.
    ///
    /// # Errors
    ///
    /// As [`EngineSession::replay_document`]; the edit stays on the undo stack.
    pub fn undo<S: LayerSource>(
        &mut self,
        session: &mut EngineSession,
        source: &mut S,
    ) -> Result<Option<Replayed>, ApplyError<S::Error>> {
        let Some(entry) = self.undo.pop() else {
            return Ok(None);
        };
        let inverse = entry.change_set.inverted();
        match session.replay_document(source, &inverse) {
            Ok(applied) => {
                let replayed = Replayed {
                    applied,
                    scene: inverse.scene,
                    location: entry.location.clone(),
                };
                self.redo.push(entry);
                Ok(Some(replayed))
            }
            Err(error) => {
                self.undo.push(entry);
                Err(error)
            }
        }
    }

    /// Makes the latest undone edit again. `None` when there is nothing to
    /// redo.
    ///
    /// # Errors
    ///
    /// As [`EngineSession::replay_document`]; the edit stays on the redo stack.
    pub fn redo<S: LayerSource>(
        &mut self,
        session: &mut EngineSession,
        source: &mut S,
    ) -> Result<Option<Replayed>, ApplyError<S::Error>> {
        let Some(entry) = self.redo.pop() else {
            return Ok(None);
        };
        match session.replay_document(source, &entry.change_set) {
            Ok(applied) => {
                let replayed = Replayed {
                    applied,
                    scene: entry.change_set.scene.clone(),
                    location: entry.location.clone(),
                };
                self.undo.push(entry);
                Ok(Some(replayed))
            }
            Err(error) => {
                self.redo.push(entry);
                Err(error)
            }
        }
    }

    /// Forgets every undone edit, and the saved position with them if it was
    /// among them.
    pub fn discard_redo(&mut self) {
        self.redo.clear();
        if self.saved.is_some_and(|saved| saved > self.undo.len()) {
            self.saved = None;
        }
    }
}

/// What an open edit has recorded so far, and the page it was made on.
#[derive(Clone, Debug)]
struct OpenEdit {
    page_id: Option<NodeId>,
    font: OpenFontEdit,
    scene: Vec<SceneChangeSet>,
}

/// The font applies an open edit has recorded so far. One apply's change set
/// is the edit's; several are coalesced when the edit ends.
#[derive(Clone, Debug, Default)]
enum OpenFontEdit {
    #[default]
    Empty,
    One(FontChangeSet),
    Many(Vec<FontChangeSet>),
}

impl OpenFontEdit {
    /// Adds one apply's change set; one that changed nothing is dropped.
    fn record(self, change_set: FontChangeSet) -> Self {
        if change_set.changes.is_empty() {
            return self;
        }
        match self {
            Self::Empty => Self::One(change_set),
            Self::One(first) => Self::Many(vec![first, change_set]),
            Self::Many(mut change_sets) => {
                change_sets.push(change_set);
                Self::Many(change_sets)
            }
        }
    }
}
