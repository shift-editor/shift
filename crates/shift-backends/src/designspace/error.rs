use std::path::PathBuf;

use crate::errors::FormatBackendError;

pub type DesignspaceResult<T> = Result<T, DesignspaceError>;

#[derive(Debug, thiserror::Error)]
pub enum DesignspaceError {
    #[error("cannot determine directory of '{path}'")]
    MissingParent { path: PathBuf },

    #[error("invalid UTF-8 in path '{path}'")]
    InvalidPathUtf8 { path: PathBuf },

    #[error("invalid designspace path '{path}'")]
    InvalidDesignspacePath { path: PathBuf },

    #[error("designspace has no sources")]
    NoSources,

    #[error("designspace has no source at the mapped default location")]
    MissingDefaultSource,

    #[error("failed to read '{path}': {source}")]
    ReadFile {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("failed to write '{path}': {source}")]
    WriteFile {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("failed to create directory '{path}': {source}")]
    CreateDir {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("failed to load designspace '{path}': {details}")]
    LoadDesignspace { path: PathBuf, details: String },

    #[error("failed to save designspace '{path}': {details}")]
    SaveDesignspace { path: PathBuf, details: String },

    #[error("failed to load UFO '{path}': {source}")]
    LoadUfo {
        path: PathBuf,
        #[source]
        source: Box<FormatBackendError>,
    },

    #[error("failed to save UFO '{path}': {details}")]
    SaveUfo { path: PathBuf, details: String },

    #[error("axisless compatibility loader skipped: {reason}")]
    AxislessNotApplicable { reason: String },

    #[error("failed to parse axisless designspace XML: {details}")]
    ParseAxislessXml { details: String },

    #[error("failed to parse designspace XML: {details}")]
    ParseDesignspaceXml { details: String },

    #[error(transparent)]
    Font(#[from] shift_font::CoreError),
}
