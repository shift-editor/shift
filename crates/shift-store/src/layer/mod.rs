mod directory;
mod format;
mod load;
mod payload;
mod references;
mod write;

#[cfg(test)]
mod tests;

#[cfg(test)]
use load::load_glyph_layer_batch_from_conn;
#[cfg(test)]
use payload::{LayerPayloadCompression, decompress_layer};

pub use directory::GlyphLayerDirectoryEntry;
pub use format::GLYPH_LAYER_FORMAT;
pub use load::{MAX_LAYER_READ_BATCH_COUNT, MAX_LAYER_READ_BATCH_DECODED_BYTES};

pub(crate) use format::encode_layer;
pub(crate) use load::{load_glyph_layer_from_conn, load_glyph_layers_from_conn};
pub(crate) use payload::{StoredLayerPayload, compress_layer};
pub(crate) use write::{
    create_empty_layer_in_tx, rewrite_layer_in_tx, store_stored_layer_in_tx, write_layer_in_tx,
};

pub(crate) const MAX_LAYER_PAYLOAD_BYTES: usize = 256 * 1024 * 1024;

fn check_layer_length(bytes: u64) -> Result<(), crate::StoreError> {
    let limit = MAX_LAYER_PAYLOAD_BYTES as u64;
    if bytes > limit {
        return Err(crate::StoreError::LayerPayloadTooLarge { bytes, limit });
    }

    Ok(())
}
