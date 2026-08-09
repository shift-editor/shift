#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("store file-system error: {0}")]
    Io(#[from] std::io::Error),

    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),

    #[error(transparent)]
    Font(#[from] shift_font::error::CoreError),

    #[error("glyph layer encoding failed: {0}")]
    LayerEncoding(String),

    #[error("glyph layer decoding failed: {0}")]
    LayerDecoding(String),

    #[error("invalid glyph layer payload: {0}")]
    InvalidLayerPayload(String),

    #[error("unsupported glyph layer payload format: {0}")]
    UnsupportedLayerFormat(String),

    #[error("unsupported glyph layer compression: {0}")]
    UnsupportedLayerCompression(String),

    #[error("glyph layer compression failed: {0}")]
    LayerCompression(String),

    #[error("glyph layer decompression failed: {0}")]
    LayerDecompression(String),

    #[error("glyph layer payload has {bytes} bytes; limit is {limit}")]
    LayerPayloadTooLarge { bytes: u64, limit: u64 },

    #[error("glyph layer read batch has {layers} layers; limit is {limit}")]
    LayerReadBatchTooLarge { layers: usize, limit: usize },

    #[error("glyph layer read batch has {bytes} decoded bytes; limit is {limit}")]
    LayerReadBatchDecodedTooLarge { bytes: u64, limit: u64 },

    #[error("glyph layer {layer_id} payload disagrees with its directory: {detail}")]
    LayerDirectoryMismatch { layer_id: String, detail: String },

    #[error("glyph layer {layer_id} has a stale component/reference index")]
    StaleLayerReferenceIndex { layer_id: String },

    #[error("unknown source kind: {0}")]
    UnknownSourceKind(String),

    #[error("invalid point type: {0}")]
    InvalidPointType(String),

    #[error("invalid lib value: {0}")]
    InvalidLibValue(String),

    #[error("invalid workspace state: {0}")]
    InvalidWorkspaceState(String),

    #[error("import destination already contains published workspace state: {0}")]
    ImportDestinationNotEmpty(std::path::PathBuf),

    #[error("document already exists: {0}")]
    DocumentAlreadyExists(std::path::PathBuf),

    #[error("invalid SQLite application ID {found:#010x}; expected {expected:#010x}")]
    InvalidApplicationId { found: i64, expected: i64 },

    #[error("canonical Shift documents must be opened with ShiftStore::open_document")]
    DocumentRequiresDocumentOpen,

    #[error("invalid Shift document: {0}")]
    InvalidDocument(String),

    #[error("invalid document ID: {0}")]
    InvalidDocumentId(String),

    #[error("missing {kind}: {id}")]
    MissingEntity { kind: &'static str, id: String },

    #[error("store schema version {found} is newer than supported version {supported}")]
    UnsupportedSchemaVersion { found: i64, supported: i64 },

    #[error(
        "Shift document schema version {found} is unsupported; this build supports {supported}"
    )]
    UnsupportedDocumentSchemaVersion { found: i64, supported: i64 },
}
