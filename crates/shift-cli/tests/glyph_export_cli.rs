mod support;

use std::path::Path;

use serde_json::Value;
use support::{load_font, shift, shift_with_stdin};

fn mutatorsans() -> String {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/fonts/mutatorsans/MutatorSansLightCondensed.ufo")
        .to_string_lossy()
        .into_owned()
}

fn export(path: &str, glyphs: &str) -> Value {
    let output = shift(&["glyph", "export", path, "--glyphs", glyphs]);
    assert!(
        output.status.success(),
        "{:?}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}

fn names(batch: &Value) -> Vec<&str> {
    let mut names: Vec<&str> = batch["glyphs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|glyph| glyph["name"].as_str().unwrap())
        .collect();
    names.sort_unstable();
    names
}

#[test]
fn export_brings_the_glyphs_a_composite_uses() {
    let batch = export(&mutatorsans(), "Aacute");

    assert_eq!(batch["format"], 1);
    assert_eq!(names(&batch), ["A", "Aacute", "acute"]);
    let aacute = batch["glyphs"]
        .as_array()
        .unwrap()
        .iter()
        .find(|glyph| glyph["name"] == "Aacute")
        .unwrap();
    let bases: Vec<_> = aacute["layer"]["components"]
        .as_array()
        .unwrap()
        .iter()
        .map(|component| component["base"].as_str().unwrap())
        .collect();
    assert_eq!(bases, ["A", "acute"]);
}

#[test]
fn exported_glyphs_set_into_a_new_document_export_back_unchanged() {
    let temp = tempfile::tempdir().unwrap();
    let document = temp.path().join("Lab.shift");
    let original = export(&mutatorsans(), "Aacute,B");
    let document = document.to_str().unwrap();
    assert!(shift(&["font", "create", document]).status.success());

    let set = shift_with_stdin(
        &["glyph", "set", document, "--input", "-"],
        &original.to_string(),
    );
    assert!(
        set.status.success(),
        "{:?}",
        String::from_utf8_lossy(&set.stderr)
    );
    let font = load_font(document);
    let aacute = font.glyph_by_name("Aacute").unwrap();
    let layer = aacute
        .layer_for_source(&font.default_source_id().unwrap())
        .unwrap();
    assert_eq!(layer.components().len(), 2);

    let mut before = original["glyphs"].as_array().unwrap().clone();
    let after = export(document, "Aacute,B");
    let mut after = after["glyphs"].as_array().unwrap().clone();
    let by_name = |glyph: &Value| glyph["name"].as_str().unwrap().to_string();
    before.sort_by_key(by_name);
    after.sort_by_key(by_name);
    assert_eq!(before, after);
}

#[test]
fn export_names_a_glyph_the_font_lacks() {
    let output = shift(&["glyph", "export", &mutatorsans(), "--glyphs", "nonesuch"]);

    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("nonesuch"));
}
