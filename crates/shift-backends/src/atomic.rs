//! Crash-safe filesystem writes shared by the format backends.

use std::io::Write;
use std::path::Path;

/// Fsyncs the parent directory so a rename into it is durable.
#[cfg(unix)]
pub(crate) fn sync_parent(path: &Path) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::File::open(parent)?.sync_all()?;
        }
    }
    Ok(())
}

// Windows cannot open directory handles this way; NTFS journals metadata itself.
#[cfg(not(unix))]
pub(crate) fn sync_parent(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

/// Writes `bytes` to `path` without ever exposing a partial file: the
/// content is staged in a temp file in the same directory, fsynced, renamed
/// over the target, and the parent directory is fsynced so the rename
/// itself is durable. If any step fails, the existing file is untouched.
pub(crate) fn write_file_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let parent = match path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent,
        _ => Path::new("."),
    };

    let mut staged = tempfile::Builder::new()
        .prefix(".shift-staged-")
        .tempfile_in(parent)?;
    staged.write_all(bytes)?;
    staged.as_file().sync_all()?;
    staged.persist(path).map_err(|error| error.error)?;

    sync_parent(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_existing_file_content() {
        let temp = tempfile::tempdir().unwrap();
        let target = temp.path().join("file.xml");

        write_file_atomic(&target, b"first").unwrap();
        write_file_atomic(&target, b"second").unwrap();

        assert_eq!(std::fs::read(&target).unwrap(), b"second");
        let entries: Vec<_> = std::fs::read_dir(temp.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(entries, vec!["file.xml"], "no staging leftovers");
    }

    #[cfg(unix)]
    #[test]
    fn failed_write_leaves_existing_file_intact() {
        use std::os::unix::fs::PermissionsExt;

        let temp = tempfile::tempdir().unwrap();
        let target = temp.path().join("file.xml");
        std::fs::write(&target, b"original").unwrap();

        // A read-only directory makes staging the temp file fail before the
        // target is ever touched.
        std::fs::set_permissions(temp.path(), std::fs::Permissions::from_mode(0o555)).unwrap();
        let result = write_file_atomic(&target, b"replacement");
        std::fs::set_permissions(temp.path(), std::fs::Permissions::from_mode(0o755)).unwrap();

        result.expect_err("write into a read-only directory should fail");
        assert_eq!(std::fs::read(&target).unwrap(), b"original");
    }
}
