mod support;

use std::path::Path;

use shift_backends::font_loader::FontLoader;
use shift_font::{Font, test_support::sample_variable_font};
use shift_store::ShiftStore;
use support::{load_font, shift, shift_with_stdin};

fn variable_document(dir: &Path) -> String {
    let path = dir.join("Dogfood.shift");
    drop(ShiftStore::create_document(&path, &sample_variable_font()).unwrap());
    path.to_str().unwrap().to_string()
}

/// A one-master document made through the CLI, with one glyph `A`.
fn single_master_document(dir: &Path) -> String {
    let path = dir.join("Lab.shift");
    let path = path.to_str().unwrap().to_string();
    assert!(shift(&["font", "create", &path]).status.success());
    let glyphs = r#"{"glyphs":[{"name":"A","unicodes":["U+0041"],"layer":{"advance":600,"svgPath":"M0 0 L300 700 L600 0 Z"}}]}"#;
    assert!(
        shift_with_stdin(&["glyph", "set", &path, "--input", "-"], glyphs)
            .status
            .success()
    );
    path
}

fn read(path: &Path) -> Font {
    FontLoader::new()
        .read_font(path.to_str().unwrap())
        .unwrap_or_else(|error| panic!("reading {}: {error}", path.display()))
}

fn stderr(output: &std::process::Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

#[test]
fn exports_a_designspace_with_one_ufo_per_master() {
    let temp = tempfile::tempdir().unwrap();
    let document = variable_document(temp.path());
    let out = temp.path().join("out");
    let designspace = out.join("Dogfood.designspace");

    let output = shift(&["export", &document, "-o", designspace.to_str().unwrap()]);

    assert!(output.status.success(), "{}", stderr(&output));
    assert_eq!(
        String::from_utf8_lossy(&output.stdout).trim(),
        designspace.display().to_string()
    );
    for ufo in ["Dogfood.ufo", "Dogfood-Medium.ufo", "Dogfood-Bold.ufo"] {
        assert!(out.join(ufo).is_dir(), "{ufo} should be written");
    }
    let exported = read(&designspace);
    let names: Vec<_> = exported
        .sources()
        .iter()
        .map(shift_font::Source::name)
        .collect();
    assert_eq!(names, ["Regular", "Medium", "Bold"]);
    assert!(exported.glyph_by_name("A").is_some());
}

#[test]
fn exports_a_single_master_font_as_a_ufo() {
    let temp = tempfile::tempdir().unwrap();
    let document = single_master_document(temp.path());
    let ufo = temp.path().join("Lab.ufo");

    let output = shift(&["export", &document, "--output", ufo.to_str().unwrap()]);

    assert!(output.status.success(), "{}", stderr(&output));
    let exported = read(&ufo);
    let authored = load_font(&document);
    assert_eq!(
        exported.glyph_by_name("A").unwrap().unicodes(),
        authored.glyph_by_name("A").unwrap().unicodes()
    );
    assert_eq!(exported.glyph_by_name("A").unwrap().unicodes(), [0x41]);
}

#[test]
fn refuses_a_ufo_for_a_font_with_several_masters() {
    let temp = tempfile::tempdir().unwrap();
    let document = variable_document(temp.path());
    let ufo = temp.path().join("Dogfood.ufo");

    let output = shift(&["export", &document, "-o", ufo.to_str().unwrap()]);

    assert!(!output.status.success());
    assert!(
        stderr(&output).contains("export a designspace instead"),
        "{}",
        stderr(&output)
    );
    assert!(!ufo.exists());
}

#[test]
fn names_the_formats_when_the_extension_picks_none() {
    let temp = tempfile::tempdir().unwrap();
    let document = single_master_document(temp.path());
    let otf = temp.path().join("Lab.otf");

    let output = shift(&["export", &document, "-o", otf.to_str().unwrap()]);

    assert!(!output.status.success());
    assert!(
        stderr(&output).contains(".designspace, .ufo or .ttf"),
        "{}",
        stderr(&output)
    );
    assert!(!otf.exists());
}

#[test]
fn export_leaves_the_document_unchanged() {
    let temp = tempfile::tempdir().unwrap();
    let document = variable_document(temp.path());
    let before = std::fs::read(&document).unwrap();
    let designspace = temp.path().join("Dogfood.designspace");

    let output = shift(&["export", &document, "-o", designspace.to_str().unwrap()]);

    assert!(output.status.success(), "{}", stderr(&output));
    assert_eq!(std::fs::read(&document).unwrap(), before);
}
