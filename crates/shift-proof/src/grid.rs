//! Sets glyphs in a grid of cells, each named underneath, one grid per
//! location.

use crate::label::{fit_label, label_height, label_width};
use crate::layout::{Label, LocatedFont, MARGIN, Page, ROW_LABEL_PIXEL, Row};
use crate::numeric::{ceil_pixels, whole_count};
use crate::shape::{RunGlyph, ShapedGlyph};
use crate::text::{Piece, pieces};
use crate::{ProofFont, TextDirection};

/// Pixels per bitmap cell of glyph names.
const NAME_PIXEL: f32 = 1.0;
/// Space inside each cell around the glyph and its name, in pixels.
const CELL_PADDING: f32 = 6.0;
/// Space between a glyph's descender and its name, in pixels.
const NAME_GAP: f32 = 4.0;
/// Narrowest and widest glyph area of a cell, in ems.
const MIN_CELL_EM: f32 = 0.6;
const MAX_CELL_EM: f32 = 1.6;
/// Lines a glyph name may wrap onto under its cell.
const NAME_LINES: usize = 2;
/// Space between wrapped name lines, in pixels.
const NAME_LEADING: f32 = 2.0;
/// Space between grids, in pixels.
const GRID_GAP: f32 = 24.0;

/// Options for [`layout_grid`].
pub struct GridLayout<'l> {
    /// Characters and `/name` tokens whose glyphs fill the grid; spaces
    /// separate them and are not set. Empty sets every glyph in glyph order.
    pub lines: &'l [String],
    /// Pixels per em.
    pub size: f32,
    /// Page width in pixels; cells wrap to fit.
    pub width: u32,
}

/// One glyph to put in a cell.
struct Cell {
    glyph_id: u32,
    /// Name printed under the glyph: the glyph name, or what was asked for
    /// when the font lacks it.
    label: String,
    missing: bool,
}

/// Lays out one grid per location, labelled with the location when there is
/// more than one. Cells are as wide as the widest glyph, within 0.6 to 1.6
/// em, and glyphs are centred in them unshaped.
///
/// Each grid cell becomes one [`Row`] whose text is the cell's label and
/// whose `line` is the cell's index in its grid.
pub fn layout_grid(fonts: &[LocatedFont], options: &GridLayout) -> Page {
    let mut rows = Vec::new();
    let mut labels = Vec::new();
    let mut cursor = MARGIN;
    for (location, located) in fonts.iter().enumerate() {
        let font = &located.font;
        if location > 0 {
            cursor += GRID_GAP;
        }
        if fonts.len() > 1 {
            labels.push(Label {
                text: located.label.clone(),
                x: MARGIN,
                y: cursor,
                pixel: ROW_LABEL_PIXEL,
            });
            cursor += label_height(ROW_LABEL_PIXEL) + CELL_PADDING;
        }

        let cells = cells(font, options.lines);
        let metrics = font.metrics();
        let scale = options.size / f32::from(metrics.units_per_em);
        let widest = cells
            .iter()
            .map(|cell| font.advance_width(cell.glyph_id).unwrap_or_default() * scale)
            .fold(0.0_f32, f32::max);
        let glyph_area = widest.clamp(options.size * MIN_CELL_EM, options.size * MAX_CELL_EM);
        let cell_width = (glyph_area + CELL_PADDING * 2.0).ceil();
        let ink_height = (metrics.ascender - metrics.descender) * scale;
        let cell_height = (ink_height + NAME_GAP + name_height() + CELL_PADDING * 2.0).ceil();
        let usable = (options.width as f32 - MARGIN * 2.0).max(cell_width);
        let columns = whole_count(usable / cell_width).max(1);

        for (index, cell) in cells.into_iter().enumerate() {
            let left = MARGIN + (index % columns) as f32 * cell_width;
            let top = cursor + (index / columns) as f32 * cell_height;
            let advance = font.advance_width(cell.glyph_id).unwrap_or_default();
            let glyph = RunGlyph {
                glyph: ShapedGlyph {
                    glyph_id: cell.glyph_id,
                    cluster: 0,
                    x_advance: advance,
                    y_advance: 0.0,
                    x_offset: 0.0,
                    y_offset: 0.0,
                },
                missing: cell.missing,
            };
            let run = font.place([glyph], TextDirection::LeftToRight);
            let baseline = top + CELL_PADDING + metrics.ascender * scale;
            let name_top = baseline - metrics.descender * scale + NAME_GAP;
            for (line, name) in name_lines(&cell.label, cell_width - 2.0)
                .into_iter()
                .enumerate()
            {
                labels.push(Label {
                    x: left + (cell_width - label_width(&name, NAME_PIXEL)) / 2.0,
                    y: name_top + line as f32 * (label_height(NAME_PIXEL) + NAME_LEADING),
                    text: name,
                    pixel: NAME_PIXEL,
                });
            }
            rows.push(Row {
                text: cell.label,
                line: index,
                location,
                size: options.size,
                scale,
                origin_x: left + (cell_width - run.advance * scale) / 2.0,
                baseline,
                run,
            });
        }
        let used_rows = rows
            .iter()
            .filter(|row| row.location == location)
            .count()
            .div_ceil(columns);
        cursor += used_rows as f32 * cell_height;
    }

    Page {
        width: options.width,
        height: ceil_pixels(cursor + MARGIN),
        rows,
        guides: Vec::new(),
        labels,
    }
}

fn name_height() -> f32 {
    NAME_LINES as f32 * (label_height(NAME_PIXEL) + NAME_LEADING) - NAME_LEADING
}

// Breaks a glyph name into at most `NAME_LINES` lines that fit `width`
// pixels, cutting what still does not fit.
fn name_lines(name: &str, width: f32) -> Vec<String> {
    let per_line = fit_label(name, NAME_PIXEL, width).chars().count().max(1);
    let characters: Vec<char> = name.chars().collect();
    characters
        .chunks(per_line)
        .take(NAME_LINES)
        .map(|chunk| chunk.iter().collect())
        .collect()
}

// Resolves the requested glyphs, or every glyph in glyph order.
fn cells(font: &ProofFont, lines: &[String]) -> Vec<Cell> {
    if lines.is_empty() {
        return (0..font.glyph_count())
            .map(|glyph_id| Cell {
                glyph_id,
                label: font
                    .glyph_name(glyph_id)
                    .unwrap_or_else(|| format!("gid{glyph_id}")),
                missing: false,
            })
            .collect();
    }

    let mut cells = Vec::new();
    for piece in lines.iter().flat_map(|line| pieces(line)) {
        match piece {
            Piece::Text { text, .. } => {
                for character in text.chars().filter(|character| !character.is_whitespace()) {
                    let glyph_id = font.glyph_for_char(character);
                    let label = glyph_id
                        .and_then(|glyph_id| font.glyph_name(glyph_id))
                        .unwrap_or_else(|| format!("U+{:04X}", u32::from(character)));
                    cells.push(Cell {
                        glyph_id: glyph_id.unwrap_or(0),
                        label,
                        missing: glyph_id.is_none(),
                    });
                }
            }
            Piece::Glyph { name, .. } => {
                let glyph_id = font.glyph_by_name(&name);
                cells.push(Cell {
                    glyph_id: glyph_id.unwrap_or(0),
                    label: name,
                    missing: glyph_id.is_none(),
                });
            }
        }
    }
    cells
}
