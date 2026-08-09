use std::collections::HashSet;

use rusqlite::{Transaction, params};
use shift_font as font;

use super::{
    RecoveryOverlay, RecoveryState,
    catalog::{
        AXES, AXIS_MAPPINGS, GLYPH_COMPONENTS, GLYPH_LAYERS, GLYPH_LIB, GLYPH_UNICODES, GLYPHS,
        METRIC_DEFINITIONS, NAMED_INSTANCES, RecoveryTable, SOURCE_LIB, SOURCE_LOCATIONS,
        SOURCE_METRIC_VALUES, SOURCES,
    },
};
use crate::{
    FontInfo, StoreError,
    change_set::{
        replace_axis_mappings, replace_metric_definitions, replace_named_instances,
        upsert_axis_with_order, upsert_font_info, write_glyph_directory_in_tx,
        write_source_snapshot_in_tx,
    },
    layer::write_layer_in_tx,
    write_mode::WriteMode,
};

const GLOBAL_OWNER: &str = "";

impl RecoveryOverlay {
    pub(crate) fn apply_change_set(
        &mut self,
        change_set: &font::FontChangeSet,
        post_font: &font::Font,
        preserved_font_info: Option<&FontInfo>,
    ) -> Result<(), StoreError> {
        if change_set.is_empty() {
            return Ok(());
        }

        let state = self.state()?;
        if !matches!(state, RecoveryState::Clean | RecoveryState::Dirty) {
            return Err(StoreError::InvalidRecoveryTransition {
                expected: "clean or dirty",
                found: state.as_str(),
            });
        }

        let mut metadata_changed = false;
        let mut mappings_changed = false;
        let mut definitions_changed = false;
        let mut instances_changed = false;
        let mut axis_ids = HashSet::new();
        let mut source_ids = HashSet::new();
        let mut glyph_ids = HashSet::new();
        let mut layer_ids = HashSet::new();

        for change in &change_set.changes {
            match change {
                font::FontChange::FontMetadataUpdated(_) => metadata_changed = true,
                font::FontChange::AxisCreated(change) => {
                    axis_ids.insert(change.axis.id());
                }
                font::FontChange::AxisUpdated(change) => {
                    axis_ids.insert(change.axis.id());
                }
                font::FontChange::AxisDeleted(change) => {
                    axis_ids.insert(change.axis_id.clone());
                }
                font::FontChange::AxisMappingsUpdated(_) => mappings_changed = true,
                font::FontChange::MetricDefinitionsUpdated(_) => definitions_changed = true,
                font::FontChange::NamedInstancesUpdated(_) => instances_changed = true,
                font::FontChange::SourceCreated(change) => {
                    source_ids.insert(change.source_id.clone());
                }
                font::FontChange::SourceUpdated(change) => {
                    source_ids.insert(change.source.id());
                }
                font::FontChange::SourceDeleted(change) => {
                    source_ids.insert(change.source_id.clone());
                }
                font::FontChange::GlyphCreated(change) => {
                    glyph_ids.insert(change.glyph_id.clone());
                }
                font::FontChange::GlyphDeleted(change) => {
                    glyph_ids.insert(change.glyph_id.clone());
                }
                font::FontChange::GlyphIdentityChanged(change) => {
                    glyph_ids.insert(change.glyph_id.clone());
                }
                _ => {
                    if let Some(layer_id) = change.layer_id() {
                        layer_ids.insert(layer_id.clone());
                    }
                }
            }
        }

        let tx = self.conn.transaction()?;
        if metadata_changed {
            upsert_font_info(&tx, post_font)?;
            if let Some(preserved) = preserved_font_info {
                tx.execute(
                    "UPDATE font_info SET sample_text = ?1, vendor_id = ?2 WHERE id = 1",
                    params![
                        preserved.sample_text.as_deref(),
                        preserved.vendor_id.as_deref()
                    ],
                )?;
            }
        }
        if mappings_changed {
            replace_axis_mappings(&tx, post_font.axis_mappings())?;
            mark_replaced(&tx, AXIS_MAPPINGS, GLOBAL_OWNER)?;
        }
        if definitions_changed {
            replace_metric_definitions(&tx, post_font.metric_definitions())?;
            mark_replaced(&tx, METRIC_DEFINITIONS, GLOBAL_OWNER)?;
        }
        if instances_changed {
            replace_named_instances(&tx, post_font.named_instances())?;
            mark_replaced(&tx, NAMED_INSTANCES, GLOBAL_OWNER)?;
        }

        for axis_id in axis_ids {
            if let Some((order_index, axis)) = post_font
                .axes()
                .iter()
                .enumerate()
                .find(|(_, axis)| axis.id() == axis_id)
            {
                clear_tombstone(&tx, AXES, axis_id.as_str())?;
                upsert_axis_with_order(&tx, axis, order_index as i64)?;
            } else {
                delete_axis_override(&tx, &axis_id)?;
                mark_tombstone(&tx, AXES, axis_id.as_str())?;
            }
        }

        for source_id in source_ids {
            if let Some((order_index, source)) = post_font
                .sources()
                .iter()
                .enumerate()
                .find(|(_, source)| source.id() == source_id)
            {
                clear_tombstone(&tx, SOURCES, source_id.as_str())?;
                write_source_snapshot_in_tx(&tx, source, order_index as i64)?;
                mark_replaced(&tx, SOURCE_LOCATIONS, source_id.as_str())?;
                mark_replaced(&tx, SOURCE_METRIC_VALUES, source_id.as_str())?;
                mark_replaced(&tx, SOURCE_LIB, source_id.as_str())?;
            } else {
                delete_source_override(&tx, &source_id)?;
                mark_tombstone(&tx, SOURCES, source_id.as_str())?;
            }
        }

        for glyph_id in glyph_ids {
            if let Some((order_index, glyph)) = post_font
                .glyphs()
                .enumerate()
                .find(|(_, glyph)| glyph.id() == glyph_id)
            {
                clear_tombstone(&tx, GLYPHS, glyph_id.as_str())?;
                write_glyph_directory_in_tx(&tx, glyph, order_index as i64, WriteMode::Upsert)?;
                mark_replaced(&tx, GLYPH_UNICODES, glyph_id.as_str())?;
                mark_replaced(&tx, GLYPH_LIB, glyph_id.as_str())?;
            } else {
                delete_glyph_override(&tx, &glyph_id)?;
                mark_tombstone(&tx, GLYPHS, glyph_id.as_str())?;
            }
        }

        for layer_id in layer_ids {
            if let Some((glyph_id, layer)) = find_layer(post_font, &layer_id) {
                clear_tombstone(&tx, GLYPH_LAYERS, layer_id.as_str())?;
                write_layer_in_tx(&tx, &glyph_id, layer)?;
                mark_replaced(&tx, GLYPH_COMPONENTS, layer_id.as_str())?;
            } else {
                delete_layer_override(&tx, &layer_id)?;
                mark_tombstone(&tx, GLYPH_LAYERS, layer_id.as_str())?;
            }
        }

        tx.execute(
            "UPDATE recovery_metadata SET state = 'dirty', pending_commit_id = NULL WHERE id = 1",
            [],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub(crate) fn replace_layer(
        &mut self,
        glyph_id: &font::GlyphId,
        layer: &font::GlyphLayer,
    ) -> Result<(), StoreError> {
        let state = self.state()?;
        if !matches!(state, RecoveryState::Clean | RecoveryState::Dirty) {
            return Err(StoreError::InvalidRecoveryTransition {
                expected: "clean or dirty",
                found: state.as_str(),
            });
        }

        let tx = self.conn.transaction()?;
        clear_tombstone(&tx, GLYPH_LAYERS, layer.id().as_str())?;
        write_layer_in_tx(&tx, glyph_id, layer)?;
        mark_replaced(&tx, GLYPH_COMPONENTS, layer.id().as_str())?;
        tx.execute(
            "UPDATE recovery_metadata SET state = 'dirty', pending_commit_id = NULL WHERE id = 1",
            [],
        )?;
        tx.commit()?;
        Ok(())
    }
}

fn mark_replaced(
    tx: &Transaction<'_>,
    table: RecoveryTable,
    owner_id: &str,
) -> Result<(), StoreError> {
    tx.execute(
        "INSERT OR IGNORE INTO recovery_replacements (collection, owner_id) VALUES (?1, ?2)",
        params![table.name(), owner_id],
    )?;
    Ok(())
}

fn mark_tombstone(
    tx: &Transaction<'_>,
    table: RecoveryTable,
    entity_id: &str,
) -> Result<(), StoreError> {
    tx.execute(
        "INSERT OR IGNORE INTO recovery_tombstones (entity_kind, entity_id) VALUES (?1, ?2)",
        params![
            table.tombstone_kind().expect("table supports tombstones"),
            entity_id
        ],
    )?;
    Ok(())
}

fn clear_tombstone(
    tx: &Transaction<'_>,
    table: RecoveryTable,
    entity_id: &str,
) -> Result<(), StoreError> {
    tx.execute(
        "DELETE FROM recovery_tombstones WHERE entity_kind = ?1 AND entity_id = ?2",
        params![
            table.tombstone_kind().expect("table supports tombstones"),
            entity_id
        ],
    )?;
    Ok(())
}

fn delete_axis_override(tx: &Transaction<'_>, axis_id: &font::AxisId) -> Result<(), StoreError> {
    tx.execute("DELETE FROM axes WHERE id = ?1", [axis_id.to_string()])?;
    Ok(())
}

fn delete_source_override(
    tx: &Transaction<'_>,
    source_id: &font::SourceId,
) -> Result<(), StoreError> {
    let id = source_id.to_string();
    tx.execute("DELETE FROM source_locations WHERE source_id = ?1", [&id])?;
    tx.execute(
        "DELETE FROM source_metric_values WHERE source_id = ?1",
        [&id],
    )?;
    tx.execute("DELETE FROM source_lib WHERE source_id = ?1", [&id])?;
    tx.execute("DELETE FROM sources WHERE id = ?1", [&id])?;
    Ok(())
}

fn delete_glyph_override(tx: &Transaction<'_>, glyph_id: &font::GlyphId) -> Result<(), StoreError> {
    let id = glyph_id.to_string();
    tx.execute("DELETE FROM glyph_unicodes WHERE glyph_id = ?1", [&id])?;
    tx.execute("DELETE FROM glyph_lib WHERE glyph_id = ?1", [&id])?;
    tx.execute("DELETE FROM glyphs WHERE id = ?1", [&id])?;
    Ok(())
}

fn delete_layer_override(tx: &Transaction<'_>, layer_id: &font::LayerId) -> Result<(), StoreError> {
    let id = layer_id.to_string();
    tx.execute("DELETE FROM glyph_components WHERE layer_id = ?1", [&id])?;
    tx.execute(
        "DELETE FROM glyph_layer_payloads WHERE layer_id = ?1",
        [&id],
    )?;
    tx.execute("DELETE FROM glyph_layers WHERE id = ?1", [&id])?;
    Ok(())
}

fn find_layer<'a>(
    font: &'a font::Font,
    layer_id: &font::LayerId,
) -> Option<(font::GlyphId, &'a font::GlyphLayer)> {
    font.glyphs().find_map(|glyph| {
        glyph
            .layers()
            .get(layer_id)
            .map(|layer| (glyph.id(), layer.as_ref()))
    })
}
