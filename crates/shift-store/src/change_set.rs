use crate::error::{OrMissing, StoreEntity};
use crate::numeric::sql_int;
use std::collections::HashSet;

use rusqlite::{OptionalExtension, Transaction, params};
use shift_font as font;

use crate::{
    ShiftStore, StoreError,
    columns::{AxisRoleColumn, KerningPositionColumn, KerningSideColumns, MetricKindColumn},
    layer::write_layer_in_tx,
    source::SourceKind,
    workspace_state::{SaveState, mark_workspace_changed_in_tx},
    write_mode::WriteMode,
};

impl ShiftStore {
    /// Persists a change set whose layer changes carry their payloads.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::RecoveryRequiresPostFont`] in a recovered document, which needs
    /// [`Self::apply_change_set_with_font`]; [`StoreError::DocumentRequiresRecoveryOverlay`] in a
    /// document opened without one; and [`StoreError::Sqlite`] or a layer-encoding error when the
    /// write fails. Nothing is written on failure.
    pub fn apply_change_set(&mut self, change_set: &font::FontChangeSet) -> Result<(), StoreError> {
        self.apply_change_set_inner(change_set, None, SaveState::Unsaved)
    }

    /// Applies relational changes and takes touched layer payloads from the
    /// committed post-edit font. This preserves complete clone/materialize
    /// results even when a compact change record only carries directory facts.
    ///
    /// In a document, [`SaveState::MatchesSaved`] discards the recovery
    /// overlay instead of writing the change: the document is back to what is
    /// saved, so there is no unsaved work left to keep.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::DocumentRequiresRecoveryOverlay`] in a document opened without a
    /// recovery overlay, and [`StoreError::Sqlite`] or a layer-encoding error when the write fails.
    /// Nothing is written on failure.
    pub fn apply_change_set_with_font(
        &mut self,
        change_set: &font::FontChangeSet,
        post_font: &font::Font,
        save_state: SaveState,
    ) -> Result<(), StoreError> {
        self.apply_change_set_inner(change_set, Some(post_font), save_state)
    }

    fn apply_change_set_inner(
        &mut self,
        change_set: &font::FontChangeSet,
        post_font: Option<&font::Font>,
        save_state: SaveState,
    ) -> Result<(), StoreError> {
        if self.recovery.is_some() && save_state == SaveState::MatchesSaved {
            self.discard_recovery()?;
            return Ok(());
        }

        let changes_font_info = change_set.changes.iter().any(|change| {
            matches!(
                change,
                font::FontChange::Metadata(_) | font::FontChange::Sources(_)
            )
        });
        let preserved_font_info = (self.recovery.is_some() && changes_font_info)
            .then(|| self.get_font_info())
            .transpose()?
            .flatten();

        if let Some(post_font) = post_font {
            validate_glyph_order(&self.conn, change_set, post_font)?;
        }

        if let Some(recovery) = self.recovery.as_mut() {
            let post_font = post_font.ok_or(StoreError::RecoveryRequiresPostFont)?;
            return recovery.apply_change_set(change_set, post_font, preserved_font_info.as_ref());
        }
        if self.kind == crate::store::StoreKind::Document {
            return Err(StoreError::DocumentRequiresRecoveryOverlay);
        }

        let tracks_workspace = self.tracks_workspace();
        let tx = self.conn.transaction()?;
        let writer = StoreWriter::new(&tx);
        for priority in 0..=10 {
            for change in &change_set.changes {
                if change_priority(change) == priority {
                    writer.apply_change(change)?;
                }
            }
            // A glyph is in one group per position, so every changed group's
            // old rows go before any new ones: a glyph moving between groups
            // never sits in both.
            if priority == KERNING_GROUP_PRIORITY {
                for (group_id, group) in kerning_groups_after(change_set) {
                    writer.insert_kerning_group(group_id, group)?;
                }
            }
        }
        if tracks_workspace {
            mark_workspace_changed_in_tx(&tx, save_state)?;
        }

        tx.commit()?;
        Ok(())
    }

    /// Replaces every stored record with `font`'s in one transaction.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::Sqlite`] or a layer-encoding error when the write fails; nothing is
    /// written on failure.
    pub fn replace_font_state(&mut self, font: &font::Font) -> Result<(), StoreError> {
        let tx = self.conn.transaction()?;
        let writer = StoreWriter::new(&tx);
        writer.replace_font_header(font)?;

        for (order_index, glyph) in font.glyphs().enumerate() {
            writer.write_glyph(glyph, sql_int(order_index))?;
        }

        tx.commit()?;
        Ok(())
    }
}

fn validate_glyph_order(
    conn: &rusqlite::Connection,
    change_set: &font::FontChangeSet,
    post_font: &font::Font,
) -> Result<(), StoreError> {
    let mut appended = Vec::new();
    let mut popped = Vec::new();
    for entity in change_set.entity_changes() {
        match entity {
            font::FontEntityChange::Glyph(font::EntityChange::Created(glyph)) => {
                appended.push(glyph.id());
            }
            font::FontEntityChange::Glyph(font::EntityChange::Deleted(glyph)) => {
                popped.push(glyph.id());
            }
            _ => {}
        }
    }
    if !appended.is_empty() && !popped.is_empty() {
        return Err(StoreError::AppendAndPopGlyphs);
    }

    let first_appended_order = post_font.glyph_count().saturating_sub(appended.len());
    for (offset, glyph_id) in appended.iter().enumerate() {
        if post_font.glyph_order(glyph_id) != Some(first_appended_order + offset) {
            return Err(StoreError::AppendedGlyphNotAtTail(glyph_id.clone()));
        }
    }
    for (offset, glyph_id) in popped.iter().enumerate() {
        let order_index = conn
            .query_row(
                "SELECT order_index FROM glyphs WHERE id = ?1",
                [&glyph_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .or_missing(StoreEntity::Glyph, glyph_id)?;
        let expected = post_font.glyph_count() + popped.len() - offset - 1;
        if order_index != sql_int(expected) {
            return Err(StoreError::PoppedGlyphNotAtTail(glyph_id.clone()));
        }
    }
    Ok(())
}

/// Writes a font's rows to the store inside one transaction.
pub(crate) struct StoreWriter<'a> {
    tx: &'a Transaction<'a>,
}

impl<'a> StoreWriter<'a> {
    pub(crate) fn new(tx: &'a Transaction<'a>) -> Self {
        Self { tx }
    }

    pub(crate) fn replace_font_header(&self, font: &font::Font) -> Result<(), StoreError> {
        self.tx.execute("DELETE FROM glyph_lib", [])?;
        self.tx.execute("DELETE FROM font_lib", [])?;
        self.tx.execute("DELETE FROM fontinfo_remainder", [])?;
        self.tx.execute("DELETE FROM font_binaries", [])?;
        self.tx.execute("DELETE FROM kerning_pairs", [])?;
        self.tx.execute("DELETE FROM kerning_group_members", [])?;
        self.tx.execute("DELETE FROM kerning_groups", [])?;
        self.tx.execute("DELETE FROM feature_text", [])?;
        self.tx.execute("DELETE FROM font_guidelines", [])?;
        self.tx.execute("DELETE FROM glyph_components", [])?;
        self.tx.execute("DELETE FROM glyph_layer_payloads", [])?;
        self.tx.execute("DELETE FROM glyph_layers", [])?;
        self.tx.execute("DELETE FROM glyph_unicodes", [])?;
        self.tx.execute("DELETE FROM glyphs", [])?;
        self.tx.execute("DELETE FROM source_locations", [])?;
        self.tx.execute("DELETE FROM source_metric_values", [])?;
        self.tx.execute("DELETE FROM source_lib", [])?;
        self.tx.execute("DELETE FROM sources", [])?;
        self.tx.execute("DELETE FROM metric_definitions", [])?;
        self.tx.execute("DELETE FROM axis_mappings", [])?;
        self.tx.execute("DELETE FROM named_instances", [])?;
        self.tx.execute("DELETE FROM axes", [])?;

        self.upsert_font_info(font)?;
        self.replace_feature_text(font.features().fea_source())?;
        self.replace_font_guidelines(font.guidelines())?;
        self.replace_lib_data("font_lib", "key", None, font.lib())?;
        self.replace_lib_data("fontinfo_remainder", "key", None, font.fontinfo_remainder())?;
        self.replace_font_binaries("data", font.data_files())?;
        self.replace_font_binaries("image", font.images())?;
        self.replace_kerning(font.kerning())?;

        for (order_index, axis) in font.axes().iter().enumerate() {
            self.insert_axis(axis, sql_int(order_index), false)?;
        }
        self.replace_axis_mappings(font.axis_mappings())?;
        self.replace_named_instances(font.named_instances())?;
        self.replace_metric_definitions(font.metric_definitions())?;

        for (order_index, source) in font.sources().iter().enumerate() {
            self.upsert_source(&source.id(), &SourceRow::new(source, sql_int(order_index)))?;
            self.replace_source_metric_values(&source.id(), source.metric_values().iter())?;
            self.replace_lib_data(
                "source_lib",
                "source_id",
                Some(source.id().as_str()),
                source.lib(),
            )?;

            for (axis_id, value) in source.location() {
                // Location entries on undefined axes have no row to reference.
                if font.axis(axis_id).is_some() {
                    self.upsert_source_location(&source.id(), axis_id, *value)?;
                }
            }
        }

        Ok(())
    }

    pub(crate) fn write_glyph(
        &self,
        glyph: &font::Glyph,
        order_index: i64,
    ) -> Result<(), StoreError> {
        self.write_glyph_directory(glyph, order_index, WriteMode::Upsert)?;

        for layer in glyph.layers().values().map(AsRef::as_ref) {
            write_layer_in_tx(self.tx, &glyph.id(), layer)?;
        }
        Ok(())
    }

    pub(crate) fn write_glyph_directory(
        &self,
        glyph: &font::Glyph,
        order_index: i64,
        mode: WriteMode,
    ) -> Result<(), StoreError> {
        match mode {
            WriteMode::Insert => {
                self.tx
                    .prepare_cached(
                        "INSERT INTO glyphs (id, name, order_index, category, sub_category)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    )?
                    .execute(params![
                        glyph.id(),
                        glyph.glyph_name().as_str(),
                        order_index,
                        glyph.category().map(font::GlyphCategory::as_str),
                        glyph.sub_category().map(font::GlyphSubcategory::as_str),
                    ])?;
                for (unicode_order, unicode) in glyph.unicodes().iter().enumerate() {
                    self.tx.prepare_cached(
                        "INSERT INTO glyph_unicodes (glyph_id, unicode, order_index) VALUES (?1, ?2, ?3)",
                    )?
                    .execute(params![
                        glyph.id(),
                        i64::from(*unicode),
                        sql_int(unicode_order)
                    ])?;
                }
                for (key, value) in glyph.lib() {
                    self.tx
                        .prepare_cached(
                            "INSERT INTO glyph_lib (glyph_id, key, value_json) VALUES (?1, ?2, ?3)",
                        )?
                        .execute(params![glyph.id(), key, lib_value_json(value)?])?;
                }
                Ok(())
            }
            WriteMode::Upsert => {
                self.upsert_glyph(glyph, order_index)?;
                self.replace_glyph_unicodes(&glyph.id(), glyph.unicodes())?;
                self.replace_lib_data(
                    "glyph_lib",
                    "glyph_id",
                    Some(glyph.id().as_str()),
                    glyph.lib(),
                )
            }
        }
    }

    fn apply_change(&self, change: &font::FontChange) -> Result<(), StoreError> {
        match change {
            font::FontChange::Metadata(value) => self.update_font_metadata(&value.after),
            font::FontChange::LibValue { key, value } => {
                self.replace_font_lib_value(key, value.after.as_ref())
            }
            font::FontChange::Axes(value) => self.replace_axes(&value.after),
            font::FontChange::AxisMappings(value) => self.replace_axis_mappings(&value.after),
            font::FontChange::MetricDefinitions(value) => {
                self.replace_metric_definitions(&value.after)
            }
            font::FontChange::NamedInstances(value) => self.replace_named_instances(&value.after),
            font::FontChange::Sources(value) => self.replace_sources(&value.after),
            font::FontChange::Glyph(value) => self.replace_glyph(value),
            font::FontChange::Layer {
                glyph_id, layer, ..
            } => self.replace_layer(glyph_id, layer),
            font::FontChange::KerningGroup { group_id, .. } => self.delete_kerning_group(group_id),
            font::FontChange::KerningValue {
                source_id,
                pair,
                value,
            } => self.write_kerning_value(source_id, pair, value.after),
        }
    }

    /// Deletes one kerning group and its members; a changed group's new state is
    /// inserted once every changed group is deleted.
    fn delete_kerning_group(&self, group_id: &font::KerningGroupId) -> Result<(), StoreError> {
        self.tx.execute(
            "DELETE FROM kerning_group_members WHERE group_id = ?1",
            params![group_id.as_str()],
        )?;
        self.tx.execute(
            "DELETE FROM kerning_groups WHERE id = ?1",
            params![group_id.as_str()],
        )?;
        Ok(())
    }

    /// Replaces every stored kerning group with the groups of `kerning`.
    pub(crate) fn replace_kerning_groups(&self, kerning: &font::Kerning) -> Result<(), StoreError> {
        self.tx.execute("DELETE FROM kerning_group_members", [])?;
        self.tx.execute("DELETE FROM kerning_groups", [])?;
        for (group_id, group) in kerning.all_groups() {
            self.insert_kerning_group(group_id, group)?;
        }
        Ok(())
    }

    /// Upserts or deletes one source's value for one kerning pair.
    fn write_kerning_value(
        &self,
        source_id: &font::SourceId,
        pair: &font::KerningPair,
        value: Option<f64>,
    ) -> Result<(), StoreError> {
        let KerningSideColumns {
            kind: first_kind,
            value: first_value,
        } = KerningSideColumns::of(&pair.first);
        let KerningSideColumns {
            kind: second_kind,
            value: second_value,
        } = KerningSideColumns::of(&pair.second);
        match value {
            Some(value) => {
                self.tx.execute(
                    "
                    INSERT INTO kerning_pairs (
                        source_id, first_kind, first_value, second_kind, second_value, value
                    )
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                    ON CONFLICT (source_id, first_kind, first_value, second_kind, second_value)
                    DO UPDATE SET value = excluded.value
                    ",
                    params![
                        source_id.as_str(),
                        first_kind,
                        first_value,
                        second_kind,
                        second_value,
                        value
                    ],
                )?;
            }
            None => {
                self.tx.execute(
                    "
                    DELETE FROM kerning_pairs
                    WHERE source_id = ?1
                      AND first_kind = ?2 AND first_value = ?3
                      AND second_kind = ?4 AND second_value = ?5
                    ",
                    params![
                        source_id.as_str(),
                        first_kind,
                        first_value,
                        second_kind,
                        second_value
                    ],
                )?;
            }
        }
        Ok(())
    }

    /// Replaces every stored pair of `source_id` with its values in `kerning`.
    pub(crate) fn replace_source_kerning(
        &self,
        kerning: &font::Kerning,
        source_id: &font::SourceId,
    ) -> Result<(), StoreError> {
        self.tx.execute(
            "DELETE FROM kerning_pairs WHERE source_id = ?1",
            [source_id.as_str()],
        )?;
        let Some(pairs) = kerning.source(source_id) else {
            return Ok(());
        };
        for (pair, value) in pairs.pairs() {
            self.write_kerning_value(source_id, pair, Some(value))?;
        }
        Ok(())
    }

    fn replace_axes(&self, axes: &[font::Axis]) -> Result<(), StoreError> {
        let retained_ids = axes.iter().map(font::Axis::id).collect::<HashSet<_>>();
        for (order_index, axis) in axes.iter().enumerate() {
            self.upsert_axis_with_order(axis, sql_int(order_index))?;
        }
        for axis_id in self.table_ids::<font::AxisId>("axes")? {
            if !retained_ids.contains(&axis_id) {
                self.tx
                    .execute("DELETE FROM axes WHERE id = ?1", [&axis_id])?;
            }
        }
        Ok(())
    }

    fn replace_sources(&self, sources: &font::SourceCollection) -> Result<(), StoreError> {
        let retained_ids = sources
            .sources
            .iter()
            .map(font::Source::id)
            .collect::<HashSet<_>>();
        for (order_index, source) in sources.sources.iter().enumerate() {
            self.write_source_snapshot(source, sql_int(order_index))?;
        }
        for source_id in self.table_ids::<font::SourceId>("sources")? {
            if !retained_ids.contains(&source_id) {
                self.tx
                    .execute("DELETE FROM sources WHERE id = ?1", [&source_id])?;
            }
        }
        self.set_default_source_id(sources.default_source_id.as_ref())
    }

    fn replace_glyph(
        &self,
        value: &font::Replacement<Option<font::Glyph>>,
    ) -> Result<(), StoreError> {
        let glyph_id = value.glyph_id()?;
        match &value.after {
            Some(glyph) => {
                let existing_order = self
                    .tx
                    .query_row(
                        "SELECT order_index FROM glyphs WHERE id = ?1",
                        [&glyph_id],
                        |row| row.get::<_, i64>(0),
                    )
                    .optional()?;
                let order_index = existing_order.unwrap_or(self.tx.query_row(
                    "SELECT COUNT(*) FROM glyphs",
                    [],
                    |row| row.get(0),
                )?);
                self.write_glyph_directory(glyph, order_index, WriteMode::Upsert)?;

                let replaces_layers = value
                    .before
                    .as_ref()
                    .is_none_or(|before| before.layers() != glyph.layers());
                if replaces_layers {
                    self.tx
                        .execute("DELETE FROM glyph_layers WHERE glyph_id = ?1", [&glyph_id])?;
                    for layer in glyph.layers().values() {
                        write_layer_in_tx(self.tx, &glyph_id, layer)?;
                    }
                }
            }
            None => {
                let (order_index, count) = self.tx
                    .query_row(
                        "SELECT order_index, (SELECT COUNT(*) FROM glyphs) FROM glyphs WHERE id = ?1",
                        [&glyph_id],
                        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
                    )
                    .optional()?
                    .or_missing(StoreEntity::Glyph, &glyph_id)?;
                if order_index + 1 != count {
                    return Err(StoreError::GlyphNotAtTail(glyph_id));
                }
                self.tx
                    .execute("DELETE FROM glyphs WHERE id = ?1", [&glyph_id])?;
            }
        }
        Ok(())
    }

    fn replace_layer(
        &self,
        glyph_id: &font::GlyphId,
        value: &font::Replacement<Option<std::sync::Arc<font::GlyphLayer>>>,
    ) -> Result<(), StoreError> {
        let layer_id = value.layer_id()?;
        match &value.after {
            Some(layer) => write_layer_in_tx(self.tx, glyph_id, layer),
            None => {
                self.tx
                    .execute("DELETE FROM glyph_layers WHERE id = ?1", [&layer_id])?;
                Ok(())
            }
        }
    }

    /// Every id stored in `table`, as the id type the caller compares against.
    fn table_ids<Id>(&self, table: &str) -> Result<Vec<Id>, StoreError>
    where
        Id: rusqlite::types::FromSql,
    {
        let mut statement = self
            .tx
            .prepare(&format!("SELECT id FROM {table} ORDER BY id"))?;
        let ids = statement
            .query_map([], |row| row.get::<_, Id>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(ids)
    }

    pub(crate) fn upsert_axis_with_order(
        &self,
        axis: &font::Axis,
        order_index: i64,
    ) -> Result<(), StoreError> {
        self.insert_axis(axis, order_index, true)
    }

    fn insert_axis(
        &self,
        axis: &font::Axis,
        order_index: i64,
        upsert: bool,
    ) -> Result<(), StoreError> {
        let role = AxisRoleColumn(axis.role());
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
        self.tx.execute(
            &statement,
            params![
                axis.id(),
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

    pub(crate) fn replace_axis_mappings(
        &self,
        mappings: &[font::AxisMapping],
    ) -> Result<(), StoreError> {
        self.tx.execute("DELETE FROM axis_mappings", [])?;
        for (order_index, mapping) in mappings.iter().enumerate() {
            self.tx.execute(
                "INSERT INTO axis_mappings (id, mapping_json, order_index) VALUES (?1, ?2, ?3)",
                params![
                    mapping.id(),
                    serde_json::to_string(mapping)?,
                    sql_int(order_index),
                ],
            )?;
        }
        Ok(())
    }

    pub(crate) fn replace_named_instances(
        &self,
        instances: &[font::NamedInstance],
    ) -> Result<(), StoreError> {
        self.tx.execute("DELETE FROM named_instances", [])?;
        for (order_index, instance) in instances.iter().enumerate() {
            self.tx.execute(
                "INSERT INTO named_instances (id, instance_json, order_index) VALUES (?1, ?2, ?3)",
                params![
                    instance.id(),
                    serde_json::to_string(instance)?,
                    sql_int(order_index),
                ],
            )?;
        }
        Ok(())
    }

    pub(crate) fn replace_metric_definitions(
        &self,
        definitions: &[font::MetricDefinition],
    ) -> Result<(), StoreError> {
        self.tx.execute("DELETE FROM metric_definitions", [])?;
        for (order_index, definition) in definitions.iter().enumerate() {
            let kind = MetricKindColumn(definition.kind());
            self.tx.execute(
                "INSERT INTO metric_definitions (id, kind, name, order_index) VALUES (?1, ?2, ?3, ?4)",
                params![
                    definition.id(),
                    kind,
                    definition.name(),
                    sql_int(order_index),
                ],
            )?;
        }
        Ok(())
    }

    fn replace_source_metric_values<'v>(
        &self,
        source_id: &font::SourceId,
        values: impl IntoIterator<Item = (&'v font::MetricId, &'v font::MetricValue)>,
    ) -> Result<(), StoreError> {
        self.tx.execute(
            "DELETE FROM source_metric_values WHERE source_id = ?1",
            [&source_id],
        )?;
        for (metric_id, value) in values {
            self.tx.execute(
                "
                INSERT INTO source_metric_values (source_id, metric_id, position, overshoot)
                VALUES (?1, ?2, ?3, ?4)
                ",
                params![source_id, metric_id, value.position, value.overshoot,],
            )?;
        }
        Ok(())
    }

    fn upsert_source_location(
        &self,
        source_id: &font::SourceId,
        axis_id: &font::AxisId,
        value: f64,
    ) -> Result<(), StoreError> {
        self.tx.execute(
            "
            INSERT INTO source_locations (source_id, axis_id, value)
            VALUES (?1, ?2, ?3)
            ON CONFLICT(source_id, axis_id) DO UPDATE SET
                value = excluded.value
            ",
            params![source_id, axis_id, value],
        )?;
        Ok(())
    }

    fn upsert_source(
        &self,
        source_id: &font::SourceId,
        row: &SourceRow<'_>,
    ) -> Result<(), StoreError> {
        self.tx.execute(
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
                source_id,
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

    pub(crate) fn write_source_snapshot(
        &self,
        source: &font::Source,
        order_index: i64,
    ) -> Result<(), StoreError> {
        self.upsert_source(&source.id(), &SourceRow::new(source, order_index))?;
        self.tx.execute(
            "DELETE FROM source_locations WHERE source_id = ?1",
            [source.id()],
        )?;
        for (axis_id, value) in source.location() {
            self.upsert_source_location(&source.id(), axis_id, *value)?;
        }
        self.replace_source_metric_values(&source.id(), source.metric_values().iter())?;
        self.replace_lib_data(
            "source_lib",
            "source_id",
            Some(source.id().as_str()),
            source.lib(),
        )?;
        Ok(())
    }

    fn upsert_glyph(&self, glyph: &font::Glyph, order_index: i64) -> Result<(), StoreError> {
        self.tx
            .prepare_cached(
                "
            INSERT INTO glyphs (id, name, order_index, category, sub_category)
            VALUES (?1, ?2, ?3, ?4, ?5)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                order_index = excluded.order_index,
                category = excluded.category,
                sub_category = excluded.sub_category
            ",
            )?
            .execute(params![
                glyph.id(),
                glyph.glyph_name().as_str(),
                order_index,
                glyph.category().map(font::GlyphCategory::as_str),
                glyph.sub_category().map(font::GlyphSubcategory::as_str),
            ])?;
        Ok(())
    }

    fn replace_glyph_unicodes(
        &self,
        glyph_id: &font::GlyphId,
        unicodes: &[u32],
    ) -> Result<(), StoreError> {
        self.tx
            .prepare_cached("DELETE FROM glyph_unicodes WHERE glyph_id = ?1")?
            .execute([&glyph_id])?;

        for (order_index, unicode) in unicodes.iter().enumerate() {
            self.tx
                .prepare_cached(
                    "
                INSERT INTO glyph_unicodes (glyph_id, unicode, order_index)
                VALUES (?1, ?2, ?3)
                ",
                )?
                .execute(params![glyph_id, *unicode as i64, sql_int(order_index)])?;
        }

        Ok(())
    }

    /// Updates only authored metadata columns, preserving metrics and store-only fields.
    fn update_font_metadata(&self, metadata: &font::FontMetadata) -> Result<(), StoreError> {
        let rows_changed = self.tx.execute(
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
        require_changed(rows_changed, StoreEntity::FontInfo, "1")
    }

    /// Persists the live font's default source identity without changing other font fields.
    pub(crate) fn set_default_source_id(
        &self,
        source_id: Option<&font::SourceId>,
    ) -> Result<(), StoreError> {
        let rows_changed = self.tx.execute(
            "UPDATE font_info SET default_source_id = ?1 WHERE id = 1",
            [source_id.map(font::SourceId::as_str)],
        )?;
        require_changed(rows_changed, StoreEntity::FontInfo, "1")
    }

    pub(crate) fn upsert_font_info(&self, font: &font::Font) -> Result<(), StoreError> {
        let metadata = font.metadata();
        let metrics = font.metrics();
        self.tx.execute(
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

    fn replace_feature_text(&self, fea_source: Option<&str>) -> Result<(), StoreError> {
        self.tx.execute("DELETE FROM feature_text", [])?;
        self.tx.execute(
            "
            INSERT INTO feature_text (id, fea_source)
            VALUES (1, ?1)
            ",
            [fea_source],
        )?;
        Ok(())
    }

    fn replace_font_guidelines(&self, guidelines: &[font::Guideline]) -> Result<(), StoreError> {
        self.tx.execute("DELETE FROM font_guidelines", [])?;
        for (order_index, guideline) in guidelines.iter().enumerate() {
            self.tx.execute(
                "
                INSERT INTO font_guidelines (
                    id, x, y, angle, name, color, order_index
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                ",
                params![
                    guideline.id(),
                    guideline.x(),
                    guideline.y(),
                    guideline.angle(),
                    guideline.name(),
                    guideline.color(),
                    sql_int(order_index),
                ],
            )?;
        }
        Ok(())
    }

    fn replace_kerning(&self, kerning: &font::Kerning) -> Result<(), StoreError> {
        self.tx.execute("DELETE FROM kerning_pairs", [])?;
        self.tx.execute("DELETE FROM kerning_group_members", [])?;
        self.tx.execute("DELETE FROM kerning_groups", [])?;

        for position in [font::KerningPosition::First, font::KerningPosition::Second] {
            for (group_id, group) in kerning.groups(position) {
                self.insert_kerning_group(group_id, group)?;
            }
        }
        let mut insert_pair = self.tx.prepare(
            "
            INSERT INTO kerning_pairs (
                source_id,
                first_kind,
                first_value,
                second_kind,
                second_value,
                value
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ",
        )?;
        for (source_id, source) in kerning.sources() {
            for (pair, value) in source.pairs() {
                let KerningSideColumns {
                    kind: first_kind,
                    value: first_value,
                } = KerningSideColumns::of(&pair.first);
                let KerningSideColumns {
                    kind: second_kind,
                    value: second_value,
                } = KerningSideColumns::of(&pair.second);
                insert_pair.execute(params![
                    source_id.as_str(),
                    first_kind,
                    first_value,
                    second_kind,
                    second_value,
                    value,
                ])?;
            }
        }
        Ok(())
    }

    fn insert_kerning_group(
        &self,
        group_id: &font::KerningGroupId,
        group: &font::KerningGroup,
    ) -> Result<(), StoreError> {
        let position = KerningPositionColumn(group.position);
        self.tx.execute(
            "
            INSERT INTO kerning_groups (id, position, name)
            VALUES (?1, ?2, ?3)
            ",
            params![group_id.as_str(), position, group.name],
        )?;
        for (order_index, member) in group.members.iter().enumerate() {
            self.tx.execute(
                "
                INSERT INTO kerning_group_members (group_id, position, glyph_id, order_index)
                VALUES (?1, ?2, ?3, ?4)
                ",
                params![
                    group_id.as_str(),
                    position,
                    member.as_str(),
                    sql_int(order_index)
                ],
            )?;
        }
        Ok(())
    }

    /// Upserts or removes one `font_lib` row without touching other keys.
    fn replace_font_lib_value(
        &self,
        key: &str,
        value: Option<&font::LibValue>,
    ) -> Result<(), StoreError> {
        self.tx
            .execute("DELETE FROM font_lib WHERE key = ?1", [key])?;
        if let Some(value) = value {
            self.tx.execute(
                "INSERT INTO font_lib (key, value_json) VALUES (?1, ?2)",
                params![key, lib_value_json(value)?],
            )?;
        }
        Ok(())
    }

    pub(crate) fn replace_lib_data(
        &self,
        table: &'static str,
        owner_column: &'static str,
        owner_id: Option<&str>,
        lib: &font::LibData,
    ) -> Result<(), StoreError> {
        match owner_id {
            Some(owner_id) => {
                let delete_sql = format!("DELETE FROM {table} WHERE {owner_column} = ?1");
                self.tx.prepare_cached(&delete_sql)?.execute([owner_id])?;
                let insert_sql = format!(
                    "INSERT INTO {table} ({owner_column}, key, value_json) VALUES (?1, ?2, ?3)"
                );
                for (key, value) in lib {
                    self.tx.prepare_cached(&insert_sql)?.execute(params![
                        owner_id,
                        key,
                        lib_value_json(value)?
                    ])?;
                }
            }
            None => {
                let delete_sql = format!("DELETE FROM {table}");
                self.tx.execute(&delete_sql, [])?;
                let insert_sql = format!("INSERT INTO {table} (key, value_json) VALUES (?1, ?2)");
                for (key, value) in lib {
                    self.tx
                        .execute(&insert_sql, params![key, lib_value_json(value)?])?;
                }
            }
        }
        Ok(())
    }

    fn replace_font_binaries(
        &self,
        kind: &str,
        binaries: &font::BinaryData,
    ) -> Result<(), StoreError> {
        for (path, bytes) in binaries.iter() {
            self.tx.execute(
                "
                INSERT INTO font_binaries (kind, path, bytes)
                VALUES (?1, ?2, ?3)
                ",
                params![kind, path, bytes],
            )?;
        }
        Ok(())
    }
}

fn change_priority(change: &font::FontChange) -> usize {
    match change {
        font::FontChange::Metadata(_) | font::FontChange::LibValue { .. } => 0,
        font::FontChange::Axes(_) => 1,
        font::FontChange::AxisMappings(_) => 2,
        font::FontChange::MetricDefinitions(_) => 3,
        font::FontChange::NamedInstances(_) => 4,
        font::FontChange::Sources(_) => 5,
        font::FontChange::Glyph(_) => 6,
        font::FontChange::Layer { .. } => 7,
        font::FontChange::KerningGroup { .. } => KERNING_GROUP_PRIORITY,
        font::FontChange::KerningValue { .. } => 10,
    }
}

/// The groups a change set leaves in place, by id.
fn kerning_groups_after(
    change_set: &font::FontChangeSet,
) -> impl Iterator<Item = (&font::KerningGroupId, &font::KerningGroup)> {
    change_set.changes.iter().filter_map(|change| match change {
        font::FontChange::KerningGroup { group_id, group } => {
            group.after.as_ref().map(|group| (group_id, group))
        }
        _ => None,
    })
}

/// When kerning group changes apply: after glyphs, before pair values.
const KERNING_GROUP_PRIORITY: usize = 9;

/// The `sources` row of one source.
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

impl<'a> SourceRow<'a> {
    fn new(source: &'a font::Source, order_index: i64) -> Self {
        Self {
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
        }
    }
}

fn lib_value_json(value: &font::LibValue) -> Result<String, StoreError> {
    Ok(serde_json::to_string(&lib_value_to_json(value))?)
}

fn lib_value_to_json(value: &font::LibValue) -> serde_json::Value {
    match value {
        font::LibValue::String(value) => typed_json("string", value),
        font::LibValue::Integer(value) => typed_json("integer", value),
        font::LibValue::UnsignedInteger(value) => typed_json("unsignedInteger", value),
        font::LibValue::Float(value) => typed_json("float", value),
        font::LibValue::Boolean(value) => typed_json("boolean", value),
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
        font::LibValue::Data(values) => typed_json("data", values),
        font::LibValue::Date(value) => typed_json("date", value),
        font::LibValue::Uid(value) => typed_json("uid", value),
    }
}

fn typed_json(kind: &'static str, value: impl serde::Serialize) -> serde_json::Value {
    serde_json::json!({
        "type": kind,
        "value": value,
    })
}

fn require_changed(rows_changed: usize, kind: StoreEntity, id: &str) -> Result<(), StoreError> {
    (rows_changed > 0).then_some(()).or_missing(kind, &id)
}
