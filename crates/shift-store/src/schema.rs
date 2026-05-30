use crate::StoreError;

pub(crate) const SCHEMA_V1: &str = r#"
CREATE TABLE IF NOT EXISTS font_info (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    family_name TEXT,
    copyright TEXT,
    trademark TEXT,
    description TEXT,
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
    units_per_em INTEGER NOT NULL CHECK (units_per_em > 0)
);

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

CREATE TABLE IF NOT EXISTS glyph_layers (
    id TEXT PRIMARY KEY,
    glyph_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    name TEXT,
    FOREIGN KEY (glyph_id) REFERENCES glyphs(id) ON DELETE CASCADE,
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS glyph_layers_glyph_source_unique
ON glyph_layers(glyph_id, source_id);

CREATE INDEX IF NOT EXISTS glyph_layers_glyph_id_idx
ON glyph_layers(glyph_id);

CREATE INDEX IF NOT EXISTS glyph_layers_source_id_idx
ON glyph_layers(source_id);

CREATE TABLE IF NOT EXISTS glyph_components (
    id TEXT PRIMARY KEY,
    layer_id TEXT NOT NULL,
    base_glyph_id TEXT NOT NULL,
    order_index INTEGER NOT NULL,
    FOREIGN KEY (layer_id) REFERENCES glyph_layers(id) ON DELETE CASCADE,
    FOREIGN KEY (base_glyph_id) REFERENCES glyphs(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS glyph_components_layer_order_unique
ON glyph_components(layer_id, order_index);

CREATE INDEX IF NOT EXISTS glyph_components_layer_id_idx
ON glyph_components(layer_id);

CREATE INDEX IF NOT EXISTS glyph_components_base_glyph_id_idx
ON glyph_components(base_glyph_id);

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
