//! Read-only glyph access to a UFO, designspace or Glyphs file the window
//! previews, for an engine that runs in the window.
//!
//! The preload opens one per previewed file, as it opens a [`LayerReader`]
//! for a document, and answers the same shift-engine [`StoreReader`]
//! requests glyph by glyph from the file itself: nothing is imported or
//! written. The utility process parses the file separately for the preview's
//! atlas; both name glyphs alike ([`shift_backends::SourceIds`]).
//!
//! [`LayerReader`]: crate::layer_reader::LayerReader

use napi::Env;
use napi::bindgen_prelude::{BufferSlice, Float64ArraySlice, Uint8ArraySlice};
use napi_derive::napi;
use pack::Bytes;
use std::cell::OnceCell;

use shift_backends::{AuthoredSource, GlyphCategories, OpenedAuthoredSource};
use shift_engine::scene::SceneNode;
use shift_engine::{StoreReadError, StoreReader, store_reader_request};
use shift_font::{GlyphDataCategory, GlyphId, LayerId, NamedGlyph};

use crate::errors::BridgeError;
use crate::layer_reader::unreadable;
use crate::reply::{PackedReply, answer};

/// A read-only view of an authored font file, glyph by glyph.
#[napi]
pub struct SourceReader {
  /// `None` once closed.
  opened: Option<OpenedSource>,
  /// Glyphs' glyph data, parsed on the first category read.
  glyph_data: OnceCell<GlyphCategories>,
}

/// What an open [`SourceReader`] holds: the source, and its directory
/// encoded once, so the reader keeps no decoded copy of every glyph record.
struct OpenedSource {
  source: AuthoredSource,
  directory: Vec<u8>,
}

#[napi]
impl SourceReader {
  /// Opens the UFO, designspace, or `.glyphs` / `.glyphspackage` file at
  /// `path` read-only. Reads every glyph's identity, advances and
  /// components, and converts no outline.
  ///
  /// # Errors
  ///
  /// Fails when `path` is not an authored font format or cannot be read.
  #[napi(factory)]
  pub fn open(path: String) -> napi::Result<Self> {
    let OpenedAuthoredSource { directory, source } =
      AuthoredSource::open(&path).map_err(BridgeError::from)?;
    let directory = rmp_serde::to_vec_named(&directory).map_err(BridgeError::from)?;
    Ok(Self {
      opened: Some(OpenedSource { source, directory }),
      glyph_data: OnceCell::new(),
    })
  }

  /// The file's font with every layer a placeholder that keeps its advance,
  /// as named-field MessagePack: what the engine opens a session with, as it
  /// does from a workspace's `encodedDirectory`.
  ///
  /// # Errors
  ///
  /// Fails when the reader is closed.
  #[napi(ts_return_type = "Uint8Array")]
  pub fn directory<'env>(&self, env: &'env Env) -> napi::Result<BufferSlice<'env>> {
    let opened = self.opened().map_err(BridgeError::from)?;
    BufferSlice::copy_from(env, &opened.directory)
  }

  /// Answers one [`StoreReader`] request, as [`crate::layer_reader::LayerReader::request`]
  /// does, from the file. A failure is in the reply, as the method's error.
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

  /// Drops the parsed file now rather than when the reader is collected.
  /// Reads after this fail.
  #[napi]
  pub fn close(&mut self) {
    self.opened = None;
  }
}

impl StoreReader for SourceReader {
  fn layers(&self, layer_ids: Vec<LayerId>) -> Result<Bytes, StoreReadError> {
    let layers = self.source()?.layers(&layer_ids).map_err(unreadable)?;
    Ok(Bytes(rmp_serde::to_vec_named(&layers).map_err(unreadable)?))
  }

  fn bases_of(&self, glyph_ids: Vec<GlyphId>) -> Result<Vec<GlyphId>, StoreReadError> {
    Ok(self.source()?.bases_of(&glyph_ids))
  }

  fn composites_of(&self, glyph_ids: Vec<GlyphId>) -> Result<Vec<GlyphId>, StoreReadError> {
    Ok(self.source()?.composites_of(&glyph_ids))
  }

  fn component_bases(&self, glyph_ids: Vec<GlyphId>) -> Result<Vec<Vec<GlyphId>>, StoreReadError> {
    Ok(self.source()?.component_bases(&glyph_ids))
  }

  fn glyph_data_categories(&self, glyphs: Vec<NamedGlyph>) -> Vec<GlyphDataCategory> {
    self
      .glyph_data
      .get_or_init(GlyphCategories::new)
      .lookup_all(&glyphs)
  }

  /// A file has no scene: the preview starts from an empty one.
  fn scene_nodes(&self) -> Result<Bytes, StoreReadError> {
    self.source()?;
    let nodes: Vec<SceneNode> = Vec::new();
    Ok(Bytes(rmp_serde::to_vec_named(&nodes).map_err(unreadable)?))
  }

  fn attaching_anchor_layers(
    &self,
    layer_ids: Vec<LayerId>,
  ) -> Result<Vec<LayerId>, StoreReadError> {
    Ok(self.source()?.attaching_anchor_layers(&layer_ids))
  }
}

impl SourceReader {
  fn opened(&self) -> Result<&OpenedSource, StoreReadError> {
    self.opened.as_ref().ok_or(StoreReadError::Closed)
  }

  /// The source, for a [`StoreReader`] method.
  fn source(&self) -> Result<&AuthoredSource, StoreReadError> {
    Ok(&self.opened()?.source)
  }
}
