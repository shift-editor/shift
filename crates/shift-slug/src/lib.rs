//! GPU-independent preprocessing for Shift's experimental Slug glyph grid.
//!
//! The crate converts resolved outline commands into quadratic curves, builds
//! checked horizontal/vertical band indexes, and packs contiguous little-endian
//! arrays suitable for native `wgpu` and browser WebGPU consumers. It owns no
//! GPU device and contains no canonical authored font state.

mod atlas;
mod curve;
mod error;
mod pack;

pub use atlas::{Atlas, AtlasBuilder, Band, Glyph, Statistics, DEFAULT_BAND_COUNT, MAX_BAND_COUNT};
pub use curve::{Bounds, Curve, Point, LINE_EPSILON};
pub use error::SlugError;
pub use pack::{Layout, PackedAtlas, Section};
