use crate::StoreError;

pub(crate) const SCHEMA_V1: &str = r#"
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
    ascender REAL NOT NULL,
    descender REAL NOT NULL,
    cap_height REAL,
    x_height REAL,
    line_gap REAL,
    italic_angle REAL,
    underline_position REAL,
    underline_thickness REAL,
    default_source_id TEXT
);

CREATE TABLE IF NOT EXISTS axes (
    id TEXT PRIMARY KEY,
    tag TEXT NOT NULL,
    name TEXT NOT NULL,
    min_value REAL NOT NULL,
    default_value REAL NOT NULL,
    max_value REAL NOT NULL,
    hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
    order_index INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS axes_tag_unique
ON axes(tag);

CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    name TEXT,
    family_name TEXT,
    style_name TEXT,
    filename TEXT,
    color TEXT,
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

CREATE INDEX IF NOT EXISTS glyph_unicodes_glyph_id_idx
ON glyph_unicodes(glyph_id);

CREATE TABLE IF NOT EXISTS glyph_layers (
    id TEXT PRIMARY KEY,
    glyph_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    name TEXT,
    width REAL NOT NULL DEFAULT 0,
    height REAL,
    FOREIGN KEY (glyph_id) REFERENCES glyphs(id) ON DELETE CASCADE,
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS glyph_layers_glyph_id_idx
ON glyph_layers(glyph_id);

CREATE INDEX IF NOT EXISTS glyph_layers_source_id_idx
ON glyph_layers(source_id);

CREATE TABLE IF NOT EXISTS glyph_layer_contours (
    id TEXT PRIMARY KEY,
    layer_id TEXT NOT NULL,
    closed INTEGER NOT NULL DEFAULT 0 CHECK (closed IN (0, 1)),
    order_index INTEGER NOT NULL,
    FOREIGN KEY (layer_id) REFERENCES glyph_layers(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS glyph_layer_contours_layer_order_unique
ON glyph_layer_contours(layer_id, order_index);

CREATE INDEX IF NOT EXISTS glyph_layer_contours_layer_id_idx
ON glyph_layer_contours(layer_id);

CREATE TABLE IF NOT EXISTS glyph_layer_points (
    id TEXT PRIMARY KEY,
    contour_id TEXT NOT NULL,
    order_index INTEGER NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    point_type TEXT NOT NULL,
    smooth INTEGER NOT NULL DEFAULT 0 CHECK (smooth IN (0, 1)),
    FOREIGN KEY (contour_id) REFERENCES glyph_layer_contours(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS glyph_layer_points_contour_order_unique
ON glyph_layer_points(contour_id, order_index);

CREATE INDEX IF NOT EXISTS glyph_layer_points_contour_id_idx
ON glyph_layer_points(contour_id);

CREATE TABLE IF NOT EXISTS glyph_components (
    id TEXT PRIMARY KEY,
    layer_id TEXT NOT NULL,
    base_glyph_id TEXT NOT NULL,
    base_glyph_name TEXT NOT NULL,
    translate_x REAL NOT NULL DEFAULT 0,
    translate_y REAL NOT NULL DEFAULT 0,
    rotation REAL NOT NULL DEFAULT 0,
    scale_x REAL NOT NULL DEFAULT 1,
    scale_y REAL NOT NULL DEFAULT 1,
    skew_x REAL NOT NULL DEFAULT 0,
    skew_y REAL NOT NULL DEFAULT 0,
    t_center_x REAL NOT NULL DEFAULT 0,
    t_center_y REAL NOT NULL DEFAULT 0,
    order_index INTEGER NOT NULL,
    FOREIGN KEY (layer_id) REFERENCES glyph_layers(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS glyph_components_layer_order_unique
ON glyph_components(layer_id, order_index);

CREATE INDEX IF NOT EXISTS glyph_components_layer_id_idx
ON glyph_components(layer_id);

CREATE INDEX IF NOT EXISTS glyph_components_base_glyph_id_idx
ON glyph_components(base_glyph_id);

CREATE TABLE IF NOT EXISTS glyph_layer_anchors (
    id TEXT PRIMARY KEY,
    layer_id TEXT NOT NULL,
    name TEXT,
    x REAL NOT NULL,
    y REAL NOT NULL,
    order_index INTEGER NOT NULL,
    FOREIGN KEY (layer_id) REFERENCES glyph_layers(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS glyph_layer_anchors_layer_order_unique
ON glyph_layer_anchors(layer_id, order_index);

CREATE INDEX IF NOT EXISTS glyph_layer_anchors_layer_id_idx
ON glyph_layer_anchors(layer_id);

CREATE TABLE IF NOT EXISTS font_guidelines (
    id TEXT PRIMARY KEY,
    x REAL,
    y REAL,
    angle REAL,
    name TEXT,
    color TEXT,
    order_index INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS glyph_layer_guidelines (
    id TEXT PRIMARY KEY,
    layer_id TEXT NOT NULL,
    x REAL,
    y REAL,
    angle REAL,
    name TEXT,
    color TEXT,
    order_index INTEGER NOT NULL,
    FOREIGN KEY (layer_id) REFERENCES glyph_layers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS glyph_layer_guidelines_layer_id_idx
ON glyph_layer_guidelines(layer_id);

CREATE TABLE IF NOT EXISTS source_locations (
    source_id TEXT NOT NULL,
    axis_id TEXT NOT NULL,
    value REAL NOT NULL,
    PRIMARY KEY (source_id, axis_id),
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE,
    FOREIGN KEY (axis_id) REFERENCES axes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS feature_text (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    fea_source TEXT
);

CREATE TABLE IF NOT EXISTS kerning_groups (
    side INTEGER NOT NULL CHECK (side IN (1, 2)),
    name TEXT NOT NULL,
    PRIMARY KEY (side, name)
);

CREATE TABLE IF NOT EXISTS kerning_group_members (
    side INTEGER NOT NULL CHECK (side IN (1, 2)),
    group_name TEXT NOT NULL,
    glyph_name TEXT NOT NULL,
    order_index INTEGER NOT NULL,
    PRIMARY KEY (side, group_name, order_index),
    FOREIGN KEY (side, group_name) REFERENCES kerning_groups(side, name) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS kerning_pairs (
    order_index INTEGER PRIMARY KEY,
    first_kind TEXT NOT NULL CHECK (first_kind IN ('glyph', 'group')),
    first_value TEXT NOT NULL,
    second_kind TEXT NOT NULL CHECK (second_kind IN ('glyph', 'group')),
    second_value TEXT NOT NULL,
    value REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS font_lib (
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

CREATE TABLE IF NOT EXISTS glyph_layer_lib (
    layer_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    PRIMARY KEY (layer_id, key),
    FOREIGN KEY (layer_id) REFERENCES glyph_layers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS font_binaries (
    kind TEXT NOT NULL CHECK (kind IN ('data', 'image')),
    path TEXT NOT NULL,
    bytes BLOB NOT NULL,
    PRIMARY KEY (kind, path)
);

CREATE TABLE IF NOT EXISTS workspace_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    document_id TEXT,
    source_kind TEXT NOT NULL CHECK (source_kind IN ('untitled', 'package', 'imported')),
    source_path TEXT,
    canonical_source_path TEXT,
    original_import_path TEXT,
    source_package_id TEXT,
    source_file_identity_kind TEXT,
    source_file_identity_value TEXT,
    source_size INTEGER,
    source_mtime_ms INTEGER,
    source_fingerprint TEXT,
    dirty INTEGER NOT NULL DEFAULT 0 CHECK (dirty IN (0, 1)),
    revision INTEGER NOT NULL DEFAULT 0,
    saved_revision INTEGER NOT NULL DEFAULT 0,
    updated_at_ms INTEGER NOT NULL
);
"#;

pub(crate) const SCHEMA_VERSION: i64 = 1;

/// Creates the baseline schema and stamps `user_version`.
///
/// Pre-release policy: the app has not shipped, so schema changes edit the
/// baseline batch in place instead of adding migration steps. A database
/// from a NEWER app version is refused rather than silently mangled.
pub(crate) fn ensure_current(conn: &rusqlite::Connection) -> Result<(), StoreError> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;

    if version > SCHEMA_VERSION {
        return Err(StoreError::UnsupportedSchemaVersion {
            found: version,
            supported: SCHEMA_VERSION,
        });
    }

    if version < 1 {
        conn.execute_batch(SCHEMA_V1)?;
        conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    }

    Ok(())
}
