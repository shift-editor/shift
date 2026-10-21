//! Arranges shaped proof lines on a page in pixel space.
//!
//! Page coordinates are pixels with the origin at the top-left corner and y
//! pointing down. Each row keeps its run in font units plus the scale and
//! origin needed to place it: a horizontal row's origin is the pen position
//! on its baseline, a vertical row's is the top centre of its column.

use crate::label::{label_height, label_width};
use crate::numeric::ceil_pixels;
use crate::palette::Rgb;
use crate::shape::ShapedRun;
use crate::{ProofFont, ProofMetrics, ShapingOptions, TextDirection};

/// Space around the content, in pixels.
pub(crate) const MARGIN: f32 = 24.0;
/// Pixels per bitmap cell of row labels.
pub(crate) const ROW_LABEL_PIXEL: f32 = 2.0;
/// Space between the label column and the text, in pixels.
const LABEL_GAP: f32 = 16.0;
/// Extra space between rows, as a fraction of the row's size.
const ROW_GAP_EM: f32 = 0.25;
/// Extra space between groups of rows that set the same line, in pixels.
const GROUP_GAP: f32 = 16.0;
/// Narrowest page, so tiny proofs still have room for their labels.
const MIN_WIDTH: f32 = 160.0;

/// A compiled font bound to one location, with the label its rows carry.
pub struct LocatedFont<'a> {
    pub font: ProofFont<'a>,
    pub label: String,
}

/// One drawn run: a proof line (or a wrapped part of one) at one size and
/// location, or one grid cell.
pub struct Row {
    /// The text set, or the grid cell's label.
    pub text: String,
    /// Index of the proof line, or of the grid cell within its grid.
    pub line: usize,
    /// Index of the location this row is set at.
    pub location: usize,
    /// Pixels per em.
    pub size: f32,
    /// Pixels per font unit.
    pub scale: f32,
    /// Pen origin, in pixels from the left.
    pub origin_x: f32,
    /// Baseline, or the top of a vertical column, in pixels from the top.
    pub baseline: f32,
    pub run: ShapedRun,
}

impl Row {
    /// Right edge of a horizontal row's text, in pixels.
    fn right(&self) -> f32 {
        self.origin_x + self.run.advance * self.scale
    }
}

/// Bitmap text drawn in the label color, top-left at `(x, y)` pixels.
pub struct Label {
    pub text: String,
    pub x: f32,
    pub y: f32,
    /// Pixels per bitmap cell.
    pub pixel: f32,
}

/// A horizontal metric reference line.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Guide {
    Ascender,
    CapHeight,
    XHeight,
    Baseline,
    Descender,
}

impl Guide {
    /// Top to bottom.
    pub const ALL: [Self; 5] = [
        Self::Ascender,
        Self::CapHeight,
        Self::XHeight,
        Self::Baseline,
        Self::Descender,
    ];

    /// Stroke color shared by raster and vector output.
    pub fn color(self) -> Rgb {
        match self {
            Self::Ascender => Rgb([148, 103, 189]),
            Self::CapHeight => Rgb([23, 190, 207]),
            Self::XHeight => Rgb([44, 160, 44]),
            Self::Baseline => Rgb([31, 119, 180]),
            Self::Descender => Rgb([255, 127, 14]),
        }
    }

    /// Stable name shared by JSON reports and SVG classes.
    pub fn name(self) -> &'static str {
        match self {
            Self::Ascender => "ascender",
            Self::CapHeight => "capHeight",
            Self::XHeight => "xHeight",
            Self::Baseline => "baseline",
            Self::Descender => "descender",
        }
    }

    /// Height above the baseline in font units, when the font defines it.
    pub fn position(self, metrics: &ProofMetrics) -> Option<f32> {
        match self {
            Self::Ascender => Some(metrics.ascender),
            Self::CapHeight => metrics.cap_height,
            Self::XHeight => metrics.x_height,
            Self::Baseline => Some(0.0),
            Self::Descender => Some(metrics.descender),
        }
    }
}

/// A guide placed on the page, in pixels.
pub struct GuideLine {
    pub guide: Guide,
    pub y: f32,
    pub x0: f32,
    pub x1: f32,
}

/// Everything a renderer needs to draw a proof.
pub struct Page {
    pub width: u32,
    pub height: u32,
    pub rows: Vec<Row>,
    pub guides: Vec<GuideLine>,
    pub labels: Vec<Label>,
}

/// Options for [`layout_text`].
pub struct TextLayout<'l> {
    /// Proof lines, which may contain `/name` glyph tokens.
    pub lines: &'l [String],
    /// Pixels per em.
    pub sizes: &'l [f32],
    /// Fixed page width in pixels; horizontal lines wrap at spaces to fit.
    pub width: Option<u32>,
    /// Draw metric guides behind the horizontal rows at the largest size.
    pub guides: bool,
    pub shaping: &'l ShapingOptions,
}

/// Lays out every line at every size at every location, in that order, so
/// the same text at different locations stacks for comparison.
///
/// Each row is labelled with its size, and with its location when there is
/// more than one. Right-to-left rows are right-aligned. Vertical text is set
/// in columns from left to right, never wrapped and without guides.
pub fn layout_text(fonts: &[LocatedFont], options: &TextLayout) -> Page {
    if options
        .shaping
        .direction
        .is_some_and(TextDirection::is_vertical)
    {
        return layout_columns(fonts, options);
    }

    let labels_for = |size: f32| -> Vec<String> {
        fonts
            .iter()
            .map(|located| row_label(size, &located.label, fonts.len()))
            .collect()
    };
    let label_column = options
        .sizes
        .iter()
        .flat_map(|size| labels_for(*size))
        .map(|label| label_width(&label, ROW_LABEL_PIXEL))
        .fold(0.0_f32, f32::max);
    let origin_x = MARGIN + label_column + LABEL_GAP;
    let available = options
        .width
        .map(|width| (width as f32 - origin_x - MARGIN).max(1.0));
    let largest = options.sizes.iter().copied().fold(0.0_f32, f32::max);
    let grouped = fonts.len() > 1 || options.sizes.len() > 1;

    let mut rows = Vec::new();
    let mut labels = Vec::new();
    let mut guided = Vec::new();
    let mut cursor = MARGIN;
    for (line_index, line) in options.lines.iter().enumerate() {
        if line_index > 0 && grouped {
            cursor += GROUP_GAP;
        }
        for size in options.sizes {
            for ((location, located), label) in fonts.iter().enumerate().zip(labels_for(*size)) {
                let metrics = located.font.metrics();
                let scale = size / f32::from(metrics.units_per_em);
                let limit = available.map(|width| width / scale);
                let parts = wrap(&located.font, line, limit, options.shaping);
                for (part, (text, run)) in parts.into_iter().enumerate() {
                    let baseline = cursor + metrics.ascender * scale;
                    cursor = baseline - metrics.descender * scale + size * ROW_GAP_EM;
                    if part == 0 {
                        labels.push(Label {
                            text: label.clone(),
                            x: MARGIN,
                            y: baseline - label_height(ROW_LABEL_PIXEL),
                            pixel: ROW_LABEL_PIXEL,
                        });
                    }
                    if options.guides && *size == largest {
                        guided.push((rows.len(), metrics));
                    }
                    rows.push(Row {
                        text,
                        line: line_index,
                        location,
                        size: *size,
                        scale,
                        origin_x,
                        baseline,
                        run,
                    });
                }
            }
        }
    }

    let content_right = rows.iter().map(Row::right).fold(0.0_f32, f32::max);
    let page_width = options.width.map_or_else(
        || (content_right + MARGIN).max(MIN_WIDTH).ceil(),
        |width| width as f32,
    );
    let right = page_width - MARGIN;
    for row in rows
        .iter_mut()
        .filter(|row| row.run.direction.is_backward())
    {
        row.origin_x = (right - row.run.advance * row.scale).max(origin_x);
    }
    let guides = guided
        .into_iter()
        .flat_map(|(index, metrics)| {
            let row = &rows[index];
            Guide::ALL.into_iter().filter_map(move |guide| {
                Some(GuideLine {
                    guide,
                    y: row.baseline - guide.position(&metrics)? * row.scale,
                    x0: origin_x,
                    x1: right,
                })
            })
        })
        .collect();
    let last_gap = ROW_GAP_EM * options.sizes.last().copied().unwrap_or(0.0);
    Page {
        width: ceil_pixels(page_width),
        height: ceil_pixels(cursor - last_gap + MARGIN),
        rows,
        guides,
        labels,
    }
}

// Sets each line as a column whose pen starts at the top centre.
fn layout_columns(fonts: &[LocatedFont], options: &TextLayout) -> Page {
    let top = MARGIN + label_height(ROW_LABEL_PIXEL) + LABEL_GAP / 2.0;
    let mut rows = Vec::new();
    let mut labels = Vec::new();
    let mut cursor = MARGIN;
    let mut bottom = top;
    for (line_index, line) in options.lines.iter().enumerate() {
        for size in options.sizes {
            for (location, located) in fonts.iter().enumerate() {
                let label = row_label(*size, &located.label, fonts.len());
                let scale = size / f32::from(located.font.units_per_em());
                let run = located.font.set_line(line, options.shaping);
                let column = size.max(label_width(&label, ROW_LABEL_PIXEL));
                labels.push(Label {
                    text: label,
                    x: cursor,
                    y: MARGIN,
                    pixel: ROW_LABEL_PIXEL,
                });
                bottom = bottom.max(top + run.advance * scale);
                rows.push(Row {
                    text: line.clone(),
                    line: line_index,
                    location,
                    size: *size,
                    scale,
                    origin_x: cursor + column / 2.0,
                    baseline: top,
                    run,
                });
                cursor += column + size * 0.5;
            }
        }
    }
    Page {
        width: ceil_pixels((cursor + MARGIN).max(MIN_WIDTH)),
        height: ceil_pixels(bottom + MARGIN),
        rows,
        guides: Vec::new(),
        labels,
    }
}

fn row_label(size: f32, location: &str, locations: usize) -> String {
    let size = if size.fract() == 0.0 {
        format!("{size:.0}")
    } else {
        format!("{size}")
    };
    if locations > 1 {
        format!("{size} {location}")
    } else {
        size
    }
}

// Splits `line` greedily at spaces so each part fits `max_advance` font
// units; a single word wider than the limit keeps its own row. Each part is
// set whole, so kerning across the kept spaces is preserved.
fn wrap(
    font: &ProofFont,
    line: &str,
    max_advance: Option<f32>,
    options: &ShapingOptions,
) -> Vec<(String, ShapedRun)> {
    let Some(max_advance) = max_advance else {
        return vec![(line.to_string(), font.set_line(line, options))];
    };

    let mut parts = Vec::new();
    let mut current: Option<(String, ShapedRun)> = None;
    for word in line.split(' ') {
        let candidate = match &current {
            Some((text, _)) => format!("{text} {word}"),
            None => word.to_string(),
        };
        let run = font.set_line(&candidate, options);
        if run.advance <= max_advance {
            current = Some((candidate, run));
            continue;
        }
        match current.take() {
            Some(fitted) => {
                parts.push(fitted);
                current = Some((word.to_string(), font.set_line(word, options)));
            }
            None => parts.push((candidate, run)),
        }
    }
    parts.extend(current);
    parts
}
