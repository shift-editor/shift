//! Read-only layer access for a process that does not own the workspace.
//!
//! The editor's preload opens one beside the workspace's utility process, so
//! the renderer's engine can load layers synchronously within an edit. The
//! engine asks through shift-engine's [`StoreReader`] request protocol: the
//! preload passes each encoded request to [`LayerReader::request`] unchanged.

use napi::Env;
use napi::bindgen_prelude::{Buffer, BufferSlice, Float64Array, Float64ArraySlice, Uint8ArraySlice};
use napi_derive::napi;
use pack::{Bytes, Packed};
use shift_engine::{StoreReadError, StoreReader, store_reader_request};
use shift_font::{GlyphId, LayerId};
use shift_store::StoreReader as StoreFiles;

use crate::errors::{BridgeError, BridgeResult};
use crate::input::parse_id_list;

/// A [`StoreReader`] reply: its numbers, and its blobs, the last of them the
/// names it uses.
#[napi(object, object_from_js = false)]
pub struct StoreReply<'env> {
  pub numbers: Float64Array,
  #[napi(ts_type = "Uint8Array[]")]
  pub blobs: Vec<BufferSlice<'env>>,
}

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

  /// The content of `layer_ids` as one MessagePack array of named-field
  /// layers, the encoding the engine decodes.
  ///
  /// # Errors
  ///
  /// Fails on a malformed or unknown layer id, and when a layer cannot be read or decoded.
  #[napi]
  pub fn load_layers(&self, layer_ids: Vec<String>) -> napi::Result<Buffer> {
    Ok(self.encoded_layers(&layer_ids)?.into())
  }

  /// `glyph_ids` plus every glyph their components use, transitively.
  ///
  /// # Errors
  ///
  /// Fails on a malformed glyph id or when the component references cannot be read.
  #[napi]
  pub fn component_closure(&self, glyph_ids: Vec<String>) -> napi::Result<Vec<String>> {
    Ok(self.closure(&glyph_ids)?)
  }

  /// Glyphs with a component of a glyph that owns one of `layer_ids`.
  ///
  /// # Errors
  ///
  /// Fails on a malformed layer id or when the component references cannot be read.
  #[napi]
  pub fn dependents(&self, layer_ids: Vec<String>) -> napi::Result<Vec<String>> {
    Ok(self.dependent_glyphs(&layer_ids)?)
  }

  /// Answers one [`StoreReader`] request, as the engine's `StoreReaderClient`
  /// encoded it: the method's index, its numbers, and its blobs, the last of
  /// them the names it uses. A failure is in the reply, as the method's
  /// error.
  ///
  /// The request is read in place, and the reply copied once into
  /// JavaScript memory: an external buffer costs more than copying a small
  /// reply, and Electron's V8 sandbox refuses external buffers, so napi would
  /// copy them anyway.
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
  ) -> napi::Result<StoreReply<'env>> {
    let request = Packed {
      numbers: numbers.to_vec(),
      blobs: blobs.iter().map(|blob| blob.to_vec()).collect(),
    };
    let reply = request.answer_carrying_names(|input, blobs, names| {
      store_reader_request(self, method, input, blobs, names)
    });
    Ok(StoreReply {
      numbers: reply.numbers.into(),
      blobs: reply
        .blobs
        .iter()
        .map(|blob| BufferSlice::copy_from(env, blob))
        .collect::<napi::Result<_>>()?,
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

  fn reader(&self) -> BridgeResult<&StoreFiles> {
    self.reader.as_ref().ok_or(BridgeError::ReaderClosed)
  }

  fn encoded_layers(&self, layer_ids: &[String]) -> BridgeResult<Vec<u8>> {
    let layers = self
      .reader()?
      .load_glyph_layers(&parse_id_list::<LayerId>(layer_ids)?)?;
    Ok(rmp_serde::to_vec_named(&layers)?)
  }

  fn closure(&self, glyph_ids: &[String]) -> BridgeResult<Vec<String>> {
    let closure = self
      .reader()?
      .referenced_glyph_closure(parse_id_list::<GlyphId>(glyph_ids)?)?;
    Ok(closure.iter().map(ToString::to_string).collect())
  }

  fn dependent_glyphs(&self, layer_ids: &[String]) -> BridgeResult<Vec<String>> {
    let dependents = self
      .reader()?
      .dependent_glyph_ids_for_layers(&parse_id_list::<LayerId>(layer_ids)?)?;
    Ok(dependents.iter().map(ToString::to_string).collect())
  }
}
