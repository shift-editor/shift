use std::{
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{Transaction, params};

use crate::{ShiftStore, StoreError};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WorkspaceSourceKind {
    Untitled,
    Imported,
}

impl WorkspaceSourceKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Untitled => "untitled",
            Self::Imported => "imported",
        }
    }
}

impl TryFrom<&str> for WorkspaceSourceKind {
    type Error = StoreError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "untitled" => Ok(Self::Untitled),
            "imported" => Ok(Self::Imported),
            other => Err(StoreError::InvalidWorkspaceState(format!(
                "unknown source kind {other:?}"
            ))),
        }
    }
}

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
    pub fn set_workspace_state(&mut self, state: WorkspaceState) -> Result<(), StoreError> {
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

    pub fn set_workspace_document_id(&mut self, document_id: String) -> Result<(), StoreError> {
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

pub(crate) fn mark_workspace_dirty_in_tx(tx: &Transaction<'_>) -> Result<(), StoreError> {
    mark_workspace_changed_in_tx(tx, true)
}

pub(crate) fn mark_workspace_changed_in_tx(
    tx: &Transaction<'_>,
    dirty: bool,
) -> Result<(), StoreError> {
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
    let source_kind = row.get::<_, String>(1)?;
    let source_kind = WorkspaceSourceKind::try_from(source_kind.as_str()).map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(1, rusqlite::types::Type::Text, Box::new(err))
    })?;

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
