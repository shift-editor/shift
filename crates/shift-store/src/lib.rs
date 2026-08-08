mod change_set;
mod connection;
mod document;
mod error;
mod font;
mod font_state;
mod glyph;
mod import_writer;
mod layer;
mod schema;
mod source;
mod store;
mod types;
mod workspace_state;
mod write_mode;

pub use document::DocumentMetadata;
pub use error::StoreError;
pub use font::FontInfo;
pub use glyph::{GlyphRecord, NewGlyph};
pub use import_writer::{FontImportWriter, encode_glyph_batch};
pub use layer::{
    GLYPH_LAYER_FORMAT, GlyphLayerDirectoryEntry, MAX_LAYER_READ_BATCH_COUNT,
    MAX_LAYER_READ_BATCH_DECODED_BYTES,
};
pub use schema::SHIFT_APPLICATION_ID;
pub use source::{AxisRecord, NewAxis, NewSource, SourceAxisLocation, SourceKind, SourceRecord};
pub use store::ShiftStore;
pub use types::{
    AxisId, DocumentId, GlyphId, GlyphWriteBatch, LayerBatchTiming, RevisionId, SourceId,
};
pub use workspace_state::{
    Evidence, FileIdentity, SourceIdentitySnapshot, WorkspaceSourceKind, WorkspaceState,
};
