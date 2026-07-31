use std::{cell::RefCell, collections::HashSet, io::Cursor};

use serde::Deserialize;
use shift_font::{self as font, GlyphEntityId, LibValue};

use crate::{
    StoreError,
    types::{LayerPayloadCompression, StoredLayerPayload},
};

pub(crate) const MAX_LAYER_PAYLOAD_BYTES: usize = 256 * 1024 * 1024;
const MAX_NESTING_DEPTH: usize = 64;
const MAX_LIB_VALUES: usize = 1_000_000;
const ZSTD_COMPRESSION_LEVEL: i32 = 1;

thread_local! {
    static ZSTD_COMPRESSOR: RefCell<Option<zstd::bulk::Compressor<'static>>> = const { RefCell::new(None) };
    static ZSTD_DECOMPRESSOR: RefCell<Option<zstd::bulk::Decompressor<'static>>> = const { RefCell::new(None) };
}

pub(crate) fn encode_layer(layer: &font::GlyphLayer) -> Result<Vec<u8>, StoreError> {
    validate_layer(layer).map_err(StoreError::InvalidLayerPayload)?;
    let bytes =
        rmp_serde::to_vec(layer).map_err(|error| StoreError::LayerEncoding(error.to_string()))?;
    check_layer_length(bytes.len() as u64)?;
    Ok(bytes)
}

pub(crate) fn decode_layer(bytes: &[u8]) -> Result<font::GlyphLayer, StoreError> {
    check_layer_length(bytes.len() as u64)?;
    let mut decoder = rmp_serde::Deserializer::new(Cursor::new(bytes));
    decoder.set_max_depth(MAX_NESTING_DEPTH);
    let layer = font::GlyphLayer::deserialize(&mut decoder)
        .map_err(|error| StoreError::LayerDecoding(error.to_string()))?;
    let consumed = decoder.position() as usize;
    if consumed != bytes.len() {
        return Err(StoreError::LayerDecoding(format!(
            "payload has {} trailing bytes",
            bytes.len() - consumed
        )));
    }
    validate_layer(&layer).map_err(StoreError::InvalidLayerPayload)?;
    Ok(layer)
}

fn validate_layer(layer: &font::GlyphLayer) -> Result<(), String> {
    validate_finite(layer.width(), "width")?;
    if let Some(height) = layer.height() {
        validate_finite(height, "height")?;
    }

    let mut entity_ids = HashSet::new();
    for contour in layer.contours_iter() {
        record_entity(&mut entity_ids, contour.id().into())?;
        for point in contour.points() {
            record_entity(&mut entity_ids, point.id().into())?;
            validate_finite(point.x(), "point x")?;
            validate_finite(point.y(), "point y")?;
        }
    }

    for component in layer.components_iter() {
        record_entity(&mut entity_ids, component.id().into())?;
        let transform = component.transform();
        for (value, field) in [
            (transform.translate_x, "component translate x"),
            (transform.translate_y, "component translate y"),
            (transform.rotation, "component rotation"),
            (transform.scale_x, "component scale x"),
            (transform.scale_y, "component scale y"),
            (transform.skew_x, "component skew x"),
            (transform.skew_y, "component skew y"),
            (transform.t_center_x, "component center x"),
            (transform.t_center_y, "component center y"),
        ] {
            validate_finite(value, field)?;
        }
    }

    for anchor in layer.anchors_iter() {
        record_entity(&mut entity_ids, anchor.id().into())?;
        validate_finite(anchor.x(), "anchor x")?;
        validate_finite(anchor.y(), "anchor y")?;
    }

    for guideline in layer.guidelines() {
        record_entity(&mut entity_ids, guideline.id().into())?;
        for (value, field) in [
            (guideline.x(), "guideline x"),
            (guideline.y(), "guideline y"),
            (guideline.angle(), "guideline angle"),
        ] {
            if let Some(value) = value {
                validate_finite(value, field)?;
            }
        }
    }

    let mut lib_values = 0;
    for value in layer.lib().iter().map(|(_, value)| value) {
        validate_lib_value(value, 0, &mut lib_values)?;
    }
    Ok(())
}

fn record_entity(
    entity_ids: &mut HashSet<GlyphEntityId>,
    entity_id: GlyphEntityId,
) -> Result<(), String> {
    if entity_ids.insert(entity_id.clone()) {
        return Ok(());
    }

    let (kind, value) = match &entity_id {
        GlyphEntityId::Contour(id) => ("contour", id.as_str()),
        GlyphEntityId::Point(id) => ("point", id.as_str()),
        GlyphEntityId::Component(id) => ("component", id.as_str()),
        GlyphEntityId::Anchor(id) => ("anchor", id.as_str()),
        GlyphEntityId::Guideline(id) => ("guideline", id.as_str()),
    };
    Err(format!("duplicate {kind} ID {value:?}"))
}

fn validate_lib_value(value: &LibValue, depth: usize, count: &mut usize) -> Result<(), String> {
    if depth >= MAX_NESTING_DEPTH {
        return Err("layer lib is nested too deeply".to_string());
    }
    *count += 1;
    if *count > MAX_LIB_VALUES {
        return Err("layer lib has too many values".to_string());
    }

    match value {
        LibValue::Float(value) => validate_finite(*value, "layer lib float"),
        LibValue::Array(values) => {
            for value in values {
                validate_lib_value(value, depth + 1, count)?;
            }
            Ok(())
        }
        LibValue::Dict(values) => {
            for value in values.values() {
                validate_lib_value(value, depth + 1, count)?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

fn validate_finite(value: f64, field: &str) -> Result<(), String> {
    if value.is_finite() {
        return Ok(());
    }

    Err(format!("non-finite {field}"))
}

pub(crate) fn compress_glyph_layer(decoded: &[u8]) -> Result<StoredLayerPayload, StoreError> {
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
        return Ok(StoredLayerPayload {
            compression: LayerPayloadCompression::ZstandardV1,
            stored_byte_length: compressed.len() as u64,
            decoded_byte_length,
            decoded_blake3,
            bytes: compressed,
        });
    }

    Ok(StoredLayerPayload {
        compression: LayerPayloadCompression::None,
        stored_byte_length: decoded_byte_length,
        decoded_byte_length,
        decoded_blake3,
        bytes: decoded.to_vec(),
    })
}

pub(crate) fn decompress_glyph_layer(
    layer_id: &str,
    stored: StoredLayerPayload,
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
                    limit: MAX_LAYER_PAYLOAD_BYTES as u64,
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

fn check_layer_length(bytes: u64) -> Result<(), StoreError> {
    let limit = MAX_LAYER_PAYLOAD_BYTES as u64;
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
    use std::collections::BTreeMap;

    use super::*;

    #[test]
    fn complete_layer_roundtrips_through_deterministic_bytes() {
        let font = font::test_support::sample_font();
        let layer = font
            .glyph_by_name("A")
            .unwrap()
            .layers()
            .values()
            .find(|layer| !layer.lib().is_empty())
            .unwrap();

        let encoded = encode_layer(layer).unwrap();
        let decoded = decode_layer(&encoded).unwrap();

        assert_eq!(&decoded, layer.as_ref());
        assert_eq!(encode_layer(&decoded).unwrap(), encoded);
    }

    #[test]
    fn map_insertion_order_does_not_change_bytes() {
        let font = font::test_support::sample_font();
        let mut layer = font
            .glyph_by_name("A")
            .unwrap()
            .layers()
            .values()
            .next()
            .unwrap()
            .as_ref()
            .clone();
        let mut nested = BTreeMap::new();
        for index in (0..100).rev() {
            layer.lib_mut().set(
                format!("root-{index:03}"),
                LibValue::Integer(i64::from(index)),
            );
            nested.insert(
                format!("nested-{index:03}"),
                LibValue::Integer(i64::from(index)),
            );
        }
        layer.lib_mut().set("nested".into(), LibValue::Dict(nested));

        let first = encode_layer(&layer).unwrap();
        let decoded = decode_layer(&first).unwrap();

        assert_eq!(encode_layer(&decoded).unwrap(), first);
    }

    #[test]
    fn truncations_and_trailing_bytes_are_rejected() {
        let font = font::test_support::sample_font();
        let layer = font
            .glyph_by_name("A")
            .unwrap()
            .layers()
            .values()
            .next()
            .unwrap();
        let complete = encode_layer(layer).unwrap();
        for length in 0..complete.len() {
            assert!(
                decode_layer(&complete[..length]).is_err(),
                "accepted truncation at {length}"
            );
        }

        let mut trailing = complete;
        trailing.push(0);
        assert!(decode_layer(&trailing).is_err());
    }

    #[test]
    fn hostile_declared_collection_length_is_rejected() {
        let mut bytes = vec![0x99, 0xa7];
        bytes.extend_from_slice(b"layer_x");
        bytes.push(0xa8);
        bytes.extend_from_slice(b"source_x");
        bytes.extend_from_slice(&[0xcb, 0, 0, 0, 0, 0, 0, 0, 0]);
        bytes.push(0xc0);
        bytes.extend_from_slice(&[0xdd, 0xff, 0xff, 0xff, 0xff]);

        assert!(decode_layer(&bytes).is_err());
    }

    #[test]
    fn excessive_nesting_is_rejected_before_encode_and_during_decode() {
        let font = font::test_support::sample_font();
        let mut layer = font
            .glyph_by_name("A")
            .unwrap()
            .layers()
            .values()
            .next()
            .unwrap()
            .as_ref()
            .clone();
        let mut value = LibValue::Boolean(true);
        for _ in 0..MAX_NESTING_DEPTH + 1 {
            value = LibValue::Array(vec![value]);
        }
        layer.lib_mut().set("nested".into(), value);

        assert!(encode_layer(&layer).is_err());
        let encoded = rmp_serde::to_vec(&layer).unwrap();
        assert!(decode_layer(&encoded).is_err());
    }

    #[test]
    fn invalid_ids_and_non_finite_values_are_rejected() {
        let invalid_id = rmp_serde::to_vec(&(
            "wrong",
            "source_test",
            0.0_f64,
            None::<f64>,
            Vec::<font::Contour>::new(),
            Vec::<font::Component>::new(),
            Vec::<font::Anchor>::new(),
            Vec::<font::Guideline>::new(),
            font::LibData::new(),
        ))
        .unwrap();
        assert!(decode_layer(&invalid_id).is_err());

        let non_finite = rmp_serde::to_vec(&(
            "layer_test",
            "source_test",
            f64::NAN,
            None::<f64>,
            Vec::<font::Contour>::new(),
            Vec::<font::Component>::new(),
            Vec::<font::Anchor>::new(),
            Vec::<font::Guideline>::new(),
            font::LibData::new(),
        ))
        .unwrap();
        assert!(matches!(
            decode_layer(&non_finite),
            Err(StoreError::InvalidLayerPayload(_))
        ));
    }

    #[test]
    fn duplicate_point_identity_is_rejected() {
        let point_id = font::PointId::from_raw("duplicate");
        let mut contour = font::Contour::new();
        contour.push_point(font::Point::new(
            point_id.clone(),
            0.0,
            0.0,
            font::PointType::OnCurve,
            false,
        ));
        contour.push_point(font::Point::new(
            point_id,
            1.0,
            1.0,
            font::PointType::OnCurve,
            false,
        ));
        let mut layer = font::GlyphLayer::new(
            font::LayerId::from_raw("test"),
            font::SourceId::from_raw("test"),
        );
        layer.add_contour(contour);

        assert!(matches!(
            encode_layer(&layer),
            Err(StoreError::InvalidLayerPayload(_))
        ));
    }

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
            LayerPayloadCompression::try_from("zstd.v2"),
            Err(StoreError::UnsupportedLayerCompression(_))
        ));

        let mut stored = compress_glyph_layer(&vec![0; 4096]).unwrap();
        stored.decoded_byte_length = MAX_LAYER_PAYLOAD_BYTES as u64 + 1;
        assert!(matches!(
            decompress_glyph_layer("layer_test", stored),
            Err(StoreError::LayerPayloadTooLarge { .. })
        ));
    }
}
