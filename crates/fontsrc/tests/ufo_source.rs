mod support;

use std::collections::HashMap;
use std::io;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use fontsrc::ufo::{DataRequest, Font, FontSink, WriteOptions};
use support::MemorySource;

#[derive(Default)]
struct MemorySink(Mutex<HashMap<PathBuf, Vec<u8>>>);

impl MemorySink {
    fn into_files(self) -> HashMap<PathBuf, Vec<u8>> {
        self.0.into_inner().unwrap()
    }

    fn into_source(self) -> MemorySource {
        MemorySource::from_files(self.into_files())
    }
}

impl FontSink for MemorySink {
    fn write(&self, path: &Path, data: &[u8]) -> Result<(), io::Error> {
        self.0.lock().unwrap().insert(path.into(), data.into());
        Ok(())
    }
}

fn fixture(path: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("fixtures/fonts")
        .join(path)
}

fn fixtures() -> Vec<PathBuf> {
    [
        "mutatorsans/MutatorSansLightCondensed.ufo",
        "mutatorsans-variable/MutatorSansBoldCondensed.ufo",
        "mutatorsans-variable/MutatorSansBoldWide.ufo",
        "mutatorsans-variable/MutatorSansLightCondensed.ufo",
        "mutatorsans-variable/MutatorSansLightWide.ufo",
    ]
    .into_iter()
    .map(fixture)
    .collect()
}

#[test]
fn in_memory_sources_match_native_directories() {
    for path in fixtures() {
        let expected = Font::load(&path).unwrap();
        let source = MemorySource::read(&path).unwrap();

        let actual = Font::load_from_source(&DataRequest::all(), &source).unwrap();

        assert_eq!(actual, expected, "source mismatch for {}", path.display());
    }
}

#[test]
fn in_memory_sinks_round_trip_complete_fonts() {
    for path in fixtures() {
        let mut expected = Font::load(&path).unwrap();
        let sink = MemorySink::default();

        expected
            .save_to_sink(&sink, &WriteOptions::default())
            .unwrap();
        let actual = Font::load_from_source(&DataRequest::all(), &sink.into_source()).unwrap();

        expected.meta.creator = actual.meta.creator.clone();
        assert_eq!(actual, expected, "sink mismatch for {}", path.display());
    }
}

#[test]
fn sink_preserves_binary_stores_with_normalized_paths() {
    let mut expected = Font::load(fixture(
        "mutatorsans-variable/MutatorSansLightCondensed.ufo",
    ))
    .unwrap();
    expected
        .data
        .insert(PathBuf::from("com.shift/source.bin"), vec![0, 1, 2, 255])
        .unwrap();
    expected
        .images
        .insert(
            PathBuf::from("preview.png"),
            vec![137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3],
        )
        .unwrap();
    let sink = MemorySink::default();

    expected
        .save_to_sink(&sink, &WriteOptions::default())
        .unwrap();
    let files = sink.into_files();

    assert!(files.keys().all(|path| {
        !path.is_absolute()
            && !path
                .components()
                .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
    }));
    let source = MemorySource::from_files(files);
    let actual = Font::load_from_source(&DataRequest::all(), &source).unwrap();
    assert_eq!(
        actual
            .data
            .get(Path::new("com.shift/source.bin"))
            .unwrap()
            .unwrap()
            .as_ref(),
        [0, 1, 2, 255]
    );
    assert_eq!(
        actual
            .images
            .get(Path::new("preview.png"))
            .unwrap()
            .unwrap()
            .as_ref(),
        [137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]
    );
}

#[test]
fn malformed_in_memory_source_returns_an_error() {
    let path = fixture("mutatorsans/MutatorSansLightCondensed.ufo");
    let mut files = MemorySource::read_files(&path).unwrap();
    files.insert(PathBuf::from("metainfo.plist"), b"not a plist".to_vec());
    let source = MemorySource::from_files(files);

    let result = Font::load_from_source(&DataRequest::all(), &source);

    assert!(result.is_err());
}
