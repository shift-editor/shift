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

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SourceKind {
    Master,
    Layer,
}

impl SourceKind {
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            SourceKind::Master => "master",
            SourceKind::Layer => "layer",
        }
    }

    pub(crate) fn parse(value: String) -> Result<Self, StoreError> {
        match value.as_str() {
            "master" => Ok(SourceKind::Master),
            "layer" => Ok(SourceKind::Layer),
            _ => Err(StoreError::UnknownSourceKind(value)),
        }
    }
}

impl From<shift_font::SourceRole> for SourceKind {
    fn from(role: shift_font::SourceRole) -> Self {
        match role {
            shift_font::SourceRole::Master => SourceKind::Master,
            shift_font::SourceRole::Layer => SourceKind::Layer,
        }
    }
}

impl From<SourceKind> for shift_font::SourceRole {
    fn from(kind: SourceKind) -> Self {
        match kind {
            SourceKind::Master => shift_font::SourceRole::Master,
            SourceKind::Layer => shift_font::SourceRole::Layer,
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
    pub fn create_axis(&mut self, axis: NewAxis) -> Result<(), StoreError> {
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

    pub fn create_source(&mut self, source: NewSource) -> Result<(), StoreError> {
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
    let kind = SourceKind::parse(row.get(5)?).map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(5, rusqlite::types::Type::Text, Box::new(err))
    })?;

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
