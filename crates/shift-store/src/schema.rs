use crate::StoreError;

pub(crate) const SCHEMA_V1: &str = r#"
CREATE TABLE IF NOT EXISTS glyphs (
    id TEXT PRIMARY KEY,
    name TEXT
);

CREATE INDEX IF NOT EXISTS glyphs_name_idx
ON glyphs(name);
"#;

pub(crate) fn ensure_current(conn: &rusqlite::Connection) -> Result<(), StoreError> {
    conn.execute_batch(SCHEMA_V1)?;
    Ok(())
}
