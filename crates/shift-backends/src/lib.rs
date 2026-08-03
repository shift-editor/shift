mod atomic;
pub mod binary;
pub mod designspace;
pub mod errors;
pub mod export;
pub mod font_loader;
pub mod font_source;
pub mod format;
pub mod glyphs;
pub mod import;
mod metrics;
mod shift2fontir;
mod traits;
pub mod ufo;

pub use errors::{BackendError, BackendResult, FormatBackendError, FormatBackendResult};
pub use export::{ExportError, ExportFormat, FontExportRequest, FontExportResult, FontExporter};
pub use font_source::{
    build_binary_atlas_page, AffineTransform, AnchorRange, AxisIndex, BinaryFont,
    ComponentInstance, ComponentRange, ContourRange, DirectoryGlyph, DisplayGlyph, FontDirectory,
    FontImporter, FontMetrics, FontReadError, FontSource, GeometryIndex, GlifFont, GlyphAnchor,
    GlyphBounds, GlyphContour, GlyphGeometry, GlyphGuide, GlyphIndex, GlyphMetrics, GlyphPoint,
    GlyphPointKind, GlyphsFont, GuideRange, PointProvenance, PointRange, RandomAccessFont,
    SourceAtlasDescriptor, SourceAtlasError, SourceAtlasPage, TrueTypePointIndex, VariationAxis,
    VariationAxisKind, VariationCoordinate, VariationLocation,
};
pub use format::FontFormat;
pub use import::{FontImport, GlyphDirectoryEntry, ImportBatchLimit};
pub use traits::{FontBackend, FontReader, FontView, FontWriter};
