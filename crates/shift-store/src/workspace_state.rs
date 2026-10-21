use std::{
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{Transaction, params};

use crate::{ShiftStore, StoreError};

shift_font::string_enum! {
    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    pub enum WorkspaceSourceKind {
        Untitled => "untitled",
        Imported => "imported",
    }
    parse_error: StoreError = |value| {
        StoreError::InvalidWorkspaceState(format!("unknown source kind {value:?}"))
    };
}

crate::sql_text::sql_text!(WorkspaceSourceKind);

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkspaceState {
    pub document_id: Option<String>,
    pub source_kind: WorkspaceSourceKind,
    pub original_import_path: Option<PathBuf>,
    pub dirty: bool,
    pub revision: i64,
    pub saved_revision: i64,
    pub updated_at_ms: i64,
}

impl WorkspaceState {
    pub fn untitled(document_id: Option<String>) -> Self {
        Self {
            document_id,
            source_kind: WorkspaceSourceKind::Untitled,
            original_import_path: None,
            dirty: false,
            revision: 0,
            saved_revision: 0,
            updated_at_ms: now_ms(),
        }
    }

    pub fn imported(original_path: impl AsRef<Path>, document_id: Option<String>) -> Self {
        Self {
            document_id,
            source_kind: WorkspaceSourceKind::Imported,
            original_import_path: Some(original_path.as_ref().to_path_buf()),
            dirty: false,
            revision: 0,
            saved_revision: 0,
            updated_at_ms: now_ms(),
        }
    }
}

impl ShiftStore {
    /// Writes the workspace state, replacing any stored before.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::Sqlite`] when the write fails.
    pub fn set_workspace_state(&mut self, state: &WorkspaceState) -> Result<(), StoreError> {
        let original_import_path = state.original_import_path.as_deref().map(path_to_db);

        self.conn.execute(
            "
            INSERT INTO workspace_state (
                id,
                document_id,
                source_kind,
                original_import_path,
                dirty,
                revision,
                saved_revision,
                updated_at_ms
            )
            VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ON CONFLICT(id) DO UPDATE SET
                document_id = excluded.document_id,
                source_kind = excluded.source_kind,
                original_import_path = excluded.original_import_path,
                dirty = excluded.dirty,
                revision = excluded.revision,
                saved_revision = excluded.saved_revision,
                updated_at_ms = excluded.updated_at_ms
            ",
            params![
                state.document_id.as_deref(),
                state.source_kind.as_str(),
                original_import_path,
                state.dirty,
                state.revision,
                state.saved_revision,
                state.updated_at_ms,
            ],
        )?;
        Ok(())
    }

    /// Returns the workspace state, or `None` when none was written.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::Sqlite`] when the read fails, including when the stored source kind is
    /// unknown.
    pub fn workspace_state(&self) -> Result<Option<WorkspaceState>, StoreError> {
        let mut stmt = self.conn.prepare(
            "
            SELECT
                document_id,
                source_kind,
                original_import_path,
                dirty,
                revision,
                saved_revision,
                updated_at_ms
            FROM workspace_state
            WHERE id = 1
            ",
        )?;

        match stmt.query_row([], map_workspace_state_row) {
            Ok(state) => Ok(Some(state)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(err) => Err(err.into()),
        }
    }

    /// Records the workspace's document id.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::Sqlite`] when the write fails.
    pub fn set_workspace_document_id(&mut self, document_id: &str) -> Result<(), StoreError> {
        self.conn.execute(
            "
            UPDATE workspace_state
            SET document_id = ?1, updated_at_ms = ?2
            WHERE id = 1
            ",
            params![document_id, now_ms()],
        )?;
        Ok(())
    }
}

/// Whether a persisted change leaves unsaved work.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SaveState {
    /// The document now differs from what is saved; recovery keeps the change.
    Unsaved,
    /// The change returns the document to exactly its saved state, so the
    /// recovery overlay is discarded. Pass this only when the font equals the
    /// saved document, as an undo or redo onto the saved position does.
    MatchesSaved,
}

pub(crate) fn mark_workspace_dirty_in_tx(tx: &Transaction<'_>) -> Result<(), StoreError> {
    mark_workspace_changed_in_tx(tx, SaveState::Unsaved)
}

pub(crate) fn mark_workspace_changed_in_tx(
    tx: &Transaction<'_>,
    save_state: SaveState,
) -> Result<(), StoreError> {
    let dirty = save_state == SaveState::Unsaved;
    tx.execute(
        "
        UPDATE workspace_state
        SET
            dirty = ?1,
            revision = revision + 1,
            updated_at_ms = ?2
        WHERE id = 1
        ",
        params![dirty, now_ms()],
    )?;
    Ok(())
}

fn map_workspace_state_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorkspaceState> {
    let source_kind: WorkspaceSourceKind = row.get(1)?;

    Ok(WorkspaceState {
        document_id: row.get(0)?,
        source_kind,
        original_import_path: row.get::<_, Option<String>>(2)?.map(PathBuf::from),
        dirty: row.get(3)?,
        revision: row.get(4)?,
        saved_revision: row.get(5)?,
        updated_at_ms: row.get(6)?,
    })
}

fn path_to_db(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn now_ms() -> i64 {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => i64::try_from(duration.as_millis()).unwrap_or(i64::MAX),
        Err(_) => 0,
    }
}
