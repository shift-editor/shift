use std::path::Path;

use crate::{ShiftStore, StoreError, schema};

impl ShiftStore {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        let conn = rusqlite::Connection::open(path)?;
        configure_connection(&conn)?;
        schema::ensure_current(&conn)?;
        Ok(Self { conn })
    }

    pub fn open_memory_for_test() -> Result<Self, StoreError> {
        let conn = rusqlite::Connection::open_in_memory()?;
        configure_connection(&conn)?;
        schema::ensure_current(&conn)?;
        Ok(Self { conn })
    }
}

fn configure_connection(conn: &rusqlite::Connection) -> Result<(), StoreError> {
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.busy_timeout(std::time::Duration::from_millis(5_000))?;

    // WAL + NORMAL is the durability/latency posture for a store that
    // commits per user action. In-memory test connections report "memory"
    // for journal_mode; both outcomes are accepted here and the file-mode
    // expectation is pinned by tests.
    let journal_mode: String = conn.query_row("PRAGMA journal_mode=WAL", [], |row| row.get(0))?;
    debug_assert!(matches!(journal_mode.as_str(), "wal" | "memory"));
    conn.pragma_update(None, "synchronous", "NORMAL")?;

    Ok(())
}
