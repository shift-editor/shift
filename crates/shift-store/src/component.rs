use crate::{ComponentId, GlyphId, LayerId, ShiftStore, StoreError};

pub struct NewGlyphComponent {
    pub id: ComponentId,
    pub layer_id: LayerId,
    pub base_glyph_id: GlyphId,
    pub base_glyph_name: String,
    pub transform: shift_font::DecomposedTransform,
    pub order_index: i64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct GlyphComponentRecord {
    pub id: ComponentId,
    pub layer_id: LayerId,
    pub base_glyph_id: GlyphId,
    pub base_glyph_name: String,
    pub transform: shift_font::DecomposedTransform,
    pub order_index: i64,
}

impl ShiftStore {
    pub fn create_glyph_component(
        &mut self,
        component: NewGlyphComponent,
    ) -> Result<(), StoreError> {
        self.conn.execute(
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
            rusqlite::params![
                component.id.as_str(),
                component.layer_id.as_str(),
                component.base_glyph_id.as_str(),
                component.base_glyph_name,
                component.transform.translate_x,
                component.transform.translate_y,
                component.transform.rotation,
                component.transform.scale_x,
                component.transform.scale_y,
                component.transform.skew_x,
                component.transform.skew_y,
                component.transform.t_center_x,
                component.transform.t_center_y,
                component.order_index,
            ],
        )?;

        Ok(())
    }

    pub fn get_glyph_component(
        &self,
        id: &ComponentId,
    ) -> Result<Option<GlyphComponentRecord>, StoreError> {
        let mut stmt = self.conn.prepare(
            "
            SELECT
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
            FROM glyph_components
            WHERE id = ?1
            ",
        )?;

        match stmt.query_row([id.as_str()], map_glyph_component_row) {
            Ok(component) => Ok(Some(component)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(err) => Err(err.into()),
        }
    }

    pub fn list_glyph_components_for_layer(
        &self,
        layer_id: &LayerId,
    ) -> Result<Vec<GlyphComponentRecord>, StoreError> {
        let mut stmt = self.conn.prepare(
            "
            SELECT
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
            FROM glyph_components
            WHERE layer_id = ?1
            ORDER BY order_index, id
            ",
        )?;

        let rows = stmt.query_map([layer_id.as_str()], map_glyph_component_row)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(StoreError::from)
    }
}

fn map_glyph_component_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<GlyphComponentRecord> {
    Ok(GlyphComponentRecord {
        id: ComponentId::new(row.get::<_, String>(0)?),
        layer_id: LayerId::new(row.get::<_, String>(1)?),
        base_glyph_id: GlyphId::new(row.get::<_, String>(2)?),
        base_glyph_name: row.get(3)?,
        transform: shift_font::DecomposedTransform {
            translate_x: row.get(4)?,
            translate_y: row.get(5)?,
            rotation: row.get(6)?,
            scale_x: row.get(7)?,
            scale_y: row.get(8)?,
            skew_x: row.get(9)?,
            skew_y: row.get(10)?,
            t_center_x: row.get(11)?,
            t_center_y: row.get(12)?,
        },
        order_index: row.get(13)?,
    })
}
