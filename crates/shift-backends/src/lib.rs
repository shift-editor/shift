mod atomic;
pub mod errors;
pub mod export;
pub mod font_loader;
pub mod font_source;
pub mod format;
pub mod formats;
pub mod import;
mod metrics;
mod shift2fontir;
mod traits;

pub use errors::{BackendError, BackendResult, FormatBackendError, FormatBackendResult};
pub use export::{ExportError, ExportFormat, FontExportRequest, FontExportResult, FontExporter};
pub use font_source::{
    build_binary_atlas_page, variable_glyph_inputs, AffineTransform, AxisIndex, DesignspaceFont,
    DirectoryAxisMapping, DirectoryGlyph, DirectoryInstance, DirectorySource, FontDirectory,
    FontImporter, FontMetrics, FontReadError, FontSource, GlyphAnchor, GlyphComponent, GlyphDelta,
    GlyphIndex, GlyphMetrics, GlyphPoint, GlyphPointKind, GlyphProjection, GlyphShape,
    GlyphShapeContour, GlyphShapePoint, GlyphSourceShape, GlyphVariation, GlyphsFont, OpenTypeFont,
    OpenedFont, PointProvenance, ProjectedGlyph, SourceAtlasDescriptor, SourceAtlasError,
    SourceAtlasPage, SourceIndex, TrueTypePointIndex, UfoFont, VariationAxis, VariationAxisKind,
    VariationCoordinate, VariationLocation, VariationRegion, VariationSupport,
};
pub use format::FontFormat;
pub use import::{FontImport, GlyphDirectoryEntry, ImportBatchLimit};
pub use traits::{FontBackend, FontReader, FontView, FontWriter};
