//! Lazily loaded workspaces over real fixture fonts.

use std::path::{Path, PathBuf};

use shift_workspace::FontWorkspace;
use tempfile::TempDir;

pub fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

pub fn fixture(name: &str) -> PathBuf {
    repo_root().join("fixtures/fonts").join(name)
}

/// A `.shift` document imported from `source`, so workspaces opened from it
/// start with a lazy directory (no layer payloads resident).
pub struct Document {
    _dir: TempDir,
    pub path: PathBuf,
}

impl Document {
    pub fn import(source: &Path) -> Self {
        let dir = TempDir::new().unwrap();
        let mut workspace = FontWorkspace::open(source, dir.path().join("import.sqlite")).unwrap();
        let path = dir.path().join("font.shift");
        workspace
            .save_as_document(&path, dir.path().join("import-recovery.sqlite"))
            .unwrap();
        drop(workspace);
        Self { _dir: dir, path }
    }

    /// A fresh workspace over a private copy of the document.
    pub fn open(&self) -> (TempDir, FontWorkspace) {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("copy.shift");
        std::fs::copy(&self.path, &path).unwrap();
        let workspace =
            FontWorkspace::open_document(&path, dir.path().join("recovery.sqlite")).unwrap();
        (dir, workspace)
    }
}
