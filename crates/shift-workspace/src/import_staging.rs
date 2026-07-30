use std::{io, path::Path};

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
    staged.persist(destination).map_err(|error| error.error)?;
    sync_parent_directory(destination)
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
        std::fs::write(&staged_path, b"new").unwrap();

        install_import_store(staged, &destination).unwrap();

        assert_eq!(std::fs::read(&destination).unwrap(), b"new");
        assert!(!staged_path.exists());
    }
}
