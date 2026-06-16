use rusqlite::{Transaction, params};
use shift_font as font;

use crate::{ShiftStore, StoreError, workspace_state::mark_workspace_dirty_in_tx};

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
        tx.execute("DELETE FROM sources", [])?;
        tx.execute("DELETE FROM axes", [])?;

        upsert_font_info(&tx, font)?;
        replace_feature_text(&tx, font.features().fea_source())?;
        replace_font_guidelines(&tx, font.guidelines())?;
        replace_lib_data(&tx, "font_lib", "key", None, font.lib())?;
        replace_kerning(&tx, font.kerning())?;

        for (order_index, axis) in font.axes().iter().enumerate() {
            insert_axis_with_order(&tx, &font::AxisCreated::from(axis), order_index as i64)?;
        }

        for (order_index, source) in font.sources().iter().enumerate() {
            upsert_source(
                &tx,
                &source.id(),
                Some(source.name()),
                source.filename(),
                order_index as i64,
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
        font::FontChange::AxisCreated(change) => insert_axis_with_order(tx, change, 0),
        font::FontChange::AxisDeleted(change) => {
            // source_locations cascade from the axis row.
            let rows_changed = tx.execute(
                "DELETE FROM axes WHERE id = ?1",
                [change.axis_id.to_string()],
            )?;
            require_changed(rows_changed, "axis", change.axis_id.to_string())?;
            Ok(())
        }
        font::FontChange::SourceCreated(change) => {
            upsert_source(tx, &change.source_id, Some(&change.name), None, 0)?;

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

fn insert_axis_with_order(
    tx: &Transaction<'_>,
    axis: &font::AxisCreated,
    order_index: i64,
) -> Result<(), StoreError> {
    tx.execute(
        "
        INSERT INTO axes (id, tag, name, min_value, default_value, max_value, hidden, order_index)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ",
        params![
            axis.axis_id.to_string(),
            axis.tag,
            axis.name,
            axis.minimum,
            axis.default,
            axis.maximum,
            axis.hidden,
            order_index,
        ],
    )?;
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

fn upsert_source(
    tx: &Transaction<'_>,
    source_id: &font::SourceId,
    name: Option<&str>,
    filename: Option<&str>,
    order_index: i64,
) -> Result<(), StoreError> {
    tx.execute(
        "
        INSERT INTO sources (id, name, filename, kind, order_index)
        VALUES (?1, ?2, ?3, 'master', ?4)
        ON CONFLICT(id) DO UPDATE SET
            name = COALESCE(excluded.name, sources.name),
            filename = excluded.filename,
            order_index = excluded.order_index
        ",
        params![source_id.to_string(), name, filename, order_index],
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
            ascender,
            descender,
            cap_height,
            x_height,
            line_gap,
            italic_angle,
            underline_position,
            underline_thickness,
            default_source_id
        )
        VALUES (
            1, ?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7, ?8, ?9, ?10, ?11, ?12, NULL,
            ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24
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
            ascender = excluded.ascender,
            descender = excluded.descender,
            cap_height = excluded.cap_height,
            x_height = excluded.x_height,
            line_gap = excluded.line_gap,
            italic_angle = excluded.italic_angle,
            underline_position = excluded.underline_position,
            underline_thickness = excluded.underline_thickness,
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
            metrics.ascender,
            metrics.descender,
            metrics.cap_height,
            metrics.x_height,
            metrics.line_gap,
            metrics.italic_angle,
            metrics.underline_position,
            metrics.underline_thickness,
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
            debug_assert_eq!(table, "font_lib");
            tx.execute("DELETE FROM font_lib", [])?;
            for (key, value) in lib.iter() {
                tx.execute(
                    "
                    INSERT INTO font_lib (key, value_json)
                    VALUES (?1, ?2)
                    ",
                    params![key, lib_value_json(value)?],
                )?;
            }
        }
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
