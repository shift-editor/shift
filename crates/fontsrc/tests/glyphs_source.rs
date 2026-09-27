mod support;

use std::io;
use std::path::{Path, PathBuf};

use fontsrc::glyphs::{load_from_source, Font};
use support::MemorySource;

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("fixtures/fonts")
        .join(name)
}

#[test]
fn in_memory_files_match_native_loading() {
    for path in [
        fixture("GlyphsImportLosses.glyphs"),
        fixture("Homenaje.glyphs"),
        fixture("MutatorSansVariable.glyphs"),
    ] {
        assert_in_memory_file_matches_native(&path);
    }
}

fn assert_in_memory_file_matches_native(path: &Path) {
    let expected = Font::load(path).unwrap();
    let content = std::fs::read_to_string(path).unwrap();
    let source = MemorySource::read(path.parent().unwrap()).unwrap();

    let from_string = Font::load_from_string(&content).unwrap();
    let from_source = load_from_source(Path::new(path.file_name().unwrap()), &source).unwrap();

    assert_eq!(from_string, expected);
    assert_eq!(from_source, expected);
}

#[test]
fn malformed_in_memory_file_returns_an_error() {
    let result = Font::load_from_string("{ glyphs = (");

    assert!(result.is_err());
}

#[test]
fn native_package_matches_equivalent_in_memory_file() {
    let temporary = tempfile::tempdir().unwrap();
    let package = temporary.path().join("Test.glyphspackage");
    let glyphs = package.join("glyphs");
    std::fs::create_dir_all(&glyphs).unwrap();
    std::fs::write(package.join("fontinfo.plist"), FONT_INFO).unwrap();
    std::fs::write(glyphs.join("A_.glyph"), GLYPH).unwrap();

    let expected = Font::load_from_string(COMPLETE_FILE).unwrap();
    let root = temporary.path();
    let actual = load_from_source(Path::new("Test.glyphspackage"), &root).unwrap();

    assert_eq!(actual, expected);
}

#[test]
fn in_memory_package_returns_unsupported_until_upstream_supports_it() {
    let temporary = tempfile::tempdir().unwrap();
    let package = temporary.path().join("Test.glyphspackage");
    std::fs::create_dir_all(package.join("glyphs")).unwrap();
    std::fs::write(package.join("fontinfo.plist"), FONT_INFO).unwrap();
    std::fs::write(package.join("glyphs/A_.glyph"), GLYPH).unwrap();
    let source = MemorySource::read(temporary.path()).unwrap();

    let error = load_from_source(Path::new("Test.glyphspackage"), &source).unwrap_err();

    assert!(matches!(
        error,
        fontsrc::glyphs::error::Error::IoError(error)
            if error.kind() == io::ErrorKind::Unsupported
    ));
}

const FONT_INFO: &str = r#"{
familyName = "Package Font";
unitsPerEm = 1000;
fontMaster = (
{
ascender = 800;
capHeight = 700;
descender = -200;
id = MASTER1;
xHeight = 500;
}
);
}"#;

const GLYPH: &str = r#"{
glyphname = A;
layers = (
{
layerId = MASTER1;
paths = (
{
closed = 1;
nodes = (
"0 0 LINE",
"100 0 LINE",
"100 100 LINE",
"0 100 LINE"
);
}
);
width = 600;
}
);
unicode = 0041;
}"#;

const COMPLETE_FILE: &str = r#"{
familyName = "Package Font";
unitsPerEm = 1000;
fontMaster = (
{
ascender = 800;
capHeight = 700;
descender = -200;
id = MASTER1;
xHeight = 500;
}
);
glyphs = (
{
glyphname = A;
layers = (
{
layerId = MASTER1;
paths = (
{
closed = 1;
nodes = (
"0 0 LINE",
"100 0 LINE",
"100 100 LINE",
"0 100 LINE"
);
}
);
width = 600;
}
);
unicode = 0041;
}
);
}"#;
