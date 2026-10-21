use crate::{AxisId, ShiftStore, SourceId, StoreError};

pub struct NewAxis {
    pub id: AxisId,
    pub tag: String,
    pub name: String,
    pub min_value: f64,
    pub default_value: f64,
    pub max_value: f64,
    pub hidden: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct AxisRecord {
    pub id: AxisId,
    pub tag: String,
    pub name: String,
    pub min_value: f64,
    pub default_value: f64,
    pub max_value: f64,
    pub hidden: bool,
}

pub struct NewSource {
    pub id: SourceId,
    pub name: Option<String>,
    pub family_name: Option<String>,
    pub style_name: Option<String>,
    pub filename: Option<String>,
    pub kind: SourceKind,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SourceRecord {
    pub id: SourceId,
    pub name: Option<String>,
    pub family_name: Option<String>,
    pub style_name: Option<String>,
    pub filename: Option<String>,
    pub kind: SourceKind,
}

shift_font::string_enum! {
    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    pub enum SourceKind {
        Master => "master",
        Layer => "layer",
    }
    parse_error: StoreError = |value| StoreError::UnknownSourceKind(value.to_string());
}

crate::sql_text::sql_text!(SourceKind);

impl From<shift_font::SourceRole> for SourceKind {
    fn from(role: shift_font::SourceRole) -> Self {
        match role {
            shift_font::SourceRole::Master => Self::Master,
            shift_font::SourceRole::Layer => Self::Layer,
        }
    }
}

impl From<SourceKind> for shift_font::SourceRole {
    fn from(kind: SourceKind) -> Self {
        match kind {
            SourceKind::Master => Self::Master,
            SourceKind::Layer => Self::Layer,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct SourceAxisLocation {
    pub source_id: SourceId,
    pub axis_id: AxisId,
    pub value: f64,
}

impl ShiftStore {
    /// Inserts an external axis record.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::Sqlite`] when the insert fails, for example because the id is taken.
    pub fn create_axis(&mut self, axis: &NewAxis) -> Result<(), StoreError> {
        self.conn.execute(
            "
            INSERT INTO axes (
                id,
                tag,
                name,
                min_value,
                default_value,
                max_value,
                role,
                labels_json,
                hidden
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'external', '[]', ?7)
            ",
            rusqlite::params![
                axis.id.as_str(),
                axis.tag,
                axis.name,
                axis.min_value,
                axis.default_value,
                axis.max_value,
                axis.hidden,
            ],
        )?;

        Ok(())
    }

    /// Returns the axis record with `id`, or `None` when there is none.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::Sqlite`] when the read fails.
    pub fn get_axis(&self, id: &AxisId) -> Result<Option<AxisRecord>, StoreError> {
        let mut stmt = self.conn.prepare(
            "
            SELECT
                id,
                tag,
                name,
                min_value,
                default_value,
                max_value,
                hidden
            FROM axes
            WHERE id = ?1
            ",
        )?;

        match stmt.query_row([id.as_str()], map_axis_row) {
            Ok(axis) => Ok(Some(axis)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(err) => Err(err.into()),
        }
    }

    /// Inserts a source record.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::Sqlite`] when the insert fails, for example because the id is taken.
    pub fn create_source(&mut self, source: &NewSource) -> Result<(), StoreError> {
        self.conn.execute(
            "
            INSERT INTO sources (
                id,
                name,
                family_name,
                style_name,
                filename,
                kind
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ",
            rusqlite::params![
                source.id.as_str(),
                source.name,
                source.family_name,
                source.style_name,
                source.filename,
                source.kind.as_str(),
            ],
        )?;

        Ok(())
    }

    /// Returns the source record with `id`, or `None` when there is none.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::Sqlite`] when the read fails, including when the stored source kind is
    /// unknown.
    pub fn get_source(&self, id: &SourceId) -> Result<Option<SourceRecord>, StoreError> {
        let mut stmt = self.conn.prepare(
            "
            SELECT
                id,
                name,
                family_name,
                style_name,
                filename,
                kind
            FROM sources
            WHERE id = ?1
            ",
        )?;

        match stmt.query_row([id.as_str()], map_source_row) {
            Ok(source) => Ok(Some(source)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(err) => Err(err.into()),
        }
    }

    /// Lists every source record in source order.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::Sqlite`] when the read fails, including when a stored source kind is
    /// unknown.
    pub fn list_sources(&self) -> Result<Vec<SourceRecord>, StoreError> {
        let mut stmt = self.conn.prepare(
            "
            SELECT
                id,
                name,
                family_name,
                style_name,
                filename,
                kind
            FROM sources
            ORDER BY order_index, id
            ",
        )?;

        let rows = stmt.query_map([], map_source_row)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(StoreError::from)
    }

    /// Sets a source's value on one axis, replacing any stored before.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::Sqlite`] when the write fails.
    pub fn set_source_location(
        &mut self,
        source_id: &SourceId,
        axis_id: &AxisId,
        value: f64,
    ) -> Result<(), StoreError> {
        self.conn.execute(
            "
            INSERT INTO source_locations (source_id, axis_id, value)
            VALUES (?1, ?2, ?3)
            ON CONFLICT(source_id, axis_id) DO UPDATE SET
                value = excluded.value
            ",
            rusqlite::params![source_id.as_str(), axis_id.as_str(), value],
        )?;

        Ok(())
    }

    /// Returns a source's stored axis values, ordered by axis id.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::Sqlite`] when the read fails.
    pub fn get_source_locations(
        &self,
        source_id: &SourceId,
    ) -> Result<Vec<SourceAxisLocation>, StoreError> {
        let mut stmt = self.conn.prepare(
            "
            SELECT source_id, axis_id, value
            FROM source_locations
            WHERE source_id = ?1
            ORDER BY axis_id
            ",
        )?;

        let rows = stmt.query_map([source_id.as_str()], map_source_location_row)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(StoreError::from)
    }
}

fn map_axis_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AxisRecord> {
    Ok(AxisRecord {
        id: AxisId::new(row.get::<_, String>(0)?),
        tag: row.get(1)?,
        name: row.get(2)?,
        min_value: row.get(3)?,
        default_value: row.get(4)?,
        max_value: row.get(5)?,
        hidden: row.get(6)?,
    })
}

fn map_source_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SourceRecord> {
    let kind: SourceKind = row.get(5)?;

    Ok(SourceRecord {
        id: SourceId::new(row.get::<_, String>(0)?),
        name: row.get(1)?,
        family_name: row.get(2)?,
        style_name: row.get(3)?,
        filename: row.get(4)?,
        kind,
    })
}

fn map_source_location_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SourceAxisLocation> {
    Ok(SourceAxisLocation {
        source_id: SourceId::new(row.get::<_, String>(0)?),
        axis_id: AxisId::new(row.get::<_, String>(1)?),
        value: row.get(2)?,
    })
}
