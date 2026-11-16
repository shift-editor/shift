mod support;

use serde_json::{Value, json};
use support::{load_font, shift, shift_with_stdin};

/// Creates `Solenoid.shift` in `temp`, with a Bleed axis and a Bled master
/// at Bleed 100, and sets `dot` and an `H` holding `components` on both
/// masters. Returns the document's path and how `glyph set` went.
fn solenoid_with_h(temp: &tempfile::TempDir, components: &Value) -> (String, std::process::Output) {
    let path = temp
        .path()
        .join("Solenoid.shift")
        .to_string_lossy()
        .into_owned();
    let bleed = [
        "--tag",
        "BLED",
        "--name",
        "Bleed",
        "--min",
        "0",
        "--default",
        "0",
        "--max",
        "100",
    ];
    let bled = ["--name", "Bled", "--location", "BLED=100"];
    for args in [
        vec!["font", "create", &path],
        [&["axis", "add", &path][..], &bleed].concat(),
        [&["source", "add", &path][..], &bled].concat(),
    ] {
        let output = shift(&args);
        assert!(output.status.success(), "{args:?}: {:?}", output.stderr);
    }

    let glyphs: Vec<Value> = ["Regular", "Bled"]
        .into_iter()
        .flat_map(|source| {
            [
                json!({"name": "dot", "source": source, "layer": {
                    "advance": 0, "svgPath": "M0 0 L10 0 L10 10 Z",
                }}),
                json!({"name": "H", "source": source, "layer": {
                    "advance": 720, "components": components,
                }}),
            ]
        })
        .collect();
    let batch = json!({"format": 1, "glyphs": glyphs});
    let output = shift_with_stdin(&["glyph", "set", &path, "--input", "-"], &batch.to_string());
    (path, output)
}

#[test]
fn component_locations_round_trip_through_glyph_set_and_export() {
    let temp = tempfile::tempdir().unwrap();
    let components = json!([
        {"base": "dot"},
        {"base": "dot", "location": {"BLED": 100.0}},
        {"base": "dot", "inheritance": "font"},
    ]);

    let (path, output) = solenoid_with_h(&temp, &components);
    assert!(output.status.success(), "{:?}", output.stderr);

    let output = shift(&["glyph", "export", &path, "--glyphs", "H", "--source", "all"]);
    assert!(output.status.success(), "{:?}", output.stderr);
    let exported: Value = serde_json::from_slice(&output.stdout).unwrap();
    let exported: Vec<&Value> = exported["glyphs"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|entry| entry["name"] == "H")
        .map(|entry| &entry["layer"]["components"])
        .collect();
    assert_eq!(exported, vec![&components, &components]);
}

#[test]
fn a_location_on_an_axis_the_font_lacks_is_rejected() {
    let temp = tempfile::tempdir().unwrap();

    let (path, output) =
        solenoid_with_h(&temp, &json!([{"base": "dot", "location": {"wght": 700}}]));

    assert!(!output.status.success());
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("no axis tagged \"wght\""), "{stderr}");
    assert!(load_font(&path).glyph_by_name("H").is_none());
}
