use std::path::Path;

use rusqlite::Connection;

use super::catalog::{
    RecoveryMode, RecoveryTableShape, identifier, load_recovery_table_shapes, matching_columns,
    string_literal,
};
use crate::StoreError;

pub(super) fn attach_recovery(conn: &Connection, path: &Path) -> Result<(), StoreError> {
    let path = path
        .to_str()
        .ok_or_else(|| StoreError::InvalidDocument("recovery path is not valid UTF-8".into()))?;
    conn.execute("ATTACH DATABASE ?1 AS recovery", [path])?;
    Ok(())
}

pub(super) fn install_merged_views(conn: &Connection) -> Result<(), StoreError> {
    let tables = load_recovery_table_shapes(conn)?;
    for table in &tables {
        conn.execute_batch(&merged_view_sql(table))?;
    }
    Ok(())
}

fn merged_view_sql(table: &RecoveryTableShape) -> String {
    let name = identifier(table.table.name());
    let main_projection = projection(&table.columns, "m", None, &[]);
    let main_parent_visibility = parent_visibility(table, "m");

    let select = match table.table.mode() {
        RecoveryMode::CanonicalOnly => format!(
            "SELECT {main_projection} FROM main.{name} AS m{}",
            where_clause(main_parent_visibility)
        ),
        RecoveryMode::OverlayRows {
            tombstone_kind,
            base_fallback_columns,
        } => {
            let recovery_projection =
                projection(&table.columns, "r", Some("m"), base_fallback_columns);
            let base_join = (!base_fallback_columns.is_empty()).then(|| {
                format!(
                    " LEFT JOIN main.{name} AS m ON {}",
                    matching_columns("r", "m", &table.primary_key)
                )
            });
            let mut recovery_predicates = parent_visibility(table, "r");
            let mut main_predicates = parent_visibility(table, "m");
            main_predicates.push(format!(
                "NOT EXISTS (SELECT 1 FROM recovery.{name} AS r WHERE {})",
                matching_columns("r", "m", &table.primary_key)
            ));
            if let Some(kind) = tombstone_kind {
                let primary_key = identifier(&table.primary_key[0]);
                recovery_predicates.push(tombstone_absent(kind, "r", &primary_key));
                main_predicates.push(tombstone_absent(kind, "m", &primary_key));
            }

            format!(
                "SELECT {recovery_projection} FROM recovery.{name} AS r{}{}\nUNION ALL\nSELECT {main_projection} FROM main.{name} AS m{}",
                base_join.unwrap_or_default(),
                where_clause(recovery_predicates),
                where_clause(main_predicates)
            )
        }
        RecoveryMode::ReplaceCollection { owner_column, .. } => {
            let recovery_projection = projection(&table.columns, "r", None, &[]);
            let mut recovery_predicates = parent_visibility(table, "r");
            let mut main_predicates = parent_visibility(table, "m");
            recovery_predicates.push(replacement_marker(
                table.table.name(),
                owner_column.map(|column| ("r", column)),
                false,
            ));
            main_predicates.push(replacement_marker(
                table.table.name(),
                owner_column.map(|column| ("m", column)),
                true,
            ));

            format!(
                "SELECT {recovery_projection} FROM recovery.{name} AS r{}\nUNION ALL\nSELECT {main_projection} FROM main.{name} AS m{}",
                where_clause(recovery_predicates),
                where_clause(main_predicates)
            )
        }
    };

    format!("CREATE TEMP VIEW {name} AS\n{select};")
}

fn projection(
    columns: &[String],
    row_alias: &str,
    base_alias: Option<&str>,
    base_fallback_columns: &[&str],
) -> String {
    columns
        .iter()
        .map(|column| {
            let quoted = identifier(column);
            if base_fallback_columns.contains(&column.as_str()) {
                format!(
                    "COALESCE({row_alias}.{quoted}, {}.{quoted}) AS {quoted}",
                    base_alias.expect("base fallback projection requires a base row")
                )
            } else {
                format!("{row_alias}.{quoted} AS {quoted}")
            }
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn parent_visibility(table: &RecoveryTableShape, row_alias: &str) -> Vec<String> {
    table
        .foreign_keys
        .iter()
        .map(|foreign_key| {
            let nullable = foreign_key
                .columns
                .iter()
                .map(|column| format!("{row_alias}.{} IS NULL", identifier(&column.child)))
                .collect::<Vec<_>>()
                .join(" OR ");
            let matches = foreign_key
                .columns
                .iter()
                .map(|column| {
                    format!(
                        "p.{} = {row_alias}.{}",
                        identifier(&column.parent),
                        identifier(&column.child)
                    )
                })
                .collect::<Vec<_>>()
                .join(" AND ");
            format!(
                "(({nullable}) OR EXISTS (
                    SELECT 1 FROM temp.{} AS p WHERE {matches}
                ))",
                identifier(&foreign_key.parent_table)
            )
        })
        .collect()
}

fn tombstone_absent(kind: &str, row_alias: &str, primary_key: &str) -> String {
    format!(
        "NOT EXISTS (
            SELECT 1 FROM recovery.recovery_tombstones AS t
            WHERE t.entity_kind = {}
              AND t.entity_id = {row_alias}.{primary_key}
        )",
        string_literal(kind)
    )
}

fn replacement_marker(table: &str, owner: Option<(&str, &str)>, negated: bool) -> String {
    let owner = match owner {
        Some((row_alias, column)) => format!("{row_alias}.{}", identifier(column)),
        None => "''".to_string(),
    };
    format!(
        "{}EXISTS (
            SELECT 1 FROM recovery.recovery_replacements AS x
            WHERE x.collection = {}
              AND x.owner_id = {owner}
        )",
        if negated { "NOT " } else { "" },
        string_literal(table)
    )
}

fn where_clause(predicates: Vec<String>) -> String {
    if predicates.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", predicates.join(" AND "))
    }
}
