//! Paints a laid-out proof page as SVG or PNG.
//!
//! Both renderers paint the same display list in the same order:
//! rectangles, then lines, then glyph runs. Text is drawn as outlines in
//! both, so the two outputs match and need no fonts installed.

use std::fmt::Write as _;

use shift_specimen::shaping::Segment;
use tiny_skia::{FillRule, Paint, PathBuilder, Pixmap, Rect, Stroke, StrokeDash, Transform};

use crate::layout::{Mark, ProofPage, Rgb, RunMark, BACKGROUND};
use crate::ProofError;

/// Dash and gap lengths for empty cells, in pixels.
const DASH: [f32; 2] = [3.0, 3.0];

/// Renders `page` as standalone SVG in CSS pixels.
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
    for mark in ordered(page) {
        match mark {
            Mark::Rect {
                x,
                y,
                width,
                height,
                fill,
                dashed,
            } => {
                let fill = fill.map_or_else(|| "none".to_string(), hex);
                let stroke = dashed.map_or_else(String::new, |color| {
                    format!(
                        r#" stroke="{}" stroke-width="1" stroke-dasharray="{} {}""#,
                        hex(color),
                        DASH[0],
                        DASH[1]
                    )
                });
                let _ = writeln!(
                    svg,
                    r#"<rect class="cell" x="{}" y="{}" width="{}" height="{}" fill="{fill}"{stroke}/>"#,
                    round(*x + 0.5),
                    round(*y + 0.5),
                    round(*width - 1.0),
                    round(*height - 1.0),
                );
            }
            Mark::Line {
                class,
                x0,
                y0,
                x1,
                y1,
                color,
            } => {
                let (y0, y1) = if y0 == y1 {
                    let y = y0.round() + 0.5;
                    (y, y)
                } else {
                    (*y0, *y1)
                };
                let _ = writeln!(
                    svg,
                    r#"<line class="{class}" x1="{}" y1="{}" x2="{}" y2="{}" stroke="{}" stroke-width="1"/>"#,
                    round(*x0),
                    round(y0),
                    round(*x1),
                    round(y1),
                    hex(*color),
                );
            }
            Mark::Run(run) => {
                let data = path_data(run);
                if data.is_empty() {
                    continue;
                }
                let _ = writeln!(
                    svg,
                    r#"<path class="{}" data-text="{}" fill="{}" d="{data}"/>"#,
                    run.class,
                    escape(&run.text),
                    hex(run.color),
                );
            }
        }
    }
    svg.push_str("</svg>\n");
    svg
}

/// Renders `page` at `scale` device pixels per CSS pixel and returns PNG bytes.
///
/// # Errors
///
/// Returns [`ProofError::Render`] when the page is too large to allocate or
/// cannot be encoded.
pub fn render_png(page: &ProofPage, scale: f32) -> Result<Vec<u8>, ProofError> {
    let width = (page.width as f32 * scale).ceil() as u32;
    let height = (page.height as f32 * scale).ceil() as u32;
    let mut pixmap = Pixmap::new(width, height).ok_or_else(|| {
        ProofError::Render(format!(
            "a {width}x{height} proof is too large to render; use fewer rows, smaller sizes, or a lower scale"
        ))
    })?;
    pixmap.fill(tiny_skia::Color::from_rgba8(
        BACKGROUND[0],
        BACKGROUND[1],
        BACKGROUND[2],
        255,
    ));
    let transform = Transform::from_scale(scale, scale);

    for mark in ordered(page) {
        match mark {
            Mark::Rect {
                x,
                y,
                width,
                height,
                fill,
                dashed,
            } => {
                if let (Some(color), Some(rect)) = (fill, Rect::from_xywh(*x, *y, *width, *height))
                {
                    pixmap.fill_rect(rect, &paint(*color), transform, None);
                }
                if let Some(color) = dashed {
                    let inset = 0.5 / scale;
                    if let Some(rect) = Rect::from_xywh(
                        x + inset,
                        y + inset,
                        width - 2.0 * inset,
                        height - 2.0 * inset,
                    ) {
                        let stroke = Stroke {
                            width: 1.0,
                            dash: StrokeDash::new(DASH.to_vec(), 0.0),
                            ..Stroke::default()
                        };
                        let path = PathBuilder::from_rect(rect);
                        pixmap.stroke_path(&path, &paint(*color), &stroke, transform, None);
                    }
                }
            }
            Mark::Line {
                x0,
                y0,
                x1,
                y1,
                color,
                ..
            } => {
                if y0 == y1 {
                    // Snap hairlines to whole device pixels so they stay crisp.
                    let thickness = scale.round().max(1.0);
                    let y = (y0 * scale - thickness / 2.0).round();
                    if let Some(rect) = Rect::from_xywh(x0 * scale, y, (x1 - x0) * scale, thickness)
                    {
                        pixmap.fill_rect(rect, &paint(*color), Transform::identity(), None);
                    }
                } else {
                    let mut builder = PathBuilder::new();
                    builder.move_to(*x0, *y0);
                    builder.line_to(*x1, *y1);
                    if let Some(path) = builder.finish() {
                        let stroke = Stroke {
                            width: 1.0,
                            ..Stroke::default()
                        };
                        pixmap.stroke_path(&path, &paint(*color), &stroke, transform, None);
                    }
                }
            }
            Mark::Run(run) => fill_run(&mut pixmap, run, transform),
        }
    }

    pixmap
        .encode_png()
        .map_err(|error| ProofError::Render(format!("failed to encode the proof PNG: {error}")))
}

/// Marks in paint order: rectangles, then lines, then runs.
fn ordered(page: &ProofPage) -> impl Iterator<Item = &Mark> {
    let rank = |mark: &Mark| match mark {
        Mark::Rect { .. } => 0,
        Mark::Line { .. } => 1,
        Mark::Run(_) => 2,
    };
    (0..3).flat_map(move |pass| page.marks.iter().filter(move |mark| rank(mark) == pass))
}

fn point(run: &RunMark, x: f32, y: f32) -> (f32, f32) {
    (run.x + x * run.scale, run.baseline - y * run.scale)
}

fn path_data(run: &RunMark) -> String {
    let mut data = String::new();
    let push = |data: &mut String, x: f32, y: f32| {
        let (x, y) = point(run, x, y);
        let _ = write!(data, "{} {} ", round(x), round(y));
    };
    for segment in &run.segments {
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

fn fill_run(pixmap: &mut Pixmap, run: &RunMark, transform: Transform) {
    let mut builder = PathBuilder::new();
    for segment in &run.segments {
        match *segment {
            Segment::Move(x, y) => {
                let (x, y) = point(run, x, y);
                builder.move_to(x, y);
            }
            Segment::Line(x, y) => {
                let (x, y) = point(run, x, y);
                builder.line_to(x, y);
            }
            Segment::Quad(cx, cy, x, y) => {
                let (cx, cy) = point(run, cx, cy);
                let (x, y) = point(run, x, y);
                builder.quad_to(cx, cy, x, y);
            }
            Segment::Cubic(cx0, cy0, cx1, cy1, x, y) => {
                let (cx0, cy0) = point(run, cx0, cy0);
                let (cx1, cy1) = point(run, cx1, cy1);
                let (x, y) = point(run, x, y);
                builder.cubic_to(cx0, cy0, cx1, cy1, x, y);
            }
            Segment::Close => builder.close(),
        }
    }
    if let Some(path) = builder.finish() {
        pixmap.fill_path(&path, &paint(run.color), FillRule::Winding, transform, None);
    }
}

fn paint(color: Rgb) -> Paint<'static> {
    let mut paint = Paint::default();
    paint.set_color_rgba8(color[0], color[1], color[2], 255);
    paint.anti_alias = true;
    paint
}

fn hex([red, green, blue]: Rgb) -> String {
    format!("#{red:02x}{green:02x}{blue:02x}")
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn round(value: f32) -> f32 {
    (value * 100.0).round() / 100.0
}
