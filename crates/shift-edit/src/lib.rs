pub mod composite;
pub mod curve;
pub mod dependency_graph;
pub mod edit_session;
pub mod error;
pub mod interpolation;
pub mod state;
pub mod vec2;

pub use shift_wire::{
    values_from_layer, AnchorData, ComponentData, ContourData, GlyphMaster, GlyphState,
    GlyphStructure, GlyphStructureChange, GlyphValueChange, GlyphVariationData, PointData,
};

pub use shift_ir::{
    Anchor, AnchorId, Axis, BooleanOp, Contour, ContourId, CurveSegment, CurveSegmentIter, Font,
    FontMetadata, FontMetrics, Glyph, GlyphLayer, GlyphName, GuidelineId, LayerId, Location, Point,
    PointId, PointType, Source, SourceId, Transform,
};

pub use shift_backends::font_loader;
pub use shift_backends::ufo::{UfoReader, UfoWriter};
pub use shift_backends::{FontBackend, FontReader, FontWriter};

pub use edit_session::{
    BulkNodePositionUpdates, EditableNode, PasteContour, PastePoint, PasteResult,
};
