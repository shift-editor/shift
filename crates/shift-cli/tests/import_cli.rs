#[expect(dead_code, reason = "import tests use only some of the shared helpers")]
mod support;

use shift_backends::font_loader::FontLoader;
use support::{load_font, shift};

const FONTS: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/fonts");

#[test]
fn imports_a_designspace_with_its_glyphs_masters_instances_and_kerning() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("MutatorSans.shift");
    let path = path.to_str().unwrap();
    let designspace = format!("{FONTS}/mutatorsans-variable/MutatorSans.designspace");
    let source = FontLoader::new().read_font(&designspace).unwrap();

    let output = shift(&["import", &designspace, "--output", path, "--json"]);

    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let imported = load_font(path);
    assert_eq!(imported.glyph_count(), source.glyph_count());
    assert!(imported.glyph_count() > 0);
    assert_eq!(imported.sources().len(), source.sources().len());
    assert_eq!(
        imported.named_instances().len(),
        source.named_instances().len()
    );
    assert_eq!(imported.kerning(), source.kerning());
    let a = imported.glyph_by_name("A").expect("A is imported");
    assert_eq!(
        a.layers().len(),
        source.glyph_by_name("A").unwrap().layers().len()
    );

    let report: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["glyphs"], source.glyph_count());
    assert_eq!(report["document"], path);
}

#[test]
fn an_imported_document_compiles() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Homenaje.shift");
    let path = path.to_str().unwrap();
    let ttf = temp.path().join("Homenaje.ttf");

    let imported = shift(&["import", &format!("{FONTS}/Homenaje.glyphs"), "-o", path]);
    assert!(
        imported.status.success(),
        "{}",
        String::from_utf8_lossy(&imported.stderr)
    );
    let compiled = shift(&["compile", path, "-o", ttf.to_str().unwrap()]);

    assert!(
        compiled.status.success(),
        "{}",
        String::from_utf8_lossy(&compiled.stderr)
    );
    assert!(ttf.is_file());
}

#[test]
fn refuses_to_overwrite_or_write_a_non_shift_path() {
    let temp = tempfile::tempdir().unwrap();
    let existing = temp.path().join("Taken.shift");
    std::fs::write(&existing, b"keep").unwrap();
    let ufo = format!("{FONTS}/ShapingTest.ufo");

    let overwrite = shift(&["import", &ufo, "-o", existing.to_str().unwrap()]);
    let wrong_extension = shift(&[
        "import",
        &ufo,
        "-o",
        temp.path().join("Font.sqlite").to_str().unwrap(),
    ]);

    assert!(!overwrite.status.success());
    assert_eq!(std::fs::read(&existing).unwrap(), b"keep");
    assert!(!wrong_extension.status.success());
}
