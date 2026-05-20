use shift_ir::{AnchorId, ContourId, PointId};

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("point {0} not found")]
    PointNotFound(PointId),

    #[error("invalid contour id {0}")]
    InvalidContourId(String),

    #[error("invalid point id {0}")]
    InvalidPointId(String),

    #[error("invalid anchor id {0}")]
    InvalidAnchorId(String),

    #[error("invalid component id {0}")]
    InvalidComponentId(String),

    #[error("contour {0} not found")]
    ContourNotFound(ContourId),

    #[error("point {0} not found in any contour")]
    PointInContourNotFound(PointId),

    #[error("anchor {0} not found")]
    AnchorNotFound(AnchorId),

    #[error("boolean operation failed: {0}")]
    BooleanOperationFailed(String),

    #[error("missing glyph value at {index}")]
    MissingGlyphValue { index: usize },

    #[error("trailing glyph values: expected {expected}, got {actual}")]
    TrailingGlyphValues { expected: usize, actual: usize },

    #[error("invalid {kind}: {message}")]
    InvalidPositionUpdateInput { kind: &'static str, message: String },
}

pub type CoreResult<T> = Result<T, CoreError>;
