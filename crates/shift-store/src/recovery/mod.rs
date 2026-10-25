mod catalog;
mod overlay;
mod patch;
mod save;
mod views;

use std::path::Path;

use crate::{ShiftStore, StoreError};

pub use overlay::{RecoveryOverlay, RecoveryState};

/// Attaches the overlay at `path` and shows the merged document through the
/// connection's temporary views, as a recovered store reads it. The
/// connection's open flags carry over, so a read-only connection stays one.
pub(crate) fn attach_merged_views(
    conn: &rusqlite::Connection,
    path: &Path,
) -> Result<(), StoreError> {
    views::attach_recovery(conn, path)?;
    views::install_merged_views(conn)
}

pub(crate) fn apply_overlay_to_snapshot(
    conn: &mut rusqlite::Connection,
    recovery: &RecoveryOverlay,
    commit_id: &crate::CommitId,
) -> Result<(), StoreError> {
    views::attach_recovery(conn, recovery.path())?;
    views::install_merged_views(conn)?;
    save::apply_recovery_to_document(conn, commit_id)
}

impl ShiftStore {
    /// Opens a canonical document with an app-owned sparse recovery overlay.
    ///
    /// Existing unsaved changes are reconciled by document and commit identity,
    /// then exposed through merged lazy reads without modifying the canonical file.
    ///
    /// # Errors
    ///
    /// Returns the errors of [`Self::open_document`]; [`StoreError::RecoveryDocumentMismatch`] when
    /// the overlay belongs to another document; and [`StoreError::Sqlite`] or a metadata error when
    /// the overlay cannot be created, opened or reconciled.
    pub fn open_document_with_recovery(
        document_path: impl AsRef<Path>,
        recovery_path: impl AsRef<Path>,
    ) -> Result<Self, StoreError> {
        let mut store = Self::open_document(document_path)?;
        let document = store.document_metadata()?;
        let recovery_path = recovery_path.as_ref();
        let mut recovery = if recovery_path.exists() {
            RecoveryOverlay::open(recovery_path)?
        } else {
            RecoveryOverlay::create(
                recovery_path,
                &document.document_id,
                &document.saved_commit_id,
            )?
        };
        let recovery_document_id = recovery.document_id()?;
        if recovery_document_id != document.document_id {
            return Err(StoreError::RecoveryDocumentMismatch {
                found: recovery_document_id.to_string(),
                expected: document.document_id.to_string(),
            });
        }
        recovery.reconcile(&document.saved_commit_id)?;
        views::attach_recovery(&store.conn, recovery.path())?;
        views::install_merged_views(&store.conn)?;
        store.recovery = Some(recovery);
        Ok(store)
    }

    /// Returns the attached recovery lifecycle state, if this is a recovered document.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::Sqlite`] when the overlay metadata cannot be read, and
    /// [`StoreError::InvalidDocumentId`] or [`StoreError::InvalidCommitId`] when it is malformed.
    pub fn recovery_state(&self) -> Result<Option<RecoveryState>, StoreError> {
        self.recovery
            .as_ref()
            .map(RecoveryOverlay::state)
            .transpose()
    }

    /// Returns the attached recovery overlay's revision, if this is a recovered document.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::Sqlite`] when the revision cannot be read.
    pub fn recovery_revision(&self) -> Result<Option<i64>, StoreError> {
        self.recovery
            .as_ref()
            .map(RecoveryOverlay::revision)
            .transpose()
    }

    /// Clears unsaved overlay changes and exposes the canonical saved rows immediately.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::DocumentRequiresRecoveryOverlay`] when the store has no recovery
    /// overlay, and [`StoreError::Sqlite`] when the overlay cannot be cleared.
    pub fn discard_recovery(&mut self) -> Result<(), StoreError> {
        let saved_commit_id = self.document_metadata()?.saved_commit_id;
        let recovery = self
            .recovery
            .as_mut()
            .ok_or(StoreError::DocumentRequiresRecoveryOverlay)?;
        recovery.discard(&saved_commit_id)
    }

    /// Whether the document, with its unsaved changes, equals what is saved.
    ///
    /// Compares only what the overlay touches, so the cost follows the unsaved
    /// work rather than the font. Rows that are equal but encoded differently
    /// count as changed, so the answer errs towards keeping unsaved work.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::DocumentRequiresRecoveryOverlay`] when the store has no recovery
    /// overlay, and [`StoreError::Sqlite`] when the comparison cannot run.
    pub fn recovery_matches_saved(&self) -> Result<bool, StoreError> {
        if self.recovery.is_none() {
            return Err(StoreError::DocumentRequiresRecoveryOverlay);
        }
        for table in catalog::load_recovery_table_shapes(&self.conn)? {
            let Some(differs) = views::differs_from_saved_sql(&table) else {
                continue;
            };
            let differs: bool = self
                .conn
                .query_row(&format!("SELECT {differs}"), [], |row| row.get(0))?;
            if differs {
                return Ok(false);
            }
        }
        Ok(true)
    }

    /// Applies sparse unsaved changes to the canonical document and acknowledges the commit.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::DocumentRequiresRecoveryOverlay`] when the store has no recovery
    /// overlay, [`StoreError::InvalidRecoveryTransition`] when the overlay is in conflict or
    /// mid-save, and [`StoreError::Sqlite`], [`StoreError::Io`] or a layer-encoding error when the
    /// changes cannot be written to the document.
    pub fn save_document(&mut self) -> Result<crate::DocumentMetadata, StoreError> {
        let document = self.document_metadata()?;
        let state = self
            .recovery
            .as_mut()
            .ok_or(StoreError::DocumentRequiresRecoveryOverlay)?
            .reconcile(&document.saved_commit_id)?;
        if state == RecoveryState::Clean {
            return Ok(document);
        }
        if state != RecoveryState::Dirty {
            return Err(StoreError::InvalidRecoveryTransition {
                expected: "dirty",
                found: state.as_str(),
            });
        }

        let commit_id = self
            .recovery
            .as_mut()
            .expect("recovery state came from an attached overlay")
            .begin_save()?;
        save::apply_recovery_to_document(&mut self.conn, &commit_id)?;
        self.sync_store_file()?;
        self.recovery
            .as_mut()
            .expect("recovery overlay remains attached during save")
            .acknowledge_save(&commit_id)?;
        self.document_metadata()
    }
}
