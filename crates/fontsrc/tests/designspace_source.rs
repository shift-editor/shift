mod support;

use std::io::Cursor;
use std::path::{Path, PathBuf};

use fontsrc::designspace::DesignSpaceDocument;
use fontsrc::ufo::{DataRequest, Font};
use support::MemorySource;

fn fixture() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("fixtures/fonts/mutatorsans-variable/MutatorSans.designspace")
}

#[test]
fn in_memory_document_matches_native_file() {
    let path = fixture();
    let expected = DesignSpaceDocument::load(&path).unwrap();
    let bytes = std::fs::read(&path).unwrap();

    let actual = DesignSpaceDocument::load_from_reader(Cursor::new(bytes)).unwrap();

    assert_eq!(actual, expected);
    assert_referenced_ufos_exist(&path, &actual);
}

#[test]
fn every_referenced_ufo_loads_from_memory() {
    let path = fixture();
    let root = path.parent().unwrap();
    let document = DesignSpaceDocument::load(&path).unwrap();

    for descriptor in document.sources {
        let path = root.join(descriptor.filename);
        let expected = Font::load(&path).unwrap();
        let source = MemorySource::read(&path).unwrap();

        let actual = Font::load_from_source(&DataRequest::all(), &source).unwrap();

        assert_eq!(actual, expected, "source mismatch for {}", path.display());
    }
}

#[test]
fn in_memory_document_round_trips_complete_model() {
    let expected = DesignSpaceDocument::load(fixture()).unwrap();
    let mut bytes = Vec::new();

    expected.save_to_writer(&mut bytes).unwrap();
    let actual = DesignSpaceDocument::load_from_reader(Cursor::new(bytes)).unwrap();

    assert_eq!(actual, expected);
}

#[test]
fn malformed_in_memory_document_returns_an_error() {
    let result = DesignSpaceDocument::load_from_reader(Cursor::new(b"<designspace>"));

    assert!(result.is_err());
}

fn assert_referenced_ufos_exist(path: &Path, document: &DesignSpaceDocument) {
    let root = path.parent().unwrap();

    assert!(!document.sources.is_empty());
    for source in &document.sources {
        assert!(root.join(&source.filename).is_dir());
    }
}
