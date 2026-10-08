mod atomic;
pub mod errors;
pub mod export;
pub mod font_loader;
pub mod font_source;
pub mod format;
pub mod formats;
mod glyph_subset;
pub mod import;
mod import_report;
mod kerning_import;
mod metrics;
mod shift2fontir;
mod source_glyph_ids;
mod traits;

pub use errors::{BackendError, BackendResult, FormatBackendError, FormatBackendResult};
pub use export::{ExportError, ExportFormat, FontExportRequest, FontExportResult, FontExporter};
pub use font_source::{
    build_binary_atlas_page, variable_glyph_inputs, AffineTransform, AxisIndex, DesignspaceFont,
    DirectoryGlyph, DirectoryInstance, DirectoryMapping, DirectoryMappingPoint, DirectorySource,
    FontDirectory, FontImporter, FontMetrics, FontReadError, FontSource, GlyphAnchor,
    GlyphComponent, GlyphDelta, GlyphIndex, GlyphMetrics, GlyphPoint, GlyphPointKind,
    GlyphProjection, GlyphShape, GlyphShapeContour, GlyphShapePoint, GlyphSourceShape,
    GlyphVariation, GlyphsFont, OpenTypeFont, OpenedFont, PointProvenance, ProjectedGlyph,
    SourceAtlasDescriptor, SourceAtlasError, SourceAtlasPage, SourceIndex, TrueTypePointIndex,
    UfoFont, VariationAxis, VariationAxisKind, VariationCoordinate, VariationLocation,
    VariationRegion, VariationSupport,
};
pub use format::FontFormat;
pub use glyph_subset::GlyphSubsetView;
pub use import::{FontImport, GlyphDirectoryEntry, ImportBatchLimit};
pub use import_report::{ImportLoss, ImportLossKind, ImportReport};
pub use source_glyph_ids::SourceGlyphIds;
pub use traits::{FontBackend, FontReader, FontView, FontWriter};
