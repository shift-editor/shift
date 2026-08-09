use std::collections::HashSet;

use rusqlite::{Connection, Transaction};

use super::catalog::{
    RecoveryMode, RecoveryTableShape, identifier, load_recovery_table_shapes, matching_columns,
    string_literal,
};
use crate::{CommitId, StoreError};

pub(super) fn apply_recovery_to_document(
    conn: &mut Connection,
    commit_id: &CommitId,
) -> Result<(), StoreError> {
    let tx = conn.transaction()?;
    apply_recovery(&tx)?;
    tx.execute(
        "UPDATE main.document_metadata SET saved_commit_id = ?1 WHERE id = 1",
        [commit_id.as_str()],
    )?;
    tx.commit()?;
    Ok(())
}

fn apply_recovery(tx: &Transaction<'_>) -> Result<(), StoreError> {
    let tables = load_recovery_table_shapes(tx)?;

    for table in tables.iter().rev() {
        delete_replaced_rows(tx, table, table.table.preserve_matching_rows())?;
    }

    for table in &tables {
        upsert_recovery_rows(tx, table, table.table.preserve_matching_rows())?;
    }

    Ok(())
}

fn delete_replaced_rows(
    tx: &Transaction<'_>,
    table: &RecoveryTableShape,
    preserve_matching_rows: bool,
) -> Result<(), StoreError> {
    let name = identifier(table.table.name());
    let absent_from_final = if preserve_matching_rows {
        format!(
            " AND NOT EXISTS (
                 SELECT 1 FROM temp.{name} AS v WHERE {}
             )",
            matching_columns("v", "m", &table.primary_key)
        )
    } else {
        String::new()
    };
    let sql = match table.table.mode() {
        RecoveryMode::OverlayRows {
            tombstone_kind: Some(kind),
            ..
        } => format!(
            "DELETE FROM main.{name} AS m
             WHERE EXISTS (
                 SELECT 1 FROM recovery.recovery_tombstones AS t
                 WHERE t.entity_kind = {}
                   AND t.entity_id = m.{}
             )",
            string_literal(kind),
            identifier(&table.primary_key[0])
        ),
        RecoveryMode::ReplaceCollection {
            owner_column: None, ..
        } => format!(
            "DELETE FROM main.{name} AS m
             WHERE EXISTS (
                 SELECT 1 FROM recovery.recovery_replacements AS x
                 WHERE x.collection = {} AND x.owner_id = ''
             ){absent_from_final}",
            string_literal(table.table.name())
        ),
        RecoveryMode::ReplaceCollection {
            owner_column: Some(owner_column),
            ..
        } => format!(
            "DELETE FROM main.{name} AS m
             WHERE EXISTS (
                 SELECT 1 FROM recovery.recovery_replacements AS x
                 WHERE x.collection = {}
                   AND x.owner_id = m.{}
             ){absent_from_final}",
            string_literal(table.table.name()),
            identifier(owner_column)
        ),
        RecoveryMode::OverlayRows {
            tombstone_kind: None,
            ..
        }
        | RecoveryMode::CanonicalOnly => return Ok(()),
    };
    tx.execute(&sql, [])?;
    Ok(())
}

fn upsert_recovery_rows(
    tx: &Transaction<'_>,
    table: &RecoveryTableShape,
    preserve_matching_rows: bool,
) -> Result<(), StoreError> {
    let scope = match table.table.mode() {
        RecoveryMode::OverlayRows { .. } => format!(
            "EXISTS (
                SELECT 1 FROM recovery.{} AS r WHERE {}
            )",
            identifier(table.table.name()),
            matching_columns("r", "v", &table.primary_key)
        ),
        RecoveryMode::ReplaceCollection {
            owner_column: None, ..
        } => format!(
            "EXISTS (
                SELECT 1 FROM recovery.recovery_replacements AS x
                WHERE x.collection = {} AND x.owner_id = ''
            )",
            string_literal(table.table.name())
        ),
        RecoveryMode::ReplaceCollection {
            owner_column: Some(owner_column),
            ..
        } => format!(
            "EXISTS (
                SELECT 1 FROM recovery.recovery_replacements AS x
                WHERE x.collection = {}
                  AND x.owner_id = v.{}
            )",
            string_literal(table.table.name()),
            identifier(owner_column)
        ),
        RecoveryMode::CanonicalOnly => return Ok(()),
    };

    let name = identifier(table.table.name());
    let columns = table
        .columns
        .iter()
        .map(|column| identifier(column))
        .collect::<Vec<_>>()
        .join(", ");
    let selected_columns = table
        .columns
        .iter()
        .map(|column| format!("v.{}", identifier(column)))
        .collect::<Vec<_>>()
        .join(", ");
    let conflict_columns = table
        .primary_key
        .iter()
        .map(|column| identifier(column))
        .collect::<Vec<_>>()
        .join(", ");
    let primary_key = table.primary_key.iter().collect::<HashSet<_>>();
    let updates = table
        .columns
        .iter()
        .filter(|column| !primary_key.contains(column))
        .map(|column| {
            let column = identifier(column);
            format!("{column} = excluded.{column}")
        })
        .collect::<Vec<_>>();
    let conflict = if matches!(table.table.mode(), RecoveryMode::ReplaceCollection { .. })
        && !preserve_matching_rows
    {
        String::new()
    } else if updates.is_empty() {
        format!("ON CONFLICT ({conflict_columns}) DO NOTHING")
    } else {
        format!(
            "ON CONFLICT ({conflict_columns}) DO UPDATE SET {}",
            updates.join(", ")
        )
    };
    let sql = format!(
        "INSERT INTO main.{name} ({columns})
         SELECT {selected_columns} FROM temp.{name} AS v
         WHERE {scope}
         {conflict}"
    );
    tx.execute(&sql, [])?;
    Ok(())
}
