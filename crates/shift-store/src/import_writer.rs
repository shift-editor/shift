use std::time::Instant;

use rayon::prelude::*;
use rusqlite::Transaction;
use shift_font as font;

use crate::{
    GlyphWriteBatch, LayerBatchTiming, ShiftStore, StoreError,
    change_set::{
        replace_font_header_in_tx, replace_glyph_authoring_in_tx, write_glyph_directory_in_tx,
    },
    layer::{StoredLayerPayload, compress_layer, encode_layer, store_stored_layer_in_tx},
    schema::{defer_import_indexes, restore_import_indexes},
    types::{EncodedGlyphLayers, PackedGlyph},
    write_mode::WriteMode,
};

/// Bounded transactional sink for format-specific importers.
///
/// A foreign reader can write one glyph batch at a time without building a
/// complete [`font::Font`]. The transaction commits only when [`Self::finish`]
/// is called; dropping the writer rolls the entire stream back.
pub struct FontImportWriter<'store> {
    tx: Transaction<'store>,
    next_glyph_order: i64,
}

impl ShiftStore {
    /// Starts an atomic replacement using a glyph-free font header.
    pub fn begin_import(
        &mut self,
        font_header: &font::Font,
    ) -> Result<FontImportWriter<'_>, StoreError> {
        let tx = self.conn.transaction()?;
        replace_font_header_in_tx(&tx, font_header)?;
        defer_import_indexes(&tx)?;
        Ok(FontImportWriter {
            tx,
            next_glyph_order: 0,
        })
    }
}

/// Encodes and compresses an owned bounded glyph batch without touching SQLite.
/// The returned batch retains glyph directory facts for the single writer.
pub fn encode_glyph_batch(glyphs: Vec<font::Glyph>) -> Result<GlyphWriteBatch, StoreError> {
    let started = Instant::now();
    let encoded_layers = encode_glyph_layers(&glyphs)?;
    let pack_elapsed = started.elapsed();
    let started = Instant::now();
    let layers = compress_glyph_layers(encoded_layers)?;
    let compression_elapsed = started.elapsed();
    let glyphs = glyphs
        .into_iter()
        .zip(layers)
        .map(|(glyph, layers)| PackedGlyph { glyph, layers })
        .collect();

    Ok(GlyphWriteBatch {
        glyphs,
        pack_elapsed,
        compression_elapsed,
    })
}

impl FontImportWriter<'_> {
    /// Writes one complete glyph and all of its currently authored layers.
    pub fn write_glyph(&mut self, glyph: &font::Glyph) -> Result<(), StoreError> {
        self.write_glyph_batch(std::slice::from_ref(glyph))?;
        Ok(())
    }

    /// Encodes a bounded glyph batch in parallel, then writes it in stable order.
    pub fn write_glyph_batch(
        &mut self,
        glyphs: &[font::Glyph],
    ) -> Result<LayerBatchTiming, StoreError> {
        let started = Instant::now();
        let encoded_layers = encode_glyph_layers(glyphs)?;
        let pack_elapsed = started.elapsed();
        let started = Instant::now();
        let layers = compress_glyph_layers(encoded_layers)?;
        let compression_elapsed = started.elapsed();

        let started = Instant::now();
        for (glyph, layers) in glyphs.iter().zip(&layers) {
            self.write_packed_glyph(glyph, layers)?;
        }

        Ok(LayerBatchTiming {
            pack_elapsed,
            compression_elapsed,
            sqlite_elapsed: started.elapsed(),
        })
    }

    /// Writes a prepared batch in stable order through the owned transaction.
    pub fn write_packed_glyph_batch(
        &mut self,
        batch: GlyphWriteBatch,
    ) -> Result<std::time::Duration, StoreError> {
        let started = Instant::now();
        for glyph in &batch.glyphs {
            self.write_packed_glyph(&glyph.glyph, &glyph.layers)?;
        }
        Ok(started.elapsed())
    }

    fn write_packed_glyph(
        &mut self,
        glyph: &font::Glyph,
        layers: &[(font::LayerId, StoredLayerPayload)],
    ) -> Result<(), StoreError> {
        write_glyph_directory_in_tx(&self.tx, glyph, self.next_glyph_order, WriteMode::Insert)?;
        for (layer_id, stored) in layers {
            let layer = glyph
                .layers()
                .get(layer_id)
                .ok_or_else(|| StoreError::MissingEntity {
                    kind: "glyph layer",
                    id: layer_id.to_string(),
                })?;
            store_stored_layer_in_tx(&self.tx, &glyph.id(), layer, stored, WriteMode::Insert)?;
        }
        replace_glyph_authoring_in_tx(&self.tx, glyph)?;
        self.next_glyph_order += 1;
        Ok(())
    }

    /// Atomically publishes every glyph and layer written by this stream.
    pub fn finish(self) -> Result<(), StoreError> {
        restore_import_indexes(&self.tx)?;
        self.tx.commit()?;
        Ok(())
    }
}

fn encode_glyph_layers(glyphs: &[font::Glyph]) -> Result<EncodedGlyphLayers, StoreError> {
    glyphs
        .par_iter()
        .map(|glyph| {
            glyph
                .layers()
                .values()
                .map(|layer| encode_layer(layer).map(|encoded| (layer.id(), encoded)))
                .collect::<Result<Vec<_>, _>>()
        })
        .collect()
}

fn compress_glyph_layers(
    layers: Vec<Vec<(font::LayerId, Vec<u8>)>>,
) -> Result<Vec<Vec<(font::LayerId, StoredLayerPayload)>>, StoreError> {
    layers
        .into_par_iter()
        .map(|layers| {
            layers
                .into_iter()
                .map(|(layer_id, encoded)| {
                    compress_layer(&encoded).map(|stored| (layer_id, stored))
                })
                .collect::<Result<Vec<_>, _>>()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const DEFERRED_INDEXES: [&str; 8] = [
        "glyphs_name_idx",
        "glyph_axes_glyph_id_idx",
        "glyph_variants_glyph_id_idx",
        "glyph_layers_glyph_id_idx",
        "glyph_sources_glyph_id_idx",
        "glyph_sources_layer_id_idx",
        "glyph_sources_base_source_id_idx",
        "glyph_components_base_glyph_id_idx",
    ];

    #[test]
    fn stream_indexes_are_transactionally_deferred_and_restored() {
        let font = font::test_support::sample_font();
        let mut store = ShiftStore::open_memory_for_test().unwrap();
        for name in DEFERRED_INDEXES {
            assert!(index_exists(&store.conn, name));
        }
        assert!(!index_exists(&store.conn, "glyph_unicodes_glyph_id_idx"));
        assert!(!index_exists(&store.conn, "glyph_components_layer_id_idx"));

        {
            let writer = store.begin_import(&font).unwrap();
            for name in DEFERRED_INDEXES {
                assert!(!index_exists(&writer.tx, name));
            }
        }
        for name in DEFERRED_INDEXES {
            assert!(index_exists(&store.conn, name));
        }

        let mut writer = store.begin_import(&font).unwrap();
        for glyph in font.glyphs() {
            writer.write_glyph(glyph).unwrap();
        }
        writer.finish().unwrap();
        for name in DEFERRED_INDEXES {
            assert!(index_exists(&store.conn, name));
        }
    }

    fn index_exists(conn: &rusqlite::Connection, name: &str) -> bool {
        conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'index' AND name = ?1)",
            [name],
            |row| row.get(0),
        )
        .unwrap()
    }
}
