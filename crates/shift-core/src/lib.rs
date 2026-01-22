pub mod binary;
pub mod constants;
pub mod edit_ops;
pub mod edit_session;
pub mod font_loader;
pub mod pattern;
pub mod snapshot;
pub mod vec2;

pub use shift_ir::{
    Contour, ContourId, Font, FontMetadata, FontMetrics, Glyph, GlyphLayer, GlyphName, LayerId,
    Point, PointId, PointType,
};

pub use shift_backends::ufo::{UfoReader, UfoWriter};
pub use shift_backends::{FontBackend, FontReader, FontWriter};

pub use edit_session::{PasteContour, PastePoint, PasteResult};
