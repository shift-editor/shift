use std::collections::{BTreeMap, HashMap, HashSet};

use rusqlite::{Connection, Transaction};

use crate::StoreError;

const NO_BASE_FALLBACK_COLUMNS: &[&str] = &[];
const FONT_INFO_BASE_FALLBACK_COLUMNS: &[&str] = &["sample_text", "vendor_id"];
const SOURCE_BASE_FALLBACK_COLUMNS: &[&str] = &["family_name", "style_name"];

/// Declares how one canonical table participates in sparse recovery.
///
/// `OverlayRows` writers persist complete authored rows; `base_fallback_columns`
/// are limited to store-only values absent from the font model. Collection
/// replacements persist the complete final collection for each marked owner;
/// parent collections preserve matching identities so cascades affect only
/// deleted parents, while leaf collections are replaced wholesale.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum RecoveryMode {
    OverlayRows {
        tombstone_kind: Option<&'static str>,
        base_fallback_columns: &'static [&'static str],
    },
    ReplaceCollection {
        owner_column: Option<&'static str>,
        preserve_matching_rows: bool,
    },
    CanonicalOnly,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct RecoveryTable {
    name: &'static str,
    mode: RecoveryMode,
}

impl RecoveryTable {
    const fn overlay_rows(
        name: &'static str,
        tombstone_kind: Option<&'static str>,
        base_fallback_columns: &'static [&'static str],
    ) -> Self {
        Self {
            name,
            mode: RecoveryMode::OverlayRows {
                tombstone_kind,
                base_fallback_columns,
            },
        }
    }

    const fn replace_collection(
        name: &'static str,
        owner_column: Option<&'static str>,
        preserve_matching_rows: bool,
    ) -> Self {
        Self {
            name,
            mode: RecoveryMode::ReplaceCollection {
                owner_column,
                preserve_matching_rows,
            },
        }
    }

    const fn canonical_only(name: &'static str) -> Self {
        Self {
            name,
            mode: RecoveryMode::CanonicalOnly,
        }
    }

    pub(super) const fn name(self) -> &'static str {
        self.name
    }

    pub(super) const fn mode(self) -> RecoveryMode {
        self.mode
    }

    pub(super) fn tombstone_kind(self) -> Option<&'static str> {
        match self.mode {
            RecoveryMode::OverlayRows { tombstone_kind, .. } => tombstone_kind,
            RecoveryMode::ReplaceCollection { .. } | RecoveryMode::CanonicalOnly => None,
        }
    }

    pub(super) const fn preserve_matching_rows(self) -> bool {
        match self.mode {
            RecoveryMode::ReplaceCollection {
                preserve_matching_rows,
                ..
            } => preserve_matching_rows,
            RecoveryMode::OverlayRows { .. } | RecoveryMode::CanonicalOnly => false,
        }
    }
}

pub(super) const FONT_INFO: RecoveryTable =
    RecoveryTable::overlay_rows("font_info", None, FONT_INFO_BASE_FALLBACK_COLUMNS);
pub(super) const METRIC_DEFINITIONS: RecoveryTable =
    RecoveryTable::replace_collection("metric_definitions", None, true);
pub(super) const AXES: RecoveryTable =
    RecoveryTable::overlay_rows("axes", Some("axis"), NO_BASE_FALLBACK_COLUMNS);
pub(super) const AXIS_MAPPINGS: RecoveryTable =
    RecoveryTable::replace_collection("axis_mappings", None, false);
pub(super) const NAMED_INSTANCES: RecoveryTable =
    RecoveryTable::replace_collection("named_instances", None, false);
pub(super) const SOURCES: RecoveryTable =
    RecoveryTable::overlay_rows("sources", Some("source"), SOURCE_BASE_FALLBACK_COLUMNS);
pub(super) const GLYPHS: RecoveryTable =
    RecoveryTable::overlay_rows("glyphs", Some("glyph"), NO_BASE_FALLBACK_COLUMNS);
pub(super) const GLYPH_UNICODES: RecoveryTable =
    RecoveryTable::replace_collection("glyph_unicodes", Some("glyph_id"), false);
pub(super) const FONT_GUIDELINES: RecoveryTable = RecoveryTable::canonical_only("font_guidelines");
pub(super) const SOURCE_LOCATIONS: RecoveryTable =
    RecoveryTable::replace_collection("source_locations", Some("source_id"), false);
pub(super) const SOURCE_METRIC_VALUES: RecoveryTable =
    RecoveryTable::replace_collection("source_metric_values", Some("source_id"), false);
pub(super) const FEATURE_TEXT: RecoveryTable = RecoveryTable::canonical_only("feature_text");
pub(super) const KERNING_GROUPS: RecoveryTable = RecoveryTable::canonical_only("kerning_groups");
pub(super) const KERNING_GROUP_MEMBERS: RecoveryTable =
    RecoveryTable::canonical_only("kerning_group_members");
pub(super) const KERNING_PAIRS: RecoveryTable = RecoveryTable::canonical_only("kerning_pairs");
pub(super) const FONT_LIB: RecoveryTable = RecoveryTable::canonical_only("font_lib");
pub(super) const FONTINFO_REMAINDER: RecoveryTable =
    RecoveryTable::canonical_only("fontinfo_remainder");
pub(super) const SOURCE_LIB: RecoveryTable =
    RecoveryTable::replace_collection("source_lib", Some("source_id"), false);
pub(super) const GLYPH_LIB: RecoveryTable =
    RecoveryTable::replace_collection("glyph_lib", Some("glyph_id"), false);
pub(super) const FONT_BINARIES: RecoveryTable = RecoveryTable::canonical_only("font_binaries");
pub(super) const GLYPH_LAYERS: RecoveryTable =
    RecoveryTable::overlay_rows("glyph_layers", Some("layer"), NO_BASE_FALLBACK_COLUMNS);
pub(super) const GLYPH_LAYER_PAYLOADS: RecoveryTable =
    RecoveryTable::overlay_rows("glyph_layer_payloads", None, NO_BASE_FALLBACK_COLUMNS);
pub(super) const GLYPH_COMPONENTS: RecoveryTable =
    RecoveryTable::replace_collection("glyph_components", Some("layer_id"), false);
pub(super) const DOCUMENT_METADATA: RecoveryTable =
    RecoveryTable::canonical_only("document_metadata");

const RECOVERY_TABLES: &[RecoveryTable] = &[
    FONT_INFO,
    METRIC_DEFINITIONS,
    AXES,
    AXIS_MAPPINGS,
    NAMED_INSTANCES,
    SOURCES,
    GLYPHS,
    GLYPH_UNICODES,
    FONT_GUIDELINES,
    SOURCE_LOCATIONS,
    SOURCE_METRIC_VALUES,
    FEATURE_TEXT,
    KERNING_GROUPS,
    KERNING_GROUP_MEMBERS,
    KERNING_PAIRS,
    FONT_LIB,
    FONTINFO_REMAINDER,
    SOURCE_LIB,
    GLYPH_LIB,
    FONT_BINARIES,
    GLYPH_LAYERS,
    GLYPH_LAYER_PAYLOADS,
    GLYPH_COMPONENTS,
    DOCUMENT_METADATA,
];

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct ForeignKey {
    pub(super) parent_table: String,
    pub(super) on_delete: String,
    pub(super) columns: Vec<ForeignKeyColumn>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct ForeignKeyColumn {
    pub(super) child: String,
    pub(super) parent: String,
}

pub(super) struct RecoveryTableShape {
    pub(super) table: RecoveryTable,
    pub(super) columns: Vec<String>,
    pub(super) primary_key: Vec<String>,
    pub(super) foreign_keys: Vec<ForeignKey>,
}

pub(super) fn load_recovery_table_shapes(
    conn: &Connection,
) -> Result<Vec<RecoveryTableShape>, StoreError> {
    let mut tables = Vec::with_capacity(RECOVERY_TABLES.len());
    let positions = RECOVERY_TABLES
        .iter()
        .enumerate()
        .map(|(index, table)| (table.name(), index))
        .collect::<HashMap<_, _>>();

    for (index, table) in RECOVERY_TABLES.iter().copied().enumerate() {
        let main = load_table_shape(conn, "main", table.name())?;
        let recovery = load_table_shape(conn, "recovery", table.name())?;
        if main != recovery {
            return Err(StoreError::InvalidDocument(format!(
                "recovery table {} does not match the canonical schema",
                table.name()
            )));
        }
        if main.columns.is_empty() {
            return Err(StoreError::InvalidDocument(format!(
                "missing recovery table {}",
                table.name()
            )));
        }
        if main.primary_key.is_empty() {
            return Err(StoreError::InvalidDocument(format!(
                "recovery table {} has no primary key",
                table.name()
            )));
        }

        if table.tombstone_kind().is_some() && main.primary_key.len() != 1 {
            return Err(StoreError::InvalidDocument(format!(
                "tombstoned recovery table {} must have one primary-key column",
                table.name()
            )));
        }

        match table.mode() {
            RecoveryMode::OverlayRows {
                base_fallback_columns,
                ..
            } => {
                for column in base_fallback_columns {
                    if !main.columns.iter().any(|candidate| candidate == column) {
                        return Err(StoreError::InvalidDocument(format!(
                            "recovery table {} is missing base fallback column {column}",
                            table.name()
                        )));
                    }
                }
            }
            RecoveryMode::ReplaceCollection {
                owner_column: Some(owner_column),
                ..
            } => {
                if !main.columns.iter().any(|column| column == owner_column) {
                    return Err(StoreError::InvalidDocument(format!(
                        "recovery table {} is missing owner column {owner_column}",
                        table.name()
                    )));
                }
            }
            RecoveryMode::ReplaceCollection {
                owner_column: None, ..
            }
            | RecoveryMode::CanonicalOnly => {}
        }

        for foreign_key in &main.foreign_keys {
            if let Some(parent_index) = positions.get(foreign_key.parent_table.as_str())
                && *parent_index >= index
                && foreign_key.parent_table != table.name()
            {
                return Err(StoreError::InvalidDocument(format!(
                    "recovery table {} must follow parent table {}",
                    table.name(),
                    foreign_key.parent_table
                )));
            }
        }

        tables.push(RecoveryTableShape {
            table,
            columns: main.columns,
            primary_key: main.primary_key,
            foreign_keys: main.foreign_keys,
        });
    }

    let referenced_tables = tables
        .iter()
        .flat_map(|table| &table.foreign_keys)
        .map(|foreign_key| foreign_key.parent_table.as_str())
        .collect::<HashSet<_>>();
    for table in &tables {
        if matches!(table.table.mode(), RecoveryMode::ReplaceCollection { .. })
            && referenced_tables.contains(table.table.name())
            && !table.table.preserve_matching_rows()
        {
            return Err(StoreError::InvalidDocument(format!(
                "parent recovery collection {} must preserve matching rows",
                table.table.name()
            )));
        }

        for foreign_key in &table.foreign_keys {
            let parent = RECOVERY_TABLES
                .iter()
                .find(|candidate| candidate.name() == foreign_key.parent_table);
            if parent.is_some_and(|parent| parent.preserve_matching_rows())
                && foreign_key.on_delete != "CASCADE"
            {
                return Err(StoreError::InvalidDocument(format!(
                    "recovery collection {} requires cascading child table {}",
                    foreign_key.parent_table,
                    table.table.name()
                )));
            }
        }
    }

    Ok(tables)
}

pub(super) fn clear_recovery(tx: &Transaction<'_>) -> Result<(), StoreError> {
    for table in RECOVERY_TABLES.iter().rev() {
        tx.execute(&format!("DELETE FROM {}", identifier(table.name())), [])?;
    }
    tx.execute("DELETE FROM recovery_replacements", [])?;
    tx.execute("DELETE FROM recovery_tombstones", [])?;
    Ok(())
}

#[derive(Debug, Eq, PartialEq)]
struct StoredTableShape {
    columns: Vec<String>,
    primary_key: Vec<String>,
    foreign_keys: Vec<ForeignKey>,
}

fn load_table_shape(
    conn: &Connection,
    database: &str,
    table: &str,
) -> Result<StoredTableShape, StoreError> {
    let mut columns_statement = conn.prepare(&format!(
        "PRAGMA {}.table_info({})",
        identifier(database),
        identifier(table)
    ))?;
    let stored_columns = columns_statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(1)?, row.get::<_, i64>(5)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let columns = stored_columns
        .iter()
        .map(|(name, _)| name.clone())
        .collect::<Vec<_>>();
    let mut primary_key = stored_columns
        .into_iter()
        .filter(|(_, order)| *order > 0)
        .collect::<Vec<_>>();
    primary_key.sort_by_key(|(_, order)| *order);
    let primary_key = primary_key
        .into_iter()
        .map(|(name, _)| name)
        .collect::<Vec<_>>();

    let mut foreign_key_statement = conn.prepare(&format!(
        "PRAGMA {}.foreign_key_list({})",
        identifier(database),
        identifier(table)
    ))?;
    let stored_foreign_keys = foreign_key_statement
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, String>(6)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut grouped = BTreeMap::<i64, (String, String, Vec<(i64, ForeignKeyColumn)>)>::new();
    for (id, sequence, parent_table, child, parent, on_delete) in stored_foreign_keys {
        let parent = parent.ok_or_else(|| {
            StoreError::InvalidDocument(format!(
                "table {table} has a foreign key with an implicit parent column"
            ))
        })?;
        let entry = grouped
            .entry(id)
            .or_insert_with(|| (parent_table, on_delete, Vec::new()));
        entry.2.push((sequence, ForeignKeyColumn { child, parent }));
    }
    let foreign_keys = grouped
        .into_values()
        .map(|(parent_table, on_delete, mut columns)| {
            columns.sort_by_key(|(sequence, _)| *sequence);
            ForeignKey {
                parent_table,
                on_delete,
                columns: columns.into_iter().map(|(_, column)| column).collect(),
            }
        })
        .collect();

    Ok(StoredTableShape {
        columns,
        primary_key,
        foreign_keys,
    })
}

pub(super) fn matching_columns(left_alias: &str, right_alias: &str, columns: &[String]) -> String {
    columns
        .iter()
        .map(|column| {
            let column = identifier(column);
            format!("{left_alias}.{column} = {right_alias}.{column}")
        })
        .collect::<Vec<_>>()
        .join(" AND ")
}

pub(super) fn identifier(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

pub(super) fn string_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;

    #[test]
    fn recovery_catalog_classifies_every_document_table() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(crate::schema::DOCUMENT_SCHEMA_V1)
            .unwrap();
        let mut statement = conn
            .prepare(
                "SELECT name FROM sqlite_schema
                 WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
                 ORDER BY name",
            )
            .unwrap();
        let schema_tables = statement
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<Result<HashSet<_>, _>>()
            .unwrap();
        let catalog_tables = RECOVERY_TABLES
            .iter()
            .map(|table| table.name().to_string())
            .collect::<HashSet<_>>();

        assert_eq!(catalog_tables, schema_tables);
        assert_eq!(catalog_tables.len(), RECOVERY_TABLES.len());
    }

    #[test]
    fn recovery_catalog_rejects_a_different_overlay_shape() {
        let temp = tempfile::tempdir().unwrap();
        let recovery_path = temp.path().join("recovery.sqlite");
        let recovery = Connection::open(&recovery_path).unwrap();
        recovery
            .execute_batch(crate::schema::DOCUMENT_SCHEMA_V1)
            .unwrap();
        drop(recovery);

        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(crate::schema::DOCUMENT_SCHEMA_V1)
            .unwrap();
        conn.execute(
            "ATTACH DATABASE ?1 AS recovery",
            [recovery_path.to_str().unwrap()],
        )
        .unwrap();
        assert!(load_recovery_table_shapes(&conn).is_ok());

        conn.execute_batch("ALTER TABLE recovery.sources ADD COLUMN unexpected TEXT")
            .unwrap();
        assert!(matches!(
            load_recovery_table_shapes(&conn),
            Err(StoreError::InvalidDocument(_))
        ));
    }
}
