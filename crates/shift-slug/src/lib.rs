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
mod render;

pub use atlas::{Atlas, AtlasBuilder, Band, Glyph, Statistics, DEFAULT_BAND_COUNT, MAX_BAND_COUNT};
pub use curve::{Bounds, Curve, Point, LINE_EPSILON};
pub use error::SlugError;
pub use pack::{Layout, PackedAtlas, Section};
pub use render::{
    pack_render_instances, pack_render_params, RenderInstance, RenderParams, RENDER_INSTANCE_BYTES,
    RENDER_PARAMS_BYTES,
};

/// Shader source shared by native `wgpu` and Electron WebGPU consumers.
pub const SLUG_WGSL: &str = include_str!("../shaders/slug.wgsl");
