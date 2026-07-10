use std::{
    fs::{self, File},
    io::{self, Read},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use shift_source::ShiftSourcePackage;
use shift_store::{FileIdentity, SourceIdentitySnapshot};

use crate::WorkspaceError;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PackageIdentity {
    pub package_id: String,
    pub canonical_path: PathBuf,
    pub fingerprint: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PackageDraft {
    pub document_id: Option<String>,
    pub package_id: String,
    pub source_path: PathBuf,
    pub base_fingerprint: String,
    pub dirty: bool,
}

pub(crate) fn source_identity_snapshot(
    path: impl AsRef<Path>,
) -> Result<SourceIdentitySnapshot, WorkspaceError> {
    let path = path.as_ref();
    let metadata = fs::metadata(path).map_err(|err| {
        if err.kind() == io::ErrorKind::NotFound {
            WorkspaceError::SourceMissing(path.to_path_buf())
        } else {
            WorkspaceError::Io(err)
        }
    })?;
    let canonical_source_path = fs::canonicalize(path).ok();
    let source_file_identity = file_identity(path, &metadata)?;
    let source_size = Some(metadata.len());
    let source_mtime_ms = metadata.modified().ok().map(system_time_ms);
    let source_fingerprint = Some(file_fingerprint(path)?);
    let source_package_id = Some(ShiftSourcePackage::open(path)?.package_id().to_string());

    Ok(SourceIdentitySnapshot {
        source_path: Some(path.to_path_buf()),
        canonical_source_path,
        source_package_id,
        source_file_identity,
        source_size,
        source_mtime_ms,
        source_fingerprint,
    })
}

pub(crate) fn package_identity(path: impl AsRef<Path>) -> Result<PackageIdentity, WorkspaceError> {
    let snapshot = source_identity_snapshot(path)?;
    let package_id = snapshot.source_package_id.ok_or_else(|| {
        WorkspaceError::CorruptWorkingStore("package identity missing package ID".into())
    })?;
    let canonical_path = snapshot.canonical_source_path.ok_or_else(|| {
        WorkspaceError::CorruptWorkingStore("package identity missing canonical path".into())
    })?;
    let fingerprint = snapshot.source_fingerprint.ok_or_else(|| {
        WorkspaceError::CorruptWorkingStore("package identity missing fingerprint".into())
    })?;

    Ok(PackageIdentity {
        package_id,
        canonical_path,
        fingerprint,
    })
}

pub(crate) fn validate_source_identity_for_save(
    expected: &SourceIdentitySnapshot,
    current: &SourceIdentitySnapshot,
    path: &Path,
) -> Result<(), WorkspaceError> {
    if expected.file_identity_match(current).is_different()
        || expected.canonical_path_match(current).is_different()
    {
        return Err(WorkspaceError::SourceIdentityConflict(path.to_path_buf()));
    }

    if expected.fingerprint_changed_from(current) {
        return Err(WorkspaceError::SourceExternallyModified(path.to_path_buf()));
    }

    Ok(())
}

fn file_fingerprint(path: &Path) -> Result<String, WorkspaceError> {
    let mut file = File::open(path)?;
    let mut buffer = [0u8; 8192];
    let mut hash = 0xcbf29ce484222325u64;

    loop {
        let bytes_read = file.read(&mut buffer)?;
        if bytes_read == 0 {
            break;
        }
        for byte in &buffer[..bytes_read] {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x100000001b3);
        }
    }

    Ok(format!("fnv1a64:{hash:016x}"))
}

#[cfg(unix)]
fn file_identity(
    _path: &Path,
    metadata: &fs::Metadata,
) -> Result<Option<FileIdentity>, WorkspaceError> {
    use std::os::unix::fs::MetadataExt;

    Ok(Some(FileIdentity {
        kind: "unix-dev-inode".to_string(),
        value: format!("{}:{}", metadata.dev(), metadata.ino()),
    }))
}

#[cfg(windows)]
fn file_identity(
    path: &Path,
    _metadata: &fs::Metadata,
) -> Result<Option<FileIdentity>, WorkspaceError> {
    use std::{os::windows::ffi::OsStrExt, ptr};
    use windows_sys::Win32::{
        Foundation::{CloseHandle, INVALID_HANDLE_VALUE},
        Storage::FileSystem::{
            BY_HANDLE_FILE_INFORMATION, CreateFileW, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_DELETE,
            FILE_SHARE_READ, FILE_SHARE_WRITE, GetFileInformationByHandle, OPEN_EXISTING,
        },
    };

    let wide_path = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();

    let handle = unsafe {
        CreateFileW(
            wide_path.as_ptr(),
            0,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            ptr::null(),
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(WorkspaceError::Io(io::Error::last_os_error()));
    }

    let mut info = std::mem::MaybeUninit::<BY_HANDLE_FILE_INFORMATION>::zeroed();
    let succeeded = unsafe { GetFileInformationByHandle(handle, info.as_mut_ptr()) };
    let close_result = unsafe { CloseHandle(handle) };
    if succeeded == 0 {
        return Err(WorkspaceError::Io(io::Error::last_os_error()));
    }
    if close_result == 0 {
        return Err(WorkspaceError::Io(io::Error::last_os_error()));
    }

    let info = unsafe { info.assume_init() };
    let file_index = (u64::from(info.nFileIndexHigh) << 32) | u64::from(info.nFileIndexLow);
    Ok(Some(FileIdentity {
        kind: "windows-volume-file-index".to_string(),
        value: format!("{}:{file_index}", info.dwVolumeSerialNumber),
    }))
}

#[cfg(not(any(unix, windows)))]
fn file_identity(
    _path: &Path,
    _metadata: &fs::Metadata,
) -> Result<Option<FileIdentity>, WorkspaceError> {
    Ok(None)
}

fn system_time_ms(time: SystemTime) -> i64 {
    match time.duration_since(UNIX_EPOCH) {
        Ok(duration) => i64::try_from(duration.as_millis()).unwrap_or(i64::MAX),
        Err(_) => 0,
    }
}
