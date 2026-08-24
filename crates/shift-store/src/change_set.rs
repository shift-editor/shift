use std::collections::HashSet;

use rusqlite::{OptionalExtension, Transaction, params};
use shift_font as font;

use crate::{
    ShiftStore, StoreError,
    layer::{create_empty_layer_in_tx, rewrite_layer_in_tx, write_layer_in_tx},
    source::SourceKind,
    workspace_state::mark_workspace_changed_in_tx,
    write_mode::WriteMode,
};

impl ShiftStore {
    pub fn apply_change_set(&mut self, change_set: &font::FontChangeSet) -> Result<(), StoreError> {
        self.apply_change_set_inner(change_set, None, true)
    }

    /// Applies relational changes and takes touched layer payloads from the
    /// committed post-edit font. This preserves complete clone/materialize
    /// results even when a compact change record only carries directory facts.
    pub fn apply_change_set_with_font(
        &mut self,
        change_set: &font::FontChangeSet,
        post_font: &font::Font,
        dirty: bool,
    ) -> Result<(), StoreError> {
        self.apply_change_set_inner(change_set, Some(post_font), dirty)
    }

    fn apply_change_set_inner(
        &mut self,
        change_set: &font::FontChangeSet,
        post_font: Option<&font::Font>,
        dirty: bool,
    ) -> Result<(), StoreError> {
        if self.recovery.is_some() && !dirty {
            self.discard_recovery()?;
            return Ok(());
        }

        let preserved_font_info = (self.recovery.is_some()
            && change_set.changes.iter().any(|change| {
                matches!(
                    change,
                    font::FontChange::FontMetadataUpdated(_)
                        | font::FontChange::SourceCreated(_)
                        | font::FontChange::SourceUpdated(_)
                        | font::FontChange::SourceDeleted(_)
                )
            }))
        .then(|| self.get_font_info())
        .transpose()?
        .flatten();

        if let Some(post_font) = post_font {
            let appended = change_set
                .changes
                .iter()
                .filter_map(|change| match change {
                    font::FontChange::GlyphAppended(change) => Some(&change.glyph_id),
                    _ => None,
                })
                .collect::<Vec<_>>();
            let popped = change_set
                .changes
                .iter()
                .filter_map(|change| match change {
                    font::FontChange::GlyphPopped(change) => Some(&change.glyph_id),
                    _ => None,
                })
                .collect::<Vec<_>>();
            if !appended.is_empty() && !popped.is_empty() {
                return Err(font::CoreError::InvalidEntityOrder {
                    kind: "glyph",
                    message: "one committed change set cannot both append and pop glyphs".into(),
                }
                .into());
            }
            let first_appended_order = post_font.glyph_count().saturating_sub(appended.len());
            for (offset, glyph_id) in appended.iter().enumerate() {
                if post_font.glyph_order((*glyph_id).clone()) != Some(first_appended_order + offset)
                {
                    return Err(font::CoreError::InvalidEntityOrder {
                        kind: "glyph",
                        message: format!("appended identity {glyph_id} is not in the tail segment"),
                    }
                    .into());
                }
            }
            for (offset, glyph_id) in popped.iter().enumerate() {
                let order_index = self
                    .conn
                    .query_row(
                        "SELECT order_index FROM glyphs WHERE id = ?1",
                        [glyph_id.to_string()],
                        |row| row.get::<_, i64>(0),
                    )
                    .optional()?
                    .ok_or_else(|| StoreError::MissingEntity {
                        kind: "glyph",
                        id: glyph_id.to_string(),
                    })?;
                let expected = post_font.glyph_count() + popped.len() - offset - 1;
                if order_index != expected as i64 {
                    return Err(font::CoreError::InvalidEntityOrder {
                        kind: "glyph",
                        message: format!("popped identity {glyph_id} is not the directory tail"),
                    }
                    .into());
                }
            }
        }

        if let Some(recovery) = self.recovery.as_mut() {
            let post_font = post_font.ok_or(StoreError::RecoveryRequiresPostFont)?;
            return recovery.apply_change_set(change_set, post_font, preserved_font_info.as_ref());
        }
        if self.kind == crate::store::StoreKind::Document {
            return Err(StoreError::DocumentRequiresRecoveryOverlay);
        }

        let axis_topology_changed = change_set.changes.iter().any(|change| {
            matches!(
                change,
                font::FontChange::AxisCreated(_) | font::FontChange::AxisDeleted(_)
            )
        });
        let source_topology_changed = change_set.changes.iter().any(|change| {
            matches!(
                change,
                font::FontChange::SourceCreated(_) | font::FontChange::SourceDeleted(_)
            )
        });
        let tracks_workspace = self.tracks_workspace();
        let tx = self.conn.transaction()?;
        let mut touched_layer_ids = HashSet::new();

        for change in &change_set.changes {
            if post_font.is_none() || !post_font_supersedes_incremental_layer_write(change) {
                apply_change(&tx, change)?;
            }
            if let Some(layer_id) = change.layer_id() {
                touched_layer_ids.insert(layer_id.clone());
            }
        }
        if let Some(post_font) = post_font {
            for layer_id in touched_layer_ids {
                if let Some(layer) = post_font.layer(layer_id) {
                    rewrite_layer_in_tx(&tx, layer)?;
                }
            }
            if change_set.changes.iter().any(|change| {
                matches!(
                    change,
                    font::FontChange::SourceCreated(_)
                        | font::FontChange::SourceUpdated(_)
                        | font::FontChange::SourceDeleted(_)
                )
            }) {
                set_default_source_id(&tx, post_font.default_source_id().as_ref())?;
            }
            if axis_topology_changed {
                for (order_index, axis) in post_font.axes().iter().enumerate() {
                    let rows_changed = tx.execute(
                        "UPDATE axes SET order_index = ?1 WHERE id = ?2",
                        params![order_index as i64, axis.id().to_string()],
                    )?;
                    require_changed(rows_changed, "axis", axis.id().to_string())?;
                }
            }
            if source_topology_changed {
                for (order_index, source) in post_font.sources().iter().enumerate() {
                    let rows_changed = tx.execute(
                        "UPDATE sources SET order_index = ?1 WHERE id = ?2",
                        params![order_index as i64, source.id().to_string()],
                    )?;
                    require_changed(rows_changed, "source", source.id().to_string())?;
                }
            }
        }
        if tracks_workspace {
            mark_workspace_changed_in_tx(&tx, dirty)?;
        }

        tx.commit()?;
        Ok(())
    }

    pub fn replace_font_state(&mut self, font: &font::Font) -> Result<(), StoreError> {
        let tx = self.conn.transaction()?;
        replace_font_header_in_tx(&tx, font)?;

        for (order_index, glyph) in font.glyphs().enumerate() {
            write_glyph_in_tx(&tx, glyph, order_index as i64)?;
        }

        tx.commit()?;
        Ok(())
    }
}

pub(crate) fn replace_font_header_in_tx(
    tx: &Transaction<'_>,
    font: &font::Font,
) -> Result<(), StoreError> {
    tx.execute("DELETE FROM glyph_lib", [])?;
    tx.execute("DELETE FROM font_lib", [])?;
    tx.execute("DELETE FROM fontinfo_remainder", [])?;
    tx.execute("DELETE FROM font_binaries", [])?;
    tx.execute("DELETE FROM kerning_pairs", [])?;
    tx.execute("DELETE FROM kerning_group_members", [])?;
    tx.execute("DELETE FROM kerning_groups", [])?;
    tx.execute("DELETE FROM feature_text", [])?;
    tx.execute("DELETE FROM font_guidelines", [])?;
    tx.execute("DELETE FROM glyph_components", [])?;
    tx.execute("DELETE FROM glyph_layer_payloads", [])?;
    tx.execute("DELETE FROM glyph_layers", [])?;
    tx.execute("DELETE FROM glyph_unicodes", [])?;
    tx.execute("DELETE FROM glyphs", [])?;
    tx.execute("DELETE FROM source_locations", [])?;
    tx.execute("DELETE FROM source_metric_values", [])?;
    tx.execute("DELETE FROM source_lib", [])?;
    tx.execute("DELETE FROM sources", [])?;
    tx.execute("DELETE FROM metric_definitions", [])?;
    tx.execute("DELETE FROM axis_mappings", [])?;
    tx.execute("DELETE FROM named_instances", [])?;
    tx.execute("DELETE FROM axes", [])?;

    upsert_font_info(tx, font)?;
    replace_feature_text(tx, font.features().fea_source())?;
    replace_font_guidelines(tx, font.guidelines())?;
    replace_lib_data(tx, "font_lib", "key", None, font.lib())?;
    replace_lib_data(
        tx,
        "fontinfo_remainder",
        "key",
        None,
        font.fontinfo_remainder(),
    )?;
    replace_font_binaries(tx, "data", font.data_files())?;
    replace_font_binaries(tx, "image", font.images())?;
    replace_kerning(tx, font.kerning())?;

    for (order_index, axis) in font.axes().iter().enumerate() {
        insert_axis(tx, axis, order_index as i64, false)?;
    }
    replace_axis_mappings(tx, font.axis_mappings())?;
    replace_named_instances(tx, font.named_instances())?;
    replace_metric_definitions(tx, font.metric_definitions())?;

    for (order_index, source) in font.sources().iter().enumerate() {
        upsert_source(
            tx,
            &source.id(),
            SourceRow {
                name: Some(source.name()),
                filename: source.filename(),
                color: source.color(),
                kind: SourceKind::from(source.role()),
                layer_name: source.layer_name(),
                italic_angle: source.italic_angle(),
                line_gap: source.line_gap(),
                underline_position: source.underline_position(),
                underline_thickness: source.underline_thickness(),
                order_index: order_index as i64,
            },
        )?;
        replace_source_metric_values(tx, source.id(), source.metric_values().iter())?;
        replace_lib_data(
            tx,
            "source_lib",
            "source_id",
            Some(&source.id().to_string()),
            source.lib(),
        )?;

        for (axis_id, value) in source.location().iter() {
            // Location entries on undefined axes have no row to reference.
            if font.axes().iter().any(|axis| axis.id() == *axis_id) {
                upsert_source_location(tx, &source.id(), axis_id, *value)?;
            }
        }
    }

    Ok(())
}

pub(crate) fn write_glyph_in_tx(
    tx: &Transaction<'_>,
    glyph: &font::Glyph,
    order_index: i64,
) -> Result<(), StoreError> {
    write_glyph_directory_in_tx(tx, glyph, order_index, WriteMode::Upsert)?;

    for layer in glyph.layers().values().map(|layer| layer.as_ref()) {
        write_layer_in_tx(tx, &glyph.id(), layer)?;
    }
    Ok(())
}

pub(crate) fn write_glyph_directory_in_tx(
    tx: &Transaction<'_>,
    glyph: &font::Glyph,
    order_index: i64,
    mode: WriteMode,
) -> Result<(), StoreError> {
    match mode {
        WriteMode::Insert => {
            tx.prepare_cached("INSERT INTO glyphs (id, name, order_index) VALUES (?1, ?2, ?3)")?
                .execute(params![
                    glyph.id().to_string(),
                    glyph.glyph_name().as_str(),
                    order_index
                ])?;
            for (unicode_order, unicode) in glyph.unicodes().iter().enumerate() {
                tx.prepare_cached(
                    "INSERT INTO glyph_unicodes (glyph_id, unicode, order_index) VALUES (?1, ?2, ?3)",
                )?
                .execute(params![
                    glyph.id().to_string(),
                    i64::from(*unicode),
                    unicode_order as i64
                ])?;
            }
            for (key, value) in glyph.lib().iter() {
                tx.prepare_cached(
                    "INSERT INTO glyph_lib (glyph_id, key, value_json) VALUES (?1, ?2, ?3)",
                )?
                .execute(params![
                    glyph.id().to_string(),
                    key,
                    lib_value_json(value)?
                ])?;
            }
            Ok(())
        }
        WriteMode::Upsert => {
            upsert_glyph(tx, &glyph.id(), glyph.glyph_name(), order_index)?;
            replace_glyph_unicodes(tx, &glyph.id(), glyph.unicodes())?;
            replace_lib_data(
                tx,
                "glyph_lib",
                "glyph_id",
                Some(&glyph.id().to_string()),
                glyph.lib(),
            )
        }
    }
}

fn apply_change(tx: &Transaction<'_>, change: &font::FontChange) -> Result<(), StoreError> {
    match change {
        font::FontChange::FontMetadataUpdated(change) => update_font_metadata(tx, &change.metadata),
        font::FontChange::AxisCreated(change) => {
            let order_index = tx.query_row("SELECT COUNT(*) FROM axes", [], |row| row.get(0))?;
            insert_axis(tx, &change.axis, order_index, false)
        }
        font::FontChange::AxisUpdated(change) => {
            let axis_id = change.axis.id();
            let order_index = tx
                .query_row(
                    "SELECT order_index FROM axes WHERE id = ?1",
                    [axis_id.to_string()],
                    |row| row.get(0),
                )
                .optional()?
                .ok_or_else(|| StoreError::MissingEntity {
                    kind: "axis",
                    id: axis_id.to_string(),
                })?;
            upsert_axis_with_order(tx, &change.axis, order_index)
        }
        font::FontChange::AxisDeleted(change) => {
            // source_locations cascade from the axis row.
            delete_ordered_row(tx, "axes", "axis", change.axis_id.to_string())
        }
        font::FontChange::AxisMappingsUpdated(change) => {
            replace_axis_mappings(tx, &change.mappings)
        }
        font::FontChange::MetricDefinitionsUpdated(change) => {
            replace_metric_definitions(tx, &change.definitions)
        }
        font::FontChange::NamedInstancesUpdated(change) => {
            replace_named_instances(tx, &change.instances)
        }
        font::FontChange::SourceCreated(change) => {
            let source = &change.source;
            let source_id = source.id();
            let order_index = tx
                .query_row(
                    "SELECT order_index FROM sources WHERE id = ?1",
                    [source_id.to_string()],
                    |row| row.get(0),
                )
                .optional()?
                .unwrap_or(tx.query_row("SELECT COUNT(*) FROM sources", [], |row| row.get(0))?);
            upsert_source(
                tx,
                &source_id,
                SourceRow {
                    name: Some(source.name()),
                    filename: source.filename(),
                    color: source.color(),
                    kind: SourceKind::from(source.role()),
                    layer_name: source.layer_name(),
                    italic_angle: source.italic_angle(),
                    line_gap: source.line_gap(),
                    underline_position: source.underline_position(),
                    underline_thickness: source.underline_thickness(),
                    order_index,
                },
            )?;
            tx.execute(
                "DELETE FROM source_locations WHERE source_id = ?1",
                [source_id.to_string()],
            )?;
            for (axis_id, value) in source.location().iter() {
                if axis_exists(tx, axis_id)? {
                    upsert_source_location(tx, &source_id, axis_id, *value)?;
                }
            }
            replace_source_metric_values(tx, source_id.clone(), source.metric_values().iter())?;
            replace_lib_data(
                tx,
                "source_lib",
                "source_id",
                Some(&source_id.to_string()),
                source.lib(),
            )?;

            let default_source_id: Option<Option<String>> = tx
                .query_row(
                    "SELECT default_source_id FROM font_info WHERE id = 1",
                    [],
                    |row| row.get(0),
                )
                .optional()?;
            if default_source_id == Some(None) {
                set_default_source_id(tx, Some(&source_id))?;
            }
            Ok(())
        }
        font::FontChange::SourceUpdated(change) => {
            let source = &change.source;
            let order_index = tx
                .query_row(
                    "SELECT order_index FROM sources WHERE id = ?1",
                    [source.id().to_string()],
                    |row| row.get(0),
                )
                .optional()?
                .ok_or_else(|| StoreError::MissingEntity {
                    kind: "source",
                    id: source.id().to_string(),
                })?;
            write_source_snapshot_in_tx(tx, source, order_index)
        }
        font::FontChange::SourceDeleted(change) => {
            let default_source_id: Option<Option<String>> = tx
                .query_row(
                    "SELECT default_source_id FROM font_info WHERE id = 1",
                    [],
                    |row| row.get(0),
                )
                .optional()?;
            // glyph_layers and source_locations cascade on the source row.
            delete_ordered_row(tx, "sources", "source", change.source_id.to_string())?;
            if default_source_id.as_ref().and_then(|id| id.as_deref())
                == Some(change.source_id.as_str())
            {
                // The authoring model rejects default-source deletion. A
                // low-level replay that removes one must supply its exact
                // post-font default after this incremental write; the store
                // never invents a replacement identity.
                set_default_source_id(tx, None)?;
            }
            Ok(())
        }
        font::FontChange::GlyphAppended(change) => {
            let order_index: i64 =
                tx.query_row("SELECT COUNT(*) FROM glyphs", [], |row| row.get(0))?;
            tx.prepare_cached("INSERT INTO glyphs (id, name, order_index) VALUES (?1, ?2, ?3)")?
                .execute(params![
                    change.glyph_id.to_string(),
                    change.name.as_str(),
                    order_index
                ])?;
            replace_glyph_unicodes(tx, &change.glyph_id, &change.unicodes)
        }
        font::FontChange::GlyphPopped(change) => {
            let (order_index, count) = tx
                .query_row(
                    "SELECT order_index, (SELECT COUNT(*) FROM glyphs) FROM glyphs WHERE id = ?1",
                    [change.glyph_id.to_string()],
                    |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
                )
                .optional()?
                .ok_or_else(|| StoreError::MissingEntity {
                    kind: "glyph",
                    id: change.glyph_id.to_string(),
                })?;
            if order_index + 1 != count {
                return Err(font::CoreError::InvalidEntityOrder {
                    kind: "glyph",
                    message: format!("identity {} is not the directory tail", change.glyph_id),
                }
                .into());
            }
            tx.execute(
                "DELETE FROM glyphs WHERE id = ?1",
                [change.glyph_id.to_string()],
            )?;
            Ok(())
        }
        font::FontChange::GlyphIdentityChanged(change) => {
            let rows_changed = tx.execute(
                "UPDATE glyphs SET name = ?1 WHERE id = ?2",
                params![change.to_name.as_str(), change.glyph_id.to_string()],
            )?;
            require_changed(rows_changed, "glyph", change.glyph_id.to_string())?;
            replace_glyph_unicodes(tx, &change.glyph_id, &change.to_unicodes)
        }
        font::FontChange::GlyphLayerCreated(change) => create_empty_layer_in_tx(
            tx,
            &change.glyph_id,
            change.layer_id.clone(),
            change.source_id.clone(),
            change.width,
            change.height,
        ),
        font::FontChange::GlyphLayerDeleted(change) => {
            let rows_changed = tx.execute(
                "DELETE FROM glyph_layers WHERE id = ?1",
                [layer_row_id(&change.layer_id)],
            )?;
            require_changed(rows_changed, "glyph layer", layer_row_id(&change.layer_id))?;
            Ok(())
        }
        font::FontChange::LayerMetricsChanged(change) => {
            update_packed_layer(tx, &change.layer_id, |layer| {
                layer.set_width(change.width);
                layer.set_height(change.height);
                Ok(())
            })
        }
        font::FontChange::ContourAdded(change) => {
            update_packed_layer(tx, &change.layer_id, |layer| {
                layer.add_contour(contour_from_value(&change.contour));
                Ok(())
            })
        }
        font::FontChange::ContourOpenClosedChanged(change) => {
            update_packed_layer(tx, &change.layer_id, |layer| {
                let contour = layer
                    .contour_mut(change.contour_id.clone())
                    .ok_or_else(|| StoreError::MissingEntity {
                        kind: "contour",
                        id: change.contour_id.to_string(),
                    })?;
                if change.closed {
                    contour.close();
                } else {
                    contour.open();
                }
                Ok(())
            })
        }
        font::FontChange::PointsAdded(change) => {
            update_packed_layer(tx, &change.layer_id, |layer| {
                layer.add_contour(contour_from_value(&change.contour));
                Ok(())
            })
        }
        font::FontChange::PointsDeleted(change) => {
            update_packed_layer(tx, &change.layer_id, |layer| {
                layer.add_contour(contour_from_value(&change.contour));
                Ok(())
            })
        }
        font::FontChange::PointSmoothChanged(change) => {
            update_packed_layer(tx, &change.layer_id, |layer| {
                let point = layer
                    .contours_iter_mut()
                    .flat_map(|contour| contour.points_mut())
                    .find(|point| point.id() == change.point_id)
                    .ok_or_else(|| StoreError::MissingEntity {
                        kind: "point",
                        id: change.point_id.to_string(),
                    })?;
                point.set_smooth(change.smooth);
                Ok(())
            })
        }
        font::FontChange::PointPositionsChanged(change) => {
            update_packed_layer(tx, &change.layer_id, |layer| {
                for position in &change.points {
                    let point = layer
                        .contours_iter_mut()
                        .flat_map(|contour| contour.points_mut())
                        .find(|point| point.id() == position.point_id)
                        .ok_or_else(|| StoreError::MissingEntity {
                            kind: "point",
                            id: position.point_id.to_string(),
                        })?;
                    point.set_position(position.x, position.y);
                }
                Ok(())
            })
        }
        font::FontChange::AnchorPositionsChanged(change) => {
            update_packed_layer(tx, &change.layer_id, |layer| {
                for position in &change.anchors {
                    if !layer.set_anchor_position(
                        position.anchor_id.clone(),
                        position.x,
                        position.y,
                    ) {
                        return Err(StoreError::MissingEntity {
                            kind: "anchor",
                            id: position.anchor_id.to_string(),
                        });
                    }
                }
                Ok(())
            })
        }
        font::FontChange::LayerGeometryReplaced(change) => {
            update_packed_layer(tx, &change.layer_id, |layer| {
                layer.set_width(change.layer.width);
                layer.set_height(change.layer.height);
                layer.clear_contours();
                for contour in &change.layer.contours {
                    layer.add_contour(contour_from_value(contour));
                }
                layer.clear_anchors();
                let mut anchors = change.layer.anchors.iter().collect::<Vec<_>>();
                anchors.sort_by_key(|anchor| anchor.order_index);
                for anchor in anchors {
                    layer.add_anchor(font::Anchor::with_id(
                        anchor.id.clone(),
                        anchor.name.clone(),
                        anchor.x,
                        anchor.y,
                    ));
                }
                Ok(())
            })
        }
    }
}

fn post_font_supersedes_incremental_layer_write(change: &font::FontChange) -> bool {
    matches!(
        change,
        font::FontChange::LayerMetricsChanged(_)
            | font::FontChange::ContourAdded(_)
            | font::FontChange::ContourOpenClosedChanged(_)
            | font::FontChange::PointsAdded(_)
            | font::FontChange::PointsDeleted(_)
            | font::FontChange::PointSmoothChanged(_)
            | font::FontChange::PointPositionsChanged(_)
            | font::FontChange::AnchorPositionsChanged(_)
            | font::FontChange::LayerGeometryReplaced(_)
    )
}

fn update_packed_layer(
    tx: &Transaction<'_>,
    layer_id: &font::LayerId,
    update: impl FnOnce(&mut font::GlyphLayer) -> Result<(), StoreError>,
) -> Result<(), StoreError> {
    let mut layer = crate::layer::load_glyph_layer_from_conn(tx, layer_id)?.ok_or_else(|| {
        StoreError::MissingEntity {
            kind: "glyph layer",
            id: layer_id.to_string(),
        }
    })?;
    update(&mut layer)?;
    rewrite_layer_in_tx(tx, &layer)
}

fn contour_from_value(value: &font::ContourValue) -> font::Contour {
    let mut contour = font::Contour::with_id(value.id.clone());
    let mut points = value.points.iter().collect::<Vec<_>>();
    points.sort_by_key(|point| point.order_index);
    for point in points {
        contour.push_point(font::Point::new(
            point.id.clone(),
            point.x,
            point.y,
            point.point_type,
            point.smooth,
        ));
    }
    if value.closed {
        contour.close();
    }
    contour
}

pub(crate) fn upsert_axis_with_order(
    tx: &Transaction<'_>,
    axis: &font::Axis,
    order_index: i64,
) -> Result<(), StoreError> {
    insert_axis(tx, axis, order_index, true)
}

fn insert_axis(
    tx: &Transaction<'_>,
    axis: &font::Axis,
    order_index: i64,
    upsert: bool,
) -> Result<(), StoreError> {
    let role = match axis.role() {
        font::AxisRole::External => "external",
        font::AxisRole::Internal => "internal",
    };
    let discrete_values_json = axis
        .discrete_values()
        .map(serde_json::to_string)
        .transpose()?;
    let labels_json = serde_json::to_string(axis.labels())?;
    let conflict = if upsert {
        "ON CONFLICT(id) DO UPDATE SET tag = excluded.tag, name = excluded.name, min_value = excluded.min_value, default_value = excluded.default_value, max_value = excluded.max_value, role = excluded.role, discrete_values_json = excluded.discrete_values_json, labels_json = excluded.labels_json, hidden = excluded.hidden, order_index = excluded.order_index"
    } else {
        ""
    };
    let statement = format!(
        "INSERT INTO axes (id, tag, name, min_value, default_value, max_value, role, discrete_values_json, labels_json, hidden, order_index) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) {conflict}"
    );
    tx.execute(
        &statement,
        params![
            axis.id().to_string(),
            axis.tag(),
            axis.name(),
            axis.minimum(),
            axis.default(),
            axis.maximum(),
            role,
            discrete_values_json,
            labels_json,
            axis.is_hidden(),
            order_index,
        ],
    )?;
    Ok(())
}

fn axis_exists(tx: &Transaction<'_>, axis_id: &font::AxisId) -> Result<bool, StoreError> {
    tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM axes WHERE id = ?1)",
        [axis_id.to_string()],
        |row| row.get(0),
    )
    .map_err(StoreError::from)
}

/// Deletes one ordered row and compacts every later position in the same transaction.
fn delete_ordered_row(
    tx: &Transaction<'_>,
    table: &'static str,
    kind: &'static str,
    id: String,
) -> Result<(), StoreError> {
    let order_index = tx
        .query_row(
            &format!("SELECT order_index FROM {table} WHERE id = ?1"),
            [id.as_str()],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .ok_or_else(|| StoreError::MissingEntity {
            kind,
            id: id.clone(),
        })?;
    tx.execute(&format!("DELETE FROM {table} WHERE id = ?1"), [id.as_str()])?;
    tx.execute(
        &format!("UPDATE {table} SET order_index = order_index - 1 WHERE order_index > ?1"),
        [order_index],
    )?;
    Ok(())
}

pub(crate) fn replace_axis_mappings(
    tx: &Transaction<'_>,
    mappings: &[font::AxisMapping],
) -> Result<(), StoreError> {
    tx.execute("DELETE FROM axis_mappings", [])?;
    for (order_index, mapping) in mappings.iter().enumerate() {
        tx.execute(
            "INSERT INTO axis_mappings (id, mapping_json, order_index) VALUES (?1, ?2, ?3)",
            params![
                mapping.id().to_string(),
                serde_json::to_string(mapping)?,
                order_index as i64,
            ],
        )?;
    }
    Ok(())
}

pub(crate) fn replace_named_instances(
    tx: &Transaction<'_>,
    instances: &[font::NamedInstance],
) -> Result<(), StoreError> {
    tx.execute("DELETE FROM named_instances", [])?;
    for (order_index, instance) in instances.iter().enumerate() {
        tx.execute(
            "INSERT INTO named_instances (id, instance_json, order_index) VALUES (?1, ?2, ?3)",
            params![
                instance.id().to_string(),
                serde_json::to_string(instance)?,
                order_index as i64,
            ],
        )?;
    }
    Ok(())
}

pub(crate) fn replace_metric_definitions(
    tx: &Transaction<'_>,
    definitions: &[font::MetricDefinition],
) -> Result<(), StoreError> {
    tx.execute("DELETE FROM metric_definitions", [])?;
    for (order_index, definition) in definitions.iter().enumerate() {
        let kind = match definition.kind() {
            font::MetricKind::Ascender => "ascender",
            font::MetricKind::CapHeight => "cap_height",
            font::MetricKind::XHeight => "x_height",
            font::MetricKind::Baseline => "baseline",
            font::MetricKind::Descender => "descender",
            font::MetricKind::Custom => "custom",
        };
        tx.execute(
            "INSERT INTO metric_definitions (id, kind, name, order_index) VALUES (?1, ?2, ?3, ?4)",
            params![
                definition.id().to_string(),
                kind,
                definition.name(),
                order_index as i64,
            ],
        )?;
    }
    Ok(())
}

fn replace_source_metric_values<'a>(
    tx: &Transaction<'_>,
    source_id: font::SourceId,
    values: impl IntoIterator<Item = (&'a font::MetricId, &'a font::MetricValue)>,
) -> Result<(), StoreError> {
    tx.execute(
        "DELETE FROM source_metric_values WHERE source_id = ?1",
        [source_id.to_string()],
    )?;
    for (metric_id, value) in values {
        tx.execute(
            "
            INSERT INTO source_metric_values (source_id, metric_id, position, overshoot)
            VALUES (?1, ?2, ?3, ?4)
            ",
            params![
                source_id.to_string(),
                metric_id.to_string(),
                value.position,
                value.overshoot,
            ],
        )?;
    }
    Ok(())
}

fn upsert_source_location(
    tx: &Transaction<'_>,
    source_id: &font::SourceId,
    axis_id: &font::AxisId,
    value: f64,
) -> Result<(), StoreError> {
    tx.execute(
        "
        INSERT INTO source_locations (source_id, axis_id, value)
        VALUES (?1, ?2, ?3)
        ON CONFLICT(source_id, axis_id) DO UPDATE SET
            value = excluded.value
        ",
        params![source_id.to_string(), axis_id.to_string(), value],
    )?;
    Ok(())
}

struct SourceRow<'a> {
    name: Option<&'a str>,
    filename: Option<&'a str>,
    color: Option<&'a str>,
    kind: SourceKind,
    layer_name: Option<&'a str>,
    italic_angle: Option<f64>,
    line_gap: Option<f64>,
    underline_position: Option<f64>,
    underline_thickness: Option<f64>,
    order_index: i64,
}

fn upsert_source(
    tx: &Transaction<'_>,
    source_id: &font::SourceId,
    row: SourceRow<'_>,
) -> Result<(), StoreError> {
    tx.execute(
        "
        INSERT INTO sources (
            id, name, filename, color, kind, layer_name,
            italic_angle, line_gap, underline_position, underline_thickness, order_index
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        ON CONFLICT(id) DO UPDATE SET
            name = COALESCE(excluded.name, sources.name),
            filename = excluded.filename,
            color = excluded.color,
            kind = excluded.kind,
            layer_name = excluded.layer_name,
            italic_angle = excluded.italic_angle,
            line_gap = excluded.line_gap,
            underline_position = excluded.underline_position,
            underline_thickness = excluded.underline_thickness,
            order_index = excluded.order_index
        ",
        params![
            source_id.to_string(),
            row.name,
            row.filename,
            row.color,
            row.kind.as_str(),
            row.layer_name,
            row.italic_angle,
            row.line_gap,
            row.underline_position,
            row.underline_thickness,
            row.order_index
        ],
    )?;
    Ok(())
}

pub(crate) fn write_source_snapshot_in_tx(
    tx: &Transaction<'_>,
    source: &font::Source,
    order_index: i64,
) -> Result<(), StoreError> {
    upsert_source(
        tx,
        &source.id(),
        SourceRow {
            name: Some(source.name()),
            filename: source.filename(),
            color: source.color(),
            kind: SourceKind::from(source.role()),
            layer_name: source.layer_name(),
            italic_angle: source.italic_angle(),
            line_gap: source.line_gap(),
            underline_position: source.underline_position(),
            underline_thickness: source.underline_thickness(),
            order_index,
        },
    )?;
    tx.execute(
        "DELETE FROM source_locations WHERE source_id = ?1",
        [source.id().to_string()],
    )?;
    for (axis_id, value) in source.location().iter() {
        upsert_source_location(tx, &source.id(), axis_id, *value)?;
    }
    replace_source_metric_values(tx, source.id(), source.metric_values().iter())?;
    replace_lib_data(
        tx,
        "source_lib",
        "source_id",
        Some(&source.id().to_string()),
        source.lib(),
    )?;
    Ok(())
}

fn upsert_glyph(
    tx: &Transaction<'_>,
    glyph_id: &font::GlyphId,
    name: &font::GlyphName,
    order_index: i64,
) -> Result<(), StoreError> {
    tx.prepare_cached(
        "
        INSERT INTO glyphs (id, name, order_index)
        VALUES (?1, ?2, ?3)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            order_index = excluded.order_index
        ",
    )?
    .execute(params![glyph_id.to_string(), name.as_str(), order_index])?;
    Ok(())
}

fn replace_glyph_unicodes(
    tx: &Transaction<'_>,
    glyph_id: &font::GlyphId,
    unicodes: &[u32],
) -> Result<(), StoreError> {
    tx.prepare_cached("DELETE FROM glyph_unicodes WHERE glyph_id = ?1")?
        .execute([glyph_id.to_string()])?;

    for (order_index, unicode) in unicodes.iter().enumerate() {
        tx.prepare_cached(
            "
            INSERT INTO glyph_unicodes (glyph_id, unicode, order_index)
            VALUES (?1, ?2, ?3)
            ",
        )?
        .execute(params![
            glyph_id.to_string(),
            *unicode as i64,
            order_index as i64
        ])?;
    }

    Ok(())
}

/// Updates only authored metadata columns, preserving metrics and store-only fields.
fn update_font_metadata(
    tx: &Transaction<'_>,
    metadata: &font::FontMetadata,
) -> Result<(), StoreError> {
    let rows_changed = tx.execute(
        "
        UPDATE font_info
        SET family_name = ?1,
            style_name = ?2,
            copyright = ?3,
            trademark = ?4,
            description = ?5,
            note = ?6,
            designer = ?7,
            designer_url = ?8,
            manufacturer = ?9,
            manufacturer_url = ?10,
            license_description = ?11,
            license_info_url = ?12,
            version_major = ?13,
            version_minor = ?14
        WHERE id = 1
        ",
        params![
            metadata.family_name.as_deref(),
            metadata.style_name.as_deref(),
            metadata.copyright.as_deref(),
            metadata.trademark.as_deref(),
            metadata.description.as_deref(),
            metadata.note.as_deref(),
            metadata.designer.as_deref(),
            metadata.designer_url.as_deref(),
            metadata.manufacturer.as_deref(),
            metadata.manufacturer_url.as_deref(),
            metadata.license.as_deref(),
            metadata.license_url.as_deref(),
            metadata.version_major.map(i64::from),
            metadata.version_minor.map(i64::from),
        ],
    )?;
    require_changed(rows_changed, "font info", "1".to_string())
}

/// Persists the live font's default source identity without changing other font fields.
pub(crate) fn set_default_source_id(
    tx: &Transaction<'_>,
    source_id: Option<&font::SourceId>,
) -> Result<(), StoreError> {
    let rows_changed = tx.execute(
        "UPDATE font_info SET default_source_id = ?1 WHERE id = 1",
        [source_id.map(font::SourceId::as_str)],
    )?;
    require_changed(rows_changed, "font info", "1".to_string())
}

pub(crate) fn upsert_font_info(tx: &Transaction<'_>, font: &font::Font) -> Result<(), StoreError> {
    let metadata = font.metadata();
    let metrics = font.metrics();
    tx.execute(
        "
        INSERT INTO font_info (
            id,
            family_name,
            style_name,
            copyright,
            trademark,
            description,
            note,
            sample_text,
            designer,
            designer_url,
            manufacturer,
            manufacturer_url,
            license_description,
            license_info_url,
            vendor_id,
            version_major,
            version_minor,
            units_per_em,
            default_source_id
        )
        VALUES (
            1, ?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7, ?8, ?9, ?10, ?11, ?12, NULL,
            ?13, ?14, ?15, ?16
        )
        ON CONFLICT(id) DO UPDATE SET
            family_name = excluded.family_name,
            style_name = excluded.style_name,
            copyright = excluded.copyright,
            trademark = excluded.trademark,
            description = excluded.description,
            note = excluded.note,
            sample_text = excluded.sample_text,
            designer = excluded.designer,
            designer_url = excluded.designer_url,
            manufacturer = excluded.manufacturer,
            manufacturer_url = excluded.manufacturer_url,
            license_description = excluded.license_description,
            license_info_url = excluded.license_info_url,
            vendor_id = excluded.vendor_id,
            version_major = excluded.version_major,
            version_minor = excluded.version_minor,
            units_per_em = excluded.units_per_em,
            default_source_id = excluded.default_source_id
        ",
        params![
            metadata.family_name.as_deref(),
            metadata.style_name.as_deref(),
            metadata.copyright.as_deref(),
            metadata.trademark.as_deref(),
            metadata.description.as_deref(),
            metadata.note.as_deref(),
            metadata.designer.as_deref(),
            metadata.designer_url.as_deref(),
            metadata.manufacturer.as_deref(),
            metadata.manufacturer_url.as_deref(),
            metadata.license.as_deref(),
            metadata.license_url.as_deref(),
            metadata.version_major.map(i64::from),
            metadata.version_minor.map(i64::from),
            metrics.units_per_em,
            font.default_source_id().map(|id| id.to_string()),
        ],
    )?;
    Ok(())
}

fn replace_feature_text(tx: &Transaction<'_>, fea_source: Option<&str>) -> Result<(), StoreError> {
    tx.execute("DELETE FROM feature_text", [])?;
    tx.execute(
        "
        INSERT INTO feature_text (id, fea_source)
        VALUES (1, ?1)
        ",
        [fea_source],
    )?;
    Ok(())
}

fn replace_font_guidelines(
    tx: &Transaction<'_>,
    guidelines: &[font::Guideline],
) -> Result<(), StoreError> {
    tx.execute("DELETE FROM font_guidelines", [])?;
    for (order_index, guideline) in guidelines.iter().enumerate() {
        tx.execute(
            "
            INSERT INTO font_guidelines (
                id, x, y, angle, name, color, order_index
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ",
            params![
                guideline.id().to_string(),
                guideline.x(),
                guideline.y(),
                guideline.angle(),
                guideline.name(),
                guideline.color(),
                order_index as i64,
            ],
        )?;
    }
    Ok(())
}
fn replace_kerning(tx: &Transaction<'_>, kerning: &font::KerningData) -> Result<(), StoreError> {
    tx.execute("DELETE FROM kerning_pairs", [])?;
    tx.execute("DELETE FROM kerning_group_members", [])?;
    tx.execute("DELETE FROM kerning_groups", [])?;

    for (name, members) in kerning.groups1() {
        insert_kerning_group(tx, 1, name, members)?;
    }
    for (name, members) in kerning.groups2() {
        insert_kerning_group(tx, 2, name, members)?;
    }
    for (order_index, pair) in kerning.pairs().iter().enumerate() {
        let (first_kind, first_value) = kerning_side_parts(&pair.first);
        let (second_kind, second_value) = kerning_side_parts(&pair.second);
        tx.execute(
            "
            INSERT INTO kerning_pairs (
                order_index,
                first_kind,
                first_value,
                second_kind,
                second_value,
                value
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ",
            params![
                order_index as i64,
                first_kind,
                first_value,
                second_kind,
                second_value,
                pair.value,
            ],
        )?;
    }
    Ok(())
}

fn insert_kerning_group(
    tx: &Transaction<'_>,
    side: i64,
    name: &str,
    members: &[font::GlyphName],
) -> Result<(), StoreError> {
    tx.execute(
        "
        INSERT INTO kerning_groups (side, name)
        VALUES (?1, ?2)
        ",
        params![side, name],
    )?;
    for (order_index, member) in members.iter().enumerate() {
        tx.execute(
            "
            INSERT INTO kerning_group_members (side, group_name, glyph_name, order_index)
            VALUES (?1, ?2, ?3, ?4)
            ",
            params![side, name, member.as_str(), order_index as i64],
        )?;
    }
    Ok(())
}

fn kerning_side_parts(side: &font::KerningSide) -> (&'static str, &str) {
    match side {
        font::KerningSide::Glyph(name) => ("glyph", name.as_str()),
        font::KerningSide::Group(group_id) => ("group", group_id.as_str()),
    }
}

fn replace_lib_data(
    tx: &Transaction<'_>,
    table: &'static str,
    owner_column: &'static str,
    owner_id: Option<&str>,
    lib: &font::LibData,
) -> Result<(), StoreError> {
    match owner_id {
        Some(owner_id) => {
            let delete_sql = format!("DELETE FROM {table} WHERE {owner_column} = ?1");
            tx.prepare_cached(&delete_sql)?.execute([owner_id])?;
            let insert_sql = format!(
                "INSERT INTO {table} ({owner_column}, key, value_json) VALUES (?1, ?2, ?3)"
            );
            for (key, value) in lib.iter() {
                tx.prepare_cached(&insert_sql)?.execute(params![
                    owner_id,
                    key,
                    lib_value_json(value)?
                ])?;
            }
        }
        None => {
            let delete_sql = format!("DELETE FROM {table}");
            tx.execute(&delete_sql, [])?;
            let insert_sql = format!("INSERT INTO {table} (key, value_json) VALUES (?1, ?2)");
            for (key, value) in lib.iter() {
                tx.execute(&insert_sql, params![key, lib_value_json(value)?])?;
            }
        }
    }
    Ok(())
}

fn replace_font_binaries(
    tx: &Transaction<'_>,
    kind: &str,
    binaries: &font::BinaryData,
) -> Result<(), StoreError> {
    for (path, bytes) in binaries.iter() {
        tx.execute(
            "
            INSERT INTO font_binaries (kind, path, bytes)
            VALUES (?1, ?2, ?3)
            ",
            params![kind, path, bytes],
        )?;
    }
    Ok(())
}

fn lib_value_json(value: &font::LibValue) -> Result<String, StoreError> {
    Ok(serde_json::to_string(&lib_value_to_json(value))?)
}

fn lib_value_to_json(value: &font::LibValue) -> serde_json::Value {
    match value {
        font::LibValue::String(value) => {
            typed_json("string", serde_json::Value::String(value.clone()))
        }
        font::LibValue::Integer(value) => typed_json("integer", serde_json::json!(value)),
        font::LibValue::UnsignedInteger(value) => {
            typed_json("unsignedInteger", serde_json::json!(value))
        }
        font::LibValue::Float(value) => typed_json("float", serde_json::json!(value)),
        font::LibValue::Boolean(value) => typed_json("boolean", serde_json::json!(value)),
        font::LibValue::Array(values) => typed_json(
            "array",
            serde_json::Value::Array(values.iter().map(lib_value_to_json).collect()),
        ),
        font::LibValue::Dict(values) => typed_json(
            "dict",
            serde_json::Value::Object(
                values
                    .iter()
                    .map(|(key, value)| (key.clone(), lib_value_to_json(value)))
                    .collect(),
            ),
        ),
        font::LibValue::Data(values) => typed_json("data", serde_json::json!(values)),
        font::LibValue::Date(value) => typed_json("date", serde_json::Value::String(value.clone())),
        font::LibValue::Uid(value) => typed_json("uid", serde_json::json!(value)),
    }
}

fn typed_json(kind: &'static str, value: serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "type": kind,
        "value": value,
    })
}

fn require_changed(rows_changed: usize, kind: &'static str, id: String) -> Result<(), StoreError> {
    if rows_changed == 0 {
        Err(StoreError::MissingEntity { kind, id })
    } else {
        Ok(())
    }
}

fn layer_row_id(layer_id: &font::LayerId) -> String {
    layer_id.to_string()
}
