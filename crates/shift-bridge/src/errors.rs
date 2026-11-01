use napi::{Error, JsError, Status};
use shift_backends::{BackendError, FontReadError, SourceAtlasError};
use shift_font::error::CoreError;
use shift_slug::{AuthoredSlugError, SlugError};
use shift_workspace::WorkspaceError;

#[derive(Debug, thiserror::Error)]
pub enum BridgeError {
  #[error("invalid {kind}: {value}")]
  InvalidInput { kind: &'static str, value: String },

  /// A call needs the open workspace, and none is open.
  #[error("invalid workspace: no workspace is open")]
  NoWorkspace,

  /// A call needs the retained font source, and none is open.
  #[error("invalid font source: no retained font source is open")]
  NoFontSource,

  #[error(transparent)]
  Core(#[from] CoreError),

  #[error(transparent)]
  Backend(#[from] BackendError),

  #[error(transparent)]
  FontRead(#[from] FontReadError),

  #[error(transparent)]
  SourceAtlas(#[from] SourceAtlasError),

  #[error(transparent)]
  Workspace(#[from] WorkspaceError),

  #[error(transparent)]
  Wire(#[from] shift_wire::values::WireError),

  #[error(transparent)]
  Store(#[from] shift_store::StoreError),

  /// Layers could not be encoded for the window.
  #[error("cannot encode for the window: {0}")]
  Encoding(#[from] rmp_serde::encode::Error),

  /// A change set from the window could not be decoded.
  #[error("cannot decode from the window: {0}")]
  Decoding(#[from] rmp_serde::decode::Error),

  #[error(transparent)]
  AuthoredSlug(#[from] AuthoredSlugError),

  #[error(transparent)]
  Slug(#[from] SlugError),

  /// A preload reader could not answer, as when it is closed.
  #[error(transparent)]
  StoreRead(#[from] shift_engine::StoreReadError),
}

pub(crate) fn to_napi_error(error: BridgeError) -> Error {
  let status = match &error {
    BridgeError::InvalidInput { .. }
    | BridgeError::NoWorkspace
    | BridgeError::NoFontSource
    | BridgeError::Wire(_)
    | BridgeError::Backend(
      BackendError::MissingExtension { .. }
      | BackendError::InvalidPathUtf8 { .. }
      | BackendError::InvalidExtensionUtf8 { .. }
      | BackendError::UnsupportedFormat { .. }
      | BackendError::UnsupportedWriteFormat { .. }
      | BackendError::AuthoredUnsupported { .. },
    ) => Status::InvalidArg,
    BridgeError::Core(_)
    | BridgeError::Backend(_)
    | BridgeError::FontRead(_)
    | BridgeError::SourceAtlas(_)
    | BridgeError::Workspace(_)
    | BridgeError::Store(_)
    | BridgeError::Encoding(_)
    | BridgeError::Decoding(_)
    | BridgeError::AuthoredSlug(_)
    | BridgeError::Slug(_)
    | BridgeError::StoreRead(_) => Status::GenericFailure,
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
    Self::from(to_napi_error(error))
  }
}

/// Converts every error [`BridgeError`] wraps into an interface's error
/// enum through `From<BridgeError>`, so a method that returns that enum can
/// use `?` on whatever it calls.
macro_rules! through_bridge_error {
  ($error:ty) => {
    $crate::errors::through_bridge_error!(
      $error:
      shift_font::error::CoreError,
      shift_backends::BackendError,
      shift_backends::FontReadError,
      shift_backends::SourceAtlasError,
      shift_workspace::WorkspaceError,
      shift_wire::values::WireError,
      shift_store::StoreError,
      rmp_serde::encode::Error,
      rmp_serde::decode::Error,
      shift_slug::AuthoredSlugError,
      shift_slug::SlugError,
    );
  };
  ($error:ty: $($source:ty),+ $(,)?) => {
    $(
      impl From<$source> for $error {
        fn from(error: $source) -> Self {
          $crate::errors::BridgeError::from(error).into()
        }
      }
    )+
  };
}

pub(crate) use through_bridge_error;

pub(crate) type Result<T> = std::result::Result<T, BridgeError>;

pub(crate) type BridgeResult<T> = Result<T>;
