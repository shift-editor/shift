mod atlas;
mod binary;
mod error;
mod geometry;
mod glif;
mod glyphs;
mod interpolation;
mod types;

pub use atlas::{SourceAtlasDescriptor, SourceAtlasError, SourceAtlasPage};
pub use binary::{build_binary_atlas_page, BinaryFont};
pub use error::FontReadError;
pub use glif::GlifFont;
pub use glyphs::GlyphsFont;
pub use types::{
    AffineTransform, AnchorRange, AxisIndex, ComponentInstance, ComponentRange, ContourRange,
    DirectoryGlyph, DisplayGlyph, FontDirectory, GeometryIndex, GlyphAnchor, GlyphBounds,
    GlyphContour, GlyphGeometry, GlyphGuide, GlyphIndex, GlyphMetrics, GlyphPoint, GlyphPointKind,
    GuideRange, PointProvenance, PointRange, TrueTypePointIndex, VariationAxis, VariationAxisKind,
    VariationCoordinate, VariationLocation,
};

use crate::{BackendResult, FontImport};

/// Retained random access to one opened non-native font source.
pub trait RandomAccessFont: Send + Sync {
    fn directory(&self) -> &FontDirectory;

    fn read_glyph(
        &self,
        glyph: GlyphIndex,
        location: &VariationLocation,
    ) -> Result<DisplayGlyph, FontReadError>;
}

/// Exhaustive authored conversion from the original retained source semantics.
pub trait FontImporter: RandomAccessFont {
    fn begin_import(&self) -> BackendResult<FontImport>;
}

/// One retained source selected by [`crate::font_loader::FontLoader`].
pub enum FontSource {
    Binary(BinaryFont),
    Glif(GlifFont),
    Glyphs(GlyphsFont),
}

impl FontSource {
    /// Returns exhaustive authored conversion only for product-convertible sources.
    pub fn importer(&self) -> Option<&dyn FontImporter> {
        match self {
            Self::Binary(_) => None,
            Self::Glif(font) => Some(font),
            Self::Glyphs(font) => Some(font),
        }
    }
}

impl RandomAccessFont for FontSource {
    fn directory(&self) -> &FontDirectory {
        match self {
            Self::Binary(font) => font.directory(),
            Self::Glif(font) => font.directory(),
            Self::Glyphs(font) => font.directory(),
        }
    }

    fn read_glyph(
        &self,
        glyph: GlyphIndex,
        location: &VariationLocation,
    ) -> Result<DisplayGlyph, FontReadError> {
        match self {
            Self::Binary(font) => font.read_glyph(glyph, location),
            Self::Glif(font) => font.read_glyph(glyph, location),
            Self::Glyphs(font) => font.read_glyph(glyph, location),
        }
    }
}
