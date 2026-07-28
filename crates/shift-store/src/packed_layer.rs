use std::collections::{HashMap, HashSet, VecDeque};

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use shift_font as font;

use crate::{
    ShiftStore, StoreError, workspace_state::mark_workspace_dirty_in_tx, write_mode::WriteMode,
};

pub const GLYPH_LAYER_FORMAT: &str = "shift.glyph-layer.v1";
pub const MAX_LAYER_READ_BATCH_COUNT: usize = 512;
pub const MAX_LAYER_READ_BATCH_PAYLOAD_BYTES: u64 = 256 * 1024 * 1024;
const MAX_LAYER_PAYLOAD_BYTES: i64 = shift_glyph_codec::MAX_LAYER_PAYLOAD_BYTES as i64;

/// Relational facts needed to locate a layer without reading its payload.
#[derive(Clone, Debug, PartialEq)]
pub struct GlyphLayerDirectoryEntry {
    pub layer_id: font::LayerId,
    pub glyph_id: font::GlyphId,
    pub source_id: font::SourceId,
    pub name: Option<font::GlyphName>,
    pub width: f64,
    pub height: Option<f64>,
    pub payload_byte_length: u64,
}

impl ShiftStore {
    /// Fetches, bounds-checks, decodes, and cross-checks one canonical layer.
    pub fn load_glyph_layer(
        &self,
        layer_id: &font::LayerId,
    ) -> Result<Option<font::GlyphLayer>, StoreError> {
        load_glyph_layer_from_conn(&self.conn, layer_id)
    }

    /// Fetches and cross-validates a bounded layer batch with three ordered
    /// SQLite scans rather than three query executions per layer.
    pub fn load_glyph_layers(
        &self,
        layer_ids: &[font::LayerId],
    ) -> Result<Vec<font::GlyphLayer>, StoreError> {
        load_glyph_layers_from_conn(&self.conn, layer_ids)
    }

    /// Replaces one independently-addressed layer and its earned reference
    /// rows in one transaction. The workspace revision advances only after
    /// encoding and index derivation have succeeded.
    pub fn replace_glyph_layer(&mut self, layer: &font::GlyphLayer) -> Result<(), StoreError> {
        let owner =
            layer_owner(&self.conn, &layer.id())?.ok_or_else(|| StoreError::MissingEntity {
                kind: "glyph layer",
                id: layer.id().to_string(),
            })?;
        let tx = self.conn.transaction()?;
        write_layer_in_tx(&tx, &owner.0, owner.1.as_ref(), layer)?;
        mark_workspace_dirty_in_tx(&tx)?;
        tx.commit()?;
        Ok(())
    }

    /// Validates caller-provided canonical bytes before atomically replacing
    /// directory facts, payload, reference rows, and revision state.
    pub fn replace_glyph_layer_payload(
        &mut self,
        expected_layer_id: &font::LayerId,
        payload: &[u8],
    ) -> Result<(), StoreError> {
        if payload.len() as i64 > MAX_LAYER_PAYLOAD_BYTES {
            return Err(StoreError::LayerPayloadTooLarge {
                bytes: payload.len() as u64,
                limit: MAX_LAYER_PAYLOAD_BYTES as u64,
            });
        }
        let layer = font::unpack_glyph_layer(payload)?;
        if layer.id() != *expected_layer_id {
            return Err(StoreError::LayerDirectoryMismatch {
                layer_id: expected_layer_id.to_string(),
                detail: format!("payload id is {}", layer.id()),
            });
        }
        self.replace_glyph_layer(&layer)
    }

    pub fn list_glyph_layer_directory(&self) -> Result<Vec<GlyphLayerDirectoryEntry>, StoreError> {
        let mut stmt = self.conn.prepare(
            "
            SELECT l.id, l.glyph_id, l.source_id, l.name, l.width, l.height,
                   p.byte_length
            FROM glyph_layers AS l
            JOIN glyph_layer_payloads AS p ON p.layer_id = l.id
            ORDER BY l.glyph_id, l.source_id, l.id
            ",
        )?;
        let rows = stmt.query_map([], map_directory_row)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    /// Returns every direct glyph-component edge from one ordered relational
    /// scan. Glyphs without components are absent from the map.
    pub fn glyph_component_references(
        &self,
    ) -> Result<HashMap<font::GlyphId, Vec<font::GlyphId>>, StoreError> {
        let mut stmt = self.conn.prepare(
            "
            SELECT DISTINCT l.glyph_id, c.base_glyph_id
            FROM glyph_components AS c
            JOIN glyph_layers AS l ON l.id = c.layer_id
            ORDER BY l.glyph_id, c.base_glyph_id
            ",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                font::GlyphId::from_raw(row.get::<_, String>(0)?),
                font::GlyphId::from_raw(row.get::<_, String>(1)?),
            ))
        })?;
        let mut references = HashMap::new();
        for row in rows {
            let (glyph_id, base_glyph_id) = row?;
            references
                .entry(glyph_id)
                .or_insert_with(Vec::new)
                .push(base_glyph_id);
        }
        Ok(references)
    }

    /// Returns referenced glyph identities entirely from the relational index.
    pub fn referenced_glyph_ids_for_glyph(
        &self,
        glyph_id: &font::GlyphId,
    ) -> Result<Vec<font::GlyphId>, StoreError> {
        let mut stmt = self.conn.prepare(
            "
            SELECT DISTINCT c.base_glyph_id
            FROM glyph_components AS c
            JOIN glyph_layers AS l ON l.id = c.layer_id
            WHERE l.glyph_id = ?1
            ORDER BY c.base_glyph_id
            ",
        )?;
        let rows = stmt.query_map([glyph_id.to_string()], |row| {
            Ok(font::GlyphId::from_raw(row.get::<_, String>(0)?))
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    /// Computes the transitive component closure without scanning payloads.
    pub fn referenced_glyph_closure(
        &self,
        roots: impl IntoIterator<Item = font::GlyphId>,
    ) -> Result<Vec<font::GlyphId>, StoreError> {
        let mut pending: VecDeque<_> = roots.into_iter().collect();
        let mut seen = HashSet::new();
        let mut result = Vec::new();
        while let Some(glyph_id) = pending.pop_front() {
            if !seen.insert(glyph_id.clone()) {
                continue;
            }
            pending.extend(self.referenced_glyph_ids_for_glyph(&glyph_id)?);
            result.push(glyph_id);
        }
        Ok(result)
    }

    /// Reverse-reference lookup used for dependent invalidation.
    pub fn dependent_glyph_ids_for_layers(
        &self,
        layer_ids: &[font::LayerId],
    ) -> Result<Vec<font::GlyphId>, StoreError> {
        if layer_ids.is_empty() {
            return Ok(Vec::new());
        }
        let mut result = HashSet::new();
        let mut stmt = self.conn.prepare(
            "
            SELECT DISTINCT owner.glyph_id
            FROM glyph_components AS c
            JOIN glyph_layers AS target ON target.glyph_id = c.base_glyph_id
            JOIN glyph_layers AS owner ON owner.id = c.layer_id
            WHERE target.id = ?1
            ",
        )?;
        for layer_id in layer_ids {
            let rows = stmt.query_map([layer_id.to_string()], |row| {
                Ok(font::GlyphId::from_raw(row.get::<_, String>(0)?))
            })?;
            for row in rows {
                result.insert(row?);
            }
        }
        let mut result: Vec<_> = result.into_iter().collect();
        result.sort_by(|left, right| left.as_str().cmp(right.as_str()));
        Ok(result)
    }
}

struct DirectoryFacts {
    layer_id: String,
    source_id: String,
    width: f64,
    height: Option<f64>,
    format: String,
    declared_len: i64,
    actual_len: i64,
}

impl DirectoryFacts {
    fn validate(&self) -> Result<u64, StoreError> {
        if self.format != GLYPH_LAYER_FORMAT {
            return Err(StoreError::UnsupportedLayerFormat(self.format.clone()));
        }
        if self.declared_len != self.actual_len {
            return Err(StoreError::LayerDirectoryMismatch {
                layer_id: self.layer_id.clone(),
                detail: format!(
                    "declared byte length {} != actual {}",
                    self.declared_len, self.actual_len
                ),
            });
        }
        if !(0..=MAX_LAYER_PAYLOAD_BYTES).contains(&self.actual_len) {
            return Err(StoreError::LayerPayloadTooLarge {
                bytes: u64::try_from(self.actual_len).unwrap_or(u64::MAX),
                limit: MAX_LAYER_PAYLOAD_BYTES as u64,
            });
        }
        Ok(self.actual_len as u64)
    }
}

fn map_directory_facts_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DirectoryFacts> {
    Ok(DirectoryFacts {
        layer_id: row.get(0)?,
        source_id: row.get(1)?,
        width: row.get(2)?,
        height: row.get(3)?,
        format: row.get(4)?,
        declared_len: row.get(5)?,
        actual_len: row.get(6)?,
    })
}

pub(crate) fn load_glyph_layer_from_conn(
    conn: &Connection,
    layer_id: &font::LayerId,
) -> Result<Option<font::GlyphLayer>, StoreError> {
    let mut directory_stmt = conn.prepare_cached(
        "
        SELECT l.id, l.source_id, l.width, l.height,
               p.format, p.byte_length, length(p.payload)
        FROM glyph_layers AS l
        JOIN glyph_layer_payloads AS p ON p.layer_id = l.id
        WHERE l.id = ?1
        ",
    )?;
    let facts = directory_stmt
        .query_row([layer_id.to_string()], map_directory_facts_row)
        .optional()?;
    drop(directory_stmt);
    let Some(facts) = facts else {
        return Ok(None);
    };
    facts.validate()?;

    // The length gate is deliberately a separate query so SQLite cannot
    // allocate an unbounded Vec before the store applies its limit.
    let mut payload_stmt = conn.prepare_cached(
        "
        SELECT payload
        FROM glyph_layer_payloads
        WHERE layer_id = ?1
          AND length(payload) = ?2
          AND length(payload) <= ?3
        ",
    )?;
    let payload: Vec<u8> = payload_stmt
        .query_row(
            params![
                layer_id.to_string(),
                facts.actual_len,
                MAX_LAYER_PAYLOAD_BYTES
            ],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| StoreError::LayerDirectoryMismatch {
            layer_id: layer_id.to_string(),
            detail: "payload changed during bounded read".to_string(),
        })?;
    let layer = font::unpack_glyph_layer(&payload)?;
    validate_directory_facts(
        layer_id,
        &facts.source_id,
        facts.width,
        facts.height,
        &layer,
    )?;
    validate_component_index(conn, &layer)?;
    Ok(Some(layer))
}

pub(crate) fn load_glyph_layers_from_conn(
    conn: &Connection,
    layer_ids: &[font::LayerId],
) -> Result<Vec<font::GlyphLayer>, StoreError> {
    let mut keys = layer_ids
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    keys.sort();
    keys.dedup();
    if keys.is_empty() {
        return Ok(Vec::new());
    }
    if keys.len() > MAX_LAYER_READ_BATCH_COUNT {
        return Err(StoreError::LayerReadBatchTooLarge {
            layers: keys.len(),
            limit: MAX_LAYER_READ_BATCH_COUNT,
        });
    }

    let placeholders = (0..keys.len()).map(|_| "?").collect::<Vec<_>>().join(",");
    let directory_sql = format!(
        "
        SELECT l.id, l.source_id, l.width, l.height,
               p.format, p.byte_length, length(p.payload)
        FROM glyph_layers AS l
        JOIN glyph_layer_payloads AS p ON p.layer_id = l.id
        WHERE l.id IN ({placeholders})
        ORDER BY l.id
        "
    );
    let mut directory_stmt = conn.prepare(&directory_sql)?;
    let directory_rows = directory_stmt.query_map(
        rusqlite::params_from_iter(keys.iter()),
        map_directory_facts_row,
    )?;
    let mut facts = HashMap::with_capacity(keys.len());
    let mut batch_payload_bytes = 0_u64;
    for row in directory_rows {
        let facts_row = row?;
        batch_payload_bytes = batch_payload_bytes.saturating_add(facts_row.validate()?);
        facts.insert(facts_row.layer_id.clone(), facts_row);
    }
    drop(directory_stmt);

    for key in &keys {
        if !facts.contains_key(key) {
            return Err(StoreError::MissingEntity {
                kind: "glyph layer",
                id: key.clone(),
            });
        }
    }
    if batch_payload_bytes > MAX_LAYER_READ_BATCH_PAYLOAD_BYTES {
        return Err(StoreError::LayerReadBatchPayloadTooLarge {
            bytes: batch_payload_bytes,
            limit: MAX_LAYER_READ_BATCH_PAYLOAD_BYTES,
        });
    }

    let payload_sql = format!(
        "
        SELECT layer_id, payload, length(payload)
        FROM glyph_layer_payloads
        WHERE layer_id IN ({placeholders})
          AND length(payload) <= ?
        ORDER BY layer_id
        "
    );
    let mut payload_params = keys
        .iter()
        .cloned()
        .map(rusqlite::types::Value::Text)
        .collect::<Vec<_>>();
    payload_params.push(rusqlite::types::Value::Integer(MAX_LAYER_PAYLOAD_BYTES));
    let mut payload_stmt = conn.prepare(&payload_sql)?;
    let payload_rows =
        payload_stmt.query_map(rusqlite::params_from_iter(payload_params), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Vec<u8>>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })?;
    let mut layers = Vec::with_capacity(keys.len());
    let mut loaded = HashSet::with_capacity(keys.len());
    for row in payload_rows {
        let (layer_id, payload, actual_len) = row?;
        let facts = facts
            .get(&layer_id)
            .ok_or_else(|| StoreError::LayerDirectoryMismatch {
                layer_id: layer_id.clone(),
                detail: "payload has no directory row".to_string(),
            })?;
        if actual_len != facts.actual_len || payload.len() as i64 != facts.actual_len {
            return Err(StoreError::LayerDirectoryMismatch {
                layer_id,
                detail: "payload changed during bounded batch read".to_string(),
            });
        }
        let layer = font::unpack_glyph_layer(&payload)?;
        let expected_id = font::LayerId::from_raw(layer_id.clone());
        validate_directory_facts(
            &expected_id,
            &facts.source_id,
            facts.width,
            facts.height,
            &layer,
        )?;
        loaded.insert(layer_id);
        layers.push(layer);
    }
    drop(payload_stmt);

    for key in &keys {
        if !loaded.contains(key) {
            return Err(StoreError::LayerDirectoryMismatch {
                layer_id: key.clone(),
                detail: "payload changed during bounded batch read".to_string(),
            });
        }
    }

    let component_sql = format!(
        "
        SELECT layer_id, id, base_glyph_id, order_index
        FROM glyph_components
        WHERE layer_id IN ({placeholders})
        ORDER BY layer_id, order_index, id
        "
    );
    let mut component_stmt = conn.prepare(&component_sql)?;
    let component_rows =
        component_stmt.query_map(rusqlite::params_from_iter(keys.iter()), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })?;
    let mut components: HashMap<String, Vec<(String, String, i64)>> = HashMap::new();
    for row in component_rows {
        let (layer_id, component_id, base_glyph_id, order_index) = row?;
        components
            .entry(layer_id)
            .or_default()
            .push((component_id, base_glyph_id, order_index));
    }
    drop(component_stmt);

    for layer in &layers {
        let indexed = components.remove(layer.id().as_str()).unwrap_or_default();
        validate_component_rows(layer, &indexed)?;
    }
    Ok(layers)
}

pub(crate) fn write_layer_in_tx(
    tx: &Transaction<'_>,
    glyph_id: &font::GlyphId,
    name: Option<&font::GlyphName>,
    layer: &font::GlyphLayer,
) -> Result<(), StoreError> {
    let packed = font::pack_glyph_layer(layer)?;
    store_packed_layer_in_tx(tx, glyph_id, name, layer, &packed, WriteMode::Upsert)
}

pub(crate) fn store_packed_layer_in_tx(
    tx: &Transaction<'_>,
    glyph_id: &font::GlyphId,
    name: Option<&font::GlyphName>,
    layer: &font::GlyphLayer,
    packed: &shift_glyph_codec::PackedGlyphLayer,
    mode: WriteMode,
) -> Result<(), StoreError> {
    let bytes = packed.as_bytes();
    let byte_length = encoded_len(bytes)?;
    let layer_sql = match mode {
        WriteMode::Insert => {
            "INSERT INTO glyph_layers (id, glyph_id, source_id, name, width, height) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"
        }
        WriteMode::Upsert => {
            "
            INSERT INTO glyph_layers (id, glyph_id, source_id, name, width, height)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(id) DO UPDATE SET
                glyph_id = excluded.glyph_id,
                source_id = excluded.source_id,
                name = excluded.name,
                width = excluded.width,
                height = excluded.height
            "
        }
    };
    tx.prepare_cached(layer_sql)?.execute(params![
        layer.id().to_string(),
        glyph_id.to_string(),
        layer.source_id().to_string(),
        name.map(font::GlyphName::as_str),
        layer.width(),
        layer.height(),
    ])?;

    let payload_sql = match mode {
        WriteMode::Insert => {
            "INSERT INTO glyph_layer_payloads (layer_id, format, payload, byte_length) VALUES (?1, ?2, ?3, ?4)"
        }
        WriteMode::Upsert => {
            "
            INSERT INTO glyph_layer_payloads (layer_id, format, payload, byte_length)
            VALUES (?1, ?2, ?3, ?4)
            ON CONFLICT(layer_id) DO UPDATE SET
                format = excluded.format,
                payload = excluded.payload,
                byte_length = excluded.byte_length
            "
        }
    };
    tx.prepare_cached(payload_sql)?.execute(params![
        layer.id().to_string(),
        GLYPH_LAYER_FORMAT,
        bytes,
        byte_length,
    ])?;
    write_component_index(tx, layer, mode)
}

fn encoded_len(bytes: &[u8]) -> Result<i64, StoreError> {
    i64::try_from(bytes.len()).map_err(|_| StoreError::LayerPayloadTooLarge {
        bytes: bytes.len() as u64,
        limit: MAX_LAYER_PAYLOAD_BYTES as u64,
    })
}

pub(crate) fn rewrite_layer_in_tx(
    tx: &Transaction<'_>,
    layer: &font::GlyphLayer,
) -> Result<(), StoreError> {
    let owner = layer_owner(tx, &layer.id())?.ok_or_else(|| StoreError::MissingEntity {
        kind: "glyph layer",
        id: layer.id().to_string(),
    })?;
    write_layer_in_tx(tx, &owner.0, owner.1.as_ref(), layer)
}

pub(crate) fn create_empty_layer_in_tx(
    tx: &Transaction<'_>,
    glyph_id: &font::GlyphId,
    name: Option<&font::GlyphName>,
    layer_id: font::LayerId,
    source_id: font::SourceId,
    width: f64,
    height: Option<f64>,
) -> Result<(), StoreError> {
    let mut layer = font::GlyphLayer::with_width(layer_id, source_id, width);
    layer.set_height(height);
    write_layer_in_tx(tx, glyph_id, name, &layer)
}

fn write_component_index(
    tx: &Transaction<'_>,
    layer: &font::GlyphLayer,
    mode: WriteMode,
) -> Result<(), StoreError> {
    if mode == WriteMode::Upsert {
        tx.prepare_cached("DELETE FROM glyph_components WHERE layer_id = ?1")?
            .execute([layer.id().to_string()])?;
    }
    for (order_index, component) in layer.components_iter().enumerate() {
        tx.prepare_cached(
            "
            INSERT INTO glyph_components (
                id, layer_id, base_glyph_id, order_index
            ) VALUES (?1, ?2, ?3, ?4)
            ",
        )?
        .execute(params![
            component.id().to_string(),
            layer.id().to_string(),
            component.base_glyph_id().to_string(),
            order_index as i64,
        ])?;
    }
    Ok(())
}

fn validate_directory_facts(
    expected_id: &font::LayerId,
    expected_source_id: &str,
    expected_width: f64,
    expected_height: Option<f64>,
    layer: &font::GlyphLayer,
) -> Result<(), StoreError> {
    let detail = if layer.id() != *expected_id {
        Some(format!("payload id is {}", layer.id()))
    } else if layer.source_id().as_str() != expected_source_id {
        Some(format!("payload source id is {}", layer.source_id()))
    } else if layer.width().to_bits() != expected_width.to_bits() {
        Some("payload width differs from directory width".to_string())
    } else if !same_optional_f64(layer.height(), expected_height) {
        Some("payload height differs from directory height".to_string())
    } else {
        None
    };
    if let Some(detail) = detail {
        return Err(StoreError::LayerDirectoryMismatch {
            layer_id: expected_id.to_string(),
            detail,
        });
    }
    Ok(())
}

fn validate_component_index(conn: &Connection, layer: &font::GlyphLayer) -> Result<(), StoreError> {
    let mut stmt = conn.prepare_cached(
        "
        SELECT id, base_glyph_id, order_index
        FROM glyph_components
        WHERE layer_id = ?1
        ORDER BY order_index, id
        ",
    )?;
    let indexed = stmt
        .query_map([layer.id().to_string()], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    validate_component_rows(layer, &indexed)
}

fn validate_component_rows(
    layer: &font::GlyphLayer,
    indexed: &[(String, String, i64)],
) -> Result<(), StoreError> {
    let authored: Vec<_> = layer
        .components_iter()
        .enumerate()
        .map(|(order_index, component)| {
            (
                component.id().to_string(),
                component.base_glyph_id().to_string(),
                order_index as i64,
            )
        })
        .collect();
    if indexed != authored {
        return Err(StoreError::StaleLayerReferenceIndex {
            layer_id: layer.id().to_string(),
        });
    }
    Ok(())
}

fn layer_owner(
    conn: &Connection,
    layer_id: &font::LayerId,
) -> Result<Option<(font::GlyphId, Option<font::GlyphName>)>, StoreError> {
    conn.query_row(
        "SELECT glyph_id, name FROM glyph_layers WHERE id = ?1",
        [layer_id.to_string()],
        |row| {
            Ok((
                font::GlyphId::from_raw(row.get::<_, String>(0)?),
                row.get::<_, Option<String>>(1)?.map(font::GlyphName::from),
            ))
        },
    )
    .optional()
    .map_err(Into::into)
}

fn map_directory_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<GlyphLayerDirectoryEntry> {
    let byte_length = row.get::<_, i64>(6)?;
    let payload_byte_length = u64::try_from(byte_length).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            6,
            rusqlite::types::Type::Integer,
            Box::new(error),
        )
    })?;
    Ok(GlyphLayerDirectoryEntry {
        layer_id: font::LayerId::from_raw(row.get::<_, String>(0)?),
        glyph_id: font::GlyphId::from_raw(row.get::<_, String>(1)?),
        source_id: font::SourceId::from_raw(row.get::<_, String>(2)?),
        name: row.get::<_, Option<String>>(3)?.map(font::GlyphName::from),
        width: row.get(4)?,
        height: row.get(5)?,
        payload_byte_length,
    })
}

fn same_optional_f64(left: Option<f64>, right: Option<f64>) -> bool {
    match (left, right) {
        (Some(left), Some(right)) => left.to_bits() == right.to_bits(),
        (None, None) => true,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use shift_font as font;

    use super::*;
    use crate::{ShiftStore, WorkspaceState};

    fn populated_store() -> (ShiftStore, font::Font) {
        let mut store = ShiftStore::open_memory_for_test().unwrap();
        let font = font::test_support::sample_font();
        store.replace_font_state(&font).unwrap();
        store
            .set_workspace_state(WorkspaceState::untitled(None))
            .unwrap();
        (store, font)
    }

    #[test]
    fn sqlite_payload_matches_shared_canonical_golden_bytes() {
        let golden = include_bytes!("../../../fixtures/glyph-codec/layer-v1/full.bin");
        let layer = font::unpack_glyph_layer(golden).unwrap();
        let glyph_id = font::GlyphId::from_raw("storage_golden");
        let glyph_name = font::GlyphName::from("storageGolden");
        let mut store = ShiftStore::open_memory_for_test().unwrap();
        store
            .conn
            .execute(
                "INSERT INTO sources (id, name, kind, order_index) VALUES (?1, 'Golden', 'master', 0)",
                [layer.source_id().to_string()],
            )
            .unwrap();
        store
            .conn
            .execute(
                "INSERT INTO glyphs (id, name, order_index) VALUES (?1, ?2, 0)",
                params![glyph_id.to_string(), glyph_name.as_str()],
            )
            .unwrap();

        let mut writer = store.layer_stream_writer().unwrap();
        writer
            .write_layer(&glyph_id, Some(&glyph_name), &layer)
            .unwrap();
        writer.finish().unwrap();

        let stored: Vec<u8> = store
            .conn
            .query_row(
                "SELECT payload FROM glyph_layer_payloads WHERE layer_id = ?1",
                [layer.id().to_string()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stored.as_slice(), golden);
        let decoded = store.load_glyph_layer(&layer.id()).unwrap().unwrap();
        assert_eq!(font::pack_glyph_layer(&decoded).unwrap().as_bytes(), golden);
    }

    #[test]
    fn bounded_batch_load_matches_complete_font_layers() {
        let (store, font) = populated_store();
        let mut layer_ids = font
            .glyphs()
            .flat_map(|glyph| glyph.layers().keys().cloned())
            .collect::<Vec<_>>();
        layer_ids.push(layer_ids[0].clone());

        let layers = store.load_glyph_layers(&layer_ids).unwrap();

        assert_eq!(layers.len(), layer_ids.len() - 1);
        for layer in layers {
            assert_eq!(font.layer(layer.id()).unwrap(), &layer);
        }
    }

    #[test]
    fn bounded_batch_load_rejects_excessive_layer_counts_before_sql() {
        let store = ShiftStore::open_memory_for_test().unwrap();
        let layer_ids = (0..=MAX_LAYER_READ_BATCH_COUNT)
            .map(|index| font::LayerId::from_raw(format!("layer_{index}")))
            .collect::<Vec<_>>();

        assert!(matches!(
            store.load_glyph_layers(&layer_ids),
            Err(StoreError::LayerReadBatchTooLarge { .. })
        ));
    }

    #[test]
    fn directory_open_never_reads_malformed_payloads() {
        let (store, font) = populated_store();
        let layer_id = font
            .glyphs()
            .next()
            .unwrap()
            .layers()
            .keys()
            .next()
            .unwrap();
        store
            .conn
            .execute(
                "UPDATE glyph_layer_payloads SET payload = X'00', byte_length = 1 WHERE layer_id = ?1",
                [layer_id.to_string()],
            )
            .unwrap();

        let directory = store.load_font_directory().unwrap();
        assert_eq!(directory.glyph_count(), font.glyph_count());
        assert!(directory.layer(layer_id.clone()).unwrap().is_empty());
        assert!(store.load_glyph_layer(layer_id).is_err());
        assert!(
            store
                .load_glyph_layers(std::slice::from_ref(layer_id))
                .is_err()
        );
    }

    #[test]
    fn directory_retains_layer_when_payload_row_is_missing() {
        let (store, font) = populated_store();
        let layer_id = font
            .glyphs()
            .next()
            .unwrap()
            .layers()
            .keys()
            .next()
            .unwrap();
        store
            .conn
            .execute(
                "DELETE FROM glyph_layer_payloads WHERE layer_id = ?1",
                [layer_id.to_string()],
            )
            .unwrap();

        let directory = store.load_font_directory().unwrap();

        assert!(directory.layer(layer_id.clone()).is_some());
        assert!(store.load_font_state().is_err());
    }

    #[test]
    fn stale_reference_index_is_rejected() {
        let (store, font) = populated_store();
        let layer = font
            .glyphs()
            .flat_map(|glyph| glyph.layers().values())
            .find(|layer| !layer.components().is_empty())
            .unwrap();
        store
            .conn
            .execute(
                "DELETE FROM glyph_components WHERE layer_id = ?1",
                [layer.id().to_string()],
            )
            .unwrap();

        assert!(matches!(
            store.load_glyph_layer(&layer.id()),
            Err(StoreError::StaleLayerReferenceIndex { .. })
        ));
        assert!(matches!(
            store.load_glyph_layers(&[layer.id()]),
            Err(StoreError::StaleLayerReferenceIndex { .. })
        ));
    }

    #[test]
    fn index_constraint_failure_rolls_back_payload_directory_and_revision() {
        let (mut store, font) = populated_store();
        let indexed_layer = font
            .glyphs()
            .flat_map(|glyph| glyph.layers().values())
            .find(|layer| !layer.components().is_empty())
            .unwrap();
        let duplicate = indexed_layer.components_iter().next().unwrap();
        let mut target = font
            .glyphs()
            .flat_map(|glyph| glyph.layers().values())
            .find(|layer| layer.id() != indexed_layer.id() && layer.components().is_empty())
            .unwrap()
            .as_ref()
            .clone();
        target.add_component(font::Component::with_id(
            duplicate.id(),
            duplicate.base_glyph_id(),
            duplicate.base_glyph_name().clone(),
            *duplicate.transform(),
        ));

        let before_payload: Vec<u8> = store
            .conn
            .query_row(
                "SELECT payload FROM glyph_layer_payloads WHERE layer_id = ?1",
                [target.id().to_string()],
                |row| row.get(0),
            )
            .unwrap();
        let before_revision = store.workspace_state().unwrap().unwrap().revision;

        assert!(store.replace_glyph_layer(&target).is_err());

        let after_payload: Vec<u8> = store
            .conn
            .query_row(
                "SELECT payload FROM glyph_layer_payloads WHERE layer_id = ?1",
                [target.id().to_string()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(after_payload, before_payload);
        assert_eq!(
            store.workspace_state().unwrap().unwrap().revision,
            before_revision
        );
    }

    #[test]
    fn replacement_updates_payload_directory_references_and_revision_atomically() {
        let (mut store, font) = populated_store();
        let mut layer = font
            .glyphs()
            .flat_map(|glyph| glyph.layers().values())
            .find(|layer| !layer.components().is_empty())
            .unwrap()
            .as_ref()
            .clone();
        let owner = font.glyph_id_by_layer(layer.id()).unwrap();
        layer.set_width(layer.width() + 23.0);
        layer.clear_components();

        store.replace_glyph_layer(&layer).unwrap();

        assert_eq!(
            store.load_glyph_layer(&layer.id()).unwrap(),
            Some(layer.clone())
        );
        let directory = store
            .list_glyph_layer_directory()
            .unwrap()
            .into_iter()
            .find(|entry| entry.layer_id == layer.id())
            .unwrap();
        assert_eq!(directory.width.to_bits(), layer.width().to_bits());
        assert!(
            store
                .referenced_glyph_ids_for_glyph(&owner)
                .unwrap()
                .is_empty()
        );
        assert_eq!(store.workspace_state().unwrap().unwrap().revision, 1);
    }

    #[test]
    fn post_font_change_set_rewrites_touched_layer_without_decoding_old_payload() {
        let (mut store, mut post_font) = populated_store();
        let mut layer = post_font
            .glyphs()
            .flat_map(|glyph| glyph.layers().values())
            .next()
            .unwrap()
            .as_ref()
            .clone();
        layer.set_width(layer.width() + 41.0);
        post_font.replace_glyph_layers(vec![layer.clone()]).unwrap();
        store
            .conn
            .execute(
                "UPDATE glyph_layer_payloads SET payload = X'00', byte_length = 1 WHERE layer_id = ?1",
                [layer.id().to_string()],
            )
            .unwrap();
        let changes =
            font::FontChangeSet::new(vec![font::FontChange::layer_metrics_changed(&layer)]);

        store
            .apply_change_set_with_font(&changes, &post_font)
            .unwrap();

        assert_eq!(store.load_glyph_layer(&layer.id()).unwrap(), Some(layer));
    }

    #[test]
    fn abandoned_transaction_preserves_last_committed_layer() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("working.sqlite");
        let font = font::test_support::sample_font();
        let layer = font
            .glyphs()
            .flat_map(|glyph| glyph.layers().values())
            .next()
            .unwrap()
            .as_ref()
            .clone();
        let mut store = ShiftStore::open(&path).unwrap();
        store.replace_font_state(&font).unwrap();
        let mut uncommitted = layer.clone();
        uncommitted.set_width(layer.width() + 999.0);
        {
            let tx = store.conn.transaction().unwrap();
            rewrite_layer_in_tx(&tx, &uncommitted).unwrap();
            // Dropping an open transaction models recovery from a process
            // that exits before COMMIT reaches the WAL.
        }
        drop(store);

        let reopened = ShiftStore::open(&path).unwrap();
        assert_eq!(reopened.load_glyph_layer(&layer.id()).unwrap(), Some(layer));
    }

    #[test]
    fn malformed_replacement_commits_nothing() {
        let (mut store, font) = populated_store();
        let layer_id = font
            .glyphs()
            .next()
            .unwrap()
            .layers()
            .keys()
            .next()
            .unwrap();
        let before = store.list_glyph_layer_directory().unwrap();
        let before_revision = store.workspace_state().unwrap().unwrap().revision;

        assert!(
            store
                .replace_glyph_layer_payload(layer_id, b"not a layer")
                .is_err()
        );

        assert_eq!(store.list_glyph_layer_directory().unwrap(), before);
        assert_eq!(
            store.workspace_state().unwrap().unwrap().revision,
            before_revision
        );
    }

    #[test]
    fn stream_writer_commits_one_standalone_layer() {
        let (mut store, font) = populated_store();
        let glyph = font.glyphs().next().unwrap();
        let mut layer = glyph.layers().values().next().unwrap().as_ref().clone();
        layer.set_width(layer.width() + 17.0);
        let glyph_id = glyph.id();
        let glyph_name = glyph.glyph_name().clone();
        drop(font);

        let mut writer = store.layer_stream_writer().unwrap();
        writer
            .write_layer(&glyph_id, Some(&glyph_name), &layer)
            .unwrap();
        writer.finish().unwrap();

        assert_eq!(store.load_glyph_layer(&layer.id()).unwrap(), Some(layer));
    }

    #[test]
    fn abandoned_font_stream_rolls_back_header_and_glyphs() {
        let (mut store, font) = populated_store();
        let before = store.list_glyph_layer_directory().unwrap();
        {
            let mut writer = store.font_stream_writer(&font).unwrap();
            let glyph = font.glyphs().next().unwrap();
            writer
                .write_glyph_batch(std::slice::from_ref(glyph))
                .unwrap();
        }

        assert_eq!(store.list_glyph_layer_directory().unwrap(), before);
    }

    #[test]
    fn cjk_scale_directory_open_is_payload_independent() {
        const GLYPH_COUNT: usize = 65_536;
        let mut store = ShiftStore::open_memory_for_test().unwrap();
        let source_id = font::SourceId::from_raw("cjk").to_string();
        store
            .conn
            .execute(
                "INSERT INTO sources (id, name, kind, order_index) VALUES (?1, 'CJK', 'master', 0)",
                [&source_id],
            )
            .unwrap();
        let tx = store.conn.transaction().unwrap();
        {
            let mut glyph_stmt = tx
                .prepare("INSERT INTO glyphs (id, name, order_index) VALUES (?1, ?2, ?3)")
                .unwrap();
            let mut layer_stmt = tx
                .prepare("INSERT INTO glyph_layers (id, glyph_id, source_id, name, width, height) VALUES (?1, ?2, ?3, ?4, 1000, NULL)")
                .unwrap();
            let mut payload_stmt = tx
                .prepare("INSERT INTO glyph_layer_payloads (layer_id, format, payload, byte_length) VALUES (?1, ?2, X'00', 1)")
                .unwrap();
            for index in 0..GLYPH_COUNT {
                let glyph_id = font::GlyphId::from_raw(format!("cjk{index}")).to_string();
                let layer_id = font::LayerId::from_raw(format!("cjk{index}")).to_string();
                let name = format!("uni{index:05X}");
                glyph_stmt
                    .execute(params![glyph_id, name, index as i64])
                    .unwrap();
                layer_stmt
                    .execute(params![layer_id, glyph_id, source_id, name])
                    .unwrap();
                payload_stmt
                    .execute(params![layer_id, GLYPH_LAYER_FORMAT])
                    .unwrap();
            }
        }
        tx.commit().unwrap();

        let started = Instant::now();
        let directory = store.load_font_directory().unwrap();
        let elapsed = started.elapsed();

        assert_eq!(directory.glyph_count(), GLYPH_COUNT);
        assert_eq!(
            directory
                .glyphs()
                .map(|glyph| glyph.layers().len())
                .sum::<usize>(),
            GLYPH_COUNT
        );
        assert!(
            elapsed < Duration::from_secs(15),
            "directory open took {elapsed:?}"
        );
    }
}
