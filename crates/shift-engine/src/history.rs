use shift_font::{AppliedIntents, CoreResult, Font, FontChangeSet};

use crate::{ApplyError, EngineSession, LayerSource};

/// An undo history of edits, one change set each, as they were persisted.
///
/// An edit opens with [`Self::begin`], records each apply, and closes with
/// [`Self::end`], which coalesces what it recorded into one change set. Undo
/// and redo replay a change set or its inverse through the session; the
/// caller persists what they return like any other edit.
///
/// The history also remembers where the font was last saved, so an undo or
/// redo that lands there can say it matches the saved document.
#[derive(Clone, Debug, Default)]
pub struct EditHistory {
    open: Option<OpenEdit>,
    undo: Vec<FontChangeSet>,
    redo: Vec<FontChangeSet>,
    /// How many edits were undoable when the font was last saved; `None`
    /// when no position in the history is the saved one.
    saved: Option<usize>,
}

impl EditHistory {
    /// Opens an edit, dropping any edit still open.
    pub fn begin(&mut self) {
        self.open = Some(OpenEdit::Empty);
    }

    pub fn is_open(&self) -> bool {
        self.open.is_some()
    }

    /// Records that the font, where the history now stands, is the saved
    /// document: after a save, or on opening a document with no unsaved edits.
    pub fn mark_saved(&mut self) {
        self.saved = Some(self.undo.len());
    }

    /// Whether the font, where the history now stands, is the saved document.
    pub fn matches_saved(&self) -> bool {
        self.saved == Some(self.undo.len())
    }

    /// Adds one apply's change set to the open edit.
    pub fn record(&mut self, change_set: FontChangeSet) {
        if let Some(open) = self.open.take() {
            self.open = Some(open.record(change_set));
        }
    }

    /// Closes the open edit as one undo step and returns its change set,
    /// coalesced against `font`, the font it left; `None` when it changed
    /// nothing. Redo is discarded once an edit changes something.
    ///
    /// # Errors
    ///
    /// Returns the font's error when the edit's layers cannot be coalesced.
    pub fn end(&mut self, font: &Font) -> CoreResult<Option<FontChangeSet>> {
        let Some(open) = self.open.take() else {
            return Ok(None);
        };
        let change_set = match open {
            OpenEdit::Empty => return Ok(None),
            OpenEdit::One(change_set) => change_set,
            OpenEdit::Many(change_sets) => font.coalesce(&change_sets)?.changes,
        };
        if change_set.changes.is_empty() {
            return Ok(None);
        }
        self.discard_redo();
        self.undo.push(change_set.clone());
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
    /// As [`EngineSession::replay`]; the edit stays on the undo stack.
    pub fn undo<S: LayerSource>(
        &mut self,
        session: &mut EngineSession,
        source: &mut S,
    ) -> Result<Option<AppliedIntents>, ApplyError<S::Error>> {
        let Some(change_set) = self.undo.pop() else {
            return Ok(None);
        };
        match session.replay(source, change_set.inverted()) {
            Ok(applied) => {
                self.redo.push(change_set);
                Ok(Some(applied))
            }
            Err(error) => {
                self.undo.push(change_set);
                Err(error)
            }
        }
    }

    /// Makes the latest undone edit again. `None` when there is nothing to
    /// redo.
    ///
    /// # Errors
    ///
    /// As [`EngineSession::replay`]; the edit stays on the redo stack.
    pub fn redo<S: LayerSource>(
        &mut self,
        session: &mut EngineSession,
        source: &mut S,
    ) -> Result<Option<AppliedIntents>, ApplyError<S::Error>> {
        let Some(change_set) = self.redo.pop() else {
            return Ok(None);
        };
        match session.replay(source, change_set.clone()) {
            Ok(applied) => {
                self.undo.push(change_set);
                Ok(Some(applied))
            }
            Err(error) => {
                self.redo.push(change_set);
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

/// The applies an open edit has recorded so far. One apply's change set is
/// the edit's; several are coalesced when the edit ends.
#[derive(Clone, Debug)]
enum OpenEdit {
    Empty,
    One(FontChangeSet),
    Many(Vec<FontChangeSet>),
}

impl OpenEdit {
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
