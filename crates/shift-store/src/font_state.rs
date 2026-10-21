use crate::error::{OrMissing, StoreEntity};
use std::collections::{BTreeMap, HashMap};

use rusqlite::OptionalExtension;
use shift_font as font;

use crate::{
    FontInfo, ShiftStore, StoreError,
    columns::{AxisRoleColumn, KerningPositionColumn, KerningSideColumns, MetricKindColumn},
    source::SourceKind,
};

impl ShiftStore {
    /// Materializes the complete font. Use only for export/save boundaries;
    /// interactive open should use [`Self::load_font_directory`].
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::Sqlite`] when a record cannot be read, a decoding error such as
    /// [`StoreError::LayerDecoding`] when a layer payload is invalid, and [`StoreError::Font`] when
    /// the records do not form a valid font.
    pub fn load_font_state(&self) -> Result<font::Font, StoreError> {
        self.load_font(true)
    }

    /// Loads eager font metadata and the glyph/layer directory without
    /// reading any layer payload BLOB.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::Sqlite`] when a record cannot be read, and [`StoreError::Font`] when
    /// the records do not form a valid font.
    pub fn load_font_directory(&self) -> Result<font::Font, StoreError> {
        self.load_font(false)
    }

    fn load_font(&self, include_layer_payloads: bool) -> Result<font::Font, StoreError> {
        let mut font = font::Font::empty();

        if let Some(info) = self.get_font_info()? {
            apply_font_info(&mut font, info)?;
        }

        let metric_definitions = load_metric_definitions(&self.conn)?;
        if !metric_definitions.is_empty() {
            font.set_metric_definitions(metric_definitions)?;
        }

        *font.features_mut() = load_feature_data(&self.conn)?;
        *font.lib_mut() = load_lib_data(&self.conn, "font_lib", None)?;
        *font.fontinfo_remainder_mut() = load_lib_data(&self.conn, "fontinfo_remainder", None)?;
        *font.data_files_mut() = load_font_binaries(&self.conn, "data")?;
        *font.images_mut() = load_font_binaries(&self.conn, "image")?;

        for guideline in load_font_guidelines(&self.conn)? {
            font.add_guideline(guideline);
        }

        for axis in load_axes(&self.conn)? {
            font.add_axis(axis)?;
        }
        font.set_axis_mappings(load_axis_mappings(&self.conn)?)?;
        font.set_named_instances(load_named_instances(&self.conn)?)?;

        for source in load_sources(&self.conn)? {
            font.add_source(source);
        }

        if let Some(default_source_id) = load_default_source_id(&self.conn)? {
            font.set_default_source_id(default_source_id);
        }

        for glyph in load_glyphs(&self.conn, include_layer_payloads)? {
            font.insert_glyph(glyph)?;
        }

        *font.kerning_mut() = load_kerning(&self.conn)?;

        Ok(font)
    }
}

fn apply_font_info(font: &mut font::Font, info: FontInfo) -> Result<(), StoreError> {
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
    font.metadata_mut().version_major = info.version_major.map(i32::try_from).transpose()?;
    font.metadata_mut().version_minor = info.version_minor.map(i32::try_from).transpose()?;

    font.metrics_mut().units_per_em = info.units_per_em;
    Ok(())
}

fn load_metric_definitions(
    conn: &rusqlite::Connection,
) -> Result<Vec<font::MetricDefinition>, StoreError> {
    let mut stmt =
        conn.prepare("SELECT id, kind, name FROM metric_definitions ORDER BY order_index, id")?;
    let rows = stmt.query_map([], |row| {
        let MetricKindColumn(kind) = row.get(1)?;
        Ok(font::MetricDefinition::with_id(
            row.get::<_, font::MetricId>(0)?,
            kind,
            row.get(2)?,
        ))
    })?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(StoreError::from)
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

    let source_id = stmt
        .query_row([], |row| row.get::<_, Option<String>>(0))
        .optional()?
        .flatten();
    Ok(source_id.map(font::SourceId::from_raw))
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
        SELECT id, tag, name, min_value, default_value, max_value, role,
               discrete_values_json, labels_json, hidden
        FROM axes
        ORDER BY order_index, id
        ",
    )?;

    let rows = stmt.query_map([], |row| {
        let axis_id = row.get::<_, font::AxisId>(0)?;
        let tag = row.get(1)?;
        let name = row.get(2)?;
        let default = row.get(4)?;
        let values_json = row.get::<_, Option<String>>(7)?;
        let mut axis = if let Some(values_json) = values_json {
            let values = serde_json::from_str(&values_json).map_err(json_column_error)?;
            font::Axis::discrete_with_id(axis_id, tag, name, values, default)
        } else {
            font::Axis::continuous_with_id(axis_id, tag, name, row.get(3)?, default, row.get(5)?)
        };
        axis.set_role(row.get::<_, AxisRoleColumn>(6)?.0);
        let labels_json = row.get::<_, String>(8)?;
        axis.set_labels(serde_json::from_str(&labels_json).map_err(json_column_error)?);
        axis.set_hidden(row.get(9)?);
        Ok(axis)
    })?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(StoreError::from)
}

fn load_axis_mappings(conn: &rusqlite::Connection) -> Result<Vec<font::AxisMapping>, StoreError> {
    let mut stmt =
        conn.prepare("SELECT mapping_json FROM axis_mappings ORDER BY order_index, id")?;
    let rows = stmt.query_map([], |row| {
        let json = row.get::<_, String>(0)?;
        serde_json::from_str(&json).map_err(json_column_error)
    })?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(StoreError::from)
}

fn load_named_instances(
    conn: &rusqlite::Connection,
) -> Result<Vec<font::NamedInstance>, StoreError> {
    let mut stmt =
        conn.prepare("SELECT instance_json FROM named_instances ORDER BY order_index, id")?;
    let rows = stmt.query_map([], |row| {
        let json = row.get::<_, String>(0)?;
        serde_json::from_str(&json).map_err(json_column_error)
    })?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(StoreError::from)
}

fn json_column_error(error: serde_json::Error) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}

fn load_sources(conn: &rusqlite::Connection) -> Result<Vec<font::Source>, StoreError> {
    let mut stmt = conn.prepare(
        "
        SELECT id, name, filename, color, kind, layer_name,
               italic_angle, line_gap, underline_position, underline_thickness
        FROM sources
        ORDER BY order_index, id
        ",
    )?;

    let rows = stmt.query_map([], |row| {
        let source_id = row.get::<_, font::SourceId>(0)?;
        let location = load_source_location(conn, &source_id)?;
        let mut source = font::Source::with_id(
            source_id,
            row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            location,
            row.get(2)?,
        );
        source.set_color(row.get(3)?);

        let kind: SourceKind = row.get(4)?;
        source.set_role(kind.into());
        source.set_layer_name(row.get(5)?);
        source.set_italic_angle(row.get(6)?);
        source.set_line_gap(row.get(7)?);
        source.set_underline_position(row.get(8)?);
        source.set_underline_thickness(row.get(9)?);
        source.set_metric_values(load_source_metric_values(conn, &source.id())?);
        Ok(source)
    })?;

    let mut sources = rows.collect::<Result<Vec<_>, _>>()?;

    for source in &mut sources {
        *source.lib_mut() = load_lib_data(
            conn,
            "source_lib",
            Some(("source_id", source.id().as_str())),
        )?;
    }

    Ok(sources)
}

fn load_source_metric_values(
    conn: &rusqlite::Connection,
    source_id: &font::SourceId,
) -> rusqlite::Result<BTreeMap<font::MetricId, font::MetricValue>> {
    let mut stmt = conn.prepare(
        "
        SELECT metric_id, position, overshoot
        FROM source_metric_values
        WHERE source_id = ?1
        ORDER BY metric_id
        ",
    )?;
    let rows = stmt.query_map([&source_id], |row| {
        Ok((
            row.get::<_, font::MetricId>(0)?,
            font::MetricValue::new(row.get(1)?, row.get(2)?),
        ))
    })?;

    rows.collect()
}

fn load_source_location(
    conn: &rusqlite::Connection,
    source_id: &font::SourceId,
) -> rusqlite::Result<font::DesignLocation> {
    let mut stmt = conn.prepare(
        "
        SELECT axis_id, value
        FROM source_locations
        WHERE source_id = ?1
        ORDER BY axis_id
        ",
    )?;

    let mut location = font::DesignLocation::new();
    let rows = stmt.query_map([&source_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?))
    })?;
    for row in rows {
        let (axis_id, value) = row?;
        location.set(font::AxisId::from_raw(axis_id), value);
    }
    Ok(location)
}

fn load_glyphs(
    conn: &rusqlite::Connection,
    include_layer_payloads: bool,
) -> Result<Vec<font::Glyph>, StoreError> {
    let glyph_rows = {
        let mut stmt = conn.prepare(
            "SELECT id, name, category, sub_category FROM glyphs ORDER BY order_index, id",
        )?;
        stmt.query_map([], |row| {
            Ok((
                row.get::<_, font::GlyphId>(0)?,
                row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?
    };

    let mut unicodes: HashMap<font::GlyphId, Vec<(i64, u32)>> = HashMap::new();
    {
        let mut stmt = conn.prepare(
            "SELECT glyph_id, unicode, order_index FROM glyph_unicodes ORDER BY glyph_id, order_index",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, font::GlyphId>(0)?,
                row.get::<_, u32>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })?;
        for row in rows {
            let (glyph_id, unicode, order_index) = row?;
            unicodes
                .entry(glyph_id)
                .or_default()
                .push((order_index, unicode));
        }
    }

    let mut libs: HashMap<font::GlyphId, HashMap<String, font::LibValue>> = HashMap::new();
    {
        let mut stmt = conn.prepare("SELECT glyph_id, key, value_json FROM glyph_lib")?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, font::GlyphId>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?;
        for row in rows {
            let (glyph_id, key, value_json) = row?;
            libs.entry(glyph_id)
                .or_default()
                .insert(key, lib_value_from_json(&value_json)?);
        }
    }

    let layer_rows = {
        let mut stmt = conn.prepare(
            "
            SELECT id, glyph_id, source_id, width, height
            FROM glyph_layers
            ORDER BY glyph_id, source_id, id
            ",
        )?;
        stmt.query_map([], |row| {
            Ok((
                row.get::<_, font::LayerId>(0)?,
                row.get::<_, font::GlyphId>(1)?,
                row.get::<_, font::SourceId>(2)?,
                row.get::<_, f64>(3)?,
                row.get::<_, Option<f64>>(4)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?
    };
    let mut loaded_layers = HashMap::new();
    if include_layer_payloads {
        let layer_ids = layer_rows
            .iter()
            .map(|(layer_id, _, _, _, _)| layer_id.clone())
            .collect::<Vec<_>>();
        for layer in crate::layer::load_glyph_layers_from_conn(conn, &layer_ids)? {
            loaded_layers.insert(layer.id(), layer);
        }
    }

    let mut layers: HashMap<font::GlyphId, Vec<font::GlyphLayer>> = HashMap::new();
    for (layer_id, glyph_id, source_id, width, height) in layer_rows {
        let layer = if include_layer_payloads {
            loaded_layers
                .remove(&layer_id)
                .or_missing(StoreEntity::GlyphLayerPayload, &layer_id)?
        } else {
            let mut layer = font::GlyphLayer::with_width(layer_id, source_id, width);
            layer.set_height(height);
            layer
        };
        layers.entry(glyph_id).or_default().push(layer);
    }

    let mut glyphs = Vec::with_capacity(glyph_rows.len());
    for (glyph_id, name, category, sub_category) in glyph_rows {
        let mut glyph = font::Glyph::with_id(glyph_id.clone(), name);
        // A name a later Shift wrote but this one does not know reads as unset.
        glyph.set_category(category.and_then(|category| category.parse().ok()));
        glyph.set_sub_category(sub_category.and_then(|sub_category| sub_category.parse().ok()));
        let mut glyph_unicodes = unicodes.remove(&glyph_id).unwrap_or_default();
        glyph_unicodes.sort_by_key(|(order_index, _)| *order_index);
        glyph.set_unicodes(
            glyph_unicodes
                .into_iter()
                .map(|(_, unicode)| unicode)
                .collect(),
        );
        *glyph.lib_mut() = font::LibData::from_map(libs.remove(&glyph_id).unwrap_or_default());
        for layer in layers.remove(&glyph_id).unwrap_or_default() {
            glyph.set_layer(layer);
        }
        glyphs.push(glyph);
    }
    Ok(glyphs)
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

fn map_guideline_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<font::Guideline> {
    Ok(font::Guideline::with_id(
        row.get::<_, font::GuidelineId>(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
        row.get(5)?,
    ))
}

fn load_kerning(conn: &rusqlite::Connection) -> Result<font::Kerning, StoreError> {
    let mut kerning = font::Kerning::new();
    for (group_id, group) in load_kerning_groups(conn)? {
        kerning.set_group(group_id, group)?;
    }

    let mut stmt = conn.prepare(
        "
        SELECT source_id, first_kind, first_value, second_kind, second_value, value
        FROM kerning_pairs
        ",
    )?;
    for row in stmt.query_map([], KerningPairRow::read)? {
        let row = row?;
        let pair = font::KerningPair::new(
            KerningSideColumns::read(&row.first_kind, row.first_value)?,
            KerningSideColumns::read(&row.second_kind, row.second_value)?,
        );
        kerning.set_value(row.source_id, pair, row.value);
    }

    Ok(kerning)
}

/// One `kerning_pairs` row.
struct KerningPairRow {
    source_id: font::SourceId,
    first_kind: String,
    first_value: String,
    second_kind: String,
    second_value: String,
    value: f64,
}

impl KerningPairRow {
    fn read(row: &rusqlite::Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            source_id: row.get("source_id")?,
            first_kind: row.get("first_kind")?,
            first_value: row.get("first_value")?,
            second_kind: row.get("second_kind")?,
            second_value: row.get("second_value")?,
            value: row.get("value")?,
        })
    }
}

fn load_kerning_groups(
    conn: &rusqlite::Connection,
) -> Result<Vec<(font::KerningGroupId, font::KerningGroup)>, StoreError> {
    let mut stmt = conn.prepare(
        "
        SELECT id, position, name
        FROM kerning_groups
        ORDER BY id
        ",
    )?;
    let group_rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, KerningPositionColumn>(1)?.0,
                row.get::<_, String>(2)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut member_stmt = conn.prepare(
        "
        SELECT glyph_id
        FROM kerning_group_members
        WHERE group_id = ?1
        ORDER BY order_index
        ",
    )?;
    group_rows
        .into_iter()
        .map(|(group_id, position, name)| {
            let members = member_stmt
                .query_map([&group_id], |row| row.get::<_, font::GlyphId>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            Ok((
                font::KerningGroupId::from_raw(group_id),
                font::KerningGroup::new(position, name, members),
            ))
        })
        .collect()
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
                .collect::<Result<BTreeMap<_, _>, _>>()
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
