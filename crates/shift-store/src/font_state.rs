use std::collections::HashMap;
use std::str::FromStr;

use rusqlite::params;
use shift_font as font;

use crate::{FontInfo, ShiftStore, StoreError};

impl ShiftStore {
    pub fn load_font_state(&self) -> Result<font::Font, StoreError> {
        let mut font = font::Font::empty();

        if let Some(info) = self.get_font_info()? {
            apply_font_info(&mut font, info);
        }

        *font.features_mut() = load_feature_data(&self.conn)?;
        *font.lib_mut() = load_lib_data(&self.conn, "font_lib", None)?;
        *font.data_files_mut() = load_font_binaries(&self.conn, "data")?;
        *font.images_mut() = load_font_binaries(&self.conn, "image")?;

        for guideline in load_font_guidelines(&self.conn)? {
            font.add_guideline(guideline);
        }

        for axis in load_axes(&self.conn)? {
            font.add_axis(axis);
        }

        for source in load_sources(&self.conn)? {
            font.add_source(source);
        }

        if let Some(default_source_id) = load_default_source_id(&self.conn)? {
            font.set_default_source_id(default_source_id);
        }

        for glyph in load_glyphs(&self.conn)? {
            font.insert_glyph(glyph).map_err(StoreError::from)?;
        }

        *font.kerning_mut() = load_kerning(&self.conn)?;

        Ok(font)
    }
}

fn apply_font_info(font: &mut font::Font, info: FontInfo) {
    font.metadata_mut().family_name = info.family_name;
    font.metadata_mut().style_name = info.style_name;
    font.metadata_mut().copyright = info.copyright;
    font.metadata_mut().trademark = info.trademark;
    font.metadata_mut().description = info.description;
    font.metadata_mut().note = info.note;
    font.metadata_mut().designer = info.designer;
    font.metadata_mut().designer_url = info.designer_url;
    font.metadata_mut().manufacturer = info.manufacturer;
    font.metadata_mut().manufacturer_url = info.manufacturer_url;
    font.metadata_mut().license = info.license_description;
    font.metadata_mut().license_url = info.license_info_url;
    font.metadata_mut().version_major = info.version_major.map(|value| value as i32);
    font.metadata_mut().version_minor = info.version_minor.map(|value| value as i32);

    font.metrics_mut().units_per_em = info.units_per_em;
    font.metrics_mut().ascender = info.ascender;
    font.metrics_mut().descender = info.descender;
    font.metrics_mut().cap_height = info.cap_height;
    font.metrics_mut().x_height = info.x_height;
    font.metrics_mut().line_gap = info.line_gap;
    font.metrics_mut().italic_angle = info.italic_angle;
    font.metrics_mut().underline_position = info.underline_position;
    font.metrics_mut().underline_thickness = info.underline_thickness;
}

fn load_default_source_id(
    conn: &rusqlite::Connection,
) -> Result<Option<font::SourceId>, StoreError> {
    let mut stmt = conn.prepare(
        "
        SELECT default_source_id
        FROM font_info
        WHERE id = 1
        ",
    )?;

    match stmt.query_row([], |row| row.get::<_, Option<String>>(0)) {
        Ok(Some(source_id)) => Ok(Some(font::SourceId::from_raw(source_id))),
        Ok(None) => Ok(None),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(err) => Err(err.into()),
    }
}

fn load_feature_data(conn: &rusqlite::Connection) -> Result<font::FeatureData, StoreError> {
    let mut stmt = conn.prepare(
        "
        SELECT fea_source
        FROM feature_text
        WHERE id = 1
        ",
    )?;

    let fea_source = match stmt.query_row([], |row| row.get::<_, Option<String>>(0)) {
        Ok(source) => source,
        Err(rusqlite::Error::QueryReturnedNoRows) => None,
        Err(err) => return Err(err.into()),
    };

    let mut features = font::FeatureData::new();
    features.set_fea_source(fea_source);
    Ok(features)
}

fn load_axes(conn: &rusqlite::Connection) -> Result<Vec<font::Axis>, StoreError> {
    let mut stmt = conn.prepare(
        "
        SELECT id, tag, name, min_value, default_value, max_value, hidden
        FROM axes
        ORDER BY order_index, id
        ",
    )?;

    let rows = stmt.query_map([], |row| {
        let mut axis = font::Axis::with_id(
            font::AxisId::from_raw(row.get::<_, String>(0)?),
            row.get(1)?,
            row.get(2)?,
            row.get(3)?,
            row.get(4)?,
            row.get(5)?,
        );
        axis.set_hidden(row.get(6)?);
        Ok(axis)
    })?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(StoreError::from)
}

fn load_sources(conn: &rusqlite::Connection) -> Result<Vec<font::Source>, StoreError> {
    let mut stmt = conn.prepare(
        "
        SELECT id, name, filename
        FROM sources
        ORDER BY order_index, id
        ",
    )?;

    let rows = stmt.query_map([], |row| {
        let source_id = font::SourceId::from_raw(row.get::<_, String>(0)?);
        let location = load_source_location(conn, &source_id)?;
        Ok(font::Source::with_id(
            source_id,
            row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            location,
            row.get(2)?,
        ))
    })?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(StoreError::from)
}

fn load_source_location(
    conn: &rusqlite::Connection,
    source_id: &font::SourceId,
) -> rusqlite::Result<font::Location> {
    let mut stmt = conn.prepare(
        "
        SELECT axis_id, value
        FROM source_locations
        WHERE source_id = ?1
        ORDER BY axis_id
        ",
    )?;

    let mut location = font::Location::new();
    let rows = stmt.query_map([source_id.to_string()], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?))
    })?;
    for row in rows {
        let (axis_id, value) = row?;
        location.set(font::AxisId::from_raw(axis_id), value);
    }
    Ok(location)
}

fn load_glyphs(conn: &rusqlite::Connection) -> Result<Vec<font::Glyph>, StoreError> {
    let mut stmt = conn.prepare(
        "
        SELECT id, name
        FROM glyphs
        ORDER BY order_index, id
        ",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok((
            font::GlyphId::from_raw(row.get::<_, String>(0)?),
            row.get::<_, Option<String>>(1)?.unwrap_or_default(),
        ))
    })?;

    let mut glyphs = Vec::new();
    for row in rows {
        let (glyph_id, name) = row?;
        let mut glyph = font::Glyph::with_id(glyph_id.clone(), name);
        glyph.set_unicodes(load_glyph_unicodes(conn, &glyph_id)?);
        *glyph.lib_mut() =
            load_lib_data(conn, "glyph_lib", Some(("glyph_id", &glyph_id.to_string())))?;

        for layer in load_layers_for_glyph(conn, &glyph_id)? {
            glyph.set_layer(layer);
        }

        glyphs.push(glyph);
    }

    Ok(glyphs)
}

fn load_glyph_unicodes(
    conn: &rusqlite::Connection,
    glyph_id: &font::GlyphId,
) -> Result<Vec<u32>, StoreError> {
    let mut stmt = conn.prepare(
        "
        SELECT unicode
        FROM glyph_unicodes
        WHERE glyph_id = ?1
        ORDER BY order_index
        ",
    )?;
    let rows = stmt.query_map([glyph_id.to_string()], |row| row.get::<_, i64>(0))?;
    rows.map(|row| row.map(|value| value as u32))
        .collect::<Result<Vec<_>, _>>()
        .map_err(StoreError::from)
}

fn load_layers_for_glyph(
    conn: &rusqlite::Connection,
    glyph_id: &font::GlyphId,
) -> Result<Vec<font::GlyphLayer>, StoreError> {
    let mut stmt = conn.prepare(
        "
        SELECT id, source_id, width, height
        FROM glyph_layers
        WHERE glyph_id = ?1
        ORDER BY id
        ",
    )?;

    let rows = stmt.query_map([glyph_id.to_string()], |row| {
        Ok((
            font::LayerId::from_raw(row.get::<_, String>(0)?),
            font::SourceId::from_raw(row.get::<_, String>(1)?),
            row.get::<_, f64>(2)?,
            row.get::<_, Option<f64>>(3)?,
        ))
    })?;

    let mut layers = Vec::new();
    for row in rows {
        let (layer_id, source_id, width, height) = row?;
        let mut layer = font::GlyphLayer::with_width(layer_id.clone(), source_id, width);
        layer.set_height(height);

        for contour in load_contours_for_layer(conn, &layer_id)? {
            layer.add_contour(contour);
        }
        for component in load_components_for_layer(conn, &layer_id)? {
            layer.add_component(component);
        }
        for anchor in load_anchors_for_layer(conn, &layer_id)? {
            layer.add_anchor(anchor);
        }
        for guideline in load_layer_guidelines(conn, &layer_id)? {
            layer.add_guideline(guideline);
        }
        *layer.lib_mut() = load_lib_data(
            conn,
            "glyph_layer_lib",
            Some(("layer_id", &layer_id.to_string())),
        )?;

        layers.push(layer);
    }

    Ok(layers)
}

fn load_contours_for_layer(
    conn: &rusqlite::Connection,
    layer_id: &font::LayerId,
) -> Result<Vec<font::Contour>, StoreError> {
    let mut stmt = conn.prepare(
        "
        SELECT id, closed
        FROM glyph_layer_contours
        WHERE layer_id = ?1
        ORDER BY order_index
        ",
    )?;

    let rows = stmt.query_map([layer_id.to_string()], |row| {
        Ok((
            font::ContourId::from_raw(row.get::<_, String>(0)?),
            row.get::<_, bool>(1)?,
        ))
    })?;

    let mut contours = Vec::new();
    for row in rows {
        let (contour_id, closed) = row?;
        let mut contour = font::Contour::with_id(contour_id.clone());
        for point in load_points_for_contour(conn, &contour_id)? {
            contour.push_point(point);
        }
        if closed {
            contour.close();
        }
        contours.push(contour);
    }

    Ok(contours)
}

fn load_points_for_contour(
    conn: &rusqlite::Connection,
    contour_id: &font::ContourId,
) -> Result<Vec<font::Point>, StoreError> {
    let mut stmt = conn.prepare(
        "
        SELECT id, x, y, point_type, smooth
        FROM glyph_layer_points
        WHERE contour_id = ?1
        ORDER BY order_index
        ",
    )?;

    let rows = stmt.query_map([contour_id.to_string()], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, f64>(1)?,
            row.get::<_, f64>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, bool>(4)?,
        ))
    })?;

    let mut points = Vec::new();
    for row in rows {
        let (id, x, y, point_type, smooth) = row?;
        let point_type =
            font::PointType::from_str(&point_type).map_err(StoreError::InvalidPointType)?;
        points.push(font::Point::new(
            font::PointId::from_raw(id),
            x,
            y,
            point_type,
            smooth,
        ));
    }
    Ok(points)
}

fn load_components_for_layer(
    conn: &rusqlite::Connection,
    layer_id: &font::LayerId,
) -> Result<Vec<font::Component>, StoreError> {
    let mut stmt = conn.prepare(
        "
        SELECT
            id,
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
            t_center_y
        FROM glyph_components
        WHERE layer_id = ?1
        ORDER BY order_index, id
        ",
    )?;

    let rows = stmt.query_map([layer_id.to_string()], |row| {
        Ok(font::Component::with_id(
            font::ComponentId::from_raw(row.get::<_, String>(0)?),
            font::GlyphId::from_raw(row.get::<_, String>(1)?),
            row.get::<_, String>(2)?,
            font::DecomposedTransform {
                translate_x: row.get(3)?,
                translate_y: row.get(4)?,
                rotation: row.get(5)?,
                scale_x: row.get(6)?,
                scale_y: row.get(7)?,
                skew_x: row.get(8)?,
                skew_y: row.get(9)?,
                t_center_x: row.get(10)?,
                t_center_y: row.get(11)?,
            },
        ))
    })?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(StoreError::from)
}

fn load_anchors_for_layer(
    conn: &rusqlite::Connection,
    layer_id: &font::LayerId,
) -> Result<Vec<font::Anchor>, StoreError> {
    let mut stmt = conn.prepare(
        "
        SELECT id, name, x, y
        FROM glyph_layer_anchors
        WHERE layer_id = ?1
        ORDER BY order_index
        ",
    )?;

    let rows = stmt.query_map([layer_id.to_string()], |row| {
        Ok(font::Anchor::with_id(
            font::AnchorId::from_raw(row.get::<_, String>(0)?),
            row.get::<_, Option<String>>(1)?,
            row.get(2)?,
            row.get(3)?,
        ))
    })?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(StoreError::from)
}

fn load_font_guidelines(conn: &rusqlite::Connection) -> Result<Vec<font::Guideline>, StoreError> {
    let mut stmt = conn.prepare(
        "
        SELECT id, x, y, angle, name, color
        FROM font_guidelines
        ORDER BY order_index
        ",
    )?;
    let rows = stmt.query_map([], map_guideline_row)?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(StoreError::from)
}

fn load_layer_guidelines(
    conn: &rusqlite::Connection,
    layer_id: &font::LayerId,
) -> Result<Vec<font::Guideline>, StoreError> {
    let mut stmt = conn.prepare(
        "
        SELECT id, x, y, angle, name, color
        FROM glyph_layer_guidelines
        WHERE layer_id = ?1
        ORDER BY order_index
        ",
    )?;
    let rows = stmt.query_map([layer_id.to_string()], map_guideline_row)?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(StoreError::from)
}

fn map_guideline_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<font::Guideline> {
    Ok(font::Guideline::with_id(
        font::GuidelineId::from_raw(row.get::<_, String>(0)?),
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
        row.get(5)?,
    ))
}

fn load_kerning(conn: &rusqlite::Connection) -> Result<font::KerningData, StoreError> {
    let mut kerning = font::KerningData::new();
    for (name, members) in load_kerning_groups(conn, 1)? {
        kerning.set_group1(name, members);
    }
    for (name, members) in load_kerning_groups(conn, 2)? {
        kerning.set_group2(name, members);
    }

    let mut stmt = conn.prepare(
        "
        SELECT first_kind, first_value, second_kind, second_value, value
        FROM kerning_pairs
        ORDER BY order_index
        ",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, f64>(4)?,
        ))
    })?;
    for row in rows {
        let (first_kind, first_value, second_kind, second_value, value) = row?;
        kerning.add_pair(font::KerningPair::new(
            kerning_side(&first_kind, first_value),
            kerning_side(&second_kind, second_value),
            value,
        ));
    }

    Ok(kerning)
}

fn load_kerning_groups(
    conn: &rusqlite::Connection,
    side: i64,
) -> Result<Vec<(String, Vec<font::GlyphName>)>, StoreError> {
    let mut stmt = conn.prepare(
        "
        SELECT name
        FROM kerning_groups
        WHERE side = ?1
        ORDER BY name
        ",
    )?;
    let group_names = stmt
        .query_map([side], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;

    let mut groups = Vec::new();
    for group_name in group_names {
        let mut member_stmt = conn.prepare(
            "
            SELECT glyph_name
            FROM kerning_group_members
            WHERE side = ?1 AND group_name = ?2
            ORDER BY order_index
            ",
        )?;
        let members = member_stmt
            .query_map(params![side, group_name], |row| {
                Ok(font::GlyphName::from(row.get::<_, String>(0)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        groups.push((group_name, members));
    }
    Ok(groups)
}

fn kerning_side(kind: &str, value: String) -> font::KerningSide {
    match kind {
        "glyph" => font::KerningSide::Glyph(value.into()),
        "group" => font::KerningSide::Group(value),
        _ => font::KerningSide::Group(value),
    }
}

fn load_lib_data(
    conn: &rusqlite::Connection,
    table: &'static str,
    owner: Option<(&'static str, &str)>,
) -> Result<font::LibData, StoreError> {
    let mut values = HashMap::new();
    match owner {
        Some((owner_column, owner_id)) => {
            let sql = format!("SELECT key, value_json FROM {table} WHERE {owner_column} = ?1");
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map([owner_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?;
            for row in rows {
                let (key, value_json) = row?;
                values.insert(key, lib_value_from_json(&value_json)?);
            }
        }
        None => {
            let sql = format!("SELECT key, value_json FROM {table}");
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?;
            for row in rows {
                let (key, value_json) = row?;
                values.insert(key, lib_value_from_json(&value_json)?);
            }
        }
    }
    Ok(font::LibData::from_map(values))
}

fn load_font_binaries(
    conn: &rusqlite::Connection,
    kind: &str,
) -> Result<font::BinaryData, StoreError> {
    let mut binaries = font::BinaryData::new();
    let mut stmt = conn.prepare(
        "
        SELECT path, bytes
        FROM font_binaries
        WHERE kind = ?1
        ",
    )?;
    let rows = stmt.query_map([kind], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))
    })?;
    for row in rows {
        let (path, bytes) = row?;
        binaries.insert(path, bytes);
    }
    Ok(binaries)
}

fn lib_value_from_json(value_json: &str) -> Result<font::LibValue, StoreError> {
    let value: serde_json::Value = serde_json::from_str(value_json)?;
    lib_value_from_value(value)
}

fn lib_value_from_value(value: serde_json::Value) -> Result<font::LibValue, StoreError> {
    let serde_json::Value::Object(mut object) = value else {
        return Err(StoreError::InvalidLibValue("expected object".to_string()));
    };
    let Some(serde_json::Value::String(kind)) = object.remove("type") else {
        return Err(StoreError::InvalidLibValue("missing type".to_string()));
    };
    let value = object
        .remove("value")
        .ok_or_else(|| StoreError::InvalidLibValue("missing value".to_string()))?;

    match kind.as_str() {
        "string" => match value {
            serde_json::Value::String(value) => Ok(font::LibValue::String(value)),
            _ => Err(StoreError::InvalidLibValue("expected string".to_string())),
        },
        "integer" => value
            .as_i64()
            .map(font::LibValue::Integer)
            .ok_or_else(|| StoreError::InvalidLibValue("expected integer".to_string())),
        "unsignedInteger" => value
            .as_u64()
            .map(font::LibValue::UnsignedInteger)
            .ok_or_else(|| StoreError::InvalidLibValue("expected unsigned integer".to_string())),
        "float" => value
            .as_f64()
            .map(font::LibValue::Float)
            .ok_or_else(|| StoreError::InvalidLibValue("expected float".to_string())),
        "boolean" => value
            .as_bool()
            .map(font::LibValue::Boolean)
            .ok_or_else(|| StoreError::InvalidLibValue("expected boolean".to_string())),
        "array" => match value {
            serde_json::Value::Array(values) => values
                .into_iter()
                .map(lib_value_from_value)
                .collect::<Result<Vec<_>, _>>()
                .map(font::LibValue::Array),
            _ => Err(StoreError::InvalidLibValue("expected array".to_string())),
        },
        "dict" => match value {
            serde_json::Value::Object(values) => values
                .into_iter()
                .map(|(key, value)| lib_value_from_value(value).map(|value| (key, value)))
                .collect::<Result<HashMap<_, _>, _>>()
                .map(font::LibValue::Dict),
            _ => Err(StoreError::InvalidLibValue("expected dict".to_string())),
        },
        "data" => match value {
            serde_json::Value::Array(values) => values
                .into_iter()
                .map(|value| {
                    let byte = value.as_u64().ok_or_else(|| {
                        StoreError::InvalidLibValue("expected data byte".to_string())
                    })?;
                    u8::try_from(byte).map_err(|_| {
                        StoreError::InvalidLibValue("data byte out of range".to_string())
                    })
                })
                .collect::<Result<Vec<_>, _>>()
                .map(font::LibValue::Data),
            _ => Err(StoreError::InvalidLibValue("expected data".to_string())),
        },
        "date" => match value {
            serde_json::Value::String(value) => Ok(font::LibValue::Date(value)),
            _ => Err(StoreError::InvalidLibValue("expected date".to_string())),
        },
        "uid" => value
            .as_u64()
            .map(font::LibValue::Uid)
            .ok_or_else(|| StoreError::InvalidLibValue("expected uid".to_string())),
        _ => Err(StoreError::InvalidLibValue(format!("unknown type {kind}"))),
    }
}
