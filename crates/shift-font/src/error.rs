use crate::{
    AnchorId, AxisId, AxisLabelId, AxisMappingId, ContourId, GlyphId, GlyphName, LayerId,
    NamedInstanceId, PointId, SourceId,
};

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

    #[error("invalid glyph id {0}")]
    InvalidGlyphId(String),

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

    #[error("source id {0} already exists")]
    DuplicateSourceId(SourceId),

    #[error("layer {0} not found")]
    LayerNotFound(LayerId),

    #[error("layer {layer_id} belongs to glyph {actual_glyph_id}, not glyph {glyph_id}")]
    LayerGlyphMismatch {
        layer_id: LayerId,
        glyph_id: GlyphId,
        actual_glyph_id: GlyphId,
    },

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
    AxisNotFound(AxisId),

    #[error("invalid axis {axis_id}: {message}")]
    InvalidAxis { axis_id: AxisId, message: String },

    #[error("axis label {0} already exists")]
    DuplicateAxisLabelId(AxisLabelId),

    #[error("axis mapping {0} already exists")]
    DuplicateAxisMappingId(AxisMappingId),

    #[error("axis mapping name {0:?} already exists")]
    DuplicateAxisMappingName(String),

    #[error("invalid axis mapping {mapping_id}: {message}")]
    InvalidAxisMapping {
        mapping_id: AxisMappingId,
        message: String,
    },

    #[error("named instance {0} already exists")]
    DuplicateNamedInstanceId(NamedInstanceId),

    #[error("named instance name {0:?} already exists")]
    DuplicateNamedInstanceName(String),

    #[error("named instance PostScript name {0:?} already exists")]
    DuplicateNamedInstancePostscriptName(String),

    #[error("named instances {first} and {second} have the same external location")]
    DuplicateNamedInstanceLocation {
        first: NamedInstanceId,
        second: NamedInstanceId,
    },

    #[error("named instance {0} not found")]
    NamedInstanceNotFound(NamedInstanceId),

    #[error("invalid named instance {instance_id}: {message}")]
    InvalidNamedInstance {
        instance_id: NamedInstanceId,
        message: String,
    },

    #[error("invalid source name {0:?}")]
    InvalidSourceName(String),

    #[error("source name {0} already exists")]
    DuplicateSourceName(String),

    #[error("cannot delete the last source")]
    CannotDeleteLastSource,
}

pub type CoreResult<T> = Result<T, CoreError>;
