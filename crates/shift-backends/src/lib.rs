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
    build_binary_atlas_page, build_projected_atlas_page, AffineTransform, AxisIndex, BinaryFont,
    DirectoryAxisMapping, DirectoryGlyph, DirectoryInstance, DirectorySource, FontDirectory,
    FontImporter, FontMetrics, FontReadError, FontSource, GlifFont, GlyphAnchor, GlyphComponent,
    GlyphDelta, GlyphIndex, GlyphMetrics, GlyphPoint, GlyphPointKind, GlyphProjection, GlyphShape,
    GlyphShapeContour, GlyphShapePoint, GlyphSourceShape, GlyphVariation, GlyphsFont, OpenedFont,
    PointProvenance, ProjectedGlyph, SourceAtlasDescriptor, SourceAtlasError, SourceAtlasPage,
    SourceIndex, TrueTypePointIndex, VariationAxis, VariationAxisKind, VariationCoordinate,
    VariationLocation, VariationRegion, VariationSupport,
};
pub use format::FontFormat;
pub use import::{FontImport, GlyphDirectoryEntry, ImportBatchLimit};
pub use traits::{FontBackend, FontReader, FontView, FontWriter};
