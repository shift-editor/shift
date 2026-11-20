//! Stroke solvers and layer lib metadata (F0.1 / F0.3).

pub mod exact_offset;
pub mod layer_edit;
pub mod layer_lib;
pub mod style;

pub use exact_offset::{
    DEFAULT_TOLERANCE, ExactStrokeStyle, count_cubics, count_on_curve, outline, path_bbox,
    path_is_closed,
};
pub use layer_edit::{contour_bounds_oracle, contour_skeleton_path, contours_closed_oracle};
pub use layer_lib::{ContourStrokeEntry, ContourStrokeRole, LayerStrokeLib, STROKE_LIB_KEY};
pub use style::{OutlineStrokeStyle, StrokeCap, StrokeJoin};
