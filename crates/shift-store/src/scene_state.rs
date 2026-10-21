//! The editor's canvas, stored with the font but never interpreted here.

use rusqlite::{OptionalExtension, Transaction, params};

use crate::{
    ShiftStore, StoreError, store::StoreKind, workspace_state::mark_workspace_unsaved_in_tx,
};

/// The editor's canvas as one opaque, versioned payload.
///
/// The renderer owns the payload's format and its version; Rust stores both
/// as given and never parses them. A store holds at most one scene state.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SceneState {
    /// Format version of `payload`, chosen by the renderer; at least 1.
    pub version: i64,
    /// Serialized canvas records, usually JSON text.
    pub payload: String,
}

/// Whether [`ShiftStore::set_scene_state`] changed what is stored.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SceneStateWrite {
    /// The store already held this exact scene state; nothing was written and
    /// nothing became unsaved.
    Unchanged,
    /// The scene state was replaced and the document now has unsaved changes.
    Written,
}

impl ShiftStore {
    /// Returns the stored scene state, or `None` when none was ever written.
    ///
    /// In a document opened with a recovery overlay this reads the unsaved
    /// scene state when there is one, and the saved one otherwise.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::Sqlite`] when the read fails.
    pub fn scene_state(&self) -> Result<Option<SceneState>, StoreError> {
        self.conn
            .query_row(
                "SELECT version, payload FROM scene_state WHERE id = 1",
                [],
                |row| {
                    Ok(SceneState {
                        version: row.get(0)?,
                        payload: row.get(1)?,
                    })
                },
            )
            .optional()
            .map_err(StoreError::from)
    }

    /// Replaces the scene state, marking the document unsaved.
    ///
    /// A document writes to its recovery overlay and a working store to its
    /// own table. Neither advances the font revision, so derived font caches
    /// stay valid. Writing the scene state that is already stored does
    /// nothing and returns [`SceneStateWrite::Unchanged`].
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::DocumentRequiresRecoveryOverlay`] in a document
    /// opened without one, [`StoreError::InvalidRecoveryTransition`] while a
    /// save is pending or the overlay is in conflict, and [`StoreError::Sqlite`]
    /// when the write fails, including when `version` is below 1.
    pub fn set_scene_state(&mut self, state: &SceneState) -> Result<SceneStateWrite, StoreError> {
        if self.scene_state()?.as_ref() == Some(state) {
            return Ok(SceneStateWrite::Unchanged);
        }
        if let Some(recovery) = self.recovery.as_mut() {
            recovery.replace_scene_state(state)?;
            return Ok(SceneStateWrite::Written);
        }
        if self.kind == StoreKind::Document {
            return Err(StoreError::DocumentRequiresRecoveryOverlay);
        }

        let tracks_workspace = self.tracks_workspace();
        let tx = self.conn.transaction()?;
        write_scene_state_in_tx(&tx, state)?;
        if tracks_workspace {
            mark_workspace_unsaved_in_tx(&tx)?;
        }
        tx.commit()?;
        Ok(SceneStateWrite::Written)
    }
}

/// Upserts the one scene state row in `tx`'s main database.
pub(crate) fn write_scene_state_in_tx(
    tx: &Transaction<'_>,
    state: &SceneState,
) -> Result<(), StoreError> {
    tx.execute(
        "INSERT INTO scene_state (id, version, payload) VALUES (1, ?1, ?2)
         ON CONFLICT(id) DO UPDATE SET version = excluded.version, payload = excluded.payload",
        params![state.version, state.payload],
    )?;
    Ok(())
}
