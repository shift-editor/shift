//! Draws a laid-out proof page as SVG or PNG.
//!
//! Both renderers paint the same page: one filled path per run of same-kind
//! glyphs, metric guides, section dividers, and bitmap labels. Ported from
//! Andrea Fomera's `shift proof` prototype.

use std::fmt::Write as _;

use shift_specimen::shaping::{Segment, ShapedGlyph};
use tiny_skia::{FillRule, Paint, PathBuilder, Pixmap, Rect, Transform};

use crate::label::{cells, LABEL_ADVANCE, LABEL_HEIGHT, LABEL_PIXEL};
use crate::layout::{ProofPage, Row, MARGIN};
use crate::ProofError;

const BACKGROUND: [u8; 3] = [255, 255, 255];
const INK: [u8; 3] = [17, 17, 17];
/// Fill for missing glyphs, so they read as errors rather than ink.
const MISSING: [u8; 3] = [220, 38, 38];
const LABEL: [u8; 3] = [140, 140, 140];
const DIVIDER: [u8; 3] = [225, 225, 225];
const GUIDE_OPACITY: f32 = 0.6;

/// Renders `page` as standalone SVG in pixel coordinates.
pub fn render_svg(page: &ProofPage) -> String {
    let mut svg = String::new();
    let _ = writeln!(
        svg,
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="{0}" height="{1}" viewBox="0 0 {0} {1}">"#,
        page.width, page.height
    );
    let _ = writeln!(
        svg,
        r#"<rect class="background" width="100%" height="100%" fill="{}"/>"#,
        hex(BACKGROUND)
    );
    for y in &page.dividers {
        let y = y.round() + 0.5;
        let _ = writeln!(
            svg,
            r#"<line class="divider" x1="{MARGIN}" y1="{y}" x2="{x2}" y2="{y}" stroke="{color}" stroke-width="1"/>"#,
            x2 = page.width as f32 - MARGIN,
            color = hex(DIVIDER),
        );
    }
    for guide in &page.guides {
        let y = guide.y.round() + 0.5;
        let _ = writeln!(
            svg,
            r#"<line class="guide-{name}" x1="{x0}" y1="{y}" x2="{x1}" y2="{y}" stroke="{color}" stroke-opacity="{GUIDE_OPACITY}" stroke-width="1"/>"#,
            name = guide.guide.name(),
            x0 = round(guide.x0),
            x1 = round(guide.x1),
            color = hex(guide.guide.color()),
        );
    }
    for row in &page.rows {
        if !row.label.is_empty() {
            let _ = writeln!(
                svg,
                r#"<text class="label" x="{MARGIN}" y="{y}" font-family="monospace" font-size="{LABEL_HEIGHT}" fill="{fill}">{text}</text>"#,
                y = round(row.baseline),
                fill = hex(LABEL),
                text = row.label,
            );
        }
        for (glyphs, missing) in runs_by_kind(row) {
            let data = path_data(row, glyphs);
            if data.is_empty() {
                continue;
            }
            let (class, fill) = if missing {
                ("missing", MISSING)
            } else {
                ("ink", INK)
            };
            let _ = writeln!(
                svg,
                r#"<path class="{class}" fill="{fill}" fill-rule="nonzero" d="{data}"/>"#,
                fill = hex(fill),
            );
        }
    }
    svg.push_str("</svg>\n");
    svg
}

/// Renders `page` and returns encoded PNG bytes.
///
/// # Errors
///
/// Returns [`ProofError::Render`] when the page is too large to allocate or
/// cannot be encoded.
pub fn render_png(page: &ProofPage) -> Result<Vec<u8>, ProofError> {
    let mut pixmap = Pixmap::new(page.width, page.height).ok_or_else(|| {
        ProofError::Render(format!(
            "a {}x{} proof is too large to render; use fewer rows, smaller sizes, or a page width",
            page.width, page.height
        ))
    })?;
    pixmap.fill(tiny_skia::Color::from_rgba8(
        BACKGROUND[0],
        BACKGROUND[1],
        BACKGROUND[2],
        255,
    ));

    for y in &page.dividers {
        fill_rect(
            &mut pixmap,
            MARGIN,
            y.round(),
            page.width as f32 - 2.0 * MARGIN,
            1.0,
            DIVIDER,
            255,
        );
    }
    let guide_alpha = (GUIDE_OPACITY * 255.0).round() as u8;
    for guide in &page.guides {
        fill_rect(
            &mut pixmap,
            guide.x0,
            guide.y.round(),
            guide.x1 - guide.x0,
            1.0,
            guide.guide.color(),
            guide_alpha,
        );
    }
    for row in &page.rows {
        draw_label(&mut pixmap, row);
        for (glyphs, missing) in runs_by_kind(row) {
            fill_glyphs(
                &mut pixmap,
                row,
                glyphs,
                if missing { MISSING } else { INK },
            );
        }
    }

    pixmap
        .encode_png()
        .map_err(|error| ProofError::Render(format!("failed to encode the proof PNG: {error}")))
}

/// Splits a row into consecutive glyphs that are all missing or all present.
fn runs_by_kind(row: &Row) -> Vec<(&[ShapedGlyph], bool)> {
    let glyphs = &row.run.glyphs;
    let mut runs = Vec::new();
    let mut start = 0;
    for index in 1..=glyphs.len() {
        if index == glyphs.len() || glyphs[index].missing != glyphs[start].missing {
            runs.push((&glyphs[start..index], glyphs[start].missing));
            start = index;
        }
    }
    runs
}

fn point(row: &Row, x: f32, y: f32) -> (f32, f32) {
    (row.origin_x + x * row.scale, row.baseline - y * row.scale)
}

fn path_data(row: &Row, glyphs: &[ShapedGlyph]) -> String {
    let mut data = String::new();
    let push = |data: &mut String, x: f32, y: f32| {
        let (x, y) = point(row, x, y);
        let _ = write!(data, "{} {} ", round(x), round(y));
    };
    for segment in glyphs.iter().flat_map(|glyph| &glyph.segments) {
        match *segment {
            Segment::Move(x, y) => {
                data.push('M');
                push(&mut data, x, y);
            }
            Segment::Line(x, y) => {
                data.push('L');
                push(&mut data, x, y);
            }
            Segment::Quad(cx, cy, x, y) => {
                data.push('Q');
                push(&mut data, cx, cy);
                push(&mut data, x, y);
            }
            Segment::Cubic(cx0, cy0, cx1, cy1, x, y) => {
                data.push('C');
                push(&mut data, cx0, cy0);
                push(&mut data, cx1, cy1);
                push(&mut data, x, y);
            }
            Segment::Close => data.push('Z'),
        }
    }
    data.trim_end().to_string()
}

fn fill_glyphs(pixmap: &mut Pixmap, row: &Row, glyphs: &[ShapedGlyph], color: [u8; 3]) {
    let mut builder = PathBuilder::new();
    for segment in glyphs.iter().flat_map(|glyph| &glyph.segments) {
        match *segment {
            Segment::Move(x, y) => {
                let (x, y) = point(row, x, y);
                builder.move_to(x, y);
            }
            Segment::Line(x, y) => {
                let (x, y) = point(row, x, y);
                builder.line_to(x, y);
            }
            Segment::Quad(cx, cy, x, y) => {
                let (cx, cy) = point(row, cx, cy);
                let (x, y) = point(row, x, y);
                builder.quad_to(cx, cy, x, y);
            }
            Segment::Cubic(cx0, cy0, cx1, cy1, x, y) => {
                let (cx0, cy0) = point(row, cx0, cy0);
                let (cx1, cy1) = point(row, cx1, cy1);
                let (x, y) = point(row, x, y);
                builder.cubic_to(cx0, cy0, cx1, cy1, x, y);
            }
            Segment::Close => builder.close(),
        }
    }
    if let Some(path) = builder.finish() {
        pixmap.fill_path(
            &path,
            &paint(color, 255),
            FillRule::Winding,
            Transform::identity(),
            None,
        );
    }
}

fn draw_label(pixmap: &mut Pixmap, row: &Row) {
    let top = (row.baseline - LABEL_HEIGHT).round();
    for (index, character) in row.label.chars().enumerate() {
        let left = MARGIN + index as f32 * LABEL_ADVANCE;
        for (column, cell_row) in cells(character) {
            fill_rect(
                pixmap,
                left + f32::from(column) * LABEL_PIXEL,
                top + f32::from(cell_row) * LABEL_PIXEL,
                LABEL_PIXEL,
                LABEL_PIXEL,
                LABEL,
                255,
            );
        }
    }
}

fn fill_rect(
    pixmap: &mut Pixmap,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    color: [u8; 3],
    alpha: u8,
) {
    if let Some(rect) = Rect::from_xywh(x, y, width, height) {
        pixmap.fill_rect(rect, &paint(color, alpha), Transform::identity(), None);
    }
}

fn paint(color: [u8; 3], alpha: u8) -> Paint<'static> {
    let mut paint = Paint::default();
    paint.set_color_rgba8(color[0], color[1], color[2], alpha);
    paint.anti_alias = true;
    paint
}

fn hex([red, green, blue]: [u8; 3]) -> String {
    format!("#{red:02x}{green:02x}{blue:02x}")
}

fn round(value: f32) -> f32 {
    (value * 100.0).round() / 100.0
}
