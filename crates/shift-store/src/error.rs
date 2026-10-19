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
    LayerEncoding(#[from] rmp_serde::encode::Error),

    #[error("glyph layer decoding failed: {0}")]
    LayerDecoding(#[from] rmp_serde::decode::Error),

    #[error("glyph layer decoding failed: payload has {0} trailing bytes")]
    TrailingLayerBytes(usize),

    #[error("invalid glyph layer payload: {0}")]
    InvalidLayerPayload(String),

    #[error("unsupported glyph layer payload format: {0}")]
    UnsupportedLayerFormat(String),

    #[error("unsupported glyph layer compression: {0}")]
    UnsupportedLayerCompression(String),

    #[error("glyph layer compression failed: {0}")]
    LayerCompression(#[source] std::io::Error),

    #[error("glyph layer decompression failed: {0}")]
    LayerDecompression(#[source] std::io::Error),

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

    #[error("recovery overlay already exists: {0}")]
    RecoveryAlreadyExists(std::path::PathBuf),

    #[error("invalid SQLite application ID {found:#010x}; expected {expected:#010x}")]
    InvalidApplicationId { found: i64, expected: i64 },

    #[error("canonical Shift documents must be opened with ShiftStore::open_document")]
    DocumentRequiresDocumentOpen,

    #[error("invalid Shift document: {0}")]
    InvalidDocument(String),

    #[error("invalid document ID: {0}")]
    InvalidDocumentId(String),

    #[error("invalid commit ID: {0}")]
    InvalidCommitId(String),

    #[error("recovery overlay belongs to document {found}, not {expected}")]
    RecoveryDocumentMismatch { found: String, expected: String },

    #[error("recovery operation requires state {expected}, found {found}")]
    InvalidRecoveryTransition {
        expected: &'static str,
        found: &'static str,
    },

    #[error("canonical document edits require a recovery overlay")]
    DocumentRequiresRecoveryOverlay,

    #[error("recovery edits require the committed post-edit font")]
    RecoveryRequiresPostFont,

    #[error("invalid glyph order: one committed change set cannot both append and pop glyphs")]
    AppendAndPopGlyphs,

    #[error("invalid glyph order: appended identity {0} is not in the tail segment")]
    AppendedGlyphNotAtTail(shift_font::GlyphId),

    #[error("invalid glyph order: popped identity {0} is not the directory tail")]
    PoppedGlyphNotAtTail(shift_font::GlyphId),

    #[error("invalid glyph order: identity {0} is not the directory tail")]
    GlyphNotAtTail(shift_font::GlyphId),

    #[error("integer out of range: {0}")]
    IntegerOutOfRange(#[from] std::num::TryFromIntError),

    #[error("missing {kind}: {id}")]
    MissingEntity { kind: StoreEntity, id: String },

    #[error("store schema version {found} is newer than supported version {supported}")]
    UnsupportedSchemaVersion { found: i64, supported: i64 },

    #[error(
        "Shift document schema version {found} is unsupported; this build supports {supported}"
    )]
    UnsupportedDocumentSchemaVersion { found: i64, supported: i64 },
}

/// A kind of row the store looks up by id.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StoreEntity {
    FontInfo,
    Glyph,
    GlyphLayer,
    GlyphLayerPayload,
    GlyphOrder,
}

impl std::fmt::Display for StoreEntity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::FontInfo => "font info",
            Self::Glyph => "glyph",
            Self::GlyphLayer => "glyph layer",
            Self::GlyphLayerPayload => "glyph layer payload",
            Self::GlyphOrder => "glyph order",
        })
    }
}

/// Turns the `Option` of a store lookup into [`StoreError::MissingEntity`].
pub(crate) trait OrMissing<T> {
    /// Returns the found value, or a missing-entity error naming `kind` and `id`.
    ///
    /// `id` is formatted only when the lookup found nothing.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::MissingEntity`] when the lookup found nothing.
    fn or_missing(self, kind: StoreEntity, id: &impl ToString) -> Result<T, StoreError>;
}

impl<T> OrMissing<T> for Option<T> {
    fn or_missing(self, kind: StoreEntity, id: &impl ToString) -> Result<T, StoreError> {
        self.ok_or_else(|| StoreError::MissingEntity {
            kind,
            id: id.to_string(),
        })
    }
}
