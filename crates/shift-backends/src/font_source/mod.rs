pub(crate) mod atlas;
mod error;
pub(crate) mod geometry;
pub(crate) mod inputs;
pub(crate) mod interpolation;
pub(crate) mod projection;
mod types;

pub use crate::formats::designspace::DesignspaceFont;
pub use crate::formats::glyphs::GlyphsFont;
pub use crate::formats::opentype::{build_binary_atlas_page, OpenTypeFont};
pub use crate::formats::ufo::UfoFont;
pub use atlas::{SourceAtlasDescriptor, SourceAtlasError, SourceAtlasPage};
pub(crate) use error::malformed;
pub use error::FontReadError;
pub(crate) use geometry::inferred_smooth_point_indices;
pub use inputs::variable_glyph_inputs;
pub(crate) use interpolation::piecewise_map;
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
}

/// Exhaustive authored conversion from the original retained source semantics.
pub trait FontImporter: FontSource {
    fn begin_import(&self) -> BackendResult<FontImport>;
}

/// One retained source selected by [`crate::font_loader::FontLoader`].
pub enum OpenedFont {
    OpenType(OpenTypeFont),
    Ufo(UfoFont),
    Designspace(DesignspaceFont),
    Glyphs(GlyphsFont),
}

impl OpenedFont {
    /// Returns exhaustive authored conversion only for product-convertible sources.
    pub fn importer(&self) -> Option<&dyn FontImporter> {
        match self {
            Self::OpenType(_) => None,
            Self::Ufo(font) => Some(font),
            Self::Designspace(font) => Some(font),
            Self::Glyphs(font) => Some(font),
        }
    }
}

impl FontSource for OpenedFont {
    fn directory(&self) -> &FontDirectory {
        match self {
            Self::OpenType(font) => font.directory(),
            Self::Ufo(font) => font.directory(),
            Self::Designspace(font) => font.directory(),
            Self::Glyphs(font) => font.directory(),
        }
    }

    fn glyph(&self, glyph: GlyphIndex) -> Result<ProjectedGlyph, FontReadError> {
        match self {
            Self::OpenType(font) => font.glyph(glyph),
            Self::Ufo(font) => font.glyph(glyph),
            Self::Designspace(font) => font.glyph(glyph),
            Self::Glyphs(font) => font.glyph(glyph),
        }
    }
}
