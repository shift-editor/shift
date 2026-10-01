use std::collections::{BTreeSet, HashMap};
use std::io;
use std::path::{Path, PathBuf};

use fontsrc::ufo::{DirEntry, FontSource};

pub struct MemorySource {
    files: HashMap<PathBuf, Vec<u8>>,
    directories: HashMap<PathBuf, Vec<DirEntry>>,
}

impl MemorySource {
    pub fn read(root: &Path) -> io::Result<Self> {
        Ok(Self::from_files(Self::read_files(root)?))
    }

    pub fn read_files(root: &Path) -> io::Result<HashMap<PathBuf, Vec<u8>>> {
        let mut files = HashMap::new();
        Self::read_directory(root, Path::new(""), &mut files)?;
        Ok(files)
    }

    pub fn from_files(files: HashMap<PathBuf, Vec<u8>>) -> Self {
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
