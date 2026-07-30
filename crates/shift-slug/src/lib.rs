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
mod resident;
mod variable;

pub use atlas::{Atlas, AtlasBuilder, Band, Glyph, Statistics, DEFAULT_BAND_COUNT, MAX_BAND_COUNT};
pub use authored::{
    add_authored_component_projection_glyph, add_authored_glyph,
    add_authored_glyph_with_weight_sets, add_authored_projection_glyph,
    authored_glyph_requirements, curves_from_resolved_contours, AuthoredAtlasBuilder,
    AuthoredCurveTopology, AuthoredGlyph, AuthoredGlyphRequirements, AuthoredSlugError,
    AuthoredSourceGlyph, AuthoredWeightSet,
};
pub use curve::{Bounds, Curve, Point, CUBIC_APPROXIMATION_ACCURACY, LINE_EPSILON};
pub use error::SlugError;
pub use pack::{CurveIndexEncoding, Layout, PackedAtlas, Section};
pub use render::{
    pack_render_instances, pack_render_params, RenderInstance, RenderParams, RENDER_INSTANCE_BYTES,
    RENDER_PARAMS_BYTES,
};
pub use resident::{
    build_authored_atlas, build_authored_atlas_page, AuthoredAtlas, AuthoredAtlasGlyph,
    AuthoredAtlasPage,
};
pub use variable::{
    pack_variable_params, PackedVariableAtlas, PackedVariableChunk, PackedVariableChunks,
    VariableAnchorSource, VariableAtlas, VariableAtlasBuilder, VariableComponent,
    VariableComponentGlyph, VariableComponentPart, VariableComponentSource, VariableGlyph,
    VariableLayout, VariableParams, VariableSource, VariableStatistics, VARIABLE_PARAMS_BYTES,
};

/// Shader source shared by native `wgpu` and Electron WebGPU consumers.
pub const SLUG_WGSL: &str = include_str!("../shaders/slug.wgsl");

/// Multi-source compute/re-band/render shader shared by native and Electron.
pub const VARIABLE_SLUG_WGSL: &str = include_str!("../shaders/slug-variable.wgsl");
