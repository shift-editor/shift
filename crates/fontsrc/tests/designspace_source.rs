use std::io::Cursor;
use std::path::{Path, PathBuf};

use fontsrc::designspace::DesignSpaceDocument;

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
fn in_memory_document_round_trips_complete_model() {
    let expected = DesignSpaceDocument::load(fixture()).unwrap();
    let mut bytes = Vec::new();

    expected.save_to_writer(&mut bytes).unwrap();
    let actual = DesignSpaceDocument::load_from_reader(Cursor::new(bytes)).unwrap();

    assert_eq!(actual, expected);
}

fn assert_referenced_ufos_exist(path: &Path, document: &DesignSpaceDocument) {
    let root = path.parent().unwrap();

    assert!(!document.sources.is_empty());
    for source in &document.sources {
        assert!(root.join(&source.filename).is_dir());
    }
}
