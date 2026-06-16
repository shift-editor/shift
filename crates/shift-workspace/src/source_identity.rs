use std::{
    fs::{self, File},
    io::{self, Read},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use shift_store::{
    Evidence, FileIdentity, ShiftStore, SourceIdentitySnapshot, WorkspaceSourceKind,
};

use crate::WorkspaceError;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub enum SourceMatchKind {
    PossiblePackageMove,
    SamePath,
    SamePathAndFingerprint,
    SameFileMoved,
    SamePathAndFile,
}

impl SourceMatchKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::SamePathAndFile => "samePathAndFile",
            Self::SamePathAndFingerprint => "samePathAndFingerprint",
            Self::SameFileMoved => "sameFileMoved",
            Self::SamePath => "samePath",
            Self::PossiblePackageMove => "possiblePackageMove",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkspaceRecoveryCandidate {
    pub document_id: String,
    pub store_path: PathBuf,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkspaceRecoveryMatch {
    pub document_id: String,
    pub store_path: PathBuf,
    pub match_kind: SourceMatchKind,
    pub dirty: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RecoverySelection {
    None,
    One(WorkspaceRecoveryMatch),
    Ambiguous(Vec<WorkspaceRecoveryMatch>),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
struct RecoveryRank {
    dirty: bool,
    match_kind: SourceMatchKind,
}

impl RecoveryRank {
    fn new(recovery_match: &WorkspaceRecoveryMatch) -> Self {
        Self {
            dirty: recovery_match.dirty,
            match_kind: recovery_match.match_kind,
        }
    }
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

    Ok(SourceIdentitySnapshot {
        source_path: Some(path.to_path_buf()),
        canonical_source_path,
        source_package_id: None,
        source_file_identity,
        source_size,
        source_mtime_ms,
        source_fingerprint,
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

pub(crate) fn select_recoverable_package_workspace(
    source_path: impl AsRef<Path>,
    candidates: &[WorkspaceRecoveryCandidate],
) -> Result<RecoverySelection, WorkspaceError> {
    let requested = source_identity_snapshot(source_path)?;
    let mut best_rank: Option<RecoveryRank> = None;
    let mut best_matches: Vec<WorkspaceRecoveryMatch> = Vec::new();

    for candidate in candidates {
        let Ok(store) = ShiftStore::open(&candidate.store_path) else {
            // Retained draft directories are a recovery cache. A corrupt or
            // temporarily locked DB must not block opening the requested source.
            continue;
        };
        let Ok(Some(state)) = store.workspace_state() else {
            // Older or broken draft DBs may not carry workspace metadata yet.
            // Ignore them here; explicit recovery UI can surface them later.
            continue;
        };
        if state.source_kind != WorkspaceSourceKind::Package {
            // Untitled/imported drafts are recoverable, but not by opening a
            // package source path. Keep this selector package-only.
            continue;
        }
        if !state.dirty && state.source_identity().fingerprint_changed_from(&requested) {
            // A clean DB is just a cache of the source package. If the package
            // changed on disk, hydrate fresh from the package instead.
            continue;
        }
        let Some(match_kind) = classify_source_match(&state.source_identity(), &requested) else {
            continue;
        };

        let candidate_match = WorkspaceRecoveryMatch {
            document_id: candidate.document_id.clone(),
            store_path: candidate.store_path.clone(),
            match_kind,
            dirty: state.dirty,
        };
        keep_best_recovery_match(candidate_match, &mut best_rank, &mut best_matches);
    }

    Ok(match best_matches.len() {
        0 => RecoverySelection::None,
        1 => RecoverySelection::One(best_matches.remove(0)),
        _ => RecoverySelection::Ambiguous(best_matches),
    })
}

fn keep_best_recovery_match(
    candidate: WorkspaceRecoveryMatch,
    best_rank: &mut Option<RecoveryRank>,
    best_matches: &mut Vec<WorkspaceRecoveryMatch>,
) {
    let candidate_rank = RecoveryRank::new(&candidate);
    match best_rank {
        None => {
            *best_rank = Some(candidate_rank);
            best_matches.push(candidate);
        }
        Some(current_rank) if candidate_rank > *current_rank => {
            *best_rank = Some(candidate_rank);
            best_matches.clear();
            best_matches.push(candidate);
        }
        Some(current_rank) if candidate_rank == *current_rank => {
            best_matches.push(candidate);
        }
        Some(_) => {}
    }
}

fn classify_source_match(
    stored: &SourceIdentitySnapshot,
    requested: &SourceIdentitySnapshot,
) -> Option<SourceMatchKind> {
    let same_path = stored.same_path_as(requested);
    let file_identity = stored.file_identity_match(requested);
    let fingerprint = stored.fingerprint_match(requested);
    let package_id = stored.package_id_match(requested);

    match (same_path, file_identity, fingerprint, package_id) {
        (true, Evidence::Same, _, _) => Some(SourceMatchKind::SamePathAndFile),
        (_, Evidence::Same, _, _) => Some(SourceMatchKind::SameFileMoved),
        (true, _, Evidence::Same, _) => Some(SourceMatchKind::SamePathAndFingerprint),
        (true, Evidence::Unknown, Evidence::Unknown, _) => Some(SourceMatchKind::SamePath),
        (_, _, Evidence::Same, _) | (_, _, _, Evidence::Same) if stored.source_path_missing() => {
            Some(SourceMatchKind::PossiblePackageMove)
        }
        _ => None,
    }
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
