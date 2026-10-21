use std::cell::RefCell;

use super::{MAX_LAYER_PAYLOAD_BYTES, check_layer_length};
use crate::StoreError;

const ZSTD_COMPRESSION_LEVEL: i32 = 1;

thread_local! {
    static ZSTD_COMPRESSOR: RefCell<Option<zstd::bulk::Compressor<'static>>> = const { RefCell::new(None) };
    static ZSTD_DECOMPRESSOR: RefCell<Option<zstd::bulk::Decompressor<'static>>> = const { RefCell::new(None) };
}

shift_font::string_enum! {
    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    pub(crate) enum LayerPayloadCompression {
        None => "none",
        ZstandardV1 => "zstd.v1",
    }
    parse_error: StoreError = |value| StoreError::UnsupportedLayerCompression(value.to_owned());
}

pub(crate) struct StoredLayerPayload {
    pub(crate) compression: LayerPayloadCompression,
    pub(crate) bytes: Vec<u8>,
    pub(crate) stored_byte_length: u64,
    pub(crate) decoded_byte_length: u64,
    pub(crate) decoded_blake3: [u8; 32],
}

impl StoredLayerPayload {
    /// Compresses a decoded layer payload with zstd, or keeps it as it is when
    /// compression would not make it smaller.
    ///
    /// # Errors
    ///
    /// [`StoreError::LayerPayloadTooLarge`] when `decoded` exceeds the layer
    /// size limit, and [`StoreError::LayerCompression`] when zstd fails.
    pub(crate) fn compress(decoded: &[u8]) -> Result<Self, StoreError> {
        check_layer_length(decoded.len() as u64)?;
        let compressed = ZSTD_COMPRESSOR.with(|slot| {
            let mut slot = slot.borrow_mut();
            if slot.is_none() {
                *slot = Some(
                    zstd::bulk::Compressor::new(ZSTD_COMPRESSION_LEVEL)
                        .map_err(StoreError::LayerCompression)?,
                );
            }
            slot.as_mut()
                .expect("compressor was initialized")
                .compress(decoded)
                .map_err(StoreError::LayerCompression)
        })?;
        let decoded_byte_length = decoded.len() as u64;
        let decoded_blake3 = *blake3::hash(decoded).as_bytes();

        if compressed.len() < decoded.len() {
            return Ok(Self {
                compression: LayerPayloadCompression::ZstandardV1,
                stored_byte_length: compressed.len() as u64,
                decoded_byte_length,
                decoded_blake3,
                bytes: compressed,
            });
        }

        Ok(Self {
            compression: LayerPayloadCompression::None,
            stored_byte_length: decoded_byte_length,
            decoded_byte_length,
            decoded_blake3,
            bytes: decoded.to_vec(),
        })
    }

    /// Decodes this payload, checking its stored and decoded lengths, its zstd
    /// frame and its BLAKE3 hash.
    ///
    /// # Errors
    ///
    /// [`StoreError::LayerDirectoryMismatch`] when a recorded length, the zstd
    /// frame or the hash disagrees with the bytes; [`StoreError::LayerPayloadTooLarge`]
    /// past the layer size limit; and [`StoreError::LayerDecompression`] when zstd
    /// fails.
    pub(crate) fn decode(self, layer_id: &str) -> Result<Vec<u8>, StoreError> {
        check_layer_length(self.stored_byte_length)?;
        check_layer_length(self.decoded_byte_length)?;
        if self.bytes.len() as u64 != self.stored_byte_length {
            return Err(Self::mismatch(
                layer_id,
                format!(
                    "stored byte length {} != actual {}",
                    self.stored_byte_length,
                    self.bytes.len()
                ),
            ));
        }

        let decoded = match self.compression {
            LayerPayloadCompression::None => self.bytes,
            LayerPayloadCompression::ZstandardV1 => {
                let frame_length = zstd::zstd_safe::find_frame_compressed_size(&self.bytes)
                    .map_err(|code| {
                        let reason = zstd::zstd_safe::get_error_name(code);
                        StoreError::LayerDecompression(std::io::Error::other(reason))
                    })?;
                if frame_length != self.bytes.len() {
                    return Err(Self::mismatch(
                        layer_id,
                        format!(
                            "zstd frame has {frame_length} bytes, stored payload has {}",
                            self.bytes.len()
                        ),
                    ));
                }
                let decoded_capacity = usize::try_from(self.decoded_byte_length).map_err(|_| {
                    StoreError::LayerPayloadTooLarge {
                        bytes: self.decoded_byte_length,
                        limit: MAX_LAYER_PAYLOAD_BYTES as u64,
                    }
                })?;
                ZSTD_DECOMPRESSOR.with(|slot| {
                    let mut slot = slot.borrow_mut();
                    if slot.is_none() {
                        *slot = Some(
                            zstd::bulk::Decompressor::new()
                                .map_err(StoreError::LayerDecompression)?,
                        );
                    }
                    slot.as_mut()
                        .expect("decompressor was initialized")
                        .decompress(&self.bytes, decoded_capacity)
                        .map_err(StoreError::LayerDecompression)
                })?
            }
        };

        if decoded.len() as u64 != self.decoded_byte_length {
            return Err(Self::mismatch(
                layer_id,
                format!(
                    "decoded byte length {} != actual {}",
                    self.decoded_byte_length,
                    decoded.len()
                ),
            ));
        }
        if blake3::hash(&decoded).as_bytes() != &self.decoded_blake3 {
            return Err(Self::mismatch(layer_id, "decoded BLAKE3 mismatch"));
        }
        Ok(decoded)
    }

    fn mismatch(layer_id: &str, detail: impl Into<String>) -> StoreError {
        StoreError::LayerDirectoryMismatch {
            layer_id: layer_id.to_owned(),
            detail: detail.into(),
        }
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

        let stored = StoredLayerPayload::compress(&decoded).unwrap();

        assert_eq!(stored.compression, LayerPayloadCompression::None);
        assert_eq!(stored.decode("layer_test").unwrap(), decoded);
    }

    #[test]
    fn compressed_bytes_reject_truncation_trailing_data_and_wrong_hash() {
        let decoded = vec![0; 4096];
        let mut truncated = StoredLayerPayload::compress(&decoded).unwrap();
        assert_eq!(truncated.compression, LayerPayloadCompression::ZstandardV1);
        truncated.bytes.pop();
        truncated.stored_byte_length -= 1;
        truncated.decode("layer_test").unwrap_err();

        let mut trailing = StoredLayerPayload::compress(&decoded).unwrap();
        trailing.bytes.push(0);
        trailing.stored_byte_length += 1;
        trailing.decode("layer_test").unwrap_err();

        let mut wrong_hash = StoredLayerPayload::compress(&decoded).unwrap();
        wrong_hash.decoded_blake3[0] ^= 1;
        wrong_hash.decode("layer_test").unwrap_err();
    }

    #[test]
    fn unsupported_compression_and_oversized_decode_are_rejected() {
        assert!(matches!(
            "zstd.v2".parse::<LayerPayloadCompression>(),
            Err(StoreError::UnsupportedLayerCompression(_))
        ));

        let mut stored = StoredLayerPayload::compress(&vec![0; 4096]).unwrap();
        stored.decoded_byte_length = MAX_LAYER_PAYLOAD_BYTES as u64 + 1;
        assert!(matches!(
            stored.decode("layer_test"),
            Err(StoreError::LayerPayloadTooLarge { .. })
        ));
    }
}
