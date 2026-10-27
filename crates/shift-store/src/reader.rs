use std::path::Path;

use rusqlite::{Connection, OpenFlags};
use shift_font as font;

use crate::StoreError;
use crate::connection::configure_common;
use crate::layer::{
    dependent_glyph_ids_for_layers_from_conn, load_glyph_layers_from_conn,
    referenced_glyph_closure_from_conn,
};
use crate::recovery::attach_merged_views;
use crate::schema;

/// A read-only view of a store for a process that loads layers while another
/// process owns and writes the store.
///
/// The editor's renderer reads layers through one while the workspace writes
/// through a [`crate::ShiftStore`]. It sees each committed write, including
/// unsaved edits in a document's recovery overlay, and never writes, creates,
/// migrates, or reconciles anything.
pub struct StoreReader {
    conn: Connection,
}

impl StoreReader {
    /// Reads a document together with its recovery overlay, as the writer
    /// that opened them shows them.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::Sqlite`] when either file cannot be opened read-only, and the
    /// document header errors when `document_path` is not a supported Shift document.
    pub fn open_document(
        document_path: impl AsRef<Path>,
        recovery_path: impl AsRef<Path>,
    ) -> Result<Self, StoreError> {
        let conn = open_read_only(document_path.as_ref())?;
        schema::validate_document_header(&conn)?;
        attach_merged_views(&conn, recovery_path.as_ref())?;
        Self::finish(conn)
    }

    /// Reads a working store, the database behind an untitled or imported
    /// workspace.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::Sqlite`] when the store cannot be opened read-only.
    pub fn open_working_store(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        Self::finish(open_read_only(path.as_ref())?)
    }

    fn finish(conn: Connection) -> Result<Self, StoreError> {
        // After the temporary views exist: query_only also refuses TEMP DDL.
        conn.pragma_update(None, "query_only", "ON")?;
        Ok(Self { conn })
    }

    /// The content of `layer_ids`, validated against their directory rows as
    /// [`crate::ShiftStore::load_glyph_layers`] validates them, all from one
    /// committed state of the store.
    ///
    /// # Errors
    ///
    /// As [`crate::ShiftStore::load_glyph_layers`].
    pub fn load_glyph_layers(
        &self,
        layer_ids: &[font::LayerId],
    ) -> Result<Vec<font::GlyphLayer>, StoreError> {
        self.read(|conn| load_glyph_layers_from_conn(conn, layer_ids))
    }

    /// As [`crate::ShiftStore::referenced_glyph_closure`].
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::Sqlite`] when a read fails.
    pub fn referenced_glyph_closure(
        &self,
        roots: impl IntoIterator<Item = font::GlyphId>,
    ) -> Result<Vec<font::GlyphId>, StoreError> {
        self.read(|conn| referenced_glyph_closure_from_conn(conn, roots))
    }

    /// As [`crate::ShiftStore::dependent_glyph_ids_for_layers`].
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::Sqlite`] when the read fails.
    pub fn dependent_glyph_ids_for_layers(
        &self,
        layer_ids: &[font::LayerId],
    ) -> Result<Vec<font::GlyphId>, StoreError> {
        self.read(|conn| dependent_glyph_ids_for_layers_from_conn(conn, layer_ids))
    }

    /// Runs `read` in one read transaction, so every query in it sees the
    /// same committed state even while the writer commits in between.
    fn read<T>(
        &self,
        read: impl FnOnce(&Connection) -> Result<T, StoreError>,
    ) -> Result<T, StoreError> {
        let snapshot = self.conn.unchecked_transaction()?;
        let value = read(&snapshot)?;
        snapshot.commit()?;
        Ok(value)
    }
}

fn open_read_only(path: &Path) -> Result<Connection, StoreError> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    configure_common(&conn)?;
    Ok(conn)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ShiftStore;

    #[test]
    fn a_reader_reads_a_working_store_and_refuses_to_write() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("working.sqlite");
        let font = shift_font::test_support::sample_font();
        let mut store = ShiftStore::open(&path).unwrap();
        store.replace_font_state(&font).unwrap();

        let reader = StoreReader::open_working_store(&path).unwrap();
        let layer_ids: Vec<font::LayerId> = font.layer_ids().collect();
        let mut layers = reader.load_glyph_layers(&layer_ids).unwrap();
        layers.sort_by_key(font::GlyphLayer::id);
        let mut expected: Vec<font::GlyphLayer> = layer_ids
            .iter()
            .map(|layer_id| font.layer(*layer_id).unwrap().clone())
            .collect();
        expected.sort_by_key(font::GlyphLayer::id);
        assert_eq!(layers, expected);

        assert!(reader.conn.execute("DELETE FROM glyph_layers", []).is_err());
        assert_eq!(
            store.load_glyph_layers(&layer_ids).unwrap().len(),
            layer_ids.len()
        );
    }

    #[test]
    fn one_read_sees_one_committed_state_while_the_writer_commits() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("working.sqlite");
        let font = shift_font::test_support::sample_font();
        let mut store = ShiftStore::open(&path).unwrap();
        store.replace_font_state(&font).unwrap();
        let reader = StoreReader::open_working_store(&path).unwrap();
        let count = |conn: &Connection| -> Result<i64, StoreError> {
            Ok(conn.query_row("SELECT COUNT(*) FROM glyph_layers", [], |row| row.get(0))?)
        };

        let (before, during) = reader
            .read(|conn| {
                let before = count(conn)?;
                let mut grown = font.clone();
                let source_id = grown.default_source_id().unwrap();
                let glyph_id = grown.insert_glyph(font::Glyph::new("added")).unwrap();
                grown
                    .insert_glyph_layer(
                        glyph_id,
                        font::GlyphLayer::new(font::LayerId::new(), source_id),
                    )
                    .unwrap();
                store.replace_font_state(&grown).unwrap();
                Ok((before, count(conn)?))
            })
            .unwrap();

        assert_eq!(
            during, before,
            "a commit mid-read stays invisible to that read"
        );
        assert_eq!(
            reader.read(count).unwrap(),
            before + 1,
            "the next read sees it"
        );
    }
}
