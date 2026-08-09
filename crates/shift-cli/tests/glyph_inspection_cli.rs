use std::process::{Command, Output};

use serde_json::Value;
use shift_font::test_support::{sample_font, sample_variable_font};
use shift_source::ShiftSourcePackage;

fn shift(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_shift-cli"))
        .args(args)
        .output()
        .expect("shift CLI should run")
}

#[test]
fn inspects_mapped_interpolation_as_stable_json() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Variable.shift");
    ShiftSourcePackage::save_font(&path, &sample_variable_font()).unwrap();

    let output = shift(&[
        "glyph",
        "inspect",
        path.to_str().unwrap(),
        "A",
        "--location",
        "wght=700",
        "--view",
        "variation",
        "--json",
    ]);

    assert!(output.status.success(), "{:?}", output.stderr);
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["glyph"]["name"], "A");
    assert_eq!(report["location"]["external"][0]["value"], 700.0);
    assert_eq!(report["location"]["design"][0]["value"], 600.0);
    assert_eq!(report["variation"]["selection"], "interpolation");
    assert_eq!(report["variation"]["sourceWeights"][0]["weight"], 0.5);
    assert_eq!(report["variation"]["sourceWeights"][1]["weight"], 0.5);
    assert_eq!(report["resolved"]["advance"], 700.0);
}

#[test]
fn structure_view_preserves_component_order_and_transforms() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Components.shift");
    ShiftSourcePackage::save_font(&path, &sample_font()).unwrap();

    let output = shift(&[
        "glyph",
        "inspect",
        path.to_str().unwrap(),
        "A",
        "--view",
        "structure",
        "--json",
    ]);

    assert!(output.status.success(), "{:?}", output.stderr);
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["components"].as_array().unwrap().len(), 2);
    assert_eq!(report["components"][0]["order"], 0);
    assert_eq!(report["components"][0]["baseGlyphName"], "acute");
    assert_eq!(
        report["components"][0]["decomposedTransform"]["translateX"],
        10.0
    );
    assert_eq!(
        report["components"][0]["decomposedTransform"]["translateY"],
        20.0
    );
    assert_eq!(report["components"][1]["order"], 1);
    assert_eq!(
        report["components"][1]["decomposedTransform"]["translateX"],
        120.0
    );
    assert_eq!(
        report["components"][1]["decomposedTransform"]["translateY"],
        240.0
    );
}

#[test]
fn inspects_a_foreign_glyph_source_without_importing_a_shift_package_first() {
    let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/fonts/Homenaje.glyphs");

    let output = shift(&[
        "glyph",
        "inspect",
        fixture.to_str().unwrap(),
        "Aacute",
        "--view",
        "summary",
        "--json",
    ]);

    assert!(output.status.success(), "{:?}", output.stderr);
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["format"], "glyphs");
    assert_eq!(report["glyph"]["name"], "Aacute");
    assert_eq!(report["summary"]["directComponentCount"], 2);
    assert!(report["summary"]["resolvedContourCount"].as_u64().unwrap() > 0);
}
