//! Packed glyph payload codecs.
//!
//! This crate owns byte framing and strict validation. It intentionally has no
//! dependency on `shift-font`: authored geometry adaptation belongs to the
//! domain/transport boundary, not to the codec.

mod frame;
mod layer;
mod outline;

pub use layer::*;
pub use outline::*;
