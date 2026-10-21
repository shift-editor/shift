//! Fonts authored through the CLI and readers for `shift proof` output.

#![allow(dead_code)]

use std::path::Path;

use serde_json::Value;
use tiny_skia::Pixmap;

use crate::support::{shift, shift_with_stdin};

/// Stem width shared by the box glyphs, in font units.
pub(crate) const STEM: i32 = 100;

fn rect(x0: i32, y0: i32, x1: i32, y1: i32) -> Value {
    serde_json::json!({
        "closed": true,
        "points": [
            {"x": x0, "y": y0}, {"x": x1, "y": y0}, {"x": x1, "y": y1}, {"x": x0, "y": y1}
        ]
    })
}

/// Authors a font with a solid `I` (a stem at x 100..200, y 0..700, advance
/// 300) and an `H` (stems at 100..200 and 500..600 joined by a bar at y
/// 300..400, advance 700).
pub(crate) fn create_box_font(path: &Path) {
    let path = path.to_str().unwrap();
    assert!(shift(&["font", "create", path]).status.success());

    let glyphs = [
        ("I", "U+0049", 300, vec![rect(100, 0, 100 + STEM, 700)]),
        (
            "H",
            "U+0048",
            700,
            vec![
                rect(100, 0, 100 + STEM, 700),
                rect(500, 0, 500 + STEM, 700),
                rect(100, 300, 600, 400),
            ],
        ),
    ];
    for (name, unicode, advance, contours) in glyphs {
        let added = shift(&["glyph", "add", path, name, "--unicode", unicode]);
        assert!(added.status.success(), "{:?}", added.stderr);
        let payload = serde_json::json!({ "advance": advance, "contours": contours });
        let layer = shift_with_stdin(
            &[
                "layer", "add", path, "--glyph", name, "--source", "Regular", "--input", "-",
            ],
            &payload.to_string(),
        );
        assert!(layer.status.success(), "{:?}", layer.stderr);
    }
}

/// Authors a monospace font whose every glyph is a solid box (x 100..500,
/// y 0..700) in a 600-unit cell: `l e t x =`, the digits, and an inkless
/// space.
pub(crate) fn create_code_font(path: &Path) {
    let path = path.to_str().unwrap();
    assert!(shift(&["font", "create", path]).status.success());

    let boxed = "M 100 0 L 500 0 L 500 700 L 100 700 Z";
    let mut glyphs = vec![serde_json::json!({
        "name": "space", "unicodes": ["U+0020"], "layer": {"advance": 600}
    })];
    let named = [
        ("l", 'l'),
        ("e", 'e'),
        ("t", 't'),
        ("x", 'x'),
        ("equal", '='),
    ];
    let digits = [
        "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
    ];
    let all = named.into_iter().chain(digits.into_iter().zip('0'..='9'));
    for (name, character) in all {
        glyphs.push(serde_json::json!({
            "name": name,
            "unicodes": [format!("U+{:04X}", u32::from(character))],
            "layer": {"advance": 600, "svgPath": boxed}
        }));
    }
    let payload = serde_json::json!({ "glyphs": glyphs });
    let set = shift_with_stdin(
        &["glyph", "set", path, "--input", "-"],
        &payload.to_string(),
    );
    assert!(
        set.status.success(),
        "{}",
        String::from_utf8_lossy(&set.stderr)
    );
}

/// Runs `shift proof ARGS --json`, which must succeed, and parses the report.
pub(crate) fn proof_json(args: &[&str]) -> Value {
    let output = shift(&[&["proof"], args, &["--json"]].concat());
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}

/// Glyph names of a report row, in shaped order.
pub(crate) fn glyph_names(row: &Value) -> Vec<String> {
    row["glyphs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|glyph| glyph["name"].as_str().unwrap_or("?").to_string())
        .collect()
}

/// Glyph advances of a report row, in font units.
pub(crate) fn glyph_advances(row: &Value) -> Vec<f64> {
    row["glyphs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|glyph| glyph["advance"].as_f64().unwrap())
        .collect()
}

#[expect(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "tests sample pixels at non-negative coordinates inside the image"
)]
pub(crate) fn rgb(pixmap: &Pixmap, x: f64, y: f64) -> [u8; 3] {
    let pixel = pixmap.pixel(x as u32, y as u32).unwrap();
    [pixel.red(), pixel.green(), pixel.blue()]
}

pub(crate) fn count_pixels(pixmap: &Pixmap, color: [u8; 3]) -> usize {
    pixmap
        .pixels()
        .iter()
        .filter(|pixel| [pixel.red(), pixel.green(), pixel.blue()] == color)
        .count()
}
