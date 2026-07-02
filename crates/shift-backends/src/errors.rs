use std::path::PathBuf;

use crate::designspace::DesignspaceError;
use crate::format::FontFormat;

#[derive(Debug, thiserror::Error)]
pub enum BackendError {
    #[error("file has no extension: {path}")]
    MissingExtension { path: PathBuf },

    #[error("invalid UTF-8 in path: {path}")]
    InvalidPathUtf8 { path: PathBuf },

    #[error("invalid UTF-8 in extension for path: {path}")]
    InvalidExtensionUtf8 { path: PathBuf },

    #[error("unsupported font format: {extension}")]
    UnsupportedFormat { extension: String },

    #[error("unsupported font format for writing: {extension}")]
    UnsupportedWriteFormat { extension: String },

    #[error("font format adaptor is not registered: {}", format.name())]
    MissingAdaptor { format: FontFormat },

    #[error("failed to load {} font from '{path}': {source}", format.name())]
    Load {
        format: FontFormat,
        path: PathBuf,
        #[source]
        source: FormatBackendError,
    },

    #[error("failed to save {} font to '{path}': {source}", format.name())]
    Save {
        format: FontFormat,
        path: PathBuf,
        #[source]
        source: FormatBackendError,
    },
}

impl BackendError {
    pub fn load(format: FontFormat, path: impl Into<PathBuf>, source: FormatBackendError) -> Self {
        Self::Load {
            format,
            path: path.into(),
            source,
        }
    }

    pub fn save(format: FontFormat, path: impl Into<PathBuf>, source: FormatBackendError) -> Self {
        Self::Save {
            format,
            path: path.into(),
            source,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum FormatBackendError {
    #[error(transparent)]
    Designspace(#[from] DesignspaceError),

    #[error(transparent)]
    Font(#[from] shift_font::CoreError),

    #[error(transparent)]
    Shift(#[from] shift_source::SourcePackageError),

    #[error("UFO backend error: {0}")]
    Ufo(String),

    #[error("invalid {kind} name {name:?}: UFO names must be non-empty and contain no control characters")]
    UfoName { kind: &'static str, name: String },

    #[error("Glyphs backend error: {0}")]
    Glyphs(String),

    #[error("binary font backend error: {0}")]
    Binary(String),

    #[error("writing is not supported for this format")]
    WriteUnsupported,
}

pub type BackendResult<T> = Result<T, BackendError>;
pub type FormatBackendResult<T> = Result<T, FormatBackendError>;
