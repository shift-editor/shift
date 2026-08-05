mod atlas;
mod binary;
mod error;
pub(crate) mod geometry;
mod glif;
mod glyphs;
mod interpolation;
mod projected_atlas;
mod projection;
mod types;

pub use atlas::{SourceAtlasDescriptor, SourceAtlasError, SourceAtlasPage};
pub use binary::{build_binary_atlas_page, BinaryFont};
pub use error::FontReadError;
pub(crate) use geometry::inferred_smooth_point_indices;
pub use glif::GlifFont;
pub use glyphs::GlyphsFont;
pub use projected_atlas::build_projected_atlas_page;
pub use types::{
    AffineTransform, AxisIndex, DirectoryAxisMapping, DirectoryGlyph, DirectoryInstance,
    DirectorySource, FontDirectory, FontMetrics, GlyphAnchor, GlyphComponent, GlyphDelta,
    GlyphIndex, GlyphMetrics, GlyphPoint, GlyphPointKind, GlyphProjection, GlyphShape,
    GlyphShapeContour, GlyphShapePoint, GlyphSourceShape, GlyphVariation, PointProvenance,
    ProjectedGlyph, SourceIndex, TrueTypePointIndex, VariationAxis, VariationAxisKind,
    VariationCoordinate, VariationLocation, VariationRegion, VariationSupport,
};

use crate::{BackendResult, FontImport};

/// Immutable retained font source with location-independent glyph acquisition.
pub trait FontSource: Send + Sync {
    fn directory(&self) -> &FontDirectory;

    fn glyph(&self, glyph: GlyphIndex) -> Result<ProjectedGlyph, FontReadError>;

    fn atlas_page(
        &self,
        roots: &[GlyphIndex],
        band_count: u32,
    ) -> Result<SourceAtlasPage, SourceAtlasError> {
        build_projected_atlas_page(self, roots, band_count)
    }
}

/// Exhaustive authored conversion from the original retained source semantics.
pub trait FontImporter: FontSource {
    fn begin_import(&self) -> BackendResult<FontImport>;
}

/// One retained source selected by [`crate::font_loader::FontLoader`].
pub enum OpenedFont {
    Binary(BinaryFont),
    Glif(GlifFont),
    Glyphs(GlyphsFont),
}

impl OpenedFont {
    /// Returns exhaustive authored conversion only for product-convertible sources.
    pub fn importer(&self) -> Option<&dyn FontImporter> {
        match self {
            Self::Binary(_) => None,
            Self::Glif(font) => Some(font),
            Self::Glyphs(font) => Some(font),
        }
    }
}

impl FontSource for OpenedFont {
    fn directory(&self) -> &FontDirectory {
        match self {
            Self::Binary(font) => font.directory(),
            Self::Glif(font) => font.directory(),
            Self::Glyphs(font) => font.directory(),
        }
    }

    fn glyph(&self, glyph: GlyphIndex) -> Result<ProjectedGlyph, FontReadError> {
        match self {
            Self::Binary(font) => font.glyph(glyph),
            Self::Glif(font) => font.glyph(glyph),
            Self::Glyphs(font) => font.glyph(glyph),
        }
    }

    fn atlas_page(
        &self,
        roots: &[GlyphIndex],
        band_count: u32,
    ) -> Result<SourceAtlasPage, SourceAtlasError> {
        match self {
            Self::Binary(font) => font.atlas_page(roots, band_count),
            Self::Glif(font) => font.atlas_page(roots, band_count),
            Self::Glyphs(font) => font.atlas_page(roots, band_count),
        }
    }
}
