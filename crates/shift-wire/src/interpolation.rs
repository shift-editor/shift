//! Transport adapters for native glyph interpolation.

use shift_font::{Axis, CoreError, CoreResult, GlyphInterpolation};

use crate::{AxisTent, GlyphVariationData};

/// Projects native glyph interpolation into the renderer's variation DTO.
///
/// Shift's authoring model identifies axes by stable identity. The renderer's
/// existing interpolation DTO uses OpenType tags, so this adapter resolves the
/// tag without rebuilding or evaluating the interpolation model.
///
/// # Errors
///
/// Returns [`CoreError::AxisNotFound`] if an interpolation support references
/// an axis outside `axes`.
pub fn glyph_variation_data(
    interpolation: &GlyphInterpolation,
    axes: &[Axis],
) -> CoreResult<GlyphVariationData> {
    let regions = interpolation
        .regions()
        .iter()
        .map(|region| {
            region
                .supports()
                .iter()
                .map(|support| {
                    let axis_id = support.axis_id();
                    let axis = axes
                        .iter()
                        .find(|axis| axis.id() == axis_id)
                        .ok_or_else(|| CoreError::AxisNotFound(axis_id.clone()))?;

                    Ok(AxisTent {
                        axis_tag: axis.tag().to_string(),
                        lower: support.minimum(),
                        peak: support.peak(),
                        upper: support.maximum(),
                    })
                })
                .collect::<CoreResult<Vec<_>>>()
        })
        .collect::<CoreResult<Vec<_>>>()?;
    let deltas = interpolation
        .deltas()
        .iter()
        .map(|delta| delta.as_slice().to_vec())
        .collect();

    Ok(GlyphVariationData { regions, deltas })
}
