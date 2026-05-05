use napi::{Error, JsError, Status};
use shift_backends::BackendError;
use shift_edit::error::CoreError;

#[derive(Debug, thiserror::Error)]
pub enum BridgeError {
  #[error("no active edit")]
  NoActiveEdit,

  #[error("edit session already active")]
  ActiveEditAlreadyExists,

  #[error("invalid {kind}: {value}")]
  InvalidInput { kind: &'static str, value: String },

  #[error(transparent)]
  Core(#[from] CoreError),

  #[error(transparent)]
  Backend(#[from] BackendError),
}

pub fn to_napi_error(error: BridgeError) -> Error {
  let status = match &error {
    BridgeError::InvalidInput { .. }
    | BridgeError::Backend(BackendError::MissingExtension)
    | BridgeError::Backend(BackendError::InvalidPathUtf8)
    | BridgeError::Backend(BackendError::InvalidExtensionUtf8)
    | BridgeError::Backend(BackendError::UnsupportedFormat(_))
    | BridgeError::Backend(BackendError::UnsupportedWriteFormat(_)) => Status::InvalidArg,
    BridgeError::NoActiveEdit
    | BridgeError::ActiveEditAlreadyExists
    | BridgeError::Core(_)
    | BridgeError::Backend(_) => Status::GenericFailure,
  };

  Error::new(status, error.to_string())
}

impl From<BridgeError> for Error {
  fn from(error: BridgeError) -> Self {
    to_napi_error(error)
  }
}

impl From<BridgeError> for JsError {
  fn from(error: BridgeError) -> Self {
    JsError::from(to_napi_error(error))
  }
}

pub type Result<T> = std::result::Result<T, BridgeError>;

pub type BridgeResult<T> = Result<T>;
