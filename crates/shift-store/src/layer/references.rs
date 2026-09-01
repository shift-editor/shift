#[cfg(test)]
use std::cell::Cell;
use std::collections::{HashMap, HashSet};

use rusqlite::Connection;
use shift_font as font;

use crate::{ShiftStore, StoreError};

pub(super) const MAX_COMPONENT_QUERY_BATCH_COUNT: usize = 512;

#[cfg(test)]
thread_local! {
    pub(super) static COMPONENT_CLOSURE_QUERY_COUNT: Cell<usize> = const { Cell::new(0) };
}

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

    /// Returns direct component bases for one glyph from the relational index.
    pub fn referenced_glyph_ids_for_glyph(
        &self,
        glyph_id: &font::GlyphId,
    ) -> Result<Vec<font::GlyphId>, StoreError> {
        self.referenced_glyph_ids_for_glyphs(std::slice::from_ref(glyph_id))
    }

    /// Returns the deduplicated direct component bases for a bounded root set.
    ///
    /// Queries canonical/recovery merged truth in batches of at most
    /// `MAX_COMPONENT_QUERY_BATCH_COUNT` roots and returns stable identity order.
    pub fn referenced_glyph_ids_for_glyphs(
        &self,
        glyph_ids: &[font::GlyphId],
    ) -> Result<Vec<font::GlyphId>, StoreError> {
        let mut result = HashSet::new();
        for count_batch in glyph_ids.chunks(MAX_COMPONENT_QUERY_BATCH_COUNT) {
            #[cfg(test)]
            COMPONENT_CLOSURE_QUERY_COUNT.with(|count| count.set(count.get() + 1));

            let placeholders = (0..count_batch.len())
                .map(|_| "?")
                .collect::<Vec<_>>()
                .join(",");
            let sql = format!(
                "SELECT DISTINCT c.base_glyph_id
                 FROM glyph_components AS c
                 JOIN glyph_layers AS l ON l.id = c.layer_id
                 WHERE l.glyph_id IN ({placeholders})"
            );
            let mut stmt = self.conn.prepare(&sql)?;
            let rows = stmt.query_map(
                rusqlite::params_from_iter(count_batch.iter().map(ToString::to_string)),
                |row| Ok(font::GlyphId::from_raw(row.get::<_, String>(0)?)),
            )?;
            for row in rows {
                result.insert(row?);
            }
        }

        let mut result = result.into_iter().collect::<Vec<_>>();
        result.sort_by(|left, right| left.as_str().cmp(right.as_str()));
        Ok(result)
    }

    /// Computes the transitive component closure without scanning payloads.
    ///
    /// Traversal is cycle-safe and expands one deduplicated frontier through
    /// [`Self::referenced_glyph_ids_for_glyphs`], so query work scales with
    /// graph depth and bounded frontier batches rather than reachable nodes.
    pub fn referenced_glyph_closure(
        &self,
        roots: impl IntoIterator<Item = font::GlyphId>,
    ) -> Result<Vec<font::GlyphId>, StoreError> {
        let mut pending = roots.into_iter().collect::<Vec<_>>();
        let mut seen = HashSet::new();
        let mut result = Vec::new();
        while !pending.is_empty() {
            let glyph_ids = pending
                .drain(..)
                .filter(|glyph_id| seen.insert(glyph_id.clone()))
                .inspect(|glyph_id| result.push(glyph_id.clone()))
                .collect::<Vec<_>>();
            if glyph_ids.is_empty() {
                continue;
            }

            pending.extend(self.referenced_glyph_ids_for_glyphs(&glyph_ids)?);
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
        for count_batch in layer_ids.chunks(MAX_COMPONENT_QUERY_BATCH_COUNT) {
            let placeholders = (0..count_batch.len())
                .map(|_| "?")
                .collect::<Vec<_>>()
                .join(",");
            let sql = format!(
                "SELECT DISTINCT owner.glyph_id
                 FROM glyph_components AS c
                 JOIN glyph_layers AS target ON target.glyph_id = c.base_glyph_id
                 JOIN glyph_layers AS owner ON owner.id = c.layer_id
                 WHERE target.id IN ({placeholders})"
            );
            let mut stmt = self.conn.prepare(&sql)?;
            let rows = stmt.query_map(
                rusqlite::params_from_iter(count_batch.iter().map(ToString::to_string)),
                |row| Ok(font::GlyphId::from_raw(row.get::<_, String>(0)?)),
            )?;
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
