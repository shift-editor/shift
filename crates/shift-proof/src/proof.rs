//! Turns a proof request into an image and its report.

use serde::Serialize;

use crate::grid::{GridLayout, layout_grid};
use crate::layout::{LocatedFont, TextLayout, layout_text};
use crate::report::{ReportContext, build_report};
use crate::{ProofError, ProofFont, ProofLocation, ProofReport, ShapingOptions};

/// Lines proofed when no text is given: a spacing control string, the
/// classic round/straight check, a pangram, and confusable figures.
pub const DEFAULT_TEXT: [&str; 4] = [
    "Hamburgefonstiv",
    "HOHOHOnnnooo",
    "The quick brown fox jumps over the lazy dog",
    "0123456789 Il1| O0 {}[]()",
];
/// Text size used when no sizes are given, in pixels per em.
const DEFAULT_TEXT_SIZE: f32 = 72.0;
/// Grid size used when no sizes are given, in pixels per em.
const DEFAULT_GRID_SIZE: f32 = 48.0;
/// Grid page width used when no width is given, in pixels.
pub const DEFAULT_GRID_WIDTH: u32 = 1200;
/// Largest accepted size, which keeps a single row within raster limits.
pub const MAX_SIZE: f32 = 1000.0;

/// Image encoding of a proof.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ImageFormat {
    #[default]
    Png,
    Svg,
}

impl ImageFormat {
    /// SVG for a file name ending in `.svg` (any case), PNG otherwise.
    pub fn from_file_name(name: &str) -> Self {
        let is_svg = name
            .rsplit_once('.')
            .is_some_and(|(_, extension)| extension.eq_ignore_ascii_case("svg"));
        if is_svg { Self::Svg } else { Self::Png }
    }
}

/// How a proof arranges its glyphs.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ProofMode {
    /// Shaped lines as a waterfall of sizes and locations.
    #[default]
    Text,
    /// Unshaped glyphs in named cells, one grid per location.
    Grid,
}

/// Everything that decides a proof except the font.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ProofRequest {
    pub mode: ProofMode,
    /// Proof lines, which may contain `/name` glyph tokens. Empty text uses
    /// [`DEFAULT_TEXT`]; an empty grid shows every glyph in the font.
    pub lines: Vec<String>,
    /// Locations to set every line at, in order; empty uses the default
    /// location.
    pub locations: Vec<ProofLocation>,
    /// Pixels per em. Empty uses 72 for text and 48 for a grid, which takes
    /// exactly one size.
    pub sizes: Vec<f32>,
    /// Fixed image width in pixels: text wraps at spaces, grids wrap cells.
    /// A grid defaults to [`DEFAULT_GRID_WIDTH`].
    pub width: Option<u32>,
    /// Draw ascender, cap-height, x-height, baseline, and descender guides
    /// behind horizontal text.
    pub guides: bool,
    pub shaping: ShapingOptions,
    pub format: ImageFormat,
}

/// An encoded proof image and the report describing it.
pub struct Proof {
    /// PNG or SVG bytes, per [`ProofRequest::format`].
    pub image: Vec<u8>,
    pub report: ProofReport,
}

/// Shapes, lays out, and renders `request` against compiled font bytes.
///
/// Every line is shaped with HarfRust at each location, so kerning and
/// features apply exactly as compiled. Characters the font does not map and
/// glyph names it lacks are drawn as red placeholders and listed in the
/// report.
///
/// # Errors
///
/// Returns [`ProofError`] when the bytes are not a font, text is requested
/// from a font that maps no characters, a location, size, or the width is
/// invalid, a grid is given several sizes, or the page is too large to
/// rasterize.
pub fn render_proof(font_data: &[u8], request: &ProofRequest) -> Result<Proof, ProofError> {
    let sizes = sizes(request)?;
    if request.width == Some(0) {
        return Err(ProofError::ZeroWidth);
    }
    let default_location = [ProofLocation::default()];
    let locations = if request.locations.is_empty() {
        &default_location[..]
    } else {
        &request.locations
    };
    let fonts = locations
        .iter()
        .map(|location| {
            Ok(LocatedFont {
                font: ProofFont::new(font_data, &location.coordinates)?,
                label: location.display_label(),
            })
        })
        .collect::<Result<Vec<_>, ProofError>>()?;

    let lines: Vec<String> = match (request.mode, request.lines.is_empty()) {
        (ProofMode::Text, true) => DEFAULT_TEXT.iter().map(ToString::to_string).collect(),
        _ => request.lines.clone(),
    };
    let page = match request.mode {
        ProofMode::Text => {
            fonts[0].font.require_characters()?;
            let options = TextLayout {
                lines: &lines,
                sizes: &sizes,
                width: request.width,
                guides: request.guides,
                shaping: &request.shaping,
            };
            layout_text(&fonts, &options)
        }
        ProofMode::Grid => {
            let options = GridLayout {
                lines: &lines,
                size: sizes[0],
                width: request.width.unwrap_or(DEFAULT_GRID_WIDTH),
            };
            layout_grid(&fonts, &options)
        }
    };
    let image = match request.format {
        ImageFormat::Png => crate::render_png(&page)?,
        ImageFormat::Svg => crate::render_svg(&page).into_bytes(),
    };

    let context = ReportContext {
        format: request.format,
        mode: request.mode,
        sizes,
        shaping: &request.shaping,
        guides: request.guides,
    };
    Ok(Proof {
        image,
        report: build_report(&fonts, &page, &lines, context),
    })
}

fn sizes(request: &ProofRequest) -> Result<Vec<f32>, ProofError> {
    let sizes = match (request.sizes.is_empty(), request.mode) {
        (true, ProofMode::Text) => vec![DEFAULT_TEXT_SIZE],
        (true, ProofMode::Grid) => vec![DEFAULT_GRID_SIZE],
        (false, _) => request.sizes.clone(),
    };
    let out_of_range = sizes
        .iter()
        .find(|size| !size.is_finite() || **size <= 0.0 || **size > MAX_SIZE);
    if let Some(size) = out_of_range {
        return Err(ProofError::SizeOutOfRange {
            size: *size,
            max: MAX_SIZE,
        });
    }
    if request.mode == ProofMode::Grid && sizes.len() > 1 {
        return Err(ProofError::MultipleGridSizes);
    }
    Ok(sizes)
}
