//! GPU-independent preprocessing for Shift's experimental Slug glyph grid.
//!
//! The crate converts resolved outline commands into quadratic curves, builds
//! checked horizontal/vertical band indexes, and packs contiguous little-endian
//! arrays suitable for native `wgpu` and browser WebGPU consumers. It owns no
//! GPU device and contains no canonical authored font state.

// Library code returns errors instead of panicking: a panic kills the
// WebAssembly engine. Tests may unwrap (clippy.toml).
#![warn(clippy::unwrap_used, clippy::print_stdout)]
#![allow(
    clippy::disallowed_methods,
    reason = "GPU geometry runs natively and needs no cross-target bit equality"
)]

mod atlas;
mod authored;
mod curve;
mod error;
pub mod length;
mod numeric;
mod outline;
mod pack;
mod render;
mod resident;
pub mod retained;
#[cfg(test)]
mod typescript_layout;
mod variable;

pub use atlas::{Atlas, AtlasBuilder, Band, DEFAULT_BAND_COUNT, Glyph, MAX_BAND_COUNT, Statistics};
pub use authored::{
    AuthoredAtlasBuilder, AuthoredCurveTopology, AuthoredGlyph, AuthoredGlyphRequirements,
    AuthoredSlugError, AuthoredSourceGlyph, AuthoredWeightSet,
    add_authored_component_projection_glyph, add_authored_glyph,
    add_authored_glyph_with_weight_sets, add_authored_projection_glyph,
    authored_glyph_requirements, curves_from_resolved_contours,
};
pub use curve::{Bounds, CUBIC_APPROXIMATION_ACCURACY, Curve, LINE_EPSILON, Point};
pub use error::SlugError;
pub use outline::OutlineCommand;
pub use pack::{CurveIndexEncoding, Layout, PackedAtlas, Section};
pub use render::{
    RENDER_INSTANCE_BYTES, RENDER_PARAMS_BYTES, RenderInstance, RenderParams,
    pack_render_instances, pack_render_params,
};
pub use resident::{
    AuthoredAtlas, AuthoredAtlasGlyph, AuthoredAtlasPage, AuthoredAtlasProfile,
    build_authored_atlas, build_authored_atlas_page, build_authored_atlas_page_profiled,
    build_authored_atlas_profiled,
};
pub use variable::{
    PackedVariableAtlas, PackedVariableChunk, PackedVariableChunks, SlugPreviewExtents,
    VARIABLE_PARAMS_BYTES, VariableAtlas, VariableAtlasBuilder, VariableComponent,
    VariableComponentGlyph, VariableComponentPart, VariableComponentSource, VariableGlyph,
    VariableLayout, VariableParams, VariableSource, VariableStatistics, pack_variable_params,
};

/// Shader source shared by native `wgpu` and Electron WebGPU consumers.
pub const SLUG_WGSL: &str = include_str!("../shaders/slug.wgsl");

/// Multi-source compute/re-band/render shader shared by native and Electron.
pub const VARIABLE_SLUG_WGSL: &str = include_str!("../shaders/slug-variable.wgsl");
