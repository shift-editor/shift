use std::{
    ffi::OsString,
    path::{Path, PathBuf},
};

use rusqlite::{Connection, OpenFlags, OptionalExtension, params};
use shift_font::Font;

use crate::{
    DocumentId, ShiftStore, StoreError,
    connection::{configure_common, configure_document_connection},
    schema,
    store::StoreKind,
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DocumentMetadata {
    pub document_id: DocumentId,
}

impl ShiftStore {
    /// Creates and durably publishes a complete canonical Shift document.
    ///
    /// The destination is never overwritten. All schema and font writes happen
    /// at a sibling staging path before one no-clobber publication step.
    pub fn create_document(path: impl AsRef<Path>, font: &Font) -> Result<Self, StoreError> {
        let path = path.as_ref();
        if path.exists() {
            return Err(StoreError::DocumentAlreadyExists(path.to_path_buf()));
        }

        let parent = parent_directory(path);
        let staged = tempfile::Builder::new()
            .prefix(".shift-document-")
            .suffix(".shift")
            .tempfile_in(parent)?
            .into_temp_path();

        {
            let conn = Connection::open(&staged)?;
            configure_document_connection(&conn)?;
            schema::initialize_document(&conn)?;
            let mut store = Self {
                conn,
                path: Some(staged.to_path_buf()),
                kind: StoreKind::Document,
            };
            store.replace_font_state(font)?;
            store.insert_document_metadata(&DocumentMetadata {
                document_id: DocumentId::new(),
            })?;
            store.sync_store_file()?;
        }

        remove_staging_sidecars(&staged)?;
        match staged.persist_noclobber(path) {
            Ok(()) => {}
            Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists => {
                return Err(StoreError::DocumentAlreadyExists(path.to_path_buf()));
            }
            Err(error) => return Err(StoreError::Io(error.error)),
        }
        sync_parent_directory(path)?;

        Self::open_document(path)
    }

    /// Opens a canonical Shift document after validating it read-only first.
    pub fn open_document(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        let path = path.as_ref();

        {
            let probe = open_document_read_only(path)?;
            schema::validate_document_header(&probe)?;
            validate_document_shape(&probe)?;
        }

        let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE)?;
        schema::validate_document_header(&conn)?;
        validate_document_shape(&conn)?;
        configure_document_connection(&conn)?;

        Ok(Self {
            conn,
            path: Some(path.to_path_buf()),
            kind: StoreKind::Document,
        })
    }

    /// Performs format, schema, relational, and SQLite integrity validation
    /// without opening the document for writes.
    pub fn verify_document(path: impl AsRef<Path>) -> Result<DocumentMetadata, StoreError> {
        let conn = open_document_read_only(path.as_ref())?;
        schema::validate_document_header(&conn)?;
        let metadata = validate_document_shape(&conn)?;

        let integrity: String = conn.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
        if integrity != "ok" {
            return Err(StoreError::InvalidDocument(format!(
                "SQLite integrity check failed: {integrity}"
            )));
        }

        let mut foreign_keys = conn.prepare("PRAGMA foreign_key_check")?;
        if foreign_keys.exists([])? {
            return Err(StoreError::InvalidDocument(
                "SQLite foreign-key check failed".to_string(),
            ));
        }

        Ok(metadata)
    }

    pub fn document_metadata(&self) -> Result<DocumentMetadata, StoreError> {
        load_document_metadata(&self.conn)
    }

    fn insert_document_metadata(&mut self, metadata: &DocumentMetadata) -> Result<(), StoreError> {
        self.conn.execute(
            "INSERT INTO document_metadata (id, document_id) VALUES (1, ?1)",
            params![metadata.document_id.as_str()],
        )?;
        Ok(())
    }
}

fn open_document_read_only(path: &Path) -> Result<Connection, StoreError> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    configure_common(&conn)?;
    conn.pragma_update(None, "query_only", "ON")?;
    Ok(conn)
}

fn validate_document_shape(conn: &Connection) -> Result<DocumentMetadata, StoreError> {
    let has_workspace_state: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'workspace_state')",
        [],
        |row| row.get(0),
    )?;
    if has_workspace_state {
        return Err(StoreError::InvalidDocument(
            "canonical document contains app-local workspace state".to_string(),
        ));
    }

    load_document_metadata(conn)
}

fn load_document_metadata(conn: &Connection) -> Result<DocumentMetadata, StoreError> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM document_metadata", [], |row| {
        row.get(0)
    })?;
    if count != 1 {
        return Err(StoreError::InvalidDocument(format!(
            "expected one document_metadata row, found {count}"
        )));
    }

    let stored = conn
        .query_row(
            "SELECT document_id FROM document_metadata WHERE id = 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| {
            StoreError::InvalidDocument("missing document_metadata row 1".to_string())
        })?;
    let document_id =
        DocumentId::from_stored(stored.clone()).ok_or(StoreError::InvalidDocumentId(stored))?;

    Ok(DocumentMetadata { document_id })
}

fn parent_directory(path: &Path) -> &Path {
    match path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent,
        _ => Path::new("."),
    }
}

fn remove_staging_sidecars(path: &Path) -> Result<(), StoreError> {
    for suffix in ["-journal", "-wal", "-shm"] {
        let sidecar = sqlite_sidecar_path(path, suffix);
        match std::fs::remove_file(sidecar) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

fn sqlite_sidecar_path(path: &Path, suffix: &str) -> PathBuf {
    let mut sidecar = OsString::from(path.as_os_str());
    sidecar.push(suffix);
    PathBuf::from(sidecar)
}

#[cfg(unix)]
fn sync_parent_directory(path: &Path) -> Result<(), StoreError> {
    std::fs::File::open(parent_directory(path))?.sync_all()?;
    Ok(())
}

#[cfg(not(unix))]
fn sync_parent_directory(_path: &Path) -> Result<(), StoreError> {
    Ok(())
}
