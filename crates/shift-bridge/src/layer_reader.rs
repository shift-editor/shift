//! Read-only layer access for a process that does not own the workspace.
//!
//! The editor's preload opens one beside the workspace's utility process, so
//! the renderer's engine can load layers synchronously within an edit.

use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
use shift_font::{GlyphId, LayerId};
use shift_store::StoreReader;

use crate::errors::{BridgeError, BridgeResult};
use crate::input::parse_id_list;

/// A read-only view of a workspace's store.
#[napi]
pub struct LayerReader {
  /// `None` once closed: Windows will not delete a file a reader holds open.
  reader: Option<StoreReader>,
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
      StoreReader::open_document(document_path, recovery_path).map_err(BridgeError::from)?;
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
    let reader = StoreReader::open_working_store(store_path).map_err(BridgeError::from)?;
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

  /// Closes the store's files now rather than when the reader is collected,
  /// so the workspace can delete them. Reads after this fail.
  #[napi]
  pub fn close(&mut self) {
    self.reader = None;
  }
}

impl LayerReader {
  fn reader(&self) -> BridgeResult<&StoreReader> {
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
