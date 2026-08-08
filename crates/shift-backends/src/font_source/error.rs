use std::path::{Path, PathBuf};

use crate::font_source::{AxisIndex, GlyphIndex};
use crate::FontFormat;

pub(crate) fn malformed(path: &Path, details: String) -> FontReadError {
    let format = match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("ufo") => FontFormat::Ufo,
        Some("glyphs" | "glyphspackage") => FontFormat::Glyphs,
        Some("designspace") => FontFormat::Designspace,
        Some("shift") => FontFormat::Shift,
        Some("otf") => FontFormat::Otf,
        Some("ttf") | None | Some(_) => FontFormat::Ttf,
    };
    FontReadError::MalformedSource {
        format,
        path: path.to_path_buf(),
        details,
    }
}

#[derive(Debug, thiserror::Error)]
pub enum FontReadError {
    #[error("unsupported font source format: {path}")]
    UnsupportedFormat { path: PathBuf },

    #[error("failed to read font source '{path}': {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("malformed {} font source '{}': {details}", format.name(), path.display())]
    MalformedSource {
        format: FontFormat,
        path: PathBuf,
        details: String,
    },

    #[error("unsupported location-independent font projection: {details}")]
    UnsupportedProjection { details: &'static str },

    #[error("glyph index {glyph:?} is outside directory length {glyph_count}")]
    GlyphOutOfRange { glyph: GlyphIndex, glyph_count: u32 },

    #[error("variation axis {axis:?} does not exist")]
    UnknownAxis { axis: AxisIndex },

    #[error("variation axis {axis:?} was specified more than once")]
    DuplicateAxis { axis: AxisIndex },

    #[error("variation coordinate {value} for axis {axis:?} is not finite")]
    NonFiniteCoordinate { axis: AxisIndex, value: f64 },

    #[error("variation coordinate {value} for axis {axis:?} is outside [{minimum}, {maximum}]")]
    CoordinateOutOfRange {
        axis: AxisIndex,
        value: f64,
        minimum: f64,
        maximum: f64,
    },

    #[error("variation coordinate {value} is not declared for discrete axis {axis:?}")]
    CoordinateNotAllowed { axis: AxisIndex, value: f64 },

    #[error("glyph {glyph:?} references missing component glyph {base:?}")]
    MissingComponent { glyph: GlyphIndex, base: GlyphIndex },

    #[error("glyph {glyph:?} has a cyclic component reference")]
    ComponentCycle { glyph: GlyphIndex },

    #[error("invalid glyph projection: {details}")]
    InvalidProjection { details: String },
}
