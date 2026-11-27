//! Ink snap points for the editing engine: on-curve positions and extrema
//! of a layer's solved stroke outlines.

#![cfg_attr(not(feature = "engine"), allow(dead_code))]

use pack::Pack;
use shift_font::stroke::InkSnapContour;
use shift_font::{ContourId, CoreError, LayerId};

/// One skeleton contour's ink snap points as `(x, y)` pairs.
#[derive(Clone, Debug, PartialEq, Pack)]
pub struct InkSnapContourPoints {
    pub skeleton_contour_id: ContourId,
    /// Interleaved `(x, y)` pairs: two numbers per point.
    pub coordinates: Vec<f64>,
}

impl From<InkSnapContour> for InkSnapContourPoints {
    fn from(contour: InkSnapContour) -> Self {
        Self {
            skeleton_contour_id: contour.skeleton_contour_id,
            coordinates: contour.points.iter().flat_map(|p| [p.x, p.y]).collect(),
        }
    }
}

/// Why [`crate::engine_reads::EngineReads::ink_snap_points`] could not answer.
#[derive(Clone, Debug, PartialEq, Eq, Pack, thiserror::Error)]
pub enum InkSnapReadError {
    #[error("layer {layer} is not loaded")]
    NotLoaded { layer: LayerId },
    #[error("layer {layer} was not found")]
    LayerNotFound { layer: LayerId },
    #[error("ink snap points could not be read: {message}")]
    Failed { message: String },
}

pub(crate) fn ink_snap_points_of_font(
    font: &shift_font::Font,
    layer_id: LayerId,
) -> Result<Vec<InkSnapContourPoints>, InkSnapReadError> {
    font.ink_snap_points_for_layer(layer_id)
        .map(|contours| {
            contours
                .into_iter()
                .map(InkSnapContourPoints::from)
                .collect()
        })
        .map_err(ink_snap_error)
}

fn ink_snap_error(error: CoreError) -> InkSnapReadError {
    match error {
        CoreError::LayerNotFound(layer) => InkSnapReadError::LayerNotFound { layer },
        other => InkSnapReadError::Failed {
            message: other.to_string(),
        },
    }
}
