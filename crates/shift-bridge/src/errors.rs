use napi::{Error, JsError, Status};
use shift_backends::shaper_font::{ShapeError, ShaperFontError};
use shift_backends::{BackendError, FontReadError, SourceAtlasError};
use shift_font::error::CoreError;
use shift_slug::{AuthoredSlugError, SlugError};
use shift_workspace::WorkspaceError;

#[derive(Debug, thiserror::Error)]
pub enum BridgeError {
  #[error("invalid {kind}: {value}")]
  InvalidInput { kind: &'static str, value: String },

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
  Wire(#[from] shift_wire::intents::WireError),

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

  #[error(transparent)]
  ShaperFont(#[from] ShaperFontError),

  #[error(transparent)]
  Shape(#[from] ShapeError),

  /// A layer reader was read after it was closed.
  #[error("layer reader is closed")]
  ReaderClosed,
}

pub(crate) fn to_napi_error(error: BridgeError) -> Error {
  let status = match &error {
    BridgeError::InvalidInput { .. }
    | BridgeError::Wire(_)
    | BridgeError::Backend(
      BackendError::MissingExtension { .. }
      | BackendError::InvalidPathUtf8 { .. }
      | BackendError::InvalidExtensionUtf8 { .. }
      | BackendError::UnsupportedFormat { .. }
      | BackendError::UnsupportedWriteFormat { .. },
    )
    | BridgeError::Shape(
      ShapeError::TooManyUnits
      | ShapeError::TooManyInsertedGlyphs
      | ShapeError::InvalidFeatureTag(_)
      | ShapeError::UnknownScript(_)
      | ShapeError::InvalidLanguage(_),
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
    | BridgeError::ShaperFont(_)
    | BridgeError::Shape(_)
    | BridgeError::ReaderClosed => Status::GenericFailure,
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

pub(crate) type Result<T> = std::result::Result<T, BridgeError>;

pub(crate) type BridgeResult<T> = Result<T>;
