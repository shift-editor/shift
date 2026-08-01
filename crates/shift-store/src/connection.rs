use std::path::Path;

use crate::{ShiftStore, StoreError, schema};

impl ShiftStore {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        let path = path.as_ref();
        let conn = rusqlite::Connection::open(path)?;
        configure_connection(&conn)?;
        schema::ensure_current(&conn)?;
        Ok(Self {
            conn,
            path: Some(path.to_path_buf()),
        })
    }

    /// Opens a disposable import destination with rollback-capable in-memory
    /// journaling. The foreign source remains authoritative until
    /// [`Self::finish_import`] makes the completed store durable.
    pub fn open_for_import(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        let path = path.as_ref();
        let conn = rusqlite::Connection::open(path)?;
        configure_import_connection(&conn)?;
        schema::ensure_current(&conn)?;
        let has_workspace: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM workspace_state WHERE id = 1)",
            [],
            |row| row.get(0),
        )?;
        if has_workspace {
            return Err(StoreError::ImportDestinationNotEmpty(path.to_path_buf()));
        }
        Ok(Self {
            conn,
            path: Some(path.to_path_buf()),
        })
    }

    /// Flushes a completed staged import and restores the normal edit-time
    /// WAL posture before the workspace publishes the closed database.
    pub fn finish_import(&self) -> Result<(), StoreError> {
        self.sync_store_file()?;

        let journal_mode: String = self
            .conn
            .query_row("PRAGMA journal_mode=WAL", [], |row| row.get(0))?;
        debug_assert_eq!(journal_mode, "wal");
        self.conn.pragma_update(None, "synchronous", "NORMAL")?;
        self.sync_store_file()?;
        Ok(())
    }

    fn sync_store_file(&self) -> Result<(), StoreError> {
        if let Some(path) = &self.path {
            std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .open(path)?
                .sync_all()?;
        }
        Ok(())
    }

    pub fn open_memory_for_test() -> Result<Self, StoreError> {
        let conn = rusqlite::Connection::open_in_memory()?;
        configure_connection(&conn)?;
        schema::ensure_current(&conn)?;
        Ok(Self { conn, path: None })
    }
}

fn configure_connection(conn: &rusqlite::Connection) -> Result<(), StoreError> {
    configure_common(conn)?;

    // WAL + NORMAL is the durability/latency posture for a store that
    // commits per user action. In-memory test connections report "memory"
    // for journal_mode; both outcomes are accepted here and the file-mode
    // expectation is pinned by tests.
    let journal_mode: String = conn.query_row("PRAGMA journal_mode=WAL", [], |row| row.get(0))?;
    debug_assert!(matches!(journal_mode.as_str(), "wal" | "memory"));
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    Ok(())
}

fn configure_import_connection(conn: &rusqlite::Connection) -> Result<(), StoreError> {
    configure_common(conn)?;
    let journal_mode: String =
        conn.query_row("PRAGMA journal_mode=MEMORY", [], |row| row.get(0))?;
    debug_assert_eq!(journal_mode, "memory");
    conn.pragma_update(None, "synchronous", "OFF")?;
    Ok(())
}

fn configure_common(conn: &rusqlite::Connection) -> Result<(), StoreError> {
    conn.set_prepared_statement_cache_capacity(64);
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.busy_timeout(std::time::Duration::from_millis(5_000))?;
    Ok(())
}
