#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("sqlite error")]
    Sqlite(#[from] rusqlite::Error),

    #[error("unknown source kind: {0}")]
    UnknownSourceKind(String),
}
