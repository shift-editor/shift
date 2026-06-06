use rusqlite::{Transaction, params};
use shift_font as font;

use crate::{ShiftStore, StoreError};

impl ShiftStore {
    pub fn apply_change_set(&mut self, change_set: &font::FontChangeSet) -> Result<(), StoreError> {
        let tx = self.conn.transaction()?;

        for change in &change_set.changes {
            apply_change(&tx, change)?;
        }

        tx.commit()?;
        Ok(())
    }

    pub fn replace_font_state(&mut self, font: &font::Font) -> Result<(), StoreError> {
        let tx = self.conn.transaction()?;

        tx.execute("DELETE FROM glyph_layer_points", [])?;
        tx.execute("DELETE FROM glyph_layer_contours", [])?;
        tx.execute("DELETE FROM glyph_components", [])?;
        tx.execute("DELETE FROM glyph_layers", [])?;
        tx.execute("DELETE FROM glyph_unicodes", [])?;
        tx.execute("DELETE FROM glyphs", [])?;
        tx.execute("DELETE FROM source_locations", [])?;
        tx.execute("DELETE FROM sources", [])?;
        tx.execute("DELETE FROM axes", [])?;

        for source in font.sources() {
            upsert_source(&tx, source.id(), Some(source.name()))?;
        }

        for glyph in font.glyphs() {
            upsert_glyph(&tx, glyph.id(), glyph.glyph_name())?;
            replace_glyph_unicodes(&tx, glyph.id(), glyph.unicodes())?;

            for layer in glyph.layers().values().map(|layer| layer.as_ref()) {
                upsert_layer(
                    &tx,
                    layer.id(),
                    glyph.id(),
                    layer.source_id(),
                    Some(glyph.glyph_name()),
                    layer.width(),
                    layer.height(),
                )?;
                replace_layer_geometry(&tx, layer.id(), &font::GlyphLayerValue::from(layer))?;
            }
        }

        tx.commit()?;
        Ok(())
    }
}

fn apply_change(tx: &Transaction<'_>, change: &font::FontChange) -> Result<(), StoreError> {
    match change {
        font::FontChange::GlyphCreated(change) => {
            upsert_glyph(tx, change.glyph_id, &change.name)?;
            replace_glyph_unicodes(tx, change.glyph_id, &change.unicodes)
        }
        font::FontChange::GlyphIdentityChanged(change) => {
            upsert_glyph(tx, change.glyph_id, &change.to_name)?;
            replace_glyph_unicodes(tx, change.glyph_id, &change.to_unicodes)
        }
        font::FontChange::GlyphLayerCreated(change) => upsert_layer(
            tx,
            change.layer_id,
            change.glyph_id,
            change.source_id,
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
                params![layer_row_id(change.layer_id), change.width, change.height,],
            )?;
            require_changed(rows_changed, "glyph layer", layer_row_id(change.layer_id))?;
            Ok(())
        }
        font::FontChange::ContourAdded(change) => {
            require_layer_exists(tx, change.layer_id)?;
            replace_contour(tx, change.layer_id, &change.contour)
        }
        font::FontChange::ContourOpenClosedChanged(change) => {
            require_layer_exists(tx, change.layer_id)?;
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
            require_layer_exists(tx, change.layer_id)?;
            replace_contour(tx, change.layer_id, &change.contour)
        }
        font::FontChange::PointsDeleted(change) => {
            require_layer_exists(tx, change.layer_id)?;
            replace_contour(tx, change.layer_id, &change.contour)
        }
        font::FontChange::PointSmoothChanged(change) => {
            require_layer_exists(tx, change.layer_id)?;
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
            require_layer_exists(tx, change.layer_id)?;
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
        font::FontChange::LayerGeometryReplaced(change) => {
            require_layer_exists(tx, change.layer_id)?;
            replace_layer_geometry(tx, change.layer_id, &change.layer)
        }
    }
}

fn upsert_source(
    tx: &Transaction<'_>,
    source_id: font::SourceId,
    name: Option<&str>,
) -> Result<(), StoreError> {
    tx.execute(
        "
        INSERT INTO sources (id, name, kind)
        VALUES (?1, ?2, 'master')
        ON CONFLICT(id) DO UPDATE SET
            name = COALESCE(excluded.name, sources.name)
        ",
        params![source_id.to_string(), name],
    )?;
    Ok(())
}

fn upsert_glyph(
    tx: &Transaction<'_>,
    glyph_id: font::GlyphId,
    name: &font::GlyphName,
) -> Result<(), StoreError> {
    tx.execute(
        "
        INSERT INTO glyphs (id, name)
        VALUES (?1, ?2)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name
        ",
        params![glyph_id.to_string(), name.as_str()],
    )?;
    Ok(())
}

fn replace_glyph_unicodes(
    tx: &Transaction<'_>,
    glyph_id: font::GlyphId,
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
    layer_id: font::LayerId,
    glyph_id: font::GlyphId,
    source_id: font::SourceId,
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
    layer_id: font::LayerId,
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

    Ok(())
}

fn replace_contour(
    tx: &Transaction<'_>,
    layer_id: font::LayerId,
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
        insert_point(tx, contour.id, point)?;
    }

    Ok(())
}

fn insert_contour(
    tx: &Transaction<'_>,
    layer_id: font::LayerId,
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
        insert_point(tx, contour.id, point)?;
    }

    Ok(())
}

fn insert_point(
    tx: &Transaction<'_>,
    contour_id: font::ContourId,
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

fn require_layer_exists(tx: &Transaction<'_>, layer_id: font::LayerId) -> Result<(), StoreError> {
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

fn layer_row_id(layer_id: font::LayerId) -> String {
    layer_id.to_string()
}
