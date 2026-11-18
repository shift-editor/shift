use std::collections::HashMap;

use shift_font as font;

use super::{
    GLYPH_LAYER_FORMAT, MAX_LAYER_PAYLOAD_BYTES, MAX_LAYER_PAYLOAD_BYTES_SQL,
    payload::{LayerPayloadCompression, StoredLayerPayload},
};
use crate::{ShiftStore, StoreError};

/// Relational facts needed to locate a layer without reading its payload.
#[derive(Clone, Debug, PartialEq)]
pub struct GlyphLayerDirectoryEntry {
    pub layer_id: font::LayerId,
    pub glyph_id: font::GlyphId,
    /// The source the layer's location starts from; `None` for a layer
    /// placed by coordinates alone.
    pub source_id: Option<font::SourceId>,
    pub name: Option<font::GlyphName>,
    pub width: f64,
    pub height: Option<f64>,
    pub stored_byte_length: u64,
    pub decoded_byte_length: u64,
}

impl ShiftStore {
    /// Lists every layer's directory entry without reading payloads.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::Sqlite`] when the read fails.
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
    source_id: Option<font::SourceId>,
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
        self.compression.parse::<LayerPayloadCompression>()?;
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
        Ok(u64::try_from(self.decoded_byte_length)?)
    }

    /// Where the directory places the layer: its source, with `coordinates`
    /// laid over it.
    pub(super) fn placed_with(
        &self,
        coordinates: Option<font::DesignLocation>,
    ) -> font::LayerLocation {
        font::LayerLocation::new(self.source_id, coordinates.unwrap_or_default())
    }

    pub(super) fn stored_layer(&self, payload: Vec<u8>) -> Result<StoredLayerPayload, StoreError> {
        let decoded_blake3: [u8; 32] = self.decoded_blake3.as_slice().try_into().map_err(|_| {
            StoreError::LayerDirectoryMismatch {
                layer_id: self.layer_id.clone(),
                detail: "decoded BLAKE3 is not 32 bytes".to_string(),
            }
        })?;
        Ok(StoredLayerPayload {
            compression: self.compression.parse()?,
            stored_byte_length: u64::try_from(self.stored_byte_length)?,
            decoded_byte_length: u64::try_from(self.decoded_byte_length)?,
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

/// Checks a decoded payload against its directory row. Where the layer
/// draws is not checked: the directory alone says that, and the place the
/// payload records is left from before layers could draw off a source.
pub(super) fn validate_directory_facts(
    expected_id: font::LayerId,
    expected_width: f64,
    expected_height: Option<f64>,
    layer: &font::GlyphLayer,
) -> Result<(), StoreError> {
    let detail = if layer.id() != expected_id {
        Some(format!("payload id is {}", layer.id()))
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
        layer_id: row.get::<_, font::LayerId>(0)?,
        glyph_id: row.get::<_, font::GlyphId>(1)?,
        source_id: row.get::<_, Option<font::SourceId>>(2)?,
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

/// The coordinates of the locations of those of `layer_ids` that draw off
/// their source, by layer id.
pub(super) fn layer_coordinates(
    conn: &rusqlite::Connection,
    layer_ids: &[String],
) -> Result<HashMap<String, font::DesignLocation>, StoreError> {
    // One JSON parameter keeps the statement prepared for any count, and an
    // IN subquery keeps the recovery views searched by key.
    let mut stmt = conn.prepare_cached(
        "SELECT layer_id, axis_id, value FROM glyph_layer_locations
         WHERE layer_id IN (SELECT value FROM json_each(?1))",
    )?;
    let rows = stmt.query_map([serde_json::to_string(layer_ids)?], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, font::AxisId>(1)?,
            row.get::<_, f64>(2)?,
        ))
    })?;
    let mut coordinates: HashMap<String, font::DesignLocation> = HashMap::new();
    for row in rows {
        let (layer_id, axis_id, value) = row?;
        coordinates.entry(layer_id).or_default().set(axis_id, value);
    }
    Ok(coordinates)
}

/// The conditions of the components of those of `layer_ids` that have
/// any, by component id, each with its ranges in order.
pub(super) fn component_conditions(
    conn: &rusqlite::Connection,
    layer_ids: &[String],
) -> Result<HashMap<String, font::Condition>, StoreError> {
    let mut stmt = conn.prepare_cached(
        "SELECT component_id, axis_id, min_value, max_value FROM glyph_component_conditions
         WHERE layer_id IN (SELECT value FROM json_each(?1))
         ORDER BY component_id, order_index",
    )?;
    let rows = stmt.query_map([serde_json::to_string(layer_ids)?], |row| {
        Ok((
            row.get::<_, String>(0)?,
            font::ConditionRange::new(row.get(1)?, row.get(2)?, row.get(3)?),
        ))
    })?;
    let mut ranges: HashMap<String, Vec<font::ConditionRange>> = HashMap::new();
    for row in rows {
        let (component_id, range) = row?;
        ranges.entry(component_id).or_default().push(range);
    }
    Ok(ranges
        .into_iter()
        .map(|(component_id, ranges)| (component_id, font::Condition::all(ranges)))
        .collect())
}

/// Gives each of `layer`'s components its condition from `conditions`,
/// which a payload leaves out.
pub(super) fn attach_component_conditions(
    layer: &mut font::GlyphLayer,
    conditions: &HashMap<String, font::Condition>,
) {
    for component in layer.components_iter_mut() {
        if let Some(condition) = conditions.get(component.id().as_str()) {
            component.set_condition(condition.clone());
        }
    }
}
