pub(crate) mod atlas;
mod error;
pub(crate) mod geometry;
pub(crate) mod inputs;
pub(crate) mod interpolation;
pub(crate) mod projection;
mod types;

pub use crate::formats::designspace::DesignspaceFont;
pub use crate::formats::glyphs::GlyphsFont;
pub use crate::formats::opentype::{OpenTypeFont, build_binary_atlas_page};
pub use crate::formats::ufo::UfoFont;
pub use atlas::{SourceAtlasDescriptor, SourceAtlasError, SourceAtlasPage};
pub use error::FontReadError;
pub(crate) use error::malformed;
pub(crate) use geometry::inferred_smooth_point_indices;
pub use inputs::variable_glyph_inputs;
pub(crate) use interpolation::piecewise_map;
pub(crate) use types::DirectoryGlyphInput;
pub use types::{
    AffineTransform, AxisIndex, DirectoryGlyph, DirectoryInstance, DirectoryMapping,
    DirectoryMappingPoint, DirectorySource, FontDirectory, FontMetrics, GlyphAnchor,
    GlyphComponent, GlyphDelta, GlyphIndex, GlyphMetrics, GlyphPoint, GlyphPointKind,
    GlyphProjection, GlyphShape, GlyphShapeContour, GlyphShapePoint, GlyphSourceShape,
    GlyphVariation, PointProvenance, ProjectedGlyph, SourceIndex, TrueTypePointIndex,
    VariationAxis, VariationAxisKind, VariationCoordinate, VariationLocation, VariationRegion,
    VariationSupport,
};

use crate::{BackendResult, FontImport};

/// Immutable retained font source with location-independent glyph acquisition.
pub trait FontSource: Send + Sync {
    fn directory(&self) -> &FontDirectory;

    /// Projects one glyph, with its variation and exact-source shapes.
    ///
    /// # Errors
    ///
    /// Returns [`FontReadError::GlyphOutOfRange`] when `glyph` is not in the font, and
    /// [`FontReadError::MalformedSource`] or [`FontReadError::UnsupportedProjection`] when the
    /// glyph cannot be read or projected.
    fn glyph(&self, glyph: GlyphIndex) -> Result<ProjectedGlyph, FontReadError>;
}

/// Exhaustive authored conversion from the original retained source semantics.
pub trait FontImporter: FontSource {
    /// Starts a bounded glyph stream that imports the whole font.
    ///
    /// # Errors
    ///
    /// Returns [`BackendError::Load`](crate::BackendError::Load) when the source
    /// cannot be read, and
    /// [`BackendError::StreamingUnsupported`](crate::BackendError::StreamingUnsupported)
    /// when its format cannot stream.
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
