use std::collections::{HashMap, HashSet};

use rayon::prelude::*;
use rusqlite::{Connection, OptionalExtension, params};
use shift_font as font;

use super::{
    MAX_LAYER_PAYLOAD_BYTES,
    directory::{map_directory_facts_row, validate_directory_facts},
    format::decode_layer,
    payload::decompress_layer,
    references::{validate_component_index, validate_component_rows},
};
use crate::{ShiftStore, StoreError};

pub const MAX_LAYER_READ_BATCH_COUNT: usize = 512;
pub const MAX_LAYER_READ_BATCH_DECODED_BYTES: u64 = 256 * 1024 * 1024;
const MAX_LAYER_PAYLOAD_BYTES_SQL: i64 = MAX_LAYER_PAYLOAD_BYTES as i64;

struct LayerDirectoryRead {
    facts: HashMap<String, super::directory::DirectoryFacts>,
    decoded_byte_lengths: Vec<u64>,
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
                MAX_LAYER_PAYLOAD_BYTES_SQL
            ],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| StoreError::LayerDirectoryMismatch {
            layer_id: layer_id.to_string(),
            detail: "payload changed during bounded read".to_string(),
        })?;
    let decoded = decompress_layer(facts.layer_id.as_str(), facts.stored_layer(payload)?)?;
    let layer = decode_layer(&decoded)?;
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
        let directory = read_layer_directory(conn, count_batch)?;
        let mut batch = Vec::new();
        let mut batch_decoded_bytes = 0_u64;
        for (key, decoded_byte_length) in count_batch
            .iter()
            .zip(directory.decoded_byte_lengths.iter().copied())
        {
            if !batch.is_empty()
                && batch_decoded_bytes.saturating_add(decoded_byte_length)
                    > MAX_LAYER_READ_BATCH_DECODED_BYTES
            {
                layers.extend(load_glyph_layer_batch_with_directory(
                    conn,
                    &batch,
                    &directory.facts,
                )?);
                batch.clear();
                batch_decoded_bytes = 0;
            }
            batch.push(font::LayerId::from_raw(key.clone()));
            batch_decoded_bytes = batch_decoded_bytes.saturating_add(decoded_byte_length);
        }
        if !batch.is_empty() {
            layers.extend(load_glyph_layer_batch_with_directory(
                conn,
                &batch,
                &directory.facts,
            )?);
        }
    }

    Ok(layers)
}

#[cfg(test)]
pub(super) fn load_glyph_layer_batch_from_conn(
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

    let directory = read_layer_directory(conn, &keys)?;
    let batch_decoded_bytes = directory
        .decoded_byte_lengths
        .iter()
        .fold(0_u64, |total, length| total.saturating_add(*length));
    if batch_decoded_bytes > MAX_LAYER_READ_BATCH_DECODED_BYTES {
        return Err(StoreError::LayerReadBatchDecodedTooLarge {
            bytes: batch_decoded_bytes,
            limit: MAX_LAYER_READ_BATCH_DECODED_BYTES,
        });
    }
    let layer_ids = keys
        .iter()
        .cloned()
        .map(font::LayerId::from_raw)
        .collect::<Vec<_>>();
    load_glyph_layer_batch_with_directory(conn, &layer_ids, &directory.facts)
}

fn read_layer_directory(
    conn: &Connection,
    keys: &[String],
) -> Result<LayerDirectoryRead, StoreError> {
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
    for row in directory_rows {
        let facts_row = row?;
        facts.insert(facts_row.layer_id.clone(), facts_row);
    }
    drop(directory_stmt);

    let mut decoded_byte_lengths = Vec::with_capacity(keys.len());
    for key in keys {
        let facts = facts.get(key).ok_or_else(|| StoreError::MissingEntity {
            kind: "glyph layer",
            id: key.clone(),
        })?;
        decoded_byte_lengths.push(facts.validate()?);
    }

    Ok(LayerDirectoryRead {
        facts,
        decoded_byte_lengths,
    })
}

fn load_glyph_layer_batch_with_directory(
    conn: &Connection,
    layer_ids: &[font::LayerId],
    facts: &HashMap<String, super::directory::DirectoryFacts>,
) -> Result<Vec<font::GlyphLayer>, StoreError> {
    let keys = layer_ids
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    let placeholders = (0..keys.len()).map(|_| "?").collect::<Vec<_>>().join(",");
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
    payload_params.push(rusqlite::types::Value::Integer(MAX_LAYER_PAYLOAD_BYTES_SQL));
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
            let decoded = decompress_layer(layer_id.as_str(), facts.stored_layer(payload)?)?;
            let layer = decode_layer(&decoded)?;
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
