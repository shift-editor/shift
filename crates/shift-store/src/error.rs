#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("sqlite error")]
    Sqlite(#[from] rusqlite::Error),

    #[error("json error")]
    Json(#[from] serde_json::Error),

    #[error("font error")]
    Font(#[from] shift_font::error::CoreError),

    #[error("unknown source kind: {0}")]
    UnknownSourceKind(String),

    #[error("invalid point type: {0}")]
    InvalidPointType(String),

    #[error("invalid lib value: {0}")]
    InvalidLibValue(String),

    #[error("missing {kind}: {id}")]
    MissingEntity { kind: &'static str, id: String },

    #[error("store schema version {found} is newer than supported version {supported}")]
    UnsupportedSchemaVersion { found: i64, supported: i64 },
}
