use std::path::{Path, PathBuf};

use shift_store::{DocumentId, ShiftStore};

use crate::WorkspaceError;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DocumentIdentity {
    pub document_id: DocumentId,
    pub canonical_path: PathBuf,
}

pub(crate) fn document_identity(
    path: impl AsRef<Path>,
) -> Result<DocumentIdentity, WorkspaceError> {
    let path = path.as_ref();
    // Identity only: opening the document runs the full integrity check.
    let metadata = ShiftStore::inspect_document_identity(path)?;
    let canonical_path = std::fs::canonicalize(path)?;

    Ok(DocumentIdentity {
        document_id: metadata.document_id,
        canonical_path,
    })
}
