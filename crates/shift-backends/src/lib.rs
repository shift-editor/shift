// Library code returns errors instead of panicking: a panic kills the
// WebAssembly engine. Tests may unwrap (clippy.toml).
#![warn(clippy::unwrap_used, clippy::print_stdout)]

mod atomic;
pub mod errors;
pub mod export;
mod feature_includes;
pub mod font_loader;
pub mod font_source;
pub mod format;
pub mod formats;
mod glyph_category;
mod glyph_subset;
pub mod import;
mod import_report;
mod kerning_import;
mod metrics;
pub mod shaper_font;
mod shift2fontir;
mod source_glyph_ids;
mod traits;

pub use errors::{BackendError, BackendResult, FormatBackendError, FormatBackendResult};
pub use export::{ExportError, ExportFormat, FontExportRequest, FontExportResult, FontExporter};
pub use font_source::{
    AffineTransform, AxisIndex, DesignspaceFont, DirectoryGlyph, DirectoryInstance,
    DirectoryMapping, DirectoryMappingPoint, DirectorySource, FontDirectory, FontImporter,
    FontMetrics, FontReadError, FontSource, GlyphAnchor, GlyphComponent, GlyphDelta, GlyphIndex,
    GlyphMetrics, GlyphPoint, GlyphPointKind, GlyphProjection, GlyphShape, GlyphShapeContour,
    GlyphShapePoint, GlyphSourceShape, GlyphVariation, GlyphsFont, OpenTypeFont, OpenedFont,
    PointProvenance, ProjectedGlyph, SourceAtlasDescriptor, SourceAtlasError, SourceAtlasPage,
    SourceIndex, TrueTypePointIndex, UfoFont, VariationAxis, VariationAxisKind,
    VariationCoordinate, VariationLocation, VariationRegion, VariationSupport,
    build_binary_atlas_page, variable_glyph_inputs,
};
pub use format::FontFormat;
pub use glyph_category::{
    GlyphCategories, PropagationLigature, RecordCategory, ResolvedCategory, record_categories,
};
pub use glyph_subset::GlyphSubsetView;
pub use import::{FontImport, GlyphDirectoryEntry, ImportBatchLimit};
pub(crate) use import_report::distinct_named_instances;
pub use import_report::{ImportLoss, ImportLossKind, ImportReport};
pub use shift2fontir::{
    AxisConversionError, MappingSide, PropagatedAnchor, PropagatedGlyphAnchors,
    PropagatedSourceAnchors,
};
pub use source_glyph_ids::SourceGlyphIds;
pub use traits::{FontBackend, FontReader, FontView, FontWriter};
