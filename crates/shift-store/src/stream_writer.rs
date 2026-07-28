use rayon::prelude::*;
use rusqlite::Transaction;
use shift_font as font;

use crate::{
    ShiftStore, StoreError,
    change_set::{replace_font_header_in_tx, write_glyph_directory_in_tx},
    packed_layer::store_packed_layer_in_tx,
    workspace_state::mark_workspace_dirty_in_tx,
    write_mode::WriteMode,
};

/// Bounded transactional sink for format-specific importers.
///
/// A foreign reader can write one glyph or layer at a time without building a
/// complete [`font::Font`]. The transaction commits only when [`Self::finish`]
/// is called; dropping the writer rolls the entire stream back.
pub struct LayerStreamWriter<'store> {
    tx: Transaction<'store>,
    next_glyph_order: i64,
    mode: StreamMode,
}

#[derive(Clone, Copy)]
enum StreamMode {
    Update,
    Replacement,
}

impl StreamMode {
    fn write_mode(self) -> WriteMode {
        match self {
            Self::Update => WriteMode::Upsert,
            Self::Replacement => WriteMode::Insert,
        }
    }
}

impl ShiftStore {
    /// Starts a stream against the existing font directory.
    pub fn layer_stream_writer(&mut self) -> Result<LayerStreamWriter<'_>, StoreError> {
        let tx = self.conn.transaction()?;
        let next_glyph_order = tx.query_row(
            "SELECT COALESCE(MAX(order_index) + 1, 0) FROM glyphs",
            [],
            |row| row.get(0),
        )?;
        Ok(LayerStreamWriter {
            tx,
            next_glyph_order,
            mode: StreamMode::Update,
        })
    }

    /// Starts an atomic replacement using a glyph-free font header.
    pub fn font_stream_writer(
        &mut self,
        font_header: &font::Font,
    ) -> Result<LayerStreamWriter<'_>, StoreError> {
        let tx = self.conn.transaction()?;
        replace_font_header_in_tx(&tx, font_header)?;
        Ok(LayerStreamWriter {
            tx,
            next_glyph_order: 0,
            mode: StreamMode::Replacement,
        })
    }
}

impl LayerStreamWriter<'_> {
    /// Writes one complete glyph and all of its currently authored layers.
    pub fn write_glyph(&mut self, glyph: &font::Glyph) -> Result<(), StoreError> {
        self.write_glyph_batch(std::slice::from_ref(glyph))
    }

    /// Packs a bounded glyph batch in parallel, then writes it in stable order.
    pub fn write_glyph_batch(&mut self, glyphs: &[font::Glyph]) -> Result<(), StoreError> {
        let packed_layers = glyphs
            .par_iter()
            .map(|glyph| {
                glyph
                    .layers()
                    .values()
                    .map(|layer| font::pack_glyph_layer(layer).map(|packed| (layer.id(), packed)))
                    .collect::<Result<Vec<_>, _>>()
            })
            .collect::<Result<Vec<_>, font::PackedLayerError>>()?;

        let write_mode = self.mode.write_mode();
        for (glyph, packed_layers) in glyphs.iter().zip(packed_layers) {
            write_glyph_directory_in_tx(&self.tx, glyph, self.next_glyph_order, write_mode)?;
            for (layer_id, packed) in packed_layers {
                let layer =
                    glyph
                        .layers()
                        .get(&layer_id)
                        .ok_or_else(|| StoreError::MissingEntity {
                            kind: "glyph layer",
                            id: layer_id.to_string(),
                        })?;
                store_packed_layer_in_tx(
                    &self.tx,
                    &glyph.id(),
                    Some(glyph.glyph_name()),
                    layer,
                    &packed,
                    write_mode,
                )?;
            }
            self.next_glyph_order += 1;
        }
        Ok(())
    }

    /// Writes or replaces one independently-addressed layer.
    pub fn write_layer(
        &mut self,
        glyph_id: &font::GlyphId,
        glyph_name: Option<&font::GlyphName>,
        layer: &font::GlyphLayer,
    ) -> Result<(), StoreError> {
        crate::packed_layer::write_layer_in_tx(&self.tx, glyph_id, glyph_name, layer)
    }

    /// Atomically publishes every glyph and layer written by this stream.
    pub fn finish(self) -> Result<(), StoreError> {
        if matches!(self.mode, StreamMode::Update) {
            mark_workspace_dirty_in_tx(&self.tx)?;
        }
        self.tx.commit()?;
        Ok(())
    }
}
