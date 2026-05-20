#[derive(Debug, thiserror::Error)]
pub enum BackendError {
    #[error("file has no extension")]
    MissingExtension,

    #[error("invalid UTF-8 in path")]
    InvalidPathUtf8,

    #[error("invalid UTF-8 in extension")]
    InvalidExtensionUtf8,

    #[error("unsupported font format: {0}")]
    UnsupportedFormat(String),

    #[error("unsupported font format for writing: {0}")]
    UnsupportedWriteFormat(String),

    #[error("font format adaptor is not registered: {0}")]
    MissingAdaptor(&'static str),

    #[error("failed to load font: {0}")]
    Load(String),

    #[error("failed to save font: {0}")]
    Save(String),
}

pub type BackendResult<T> = Result<T, BackendError>;
