use rusqlite::{Transaction, params};
use shift_font as font;

use crate::{
    ShiftStore, StoreError, source::SourceKind, workspace_state::mark_workspace_dirty_in_tx,
};

impl ShiftStore {
    pub fn apply_change_set(&mut self, change_set: &font::FontChangeSet) -> Result<(), StoreError> {
        let tx = self.conn.transaction()?;

        for change in &change_set.changes {
            apply_change(&tx, change)?;
        }
        mark_workspace_dirty_in_tx(&tx)?;

        tx.commit()?;
        Ok(())
    }

    pub fn replace_font_state(&mut self, font: &font::Font) -> Result<(), StoreError> {
        let tx = self.conn.transaction()?;

        tx.execute("DELETE FROM glyph_layer_lib", [])?;
        tx.execute("DELETE FROM glyph_lib", [])?;
        tx.execute("DELETE FROM font_lib", [])?;
        tx.execute("DELETE FROM fontinfo_remainder", [])?;
        tx.execute("DELETE FROM font_binaries", [])?;
        tx.execute("DELETE FROM kerning_pairs", [])?;
        tx.execute("DELETE FROM kerning_group_members", [])?;
        tx.execute("DELETE FROM kerning_groups", [])?;
        tx.execute("DELETE FROM feature_text", [])?;
        tx.execute("DELETE FROM glyph_layer_guidelines", [])?;
        tx.execute("DELETE FROM font_guidelines", [])?;
        tx.execute("DELETE FROM glyph_layer_points", [])?;
        tx.execute("DELETE FROM glyph_layer_contours", [])?;
        tx.execute("DELETE FROM glyph_layer_anchors", [])?;
        tx.execute("DELETE FROM glyph_components", [])?;
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

        upsert_font_info(&tx, font)?;
        replace_feature_text(&tx, font.features().fea_source())?;
        replace_font_guidelines(&tx, font.guidelines())?;
        replace_lib_data(&tx, "font_lib", "key", None, font.lib())?;
        replace_lib_data(
            &tx,
            "fontinfo_remainder",
            "key",
            None,
            font.fontinfo_remainder(),
        )?;
        replace_font_binaries(&tx, "data", font.data_files())?;
        replace_font_binaries(&tx, "image", font.images())?;
        replace_kerning(&tx, font.kerning())?;

        for (order_index, axis) in font.axes().iter().enumerate() {
            insert_axis(&tx, axis, order_index as i64, false)?;
        }
        replace_axis_mappings(&tx, font.axis_mappings())?;
        replace_named_instances(&tx, font.named_instances())?;
        replace_metric_definitions(&tx, font.metric_definitions())?;

        for (order_index, source) in font.sources().iter().enumerate() {
            upsert_source(
                &tx,
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
            replace_source_metric_values(&tx, source.id(), source.metric_values().iter())?;
            replace_lib_data(
                &tx,
                "source_lib",
                "source_id",
                Some(&source.id().to_string()),
                source.lib(),
            )?;

            for (axis_id, value) in source.location().iter() {
                // Location entries on undefined axes have no row to reference.
                if font.axes().iter().any(|axis| axis.id() == *axis_id) {
                    upsert_source_location(&tx, &source.id(), axis_id, *value)?;
                }
            }
        }

        for (order_index, glyph) in font.glyphs().enumerate() {
            upsert_glyph(&tx, &glyph.id(), glyph.glyph_name(), order_index as i64)?;
            replace_glyph_unicodes(&tx, &glyph.id(), glyph.unicodes())?;
            replace_lib_data(
                &tx,
                "glyph_lib",
                "glyph_id",
                Some(&glyph.id().to_string()),
                glyph.lib(),
            )?;

            for layer in glyph.layers().values().map(|layer| layer.as_ref()) {
                upsert_layer(
                    &tx,
                    &layer.id(),
                    &glyph.id(),
                    &layer.source_id(),
                    Some(glyph.glyph_name()),
                    layer.width(),
                    layer.height(),
                )?;
                replace_full_layer_state(&tx, layer)?;
            }
        }

        tx.commit()?;
        Ok(())
    }
}

fn apply_change(tx: &Transaction<'_>, change: &font::FontChange) -> Result<(), StoreError> {
    match change {
        font::FontChange::FontMetadataUpdated(change) => update_font_metadata(tx, &change.metadata),
        font::FontChange::AxisCreated(change) => insert_axis(tx, &change.axis, 0, false),
        font::FontChange::AxisUpdated(change) => upsert_axis_with_order(tx, &change.axis, 0),
        font::FontChange::AxisDeleted(change) => {
            // source_locations cascade from the axis row.
            let rows_changed = tx.execute(
                "DELETE FROM axes WHERE id = ?1",
                [change.axis_id.to_string()],
            )?;
            require_changed(rows_changed, "axis", change.axis_id.to_string())?;
            Ok(())
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
            upsert_source(
                tx,
                &change.source_id,
                SourceRow {
                    name: Some(&change.name),
                    filename: None,
                    color: None,
                    kind: SourceKind::Master,
                    layer_name: None,
                    italic_angle: change.italic_angle,
                    line_gap: change.line_gap,
                    underline_position: change.underline_position,
                    underline_thickness: change.underline_thickness,
                    order_index: 0,
                },
            )?;

            replace_source_metric_values(
                tx,
                change.source_id.clone(),
                change
                    .metric_values
                    .iter()
                    .map(|value| (&value.metric_id, &value.value)),
            )?;

            for axis_value in &change.location {
                upsert_source_location(
                    tx,
                    &change.source_id,
                    &axis_value.axis_id,
                    axis_value.value,
                )?;
            }

            Ok(())
        }
        font::FontChange::SourceUpdated(change) => {
            let source = &change.source;
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
                    order_index: 0,
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
            )
        }
        font::FontChange::SourceDeleted(change) => {
            // glyph_layers and source_locations cascade on the source row.
            let rows_changed = tx.execute(
                "DELETE FROM sources WHERE id = ?1",
                [change.source_id.to_string()],
            )?;
            require_changed(rows_changed, "source", change.source_id.to_string())?;
            Ok(())
        }
        font::FontChange::GlyphCreated(change) => {
            upsert_glyph(tx, &change.glyph_id, &change.name, 0)?;
            replace_glyph_unicodes(tx, &change.glyph_id, &change.unicodes)
        }
        font::FontChange::GlyphDeleted(change) => {
            let rows_changed = tx.execute(
                "DELETE FROM glyphs WHERE id = ?1",
                [change.glyph_id.to_string()],
            )?;
            require_changed(rows_changed, "glyph", change.glyph_id.to_string())?;
            Ok(())
        }
        font::FontChange::GlyphIdentityChanged(change) => {
            upsert_glyph(tx, &change.glyph_id, &change.to_name, 0)?;
            replace_glyph_unicodes(tx, &change.glyph_id, &change.to_unicodes)
        }
        font::FontChange::GlyphLayerCreated(change) => upsert_layer(
            tx,
            &change.layer_id,
            &change.glyph_id,
            &change.source_id,
            change.name.as_ref(),
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
            let rows_changed = tx.execute(
                "
                UPDATE glyph_layers
                SET width = ?2, height = ?3
                WHERE id = ?1
                ",
                params![layer_row_id(&change.layer_id), change.width, change.height,],
            )?;
            require_changed(rows_changed, "glyph layer", layer_row_id(&change.layer_id))?;
            Ok(())
        }
        font::FontChange::ContourAdded(change) => {
            require_layer_exists(tx, &change.layer_id)?;
            replace_contour(tx, &change.layer_id, &change.contour)
        }
        font::FontChange::ContourOpenClosedChanged(change) => {
            require_layer_exists(tx, &change.layer_id)?;
            let rows_changed = tx.execute(
                "
                UPDATE glyph_layer_contours
                SET closed = ?2
                WHERE id = ?1
                ",
                params![change.contour_id.to_string(), change.closed],
            )?;
            require_changed(rows_changed, "contour", change.contour_id.to_string())?;
            Ok(())
        }
        font::FontChange::PointsAdded(change) => {
            require_layer_exists(tx, &change.layer_id)?;
            replace_contour(tx, &change.layer_id, &change.contour)
        }
        font::FontChange::PointsDeleted(change) => {
            require_layer_exists(tx, &change.layer_id)?;
            replace_contour(tx, &change.layer_id, &change.contour)
        }
        font::FontChange::PointSmoothChanged(change) => {
            require_layer_exists(tx, &change.layer_id)?;
            let rows_changed = tx.execute(
                "
                UPDATE glyph_layer_points
                SET smooth = ?2
                WHERE id = ?1
                ",
                params![change.point_id.to_string(), change.smooth],
            )?;
            require_changed(rows_changed, "point", change.point_id.to_string())?;
            Ok(())
        }
        font::FontChange::PointPositionsChanged(change) => {
            require_layer_exists(tx, &change.layer_id)?;
            for point in &change.points {
                let rows_changed = tx.execute(
                    "
                    UPDATE glyph_layer_points
                    SET x = ?2, y = ?3
                    WHERE id = ?1
                    ",
                    params![point.point_id.to_string(), point.x, point.y],
                )?;
                require_changed(rows_changed, "point", point.point_id.to_string())?;
            }
            Ok(())
        }
        font::FontChange::AnchorPositionsChanged(change) => {
            require_layer_exists(tx, &change.layer_id)?;
            for anchor in &change.anchors {
                let rows_changed = tx.execute(
                    "
                    UPDATE glyph_layer_anchors
                    SET x = ?2, y = ?3
                    WHERE id = ?1
                    ",
                    params![anchor.anchor_id.to_string(), anchor.x, anchor.y],
                )?;
                require_changed(rows_changed, "anchor", anchor.anchor_id.to_string())?;
            }
            Ok(())
        }
        font::FontChange::LayerGeometryReplaced(change) => {
            require_layer_exists(tx, &change.layer_id)?;
            replace_layer_geometry(tx, &change.layer_id, &change.layer)
        }
    }
}

fn upsert_axis_with_order(
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
        "ON CONFLICT(id) DO UPDATE SET tag = excluded.tag, name = excluded.name, min_value = excluded.min_value, default_value = excluded.default_value, max_value = excluded.max_value, role = excluded.role, discrete_values_json = excluded.discrete_values_json, labels_json = excluded.labels_json, hidden = excluded.hidden"
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

fn replace_axis_mappings(
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

fn replace_named_instances(
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

fn replace_metric_definitions(
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

fn upsert_glyph(
    tx: &Transaction<'_>,
    glyph_id: &font::GlyphId,
    name: &font::GlyphName,
    order_index: i64,
) -> Result<(), StoreError> {
    tx.execute(
        "
        INSERT INTO glyphs (id, name, order_index)
        VALUES (?1, ?2, ?3)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            order_index = excluded.order_index
        ",
        params![glyph_id.to_string(), name.as_str(), order_index],
    )?;
    Ok(())
}

fn replace_glyph_unicodes(
    tx: &Transaction<'_>,
    glyph_id: &font::GlyphId,
    unicodes: &[u32],
) -> Result<(), StoreError> {
    tx.execute(
        "DELETE FROM glyph_unicodes WHERE glyph_id = ?1",
        [glyph_id.to_string()],
    )?;

    for (order_index, unicode) in unicodes.iter().enumerate() {
        tx.execute(
            "
            INSERT INTO glyph_unicodes (glyph_id, unicode, order_index)
            VALUES (?1, ?2, ?3)
            ",
            params![glyph_id.to_string(), *unicode as i64, order_index as i64],
        )?;
    }

    Ok(())
}

fn upsert_layer(
    tx: &Transaction<'_>,
    layer_id: &font::LayerId,
    glyph_id: &font::GlyphId,
    source_id: &font::SourceId,
    name: Option<&font::GlyphName>,
    width: f64,
    height: Option<f64>,
) -> Result<(), StoreError> {
    tx.execute(
        "
        INSERT INTO glyph_layers (id, glyph_id, source_id, name, width, height)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT(id) DO UPDATE SET
            glyph_id = excluded.glyph_id,
            source_id = excluded.source_id,
            name = excluded.name
        ",
        params![
            layer_row_id(layer_id),
            glyph_id.to_string(),
            source_id.to_string(),
            name.map(font::GlyphName::as_str),
            width,
            height,
        ],
    )?;
    Ok(())
}

fn replace_layer_geometry(
    tx: &Transaction<'_>,
    layer_id: &font::LayerId,
    layer: &font::GlyphLayerValue,
) -> Result<(), StoreError> {
    let rows_changed = tx.execute(
        "
        UPDATE glyph_layers
        SET width = ?2, height = ?3
        WHERE id = ?1
        ",
        params![layer_row_id(layer_id), layer.width, layer.height],
    )?;
    require_changed(rows_changed, "glyph layer", layer_row_id(layer_id))?;
    tx.execute(
        "
        DELETE FROM glyph_layer_contours
        WHERE layer_id = ?1
        ",
        [layer_row_id(layer_id)],
    )?;

    for (order_index, contour) in layer.contours.iter().enumerate() {
        insert_contour(tx, layer_id, order_index, contour)?;
    }

    tx.execute(
        "
        DELETE FROM glyph_layer_anchors
        WHERE layer_id = ?1
        ",
        [layer_row_id(layer_id)],
    )?;

    for anchor in &layer.anchors {
        insert_anchor(tx, layer_id, anchor)?;
    }

    Ok(())
}

fn replace_full_layer_state(
    tx: &Transaction<'_>,
    layer: &font::GlyphLayer,
) -> Result<(), StoreError> {
    replace_layer_geometry(tx, &layer.id(), &font::GlyphLayerValue::from(layer))?;

    tx.execute(
        "
        DELETE FROM glyph_components
        WHERE layer_id = ?1
        ",
        [layer_row_id(&layer.id())],
    )?;

    for (order_index, component) in layer.components_iter().enumerate() {
        insert_component(tx, &layer.id(), component, order_index)?;
    }

    replace_layer_guidelines(tx, &layer.id(), layer.guidelines())?;
    replace_lib_data(
        tx,
        "glyph_layer_lib",
        "layer_id",
        Some(&layer.id().to_string()),
        layer.lib(),
    )?;

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

fn upsert_font_info(tx: &Transaction<'_>, font: &font::Font) -> Result<(), StoreError> {
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
        insert_guideline(tx, "font_guidelines", None, guideline, order_index)?;
    }
    Ok(())
}

fn replace_layer_guidelines(
    tx: &Transaction<'_>,
    layer_id: &font::LayerId,
    guidelines: &[font::Guideline],
) -> Result<(), StoreError> {
    tx.execute(
        "
        DELETE FROM glyph_layer_guidelines
        WHERE layer_id = ?1
        ",
        [layer_row_id(layer_id)],
    )?;
    for (order_index, guideline) in guidelines.iter().enumerate() {
        insert_guideline(
            tx,
            "glyph_layer_guidelines",
            Some(&layer_row_id(layer_id)),
            guideline,
            order_index,
        )?;
    }
    Ok(())
}

fn insert_guideline(
    tx: &Transaction<'_>,
    table: &'static str,
    layer_id: Option<&str>,
    guideline: &font::Guideline,
    order_index: usize,
) -> Result<(), StoreError> {
    match layer_id {
        Some(layer_id) => {
            debug_assert_eq!(table, "glyph_layer_guidelines");
            tx.execute(
                "
                INSERT INTO glyph_layer_guidelines (
                    id, layer_id, x, y, angle, name, color, order_index
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                ",
                params![
                    guideline.id().to_string(),
                    layer_id,
                    guideline.x(),
                    guideline.y(),
                    guideline.angle(),
                    guideline.name(),
                    guideline.color(),
                    order_index as i64,
                ],
            )?;
        }
        None => {
            debug_assert_eq!(table, "font_guidelines");
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
    }
    Ok(())
}

fn insert_component(
    tx: &Transaction<'_>,
    layer_id: &font::LayerId,
    component: &font::Component,
    order_index: usize,
) -> Result<(), StoreError> {
    let transform = component.transform();
    tx.execute(
        "
        INSERT INTO glyph_components (
            id,
            layer_id,
            base_glyph_id,
            base_glyph_name,
            translate_x,
            translate_y,
            rotation,
            scale_x,
            scale_y,
            skew_x,
            skew_y,
            t_center_x,
            t_center_y,
            order_index
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
        ",
        params![
            component.id().to_string(),
            layer_row_id(layer_id),
            component.base_glyph_id().to_string(),
            component.base_glyph_name().as_str(),
            transform.translate_x,
            transform.translate_y,
            transform.rotation,
            transform.scale_x,
            transform.scale_y,
            transform.skew_x,
            transform.skew_y,
            transform.t_center_x,
            transform.t_center_y,
            order_index as i64,
        ],
    )?;
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
            tx.execute(&delete_sql, [owner_id])?;
            let insert_sql = format!(
                "INSERT INTO {table} ({owner_column}, key, value_json) VALUES (?1, ?2, ?3)"
            );
            for (key, value) in lib.iter() {
                tx.execute(&insert_sql, params![owner_id, key, lib_value_json(value)?])?;
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

fn replace_contour(
    tx: &Transaction<'_>,
    layer_id: &font::LayerId,
    contour: &font::ContourValue,
) -> Result<(), StoreError> {
    tx.execute(
        "
        INSERT INTO glyph_layer_contours (id, layer_id, closed, order_index)
        VALUES (?1, ?2, ?3, COALESCE(
            (SELECT order_index FROM glyph_layer_contours WHERE id = ?1),
            (SELECT COUNT(*) FROM glyph_layer_contours WHERE layer_id = ?2)
        ))
        ON CONFLICT(id) DO UPDATE SET
            closed = excluded.closed,
            layer_id = excluded.layer_id
        ",
        params![
            contour.id.to_string(),
            layer_row_id(layer_id),
            contour.closed,
        ],
    )?;
    tx.execute(
        "DELETE FROM glyph_layer_points WHERE contour_id = ?1",
        [contour.id.to_string()],
    )?;

    for point in &contour.points {
        insert_point(tx, &contour.id, point)?;
    }

    Ok(())
}

fn insert_contour(
    tx: &Transaction<'_>,
    layer_id: &font::LayerId,
    order_index: usize,
    contour: &font::ContourValue,
) -> Result<(), StoreError> {
    tx.execute(
        "
        INSERT INTO glyph_layer_contours (id, layer_id, closed, order_index)
        VALUES (?1, ?2, ?3, ?4)
        ",
        params![
            contour.id.to_string(),
            layer_row_id(layer_id),
            contour.closed,
            order_index as i64,
        ],
    )?;

    for point in &contour.points {
        insert_point(tx, &contour.id, point)?;
    }

    Ok(())
}

fn insert_point(
    tx: &Transaction<'_>,
    contour_id: &font::ContourId,
    point: &font::PointValue,
) -> Result<(), StoreError> {
    tx.execute(
        "
        INSERT INTO glyph_layer_points (
            id,
            contour_id,
            order_index,
            x,
            y,
            point_type,
            smooth
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ",
        params![
            point.id.to_string(),
            contour_id.to_string(),
            point.order_index as i64,
            point.x,
            point.y,
            point_type_name(point.point_type),
            point.smooth,
        ],
    )?;
    Ok(())
}

fn insert_anchor(
    tx: &Transaction<'_>,
    layer_id: &font::LayerId,
    anchor: &font::AnchorValue,
) -> Result<(), StoreError> {
    tx.execute(
        "
        INSERT INTO glyph_layer_anchors (
            id,
            layer_id,
            name,
            x,
            y,
            order_index
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ",
        params![
            anchor.id.to_string(),
            layer_row_id(layer_id),
            anchor.name,
            anchor.x,
            anchor.y,
            anchor.order_index as i64,
        ],
    )?;
    Ok(())
}

fn point_type_name(point_type: font::PointType) -> &'static str {
    match point_type {
        font::PointType::OnCurve => "onCurve",
        font::PointType::OffCurve => "offCurve",
        font::PointType::QCurve => "qCurve",
    }
}

fn require_changed(rows_changed: usize, kind: &'static str, id: String) -> Result<(), StoreError> {
    if rows_changed == 0 {
        Err(StoreError::MissingEntity { kind, id })
    } else {
        Ok(())
    }
}

fn require_layer_exists(tx: &Transaction<'_>, layer_id: &font::LayerId) -> Result<(), StoreError> {
    let exists: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM glyph_layers WHERE id = ?1)",
        [layer_row_id(layer_id)],
        |row| row.get(0),
    )?;
    if exists {
        Ok(())
    } else {
        Err(StoreError::MissingEntity {
            kind: "glyph layer",
            id: layer_row_id(layer_id),
        })
    }
}

fn layer_row_id(layer_id: &font::LayerId) -> String {
    layer_id.to_string()
}
