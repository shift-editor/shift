use shift_font as font;

use super::{
    GLYPH_LAYER_FORMAT, MAX_LAYER_PAYLOAD_BYTES,
    payload::{LayerPayloadCompression, StoredLayerPayload},
};
use crate::{ShiftStore, StoreError};

const MAX_LAYER_PAYLOAD_BYTES_SQL: i64 = MAX_LAYER_PAYLOAD_BYTES as i64;

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
}

pub(super) struct DirectoryFacts {
    pub(super) layer_id: String,
    pub(super) source_id: String,
    pub(super) width: f64,
    pub(super) height: Option<f64>,
    inner_format: String,
    compression: String,
    stored_byte_length: i64,
    decoded_byte_length: i64,
    decoded_blake3: Vec<u8>,
    pub(super) actual_stored_byte_length: i64,
}

impl DirectoryFacts {
    pub(super) fn validate(&self) -> Result<u64, StoreError> {
        if self.inner_format != GLYPH_LAYER_FORMAT {
            return Err(StoreError::UnsupportedLayerFormat(
                self.inner_format.clone(),
            ));
        }
        LayerPayloadCompression::try_from(self.compression.as_str())?;
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
            if !(0..=MAX_LAYER_PAYLOAD_BYTES_SQL).contains(&byte_length) {
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

    pub(super) fn stored_layer(&self, payload: Vec<u8>) -> Result<StoredLayerPayload, StoreError> {
        let decoded_blake3: [u8; 32] = self.decoded_blake3.as_slice().try_into().map_err(|_| {
            StoreError::LayerDirectoryMismatch {
                layer_id: self.layer_id.clone(),
                detail: "decoded BLAKE3 is not 32 bytes".to_string(),
            }
        })?;
        Ok(StoredLayerPayload {
            compression: self.compression.as_str().try_into()?,
            stored_byte_length: self.stored_byte_length as u64,
            decoded_byte_length: self.decoded_byte_length as u64,
            decoded_blake3,
            bytes: payload,
        })
    }
}

pub(super) fn map_directory_facts_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DirectoryFacts> {
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

pub(super) fn validate_directory_facts(
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
