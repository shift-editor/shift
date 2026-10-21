// Library code returns errors instead of panicking: a panic kills the
// WebAssembly engine. Tests may unwrap (clippy.toml).
#![warn(clippy::unwrap_used, clippy::print_stdout)]

mod change_set;
mod columns;
mod connection;
mod document;
mod error;
mod font;
mod font_state;
mod glyph;
mod import_writer;
mod layer;
mod numeric;
mod recovery;
mod schema;
mod source;
mod sql_text;
mod store;
mod types;
mod workspace_state;
mod write_mode;

pub use document::DocumentMetadata;
pub use error::{StoreEntity, StoreError};
pub use font::FontInfo;
pub use glyph::{GlyphRecord, NewGlyph};
pub use import_writer::{FontImportWriter, encode_glyph_batch};
pub use layer::{
    GLYPH_LAYER_FORMAT, GlyphLayerDirectoryEntry, MAX_LAYER_READ_BATCH_COUNT,
    MAX_LAYER_READ_BATCH_DECODED_BYTES,
};
pub use recovery::{RecoveryOverlay, RecoveryState};
pub use schema::{SHIFT_APPLICATION_ID, SHIFT_DOCUMENT_SCHEMA_VERSION};
pub use source::{AxisRecord, NewAxis, NewSource, SourceAxisLocation, SourceKind, SourceRecord};
pub use store::ShiftStore;
pub use types::{
    AxisId, CommitId, DocumentId, GlyphId, GlyphWriteBatch, LayerBatchTiming, RevisionId, SourceId,
};
pub use workspace_state::{SaveState, WorkspaceSourceKind, WorkspaceState};
