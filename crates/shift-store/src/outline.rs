use crate::{LayerId, ShiftStore, StoreError};

#[derive(Clone, Debug, PartialEq)]
pub struct ContourRecord {
    pub id: String,
    pub layer_id: LayerId,
    pub closed: bool,
    pub order_index: i64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PointRecord {
    pub id: String,
    pub contour_id: String,
    pub order_index: i64,
    pub x: f64,
    pub y: f64,
    pub point_type: String,
    pub smooth: bool,
}

impl ShiftStore {
    pub fn list_contours_for_layer(
        &self,
        layer_id: &LayerId,
    ) -> Result<Vec<ContourRecord>, StoreError> {
        let mut stmt = self.conn.prepare(
            "
            SELECT id, layer_id, closed, order_index
            FROM glyph_layer_contours
            WHERE layer_id = ?1
            ORDER BY order_index
            ",
        )?;

        let rows = stmt.query_map([layer_id.as_str()], map_contour_row)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(StoreError::from)
    }

    pub fn list_points_for_contour(
        &self,
        contour_id: &str,
    ) -> Result<Vec<PointRecord>, StoreError> {
        let mut stmt = self.conn.prepare(
            "
            SELECT id, contour_id, order_index, x, y, point_type, smooth
            FROM glyph_layer_points
            WHERE contour_id = ?1
            ORDER BY order_index
            ",
        )?;

        let rows = stmt.query_map([contour_id], map_point_row)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(StoreError::from)
    }
}

fn map_contour_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ContourRecord> {
    Ok(ContourRecord {
        id: row.get(0)?,
        layer_id: LayerId::new(row.get::<_, String>(1)?),
        closed: row.get(2)?,
        order_index: row.get(3)?,
    })
}

fn map_point_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PointRecord> {
    Ok(PointRecord {
        id: row.get(0)?,
        contour_id: row.get(1)?,
        order_index: row.get(2)?,
        x: row.get(3)?,
        y: row.get(4)?,
        point_type: row.get(5)?,
        smooth: row.get(6)?,
    })
}
