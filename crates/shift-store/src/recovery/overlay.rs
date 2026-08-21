use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags, params};

use crate::{CommitId, DocumentId, StoreError, connection::configure_common, schema};

const RECOVERY_APPLICATION_ID: i64 = 0x5348_4652;
const RECOVERY_SCHEMA_VERSION: i64 = 1;

const RECOVERY_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS recovery_metadata (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    document_id TEXT NOT NULL,
    base_commit_id TEXT NOT NULL,
    pending_commit_id TEXT,
    state TEXT NOT NULL CHECK (state IN ('clean', 'dirty', 'save_pending', 'conflict')),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
);

CREATE TABLE IF NOT EXISTS recovery_replacements (
    collection TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    PRIMARY KEY (collection, owner_id)
);

CREATE TABLE IF NOT EXISTS recovery_tombstones (
    entity_kind TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    PRIMARY KEY (entity_kind, entity_id)
);
"#;

/// Persisted lifecycle state of one sparse recovery overlay.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RecoveryState {
    /// The overlay contains no unsaved authored changes.
    Clean,
    /// Sparse changes are based on the canonical saved commit.
    Dirty,
    /// A commit ID was persisted before applying changes to the canonical document.
    SavePending,
    /// The canonical saved commit changed from the overlay's base.
    Conflict,
}

impl RecoveryState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Clean => "clean",
            Self::Dirty => "dirty",
            Self::SavePending => "save_pending",
            Self::Conflict => "conflict",
        }
    }

    fn parse(value: &str) -> Result<Self, StoreError> {
        match value {
            "clean" => Ok(Self::Clean),
            "dirty" => Ok(Self::Dirty),
            "save_pending" => Ok(Self::SavePending),
            "conflict" => Ok(Self::Conflict),
            other => Err(StoreError::InvalidDocument(format!(
                "unknown recovery state {other:?}"
            ))),
        }
    }
}

/// App-owned SQLite file containing only unsaved canonical row replacements and tombstones.
pub struct RecoveryOverlay {
    pub(super) conn: Connection,
    path: PathBuf,
}

struct RecoveryMetadata {
    document_id: DocumentId,
    base_commit_id: CommitId,
    pending_commit_id: Option<CommitId>,
    state: RecoveryState,
}

impl RecoveryOverlay {
    pub fn create(
        path: impl AsRef<Path>,
        document_id: &DocumentId,
        base_commit_id: &CommitId,
    ) -> Result<Self, StoreError> {
        let path = path.as_ref();
        if path.exists() {
            return Err(StoreError::RecoveryAlreadyExists(path.to_path_buf()));
        }
        let conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
        )?;
        configure_recovery_connection(&conn)?;
        let application_id: i64 = conn.query_row("PRAGMA application_id", [], |row| row.get(0))?;
        let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
        let schema_rows: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'",
            [],
            |row| row.get(0),
        )?;
        if application_id != 0 || version != 0 || schema_rows != 0 {
            return Err(StoreError::RecoveryAlreadyExists(path.to_path_buf()));
        }

        conn.execute_batch(schema::DOCUMENT_SCHEMA_V1)?;
        conn.execute_batch(RECOVERY_SCHEMA)?;
        conn.pragma_update(None, "application_id", RECOVERY_APPLICATION_ID)?;
        conn.pragma_update(None, "user_version", RECOVERY_SCHEMA_VERSION)?;
        conn.execute(
            "INSERT INTO recovery_metadata (
                id, document_id, base_commit_id, pending_commit_id, state, revision
             ) VALUES (1, ?1, ?2, NULL, 'clean', 0)",
            params![document_id.as_str(), base_commit_id.as_str()],
        )?;
        sync_path(path)?;

        Ok(Self {
            conn,
            path: path.to_path_buf(),
        })
    }

    pub fn open(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        let path = path.as_ref();
        let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE)?;
        configure_recovery_connection(&conn)?;
        validate_recovery_header(&conn)?;
        let overlay = Self {
            conn,
            path: path.to_path_buf(),
        };
        overlay.metadata()?;
        Ok(overlay)
    }

    pub fn state(&self) -> Result<RecoveryState, StoreError> {
        Ok(self.metadata()?.state)
    }

    pub fn document_id(&self) -> Result<DocumentId, StoreError> {
        Ok(self.metadata()?.document_id)
    }

    pub fn base_commit_id(&self) -> Result<CommitId, StoreError> {
        Ok(self.metadata()?.base_commit_id)
    }

    pub fn pending_commit_id(&self) -> Result<Option<CommitId>, StoreError> {
        Ok(self.metadata()?.pending_commit_id)
    }

    pub fn revision(&self) -> Result<i64, StoreError> {
        self.conn
            .query_row(
                "SELECT revision FROM recovery_metadata WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .map_err(StoreError::from)
    }

    pub fn reconcile(&mut self, saved_commit_id: &CommitId) -> Result<RecoveryState, StoreError> {
        let metadata = self.metadata()?;
        let next = match metadata.state {
            RecoveryState::Clean => {
                if metadata.base_commit_id != *saved_commit_id {
                    self.set_clean(saved_commit_id)?;
                }
                RecoveryState::Clean
            }
            RecoveryState::Dirty if metadata.base_commit_id == *saved_commit_id => {
                RecoveryState::Dirty
            }
            RecoveryState::SavePending
                if metadata.pending_commit_id.as_ref() == Some(saved_commit_id) =>
            {
                self.set_clean(saved_commit_id)?;
                RecoveryState::Clean
            }
            RecoveryState::SavePending if metadata.base_commit_id == *saved_commit_id => {
                self.conn.execute(
                    "UPDATE recovery_metadata
                     SET pending_commit_id = NULL, state = 'dirty'
                     WHERE id = 1",
                    [],
                )?;
                RecoveryState::Dirty
            }
            RecoveryState::Conflict => RecoveryState::Conflict,
            RecoveryState::Dirty | RecoveryState::SavePending => {
                self.conn.execute(
                    "UPDATE recovery_metadata SET state = 'conflict' WHERE id = 1",
                    [],
                )?;
                RecoveryState::Conflict
            }
        };
        Ok(next)
    }

    pub fn discard(&mut self, saved_commit_id: &CommitId) -> Result<(), StoreError> {
        self.set_clean(saved_commit_id)
    }

    pub(crate) fn begin_save(&mut self) -> Result<CommitId, StoreError> {
        let state = self.state()?;
        if state != RecoveryState::Dirty {
            return Err(StoreError::InvalidRecoveryTransition {
                expected: "dirty",
                found: state.as_str(),
            });
        }

        let commit_id = CommitId::new();
        self.conn.execute(
            "UPDATE recovery_metadata
             SET pending_commit_id = ?1, state = 'save_pending'
             WHERE id = 1",
            [commit_id.as_str()],
        )?;
        sync_path(&self.path)?;
        Ok(commit_id)
    }

    pub(crate) fn acknowledge_save(&mut self, commit_id: &CommitId) -> Result<(), StoreError> {
        let metadata = self.metadata()?;
        if metadata.state != RecoveryState::SavePending
            || metadata.pending_commit_id.as_ref() != Some(commit_id)
        {
            return Err(StoreError::InvalidRecoveryTransition {
                expected: "matching save_pending",
                found: metadata.state.as_str(),
            });
        }

        self.set_clean(commit_id)
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    fn set_clean(&mut self, base_commit_id: &CommitId) -> Result<(), StoreError> {
        let tx = self.conn.transaction()?;
        super::catalog::clear_recovery(&tx)?;
        tx.execute(
            "UPDATE recovery_metadata
             SET base_commit_id = ?1, pending_commit_id = NULL, state = 'clean', revision = 0
             WHERE id = 1",
            [base_commit_id.as_str()],
        )?;
        tx.commit()?;
        sync_path(&self.path)
    }

    fn metadata(&self) -> Result<RecoveryMetadata, StoreError> {
        let stored = self.conn.query_row(
            "SELECT document_id, base_commit_id, pending_commit_id, state
             FROM recovery_metadata WHERE id = 1",
            [],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )?;
        let document_id = DocumentId::from_stored(stored.0.clone())
            .ok_or(StoreError::InvalidDocumentId(stored.0))?;
        let base_commit_id =
            CommitId::from_stored(stored.1.clone()).ok_or(StoreError::InvalidCommitId(stored.1))?;
        let pending_commit_id = stored
            .2
            .map(|value| {
                CommitId::from_stored(value.clone()).ok_or(StoreError::InvalidCommitId(value))
            })
            .transpose()?;

        Ok(RecoveryMetadata {
            document_id,
            base_commit_id,
            pending_commit_id,
            state: RecoveryState::parse(&stored.3)?,
        })
    }
}

fn configure_recovery_connection(conn: &Connection) -> Result<(), StoreError> {
    configure_common(conn)?;
    conn.pragma_update(None, "foreign_keys", "OFF")?;
    let journal_mode: String = conn.query_row("PRAGMA journal_mode=WAL", [], |row| row.get(0))?;
    debug_assert_eq!(journal_mode, "wal");
    conn.pragma_update(None, "synchronous", "FULL")?;
    Ok(())
}

fn validate_recovery_header(conn: &Connection) -> Result<(), StoreError> {
    let application_id: i64 = conn.query_row("PRAGMA application_id", [], |row| row.get(0))?;
    if application_id != RECOVERY_APPLICATION_ID {
        return Err(StoreError::InvalidApplicationId {
            found: application_id,
            expected: RECOVERY_APPLICATION_ID,
        });
    }
    let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if version != RECOVERY_SCHEMA_VERSION {
        return Err(StoreError::UnsupportedSchemaVersion {
            found: version,
            supported: RECOVERY_SCHEMA_VERSION,
        });
    }
    Ok(())
}

fn sync_path(path: &Path) -> Result<(), StoreError> {
    std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)?
        .sync_all()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use shift_font::test_support::sample_font;

    use super::*;
    use crate::ShiftStore;

    #[test]
    fn pending_commit_reconciles_against_canonical_commit() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("recovery.sqlite");
        let document_id = DocumentId::new();
        let base = CommitId::new();
        let mut overlay = RecoveryOverlay::create(&path, &document_id, &base).unwrap();
        let journal_mode: String = overlay
            .conn
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .unwrap();
        let synchronous: i64 = overlay
            .conn
            .query_row("PRAGMA synchronous", [], |row| row.get(0))
            .unwrap();
        assert_eq!(journal_mode, "wal");
        assert_eq!(synchronous, 2);

        overlay
            .conn
            .execute(
                "UPDATE recovery_metadata SET state = 'dirty' WHERE id = 1",
                [],
            )
            .unwrap();
        let pending = overlay.begin_save().unwrap();
        drop(overlay);

        let mut overlay = RecoveryOverlay::open(&path).unwrap();
        assert_eq!(overlay.reconcile(&base).unwrap(), RecoveryState::Dirty);
        overlay.conn.execute(
            "UPDATE recovery_metadata SET pending_commit_id = ?1, state = 'save_pending' WHERE id = 1",
            [pending.as_str()],
        ).unwrap();
        assert_eq!(overlay.reconcile(&pending).unwrap(), RecoveryState::Clean);
        assert_eq!(overlay.base_commit_id().unwrap(), pending);
    }

    #[test]
    fn committed_save_without_acknowledgement_reopens_clean() {
        let temp = tempfile::tempdir().unwrap();
        let document_path = temp.path().join("Dogfood.shift");
        let recovery_path = temp.path().join("recovery.sqlite");
        let layer_id = shift_font::LayerId::from_raw("A_regular");
        drop(ShiftStore::create_document(&document_path, &sample_font()).unwrap());

        let mut store =
            ShiftStore::open_document_with_recovery(&document_path, &recovery_path).unwrap();
        let mut layer = store.load_glyph_layer(&layer_id).unwrap().unwrap();
        layer.set_width(777.0);
        store.replace_glyph_layer(&layer).unwrap();
        let commit_id = store.recovery.as_mut().unwrap().begin_save().unwrap();
        crate::recovery::save::apply_recovery_to_document(&mut store.conn, &commit_id).unwrap();
        drop(store);

        let reopened =
            ShiftStore::open_document_with_recovery(&document_path, &recovery_path).unwrap();
        assert_eq!(
            reopened.recovery_state().unwrap(),
            Some(RecoveryState::Clean)
        );
        assert_eq!(
            reopened
                .load_glyph_layer(&layer_id)
                .unwrap()
                .unwrap()
                .width(),
            777.0
        );
    }
}
