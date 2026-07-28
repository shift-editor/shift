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

    #[error(transparent)]
    PackedLayer(#[from] shift_font::PackedLayerError),

    #[error("unsupported glyph layer payload format: {0}")]
    UnsupportedLayerFormat(String),

    #[error("glyph layer payload has {bytes} bytes; limit is {limit}")]
    LayerPayloadTooLarge { bytes: u64, limit: u64 },

    #[error("glyph layer read batch has {layers} layers; limit is {limit}")]
    LayerReadBatchTooLarge { layers: usize, limit: usize },

    #[error("glyph layer read batch has {bytes} payload bytes; limit is {limit}")]
    LayerReadBatchPayloadTooLarge { bytes: u64, limit: u64 },

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

    #[error("missing {kind}: {id}")]
    MissingEntity { kind: &'static str, id: String },

    #[error("store schema version {found} is newer than supported version {supported}")]
    UnsupportedSchemaVersion { found: i64, supported: i64 },
}
