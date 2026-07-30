use std::cell::RefCell;

use shift_font as font;

use crate::{
    StoreError,
    types::{LayerPayloadCompression, StoredGlyphLayer},
};

const ZSTD_COMPRESSION_LEVEL: i32 = 1;

thread_local! {
    static ZSTD_COMPRESSOR: RefCell<Option<zstd::bulk::Compressor<'static>>> = const { RefCell::new(None) };
    static ZSTD_DECOMPRESSOR: RefCell<Option<zstd::bulk::Decompressor<'static>>> = const { RefCell::new(None) };
}

pub(crate) fn compress_glyph_layer(decoded: &[u8]) -> Result<StoredGlyphLayer, StoreError> {
    check_layer_length(decoded.len() as u64)?;
    let compressed = ZSTD_COMPRESSOR.with(|slot| {
        let mut slot = slot.borrow_mut();
        if slot.is_none() {
            *slot = Some(
                zstd::bulk::Compressor::new(ZSTD_COMPRESSION_LEVEL)
                    .map_err(|error| StoreError::LayerCompression(error.to_string()))?,
            );
        }
        slot.as_mut()
            .expect("compressor was initialized")
            .compress(decoded)
            .map_err(|error| StoreError::LayerCompression(error.to_string()))
    })?;
    let decoded_byte_length = decoded.len() as u64;
    let decoded_blake3 = *blake3::hash(decoded).as_bytes();

    if compressed.len() < decoded.len() {
        return Ok(StoredGlyphLayer {
            compression: LayerPayloadCompression::ZstandardV1,
            stored_byte_length: compressed.len() as u64,
            decoded_byte_length,
            decoded_blake3,
            bytes: compressed,
        });
    }

    Ok(StoredGlyphLayer {
        compression: LayerPayloadCompression::None,
        stored_byte_length: decoded_byte_length,
        decoded_byte_length,
        decoded_blake3,
        bytes: decoded.to_vec(),
    })
}

pub(crate) fn decompress_glyph_layer(
    layer_id: &str,
    stored: StoredGlyphLayer,
) -> Result<Vec<u8>, StoreError> {
    check_layer_length(stored.stored_byte_length)?;
    check_layer_length(stored.decoded_byte_length)?;
    if stored.bytes.len() as u64 != stored.stored_byte_length {
        return Err(directory_mismatch(
            layer_id,
            format!(
                "stored byte length {} != actual {}",
                stored.stored_byte_length,
                stored.bytes.len()
            ),
        ));
    }

    let decoded = match stored.compression {
        LayerPayloadCompression::None => stored.bytes,
        LayerPayloadCompression::ZstandardV1 => {
            let frame_length =
                zstd::zstd_safe::find_frame_compressed_size(&stored.bytes).map_err(|code| {
                    StoreError::LayerDecompression(zstd::zstd_safe::get_error_name(code).to_owned())
                })?;
            if frame_length != stored.bytes.len() {
                return Err(directory_mismatch(
                    layer_id,
                    format!(
                        "zstd frame has {frame_length} bytes, stored payload has {}",
                        stored.bytes.len()
                    ),
                ));
            }
            let decoded_capacity = usize::try_from(stored.decoded_byte_length).map_err(|_| {
                StoreError::LayerPayloadTooLarge {
                    bytes: stored.decoded_byte_length,
                    limit: font::MAX_LAYER_PAYLOAD_BYTES as u64,
                }
            })?;
            ZSTD_DECOMPRESSOR.with(|slot| {
                let mut slot = slot.borrow_mut();
                if slot.is_none() {
                    *slot = Some(
                        zstd::bulk::Decompressor::new()
                            .map_err(|error| StoreError::LayerDecompression(error.to_string()))?,
                    );
                }
                slot.as_mut()
                    .expect("decompressor was initialized")
                    .decompress(&stored.bytes, decoded_capacity)
                    .map_err(|error| StoreError::LayerDecompression(error.to_string()))
            })?
        }
    };

    if decoded.len() as u64 != stored.decoded_byte_length {
        return Err(directory_mismatch(
            layer_id,
            format!(
                "decoded byte length {} != actual {}",
                stored.decoded_byte_length,
                decoded.len()
            ),
        ));
    }
    if blake3::hash(&decoded).as_bytes() != &stored.decoded_blake3 {
        return Err(directory_mismatch(layer_id, "decoded BLAKE3 mismatch"));
    }
    Ok(decoded)
}

pub(crate) fn parse_layer_compression(value: &str) -> Result<LayerPayloadCompression, StoreError> {
    match value {
        "none" => Ok(LayerPayloadCompression::None),
        "zstd.v1" => Ok(LayerPayloadCompression::ZstandardV1),
        value => Err(StoreError::UnsupportedLayerCompression(value.to_owned())),
    }
}

fn check_layer_length(bytes: u64) -> Result<(), StoreError> {
    let limit = font::MAX_LAYER_PAYLOAD_BYTES as u64;
    if bytes > limit {
        return Err(StoreError::LayerPayloadTooLarge { bytes, limit });
    }
    Ok(())
}

fn directory_mismatch(layer_id: &str, detail: impl Into<String>) -> StoreError {
    StoreError::LayerDirectoryMismatch {
        layer_id: layer_id.to_owned(),
        detail: detail.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn incompressible_bytes_fall_back_to_none() {
        let mut value = 0x1234_5678_u32;
        let decoded = (0..64)
            .map(|_| {
                value = value.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                (value >> 24) as u8
            })
            .collect::<Vec<_>>();

        let stored = compress_glyph_layer(&decoded).unwrap();

        assert_eq!(stored.compression, LayerPayloadCompression::None);
        assert_eq!(
            decompress_glyph_layer("layer_test", stored).unwrap(),
            decoded
        );
    }

    #[test]
    fn compressed_bytes_reject_truncation_trailing_data_and_wrong_hash() {
        let decoded = vec![0; 4096];
        let mut truncated = compress_glyph_layer(&decoded).unwrap();
        assert_eq!(truncated.compression, LayerPayloadCompression::ZstandardV1);
        truncated.bytes.pop();
        truncated.stored_byte_length -= 1;
        assert!(decompress_glyph_layer("layer_test", truncated).is_err());

        let mut trailing = compress_glyph_layer(&decoded).unwrap();
        trailing.bytes.push(0);
        trailing.stored_byte_length += 1;
        assert!(decompress_glyph_layer("layer_test", trailing).is_err());

        let mut wrong_hash = compress_glyph_layer(&decoded).unwrap();
        wrong_hash.decoded_blake3[0] ^= 1;
        assert!(decompress_glyph_layer("layer_test", wrong_hash).is_err());
    }

    #[test]
    fn unsupported_compression_and_oversized_decode_are_rejected() {
        assert!(matches!(
            parse_layer_compression("zstd.v2"),
            Err(StoreError::UnsupportedLayerCompression(_))
        ));

        let mut stored = compress_glyph_layer(&vec![0; 4096]).unwrap();
        stored.decoded_byte_length = font::MAX_LAYER_PAYLOAD_BYTES as u64 + 1;
        assert!(matches!(
            decompress_glyph_layer("layer_test", stored),
            Err(StoreError::LayerPayloadTooLarge { .. })
        ));
    }
}
