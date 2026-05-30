#[derive(Debug, thiserror::Error)]
pub enum DocumentError {
    #[error("store error")]
    Store(#[from] shift_store::StoreError),

    #[error("document projection failed: {0}")]
    Projection(String),

    #[error("document edit failed: {0}")]
    Edit(String),
}
