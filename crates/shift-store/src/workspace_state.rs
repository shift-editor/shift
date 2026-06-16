use std::{
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{Transaction, params};

use crate::{ShiftStore, StoreError};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FileIdentity {
    pub kind: String,
    pub value: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SourceIdentitySnapshot {
    pub source_path: Option<PathBuf>,
    pub canonical_source_path: Option<PathBuf>,
    pub source_package_id: Option<String>,
    pub source_file_identity: Option<FileIdentity>,
    pub source_size: Option<u64>,
    pub source_mtime_ms: Option<i64>,
    pub source_fingerprint: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Evidence {
    Same,
    Different,
    Unknown,
}

impl Evidence {
    pub fn is_same(self) -> bool {
        self == Self::Same
    }

    pub fn is_different(self) -> bool {
        self == Self::Different
    }
}

impl SourceIdentitySnapshot {
    pub fn source_path_match(&self, other: &Self) -> Evidence {
        compare_optional(self.source_path.as_ref(), other.source_path.as_ref())
    }

    pub fn canonical_path_match(&self, other: &Self) -> Evidence {
        compare_optional(
            self.canonical_source_path.as_ref(),
            other.canonical_source_path.as_ref(),
        )
    }

    pub fn package_id_match(&self, other: &Self) -> Evidence {
        compare_optional(
            self.source_package_id.as_ref(),
            other.source_package_id.as_ref(),
        )
    }

    pub fn file_identity_match(&self, other: &Self) -> Evidence {
        compare_optional(
            self.source_file_identity.as_ref(),
            other.source_file_identity.as_ref(),
        )
    }

    pub fn fingerprint_match(&self, other: &Self) -> Evidence {
        compare_optional(
            self.source_fingerprint.as_ref(),
            other.source_fingerprint.as_ref(),
        )
    }

    pub fn same_path_as(&self, other: &Self) -> bool {
        self.canonical_path_match(other).is_same() || self.source_path_match(other).is_same()
    }

    pub fn fingerprint_changed_from(&self, other: &Self) -> bool {
        self.fingerprint_match(other).is_different()
    }

    pub fn source_path_missing(&self) -> bool {
        self.source_path.as_ref().is_none_or(|path| !path.exists())
    }
}

fn compare_optional<T: PartialEq>(left: Option<&T>, right: Option<&T>) -> Evidence {
    match (left, right) {
        (Some(left), Some(right)) if left == right => Evidence::Same,
        (Some(_), Some(_)) => Evidence::Different,
        _ => Evidence::Unknown,
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WorkspaceSourceKind {
    Untitled,
    Package,
    Imported,
}

impl WorkspaceSourceKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Untitled => "untitled",
            Self::Package => "package",
            Self::Imported => "imported",
        }
    }
}

impl TryFrom<&str> for WorkspaceSourceKind {
    type Error = StoreError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "untitled" => Ok(Self::Untitled),
            "package" => Ok(Self::Package),
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
    pub source_path: Option<PathBuf>,
    pub canonical_source_path: Option<PathBuf>,
    pub original_import_path: Option<PathBuf>,
    pub source_package_id: Option<String>,
    pub source_file_identity: Option<FileIdentity>,
    pub source_size: Option<u64>,
    pub source_mtime_ms: Option<i64>,
    pub source_fingerprint: Option<String>,
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
            source_path: None,
            canonical_source_path: None,
            original_import_path: None,
            source_package_id: None,
            source_file_identity: None,
            source_size: None,
            source_mtime_ms: None,
            source_fingerprint: None,
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
            source_path: None,
            canonical_source_path: None,
            original_import_path: Some(original_path.as_ref().to_path_buf()),
            source_package_id: None,
            source_file_identity: None,
            source_size: None,
            source_mtime_ms: None,
            source_fingerprint: None,
            dirty: false,
            revision: 0,
            saved_revision: 0,
            updated_at_ms: now_ms(),
        }
    }

    pub fn package(identity: SourceIdentitySnapshot, document_id: Option<String>) -> Self {
        Self {
            document_id,
            source_kind: WorkspaceSourceKind::Package,
            source_path: identity.source_path,
            canonical_source_path: identity.canonical_source_path,
            original_import_path: None,
            source_package_id: identity.source_package_id,
            source_file_identity: identity.source_file_identity,
            source_size: identity.source_size,
            source_mtime_ms: identity.source_mtime_ms,
            source_fingerprint: identity.source_fingerprint,
            dirty: false,
            revision: 0,
            saved_revision: 0,
            updated_at_ms: now_ms(),
        }
    }

    pub fn source_identity(&self) -> SourceIdentitySnapshot {
        SourceIdentitySnapshot {
            source_path: self.source_path.clone(),
            canonical_source_path: self.canonical_source_path.clone(),
            source_package_id: self.source_package_id.clone(),
            source_file_identity: self.source_file_identity.clone(),
            source_size: self.source_size,
            source_mtime_ms: self.source_mtime_ms,
            source_fingerprint: self.source_fingerprint.clone(),
        }
    }

    pub fn set_package_identity(&mut self, identity: SourceIdentitySnapshot) {
        self.source_kind = WorkspaceSourceKind::Package;
        self.source_path = identity.source_path;
        self.canonical_source_path = identity.canonical_source_path;
        self.original_import_path = None;
        self.source_package_id = identity.source_package_id;
        self.source_file_identity = identity.source_file_identity;
        self.source_size = identity.source_size;
        self.source_mtime_ms = identity.source_mtime_ms;
        self.source_fingerprint = identity.source_fingerprint;
        self.updated_at_ms = now_ms();
    }
}

impl ShiftStore {
    pub fn set_workspace_state(&mut self, state: WorkspaceState) -> Result<(), StoreError> {
        let file_identity_kind = state
            .source_file_identity
            .as_ref()
            .map(|identity| identity.kind.as_str());
        let file_identity_value = state
            .source_file_identity
            .as_ref()
            .map(|identity| identity.value.as_str());
        let source_path = state.source_path.as_deref().map(path_to_db);
        let canonical_source_path = state.canonical_source_path.as_deref().map(path_to_db);
        let original_import_path = state.original_import_path.as_deref().map(path_to_db);
        let source_size = state
            .source_size
            .map(i64::try_from)
            .transpose()
            .map_err(|_| {
                StoreError::InvalidWorkspaceState("source size does not fit i64".into())
            })?;

        self.conn.execute(
            "
            INSERT INTO workspace_state (
                id,
                document_id,
                source_kind,
                source_path,
                canonical_source_path,
                original_import_path,
                source_package_id,
                source_file_identity_kind,
                source_file_identity_value,
                source_size,
                source_mtime_ms,
                source_fingerprint,
                dirty,
                revision,
                saved_revision,
                updated_at_ms
            )
            VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
            ON CONFLICT(id) DO UPDATE SET
                document_id = excluded.document_id,
                source_kind = excluded.source_kind,
                source_path = excluded.source_path,
                canonical_source_path = excluded.canonical_source_path,
                original_import_path = excluded.original_import_path,
                source_package_id = excluded.source_package_id,
                source_file_identity_kind = excluded.source_file_identity_kind,
                source_file_identity_value = excluded.source_file_identity_value,
                source_size = excluded.source_size,
                source_mtime_ms = excluded.source_mtime_ms,
                source_fingerprint = excluded.source_fingerprint,
                dirty = excluded.dirty,
                revision = excluded.revision,
                saved_revision = excluded.saved_revision,
                updated_at_ms = excluded.updated_at_ms
            ",
            params![
                state.document_id.as_deref(),
                state.source_kind.as_str(),
                source_path,
                canonical_source_path,
                original_import_path,
                state.source_package_id.as_deref(),
                file_identity_kind,
                file_identity_value,
                source_size,
                state.source_mtime_ms,
                state.source_fingerprint.as_deref(),
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
                source_path,
                canonical_source_path,
                original_import_path,
                source_package_id,
                source_file_identity_kind,
                source_file_identity_value,
                source_size,
                source_mtime_ms,
                source_fingerprint,
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

    pub fn mark_workspace_clean(
        &mut self,
        identity: Option<&SourceIdentitySnapshot>,
    ) -> Result<(), StoreError> {
        let Some(identity) = identity else {
            self.conn.execute(
                "
                UPDATE workspace_state
                SET
                    dirty = 0,
                    saved_revision = revision,
                    updated_at_ms = ?1
                WHERE id = 1
                ",
                params![now_ms()],
            )?;
            return Ok(());
        };

        let file_identity_kind = identity
            .source_file_identity
            .as_ref()
            .map(|file_identity| file_identity.kind.as_str());
        let file_identity_value = identity
            .source_file_identity
            .as_ref()
            .map(|file_identity| file_identity.value.as_str());

        self.conn.execute(
            "
            UPDATE workspace_state
            SET
                source_path = ?1,
                canonical_source_path = ?2,
                source_package_id = ?3,
                source_file_identity_kind = ?4,
                source_file_identity_value = ?5,
                source_size = ?6,
                source_mtime_ms = ?7,
                source_fingerprint = ?8,
                dirty = 0,
                saved_revision = revision,
                updated_at_ms = ?9
            WHERE id = 1
            ",
            params![
                identity.source_path.as_deref().map(path_to_db),
                identity.canonical_source_path.as_deref().map(path_to_db),
                identity.source_package_id.as_deref(),
                file_identity_kind,
                file_identity_value,
                identity
                    .source_size
                    .map(i64::try_from)
                    .transpose()
                    .map_err(|_| StoreError::InvalidWorkspaceState(
                        "source size does not fit i64".into()
                    ))?,
                identity.source_mtime_ms,
                identity.source_fingerprint.as_deref(),
                now_ms(),
            ],
        )?;
        Ok(())
    }
}

pub(crate) fn mark_workspace_dirty_in_tx(tx: &Transaction<'_>) -> Result<(), StoreError> {
    tx.execute(
        "
        UPDATE workspace_state
        SET
            dirty = 1,
            revision = revision + 1,
            updated_at_ms = ?1
        WHERE id = 1
        ",
        params![now_ms()],
    )?;
    Ok(())
}

fn map_workspace_state_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorkspaceState> {
    let source_kind = row.get::<_, String>(1)?;
    let source_file_identity = match (
        row.get::<_, Option<String>>(6)?,
        row.get::<_, Option<String>>(7)?,
    ) {
        (Some(kind), Some(value)) => Some(FileIdentity { kind, value }),
        _ => None,
    };

    let source_size = row
        .get::<_, Option<i64>>(8)?
        .map(|size| {
            u64::try_from(size).map_err(|err| {
                rusqlite::Error::FromSqlConversionFailure(
                    8,
                    rusqlite::types::Type::Integer,
                    Box::new(err),
                )
            })
        })
        .transpose()?;

    let source_kind = WorkspaceSourceKind::try_from(source_kind.as_str()).map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(1, rusqlite::types::Type::Text, Box::new(err))
    })?;

    Ok(WorkspaceState {
        document_id: row.get(0)?,
        source_kind,
        source_path: row.get::<_, Option<String>>(2)?.map(PathBuf::from),
        canonical_source_path: row.get::<_, Option<String>>(3)?.map(PathBuf::from),
        original_import_path: row.get::<_, Option<String>>(4)?.map(PathBuf::from),
        source_package_id: row.get(5)?,
        source_file_identity,
        source_size,
        source_mtime_ms: row.get(9)?,
        source_fingerprint: row.get(10)?,
        dirty: row.get(11)?,
        revision: row.get(12)?,
        saved_revision: row.get(13)?,
        updated_at_ms: row.get(14)?,
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
