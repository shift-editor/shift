//! Writes a laid-out proof page as standalone SVG in pixel coordinates.

use std::fmt::Write as _;

use crate::label::label_height;
use crate::layout::{Page, Row};
use crate::palette::{BACKGROUND, INK, LABEL, MISSING, Rgb};
use crate::shape::{PlacedGlyph, Segment};

/// Renders `page` as an SVG document: a white background, one `<line>` per
/// guide, one `<text>` per label, and one filled `<path>` per run of glyphs
/// that share a fill.
///
/// Paths carry the class `ink` or `missing`, labels `label`, and guides
/// `guide-<name>`, so tools can find them without parsing geometry.
pub fn render_svg(page: &Page) -> String {
    let mut svg = String::new();
    let _ = writeln!(
        svg,
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="{0}" height="{1}" viewBox="0 0 {0} {1}">"#,
        page.width, page.height
    );
    let _ = writeln!(
        svg,
        r#"<rect class="background" width="100%" height="100%" fill="{BACKGROUND}"/>"#,
    );

    for guide in &page.guides {
        let y = guide.y.round() + 0.5;
        let _ = writeln!(
            svg,
            r#"<line class="guide-{name}" x1="{x0}" y1="{y}" x2="{x1}" y2="{y}" stroke="{color}" stroke-width="1"/>"#,
            name = guide.guide.name(),
            x0 = guide.x0,
            x1 = guide.x1,
            color = guide.guide.color(),
        );
    }

    for label in &page.labels {
        let height = label_height(label.pixel);
        let _ = writeln!(
            svg,
            r#"<text class="label" x="{x}" y="{y}" font-family="monospace" font-size="{size}" fill="{LABEL}">{text}</text>"#,
            x = round(label.x),
            y = round(label.y + height),
            size = round(height * 1.2),
            text = escape(&label.text),
        );
    }

    for row in &page.rows {
        for (glyphs, missing) in fill_runs(row) {
            let (class, fill) = if missing {
                ("missing", MISSING)
            } else {
                ("ink", INK)
            };
            write_path(&mut svg, row, glyphs, class, fill);
        }
    }

    svg.push_str("</svg>\n");
    svg
}

/// Splits a row into consecutive glyphs that are all missing or all not.
pub(crate) fn fill_runs(row: &Row) -> Vec<(&[PlacedGlyph], bool)> {
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

fn write_path(svg: &mut String, row: &Row, glyphs: &[PlacedGlyph], class: &str, fill: Rgb) {
    let mut data = String::new();
    let point = |data: &mut String, x: f32, y: f32| {
        let x = row.origin_x + x * row.scale;
        let y = row.baseline - y * row.scale;
        let _ = write!(data, "{} {} ", round(x), round(y));
    };
    for segment in glyphs.iter().flat_map(|glyph| &glyph.segments) {
        match *segment {
            Segment::Move(x, y) => {
                data.push('M');
                point(&mut data, x, y);
            }
            Segment::Line(x, y) => {
                data.push('L');
                point(&mut data, x, y);
            }
            Segment::Quad(cx, cy, x, y) => {
                data.push('Q');
                point(&mut data, cx, cy);
                point(&mut data, x, y);
            }
            Segment::Cubic(cx0, cy0, cx1, cy1, x, y) => {
                data.push('C');
                point(&mut data, cx0, cy0);
                point(&mut data, cx1, cy1);
                point(&mut data, x, y);
            }
            Segment::Close => data.push('Z'),
        }
    }
    if data.is_empty() {
        return;
    }

    let _ = writeln!(
        svg,
        r#"<path class="{class}" fill="{fill}" fill-rule="nonzero" d="{}"/>"#,
        data.trim_end()
    );
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn round(value: f32) -> f32 {
    (value * 100.0).round() / 100.0
}
