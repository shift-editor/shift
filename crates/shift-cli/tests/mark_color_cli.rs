mod support;

use std::error::Error;
use std::path::{Path, PathBuf};
use std::process::Output;

use serde_json::{Value, json};
use shift_font::test_support::sample_font;
use shift_font::{MarkColor, NamedMarkColor, Rgba};
use shift_store::ShiftStore;
use support::{load_font, shift, shift_with_stdin};
use tempfile::TempDir;

const RED: Option<MarkColor> = Some(MarkColor::Named(NamedMarkColor::Red));
const TEAL: Option<MarkColor> = Some(MarkColor::Custom(Rgba {
    red: 0.0,
    green: 0.5,
    blue: 0.5,
    alpha: 1.0,
}));

/// The sample font (glyphs `A` and `acute`, sources Regular and Bold) as a
/// new document, with each `(glyphs, colour)` pair applied by `glyph color`.
fn tagged_document(tags: &[(&str, &str)]) -> Result<(TempDir, PathBuf), Box<dyn Error>> {
    let temp = tempfile::tempdir()?;
    let path = temp.path().join("Lab.shift");
    drop(ShiftStore::create_document(&path, &sample_font())?);
    for (glyphs, color) in tags {
        let output = glyph_color(&path, glyphs, &["--color", color])?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).into());
        }
    }
    Ok((temp, path))
}

fn glyph_color(path: &Path, glyphs: &str, choice: &[&str]) -> Result<Output, Box<dyn Error>> {
    let document = path.to_str().ok_or("document path is not UTF-8")?;
    let mut args = vec!["glyph", "color", document, "--glyphs", glyphs];
    args.extend(choice);
    Ok(shift(&args))
}

fn mark_colors(path: &Path, names: &[&str]) -> Result<Vec<Option<MarkColor>>, Box<dyn Error>> {
    let font = load_font(path.to_str().ok_or("document path is not UTF-8")?);
    names
        .iter()
        .map(|name| {
            let glyph = font.glyph_by_name(name).ok_or("glyph is missing")?;
            Ok(glyph.mark_color())
        })
        .collect()
}

fn set_glyphs(path: &Path, batch: &str) -> Result<Output, Box<dyn Error>> {
    let document = path.to_str().ok_or("document path is not UTF-8")?;
    Ok(shift_with_stdin(
        &["glyph", "set", document, "--input", "-"],
        batch,
    ))
}

#[test]
fn glyph_color_tags_every_named_glyph_and_clear_removes_it() {
    let (_temp, path) = tagged_document(&[("A,acute", "red")]).unwrap();
    assert_eq!(mark_colors(&path, &["A", "acute"]).unwrap(), [RED, RED]);

    let custom = glyph_color(&path, "acute", &["--color", "0,0.5,0.5,1"]).unwrap();
    let cleared = glyph_color(&path, "A", &["--clear"]).unwrap();

    assert!(custom.status.success(), "{custom:?}");
    assert!(cleared.status.success(), "{cleared:?}");
    assert_eq!(mark_colors(&path, &["A", "acute"]).unwrap(), [None, TEAL]);
}

#[test]
fn glyph_color_refuses_an_unknown_glyph_or_colour_without_changing_any_glyph() {
    let (_temp, path) = tagged_document(&[]).unwrap();

    let unknown_glyph = glyph_color(&path, "A,missing", &["--color", "red"]).unwrap();
    let unknown_color = glyph_color(&path, "A", &["--color", "pink"]).unwrap();

    assert!(!unknown_glyph.status.success());
    assert!(String::from_utf8_lossy(&unknown_glyph.stderr).contains("\"missing\""));
    assert!(!unknown_color.status.success());
    assert!(String::from_utf8_lossy(&unknown_color.stderr).contains("lightGreen"));
    assert_eq!(mark_colors(&path, &["A"]).unwrap(), [None]);
}

#[test]
fn glyph_set_sets_a_mark_colour_clears_it_with_null_and_keeps_it_when_absent() {
    let (_temp, path) = tagged_document(&[("A,acute", "red")]).unwrap();
    let batch = json!({ "glyphs": [
        { "name": "A", "markColor": null },
        { "name": "acute" },
        { "name": "B", "markColor": "0,0.5,0.5,1" },
    ]});

    let output = set_glyphs(&path, &batch.to_string()).unwrap();

    assert!(output.status.success(), "{output:?}");
    assert_eq!(
        mark_colors(&path, &["A", "acute", "B"]).unwrap(),
        [None, RED, TEAL]
    );
}

#[test]
fn glyph_set_refuses_the_whole_batch_for_conflicting_or_unreadable_mark_colours() {
    let (_temp, path) = tagged_document(&[]).unwrap();
    let conflicting = json!({ "glyphs": [
        { "name": "acute", "markColor": "red" },
        { "name": "A", "source": "Regular", "markColor": "red" },
        { "name": "A", "source": "Bold", "markColor": "purple" },
    ]});
    let unreadable = json!({ "glyphs": [
        { "name": "acute", "markColor": "red" },
        { "name": "A", "markColor": "pink" },
    ]});

    let conflicting = set_glyphs(&path, &conflicting.to_string()).unwrap();
    let unreadable = set_glyphs(&path, &unreadable.to_string()).unwrap();

    assert!(!conflicting.status.success());
    assert!(String::from_utf8_lossy(&conflicting.stderr).contains("conflicting mark colours"));
    assert!(!unreadable.status.success());
    assert!(String::from_utf8_lossy(&unreadable.stderr).contains("\"pink\""));
    assert_eq!(mark_colors(&path, &["A", "acute"]).unwrap(), [None, None]);
}

#[test]
fn exported_mark_colours_set_into_another_document() {
    let (_temp, path) = tagged_document(&[("A", "red"), ("acute", "0,0.5,0.5,1")]).unwrap();
    let (_target_temp, target) = tagged_document(&[]).unwrap();
    let document = path.to_str().ok_or("document path is not UTF-8").unwrap();

    let batch = shift(&["glyph", "export", document, "--glyphs", "A,acute"]);
    let output = set_glyphs(&target, &String::from_utf8(batch.stdout).unwrap()).unwrap();

    assert!(output.status.success(), "{output:?}");
    assert_eq!(mark_colors(&target, &["A", "acute"]).unwrap(), [RED, TEAL]);
}

#[test]
fn glyph_inspect_reports_the_mark_colour() {
    let (_temp, path) = tagged_document(&[("A", "lightBlue")]).unwrap();
    let document = path.to_str().ok_or("document path is not UTF-8").unwrap();

    let tagged = shift(&["glyph", "inspect", document, "A", "--json"]);
    let untagged = shift(&["glyph", "inspect", document, "acute", "--json"]);
    let summary = shift(&["glyph", "inspect", document, "A"]);

    let tagged: Value = serde_json::from_slice(&tagged.stdout).unwrap();
    let untagged: Value = serde_json::from_slice(&untagged.stdout).unwrap();
    let summary = String::from_utf8(summary.stdout).unwrap();
    assert_eq!(tagged["glyph"]["markColor"], "lightBlue");
    assert_eq!(untagged["glyph"]["markColor"], Value::Null);
    assert!(summary.contains("mark color  lightBlue"), "{summary}");
}
