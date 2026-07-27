use shift_font as font;

use crate::{ShiftStore, StoreError, workspace_state::mark_workspace_dirty_in_tx};

/// Bounded sink for format-specific importers.
///
/// The caller owns parsing and directory creation. Each call encodes one
/// authored layer, derives its relational reference rows, commits both, and
/// returns before the caller parses the next layer. No complete `Font` is
/// required by this API.
pub struct LayerStreamWriter<'store> {
    store: &'store mut ShiftStore,
}

impl ShiftStore {
    pub fn layer_stream_writer(&mut self) -> LayerStreamWriter<'_> {
        LayerStreamWriter { store: self }
    }
}

impl LayerStreamWriter<'_> {
    pub fn write_layer(
        &mut self,
        glyph_id: &font::GlyphId,
        glyph_name: Option<&font::GlyphName>,
        layer: &font::GlyphLayer,
    ) -> Result<(), StoreError> {
        let tx = self.store.conn.transaction()?;
        crate::packed_layer::write_layer_in_tx(&tx, glyph_id, glyph_name, layer)?;
        mark_workspace_dirty_in_tx(&tx)?;
        tx.commit()?;
        Ok(())
    }
}
