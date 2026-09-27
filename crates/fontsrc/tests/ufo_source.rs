use std::collections::{BTreeSet, HashMap};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use fontsrc::ufo::{DataRequest, DirEntry, Font, FontSink, FontSource, WriteOptions};

struct MemorySource {
    files: HashMap<PathBuf, Vec<u8>>,
    directories: HashMap<PathBuf, Vec<DirEntry>>,
}

impl MemorySource {
    fn read(root: &Path) -> io::Result<Self> {
        let mut files = HashMap::new();
        Self::read_directory(root, Path::new(""), &mut files)?;
        Ok(Self::from_files(files))
    }

    fn from_files(files: HashMap<PathBuf, Vec<u8>>) -> Self {
        let mut directories = HashMap::<PathBuf, BTreeSet<DirEntry>>::new();
        for path in files.keys() {
            let parent = path.parent().unwrap_or_else(|| Path::new(""));
            let name = path.file_name().expect("file path should have a name");
            directories
                .entry(parent.to_path_buf())
                .or_default()
                .insert(DirEntry::File(name.into()));

            let mut directory = parent;
            while !directory.as_os_str().is_empty() {
                let parent = directory.parent().unwrap_or_else(|| Path::new(""));
                let name = directory
                    .file_name()
                    .expect("directory path should have a name");
                directories
                    .entry(parent.to_path_buf())
                    .or_default()
                    .insert(DirEntry::Dir(name.into()));
                directory = parent;
            }
        }

        Self {
            files,
            directories: directories
                .into_iter()
                .map(|(path, entries)| (path, entries.into_iter().collect()))
                .collect(),
        }
    }

    fn read_directory(
        root: &Path,
        relative: &Path,
        files: &mut HashMap<PathBuf, Vec<u8>>,
    ) -> io::Result<()> {
        for entry in std::fs::read_dir(root.join(relative))? {
            let entry = entry?;
            let path = relative.join(entry.file_name());
            if entry.file_type()?.is_dir() {
                Self::read_directory(root, &path, files)?;
            } else {
                files.insert(path, std::fs::read(entry.path())?);
            }
        }
        Ok(())
    }
}

impl FontSource for MemorySource {
    fn try_read(&self, path: &Path) -> Option<Result<Vec<u8>, io::Error>> {
        self.files.get(path).cloned().map(Ok)
    }

    fn list_dir(&self, path: &Path) -> Result<Vec<DirEntry>, io::Error> {
        self.directories
            .get(path)
            .cloned()
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, path.display().to_string()))
    }
}

#[derive(Default)]
struct MemorySink(Mutex<HashMap<PathBuf, Vec<u8>>>);

impl MemorySink {
    fn into_source(self) -> MemorySource {
        MemorySource::from_files(self.0.into_inner().unwrap())
    }
}

impl FontSink for MemorySink {
    fn write(&self, path: &Path, data: &[u8]) -> Result<(), io::Error> {
        self.0.lock().unwrap().insert(path.into(), data.into());
        Ok(())
    }
}

fn fixture() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("fixtures/fonts/mutatorsans/MutatorSansLightCondensed.ufo")
}

#[test]
fn in_memory_source_matches_native_directory() {
    let path = fixture();
    let expected = Font::load(&path).unwrap();
    let source = MemorySource::read(&path).unwrap();

    let actual = Font::load_from_source(&DataRequest::all(), &source).unwrap();

    assert_eq!(actual, expected);
}

#[test]
fn in_memory_sink_round_trips_complete_font() {
    let mut expected = Font::load(fixture()).unwrap();
    let sink = MemorySink::default();

    expected
        .save_to_sink(&sink, &WriteOptions::default())
        .unwrap();
    let actual = Font::load_from_source(&DataRequest::all(), &sink.into_source()).unwrap();

    expected.meta.creator = actual.meta.creator.clone();
    assert_eq!(actual, expected);
}
