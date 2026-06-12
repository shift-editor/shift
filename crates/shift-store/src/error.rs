#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("sqlite error")]
    Sqlite(#[from] rusqlite::Error),

    #[error("unknown source kind: {0}")]
    UnknownSourceKind(String),

    #[error("missing {kind}: {id}")]
    MissingEntity { kind: &'static str, id: String },

    #[error("store schema version {found} is newer than supported version {supported}")]
    UnsupportedSchemaVersion { found: i64, supported: i64 },
}
