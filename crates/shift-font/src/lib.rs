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
//! `shift-font` defines domain objects, local mutation methods, reversible
//! changesets, geometry helpers, component resolution, and variation helpers.
//!
//! Canonical document persistence belongs to `shift-store`; workspace and recovery
//! orchestration belongs to `shift-workspace`. Transport belongs to `shift-bridge`
//! and `shift-wire`. UI interaction belongs to the TypeScript editor.
//!
// Library code returns errors instead of panicking: a panic kills the
// WebAssembly engine. Tests may unwrap (clippy.toml).
#![warn(clippy::unwrap_used, clippy::print_stdout)]

pub mod anchor_attachment;
pub mod anchor_propagation;
pub mod changes;
pub mod check;
pub mod composite;
pub mod contour_edit;
pub mod curve;
pub mod curve_fit;
pub mod drag_rules;
pub mod error;
pub mod intents;
pub mod interpolation;
pub mod ir;
pub mod layer_edit;
pub mod naming;
pub mod placed_blend;
pub mod point_arrange;
pub mod projection;
mod string_enum;
pub mod svg_path;
#[cfg(any(test, feature = "test-support"))]
pub mod test_support;

pub use changes::*;
pub use contour_edit::{
    ContourEditError, ContourEnd, ContourSide, DeleteMode, EditOption, JoinMode, UnknownEditOption,
};
pub use error::{CoreError, CoreResult, EntityKind, EntityRef, Require};
pub use intents::*;
pub use interpolation::*;
pub use ir::*;
pub use ir::{
    anchor, axis, boolean, collection, component, contour, entity, features, font, glyph,
    glyph_name, guideline, kerning, lib_data, metrics, named_instance, point, segment, source,
    variation,
};
/// Points, vectors, and affine maps in the font model's signatures.
pub use kurbo;
pub use point_arrange::{DistributeAxis, PointAlignment, Sidebearing};
pub use projection::*;
