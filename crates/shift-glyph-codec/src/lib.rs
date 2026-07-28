//! Packed glyph payload codecs.
//!
//! This crate owns byte framing and strict validation. It intentionally has no
//! dependency on `shift-font`: authored geometry adaptation belongs to the
//! domain/transport boundary, not to the codec.

mod frame;
mod layer;
mod outline;

pub use layer::{
    decode_layer, pack_layer, GlyphLayer, GlyphLayerView, LayerAnchor, LayerAnchorIter,
    LayerAnchorView, LayerCodecError, LayerComponent, LayerComponentIter, LayerComponentView,
    LayerContour, LayerContourIter, LayerContourView, LayerGuideline, LayerGuidelineIter,
    LayerGuidelineView, LayerLibValue, LayerPoint, LayerPointIter, LayerPointType, LayerPointView,
    LayerTransform, PackedGlyphLayer, MAX_LAYER_CONTOUR_COUNT, MAX_LAYER_ENTITY_COUNT,
    MAX_LAYER_LIB_DEPTH, MAX_LAYER_LIB_VALUES, MAX_LAYER_PAYLOAD_BYTES, MAX_LAYER_POINT_COUNT,
    MAX_LAYER_STRING_BYTES, MAX_LAYER_STRING_COUNT,
};
pub use outline::{
    decode_outline, pack_outline, CodecError, CommandOrderError, CoordinateIter, OutlineCommand,
    OutlineCommandIter, OutlineEncoder, OutlineView, PackedGlyphOutline, MAX_COMMAND_COUNT,
    MAX_COORD_COUNT, MAX_PAYLOAD_BYTES,
};
