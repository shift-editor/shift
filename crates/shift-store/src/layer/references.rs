use std::collections::{HashMap, HashSet, VecDeque};

use rusqlite::Connection;
use shift_font as font;

use crate::{ShiftStore, StoreError};

impl ShiftStore {
    /// Returns every direct glyph-component edge from one ordered relational
    /// scan. Glyphs without components are absent from the map.
    pub fn glyph_component_references(
        &self,
    ) -> Result<HashMap<font::GlyphId, Vec<font::GlyphId>>, StoreError> {
        let mut stmt = self.conn.prepare(
            "
            SELECT DISTINCT l.glyph_id, c.base_glyph_id
            FROM glyph_components AS c
            JOIN glyph_layers AS l ON l.id = c.layer_id
            ORDER BY l.glyph_id, c.base_glyph_id
            ",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                font::GlyphId::from_raw(row.get::<_, String>(0)?),
                font::GlyphId::from_raw(row.get::<_, String>(1)?),
            ))
        })?;
        let mut references = HashMap::new();
        for row in rows {
            let (glyph_id, base_glyph_id) = row?;
            references
                .entry(glyph_id)
                .or_insert_with(Vec::new)
                .push(base_glyph_id);
        }
        Ok(references)
    }

    /// Returns referenced glyph identities entirely from the relational index.
    pub fn referenced_glyph_ids_for_glyph(
        &self,
        glyph_id: &font::GlyphId,
    ) -> Result<Vec<font::GlyphId>, StoreError> {
        let mut stmt = self.conn.prepare(
            "
            SELECT DISTINCT c.base_glyph_id
            FROM glyph_components AS c
            JOIN glyph_layers AS l ON l.id = c.layer_id
            WHERE l.glyph_id = ?1
            ORDER BY c.base_glyph_id
            ",
        )?;
        let rows = stmt.query_map([glyph_id.to_string()], |row| {
            Ok(font::GlyphId::from_raw(row.get::<_, String>(0)?))
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    /// Computes the transitive component closure without scanning payloads.
    pub fn referenced_glyph_closure(
        &self,
        roots: impl IntoIterator<Item = font::GlyphId>,
    ) -> Result<Vec<font::GlyphId>, StoreError> {
        let mut pending: VecDeque<_> = roots.into_iter().collect();
        let mut seen = HashSet::new();
        let mut result = Vec::new();
        while let Some(glyph_id) = pending.pop_front() {
            if !seen.insert(glyph_id.clone()) {
                continue;
            }
            pending.extend(self.referenced_glyph_ids_for_glyph(&glyph_id)?);
            result.push(glyph_id);
        }
        Ok(result)
    }

    /// Reverse-reference lookup used for dependent invalidation.
    pub fn dependent_glyph_ids_for_layers(
        &self,
        layer_ids: &[font::LayerId],
    ) -> Result<Vec<font::GlyphId>, StoreError> {
        if layer_ids.is_empty() {
            return Ok(Vec::new());
        }
        let mut result = HashSet::new();
        let mut stmt = self.conn.prepare(
            "
            SELECT DISTINCT owner.glyph_id
            FROM glyph_components AS c
            JOIN glyph_layers AS target ON target.glyph_id = c.base_glyph_id
            JOIN glyph_layers AS owner ON owner.id = c.layer_id
            WHERE target.id = ?1
            ",
        )?;
        for layer_id in layer_ids {
            let rows = stmt.query_map([layer_id.to_string()], |row| {
                Ok(font::GlyphId::from_raw(row.get::<_, String>(0)?))
            })?;
            for row in rows {
                result.insert(row?);
            }
        }
        let mut result: Vec<_> = result.into_iter().collect();
        result.sort_by(|left, right| left.as_str().cmp(right.as_str()));
        Ok(result)
    }
}

pub(super) fn validate_component_index(
    conn: &Connection,
    layer: &font::GlyphLayer,
) -> Result<(), StoreError> {
    let mut stmt = conn.prepare_cached(
        "
        SELECT id, base_glyph_id, order_index
        FROM glyph_components
        WHERE layer_id = ?1
        ORDER BY order_index, id
        ",
    )?;
    let indexed = stmt
        .query_map([layer.id().to_string()], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    validate_component_rows(layer, &indexed)
}

pub(super) fn validate_component_rows(
    layer: &font::GlyphLayer,
    indexed: &[(String, String, i64)],
) -> Result<(), StoreError> {
    let authored: Vec<_> = layer
        .components_iter()
        .enumerate()
        .map(|(order_index, component)| {
            (
                component.id().to_string(),
                component.base_glyph_id().to_string(),
                order_index as i64,
            )
        })
        .collect();
    if indexed != authored {
        return Err(StoreError::StaleLayerReferenceIndex {
            layer_id: layer.id().to_string(),
        });
    }
    Ok(())
}
