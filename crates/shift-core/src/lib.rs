pub mod binary;
pub mod constants;
pub mod curve;
pub mod edit_session;
pub mod font_loader;
pub mod snapshot;
pub mod vec2;

pub use shift_ir::{
    Anchor, AnchorId, Contour, ContourId, CurveSegment, CurveSegmentIter, Font, FontMetadata,
    FontMetrics, Glyph, GlyphLayer, GlyphName, LayerId, Point, PointId, PointType,
};

pub use shift_backends::ufo::{UfoReader, UfoWriter};
pub use shift_backends::{FontBackend, FontReader, FontWriter};

pub use edit_session::{PasteContour, PastePoint, PasteResult};
