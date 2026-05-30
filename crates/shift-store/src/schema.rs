use crate::StoreError;

pub(crate) const SCHEMA_V1: &str = r#"
CREATE TABLE IF NOT EXISTS axes (
    id TEXT PRIMARY KEY,
    tag TEXT NOT NULL,
    name TEXT NOT NULL,
    min_value REAL NOT NULL,
    default_value REAL NOT NULL,
    max_value REAL NOT NULL,
    hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1))
);

CREATE UNIQUE INDEX IF NOT EXISTS axes_tag_unique
ON axes(tag);

CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    name TEXT,
    family_name TEXT,
    style_name TEXT,
    kind TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS glyphs (
    id TEXT PRIMARY KEY,
    name TEXT
);

CREATE INDEX IF NOT EXISTS glyphs_name_idx
ON glyphs(name);

CREATE TABLE IF NOT EXISTS source_locations (
    source_id TEXT NOT NULL,
    axis_id TEXT NOT NULL,
    value REAL NOT NULL,
    PRIMARY KEY (source_id, axis_id),
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE,
    FOREIGN KEY (axis_id) REFERENCES axes(id) ON DELETE CASCADE
);
"#;

pub(crate) fn ensure_current(conn: &rusqlite::Connection) -> Result<(), StoreError> {
    conn.execute_batch(SCHEMA_V1)?;
    Ok(())
}
