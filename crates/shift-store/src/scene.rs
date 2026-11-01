//! The document's scene, one row per node.
//!
//! Each row holds a node as named MessagePack, with its parent, sibling index
//! and kind beside it for queries. Scene rows are document content: Save,
//! Save As, recovery and Discard carry them like font rows, and export never
//! reads them. A change that touches only the scene marks the document
//! unsaved without advancing the revision that addresses font-derived caches.

use rusqlite::{Connection, Transaction, params};
use shift_engine::scene::{DEFAULT_PAGE_NAME, Scene, SceneChange, SceneChangeSet, SceneNode};
use shift_font::Replacement;

use crate::{ShiftStore, StoreError};

impl ShiftStore {
    /// The document's scene, unsaved edits included; empty for a document
    /// that never stored one.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::Sqlite`] when the rows cannot be read and
    /// [`StoreError::SceneNodeDecoding`] when one does not decode.
    pub fn load_scene(&self) -> Result<Scene, StoreError> {
        Ok(scene_nodes_from_conn(&self.conn)?.into_iter().collect())
    }

    /// Gives a store whose scene has no page its first page,
    /// [`DEFAULT_PAGE_NAME`], written to its own rows rather than as an
    /// unsaved edit: for a new document or working store. Does nothing when
    /// the scene has a page.
    ///
    /// # Errors
    ///
    /// As [`Self::load_scene`], and [`StoreError::Sqlite`] or
    /// [`StoreError::SceneNodeEncoding`] when the page cannot be written.
    pub fn ensure_scene_page(&mut self) -> Result<(), StoreError> {
        if self.load_scene()?.pages().next().is_some() {
            return Ok(());
        }
        let tx = self.conn.transaction()?;
        insert_first_page_in_tx(&tx)?;
        tx.commit()?;
        Ok(())
    }
}

/// Writes a [`DEFAULT_PAGE_NAME`] page to `tx`'s main database.
pub(crate) fn insert_first_page_in_tx(tx: &Transaction<'_>) -> Result<(), StoreError> {
    let page = SceneNode::new_page(DEFAULT_PAGE_NAME);
    let changes = SceneChangeSet {
        changes: vec![SceneChange {
            id: page.id.clone(),
            node: Replacement::new(None, Some(page)),
        }],
    };
    write_scene_changes_in_tx(tx, &changes, "main", |_, _| Ok(()), |_, _| Ok(()))
}

/// Every stored scene node, in id order.
pub(crate) fn scene_nodes_from_conn(conn: &Connection) -> Result<Vec<SceneNode>, StoreError> {
    let mut statement = conn.prepare("SELECT id, node FROM scene_nodes ORDER BY id")?;
    let rows = statement.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))
    })?;
    rows.map(|row| {
        let (id, bytes) = row?;
        rmp_serde::from_slice(&bytes).map_err(|source| StoreError::SceneNodeDecoding { id, source })
    })
    .collect()
}

/// Writes `changes` to the scene rows of `tx`'s database `schema`: each node
/// as it now is, and no row for a node removed. `deleted` runs for each removed id, as a recovery
/// overlay marks a tombstone, and `written` for each written one.
pub(crate) fn write_scene_changes_in_tx(
    tx: &Transaction<'_>,
    changes: &SceneChangeSet,
    schema: &str,
    mut deleted: impl FnMut(&Transaction<'_>, &str) -> Result<(), StoreError>,
    mut written: impl FnMut(&Transaction<'_>, &str) -> Result<(), StoreError>,
) -> Result<(), StoreError> {
    for change in &changes.changes {
        let id = change.id.as_str();
        let Some(node) = &change.node.after else {
            tx.execute(
                &format!("DELETE FROM {schema}.scene_nodes WHERE id = ?1"),
                [id],
            )?;
            deleted(tx, id)?;
            continue;
        };
        let bytes =
            rmp_serde::to_vec_named(node).map_err(|source| StoreError::SceneNodeEncoding {
                id: id.to_owned(),
                source,
            })?;
        tx.execute(
            &format!(
                "INSERT INTO {schema}.scene_nodes (id, parent_id, sort_index, kind, node)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET
                parent_id = excluded.parent_id,
                sort_index = excluded.sort_index,
                kind = excluded.kind,
                node = excluded.node"
            ),
            params![
                id,
                node.parent_id.as_ref().map(shift_font::NodeId::as_str),
                node.index,
                node.kind().as_str(),
                bytes
            ],
        )?;
        written(tx, id)?;
    }
    Ok(())
}
