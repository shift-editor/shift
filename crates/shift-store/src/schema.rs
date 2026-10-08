use rusqlite::Transaction;

use crate::StoreError;

const DEFER_IMPORT_INDEXES: &str = r#"
DROP INDEX IF EXISTS glyphs_name_idx;
DROP INDEX IF EXISTS glyph_layers_glyph_id_idx;
DROP INDEX IF EXISTS glyph_layers_source_id_idx;
DROP INDEX IF EXISTS glyph_components_base_glyph_id_idx;
"#;

const RESTORE_IMPORT_INDEXES: &str = r#"
CREATE INDEX glyphs_name_idx ON glyphs(name);
CREATE INDEX glyph_layers_glyph_id_idx ON glyph_layers(glyph_id);
CREATE INDEX glyph_layers_source_id_idx ON glyph_layers(source_id);
CREATE INDEX glyph_components_base_glyph_id_idx ON glyph_components(base_glyph_id);
"#;

pub(crate) const DOCUMENT_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS font_info (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    family_name TEXT,
    style_name TEXT,
    copyright TEXT,
    trademark TEXT,
    description TEXT,
    note TEXT,
    sample_text TEXT,
    designer TEXT,
    designer_url TEXT,
    manufacturer TEXT,
    manufacturer_url TEXT,
    license_description TEXT,
    license_info_url TEXT,
    vendor_id TEXT,
    version_major INTEGER CHECK (version_major IS NULL OR version_major >= 0),
    version_minor INTEGER CHECK (version_minor IS NULL OR version_minor >= 0),
    units_per_em REAL NOT NULL CHECK (units_per_em > 0),
    default_source_id TEXT
);

CREATE TABLE IF NOT EXISTS metric_definitions (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('ascender', 'cap_height', 'x_height', 'baseline', 'descender', 'custom')),
    name TEXT NOT NULL,
    order_index INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS axes (
    id TEXT PRIMARY KEY,
    tag TEXT NOT NULL,
    name TEXT NOT NULL,
    min_value REAL NOT NULL,
    default_value REAL NOT NULL,
    max_value REAL NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('external', 'internal')),
    discrete_values_json TEXT,
    labels_json TEXT NOT NULL DEFAULT '[]',
    hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
    order_index INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS axes_tag_unique
ON axes(tag);

CREATE TABLE IF NOT EXISTS axis_mappings (
    id TEXT PRIMARY KEY,
    mapping_json TEXT NOT NULL,
    order_index INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS named_instances (
    id TEXT PRIMARY KEY,
    instance_json TEXT NOT NULL,
    order_index INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    name TEXT,
    family_name TEXT,
    style_name TEXT,
    filename TEXT,
    color TEXT,
    layer_name TEXT,
    italic_angle REAL,
    line_gap REAL,
    underline_position REAL,
    underline_thickness REAL,
    kind TEXT NOT NULL,
    order_index INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS glyphs (
    id TEXT PRIMARY KEY,
    name TEXT,
    order_index INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS glyphs_name_idx
ON glyphs(name);

CREATE TABLE IF NOT EXISTS glyph_unicodes (
    glyph_id TEXT NOT NULL,
    unicode INTEGER NOT NULL CHECK (unicode >= 0),
    order_index INTEGER NOT NULL,
    PRIMARY KEY (glyph_id, unicode),
    FOREIGN KEY (glyph_id) REFERENCES glyphs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS glyph_layers (
    id TEXT PRIMARY KEY,
    glyph_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    width REAL NOT NULL DEFAULT 0,
    height REAL,
    FOREIGN KEY (glyph_id) REFERENCES glyphs(id) ON DELETE CASCADE,
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS glyph_layers_glyph_id_idx
ON glyph_layers(glyph_id);

CREATE INDEX IF NOT EXISTS glyph_layers_source_id_idx
ON glyph_layers(source_id);

CREATE TABLE IF NOT EXISTS glyph_layer_payloads (
    layer_id TEXT PRIMARY KEY,
    inner_format TEXT NOT NULL,
    compression TEXT NOT NULL CHECK (compression IN ('none', 'zstd.v1')),
    payload BLOB NOT NULL,
    stored_byte_length INTEGER NOT NULL
        CHECK (stored_byte_length >= 0 AND stored_byte_length = length(payload)),
    decoded_byte_length INTEGER NOT NULL
        CHECK (decoded_byte_length >= 0 AND stored_byte_length <= decoded_byte_length),
    decoded_blake3 BLOB NOT NULL CHECK (length(decoded_blake3) = 32),
    FOREIGN KEY (layer_id) REFERENCES glyph_layers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS glyph_components (
    id TEXT PRIMARY KEY,
    layer_id TEXT NOT NULL,
    base_glyph_id TEXT NOT NULL,
    order_index INTEGER NOT NULL,
    FOREIGN KEY (layer_id) REFERENCES glyph_layers(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS glyph_components_layer_order_unique
ON glyph_components(layer_id, order_index);

CREATE INDEX IF NOT EXISTS glyph_components_base_glyph_id_idx
ON glyph_components(base_glyph_id);

CREATE TABLE IF NOT EXISTS font_guidelines (
    id TEXT PRIMARY KEY,
    x REAL,
    y REAL,
    angle REAL,
    name TEXT,
    color TEXT,
    order_index INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS source_locations (
    source_id TEXT NOT NULL,
    axis_id TEXT NOT NULL,
    value REAL NOT NULL,
    PRIMARY KEY (source_id, axis_id),
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE,
    FOREIGN KEY (axis_id) REFERENCES axes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS source_metric_values (
    source_id TEXT NOT NULL,
    metric_id TEXT NOT NULL,
    position REAL NOT NULL,
    overshoot REAL NOT NULL,
    PRIMARY KEY (source_id, metric_id),
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE,
    FOREIGN KEY (metric_id) REFERENCES metric_definitions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS feature_text (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    fea_source TEXT
);

CREATE TABLE IF NOT EXISTS kerning_groups (
    position INTEGER NOT NULL CHECK (position IN (1, 2)),
    name TEXT NOT NULL,
    PRIMARY KEY (position, name)
);

CREATE TABLE IF NOT EXISTS kerning_group_members (
    position INTEGER NOT NULL CHECK (position IN (1, 2)),
    group_name TEXT NOT NULL,
    glyph_id TEXT NOT NULL,
    order_index INTEGER NOT NULL,
    PRIMARY KEY (position, group_name, order_index),
    UNIQUE (position, glyph_id),
    FOREIGN KEY (position, group_name) REFERENCES kerning_groups(position, name) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS kerning_pairs (
    source_id TEXT NOT NULL,
    first_kind TEXT NOT NULL CHECK (first_kind IN ('glyph', 'group')),
    first_value TEXT NOT NULL,
    second_kind TEXT NOT NULL CHECK (second_kind IN ('glyph', 'group')),
    second_value TEXT NOT NULL,
    value REAL NOT NULL,
    PRIMARY KEY (source_id, first_kind, first_value, second_kind, second_value)
);

CREATE TABLE IF NOT EXISTS font_lib (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fontinfo_remainder (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_lib (
    source_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    PRIMARY KEY (source_id, key),
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS glyph_lib (
    glyph_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    PRIMARY KEY (glyph_id, key),
    FOREIGN KEY (glyph_id) REFERENCES glyphs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS font_binaries (
    kind TEXT NOT NULL CHECK (kind IN ('data', 'image')),
    path TEXT NOT NULL,
    bytes BLOB NOT NULL,
    PRIMARY KEY (kind, path)
);

CREATE TABLE IF NOT EXISTS document_metadata (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    document_id TEXT NOT NULL,
    saved_commit_id TEXT NOT NULL
);
"#;

const WORKSPACE_SCHEMA_V1: &str = r#"
CREATE TABLE IF NOT EXISTS workspace_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    document_id TEXT,
    source_kind TEXT NOT NULL CHECK (source_kind IN ('untitled', 'imported')),
    original_import_path TEXT,
    dirty INTEGER NOT NULL DEFAULT 0 CHECK (dirty IN (0, 1)),
    revision INTEGER NOT NULL DEFAULT 0,
    saved_revision INTEGER NOT NULL DEFAULT 0,
    updated_at_ms INTEGER NOT NULL
);
"#;

pub const SHIFT_APPLICATION_ID: i64 = 0x5348_4654;
pub const SHIFT_DOCUMENT_SCHEMA_VERSION: i64 = 2;

/// The oldest schema version [`migrate`] can upgrade.
pub(crate) const OLDEST_MIGRATABLE_SCHEMA_VERSION: i64 = 1;

/// Version 1 to 2: kerning pairs gain a source and reference glyphs by id.
///
/// Existing pairs become values of the font's default source. Group names
/// lose their `public.kern1.`/`public.kern2.` prefix, and glyph names resolve
/// through `glyphs.name`. Members and pairs naming a glyph that is not in the
/// store are dropped, and a glyph listed in two groups for one position keeps
/// its first group. This SQL is frozen: later schema changes add new steps.
const MIGRATE_V1_TO_V2: &str = r#"
ALTER TABLE kerning_pairs RENAME TO kerning_pairs_v1;
ALTER TABLE kerning_group_members RENAME TO kerning_group_members_v1;
ALTER TABLE kerning_groups RENAME TO kerning_groups_v1;

CREATE TABLE kerning_groups (
    position INTEGER NOT NULL CHECK (position IN (1, 2)),
    name TEXT NOT NULL,
    PRIMARY KEY (position, name)
);

CREATE TABLE kerning_group_members (
    position INTEGER NOT NULL CHECK (position IN (1, 2)),
    group_name TEXT NOT NULL,
    glyph_id TEXT NOT NULL,
    order_index INTEGER NOT NULL,
    PRIMARY KEY (position, group_name, order_index),
    UNIQUE (position, glyph_id),
    FOREIGN KEY (position, group_name) REFERENCES kerning_groups(position, name) ON DELETE CASCADE
);

CREATE TABLE kerning_pairs (
    source_id TEXT NOT NULL,
    first_kind TEXT NOT NULL CHECK (first_kind IN ('glyph', 'group')),
    first_value TEXT NOT NULL,
    second_kind TEXT NOT NULL CHECK (second_kind IN ('glyph', 'group')),
    second_value TEXT NOT NULL,
    value REAL NOT NULL,
    PRIMARY KEY (source_id, first_kind, first_value, second_kind, second_value)
);

INSERT OR IGNORE INTO kerning_groups (position, name)
SELECT
    side,
    CASE WHEN name LIKE 'public.kern_.%' THEN substr(name, 14) ELSE name END
FROM kerning_groups_v1
ORDER BY side, name;

INSERT OR IGNORE INTO kerning_group_members (position, group_name, glyph_id, order_index)
SELECT
    member.side,
    CASE
        WHEN member.group_name LIKE 'public.kern_.%' THEN substr(member.group_name, 14)
        ELSE member.group_name
    END,
    glyph.id,
    member.order_index
FROM kerning_group_members_v1 AS member
JOIN glyphs AS glyph ON glyph.name = member.glyph_name
ORDER BY member.side, member.group_name, member.order_index;

WITH resolved AS (
    SELECT
        pair.order_index,
        (SELECT default_source_id FROM font_info WHERE id = 1) AS source_id,
        pair.first_kind,
        CASE
            WHEN pair.first_kind = 'glyph'
                THEN (SELECT id FROM glyphs WHERE name = pair.first_value)
            WHEN pair.first_value LIKE 'public.kern_.%' THEN substr(pair.first_value, 14)
            ELSE pair.first_value
        END AS first_value,
        pair.second_kind,
        CASE
            WHEN pair.second_kind = 'glyph'
                THEN (SELECT id FROM glyphs WHERE name = pair.second_value)
            WHEN pair.second_value LIKE 'public.kern_.%' THEN substr(pair.second_value, 14)
            ELSE pair.second_value
        END AS second_value,
        pair.value
    FROM kerning_pairs_v1 AS pair
)
INSERT OR IGNORE INTO kerning_pairs (
    source_id, first_kind, first_value, second_kind, second_value, value
)
SELECT source_id, first_kind, first_value, second_kind, second_value, value
FROM resolved
WHERE source_id IS NOT NULL AND first_value IS NOT NULL AND second_value IS NOT NULL
ORDER BY order_index;

DROP TABLE kerning_group_members_v1;
DROP TABLE kerning_groups_v1;
DROP TABLE kerning_pairs_v1;
"#;

/// Upgrades the authored tables of a store at `version` to
/// [`SHIFT_DOCUMENT_SCHEMA_VERSION`] in one transaction, stamping
/// `upgraded_version` as its `user_version`.
///
/// Stores already at the current version are left unchanged. Documents,
/// working stores, and recovery overlays share the authored tables, so each
/// runs the same steps with its own version stamp.
///
/// # Errors
///
/// Returns an error when `version` is older than
/// [`OLDEST_MIGRATABLE_SCHEMA_VERSION`] or a step fails; a failed migration
/// leaves the store at its original version.
pub(crate) fn migrate(
    conn: &rusqlite::Connection,
    version: i64,
    upgraded_version: i64,
) -> Result<(), StoreError> {
    if version >= SHIFT_DOCUMENT_SCHEMA_VERSION {
        return Ok(());
    }
    if version < OLDEST_MIGRATABLE_SCHEMA_VERSION {
        return Err(StoreError::UnsupportedDocumentSchemaVersion {
            found: version,
            supported: SHIFT_DOCUMENT_SCHEMA_VERSION,
        });
    }

    let tx = conn.unchecked_transaction()?;
    tx.execute_batch(MIGRATE_V1_TO_V2)?;
    tx.pragma_update(None, "user_version", upgraded_version)?;
    tx.commit()?;
    Ok(())
}

pub(crate) fn defer_import_indexes(tx: &Transaction<'_>) -> Result<(), StoreError> {
    tx.execute_batch(DEFER_IMPORT_INDEXES)?;
    Ok(())
}

pub(crate) fn restore_import_indexes(tx: &Transaction<'_>) -> Result<(), StoreError> {
    tx.execute_batch(RESTORE_IMPORT_INDEXES)?;
    Ok(())
}

/// Creates the current schema in an empty working store, or migrates an
/// older one, and stamps `user_version`.
///
/// A database from a newer app version is refused rather than silently
/// mangled.
pub(crate) fn ensure_current(conn: &rusqlite::Connection) -> Result<(), StoreError> {
    let application_id = application_id(conn)?;
    if application_id == SHIFT_APPLICATION_ID {
        return Err(StoreError::DocumentRequiresDocumentOpen);
    }
    if application_id != 0 {
        return Err(StoreError::InvalidApplicationId {
            found: application_id,
            expected: 0,
        });
    }

    let version = schema_version(conn)?;
    if version > SHIFT_DOCUMENT_SCHEMA_VERSION {
        return Err(StoreError::UnsupportedSchemaVersion {
            found: version,
            supported: SHIFT_DOCUMENT_SCHEMA_VERSION,
        });
    }

    if version < OLDEST_MIGRATABLE_SCHEMA_VERSION {
        conn.execute_batch(DOCUMENT_SCHEMA)?;
        conn.execute_batch(WORKSPACE_SCHEMA_V1)?;
        conn.pragma_update(None, "user_version", SHIFT_DOCUMENT_SCHEMA_VERSION)?;
    } else {
        migrate(conn, version, SHIFT_DOCUMENT_SCHEMA_VERSION)?;
    }

    Ok(())
}

pub(crate) fn initialize_document(conn: &rusqlite::Connection) -> Result<(), StoreError> {
    let application_id = application_id(conn)?;
    if application_id != 0 {
        return Err(StoreError::InvalidApplicationId {
            found: application_id,
            expected: 0,
        });
    }

    let version = schema_version(conn)?;
    if version != 0 {
        return Err(StoreError::UnsupportedDocumentSchemaVersion {
            found: version,
            supported: SHIFT_DOCUMENT_SCHEMA_VERSION,
        });
    }

    conn.execute_batch(DOCUMENT_SCHEMA)?;
    conn.pragma_update(None, "application_id", SHIFT_APPLICATION_ID)?;
    conn.pragma_update(None, "user_version", SHIFT_DOCUMENT_SCHEMA_VERSION)?;
    Ok(())
}

/// Checks that `conn` is a Shift document this app can open and returns its
/// schema version, which may be older than current and need [`migrate`].
///
/// # Errors
///
/// Returns an error for a non-document file or a schema version outside
/// [`OLDEST_MIGRATABLE_SCHEMA_VERSION`]..=[`SHIFT_DOCUMENT_SCHEMA_VERSION`].
pub(crate) fn validate_document_header(conn: &rusqlite::Connection) -> Result<i64, StoreError> {
    let application_id = application_id(conn)?;
    if application_id != SHIFT_APPLICATION_ID {
        return Err(StoreError::InvalidApplicationId {
            found: application_id,
            expected: SHIFT_APPLICATION_ID,
        });
    }

    let version = schema_version(conn)?;
    if !(OLDEST_MIGRATABLE_SCHEMA_VERSION..=SHIFT_DOCUMENT_SCHEMA_VERSION).contains(&version) {
        return Err(StoreError::UnsupportedDocumentSchemaVersion {
            found: version,
            supported: SHIFT_DOCUMENT_SCHEMA_VERSION,
        });
    }

    Ok(version)
}

fn application_id(conn: &rusqlite::Connection) -> Result<i64, StoreError> {
    conn.query_row("PRAGMA application_id", [], |row| row.get(0))
        .map_err(StoreError::from)
}

fn schema_version(conn: &rusqlite::Connection) -> Result<i64, StoreError> {
    conn.query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(StoreError::from)
}
