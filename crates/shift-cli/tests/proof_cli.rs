//! Ported in part from Andrea Fomera's `shift proof` prototype.

use std::io::Write;
use std::path::Path;
use std::process::{Command, Output, Stdio};

use serde_json::Value;
use shift_font::test_support::sample_variable_font;
use shift_store::ShiftStore;
use tiny_skia::Pixmap;

/// Stem width shared by the box glyphs, in font units.
const STEM: i32 = 100;

fn shift(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_shift-cli"))
        .args(args)
        .output()
        .expect("shift CLI should run")
}

fn shift_with_stdin(args: &[&str], input: &str) -> Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_shift-cli"))
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("shift CLI should run");
    child
        .stdin
        .take()
        .unwrap()
        .write_all(input.as_bytes())
        .unwrap();
    child.wait_with_output().unwrap()
}

fn rect(x0: i32, y0: i32, x1: i32, y1: i32) -> Value {
    serde_json::json!({
        "closed": true,
        "points": [
            {"x": x0, "y": y0}, {"x": x1, "y": y0}, {"x": x1, "y": y1}, {"x": x0, "y": y1}
        ]
    })
}

/// Authors a font with a solid `I` (a stem at x 100..200, y 0..700) and an
/// `H` (stems at 100..200 and 500..600 joined by a bar at y 300..400).
fn create_box_font(path: &Path) {
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

fn variable_font(dir: &Path) -> String {
    let path = dir.join("Variable.shift");
    drop(ShiftStore::create_document(&path, &sample_variable_font()).unwrap());
    path.to_str().unwrap().to_string()
}

fn proof_json(args: &[&str]) -> Value {
    let output = shift(&[&["proof"], args, &["--json"]].concat());
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}

fn proof_spec(font: &str, output: &Path, spec: &Value) -> Value {
    let result = shift_with_stdin(
        &[
            "proof",
            font,
            "--spec",
            "-",
            "--output",
            output.to_str().unwrap(),
            "--json",
        ],
        &spec.to_string(),
    );
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    serde_json::from_slice(&result.stdout).unwrap()
}

fn row(report: &Value, section: usize, row: usize) -> &Value {
    &report["sections"][section]["rows"][row]
}

fn is_dark(pixmap: &Pixmap, x: f64, y: f64) -> bool {
    let pixel = pixmap.pixel(x as u32, y as u32).unwrap();
    pixel.red() < 64 && pixel.green() < 64 && pixel.blue() < 64
}

fn is_white(pixmap: &Pixmap, x: f64, y: f64) -> bool {
    let pixel = pixmap.pixel(x as u32, y as u32).unwrap();
    pixel.red() == 255 && pixel.green() == 255 && pixel.blue() == 255
}

#[test]
fn renders_glyph_ink_where_the_outlines_are() {
    let temp = tempfile::tempdir().unwrap();
    let font = temp.path().join("Box.shift");
    let image = temp.path().join("proof.png");
    create_box_font(&font);

    let report = proof_json(&[
        font.to_str().unwrap(),
        "--text",
        "HI",
        "--size",
        "100",
        "--scale",
        "1",
        "--output",
        image.to_str().unwrap(),
    ]);
    let pixmap = Pixmap::load_png(&image).unwrap();
    let row = row(&report, 0, 0);
    let baseline = row["baseline"].as_f64().unwrap();
    assert_eq!(row["advance"], 1000.0);

    // 100 px per em over 1000 units: one unit is 0.1 px. Find the pen origin
    // from the left edge of H's first stem.
    let origin = (0..pixmap.width())
        .find(|x| is_dark(&pixmap, f64::from(*x), baseline - 35.0))
        .map(f64::from)
        .unwrap()
        - 10.0;
    let mid_height = baseline - 35.0;
    // H: stems and counter.
    assert!(is_dark(&pixmap, origin + 15.0, mid_height));
    assert!(is_white(&pixmap, origin + 35.0, baseline - 55.0));
    assert!(is_dark(&pixmap, origin + 35.0, mid_height));
    assert!(is_dark(&pixmap, origin + 55.0, mid_height));
    // I follows at x 700.
    assert!(is_dark(&pixmap, origin + 85.0, mid_height));
    assert!(is_white(&pixmap, origin + 75.0, mid_height));
}

#[test]
fn reports_and_marks_characters_the_font_does_not_map() {
    let temp = tempfile::tempdir().unwrap();
    let font = temp.path().join("Box.shift");
    let image = temp.path().join("proof.svg");
    create_box_font(&font);

    let report = proof_json(&[
        font.to_str().unwrap(),
        "--text",
        "HxIé",
        "--output",
        image.to_str().unwrap(),
    ]);

    assert_eq!(report["missingCharacters"], serde_json::json!(["x", "é"]));
    assert_eq!(
        row(&report, 0, 0)["missingCharacters"],
        serde_json::json!(["x", "é"])
    );
    let svg = std::fs::read_to_string(&image).unwrap();
    assert!(svg.contains(r#"<path class="missing""#));
    assert!(svg.contains(r#"<path class="ink""#));
}

#[test]
fn applies_kerning_from_the_compiled_font() {
    let temp = tempfile::tempdir().unwrap();
    let font = variable_font(temp.path());
    let image = temp.path().join("kern.svg");

    let report = proof_json(&[&font, "--text", "AA", "--output", image.to_str().unwrap()]);

    // Two 600-unit advances less the -50 group kern.
    assert_eq!(row(&report, 0, 0)["advance"], 1150.0);
}

#[test]
fn shapes_at_the_same_location_as_glyph_inspect() {
    let temp = tempfile::tempdir().unwrap();
    let font = variable_font(temp.path());
    let image = temp.path().join("variable.svg");

    let inspected = shift(&[
        "glyph",
        "inspect",
        &font,
        "A",
        "--location",
        "wght=700",
        "--view",
        "variation",
        "--json",
    ]);
    assert!(inspected.status.success());
    let inspected: Value = serde_json::from_slice(&inspected.stdout).unwrap();
    // wght=700 maps to design 600, halfway between the 600 and 800 advances.
    let expected = inspected["resolved"]["advance"].as_f64().unwrap();
    assert_eq!(expected, 700.0);

    let report = proof_json(&[
        &font,
        "--text",
        "A",
        "--location",
        "wght=700",
        "--output",
        image.to_str().unwrap(),
    ]);
    let row = row(&report, 0, 0);
    assert_eq!(
        row["location"],
        serde_json::json!([{"tag": "wght", "value": 700.0}])
    );
    assert_eq!(row["advance"].as_f64().unwrap(), expected);
}

#[test]
fn renders_every_section_type_from_a_definition() {
    let temp = tempfile::tempdir().unwrap();
    let font = variable_font(temp.path());
    let image = temp.path().join("proof.png");

    let report = proof_spec(
        &font,
        &image,
        &serde_json::json!({
            "page": {"width": 800, "metrics": true},
            "sections": [
                {"type": "text", "text": "AA", "locations": ["wght=400", "wght=700"]},
                {"type": "waterfall", "text": "AAA", "sizes": [48, 24, 12]},
                {"type": "glyphs", "glyphs": ["A", "nope"], "size": 64},
                {"type": "locations", "text": "A", "across": {"axis": "wght", "steps": 3}},
            ],
        }),
    );

    assert_eq!(report["width"], 800);
    let sizes = |section: usize| -> Vec<f64> {
        report["sections"][section]["rows"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row["size"].as_f64().unwrap())
            .collect()
    };
    assert_eq!(report["sections"][0]["rows"].as_array().unwrap().len(), 2);
    assert_eq!(sizes(1), [48.0, 24.0, 12.0]);
    assert_eq!(row(&report, 2, 0)["glyphs"].as_array().unwrap().len(), 1);
    assert_eq!(report["missingGlyphs"], serde_json::json!(["nope"]));
    let sweep: Vec<f64> = report["sections"][3]["rows"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| row["location"][0]["value"].as_f64().unwrap())
        .collect();
    assert_eq!(sweep, [100.0, 500.0, 900.0]);
    assert!(Pixmap::load_png(&image).is_ok());
}

#[test]
fn proofs_across_sources_only_without_axis_mappings() {
    let temp = tempfile::tempdir().unwrap();
    let image = temp.path().join("sources.svg");
    let spec = serde_json::json!({
        "sections": [{"type": "locations", "text": "HI", "across": "sources"}],
    });

    let box_font = temp.path().join("Box.shift");
    create_box_font(&box_font);
    let report = proof_spec(box_font.to_str().unwrap(), &image, &spec);
    assert_eq!(report["sections"][0]["rows"].as_array().unwrap().len(), 1);

    // The sample font maps wght, so its sources have no exact user-space location.
    let mapped = variable_font(temp.path());
    let output = shift_with_stdin(
        &[
            "proof",
            &mapped,
            "--spec",
            "-",
            "--output",
            image.to_str().unwrap(),
        ],
        &spec.to_string(),
    );
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("inverse axis mapping"));
}

#[test]
fn rejects_invalid_definitions_and_locations() {
    let temp = tempfile::tempdir().unwrap();
    let font = variable_font(temp.path());
    let image = temp.path().join("proof.png");

    let unknown_field = shift_with_stdin(
        &[
            "proof",
            &font,
            "--spec",
            "-",
            "--output",
            image.to_str().unwrap(),
        ],
        r#"{"sections": [{"type": "text", "text": "A", "colour": "red"}]}"#,
    );
    assert!(!unknown_field.status.success());
    assert!(String::from_utf8_lossy(&unknown_field.stderr).contains("invalid proof definition"));

    let unknown_axis = shift(&[
        "proof",
        &font,
        "--text",
        "A",
        "--location",
        "wdth=100",
        "--output",
        image.to_str().unwrap(),
    ]);
    assert!(!unknown_axis.status.success());
    assert!(String::from_utf8_lossy(&unknown_axis.stderr).contains("no \"wdth\" axis"));

    let bad_extension = shift(&["proof", &font, "--text", "A", "--output", "proof.jpg"]);
    assert!(!bad_extension.status.success());
    assert!(String::from_utf8_lossy(&bad_extension.stderr).contains(".png or .svg"));
    assert!(!image.exists());
}

#[test]
fn guides_use_the_authored_ascender_rather_than_padded_line_height() {
    let temp = tempfile::tempdir().unwrap();
    let font = temp.path().join("Box.shift");
    let image = temp.path().join("proof.svg");
    create_box_font(&font);
    // fontc pads hhea.ascender to 800 + (1200 - 200 - 800) = 1000 here.
    let set = shift(&[
        "font",
        "set",
        font.to_str().unwrap(),
        "--ascender",
        "800",
        "--descender",
        "-200",
        "--line-gap",
        "0",
    ]);
    assert!(set.status.success(), "{:?}", set.stderr);

    let report = proof_spec(
        font.to_str().unwrap(),
        &image,
        &serde_json::json!({
            "page": {"metrics": true},
            "sections": [{"type": "text", "text": "HI", "size": 100}],
        }),
    );
    let baseline = row(&report, 0, 0)["baseline"].as_f64().unwrap();
    let svg = std::fs::read_to_string(&image).unwrap();
    let guides: Vec<f64> = svg
        .lines()
        .filter(|line| line.contains(r#"class="guide""#))
        .filter_map(|line| line.split("y1=\"").nth(1))
        .filter_map(|rest| rest.split('"').next())
        .filter_map(|value| value.parse::<f64>().ok())
        .collect();

    // 800 units at 0.1 px per unit sits 80 px above the baseline.
    assert!(svg.contains(r#"data-text="ascender 800""#));
    assert!(guides.iter().any(|y| (baseline - y - 80.0).abs() <= 1.0));
}
