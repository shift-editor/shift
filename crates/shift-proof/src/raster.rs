//! Rasterizes a laid-out proof page to PNG with tiny-skia.

use tiny_skia::{FillRule, Paint, PathBuilder, Pixmap, Rect, Transform};

use crate::ProofError;
use crate::label::{cells, char_advance};
use crate::layout::{Label, Page, Row};
use crate::palette::{BACKGROUND, INK, LABEL, MISSING, Rgb};
use crate::shape::{PlacedGlyph, Segment};
use crate::svg::fill_runs;

/// Draws `page` anti-aliased and returns encoded PNG bytes, one pixel per
/// layout pixel.
///
/// # Errors
///
/// Returns [`ProofError::PageTooLarge`] when the page cannot be allocated
/// and [`ProofError::EncodePng`] when encoding fails.
pub fn render_png(page: &Page) -> Result<Vec<u8>, ProofError> {
    let mut pixmap = Pixmap::new(page.width, page.height).ok_or(ProofError::PageTooLarge {
        width: page.width,
        height: page.height,
    })?;
    let [red, green, blue] = BACKGROUND.0;
    pixmap.fill(tiny_skia::Color::from_rgba8(red, green, blue, 255));

    for guide in &page.guides {
        let y = guide.y.round();
        if let Some(rect) = Rect::from_xywh(guide.x0, y, guide.x1 - guide.x0, 1.0) {
            pixmap.fill_rect(
                rect,
                &paint(guide.guide.color()),
                Transform::identity(),
                None,
            );
        }
    }
    for label in &page.labels {
        draw_label(&mut pixmap, label);
    }
    for row in &page.rows {
        for (glyphs, missing) in fill_runs(row) {
            let color = if missing { MISSING } else { INK };
            fill_glyphs(&mut pixmap, row, glyphs, color);
        }
    }

    pixmap.encode_png().map_err(ProofError::EncodePng)
}

fn paint(color: Rgb) -> Paint<'static> {
    let mut paint = Paint::default();
    paint.set_color_rgba8(color.0[0], color.0[1], color.0[2], 255);
    paint.anti_alias = true;
    paint
}

fn fill_glyphs(pixmap: &mut Pixmap, row: &Row, glyphs: &[PlacedGlyph], color: Rgb) {
    let mut builder = PathBuilder::new();
    let point = |x: f32, y: f32| (row.origin_x + x * row.scale, row.baseline - y * row.scale);
    for segment in glyphs.iter().flat_map(|glyph| &glyph.segments) {
        match *segment {
            Segment::Move(x, y) => {
                let (x, y) = point(x, y);
                builder.move_to(x, y);
            }
            Segment::Line(x, y) => {
                let (x, y) = point(x, y);
                builder.line_to(x, y);
            }
            Segment::Quad(cx, cy, x, y) => {
                let (cx, cy) = point(cx, cy);
                let (x, y) = point(x, y);
                builder.quad_to(cx, cy, x, y);
            }
            Segment::Cubic(cx0, cy0, cx1, cy1, x, y) => {
                let (cx0, cy0) = point(cx0, cy0);
                let (cx1, cy1) = point(cx1, cy1);
                let (x, y) = point(x, y);
                builder.cubic_to(cx0, cy0, cx1, cy1, x, y);
            }
            Segment::Close => builder.close(),
        }
    }

    if let Some(path) = builder.finish() {
        pixmap.fill_path(
            &path,
            &paint(color),
            FillRule::Winding,
            Transform::identity(),
            None,
        );
    }
}

fn draw_label(pixmap: &mut Pixmap, label: &Label) {
    let paint = paint(LABEL);
    let top = label.y.round();
    for (index, character) in label.text.chars().enumerate() {
        let left = (label.x + index as f32 * char_advance(label.pixel)).round();
        for (column, row) in cells(character) {
            let rect = Rect::from_xywh(
                left + f32::from(column) * label.pixel,
                top + f32::from(row) * label.pixel,
                label.pixel,
                label.pixel,
            );
            if let Some(rect) = rect {
                pixmap.fill_rect(rect, &paint, Transform::identity(), None);
            }
        }
    }
}
