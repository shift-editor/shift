mod catalog;
mod overlay;
mod patch;
mod save;
mod views;

use std::path::Path;

use crate::{ShiftStore, StoreError};

pub use overlay::{RecoveryOverlay, RecoveryState};

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
    pub fn recovery_state(&self) -> Result<Option<RecoveryState>, StoreError> {
        self.recovery
            .as_ref()
            .map(RecoveryOverlay::state)
            .transpose()
    }

    /// Clears unsaved overlay changes and exposes the canonical saved rows immediately.
    pub fn discard_recovery(&mut self) -> Result<(), StoreError> {
        let saved_commit_id = self.document_metadata()?.saved_commit_id;
        let recovery = self
            .recovery
            .as_mut()
            .ok_or(StoreError::DocumentRequiresRecoveryOverlay)?;
        recovery.discard(&saved_commit_id)
    }

    /// Applies sparse unsaved changes to the canonical document and acknowledges the commit.
    pub fn save_document(&mut self) -> Result<crate::DocumentMetadata, StoreError> {
        let state = self
            .recovery_state()?
            .ok_or(StoreError::DocumentRequiresRecoveryOverlay)?;
        if state == RecoveryState::Clean {
            return self.document_metadata();
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
