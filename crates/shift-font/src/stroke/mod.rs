//! Stroke solvers and layer lib metadata (F0.1 / F0.3).

pub mod exact_offset;
pub mod extent_memo;
pub mod ink;
pub mod ink_bounds;
pub mod ink_fit;
pub mod layer_edit;
pub mod layer_lib;
pub mod live_stroke;
pub mod position;
pub mod solve_cache;
pub mod style;

pub use exact_offset::{
    DEFAULT_TOLERANCE, ExactStrokeStyle, count_cubics, count_on_curve, outline, path_bbox,
    path_is_closed,
};
pub use ink::{
    IGNORE_STROKE_LIB_KEY, InkMeasureRuntime, LayerExtent, LayerExtentFallback, Measure,
    MeasureBounds,
};
pub use ink_bounds::{FitInkBound, InkBoundEdge, SelectionExtentFilter};
pub use ink_fit::{InkBoxEdge, InkEdgeFitError, InkEdgeFitRequest, InkEdgeFitResult, fit_ink_edge};
pub use layer_edit::{contour_bounds_oracle, contour_skeleton_path, contours_closed_oracle};
pub use layer_lib::{ContourStrokeEntry, ContourStrokeRole, LayerStrokeLib, STROKE_LIB_KEY};
pub use live_stroke::{
    LiveStroke, StrokeContourFailure, StrokeOutlinePoints, StrokeOutlinePreview, StrokeOutlineRead,
    preview_bounds,
};
pub use solve_cache::StrokeOutlineCache;
pub use style::{OutlineStrokeStyle, StrokeCap, StrokeJoin};
