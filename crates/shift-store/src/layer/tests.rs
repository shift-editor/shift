use std::time::{Duration, Instant};

use rusqlite::params;
use shift_font as font;

use super::*;
use crate::{ShiftStore, StoreError, WorkspaceState, write_mode::WriteMode};

fn populated_store() -> (ShiftStore, font::Font) {
    let mut store = ShiftStore::open_memory_for_test().unwrap();
    let font = font::test_support::sample_font();
    store.replace_font_state(&font).unwrap();
    store
        .set_workspace_state(WorkspaceState::untitled(None))
        .unwrap();
    (store, font)
}

#[test]
fn sqlite_payload_preserves_canonical_bytes() {
    let font = font::test_support::sample_font();
    let layer = font
        .glyph_by_name("A")
        .unwrap()
        .layers()
        .values()
        .next()
        .unwrap();
    let encoded = encode_layer(layer).unwrap();
    let glyph_id = font::GlyphId::from_raw("storage_golden");
    let glyph_name = font::GlyphName::from("storageGolden");
    let mut store = ShiftStore::open_memory_for_test().unwrap();
    store
        .conn
        .execute(
            "INSERT INTO sources (id, name, kind, order_index) VALUES (?1, 'Golden', 'master', 0)",
            [layer.source_id().to_string()],
        )
        .unwrap();
    store
        .conn
        .execute(
            "INSERT INTO glyphs (id, name, order_index) VALUES (?1, ?2, 0)",
            params![glyph_id.to_string(), glyph_name.as_str()],
        )
        .unwrap();

    let tx = store.conn.transaction().unwrap();
    write_layer_in_tx(&tx, &glyph_id, layer).unwrap();
    tx.commit().unwrap();

    let stored = store
        .conn
        .query_row(
            "SELECT compression, payload, stored_byte_length,
                        decoded_byte_length, decoded_blake3
                 FROM glyph_layer_payloads WHERE layer_id = ?1",
            [layer.id().to_string()],
            |row| {
                Ok(StoredLayerPayload {
                    compression: match row.get::<_, String>(0)?.as_str() {
                        "zstd.v1" => LayerPayloadCompression::ZstandardV1,
                        _ => LayerPayloadCompression::None,
                    },
                    bytes: row.get(1)?,
                    stored_byte_length: row.get::<_, i64>(2)? as u64,
                    decoded_byte_length: row.get::<_, i64>(3)? as u64,
                    decoded_blake3: row.get::<_, Vec<u8>>(4)?.try_into().unwrap(),
                })
            },
        )
        .unwrap();
    assert_eq!(stored.compression, LayerPayloadCompression::ZstandardV1);
    assert!(stored.stored_byte_length < stored.decoded_byte_length);
    assert_eq!(
        decompress_layer(layer.id().as_str(), stored).unwrap(),
        encoded
    );
    let decoded = store.load_glyph_layer(&layer.id()).unwrap().unwrap();
    assert_eq!(encode_layer(&decoded).unwrap(), encoded);
}

#[test]
fn bounded_batch_load_matches_complete_font_layers() {
    let (store, font) = populated_store();
    let mut layer_ids = font
        .glyphs()
        .flat_map(|glyph| glyph.layers().keys().cloned())
        .collect::<Vec<_>>();
    layer_ids.push(layer_ids[0].clone());

    let layers = store.load_glyph_layers(&layer_ids).unwrap();

    assert_eq!(layers.len(), layer_ids.len() - 1);
    for layer in layers {
        assert_eq!(font.layer(layer.id()).unwrap(), &layer);
    }
}

#[test]
fn requested_layers_load_across_multiple_count_bounded_batches() {
    let mut font = font::Font::new();
    let source_id = font.default_source_id().unwrap();
    let mut layer_ids = Vec::new();
    for index in 0..=MAX_LAYER_READ_BATCH_COUNT {
        let layer = font::GlyphLayer::with_width(
            font::LayerId::from_raw(format!("layer_{index:04}")),
            source_id.clone(),
            index as f64,
        );
        layer_ids.push(layer.id());
        let mut glyph = font::Glyph::new(format!("glyph_{index:04}"));
        glyph.set_layer(layer);
        font.insert_glyph(glyph).unwrap();
    }
    let mut store = ShiftStore::open_memory_for_test().unwrap();
    store.replace_font_state(&font).unwrap();

    let layers = store.load_glyph_layers(&layer_ids).unwrap();

    assert_eq!(layers.len(), layer_ids.len());
    assert_eq!(layers.first().unwrap().id(), layer_ids[0]);
    assert_eq!(layers.last().unwrap().id(), layer_ids[512]);
}

#[test]
fn one_internal_batch_rejects_excessive_layer_counts_before_sql() {
    let store = ShiftStore::open_memory_for_test().unwrap();
    let layer_ids = (0..=MAX_LAYER_READ_BATCH_COUNT)
        .map(|index| font::LayerId::from_raw(format!("layer_{index}")))
        .collect::<Vec<_>>();

    assert!(matches!(
        load_glyph_layer_batch_from_conn(&store.conn, &layer_ids),
        Err(StoreError::LayerReadBatchTooLarge { .. })
    ));
}

#[test]
fn batch_bounds_declared_decoded_bytes_before_fetching_payloads() {
    let (store, font) = populated_store();
    let layer_ids = font
        .glyphs()
        .flat_map(|glyph| glyph.layers().keys().cloned())
        .take(2)
        .collect::<Vec<_>>();
    let decoded_byte_length = MAX_LAYER_READ_BATCH_DECODED_BYTES / 2 + 1;
    for layer_id in &layer_ids {
        store
            .conn
            .execute(
                "UPDATE glyph_layer_payloads
                     SET decoded_byte_length = ?1
                     WHERE layer_id = ?2",
                params![decoded_byte_length as i64, layer_id.to_string()],
            )
            .unwrap();
    }

    assert!(matches!(
        load_glyph_layer_batch_from_conn(&store.conn, &layer_ids),
        Err(StoreError::LayerReadBatchDecodedTooLarge { .. })
    ));
}

#[test]
fn mixed_compressed_and_uncompressed_layers_load_in_stable_order() {
    let (store, font) = populated_store();
    let mut layer_ids = font
        .glyphs()
        .flat_map(|glyph| glyph.layers().keys().cloned())
        .take(2)
        .collect::<Vec<_>>();
    layer_ids.sort_by(|left, right| left.as_str().cmp(right.as_str()));
    let uncompressed_layer = font.layer(layer_ids[0].clone()).unwrap();
    let encoded = encode_layer(uncompressed_layer).unwrap();
    let decoded_blake3 = blake3::hash(&encoded);
    store
        .conn
        .execute(
            "UPDATE glyph_layer_payloads
                 SET compression = 'none', payload = ?1,
                     stored_byte_length = ?2, decoded_byte_length = ?2,
                     decoded_blake3 = ?3
                 WHERE layer_id = ?4",
            params![
                encoded.as_slice(),
                encoded.len() as i64,
                decoded_blake3.as_bytes().as_slice(),
                layer_ids[0].to_string(),
            ],
        )
        .unwrap();

    let loaded = store.load_glyph_layers(&layer_ids).unwrap();

    assert_eq!(loaded.len(), 2);
    assert_eq!(loaded[0].id(), layer_ids[0]);
    assert_eq!(loaded[1].id(), layer_ids[1]);
    for layer in loaded {
        assert_eq!(font.layer(layer.id()).unwrap(), &layer);
    }
}

#[test]
fn declared_stored_length_mismatch_is_rejected_before_decode() {
    let (store, font) = populated_store();
    let layer_id = font
        .glyphs()
        .next()
        .unwrap()
        .layers()
        .keys()
        .next()
        .unwrap();
    store
        .conn
        .pragma_update(None, "ignore_check_constraints", "ON")
        .unwrap();
    store
        .conn
        .execute(
            "UPDATE glyph_layer_payloads
                 SET stored_byte_length = stored_byte_length + 1
                 WHERE layer_id = ?1",
            [layer_id.to_string()],
        )
        .unwrap();
    store
        .conn
        .pragma_update(None, "ignore_check_constraints", "OFF")
        .unwrap();

    assert!(matches!(
        store.load_glyph_layer(layer_id),
        Err(StoreError::LayerDirectoryMismatch { detail, .. })
            if detail.contains("declared stored byte length")
    ));
    assert!(matches!(
        store.load_glyph_layers(std::slice::from_ref(layer_id)),
        Err(StoreError::LayerDirectoryMismatch { detail, .. })
            if detail.contains("declared stored byte length")
    ));
}

#[test]
fn layer_rewrite_transitions_from_uncompressed_to_zstd_consistently() {
    let (mut store, font) = populated_store();
    let layer = font
        .glyphs()
        .next()
        .unwrap()
        .layers()
        .values()
        .next()
        .unwrap();
    let mut compressible_layer = layer.as_ref().clone();
    compressible_layer.lib_mut().set(
        "com.shift.compression-fixture".to_string(),
        font::LibValue::Data(vec![0; 8 * 1024]),
    );
    let encoded = encode_layer(&compressible_layer).unwrap();
    let uncompressed = StoredLayerPayload {
        compression: LayerPayloadCompression::None,
        bytes: encoded.clone(),
        stored_byte_length: encoded.len() as u64,
        decoded_byte_length: encoded.len() as u64,
        decoded_blake3: *blake3::hash(&encoded).as_bytes(),
    };
    let glyph_id = font.glyph_id_by_layer(layer.id()).unwrap();
    let tx = store.conn.transaction().unwrap();
    store_stored_layer_in_tx(
        &tx,
        &glyph_id,
        &compressible_layer,
        &uncompressed,
        WriteMode::Upsert,
    )
    .unwrap();
    tx.commit().unwrap();
    assert_eq!(
        store
            .conn
            .query_row(
                "SELECT compression FROM glyph_layer_payloads WHERE layer_id = ?1",
                [layer.id().to_string()],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
        "none"
    );

    store.replace_glyph_layer(&compressible_layer).unwrap();

    let (compression, stored, decoded, hash_length, payload_length) = store
        .conn
        .query_row(
            "SELECT compression, stored_byte_length, decoded_byte_length,
                        length(decoded_blake3), length(payload)
                 FROM glyph_layer_payloads WHERE layer_id = ?1",
            [layer.id().to_string()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                ))
            },
        )
        .unwrap();
    assert_eq!(compression, "zstd.v1");
    assert_eq!(stored, payload_length);
    assert!(stored < decoded);
    assert_eq!(hash_length, 32);
    assert_eq!(
        store.load_glyph_layer(&layer.id()).unwrap().unwrap(),
        compressible_layer
    );
}

#[test]
fn false_decoded_length_and_hash_are_rejected() {
    let (store, font) = populated_store();
    let layer_id = font
        .glyphs()
        .next()
        .unwrap()
        .layers()
        .keys()
        .next()
        .unwrap();
    store
        .conn
        .execute(
            "UPDATE glyph_layer_payloads
                 SET decoded_byte_length = decoded_byte_length + 1
                 WHERE layer_id = ?1",
            [layer_id.to_string()],
        )
        .unwrap();
    assert!(matches!(
        store.load_glyph_layer(layer_id),
        Err(StoreError::LayerDirectoryMismatch { detail, .. })
            if detail.contains("decoded byte length")
    ));

    let encoded = encode_layer(font.layer(layer_id.clone()).unwrap()).unwrap();
    store
        .conn
        .execute(
            "UPDATE glyph_layer_payloads
                 SET decoded_byte_length = ?1, decoded_blake3 = zeroblob(32)
                 WHERE layer_id = ?2",
            params![encoded.len() as i64, layer_id.to_string()],
        )
        .unwrap();
    assert!(matches!(
        store.load_glyph_layer(layer_id),
        Err(StoreError::LayerDirectoryMismatch { detail, .. })
            if detail.contains("decoded BLAKE3 mismatch")
    ));
}

#[test]
fn directory_open_never_reads_malformed_payloads() {
    let (store, font) = populated_store();
    let layer_id = font
        .glyphs()
        .next()
        .unwrap()
        .layers()
        .keys()
        .next()
        .unwrap();
    store
        .conn
        .execute(
            "UPDATE glyph_layer_payloads
                 SET payload = X'00', stored_byte_length = 1
                 WHERE layer_id = ?1",
            [layer_id.to_string()],
        )
        .unwrap();

    let directory = store.load_font_directory().unwrap();
    assert_eq!(directory.glyph_count(), font.glyph_count());
    assert!(directory.layer(layer_id.clone()).unwrap().is_empty());
    assert!(store.load_glyph_layer(layer_id).is_err());
    assert!(
        store
            .load_glyph_layers(std::slice::from_ref(layer_id))
            .is_err()
    );
}

#[test]
fn directory_retains_layer_when_payload_row_is_missing() {
    let (store, font) = populated_store();
    let layer_id = font
        .glyphs()
        .next()
        .unwrap()
        .layers()
        .keys()
        .next()
        .unwrap();
    store
        .conn
        .execute(
            "DELETE FROM glyph_layer_payloads WHERE layer_id = ?1",
            [layer_id.to_string()],
        )
        .unwrap();

    let directory = store.load_font_directory().unwrap();

    assert!(directory.layer(layer_id.clone()).is_some());
    assert!(store.load_font_state().is_err());
}

#[test]
fn stale_reference_index_is_rejected() {
    let (store, font) = populated_store();
    let layer = font
        .glyphs()
        .flat_map(|glyph| glyph.layers().values())
        .find(|layer| !layer.components().is_empty())
        .unwrap();
    store
        .conn
        .execute(
            "DELETE FROM glyph_components WHERE layer_id = ?1",
            [layer.id().to_string()],
        )
        .unwrap();

    assert!(matches!(
        store.load_glyph_layer(&layer.id()),
        Err(StoreError::StaleLayerReferenceIndex { .. })
    ));
    assert!(matches!(
        store.load_glyph_layers(&[layer.id()]),
        Err(StoreError::StaleLayerReferenceIndex { .. })
    ));
}

#[test]
fn index_constraint_failure_rolls_back_payload_directory_and_revision() {
    let (mut store, font) = populated_store();
    let indexed_layer = font
        .glyphs()
        .flat_map(|glyph| glyph.layers().values())
        .find(|layer| !layer.components().is_empty())
        .unwrap();
    let duplicate = indexed_layer.components_iter().next().unwrap();
    let mut target = font
        .glyphs()
        .flat_map(|glyph| glyph.layers().values())
        .find(|layer| layer.id() != indexed_layer.id() && layer.components().is_empty())
        .unwrap()
        .as_ref()
        .clone();
    target.add_component(font::Component::with_id(
        duplicate.id(),
        duplicate.base_glyph_id(),
        duplicate.base_glyph_name().clone(),
        *duplicate.transform(),
    ));

    let before_payload: Vec<u8> = store
        .conn
        .query_row(
            "SELECT payload FROM glyph_layer_payloads WHERE layer_id = ?1",
            [target.id().to_string()],
            |row| row.get(0),
        )
        .unwrap();
    let before_revision = store.workspace_state().unwrap().unwrap().revision;

    assert!(store.replace_glyph_layer(&target).is_err());

    let after_payload: Vec<u8> = store
        .conn
        .query_row(
            "SELECT payload FROM glyph_layer_payloads WHERE layer_id = ?1",
            [target.id().to_string()],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(after_payload, before_payload);
    assert_eq!(
        store.workspace_state().unwrap().unwrap().revision,
        before_revision
    );
}

#[test]
fn replacement_updates_payload_directory_references_and_revision_atomically() {
    let (mut store, font) = populated_store();
    let mut layer = font
        .glyphs()
        .flat_map(|glyph| glyph.layers().values())
        .find(|layer| !layer.components().is_empty())
        .unwrap()
        .as_ref()
        .clone();
    let owner = font.glyph_id_by_layer(layer.id()).unwrap();
    layer.set_width(layer.width() + 23.0);
    layer.clear_components();

    store.replace_glyph_layer(&layer).unwrap();

    assert_eq!(
        store.load_glyph_layer(&layer.id()).unwrap(),
        Some(layer.clone())
    );
    let directory = store
        .list_glyph_layer_directory()
        .unwrap()
        .into_iter()
        .find(|entry| entry.layer_id == layer.id())
        .unwrap();
    assert_eq!(directory.width.to_bits(), layer.width().to_bits());
    assert!(
        store
            .referenced_glyph_ids_for_glyph(&owner)
            .unwrap()
            .is_empty()
    );
    assert_eq!(store.workspace_state().unwrap().unwrap().revision, 1);
}

#[test]
fn post_font_change_set_rewrites_touched_layer_without_decoding_old_payload() {
    let (mut store, mut post_font) = populated_store();
    let mut layer = post_font
        .glyphs()
        .flat_map(|glyph| glyph.layers().values())
        .next()
        .unwrap()
        .as_ref()
        .clone();
    layer.set_width(layer.width() + 41.0);
    post_font.replace_glyph_layers(vec![layer.clone()]).unwrap();
    store
        .conn
        .execute(
            "UPDATE glyph_layer_payloads
                 SET payload = X'00', stored_byte_length = 1
                 WHERE layer_id = ?1",
            [layer.id().to_string()],
        )
        .unwrap();
    let changes = font::FontChangeSet::new(vec![font::FontChange::layer_metrics_changed(&layer)]);

    store
        .apply_change_set_with_font(&changes, &post_font)
        .unwrap();

    assert_eq!(store.load_glyph_layer(&layer.id()).unwrap(), Some(layer));
}

#[test]
fn abandoned_transaction_preserves_last_committed_layer() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("working.sqlite");
    let font = font::test_support::sample_font();
    let layer = font
        .glyphs()
        .flat_map(|glyph| glyph.layers().values())
        .next()
        .unwrap()
        .as_ref()
        .clone();
    let mut store = ShiftStore::open(&path).unwrap();
    store.replace_font_state(&font).unwrap();
    let mut uncommitted = layer.clone();
    uncommitted.set_width(layer.width() + 999.0);
    {
        let tx = store.conn.transaction().unwrap();
        rewrite_layer_in_tx(&tx, &uncommitted).unwrap();
        // Dropping an open transaction models recovery from a process
        // that exits before COMMIT reaches the WAL.
    }
    drop(store);

    let reopened = ShiftStore::open(&path).unwrap();
    assert_eq!(reopened.load_glyph_layer(&layer.id()).unwrap(), Some(layer));
}

#[test]
fn abandoned_font_stream_rolls_back_header_and_glyphs() {
    let (mut store, font) = populated_store();
    let before = store.list_glyph_layer_directory().unwrap();
    {
        let mut writer = store.begin_import(&font).unwrap();
        let glyph = font.glyphs().next().unwrap();
        writer
            .write_glyph_batch(std::slice::from_ref(glyph))
            .unwrap();
    }

    assert_eq!(store.list_glyph_layer_directory().unwrap(), before);
}

#[test]
fn cjk_scale_directory_open_is_payload_independent() {
    const GLYPH_COUNT: usize = 65_536;
    let mut store = ShiftStore::open_memory_for_test().unwrap();
    let source_id = font::SourceId::from_raw("cjk").to_string();
    store
        .conn
        .execute(
            "INSERT INTO sources (id, name, kind, order_index) VALUES (?1, 'CJK', 'master', 0)",
            [&source_id],
        )
        .unwrap();
    let tx = store.conn.transaction().unwrap();
    {
        let mut glyph_stmt = tx
            .prepare("INSERT INTO glyphs (id, name, order_index) VALUES (?1, ?2, ?3)")
            .unwrap();
        let mut layer_stmt = tx
                .prepare("INSERT INTO glyph_layers (id, glyph_id, source_id, width, height) VALUES (?1, ?2, ?3, 1000, NULL)")
                .unwrap();
        let mut payload_stmt = tx
            .prepare(
                "INSERT INTO glyph_layer_payloads (
                        layer_id, inner_format, compression, payload,
                        stored_byte_length, decoded_byte_length, decoded_blake3
                     ) VALUES (?1, ?2, 'none', X'00', 1, 1, zeroblob(32))",
            )
            .unwrap();
        for index in 0..GLYPH_COUNT {
            let glyph_id = font::GlyphId::from_raw(format!("cjk{index}")).to_string();
            let layer_id = font::LayerId::from_raw(format!("cjk{index}")).to_string();
            let name = format!("uni{index:05X}");
            glyph_stmt
                .execute(params![glyph_id, name, index as i64])
                .unwrap();
            layer_stmt
                .execute(params![layer_id, glyph_id, source_id])
                .unwrap();
            payload_stmt
                .execute(params![layer_id, GLYPH_LAYER_FORMAT])
                .unwrap();
        }
    }
    tx.commit().unwrap();

    let started = Instant::now();
    let directory = store.load_font_directory().unwrap();
    let elapsed = started.elapsed();

    assert_eq!(directory.glyph_count(), GLYPH_COUNT);
    assert_eq!(
        directory
            .glyphs()
            .map(|glyph| glyph.layers().len())
            .sum::<usize>(),
        GLYPH_COUNT
    );
    assert!(
        elapsed < Duration::from_secs(15),
        "directory open took {elapsed:?}"
    );
}
