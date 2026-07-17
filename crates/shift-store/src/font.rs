use crate::{ShiftStore, StoreError};

#[derive(Clone, Debug, PartialEq)]
pub struct FontInfo {
    pub family_name: Option<String>,
    pub style_name: Option<String>,
    pub copyright: Option<String>,
    pub trademark: Option<String>,
    pub description: Option<String>,
    pub note: Option<String>,
    pub sample_text: Option<String>,
    pub designer: Option<String>,
    pub designer_url: Option<String>,
    pub manufacturer: Option<String>,
    pub manufacturer_url: Option<String>,
    pub license_description: Option<String>,
    pub license_info_url: Option<String>,
    pub vendor_id: Option<String>,
    pub version_major: Option<i64>,
    pub version_minor: Option<i64>,
    pub units_per_em: f64,
    pub default_source_id: Option<String>,
}

impl ShiftStore {
    pub fn set_font_info(&mut self, font_info: FontInfo) -> Result<(), StoreError> {
        self.conn.execute(
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
                1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
                ?16, ?17, ?18
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
            rusqlite::params![
                font_info.family_name,
                font_info.style_name,
                font_info.copyright,
                font_info.trademark,
                font_info.description,
                font_info.note,
                font_info.sample_text,
                font_info.designer,
                font_info.designer_url,
                font_info.manufacturer,
                font_info.manufacturer_url,
                font_info.license_description,
                font_info.license_info_url,
                font_info.vendor_id,
                font_info.version_major,
                font_info.version_minor,
                font_info.units_per_em,
                font_info.default_source_id,
            ],
        )?;

        Ok(())
    }

    pub fn get_font_info(&self) -> Result<Option<FontInfo>, StoreError> {
        let mut stmt = self.conn.prepare(
            "
            SELECT
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
            FROM font_info
            WHERE id = 1
            ",
        )?;

        match stmt.query_row([], map_font_info_row) {
            Ok(font_info) => Ok(Some(font_info)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(err) => Err(err.into()),
        }
    }
}

fn map_font_info_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<FontInfo> {
    Ok(FontInfo {
        family_name: row.get(0)?,
        style_name: row.get(1)?,
        copyright: row.get(2)?,
        trademark: row.get(3)?,
        description: row.get(4)?,
        note: row.get(5)?,
        sample_text: row.get(6)?,
        designer: row.get(7)?,
        designer_url: row.get(8)?,
        manufacturer: row.get(9)?,
        manufacturer_url: row.get(10)?,
        license_description: row.get(11)?,
        license_info_url: row.get(12)?,
        vendor_id: row.get(13)?,
        version_major: row.get(14)?,
        version_minor: row.get(15)?,
        units_per_em: row.get(16)?,
        default_source_id: row.get(17)?,
    })
}
