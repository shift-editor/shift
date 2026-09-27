//! Format-native APIs for authored font sources.
//!
//! The crate owns no editor model or persistence identity. Format modules expose
//! source and sink abstractions that work with native files, in-memory maps, and
//! browser-provided bytes without depending on Shift crates.

use std::io;
use std::path::{Component, Path};

pub use norad::DirEntry;
/// A host-owned tree of relative font-project files.
///
/// Implementations may read from native directories, immutable in-memory maps,
/// archives, or browser-provided files. Paths received by implementations are
/// normalized and relative to the source root.
pub use norad::FontSource as FileSource;

/// Designspace document reading, writing, and format-native values.
pub mod designspace {
    use std::io::Cursor;
    use std::path::Path;

    pub use norad::designspace::*;
    pub use norad::error::{DesignSpaceLoadError, DesignSpaceSaveError};

    use crate::FileSource;

    /// Loads a Designspace document from a host-owned project tree.
    ///
    /// `path` is relative to the [`FileSource`] root. Referenced UFO paths
    /// remain relative to the Designspace document and are not loaded eagerly.
    ///
    /// # Errors
    ///
    /// Returns [`DesignSpaceLoadError`] when the path is not normalized, the
    /// source cannot read it, or the XML is malformed.
    pub fn load_from_source(
        path: &Path,
        source: &dyn FileSource,
    ) -> Result<DesignSpaceDocument, DesignSpaceLoadError> {
        let bytes = crate::read_source_file(path, source).map_err(DesignSpaceLoadError::Io)?;
        DesignSpaceDocument::load_from_reader(Cursor::new(bytes))
    }
}

/// Glyphs source reading and format-native values.
pub mod glyphs {
    use std::io;

    pub use glyphs_reader::*;

    use crate::FileSource;

    /// Loads a Glyphs file or native Glyphs package from a host-owned project tree.
    ///
    /// Browser-owned `.glyphs` files are read directly from `source`. Until
    /// glyphs-reader exposes source-backed package parsing, `.glyphspackage`
    /// loading requires a filesystem-backed [`FileSource`].
    ///
    /// # Errors
    ///
    /// Returns [`error::Error`] when the path is not normalized, has an
    /// unsupported extension, cannot be read, is not UTF-8, or contains an
    /// invalid Glyphs source. In-memory `.glyphspackage` sources return an
    /// [`io::ErrorKind::Unsupported`] I/O error.
    pub fn load_from_source(
        path: &std::path::Path,
        source: &dyn FileSource,
    ) -> Result<Font, error::Error> {
        crate::validate_source_path(path)?;

        match path
            .extension()
            .and_then(|extension| extension.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref()
        {
            Some("glyphs") => load_file_from_source(path, source),
            Some("glyphspackage") => load_package_from_source(path, source),
            _ => Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("unsupported Glyphs source path {}", path.display()),
            )
            .into()),
        }
    }

    fn load_file_from_source(
        path: &std::path::Path,
        source: &dyn FileSource,
    ) -> Result<Font, error::Error> {
        let bytes = crate::read_source_file(path, source)?;
        let content = String::from_utf8(bytes)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        Font::load_from_string(&content)
    }

    fn load_package_from_source(
        path: &std::path::Path,
        source: &dyn FileSource,
    ) -> Result<Font, error::Error> {
        let root = source.as_path().ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::Unsupported,
                "glyphs-reader does not yet support source-backed Glyphs packages",
            )
        })?;
        Font::load(&root.join(path))
    }
}

/// Unified Font Object reading, writing, and format-native values.
pub mod ufo {
    pub use norad::error::{FontLoadError, FontWriteError};
    pub use norad::{DataRequest, DirEntry, Font, FontSink, FontSource, WriteOptions};
}

fn read_source_file(path: &Path, source: &dyn FileSource) -> io::Result<Vec<u8>> {
    validate_source_path(path)?;
    source.read(path)
}

fn validate_source_path(path: &Path) -> io::Result<()> {
    if path.as_os_str().is_empty()
        || path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir
                    | Component::CurDir
                    | Component::RootDir
                    | Component::Prefix(_)
            )
        })
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!(
                "source path must be normalized and relative: {}",
                path.display()
            ),
        ));
    }

    Ok(())
}
