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
use std::cell::{OnceCell, RefCell};
use std::collections::{HashMap, HashSet};

use shift_backends::GlyphCategories;
use shift_engine::{StoreReadError, StoreReader, store_reader_request};
use shift_font::{GlyphDataCategory, GlyphId, LayerId, NamedGlyph};
use shift_store::StoreReader as StoreFiles;

use crate::errors::BridgeError;
use crate::reply::{PackedReply, answer};

/// A read-only view of a workspace's store.
#[napi]
pub struct LayerReader {
  /// `None` once closed: Windows will not delete a file a reader holds open.
  reader: Option<StoreFiles>,
  /// Glyphs' glyph data, parsed on the first category read.
  glyph_data: OnceCell<GlyphCategories>,
  /// Whether each layer read so far carries an anchor marks attach to, with
  /// the digest of the payload that answered, so a layer is decoded again
  /// only once its payload changes. Anchors live inside the payload.
  attaching_anchors: RefCell<HashMap<LayerId, AttachingAnchor>>,
}

/// What a layer's payload, by its digest, says about attaching anchors.
#[derive(Clone, Copy)]
struct AttachingAnchor {
  digest: [u8; 32],
  attaching: bool,
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
    Ok(Self::new(reader))
  }

  /// Reads the working store behind an untitled or imported workspace.
  ///
  /// # Errors
  ///
  /// Fails when the store cannot be opened read-only.
  #[napi(factory)]
  pub fn open_working_store(store_path: String) -> napi::Result<Self> {
    let reader = StoreFiles::open_working_store(store_path).map_err(BridgeError::from)?;
    Ok(Self::new(reader))
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

  fn component_bases(&self, glyph_ids: Vec<GlyphId>) -> Result<Vec<Vec<GlyphId>>, StoreReadError> {
    self.open()?.component_bases(&glyph_ids).map_err(unreadable)
  }

  fn glyph_data_categories(&self, glyphs: Vec<NamedGlyph>) -> Vec<GlyphDataCategory> {
    self
      .glyph_data
      .get_or_init(GlyphCategories::new)
      .lookup_all(&glyphs)
  }

  fn attaching_anchor_layers(
    &self,
    layer_ids: Vec<LayerId>,
  ) -> Result<Vec<LayerId>, StoreReadError> {
    let store = self.open()?;
    let digests = store
      .layer_payload_digests(&layer_ids)
      .map_err(unreadable)?;
    let mut known = self.attaching_anchors.borrow_mut();
    let stale: Vec<LayerId> = digests
      .iter()
      .filter(|(layer_id, digest)| known.get(*layer_id).map(|known| &known.digest) != Some(*digest))
      .map(|(layer_id, _)| *layer_id)
      .collect();
    let attaching: HashSet<LayerId> = store
      .attaching_anchor_layers(&stale)
      .map_err(unreadable)?
      .into_iter()
      .collect();
    for layer_id in stale {
      let digest = digests[&layer_id];
      let attaching = attaching.contains(&layer_id);
      known.insert(layer_id, AttachingAnchor { digest, attaching });
    }
    // Digests are in id order, so the answer is too.
    Ok(
      digests
        .keys()
        .copied()
        .filter(|layer_id| known.get(layer_id).is_some_and(|known| known.attaching))
        .collect(),
    )
  }
}

/// A store failure as the error that crosses to the engine, as its text.
fn unreadable(error: impl std::fmt::Display) -> StoreReadError {
  StoreReadError::Unreadable {
    detail: error.to_string(),
  }
}

impl LayerReader {
  fn new(reader: StoreFiles) -> Self {
    Self {
      reader: Some(reader),
      glyph_data: OnceCell::new(),
      attaching_anchors: RefCell::new(HashMap::new()),
    }
  }

  /// The store, for a [`StoreReader`] method.
  fn open(&self) -> Result<&StoreFiles, StoreReadError> {
    self.reader.as_ref().ok_or(StoreReadError::Closed)
  }
}
