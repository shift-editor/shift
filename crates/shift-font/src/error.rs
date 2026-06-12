use crate::{AnchorId, ContourId, GlyphId, GlyphName, LayerId, PointId, SourceId};

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("point {0} not found")]
    PointNotFound(PointId),

    #[error("point id {0} already exists")]
    DuplicatePointId(PointId),

    #[error("contour id {0} already exists")]
    DuplicateContourId(ContourId),

    #[error("anchor id {0} already exists")]
    DuplicateAnchorId(AnchorId),

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

    #[error("glyph {0} not found")]
    GlyphNotFound(GlyphId),

    #[error("source {0} not found")]
    SourceNotFound(SourceId),

    #[error("layer {0} not found")]
    LayerNotFound(LayerId),

    #[error("duplicate glyph id {0}")]
    DuplicateGlyphId(GlyphId),

    #[error("duplicate glyph name {0}")]
    DuplicateGlyphName(GlyphName),

    #[error("duplicate glyph layer for glyph {glyph_id} and source {source_id}")]
    DuplicateGlyphLayer {
        glyph_id: GlyphId,
        source_id: SourceId,
    },

    #[error("layer {0} is already owned by another glyph")]
    DuplicateLayerId(LayerId),

    #[error("glyph storage key {key} does not match glyph id {glyph_id}")]
    MismatchedGlyphId { key: GlyphId, glyph_id: GlyphId },

    #[error("invalid glyph name {0:?}")]
    InvalidGlyphName(String),

    #[error("creating a glyph requires a font with at least one source")]
    GlyphNeedsSource,

    #[error("axis tag {0} already exists")]
    DuplicateAxisTag(String),

    #[error("axis {0} not found")]
    AxisNotFound(String),

    #[error("invalid source name {0:?}")]
    InvalidSourceName(String),

    #[error("source name {0} already exists")]
    DuplicateSourceName(String),
}

pub type CoreResult<T> = Result<T, CoreError>;
