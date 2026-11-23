//! Live stroke fill outlines computed at read time for one glyph layer.

// Non-engine builds declare the packed types for the protocol only.
#![cfg_attr(not(feature = "engine"), allow(dead_code))]

use pack::Pack;
use shift_font::stroke::{
    StrokeContourFailure, StrokeOutlineCache, StrokeOutlinePoints, StrokeOutlineRead,
};
use shift_font::{ContourId, CoreError, GlyphId, GlyphLayer, LayerId};

use crate::geometry::ContourPoints;

/// One skeleton contour and the preview outlines shift-font derived from it.
#[derive(Clone, Debug, PartialEq, Pack)]
pub struct StrokeOutlinePreviewItem {
    pub skeleton_contour_id: ContourId,
    pub width: f64,
    pub height: f64,
    pub outlines: Vec<ContourPoints>,
}

/// One skeleton contour whose stroke could not be solved, and why.
///
/// The message is the engine's error text; this is where an error becomes text.
#[derive(Clone, Debug, PartialEq, Pack)]
pub struct StrokeOutlineFailure {
    pub skeleton_contour_id: ContourId,
    pub message: String,
}

/// What reading a layer's live strokes found: each skeleton that solved and
/// each that did not, so one bad contour never hides the others' outlines.
#[derive(Clone, Debug, Default, PartialEq, Pack)]
pub struct StrokeOutlinePreviews {
    pub items: Vec<StrokeOutlinePreviewItem>,
    pub failures: Vec<StrokeOutlineFailure>,
}

/// Why [`crate::engine_reads::EngineReads::stroke_outline_previews`] could not
/// answer.
#[derive(Clone, Debug, PartialEq, Pack)]
pub enum StrokePreviewReadError {
    NotLoaded { layer: LayerId },
    LayerNotFound { layer: LayerId },
    GlyphNotLoaded { glyph: GlyphId },
    GlyphNotFound { glyph: GlyphId },
    Failed { message: String },
}

pub(crate) fn stroke_outline_preview_items(
    layer: &GlyphLayer,
    tolerance: f64,
    cache: &mut StrokeOutlineCache,
) -> Result<StrokeOutlinePreviews, StrokePreviewReadError> {
    let read = layer
        .stroke_outline_points_for_preview_with(tolerance, cache)
        .map_err(stroke_error)?;
    Ok(read.into())
}

impl From<StrokeOutlineRead> for StrokeOutlinePreviews {
    fn from(read: StrokeOutlineRead) -> Self {
        let StrokeOutlineRead { solved, failed } = read;
        Self {
            items: solved.into_iter().map(Into::into).collect(),
            failures: failed.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<StrokeContourFailure> for StrokeOutlineFailure {
    fn from(failure: StrokeContourFailure) -> Self {
        let StrokeContourFailure {
            skeleton_contour_id,
            error,
        } = failure;
        Self {
            skeleton_contour_id,
            message: error.to_string(),
        }
    }
}

impl From<StrokeOutlinePoints> for StrokeOutlinePreviewItem {
    fn from(preview: StrokeOutlinePoints) -> Self {
        let StrokeOutlinePoints {
            skeleton_contour_id,
            width,
            height,
            bounds: _,
            outlines,
        } = preview;
        Self {
            skeleton_contour_id,
            width,
            height,
            outlines: outlines.into_iter().map(ContourPoints::from).collect(),
        }
    }
}

pub(crate) fn stroke_error(error: CoreError) -> StrokePreviewReadError {
    StrokePreviewReadError::Failed {
        message: error.to_string(),
    }
}
