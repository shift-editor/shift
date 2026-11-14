mod support;

use std::path::Path;

use shift_backends::font_loader::FontLoader;
use shift_font::{Font, test_support::sample_variable_font};
use shift_store::ShiftStore;
use support::{load_font, shift, shift_with_stdin};

/// A fixture step that fails with a reason instead of panicking.
type Fixture<T> = Result<T, Box<dyn std::error::Error>>;

fn utf8(path: &Path) -> Fixture<String> {
    Ok(path.to_str().ok_or("temp paths are UTF-8")?.to_string())
}

fn variable_document(dir: &Path) -> Fixture<String> {
    let path = dir.join("Dogfood.shift");
    drop(ShiftStore::create_document(&path, &sample_variable_font())?);
    utf8(&path)
}

/// A one-master document made through the CLI, with one glyph `A`.
fn single_master_document(dir: &Path) -> Fixture<String> {
    let path = utf8(&dir.join("Lab.shift"))?;
    let created = shift(&["font", "create", &path]);
    if !created.status.success() {
        return Err(format!("font create failed: {}", stderr(&created)).into());
    }
    let glyphs = r#"{"glyphs":[{"name":"A","unicodes":["U+0041"],"layer":{"advance":600,"svgPath":"M0 0 L300 700 L600 0 Z"}}]}"#;
    let set = shift_with_stdin(&["glyph", "set", &path, "--input", "-"], glyphs);
    if !set.status.success() {
        return Err(format!("glyph set failed: {}", stderr(&set)).into());
    }
    Ok(path)
}

fn read(path: &Path) -> Fixture<Font> {
    Ok(FontLoader::new().read_font(&utf8(path)?)?)
}

fn stderr(output: &std::process::Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

#[test]
fn exports_a_designspace_with_one_ufo_per_master() {
    let temp = tempfile::tempdir().unwrap();
    let document = variable_document(temp.path()).unwrap();
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
    let exported = read(&designspace).unwrap();
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
    let document = single_master_document(temp.path()).unwrap();
    let ufo = temp.path().join("Lab.ufo");

    let output = shift(&["export", &document, "--output", ufo.to_str().unwrap()]);

    assert!(output.status.success(), "{}", stderr(&output));
    let exported = read(&ufo).unwrap();
    let authored = load_font(&document);
    assert_eq!(
        exported.glyph_by_name("A").unwrap().unicodes(),
        authored.glyph_by_name("A").unwrap().unicodes()
    );
    assert_eq!(exported.glyph_by_name("A").unwrap().unicodes(), [0x41]);
}

/// A refused export names the problem and writes nothing.
struct Refusal {
    variable: bool,
    output: &'static str,
    reason: &'static str,
}

#[test]
fn refused_exports_say_why_and_write_nothing() {
    let refusals = [
        Refusal {
            variable: true,
            output: "Dogfood.ufo",
            reason: "export a designspace instead",
        },
        Refusal {
            variable: false,
            output: "Lab.otf",
            reason: ".designspace, .ufo or .ttf",
        },
    ];
    for refusal in refusals {
        let temp = tempfile::tempdir().unwrap();
        let document = if refusal.variable {
            variable_document(temp.path()).unwrap()
        } else {
            single_master_document(temp.path()).unwrap()
        };
        let output_path = temp.path().join(refusal.output);

        let output = shift(&["export", &document, "-o", output_path.to_str().unwrap()]);

        assert!(
            !output.status.success(),
            "{} should be refused",
            refusal.output
        );
        assert!(
            stderr(&output).contains(refusal.reason),
            "{}",
            stderr(&output)
        );
        assert!(!output_path.exists());
    }
}

#[test]
fn export_leaves_the_document_unchanged() {
    let temp = tempfile::tempdir().unwrap();
    let document = variable_document(temp.path()).unwrap();
    let before = std::fs::read(&document).unwrap();
    let designspace = temp.path().join("Dogfood.designspace");

    let output = shift(&["export", &document, "-o", designspace.to_str().unwrap()]);

    assert!(output.status.success(), "{}", stderr(&output));
    assert_eq!(std::fs::read(&document).unwrap(), before);
}

#[test]
fn compile_static_writes_one_static_font_per_named_instance() {
    let temp = tempfile::tempdir().unwrap();
    let document = variable_document(temp.path()).unwrap();
    let fonts = temp.path().join("fonts");

    let output = shift(&[
        "compile",
        &document,
        "--static",
        "-o",
        fonts.to_str().unwrap(),
    ]);

    assert!(output.status.success(), "{}", stderr(&output));
    let bold = fonts.join("UntitledFont-Bold.ttf");
    assert_eq!(
        String::from_utf8_lossy(&output.stdout).trim(),
        bold.display().to_string()
    );
    let bytes = std::fs::read(&bold).unwrap();
    let font = skrifa::FontRef::new(&bytes).unwrap();
    assert!(font.table_data(skrifa::Tag::new(b"fvar")).is_none());
}
