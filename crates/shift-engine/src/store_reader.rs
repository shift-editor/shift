//! What a session reads from its store, as a request protocol, for an engine
//! that runs apart from the store: layers, component references, and glyph
//! data's categories for its glyph records.
//!
//! The editor's engine runs in WebAssembly in the window, and the store is
//! read by a native reader in the window's preload. The engine asks through a
//! [`StoreReaderClient`], which encodes each request; the preload passes the
//! encoded request to the native reader unchanged, which answers it with
//! [`store_reader_request`]. Neither side shares a name table with the other,
//! so ids travel with each message ([`pack::CarriedNames`]).

use pack::{Bytes, Pack};
use shift_font::{GlyphDataCategory, GlyphId, LayerId, NamedGlyph};

/// A store's persisted state, as an engine session reads it: the
/// [`crate::LayerSource`] questions, asked across a process or module
/// boundary.
#[pack::interface]
pub trait StoreReader {
    /// The content of `layer_ids` as one MessagePack array of named-field
    /// layers, which decodes to `Vec<GlyphLayer>`.
    ///
    /// # Errors
    ///
    /// Returns [`StoreReadError`] when the reader is closed or the store
    /// cannot be read.
    fn layers(&self, layer_ids: Vec<LayerId>) -> Result<Bytes, StoreReadError>;

    /// Every glyph the components of `glyph_ids` use, transitively, other
    /// than `glyph_ids` themselves.
    ///
    /// # Errors
    ///
    /// Returns [`StoreReadError`] when the reader is closed or the store
    /// cannot be read.
    fn bases_of(&self, glyph_ids: Vec<GlyphId>) -> Result<Vec<GlyphId>, StoreReadError>;

    /// Glyphs with a component whose base is one of `glyph_ids`, directly;
    /// not the composites of those composites.
    ///
    /// # Errors
    ///
    /// Returns [`StoreReadError`] when the reader is closed or the store
    /// cannot be read.
    fn composites_of(&self, glyph_ids: Vec<GlyphId>) -> Result<Vec<GlyphId>, StoreReadError>;

    /// The direct component bases of each of `glyph_ids`, as persisted, in
    /// request order, each list in id order; not the bases of those bases.
    ///
    /// # Errors
    ///
    /// Returns [`StoreReadError`] when the reader is closed or the store
    /// cannot be read.
    fn component_bases(&self, glyph_ids: Vec<GlyphId>)
    -> Result<Vec<Vec<GlyphId>>, StoreReadError>;

    /// Glyph data's category for each of `glyphs`, by name and codepoints, in
    /// request order: the Glyphs glyph data the reader holds, which is too
    /// large to ship with the engine.
    fn glyph_data_categories(&self, glyphs: Vec<NamedGlyph>) -> Vec<GlyphDataCategory>;
}

/// Why a [`StoreReader`] could not answer.
#[derive(Clone, Debug, PartialEq, Eq, Pack, thiserror::Error)]
pub enum StoreReadError {
    /// The reader was closed, as when the workspace moved or closed its store.
    #[error("the store reader is closed")]
    Closed,

    /// The store failed to read or encode what was asked. `detail` is the
    /// store error's text: the error itself cannot cross the boundary.
    #[error("the store could not be read: {detail}")]
    Unreadable { detail: String },
}
