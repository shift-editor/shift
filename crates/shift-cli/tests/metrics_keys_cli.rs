mod support;

use serde_json::{Value, json};
use shift_font::{Font, MetricsKeySide};
use support::{load_font, shift, shift_with_stdin};

/// A new document with a Regular and a Bold master on a weight axis.
fn two_master_document(temp: &tempfile::TempDir) -> String {
    let path = temp.path().join("Mono.shift");
    let path = path.to_str().unwrap().to_string();
    for args in [
        vec!["font", "create", &path],
        vec![
            "axis",
            "add",
            &path,
            "--tag",
            "wght",
            "--name",
            "Weight",
            "--min",
            "400",
            "--default",
            "400",
            "--max",
            "700",
        ],
        vec![
            "source",
            "add",
            &path,
            "--name",
            "Bold",
            "--location",
            "wght=700",
        ],
    ] {
        let output = shift(&args);
        assert!(output.status.success(), "{args:?}: {:?}", output.stderr);
    }
    path
}

fn glyph_set(path: &str, batch: &Value) -> std::process::Output {
    shift_with_stdin(&["glyph", "set", path, "--input", "-"], &batch.to_string())
}

fn width(font: &Font, glyph: &str, source: &str) -> f64 {
    let source_id = font
        .sources()
        .iter()
        .find(|candidate| candidate.name() == source)
        .unwrap()
        .id();
    font.glyph_by_name(glyph)
        .unwrap()
        .layer_for_source(source_id)
        .unwrap()
        .width()
}

/// A space, and `H` and `O` drawn narrower than it, in both masters.
fn monospace_batch(glyph_keys: &Value, bold_layer_keys: Option<&Value>) -> Value {
    let mut glyphs = vec![
        json!({"name": "space", "unicodes": ["U+0020"], "layer": {"advance": 600}}),
        json!({"name": "space", "source": "Bold", "layer": {"advance": 650}}),
    ];
    for name in ["H", "O"] {
        glyphs.push(json!({
            "name": name,
            "metricsKeys": glyph_keys,
            "layer": {"advance": 500, "svgPath": "M100 0 L400 0 L400 700 L100 700 Z"},
        }));
        let mut bold = json!({"advance": 500, "svgPath": "M100 0 L400 0 L400 700 L100 700 Z"});
        if let Some(keys) = bold_layer_keys {
            bold["metricsKeys"] = keys.clone();
        }
        glyphs.push(json!({"name": name, "source": "Bold", "layer": bold}));
    }
    json!({"format": 1, "glyphs": glyphs})
}

#[test]
fn width_keys_follow_space_in_every_source() {
    let temp = tempfile::tempdir().unwrap();
    let path = two_master_document(&temp);

    let output = glyph_set(&path, &monospace_batch(&json!({"width": "=space"}), None));
    assert!(output.status.success(), "{:?}", output.stderr);

    let font = load_font(&path);
    for glyph in ["H", "O"] {
        assert_eq!(width(&font, glyph, "Regular"), 600.0);
        assert_eq!(width(&font, glyph, "Bold"), 650.0);
        let keys = font.glyph_by_name(glyph).unwrap().metrics_keys();
        assert_eq!(keys.get(MetricsKeySide::Width).unwrap().as_str(), "=space");
    }

    // Changing the space later moves every glyph that reads it.
    let output = shift_with_stdin(
        &[
            "layer", "set", &path, "--glyph", "space", "--source", "Regular", "--input", "-",
        ],
        r#"{"advance": 720}"#,
    );
    assert!(output.status.success(), "{:?}", output.stderr);
    let font = load_font(&path);
    assert_eq!(width(&font, "H", "Regular"), 720.0);
    assert_eq!(width(&font, "O", "Regular"), 720.0);
    assert_eq!(width(&font, "H", "Bold"), 650.0);
}

#[test]
fn a_layer_key_overrides_the_glyph_key_in_its_source_only() {
    let temp = tempfile::tempdir().unwrap();
    let path = two_master_document(&temp);

    let batch = monospace_batch(
        &json!({"width": "=space"}),
        Some(&json!({"width": "=space+20"})),
    );
    let output = glyph_set(&path, &batch);
    assert!(output.status.success(), "{:?}", output.stderr);

    let font = load_font(&path);
    assert_eq!(width(&font, "H", "Regular"), 600.0);
    assert_eq!(width(&font, "H", "Bold"), 670.0);
}

#[test]
fn exported_keys_set_into_another_document_unchanged() {
    let temp = tempfile::tempdir().unwrap();
    let path = two_master_document(&temp);
    let batch = monospace_batch(
        &json!({"width": "=space"}),
        Some(&json!({"width": "=space+20"})),
    );
    assert!(glyph_set(&path, &batch).status.success());

    let output = shift(&[
        "glyph", "export", &path, "--glyphs", "H,space", "--source", "all",
    ]);
    assert!(output.status.success(), "{:?}", output.stderr);
    let exported: Value = serde_json::from_slice(&output.stdout).unwrap();
    let h_entries: Vec<&Value> = exported["glyphs"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|entry| entry["name"] == "H")
        .collect();
    assert_eq!(h_entries.len(), 2);
    for entry in &h_entries {
        assert_eq!(entry["metricsKeys"], json!({"width": "=space"}));
    }
    let bold = h_entries
        .iter()
        .find(|entry| entry["source"] == "Bold")
        .unwrap();
    assert_eq!(bold["layer"]["metricsKeys"], json!({"width": "=space+20"}));

    let copy = tempfile::tempdir().unwrap();
    let copy_path = two_master_document(&copy);
    let output = glyph_set(&copy_path, &exported);
    assert!(output.status.success(), "{:?}", output.stderr);
    let font = load_font(&copy_path);
    assert_eq!(width(&font, "H", "Regular"), 600.0);
    assert_eq!(width(&font, "H", "Bold"), 670.0);
}

#[test]
fn keys_that_cannot_be_evaluated_are_rejected_without_writing() {
    for (key, expected) in [("=spcae", "no glyph named `spcae`"), ("=(space", "width")] {
        let temp = tempfile::tempdir().unwrap();
        let path = two_master_document(&temp);

        let output = glyph_set(&path, &monospace_batch(&json!({"width": key}), None));

        assert!(!output.status.success(), "{key} was accepted");
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(
            stderr.contains("metrics keys cannot be evaluated"),
            "{stderr}"
        );
        assert!(stderr.contains(expected), "{stderr}");
        assert!(load_font(&path).glyph_by_name("H").is_none());
    }
}

#[test]
fn a_glyph_given_two_different_key_sets_is_rejected() {
    let temp = tempfile::tempdir().unwrap();
    let path = two_master_document(&temp);
    let batch = json!({"format": 1, "glyphs": [
        {"name": "space", "layer": {"advance": 600}},
        {"name": "H", "metricsKeys": {"width": "=space"}, "layer": {"advance": 500}},
        {"name": "H", "source": "Bold", "metricsKeys": {"width": "=space+10"}, "layer": {"advance": 500}},
    ]});

    let output = glyph_set(&path, &batch);

    assert!(!output.status.success());
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("conflicting glyph metrics keys"),
        "{stderr}"
    );
}
