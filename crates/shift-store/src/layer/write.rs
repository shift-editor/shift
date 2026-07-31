use rusqlite::{Connection, OptionalExtension, Transaction, params};
use shift_font as font;

use super::{
    GLYPH_LAYER_FORMAT, MAX_LAYER_PAYLOAD_BYTES,
    format::encode_layer,
    payload::{StoredLayerPayload, compress_layer},
};
use crate::{
    ShiftStore, StoreError, workspace_state::mark_workspace_dirty_in_tx, write_mode::WriteMode,
};

impl ShiftStore {
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
}

pub(crate) fn write_layer_in_tx(
    tx: &Transaction<'_>,
    glyph_id: &font::GlyphId,
    layer: &font::GlyphLayer,
) -> Result<(), StoreError> {
    let encoded = encode_layer(layer)?;
    let stored = compress_layer(&encoded)?;
    store_stored_layer_in_tx(tx, glyph_id, layer, &stored, WriteMode::Upsert)
}

pub(crate) fn store_stored_layer_in_tx(
    tx: &Transaction<'_>,
    glyph_id: &font::GlyphId,
    layer: &font::GlyphLayer,
    stored: &StoredLayerPayload,
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
