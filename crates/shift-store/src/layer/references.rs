#[cfg(test)]
use std::cell::Cell;
use std::collections::{BTreeSet, HashMap, HashSet};

use rusqlite::Connection;
use shift_font as font;

use crate::numeric::sql_int;
use crate::{ShiftStore, StoreError};

pub(super) const MAX_COMPONENT_QUERY_BATCH_COUNT: usize = 512;

#[cfg(test)]
thread_local! {
    pub(super) static COMPONENT_CLOSURE_QUERY_COUNT: Cell<usize> = const { Cell::new(0) };
}

impl ShiftStore {
    /// Returns every direct glyph-component edge from one ordered relational
    /// scan. Glyphs without components are absent from the map.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::Sqlite`] when the read fails.
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
                row.get::<_, font::GlyphId>(0)?,
                row.get::<_, font::GlyphId>(1)?,
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
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::Sqlite`] when the read fails.
    pub fn referenced_glyph_ids_for_glyph(
        &self,
        glyph_id: font::GlyphId,
    ) -> Result<Vec<font::GlyphId>, StoreError> {
        self.referenced_glyph_ids_for_glyphs(std::slice::from_ref(&glyph_id))
    }

    /// Returns the deduplicated direct component bases for a bounded root set.
    ///
    /// Queries canonical/recovery merged truth in batches of at most
    /// `MAX_COMPONENT_QUERY_BATCH_COUNT` roots and returns stable identity order.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::Sqlite`] when the read fails.
    pub fn referenced_glyph_ids_for_glyphs(
        &self,
        glyph_ids: &[font::GlyphId],
    ) -> Result<Vec<font::GlyphId>, StoreError> {
        referenced_glyph_ids_for_glyphs_from_conn(&self.conn, glyph_ids)
    }

    /// Computes the transitive component closure without scanning payloads.
    ///
    /// Traversal is cycle-safe and expands one deduplicated frontier through
    /// [`Self::referenced_glyph_ids_for_glyphs`], so query work scales with
    /// graph depth and bounded frontier batches rather than reachable nodes.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::Sqlite`] when a read fails.
    pub fn referenced_glyph_closure(
        &self,
        roots: impl IntoIterator<Item = font::GlyphId>,
    ) -> Result<Vec<font::GlyphId>, StoreError> {
        referenced_glyph_closure_from_conn(&self.conn, roots)
    }

    /// Every glyph the components of `glyph_ids` use, transitively, other
    /// than `glyph_ids` themselves: [`Self::referenced_glyph_closure`]
    /// without its roots.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::Sqlite`] when a read fails.
    pub fn bases_of(&self, glyph_ids: &[font::GlyphId]) -> Result<Vec<font::GlyphId>, StoreError> {
        bases_of_from_conn(&self.conn, glyph_ids)
    }

    /// Glyphs with a component whose base is one of `glyph_ids`, directly;
    /// not the composites of those composites.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::Sqlite`] when the read fails.
    pub fn composites_of(
        &self,
        glyph_ids: &[font::GlyphId],
    ) -> Result<Vec<font::GlyphId>, StoreError> {
        composites_of_from_conn(&self.conn, glyph_ids)
    }

    /// Reverse-reference lookup used for dependent invalidation.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::Sqlite`] when the read fails.
    pub fn dependent_glyph_ids_for_layers(
        &self,
        layer_ids: &[font::LayerId],
    ) -> Result<Vec<font::GlyphId>, StoreError> {
        dependent_glyph_ids_for_layers_from_conn(&self.conn, layer_ids)
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
        .query_map([layer.id()], |row| {
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
                sql_int(order_index),
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

pub(crate) fn referenced_glyph_ids_for_glyphs_from_conn(
    conn: &Connection,
    glyph_ids: &[font::GlyphId],
) -> Result<Vec<font::GlyphId>, StoreError> {
    // The id list is one JSON parameter, not a placeholder per id, so the
    // statement text is the same for every batch and stays prepared. Through
    // the recovery views, preparing it costs far more than running it.
    //
    // Keys go through IN subqueries, not joins: a recovered document reads
    // through merged UNION ALL views, and SQLite pushes WHERE terms into
    // them but not join terms, so a join scans every component row.
    let mut stmt = conn.prepare_cached(
        "SELECT DISTINCT c.base_glyph_id
         FROM glyph_components AS c
         WHERE c.layer_id IN (
             SELECT l.id FROM glyph_layers AS l
             WHERE l.glyph_id IN (SELECT value FROM json_each(?1))
         )",
    )?;
    let mut result = BTreeSet::new();
    for count_batch in glyph_ids.chunks(MAX_COMPONENT_QUERY_BATCH_COUNT) {
        #[cfg(test)]
        COMPONENT_CLOSURE_QUERY_COUNT.with(|count| count.set(count.get() + 1));

        let rows = stmt.query_map([serde_json::to_string(count_batch)?], |row| {
            row.get::<_, font::GlyphId>(0)
        })?;
        for row in rows {
            result.insert(row?);
        }
    }
    Ok(result.into_iter().collect())
}

pub(crate) fn referenced_glyph_closure_from_conn(
    conn: &Connection,
    roots: impl IntoIterator<Item = font::GlyphId>,
) -> Result<Vec<font::GlyphId>, StoreError> {
    let mut pending = roots.into_iter().collect::<Vec<_>>();
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    while !pending.is_empty() {
        let glyph_ids = pending
            .drain(..)
            .filter(|glyph_id| seen.insert(*glyph_id))
            .inspect(|glyph_id| result.push(*glyph_id))
            .collect::<Vec<_>>();
        if glyph_ids.is_empty() {
            continue;
        }

        pending.extend(referenced_glyph_ids_for_glyphs_from_conn(conn, &glyph_ids)?);
    }
    Ok(result)
}

pub(crate) fn bases_of_from_conn(
    conn: &Connection,
    glyph_ids: &[font::GlyphId],
) -> Result<Vec<font::GlyphId>, StoreError> {
    let roots: HashSet<font::GlyphId> = glyph_ids.iter().copied().collect();
    let mut closure = referenced_glyph_closure_from_conn(conn, glyph_ids.iter().copied())?;
    closure.retain(|glyph_id| !roots.contains(glyph_id));
    Ok(closure)
}

pub(crate) fn composites_of_from_conn(
    conn: &Connection,
    glyph_ids: &[font::GlyphId],
) -> Result<Vec<font::GlyphId>, StoreError> {
    if glyph_ids.is_empty() {
        return Ok(Vec::new());
    }
    // As in `dependent_glyph_ids_for_layers_from_conn`, with the bases given
    // directly rather than found from their layers.
    let mut stmt = conn.prepare_cached(
        "WITH users AS MATERIALIZED (
             SELECT c.layer_id FROM glyph_components AS c
             WHERE c.base_glyph_id IN (SELECT value FROM json_each(?1))
         )
         SELECT DISTINCT owner.glyph_id
         FROM glyph_layers AS owner
         WHERE owner.id IN users",
    )?;
    let mut result = BTreeSet::new();
    for count_batch in glyph_ids.chunks(MAX_COMPONENT_QUERY_BATCH_COUNT) {
        let rows = stmt.query_map([serde_json::to_string(count_batch)?], |row| {
            row.get::<_, font::GlyphId>(0)
        })?;
        for row in rows {
            result.insert(row?);
        }
    }
    Ok(result.into_iter().collect())
}

pub(crate) fn dependent_glyph_ids_for_layers_from_conn(
    conn: &Connection,
    layer_ids: &[font::LayerId],
) -> Result<Vec<font::GlyphId>, StoreError> {
    if layer_ids.is_empty() {
        return Ok(Vec::new());
    }
    // One JSON parameter and IN subqueries, as in
    // `referenced_glyph_ids_for_glyphs_from_conn`. `users` is materialised:
    // otherwise SQLite pushes `IN users` into both arms of the merged
    // `glyph_layers` view and finds the component rows once per arm.
    let mut stmt = conn.prepare_cached(
        "WITH users AS MATERIALIZED (
             SELECT c.layer_id FROM glyph_components AS c
             WHERE c.base_glyph_id IN (
                 SELECT target.glyph_id FROM glyph_layers AS target
                 WHERE target.id IN (SELECT value FROM json_each(?1))
             )
         )
         SELECT DISTINCT owner.glyph_id
         FROM glyph_layers AS owner
         WHERE owner.id IN users",
    )?;
    let mut result = BTreeSet::new();
    for count_batch in layer_ids.chunks(MAX_COMPONENT_QUERY_BATCH_COUNT) {
        let rows = stmt.query_map([serde_json::to_string(count_batch)?], |row| {
            row.get::<_, font::GlyphId>(0)
        })?;
        for row in rows {
            result.insert(row?);
        }
    }
    Ok(result.into_iter().collect())
}
