use crate::{GlyphId, LayerId, ShiftStore, SourceId, StoreError};

pub struct NewGlyphLayer {
    pub id: LayerId,
    pub glyph_id: GlyphId,
    pub source_id: SourceId,
    pub name: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct GlyphLayerRecord {
    pub id: LayerId,
    pub glyph_id: GlyphId,
    pub source_id: SourceId,
    pub name: Option<String>,
    pub width: f64,
    pub height: Option<f64>,
}

impl ShiftStore {
    pub fn create_glyph_layer(&mut self, layer: NewGlyphLayer) -> Result<(), StoreError> {
        let tx = self.conn.transaction()?;
        crate::packed_layer::create_empty_layer_in_tx(
            &tx,
            &shift_font::GlyphId::from_raw(layer.glyph_id.as_str()),
            layer
                .name
                .as_deref()
                .map(shift_font::GlyphName::from)
                .as_ref(),
            shift_font::LayerId::from_raw(layer.id.as_str()),
            shift_font::SourceId::from_raw(layer.source_id.as_str()),
            0.0,
            None,
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn get_glyph_layer(&self, id: &LayerId) -> Result<Option<GlyphLayerRecord>, StoreError> {
        let mut stmt = self.conn.prepare(
            "
            SELECT
                id,
                glyph_id,
                source_id,
                name,
                width,
                height
            FROM glyph_layers
            WHERE id = ?1
            ",
        )?;

        match stmt.query_row([id.as_str()], map_glyph_layer_row) {
            Ok(layer) => Ok(Some(layer)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(err) => Err(err.into()),
        }
    }

    pub fn list_glyph_layers_for_glyph(
        &self,
        glyph_id: &GlyphId,
    ) -> Result<Vec<GlyphLayerRecord>, StoreError> {
        let mut stmt = self.conn.prepare(
            "
            SELECT
                id,
                glyph_id,
                source_id,
                name,
                width,
                height
            FROM glyph_layers
            WHERE glyph_id = ?1
            ORDER BY source_id, id
            ",
        )?;

        let rows = stmt.query_map([glyph_id.as_str()], map_glyph_layer_row)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(StoreError::from)
    }
}

fn map_glyph_layer_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<GlyphLayerRecord> {
    Ok(GlyphLayerRecord {
        id: LayerId::new(row.get::<_, String>(0)?),
        glyph_id: GlyphId::new(row.get::<_, String>(1)?),
        source_id: SourceId::new(row.get::<_, String>(2)?),
        name: row.get(3)?,
        width: row.get(4)?,
        height: row.get(5)?,
    })
}
