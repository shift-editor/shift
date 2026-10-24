// Library code returns errors instead of panicking: a panic kills the
// WebAssembly engine. Tests may unwrap (clippy.toml).
#![warn(clippy::unwrap_used, clippy::print_stdout)]

mod document_identity;
mod import_pipeline;
mod import_staging;
mod ledger;
mod new_workspace;
mod workspace;

pub use document_identity::DocumentIdentity;
pub use import_pipeline::{ImportBatchProgress, stream_into};
pub use ledger::{Ledger, LedgerEntry};
pub use new_workspace::NewWorkspace;
pub use workspace::{AcquireScope, FontWorkspace, WorkspaceError, WorkspaceSource};
