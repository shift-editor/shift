//! GPU-independent preprocessing for Shift's experimental Slug glyph grid.
//!
//! The crate converts resolved outline commands into quadratic curves, builds
//! checked horizontal/vertical band indexes, and packs contiguous little-endian
//! arrays suitable for native `wgpu` and browser WebGPU consumers. It owns no
//! GPU device and contains no canonical authored font state.

mod atlas;
mod authored;
mod curve;
mod error;
mod pack;
mod render;
mod variable;

pub use atlas::{Atlas, AtlasBuilder, Band, Glyph, Statistics, DEFAULT_BAND_COUNT, MAX_BAND_COUNT};
pub use authored::{
    add_authored_component_projection_glyph, add_authored_projection_glyph,
    authored_glyph_requirements, curves_from_resolved_contours, AuthoredCurveRecipe,
    AuthoredGlyphRequirements, AuthoredSlugError,
};
pub use curve::{Bounds, Curve, Point, LINE_EPSILON};
pub use error::SlugError;
pub use pack::{CurveIndexEncoding, Layout, PackedAtlas, Section};
pub use render::{
    pack_render_instances, pack_render_params, RenderInstance, RenderParams, RENDER_INSTANCE_BYTES,
    RENDER_PARAMS_BYTES,
};
pub use variable::{
    PackedVariableAtlas, VariableAtlas, VariableAtlasBuilder, VariableGlyph, VariableLayout,
    VariableSource, VariableStatistics,
};

/// Shader source shared by native `wgpu` and Electron WebGPU consumers.
pub const SLUG_WGSL: &str = include_str!("../shaders/slug.wgsl");

/// Multi-source compute/re-band/render shader shared by native and Electron.
pub const VARIABLE_SLUG_WGSL: &str = include_str!("../shaders/slug-variable.wgsl");
