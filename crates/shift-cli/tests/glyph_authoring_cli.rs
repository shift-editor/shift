use std::io::Write;
use std::process::{Command, Output, Stdio};

use serde_json::Value;
use shift_font::test_support::sample_font;
use shift_source::ShiftSourcePackage;

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

#[test]
fn authors_glyph_geometry_and_copies_a_layer_through_the_cli() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    let input = temp.path().join("A-regular.json");
    let path_string = path.to_str().unwrap();
    std::fs::write(
        &input,
        r#"{
          "advance": 600,
          "contours": [{
            "closed": true,
            "points": [
              {"x": 0, "y": 0},
              {"x": 300, "y": 700},
              {"x": 600, "y": 0}
            ]
          }],
          "anchors": [{"name": "top", "x": 300, "y": 700}]
        }"#,
    )
    .unwrap();

    assert!(shift(&["font", "create", path_string]).status.success());
    assert!(
        shift(&[
            "axis",
            "add",
            path_string,
            "--tag",
            "wght",
            "--name",
            "Weight",
            "--min",
            "100",
            "--default",
            "400",
            "--max",
            "900",
        ])
        .status
        .success()
    );
    assert!(
        shift(&[
            "source",
            "add",
            path_string,
            "--name",
            "Black",
            "--location",
            "wght=900",
        ])
        .status
        .success()
    );
    let glyph = shift(&[
        "glyph",
        "add",
        path_string,
        "A",
        "--unicode",
        "U+0041",
        "--json",
    ]);
    assert!(glyph.status.success(), "{:?}", glyph.stderr);
    let report: Value = serde_json::from_slice(&glyph.stdout).unwrap();
    assert!(
        report["changes"][0]["glyphId"]
            .as_str()
            .unwrap()
            .starts_with("glyph_")
    );
    assert_eq!(report["changes"][0]["unicodes"][0], "U+0041");

    let added = shift(&[
        "layer",
        "add",
        path_string,
        "--glyph",
        "A",
        "--source",
        "Regular",
        "--input",
        input.to_str().unwrap(),
        "--json",
    ]);
    assert!(added.status.success(), "{:?}", added.stderr);
    let report: Value = serde_json::from_slice(&added.stdout).unwrap();
    assert_eq!(report["changes"][0]["kind"], "glyphLayerCreated");
    assert_eq!(report["changes"][0]["pointCount"], 3);

    let copied = shift(&[
        "layer",
        "copy",
        path_string,
        "--glyph",
        "A",
        "--from-source",
        "Regular",
        "--source",
        "Black",
    ]);
    assert!(copied.status.success(), "{:?}", copied.stderr);

    let font = ShiftSourcePackage::load_font(path_string).unwrap();
    let glyph = font.glyph_by_name("A").unwrap();
    assert_eq!(glyph.unicodes(), &[0x41]);
    assert_eq!(glyph.layers().len(), 2);
    let regular_source = font
        .sources()
        .iter()
        .find(|source| source.name() == "Regular")
        .unwrap();
    let black_source = font
        .sources()
        .iter()
        .find(|source| source.name() == "Black")
        .unwrap();
    let regular = glyph.layer_for_source(regular_source.id()).unwrap();
    let black = glyph.layer_for_source(black_source.id()).unwrap();
    assert_eq!(regular.width(), 600.0);
    assert_eq!(black.width(), 600.0);
    assert_eq!(regular.contours_iter().next().unwrap().points().len(), 3);
    assert_ne!(
        regular.contours_iter().next().unwrap().id(),
        black.contours_iter().next().unwrap().id()
    );
    assert_eq!(regular.anchors()[0].name(), Some("top"));
}

#[test]
fn reads_a_layer_payload_from_stdin() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    let path_string = path.to_str().unwrap();
    assert!(shift(&["font", "create", path_string]).status.success());
    assert!(
        shift(&["glyph", "add", path_string, "space", "--unicode", "U+0020"])
            .status
            .success()
    );

    let output = shift_with_stdin(
        &[
            "layer",
            "add",
            path_string,
            "--glyph",
            "space",
            "--source",
            "Regular",
            "--input",
            "-",
        ],
        r#"{"advance": 250}"#,
    );

    assert!(output.status.success(), "{:?}", output.stderr);
    let font = ShiftSourcePackage::load_font(path_string).unwrap();
    let layer = font
        .glyph_by_name("space")
        .unwrap()
        .layer_for_source(font.default_source_id().unwrap())
        .unwrap();
    assert_eq!(layer.width(), 250.0);
    assert!(layer.contours().is_empty());
}

#[test]
fn invalid_unicode_is_structured_and_does_not_create_a_glyph() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    let path_string = path.to_str().unwrap();
    assert!(shift(&["font", "create", path_string]).status.success());
    let before = std::fs::read(&path).unwrap();

    let output = shift(&[
        "glyph",
        "add",
        path_string,
        "broken",
        "--unicode",
        "U+D800",
        "--json",
    ]);

    assert!(!output.status.success());
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["valid"], false);
    assert!(
        report["error"]["summary"]
            .as_str()
            .unwrap()
            .contains("not a scalar value")
    );
    assert_eq!(std::fs::read(path).unwrap(), before);
}

#[test]
fn payload_identity_is_rejected_without_creating_a_partial_layer() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    let path_string = path.to_str().unwrap();
    assert!(shift(&["font", "create", path_string]).status.success());
    assert!(shift(&["glyph", "add", path_string, "A"]).status.success());
    let before = std::fs::read(&path).unwrap();

    let output = shift_with_stdin(
        &[
            "layer",
            "add",
            path_string,
            "--glyph",
            "A",
            "--source",
            "Regular",
            "--input",
            "-",
            "--json",
        ],
        r#"{
          "advance": 600,
          "contours": [{
            "id": "caller-owned",
            "closed": true,
            "points": [
              {"x": 0, "y": 0},
              {"x": 100, "y": 100}
            ]
          }]
        }"#,
    );

    assert!(!output.status.success());
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert!(
        report["error"]["summary"]
            .as_str()
            .unwrap()
            .contains("invalid layer payload")
    );
    assert_eq!(std::fs::read(&path).unwrap(), before);
    assert!(
        ShiftSourcePackage::load_font(path_string)
            .unwrap()
            .glyph_by_name("A")
            .unwrap()
            .layers()
            .is_empty()
    );
}

#[test]
fn copying_a_layer_preserves_components_with_fresh_identity() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    let path_string = path.to_str().unwrap();
    ShiftSourcePackage::save_font(&path, &sample_font()).unwrap();
    assert!(
        shift(&[
            "source",
            "add",
            path_string,
            "--name",
            "Light",
            "--location",
            "wght=100,wdth=75",
        ])
        .status
        .success()
    );

    let output = shift(&[
        "layer",
        "copy",
        path_string,
        "--glyph",
        "A",
        "--from-source",
        "Regular",
        "--source",
        "Light",
    ]);

    assert!(output.status.success(), "{:?}", output.stderr);
    let font = ShiftSourcePackage::load_font(path_string).unwrap();
    let glyph = font.glyph_by_name("A").unwrap();
    let regular_source = font
        .sources()
        .iter()
        .find(|source| source.name() == "Regular")
        .unwrap();
    let light_source = font
        .sources()
        .iter()
        .find(|source| source.name() == "Light")
        .unwrap();
    let regular = glyph.layer_for_source(regular_source.id()).unwrap();
    let light = glyph.layer_for_source(light_source.id()).unwrap();
    assert_eq!(regular.components().len(), 2);
    assert_eq!(light.components().len(), regular.components().len());
    for (light_component, regular_component) in
        light.components_iter().zip(regular.components_iter())
    {
        assert_eq!(
            light_component.base_glyph_id(),
            regular_component.base_glyph_id()
        );
        assert_eq!(light_component.transform(), regular_component.transform());
        assert_ne!(light_component.id(), regular_component.id());
    }
}
