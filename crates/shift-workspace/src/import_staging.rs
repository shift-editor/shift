use std::{
    ffi::OsString,
    io,
    path::{Path, PathBuf},
};

use tempfile::TempPath;

pub(crate) fn create_import_staging_path(destination: &Path) -> io::Result<TempPath> {
    let parent = match destination.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent,
        _ => Path::new("."),
    };
    let staged = tempfile::Builder::new()
        .prefix(".shift-import-")
        .suffix(".sqlite")
        .tempfile_in(parent)?;
    Ok(staged.into_temp_path())
}

pub(crate) fn install_import_store(staged: TempPath, destination: &Path) -> io::Result<()> {
    remove_staging_sidecars(&staged)?;
    staged.persist(destination).map_err(|error| error.error)?;
    sync_parent_directory(destination)
}

fn remove_staging_sidecars(staged: &Path) -> io::Result<()> {
    for suffix in ["-wal", "-shm"] {
        match std::fs::remove_file(sqlite_sidecar_path(staged, suffix)) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

fn sqlite_sidecar_path(path: &Path, suffix: &str) -> PathBuf {
    let mut sidecar = OsString::from(path.as_os_str());
    sidecar.push(suffix);
    PathBuf::from(sidecar)
}

#[cfg(unix)]
pub(crate) fn sync_parent_directory(path: &Path) -> io::Result<()> {
    if let Some(parent) = path.parent()
        && !parent.as_os_str().is_empty()
    {
        std::fs::File::open(parent)?.sync_all()?;
    }
    Ok(())
}

#[cfg(not(unix))]
pub(crate) fn sync_parent_directory(_path: &Path) -> io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn staged_install_replaces_destination_and_cleans_staging_file() {
        let temp = tempfile::tempdir().unwrap();
        let destination = temp.path().join("working.sqlite");
        std::fs::write(&destination, b"old").unwrap();
        let staged = create_import_staging_path(&destination).unwrap();
        let staged_path = staged.to_path_buf();
        let staged_wal_path = sqlite_sidecar_path(&staged_path, "-wal");
        let staged_shm_path = sqlite_sidecar_path(&staged_path, "-shm");
        std::fs::write(&staged_path, b"new").unwrap();
        std::fs::write(&staged_wal_path, b"").unwrap();
        std::fs::write(&staged_shm_path, b"").unwrap();

        install_import_store(staged, &destination).unwrap();

        assert_eq!(std::fs::read(&destination).unwrap(), b"new");
        assert!(!staged_path.exists());
        assert!(!staged_wal_path.exists());
        assert!(!staged_shm_path.exists());
    }
}
