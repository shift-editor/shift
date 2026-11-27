//! Layer extent under skeleton or ink measure.

#![cfg_attr(not(feature = "engine"), allow(dead_code))]

use pack::Pack;
use shift_font::stroke::{LayerExtent, SelectionExtentFilter};
use shift_font::{ContourId, CoreError, LayerId};

pub use shift_font::linked_metrics::ReapplyLinkedMetricsScope;
pub use shift_font::stroke::{LayerExtentFallback, Measure, MeasureBounds};

/// Why [`crate::engine_reads::EngineReads::layer_extent`] could not answer.
#[derive(Clone, Debug, PartialEq, Eq, Pack, thiserror::Error)]
pub enum LayerExtentReadError {
    #[error("layer {layer} is not loaded")]
    NotLoaded { layer: LayerId },
    #[error("layer {layer} was not found")]
    LayerNotFound { layer: LayerId },
    #[error("the layer extent could not be read: {message}")]
    Failed { message: String },
}

pub(crate) fn layer_extent_of_font(
    font: &shift_font::Font,
    layer_id: LayerId,
) -> Result<LayerExtent, LayerExtentReadError> {
    font.layer_extent(layer_id).map_err(layer_extent_error)
}

/// Layer or contour-subset extent request.
#[derive(Clone, Debug, PartialEq, Eq, Pack)]
pub struct SelectionExtentRequest {
    pub layer_id: LayerId,
    pub contour_ids: Vec<ContourId>,
}

pub(crate) fn selection_extent_of_font(
    font: &shift_font::Font,
    request: SelectionExtentRequest,
) -> Result<LayerExtent, LayerExtentReadError> {
    let filter = if request.contour_ids.is_empty() {
        SelectionExtentFilter::WholeLayer
    } else {
        SelectionExtentFilter::Contours(request.contour_ids)
    };
    font.selection_extent(request.layer_id, filter)
        .map_err(layer_extent_error)
}

fn layer_extent_error(error: CoreError) -> LayerExtentReadError {
    match error {
        CoreError::LayerNotFound(layer) => LayerExtentReadError::LayerNotFound { layer },
        other => LayerExtentReadError::Failed {
            message: other.to_string(),
        },
    }
}
