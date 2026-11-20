//! Live stroke fill outlines computed at read time for one glyph layer.

// Non-engine builds declare the packed types for the protocol only.
#![cfg_attr(not(feature = "engine"), allow(dead_code))]

use pack::Pack;
use shift_font::stroke::{StrokeOutlinePreview, preview_bounds};
use shift_font::{ContourId, CoreError, GlyphLayer, LayerId};

use crate::geometry::ContourPoints;

/// One skeleton contour and the preview outlines shift-font derived from it.
#[derive(Clone, Debug, PartialEq, Pack)]
pub struct StrokeOutlinePreviewItem {
    pub skeleton_contour_id: ContourId,
    pub width: f64,
    pub height: f64,
    pub outlines: Vec<ContourPoints>,
}

/// Why [`crate::engine_reads::EngineReads::stroke_outline_previews`] could not
/// answer.
#[derive(Clone, Debug, PartialEq, Pack)]
pub enum StrokePreviewReadError {
    NotLoaded { layer: LayerId },
    LayerNotFound { layer: LayerId },
    Failed { message: String },
}

pub(crate) fn stroke_outline_preview_items(
    layer: &GlyphLayer,
    tolerance: f64,
) -> Result<Vec<StrokeOutlinePreviewItem>, StrokePreviewReadError> {
    let previews = layer
        .stroke_outlines_for_preview(tolerance)
        .map_err(stroke_error)?;
    Ok(previews.iter().map(preview_item).collect())
}

fn preview_item(preview: &StrokeOutlinePreview) -> StrokeOutlinePreviewItem {
    let (width, height) = preview_bounds(preview);
    StrokeOutlinePreviewItem {
        skeleton_contour_id: preview.skeleton_contour_id.clone(),
        width,
        height,
        outlines: preview
            .outlines
            .iter()
            .map(ContourPoints::of_contour)
            .collect(),
    }
}

fn stroke_error(error: CoreError) -> StrokePreviewReadError {
    StrokePreviewReadError::Failed {
        message: error.to_string(),
    }
}
