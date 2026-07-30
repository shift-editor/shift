use std::collections::{HashMap, HashSet, VecDeque};

use rayon::prelude::*;
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use shift_font as font;

use crate::{
    ShiftStore, StoreError,
    stored_layer::{compress_glyph_layer, decompress_glyph_layer, parse_layer_compression},
    types::StoredGlyphLayer,
    workspace_state::mark_workspace_dirty_in_tx,
    write_mode::WriteMode,
};

pub const GLYPH_LAYER_FORMAT: &str = "shift.glyph-layer.v1";
pub const MAX_LAYER_READ_BATCH_COUNT: usize = 512;
pub const MAX_LAYER_READ_BATCH_DECODED_BYTES: u64 = 256 * 1024 * 1024;
const MAX_LAYER_PAYLOAD_BYTES: i64 = font::MAX_LAYER_PAYLOAD_BYTES as i64;

/// Relational facts needed to locate a layer without reading its payload.
#[derive(Clone, Debug, PartialEq)]
pub struct GlyphLayerDirectoryEntry {
    pub layer_id: font::LayerId,
    pub glyph_id: font::GlyphId,
    pub source_id: font::SourceId,
    pub name: Option<font::GlyphName>,
    pub width: f64,
    pub height: Option<f64>,
    pub stored_byte_length: u64,
    pub decoded_byte_length: u64,
}

impl ShiftStore {
    /// Fetches, bounds-checks, decodes, and cross-checks one canonical layer.
    pub fn load_glyph_layer(
        &self,
        layer_id: &font::LayerId,
    ) -> Result<Option<font::GlyphLayer>, StoreError> {
        load_glyph_layer_from_conn(&self.conn, layer_id)
    }

    /// Fetches and cross-validates requested layers through count- and
    /// decoded-byte-bounded batches.
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
        write_layer_in_tx(&tx, &owner, layer)?;
        mark_workspace_dirty_in_tx(&tx)?;
        tx.commit()?;
        Ok(())
    }

    pub fn list_glyph_layer_directory(&self) -> Result<Vec<GlyphLayerDirectoryEntry>, StoreError> {
        let mut stmt = self.conn.prepare(
            "
            SELECT l.id, l.glyph_id, l.source_id, g.name, l.width, l.height,
                   p.stored_byte_length, p.decoded_byte_length
            FROM glyph_layers AS l
            JOIN glyphs AS g ON g.id = l.glyph_id
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
    inner_format: String,
    compression: String,
    stored_byte_length: i64,
    decoded_byte_length: i64,
    decoded_blake3: Vec<u8>,
    actual_stored_byte_length: i64,
}

impl DirectoryFacts {
    fn validate(&self) -> Result<u64, StoreError> {
        if self.inner_format != GLYPH_LAYER_FORMAT {
            return Err(StoreError::UnsupportedLayerFormat(
                self.inner_format.clone(),
            ));
        }
        parse_layer_compression(&self.compression)?;
        if self.stored_byte_length != self.actual_stored_byte_length {
            return Err(StoreError::LayerDirectoryMismatch {
                layer_id: self.layer_id.clone(),
                detail: format!(
                    "declared stored byte length {} != actual {}",
                    self.stored_byte_length, self.actual_stored_byte_length
                ),
            });
        }
        for byte_length in [self.stored_byte_length, self.decoded_byte_length] {
            if !(0..=MAX_LAYER_PAYLOAD_BYTES).contains(&byte_length) {
                return Err(StoreError::LayerPayloadTooLarge {
                    bytes: u64::try_from(byte_length).unwrap_or(u64::MAX),
                    limit: MAX_LAYER_PAYLOAD_BYTES as u64,
                });
            }
        }
        if self.stored_byte_length > self.decoded_byte_length {
            return Err(StoreError::LayerDirectoryMismatch {
                layer_id: self.layer_id.clone(),
                detail: format!(
                    "stored byte length {} exceeds decoded byte length {}",
                    self.stored_byte_length, self.decoded_byte_length
                ),
            });
        }
        if self.decoded_blake3.len() != 32 {
            return Err(StoreError::LayerDirectoryMismatch {
                layer_id: self.layer_id.clone(),
                detail: format!(
                    "decoded BLAKE3 has {} bytes instead of 32",
                    self.decoded_blake3.len()
                ),
            });
        }
        Ok(self.decoded_byte_length as u64)
    }

    fn stored_layer(&self, payload: Vec<u8>) -> Result<StoredGlyphLayer, StoreError> {
        let decoded_blake3: [u8; 32] = self.decoded_blake3.as_slice().try_into().map_err(|_| {
            StoreError::LayerDirectoryMismatch {
                layer_id: self.layer_id.clone(),
                detail: "decoded BLAKE3 is not 32 bytes".to_string(),
            }
        })?;
        Ok(StoredGlyphLayer {
            compression: parse_layer_compression(&self.compression)?,
            stored_byte_length: self.stored_byte_length as u64,
            decoded_byte_length: self.decoded_byte_length as u64,
            decoded_blake3,
            bytes: payload,
        })
    }
}

fn map_directory_facts_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DirectoryFacts> {
    Ok(DirectoryFacts {
        layer_id: row.get(0)?,
        source_id: row.get(1)?,
        width: row.get(2)?,
        height: row.get(3)?,
        inner_format: row.get(4)?,
        compression: row.get(5)?,
        stored_byte_length: row.get(6)?,
        decoded_byte_length: row.get(7)?,
        decoded_blake3: row.get(8)?,
        actual_stored_byte_length: row.get(9)?,
    })
}

pub(crate) fn load_glyph_layer_from_conn(
    conn: &Connection,
    layer_id: &font::LayerId,
) -> Result<Option<font::GlyphLayer>, StoreError> {
    let mut directory_stmt = conn.prepare_cached(
        "
        SELECT l.id, l.source_id, l.width, l.height,
               p.inner_format, p.compression,
               p.stored_byte_length, p.decoded_byte_length, p.decoded_blake3,
               length(p.payload)
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
                facts.actual_stored_byte_length,
                MAX_LAYER_PAYLOAD_BYTES
            ],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| StoreError::LayerDirectoryMismatch {
            layer_id: layer_id.to_string(),
            detail: "payload changed during bounded read".to_string(),
        })?;
    let decoded = decompress_glyph_layer(facts.layer_id.as_str(), facts.stored_layer(payload)?)?;
    let layer = font::unpack_glyph_layer(&decoded)?;
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

    let mut layers = Vec::with_capacity(keys.len());
    for count_batch in keys.chunks(MAX_LAYER_READ_BATCH_COUNT) {
        let placeholders = (0..count_batch.len())
            .map(|_| "?")
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT l.id, p.decoded_byte_length
             FROM glyph_layers AS l
             JOIN glyph_layer_payloads AS p ON p.layer_id = l.id
             WHERE l.id IN ({placeholders})
             ORDER BY l.id"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(rusqlite::params_from_iter(count_batch.iter()), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?;
        let mut decoded_lengths = HashMap::with_capacity(count_batch.len());
        for row in rows {
            let (layer_id, decoded_byte_length) = row?;
            if !(0..=MAX_LAYER_PAYLOAD_BYTES).contains(&decoded_byte_length) {
                return Err(StoreError::LayerPayloadTooLarge {
                    bytes: u64::try_from(decoded_byte_length).unwrap_or(u64::MAX),
                    limit: MAX_LAYER_PAYLOAD_BYTES as u64,
                });
            }
            decoded_lengths.insert(layer_id, decoded_byte_length as u64);
        }
        drop(stmt);

        let mut batch = Vec::new();
        let mut batch_decoded_bytes = 0_u64;
        for key in count_batch {
            let decoded_byte_length =
                decoded_lengths
                    .get(key)
                    .copied()
                    .ok_or_else(|| StoreError::MissingEntity {
                        kind: "glyph layer",
                        id: key.clone(),
                    })?;
            if !batch.is_empty()
                && batch_decoded_bytes.saturating_add(decoded_byte_length)
                    > MAX_LAYER_READ_BATCH_DECODED_BYTES
            {
                layers.extend(load_glyph_layer_batch_from_conn(conn, &batch)?);
                batch.clear();
                batch_decoded_bytes = 0;
            }
            batch.push(font::LayerId::from_raw(key.clone()));
            batch_decoded_bytes = batch_decoded_bytes.saturating_add(decoded_byte_length);
        }
        if !batch.is_empty() {
            layers.extend(load_glyph_layer_batch_from_conn(conn, &batch)?);
        }
    }

    Ok(layers)
}

fn load_glyph_layer_batch_from_conn(
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
               p.inner_format, p.compression,
               p.stored_byte_length, p.decoded_byte_length, p.decoded_blake3,
               length(p.payload)
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
    let mut batch_decoded_bytes = 0_u64;
    for row in directory_rows {
        let facts_row = row?;
        let decoded_byte_length = facts_row.validate()?;
        batch_decoded_bytes = batch_decoded_bytes.saturating_add(decoded_byte_length);
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
    if batch_decoded_bytes > MAX_LAYER_READ_BATCH_DECODED_BYTES {
        return Err(StoreError::LayerReadBatchDecodedTooLarge {
            bytes: batch_decoded_bytes,
            limit: MAX_LAYER_READ_BATCH_DECODED_BYTES,
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
    let mut payloads = Vec::with_capacity(keys.len());
    for row in payload_rows {
        let (layer_id, payload, actual_len) = row?;
        let facts = facts
            .get(&layer_id)
            .ok_or_else(|| StoreError::LayerDirectoryMismatch {
                layer_id: layer_id.clone(),
                detail: "payload has no directory row".to_string(),
            })?;
        if actual_len != facts.actual_stored_byte_length
            || payload.len() as i64 != facts.actual_stored_byte_length
        {
            return Err(StoreError::LayerDirectoryMismatch {
                layer_id,
                detail: "payload changed during bounded batch read".to_string(),
            });
        }
        payloads.push((layer_id, payload));
    }
    drop(payload_stmt);

    let decoded = payloads
        .into_par_iter()
        .map(|(layer_id, payload)| {
            let facts = facts
                .get(&layer_id)
                .ok_or_else(|| StoreError::LayerDirectoryMismatch {
                    layer_id: layer_id.clone(),
                    detail: "payload has no directory row".to_string(),
                })?;
            let decoded = decompress_glyph_layer(layer_id.as_str(), facts.stored_layer(payload)?)?;
            let layer = font::unpack_glyph_layer(&decoded)?;
            let expected_id = font::LayerId::from_raw(layer_id.clone());
            validate_directory_facts(
                &expected_id,
                &facts.source_id,
                facts.width,
                facts.height,
                &layer,
            )?;
            Ok((layer_id, layer))
        })
        .collect::<Result<Vec<_>, StoreError>>()?;
    let loaded = decoded
        .iter()
        .map(|(layer_id, _)| layer_id.clone())
        .collect::<HashSet<_>>();
    let layers = decoded
        .into_iter()
        .map(|(_, layer)| layer)
        .collect::<Vec<_>>();

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
    layer: &font::GlyphLayer,
) -> Result<(), StoreError> {
    let packed = font::pack_glyph_layer(layer)?;
    let stored = compress_glyph_layer(packed.as_bytes())?;
    store_stored_layer_in_tx(tx, glyph_id, layer, &stored, WriteMode::Upsert)
}

pub(crate) fn store_stored_layer_in_tx(
    tx: &Transaction<'_>,
    glyph_id: &font::GlyphId,
    layer: &font::GlyphLayer,
    stored: &StoredGlyphLayer,
    mode: WriteMode,
) -> Result<(), StoreError> {
    let stored_byte_length = encoded_len(stored.stored_byte_length)?;
    let decoded_byte_length = encoded_len(stored.decoded_byte_length)?;
    let layer_sql = match mode {
        WriteMode::Insert => {
            "INSERT INTO glyph_layers (id, glyph_id, source_id, width, height) VALUES (?1, ?2, ?3, ?4, ?5)"
        }
        WriteMode::Upsert => {
            "
            INSERT INTO glyph_layers (id, glyph_id, source_id, width, height)
            VALUES (?1, ?2, ?3, ?4, ?5)
            ON CONFLICT(id) DO UPDATE SET
                glyph_id = excluded.glyph_id,
                source_id = excluded.source_id,
                width = excluded.width,
                height = excluded.height
            "
        }
    };
    tx.prepare_cached(layer_sql)?.execute(params![
        layer.id().to_string(),
        glyph_id.to_string(),
        layer.source_id().to_string(),
        layer.width(),
        layer.height(),
    ])?;

    let payload_sql = match mode {
        WriteMode::Insert => {
            "INSERT INTO glyph_layer_payloads (
                layer_id, inner_format, compression, payload,
                stored_byte_length, decoded_byte_length, decoded_blake3
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
        }
        WriteMode::Upsert => {
            "
            INSERT INTO glyph_layer_payloads (
                layer_id, inner_format, compression, payload,
                stored_byte_length, decoded_byte_length, decoded_blake3
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ON CONFLICT(layer_id) DO UPDATE SET
                inner_format = excluded.inner_format,
                compression = excluded.compression,
                payload = excluded.payload,
                stored_byte_length = excluded.stored_byte_length,
                decoded_byte_length = excluded.decoded_byte_length,
                decoded_blake3 = excluded.decoded_blake3
            "
        }
    };
    tx.prepare_cached(payload_sql)?.execute(params![
        layer.id().to_string(),
        GLYPH_LAYER_FORMAT,
        stored.compression.as_str(),
        stored.bytes.as_slice(),
        stored_byte_length,
        decoded_byte_length,
        stored.decoded_blake3.as_slice(),
    ])?;
    write_component_index(tx, layer, mode)
}

fn encoded_len(bytes: u64) -> Result<i64, StoreError> {
    i64::try_from(bytes).map_err(|_| StoreError::LayerPayloadTooLarge {
        bytes,
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
    write_layer_in_tx(tx, &owner, layer)
}

pub(crate) fn create_empty_layer_in_tx(
    tx: &Transaction<'_>,
    glyph_id: &font::GlyphId,
    layer_id: font::LayerId,
    source_id: font::SourceId,
    width: f64,
    height: Option<f64>,
) -> Result<(), StoreError> {
    let mut layer = font::GlyphLayer::with_width(layer_id, source_id, width);
    layer.set_height(height);
    write_layer_in_tx(tx, glyph_id, &layer)
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
) -> Result<Option<font::GlyphId>, StoreError> {
    conn.query_row(
        "SELECT glyph_id FROM glyph_layers WHERE id = ?1",
        [layer_id.to_string()],
        |row| Ok(font::GlyphId::from_raw(row.get::<_, String>(0)?)),
    )
    .optional()
    .map_err(Into::into)
}

fn map_directory_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<GlyphLayerDirectoryEntry> {
    let stored_byte_length = directory_byte_length(row, 6)?;
    let decoded_byte_length = directory_byte_length(row, 7)?;
    Ok(GlyphLayerDirectoryEntry {
        layer_id: font::LayerId::from_raw(row.get::<_, String>(0)?),
        glyph_id: font::GlyphId::from_raw(row.get::<_, String>(1)?),
        source_id: font::SourceId::from_raw(row.get::<_, String>(2)?),
        name: row.get::<_, Option<String>>(3)?.map(font::GlyphName::from),
        width: row.get(4)?,
        height: row.get(5)?,
        stored_byte_length,
        decoded_byte_length,
    })
}

fn directory_byte_length(row: &rusqlite::Row<'_>, index: usize) -> rusqlite::Result<u64> {
    let byte_length = row.get::<_, i64>(index)?;
    u64::try_from(byte_length).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            index,
            rusqlite::types::Type::Integer,
            Box::new(error),
        )
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

        let tx = store.conn.transaction().unwrap();
        write_layer_in_tx(&tx, &glyph_id, &layer).unwrap();
        tx.commit().unwrap();

        let stored = store
            .conn
            .query_row(
                "SELECT compression, payload, stored_byte_length,
                        decoded_byte_length, decoded_blake3
                 FROM glyph_layer_payloads WHERE layer_id = ?1",
                [layer.id().to_string()],
                |row| {
                    Ok(StoredGlyphLayer {
                        compression: match row.get::<_, String>(0)?.as_str() {
                            "zstd.v1" => crate::types::LayerPayloadCompression::ZstandardV1,
                            _ => crate::types::LayerPayloadCompression::None,
                        },
                        bytes: row.get(1)?,
                        stored_byte_length: row.get::<_, i64>(2)? as u64,
                        decoded_byte_length: row.get::<_, i64>(3)? as u64,
                        decoded_blake3: row.get::<_, Vec<u8>>(4)?.try_into().unwrap(),
                    })
                },
            )
            .unwrap();
        assert_eq!(
            stored.compression,
            crate::types::LayerPayloadCompression::ZstandardV1
        );
        assert!(stored.stored_byte_length < stored.decoded_byte_length);
        assert_eq!(
            decompress_glyph_layer(layer.id().as_str(), stored).unwrap(),
            golden
        );
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
    fn requested_layers_load_across_multiple_count_bounded_batches() {
        let mut font = font::Font::new();
        let source_id = font.default_source_id().unwrap();
        let mut layer_ids = Vec::new();
        for index in 0..=MAX_LAYER_READ_BATCH_COUNT {
            let layer = font::GlyphLayer::with_width(
                font::LayerId::from_raw(format!("layer_{index:04}")),
                source_id.clone(),
                index as f64,
            );
            layer_ids.push(layer.id());
            let mut glyph = font::Glyph::new(format!("glyph_{index:04}"));
            glyph.set_layer(layer);
            font.insert_glyph(glyph).unwrap();
        }
        let mut store = ShiftStore::open_memory_for_test().unwrap();
        store.replace_font_state(&font).unwrap();

        let layers = store.load_glyph_layers(&layer_ids).unwrap();

        assert_eq!(layers.len(), layer_ids.len());
        assert_eq!(layers.first().unwrap().id(), layer_ids[0]);
        assert_eq!(layers.last().unwrap().id(), layer_ids[512]);
    }

    #[test]
    fn one_internal_batch_rejects_excessive_layer_counts_before_sql() {
        let store = ShiftStore::open_memory_for_test().unwrap();
        let layer_ids = (0..=MAX_LAYER_READ_BATCH_COUNT)
            .map(|index| font::LayerId::from_raw(format!("layer_{index}")))
            .collect::<Vec<_>>();

        assert!(matches!(
            load_glyph_layer_batch_from_conn(&store.conn, &layer_ids),
            Err(StoreError::LayerReadBatchTooLarge { .. })
        ));
    }

    #[test]
    fn batch_bounds_declared_decoded_bytes_before_fetching_payloads() {
        let (store, font) = populated_store();
        let layer_ids = font
            .glyphs()
            .flat_map(|glyph| glyph.layers().keys().cloned())
            .take(2)
            .collect::<Vec<_>>();
        let decoded_byte_length = MAX_LAYER_READ_BATCH_DECODED_BYTES / 2 + 1;
        for layer_id in &layer_ids {
            store
                .conn
                .execute(
                    "UPDATE glyph_layer_payloads
                     SET decoded_byte_length = ?1
                     WHERE layer_id = ?2",
                    params![decoded_byte_length as i64, layer_id.to_string()],
                )
                .unwrap();
        }

        assert!(matches!(
            load_glyph_layer_batch_from_conn(&store.conn, &layer_ids),
            Err(StoreError::LayerReadBatchDecodedTooLarge { .. })
        ));
    }

    #[test]
    fn mixed_compressed_and_uncompressed_layers_load_in_stable_order() {
        let (store, font) = populated_store();
        let mut layer_ids = font
            .glyphs()
            .flat_map(|glyph| glyph.layers().keys().cloned())
            .take(2)
            .collect::<Vec<_>>();
        layer_ids.sort_by(|left, right| left.as_str().cmp(right.as_str()));
        let uncompressed_layer = font.layer(layer_ids[0].clone()).unwrap();
        let packed = font::pack_glyph_layer(uncompressed_layer).unwrap();
        let decoded_blake3 = blake3::hash(packed.as_bytes());
        store
            .conn
            .execute(
                "UPDATE glyph_layer_payloads
                 SET compression = 'none', payload = ?1,
                     stored_byte_length = ?2, decoded_byte_length = ?2,
                     decoded_blake3 = ?3
                 WHERE layer_id = ?4",
                params![
                    packed.as_bytes(),
                    packed.as_bytes().len() as i64,
                    decoded_blake3.as_bytes().as_slice(),
                    layer_ids[0].to_string(),
                ],
            )
            .unwrap();

        let loaded = store.load_glyph_layers(&layer_ids).unwrap();

        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].id(), layer_ids[0]);
        assert_eq!(loaded[1].id(), layer_ids[1]);
        for layer in loaded {
            assert_eq!(font.layer(layer.id()).unwrap(), &layer);
        }
    }

    #[test]
    fn declared_stored_length_mismatch_is_rejected_before_decode() {
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
            .pragma_update(None, "ignore_check_constraints", "ON")
            .unwrap();
        store
            .conn
            .execute(
                "UPDATE glyph_layer_payloads
                 SET stored_byte_length = stored_byte_length + 1
                 WHERE layer_id = ?1",
                [layer_id.to_string()],
            )
            .unwrap();
        store
            .conn
            .pragma_update(None, "ignore_check_constraints", "OFF")
            .unwrap();

        assert!(matches!(
            store.load_glyph_layer(layer_id),
            Err(StoreError::LayerDirectoryMismatch { detail, .. })
                if detail.contains("declared stored byte length")
        ));
        assert!(matches!(
            store.load_glyph_layers(std::slice::from_ref(layer_id)),
            Err(StoreError::LayerDirectoryMismatch { detail, .. })
                if detail.contains("declared stored byte length")
        ));
    }

    #[test]
    fn layer_rewrite_transitions_from_uncompressed_to_zstd_consistently() {
        let (mut store, font) = populated_store();
        let layer = font
            .glyphs()
            .next()
            .unwrap()
            .layers()
            .values()
            .next()
            .unwrap();
        let packed = font::pack_glyph_layer(layer).unwrap();
        let uncompressed = StoredGlyphLayer {
            compression: crate::types::LayerPayloadCompression::None,
            bytes: packed.as_bytes().to_vec(),
            stored_byte_length: packed.as_bytes().len() as u64,
            decoded_byte_length: packed.as_bytes().len() as u64,
            decoded_blake3: *blake3::hash(packed.as_bytes()).as_bytes(),
        };
        let glyph_id = font.glyph_id_by_layer(layer.id()).unwrap();
        let tx = store.conn.transaction().unwrap();
        store_stored_layer_in_tx(&tx, &glyph_id, layer, &uncompressed, WriteMode::Upsert).unwrap();
        tx.commit().unwrap();
        assert_eq!(
            store
                .conn
                .query_row(
                    "SELECT compression FROM glyph_layer_payloads WHERE layer_id = ?1",
                    [layer.id().to_string()],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "none"
        );

        store.replace_glyph_layer(layer).unwrap();

        let (compression, stored, decoded, hash_length, payload_length) = store
            .conn
            .query_row(
                "SELECT compression, stored_byte_length, decoded_byte_length,
                        length(decoded_blake3), length(payload)
                 FROM glyph_layer_payloads WHERE layer_id = ?1",
                [layer.id().to_string()],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, i64>(4)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(compression, "zstd.v1");
        assert_eq!(stored, payload_length);
        assert!(stored < decoded);
        assert_eq!(hash_length, 32);
        assert_eq!(
            store.load_glyph_layer(&layer.id()).unwrap().unwrap(),
            **layer
        );
    }

    #[test]
    fn false_decoded_length_and_hash_are_rejected() {
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
                "UPDATE glyph_layer_payloads
                 SET decoded_byte_length = decoded_byte_length + 1
                 WHERE layer_id = ?1",
                [layer_id.to_string()],
            )
            .unwrap();
        assert!(matches!(
            store.load_glyph_layer(layer_id),
            Err(StoreError::LayerDirectoryMismatch { detail, .. })
                if detail.contains("decoded byte length")
        ));

        let packed = font::pack_glyph_layer(font.layer(layer_id.clone()).unwrap()).unwrap();
        store
            .conn
            .execute(
                "UPDATE glyph_layer_payloads
                 SET decoded_byte_length = ?1, decoded_blake3 = zeroblob(32)
                 WHERE layer_id = ?2",
                params![packed.as_bytes().len() as i64, layer_id.to_string()],
            )
            .unwrap();
        assert!(matches!(
            store.load_glyph_layer(layer_id),
            Err(StoreError::LayerDirectoryMismatch { detail, .. })
                if detail.contains("decoded BLAKE3 mismatch")
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
                "UPDATE glyph_layer_payloads
                 SET payload = X'00', stored_byte_length = 1
                 WHERE layer_id = ?1",
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
                "UPDATE glyph_layer_payloads
                 SET payload = X'00', stored_byte_length = 1
                 WHERE layer_id = ?1",
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
                .prepare("INSERT INTO glyph_layers (id, glyph_id, source_id, width, height) VALUES (?1, ?2, ?3, 1000, NULL)")
                .unwrap();
            let mut payload_stmt = tx
                .prepare(
                    "INSERT INTO glyph_layer_payloads (
                        layer_id, inner_format, compression, payload,
                        stored_byte_length, decoded_byte_length, decoded_blake3
                     ) VALUES (?1, ?2, 'none', X'00', 1, 1, zeroblob(32))",
                )
                .unwrap();
            for index in 0..GLYPH_COUNT {
                let glyph_id = font::GlyphId::from_raw(format!("cjk{index}")).to_string();
                let layer_id = font::LayerId::from_raw(format!("cjk{index}")).to_string();
                let name = format!("uni{index:05X}");
                glyph_stmt
                    .execute(params![glyph_id, name, index as i64])
                    .unwrap();
                layer_stmt
                    .execute(params![layer_id, glyph_id, source_id])
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
