//! Shift's live font authoring model.
//!
//! `shift-font` owns the Rust object model for authored font data and the local
//! mutation behavior on that data. It does not own durable storage, `.shift`
//! package IO, Electron, NAPI, or TypeScript editor interaction state.
//!
//! # Object Model
//!
//! - [`Font`] owns glyphs, sources, axes, metadata, and font-level data.
//! - [`Source`] is an editable designspace position with a name and location.
//! - [`Glyph`] is a glyph concept identified by [`GlyphId`].
//! - [`GlyphLayer`] is authored editable data for one glyph at one source.
//! - [`Contour`] and [`Point`] describe outline geometry inside a glyph layer.
//!
//! # Identity
//!
//! Stable IDs are identity. Names and Unicode values are editable metadata.
//!
//! A [`GlyphId`] identifies a glyph. A [`SourceId`] identifies a source. A
//! [`LayerId`] identifies a glyph layer: the authored data for one glyph at one
//! source.
//!
//! # Boundaries
//!
//! `shift-font` defines domain objects, local mutation methods, change records,
//! geometry helpers, component resolution, and variation helpers.
//!
//! Persistence belongs to `shift-store` and `shift-workspace`. Source package IO
//! belongs to `shift-source`. Transport belongs to `shift-bridge` and
//! `shift-wire`. UI interaction belongs to the TypeScript editor.
//!
pub mod changes;
pub mod composite;
pub mod curve;
pub mod error;
pub mod ir;
pub mod layer_edit;

pub use changes::*;
pub use error::{CoreError, CoreResult};
pub use ir::*;
pub use ir::{
    anchor, axis, boolean, component, contour, entity, features, font, glyph, glyph_name,
    guideline, kerning, layer, lib_data, metrics, point, segment, source, variation,
};
pub use layer_edit::{
    BulkNodePositionUpdates, ChangedEntities, EditableNode, PasteContour, PastePoint, PasteResult,
};
