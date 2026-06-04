use crate::{GlyphId, ShiftStore, StoreError};

pub struct NewGlyph {
    pub id: GlyphId,
    pub name: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GlyphRecord {
    pub id: GlyphId,
    pub name: Option<String>,
}

impl ShiftStore {
    pub fn create_glyph(&mut self, glyph: NewGlyph) -> Result<(), StoreError> {
        self.conn.execute(
            "
            INSERT INTO glyphs (id, name)
            VALUES (?1, ?2)
            ",
            rusqlite::params![glyph.id.as_str(), glyph.name],
        )?;

        Ok(())
    }

    pub fn get_glyph(&self, id: &GlyphId) -> Result<Option<GlyphRecord>, StoreError> {
        let mut stmt = self.conn.prepare(
            "
            SELECT id, name
            FROM glyphs
            WHERE id = ?1
            ",
        )?;

        match stmt.query_row([id.as_str()], map_glyph_row) {
            Ok(glyph) => Ok(Some(glyph)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(err) => Err(err.into()),
        }
    }

    pub fn list_glyph_unicodes(&self, id: &GlyphId) -> Result<Vec<u32>, StoreError> {
        let mut stmt = self.conn.prepare(
            "
            SELECT unicode
            FROM glyph_unicodes
            WHERE glyph_id = ?1
            ORDER BY order_index
            ",
        )?;

        let rows = stmt.query_map([id.as_str()], |row| {
            row.get::<_, i64>(0).map(|unicode| unicode as u32)
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(StoreError::from)
    }
}

fn map_glyph_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<GlyphRecord> {
    Ok(GlyphRecord {
        id: GlyphId::new(row.get::<_, String>(0)?),
        name: row.get(1)?,
    })
}
