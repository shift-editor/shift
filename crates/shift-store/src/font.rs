use crate::{ShiftStore, StoreError};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FontInfo {
    pub family_name: Option<String>,
    pub copyright: Option<String>,
    pub trademark: Option<String>,
    pub description: Option<String>,
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
    pub units_per_em: i64,
}

impl ShiftStore {
    pub fn set_font_info(&mut self, font_info: FontInfo) -> Result<(), StoreError> {
        self.conn.execute(
            "
            INSERT INTO font_info (
                id,
                family_name,
                copyright,
                trademark,
                description,
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
                units_per_em
            )
            VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
            ON CONFLICT(id) DO UPDATE SET
                family_name = excluded.family_name,
                copyright = excluded.copyright,
                trademark = excluded.trademark,
                description = excluded.description,
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
                units_per_em = excluded.units_per_em
            ",
            rusqlite::params![
                font_info.family_name,
                font_info.copyright,
                font_info.trademark,
                font_info.description,
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
            ],
        )?;

        Ok(())
    }

    pub fn get_font_info(&self) -> Result<Option<FontInfo>, StoreError> {
        let mut stmt = self.conn.prepare(
            "
            SELECT
                family_name,
                copyright,
                trademark,
                description,
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
                units_per_em
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
        copyright: row.get(1)?,
        trademark: row.get(2)?,
        description: row.get(3)?,
        sample_text: row.get(4)?,
        designer: row.get(5)?,
        designer_url: row.get(6)?,
        manufacturer: row.get(7)?,
        manufacturer_url: row.get(8)?,
        license_description: row.get(9)?,
        license_info_url: row.get(10)?,
        vendor_id: row.get(11)?,
        version_major: row.get(12)?,
        version_minor: row.get(13)?,
        units_per_em: row.get(14)?,
    })
}
