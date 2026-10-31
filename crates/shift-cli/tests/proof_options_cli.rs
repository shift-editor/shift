//! `shift proof` locations, shaping options, `/name` tokens, and grids.

#[allow(dead_code)]
mod support;

mod proof_support;

use std::path::{Path, PathBuf};

use serde_json::Value;
use shift_font::test_support::sample_variable_font;
use shift_store::ShiftStore;
use skrifa::MetadataProvider;

use proof_support::{create_box_font, glyph_advances, glyph_names, proof_json};
use support::shift;

/// A variable `.shift` source: user wght 700 maps to design 600 and 900 to
/// 800; masters sit at design 400 (`A` 600 wide), 600, and 800 (`A` 800
/// wide); `Bold` is a named instance at 900; `A A` kerns by -50 at the
/// default.
struct Variable {
    _temp: tempfile::TempDir,
    font: PathBuf,
    image: PathBuf,
}

impl Variable {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let font = temp.path().join("Variable.shift");
        drop(ShiftStore::create_document(&font, &sample_variable_font()).unwrap());
        Self {
            image: temp.path().join("proof.svg"),
            font,
            _temp: temp,
        }
    }

    fn proof(&self, args: &[&str]) -> Value {
        let base = [
            self.font.to_str().unwrap(),
            "--output",
            self.image.to_str().unwrap(),
        ];
        proof_json(&[&base[..], args].concat())
    }
}

fn labels(report: &Value) -> Vec<&str> {
    report["locations"]
        .as_array()
        .unwrap()
        .iter()
        .map(|location| location["label"].as_str().unwrap())
        .collect()
}

fn axis_values(report: &Value) -> Vec<f64> {
    report["locations"]
        .as_array()
        .unwrap()
        .iter()
        .map(|location| location["axes"][0]["value"].as_f64().unwrap())
        .collect()
}

fn row_advances(report: &Value) -> Vec<Vec<f64>> {
    report["rows"]
        .as_array()
        .unwrap()
        .iter()
        .map(glyph_advances)
        .collect()
}

fn box_font(dir: &Path) -> String {
    let font = dir.join("Box.shift");
    create_box_font(&font);
    font.to_str().unwrap().to_string()
}

#[test]
fn sets_every_line_once_per_location() {
    let variable = Variable::new();

    let report = variable.proof(&[
        "--text", "A", "--text", "AA", "--at", "wght=400", "--at", "wght=700",
    ]);

    assert_eq!(labels(&report), ["wght 400", "wght 700"]);
    let order: Vec<(u64, u64)> = report["rows"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| {
            (
                row["line"].as_u64().unwrap(),
                row["location"].as_u64().unwrap(),
            )
        })
        .collect();
    assert_eq!(order, [(0, 0), (0, 1), (1, 0), (1, 1)]);
    assert_eq!(row_advances(&report)[..2], [vec![600.0], vec![700.0]]);
}

#[test]
fn sets_each_master_at_its_location() {
    let variable = Variable::new();

    let report = variable.proof(&["--text", "A", "--masters"]);

    assert_eq!(labels(&report)[1..], ["Medium", "Bold"]);
    // Design 400, 600, and 800 are user 400, 700, and 900 through the
    // axis mapping.
    assert_eq!(axis_values(&report), [400.0, 700.0, 900.0]);
    assert_eq!(
        row_advances(&report),
        [vec![600.0], vec![700.0], vec![800.0]]
    );
}

#[test]
fn orders_masters_by_location_not_source_order() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Reordered.shift");
    let mut font = sample_variable_font();
    let mut order = font
        .sources()
        .iter()
        .map(shift_font::Source::id)
        .collect::<Vec<_>>();
    order.reverse();
    font.set_source_order(&order).unwrap();
    drop(ShiftStore::create_document(&path, &font).unwrap());
    let image = temp.path().join("proof.svg");

    let report = proof_json(&[
        path.to_str().unwrap(),
        "--output",
        image.to_str().unwrap(),
        "--text",
        "A",
        "--masters",
    ]);

    assert_eq!(labels(&report)[1..], ["Medium", "Bold"]);
    assert_eq!(axis_values(&report), [400.0, 700.0, 900.0]);
}

#[test]
fn sets_every_named_instance_of_the_compiled_font() {
    let variable = Variable::new();
    let binary = variable.font.with_extension("ttf");
    let compiled = shift(&[
        "compile",
        variable.font.to_str().unwrap(),
        "--output",
        binary.to_str().unwrap(),
    ]);
    assert!(compiled.status.success());
    let data = std::fs::read(&binary).unwrap();
    let instances = skrifa::FontRef::new(&data).unwrap().named_instances().len();

    let report = variable.proof(&["--text", "A", "--instances"]);

    assert_eq!(report["locations"].as_array().unwrap().len(), instances);
    assert_eq!(labels(&report), ["Bold"]);
    assert_eq!(row_advances(&report), [vec![800.0]]);
}

#[test]
fn masters_need_a_font_source() {
    let variable = Variable::new();
    let binary = variable.font.with_extension("ttf");
    assert!(
        shift(&[
            "compile",
            variable.font.to_str().unwrap(),
            "--output",
            binary.to_str().unwrap(),
        ])
        .status
        .success()
    );

    let output = shift(&[
        "proof",
        binary.to_str().unwrap(),
        "--output",
        variable.image.to_str().unwrap(),
        "--masters",
    ]);

    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("compiled font has no masters"));
}

#[test]
fn turning_kerning_off_restores_the_plain_advances() {
    let variable = Variable::new();

    let kerned = variable.proof(&["--text", "AA"]);
    let plain = variable.proof(&["--text", "AA", "--features=-kern"]);

    assert_eq!(glyph_advances(&kerned["rows"][0]), [550.0, 600.0]);
    assert_eq!(glyph_advances(&plain["rows"][0]), [600.0, 600.0]);
    assert_eq!(plain["features"], serde_json::json!(["-kern"]));
}

#[test]
fn turning_contextual_alternates_off_changes_the_glyphs() {
    let temp = tempfile::tempdir().unwrap();
    let font = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/editor/src/ui/assets/fonts/JetBrainsMono[wght].ttf");
    let image = temp.path().join("calt.svg");
    let args = |features: &'static str| {
        proof_json(&[
            font.to_str().unwrap(),
            "--output",
            image.to_str().unwrap(),
            "--text",
            "->",
            "--features",
            features,
        ])
    };

    let ligated = args("calt");
    let plain = args("-calt");

    assert_eq!(glyph_names(&plain["rows"][0]), ["hyphen", "greater"]);
    assert_ne!(
        glyph_names(&ligated["rows"][0]),
        glyph_names(&plain["rows"][0])
    );
}

#[test]
fn names_glyphs_directly_and_reports_unknown_names() {
    let temp = tempfile::tempdir().unwrap();
    let font = box_font(temp.path());
    let image = temp.path().join("names.svg");

    let report = proof_json(&[
        &font,
        "--output",
        image.to_str().unwrap(),
        "--text",
        "H/I H/nosuch//",
    ]);

    let row = &report["rows"][0];
    assert_eq!(glyph_names(row), ["H", "I", "H", ".notdef", ".notdef"]);
    assert_eq!(row["glyphs"][3]["missing"], true);
    assert_eq!(report["missingGlyphNames"], serde_json::json!(["nosuch"]));
    // The literal `/` from `//` is a character the font does not map.
    assert_eq!(report["missingCharacters"][0]["character"], "/");
}

#[test]
fn a_right_to_left_line_places_named_glyphs_last_first_and_aligns_right() {
    let temp = tempfile::tempdir().unwrap();
    let font = box_font(temp.path());
    let image = temp.path().join("rtl.svg");

    let report = proof_json(&[
        &font,
        "--output",
        image.to_str().unwrap(),
        "--text",
        "/I/H",
        "--text",
        "HIHIHI",
        "--direction",
        "rtl",
    ]);

    let row = &report["rows"][0];
    assert_eq!(row["direction"], "rtl");
    assert_eq!(glyph_names(row), ["H", "I"]);
    let right_edge = |row: &Value| row["x"].as_f64().unwrap() + row["width"].as_f64().unwrap();
    let page_right = report["width"].as_f64().unwrap() - 24.0;
    assert!((right_edge(row) - page_right).abs() < 1.0);
    assert!((right_edge(&report["rows"][1]) - page_right).abs() < 1.0);
}

#[test]
fn sets_requested_glyphs_in_a_named_grid_per_location() {
    let variable = Variable::new();

    let report = variable.proof(&[
        "--grid",
        "--text",
        "A /A /nosuch",
        "--at",
        "wght=400",
        "--at",
        "wght=900",
    ]);

    assert_eq!(report["mode"], "grid");
    assert_eq!(report["rows"], serde_json::json!([]));
    let grids = report["grids"].as_array().unwrap();
    assert_eq!(grids.len(), 2);
    let cells = |grid: &Value| -> Vec<(String, f64, bool)> {
        grid["cells"]
            .as_array()
            .unwrap()
            .iter()
            .map(|cell| {
                (
                    cell["label"].as_str().unwrap().to_string(),
                    cell["advance"].as_f64().unwrap(),
                    cell["missing"].as_bool().unwrap(),
                )
            })
            .collect()
    };
    assert_eq!(
        cells(&grids[0])[..2],
        [
            ("A".to_string(), 600.0, false),
            ("A".to_string(), 600.0, false)
        ]
    );
    assert_eq!(cells(&grids[1])[0], ("A".to_string(), 800.0, false));
    assert_eq!(cells(&grids[0])[2].0, "nosuch");
    assert!(cells(&grids[0])[2].2);
}

#[test]
fn an_empty_grid_shows_every_glyph_and_takes_one_size() {
    let temp = tempfile::tempdir().unwrap();
    let font = box_font(temp.path());
    let image = temp.path().join("grid.png");

    let report = proof_json(&[&font, "--output", image.to_str().unwrap(), "--grid"]);

    let names: Vec<&str> = report["grids"][0]["cells"]
        .as_array()
        .unwrap()
        .iter()
        .map(|cell| cell["label"].as_str().unwrap())
        .collect();
    assert_eq!(names, [".notdef", "I", "H"]);
    assert_eq!(report["width"], 1200);

    let sizes = shift(&[
        "proof",
        &font,
        "--output",
        image.to_str().unwrap(),
        "--grid",
        "--sizes",
        "12,20",
    ]);
    assert!(!sizes.status.success());
    assert!(String::from_utf8_lossy(&sizes.stderr).contains("one size"));
}
