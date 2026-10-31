//! Read-only layer access for a process that does not own the workspace.
//!
//! The editor's preload opens one beside the workspace's utility process, so
//! the renderer's engine can load layers synchronously within an edit. The
//! engine asks through shift-engine's [`StoreReader`] request protocol: the
//! preload passes each encoded request to [`LayerReader::request`] unchanged.

use napi::Env;
use napi::bindgen_prelude::{Float64ArraySlice, Uint8ArraySlice};
use napi_derive::napi;
use pack::Bytes;
use shift_engine::{StoreReadError, StoreReader, store_reader_request};
use shift_font::{GlyphId, LayerId};
use shift_store::StoreReader as StoreFiles;

use crate::errors::BridgeError;
use crate::reply::{PackedReply, answer};

/// A read-only view of a workspace's store.
#[napi]
pub struct LayerReader {
  /// `None` once closed: Windows will not delete a file a reader holds open.
  reader: Option<StoreFiles>,
}

#[napi]
impl LayerReader {
  /// Reads a document together with its recovery overlay.
  ///
  /// # Errors
  ///
  /// Fails when either file cannot be opened read-only or the document is not a supported
  /// Shift document.
  #[napi(factory)]
  pub fn open_document(document_path: String, recovery_path: String) -> napi::Result<Self> {
    let reader =
      StoreFiles::open_document(document_path, recovery_path).map_err(BridgeError::from)?;
    Ok(Self {
      reader: Some(reader),
    })
  }

  /// Reads the working store behind an untitled or imported workspace.
  ///
  /// # Errors
  ///
  /// Fails when the store cannot be opened read-only.
  #[napi(factory)]
  pub fn open_working_store(store_path: String) -> napi::Result<Self> {
    let reader = StoreFiles::open_working_store(store_path).map_err(BridgeError::from)?;
    Ok(Self {
      reader: Some(reader),
    })
  }

  /// Answers one [`StoreReader`] request, as the engine's `StoreReaderClient`
  /// encoded it: the method's index, its numbers, and its blobs, the last of
  /// them the names it uses. A failure is in the reply, as the method's
  /// error.
  ///
  /// # Errors
  ///
  /// Fails only when JavaScript cannot allocate the reply.
  #[napi(ts_return_type = "{ numbers: Float64Array; blobs: Uint8Array[] }")]
  pub fn request<'env>(
    &self,
    env: &'env Env,
    method: u32,
    numbers: Float64ArraySlice<'_>,
    blobs: Vec<Uint8ArraySlice<'_>>,
  ) -> napi::Result<PackedReply<'env>> {
    answer(env, &numbers, &blobs, |input, blobs, names| {
      store_reader_request(self, method, input, blobs, names)
    })
  }

  /// Closes the store's files now rather than when the reader is collected,
  /// so the workspace can delete them. Reads after this fail.
  #[napi]
  pub fn close(&mut self) {
    self.reader = None;
  }
}

impl StoreReader for LayerReader {
  fn layers(&self, layer_ids: Vec<LayerId>) -> Result<Bytes, StoreReadError> {
    let layers = self
      .open()?
      .load_glyph_layers(&layer_ids)
      .map_err(unreadable)?;
    Ok(Bytes(rmp_serde::to_vec_named(&layers).map_err(unreadable)?))
  }

  fn bases_of(&self, glyph_ids: Vec<GlyphId>) -> Result<Vec<GlyphId>, StoreReadError> {
    self.open()?.bases_of(&glyph_ids).map_err(unreadable)
  }

  fn composites_of(&self, glyph_ids: Vec<GlyphId>) -> Result<Vec<GlyphId>, StoreReadError> {
    self.open()?.composites_of(&glyph_ids).map_err(unreadable)
  }
}

/// A store failure as the error that crosses to the engine, as its text.
fn unreadable(error: impl std::fmt::Display) -> StoreReadError {
  StoreReadError::Unreadable {
    detail: error.to_string(),
  }
}

impl LayerReader {
  /// The store, for a [`StoreReader`] method.
  fn open(&self) -> Result<&StoreFiles, StoreReadError> {
    self.reader.as_ref().ok_or(StoreReadError::Closed)
  }
}
