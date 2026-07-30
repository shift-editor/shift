use crate::SlugError;

/// Byte stride of [`RenderInstance`] in the shared WGSL storage layout.
pub const RENDER_INSTANCE_BYTES: usize = 48;
/// Byte length of [`RenderParams`] in the shared WGSL uniform layout.
pub const RENDER_PARAMS_BYTES: usize = 16;

/// One visible glyph quad consumed by the shared Slug vertex shader.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct RenderInstance {
    /// Pixel-space `[min_x, min_y, max_x, max_y]` rectangle.
    pub pixel_rect: [f32; 4],
    /// Pixel-to-font transform `[scale_x, scale_y, offset_x, offset_y]`.
    ///
    /// Fragment coordinates use `font = pixel * scale + offset`. Keeping this
    /// independent of the rasterized quad preserves identical sampling when a
    /// consumer tightens quad bounds.
    pub em_transform: [f32; 4],
    pub glyph_index: u32,
    /// First curve in per-frame scratch storage for variable rendering.
    pub scratch_curve_start: u32,
    /// First band descriptor in per-frame scratch storage.
    pub scratch_band_start: u32,
    /// First band-index slot in per-frame scratch storage.
    pub scratch_index_start: u32,
}

/// Per-frame values consumed by the shared Slug vertex shader.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct RenderParams {
    pub viewport_width: f32,
    pub viewport_height: f32,
    pub cell_padding: f32,
}

/// Packs visible instances into the exact little-endian shared WGSL layout.
pub fn pack_render_instances(instances: &[RenderInstance]) -> Result<Vec<u8>, SlugError> {
    let byte_length = instances
        .len()
        .checked_mul(RENDER_INSTANCE_BYTES)
        .ok_or(SlugError::LengthOverflow)?;
    let mut bytes = Vec::with_capacity(byte_length);
    for instance in instances {
        for value in instance.pixel_rect.into_iter().chain(instance.em_transform) {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        for value in [
            instance.glyph_index,
            instance.scratch_curve_start,
            instance.scratch_band_start,
            instance.scratch_index_start,
        ] {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
    }
    Ok(bytes)
}

/// Packs per-frame values into the exact little-endian shared WGSL layout.
pub fn pack_render_params(params: RenderParams) -> [u8; RENDER_PARAMS_BYTES] {
    let mut bytes = [0; RENDER_PARAMS_BYTES];
    bytes[0..4].copy_from_slice(&params.viewport_width.to_le_bytes());
    bytes[4..8].copy_from_slice(&params.viewport_height.to_le_bytes());
    bytes[8..12].copy_from_slice(&params.cell_padding.to_le_bytes());
    bytes
}
