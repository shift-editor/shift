use std::path::PathBuf;

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

    #[error("layer '{layer}' not found in '{filename}'")]
    MissingLayer { layer: String, filename: String },

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

    #[error("failed to load UFO '{path}': {details}")]
    LoadUfo { path: PathBuf, details: String },

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
