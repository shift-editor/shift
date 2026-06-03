use std::{
    fs, io,
    path::{Path, PathBuf},
};

pub const MANIFEST_FILE: &str = "manifest.json";

const EMPTY_MANIFEST: &str = r#"{
  "format": "shift-source",
  "version": 1
}
"#;

#[derive(Debug, thiserror::Error)]
pub enum SourcePackageError {
    #[error("source package path must use the .shift extension: {0}")]
    InvalidExtension(PathBuf),

    #[error("source package does not exist: {0}")]
    MissingPackage(PathBuf),

    #[error("source package manifest does not exist: {0}")]
    MissingManifest(PathBuf),

    #[error("source package already exists: {0}")]
    AlreadyExists(PathBuf),

    #[error("source package file-system error")]
    Io(#[from] io::Error),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ShiftSourcePackage {
    path: PathBuf,
}

impl ShiftSourcePackage {
    pub fn create_empty(path: impl AsRef<Path>) -> Result<Self, SourcePackageError> {
        let path = path.as_ref();
        validate_shift_extension(path)?;

        if path.exists() {
            return Err(SourcePackageError::AlreadyExists(path.to_path_buf()));
        }

        fs::create_dir_all(path)?;
        fs::write(path.join(MANIFEST_FILE), EMPTY_MANIFEST)?;

        Ok(Self {
            path: path.to_path_buf(),
        })
    }

    pub fn open(path: impl AsRef<Path>) -> Result<Self, SourcePackageError> {
        let path = path.as_ref();
        validate_shift_extension(path)?;

        if !path.is_dir() {
            return Err(SourcePackageError::MissingPackage(path.to_path_buf()));
        }

        let manifest_path = path.join(MANIFEST_FILE);
        if !manifest_path.is_file() {
            return Err(SourcePackageError::MissingManifest(manifest_path));
        }

        Ok(Self {
            path: path.to_path_buf(),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn manifest_path(&self) -> PathBuf {
        self.path.join(MANIFEST_FILE)
    }
}

fn validate_shift_extension(path: &Path) -> Result<(), SourcePackageError> {
    if path.extension().and_then(|extension| extension.to_str()) == Some("shift") {
        Ok(())
    } else {
        Err(SourcePackageError::InvalidExtension(path.to_path_buf()))
    }
}
