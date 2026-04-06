pub mod binary;
pub mod composite;
pub mod constants;
pub mod curve;
pub mod dependency_graph;
pub mod edit_session;
pub mod font_loader;
pub mod snapshot;
pub mod vec2;

pub use shift_ir::{
    Anchor, AnchorId, Axis, Contour, ContourId, CurveSegment, CurveSegmentIter, Font, FontMetadata,
    FontMetrics, Glyph, GlyphLayer, GlyphName, GuidelineId, LayerId, Location, Point, PointId,
    PointType, Source, SourceId, Transform,
};

pub use shift_backends::ufo::{UfoReader, UfoWriter};
pub use shift_backends::{FontBackend, FontReader, FontWriter};

pub use edit_session::{NodePositionUpdate, NodeRef, PasteContour, PastePoint, PasteResult};
