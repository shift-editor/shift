use super::ShiftWorkingSource;
use crate::error::{ShiftSourceError, ShiftSourceResult};
use crate::package::{
    apply_staged_commit, compare_fingerprints, diff_packages, fingerprint_package,
    fingerprint_relative_paths, load_package, plan_staged_commit_recovery, prepare_package_commit,
    stage_prepared_commit, summarize_staged_commit_recovery, ShiftAppliedCommit,
    ShiftCommitOperation, ShiftFileFingerprint, ShiftFingerprintConflictKind,
    ShiftPackageFingerprint, ShiftPreparedCommit, ShiftStagedCommit, ShiftStagedCommitLiveState,
    ShiftStagedCommitRecoveryAction, ShiftStagedCommitRecoveryPlan,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftWorkingSourceSaveReport {
    pub status: ShiftWorkingSourceSaveStatus,
    pub summary: ShiftWorkingSourceSaveSummary,
    pub prepared: ShiftPreparedCommit,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub staged: Option<ShiftStagedCommit>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub applied: Option<ShiftAppliedCommit>,
    pub revision: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ShiftWorkingSourceSaveStatus {
    Unchanged,
    Saved,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftWorkingSourceSavePreview {
    pub status: ShiftWorkingSourceSavePreviewStatus,
    pub primary_action: ShiftWorkingSourceSavePrimaryAction,
    pub summary: ShiftWorkingSourceSaveSummary,
    pub prepared: ShiftPreparedCommit,
    pub staged_recovery_plans: Vec<ShiftStagedCommitRecoveryPlan>,
    pub revision: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ShiftWorkingSourceSavePreviewStatus {
    Unchanged,
    Ready,
    BlockedByExternalChanges,
    BlockedByStagedCommit,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ShiftWorkingSourceSavePrimaryAction {
    NothingToSave,
    Save,
    ResolveExternalChanges,
    ResolveStagedCommit,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftWorkingSourceSaveSummary {
    pub change_count: usize,
    pub impacted_path_count: usize,
    pub canonical_path_count: usize,
    pub removed_canonical_path_count: usize,
    pub derived_path_count: usize,
    pub conflict_count: usize,
    pub conflict_kind_counts: Vec<ShiftWorkingSourceSaveConflictKindCount>,
    pub conflict_path_class_counts: Vec<ShiftWorkingSourceSaveConflictPathClassCount>,
    pub staged_recovery_count: usize,
    pub staged_recovery_action_counts: Vec<ShiftWorkingSourceSaveStagedRecoveryActionCount>,
    pub staged_recovery_live_state_counts: Vec<ShiftWorkingSourceSaveStagedRecoveryLiveStateCount>,
    pub write_file_count: usize,
    pub remove_file_count: usize,
    pub invalidate_derived_count: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftWorkingSourceSaveConflictKindCount {
    pub kind: ShiftFingerprintConflictKind,
    pub conflict_count: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ShiftWorkingSourceSaveConflictPathClass {
    CanonicalSource,
    DerivedCache,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftWorkingSourceSaveConflictPathClassCount {
    pub path_class: ShiftWorkingSourceSaveConflictPathClass,
    pub conflict_count: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftWorkingSourceSaveStagedRecoveryActionCount {
    pub action: ShiftStagedCommitRecoveryAction,
    pub recovery_count: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftWorkingSourceSaveStagedRecoveryLiveStateCount {
    pub live_state: ShiftStagedCommitLiveState,
    pub recovery_count: usize,
}

impl ShiftWorkingSource {
    pub fn prepare_commit(&self, root: impl AsRef<Path>) -> ShiftSourceResult<ShiftPreparedCommit> {
        let diff = diff_packages(&self.saved_package, &self.package)?;
        let impacted_paths = diff.impact.package_relative_paths();

        if diff.changes.is_empty() {
            let (expected_fingerprint, current_fingerprint, conflicts) =
                if let Some(saved_fingerprint) = &self.saved_fingerprint {
                    let current_fingerprint = fingerprint_package(root.as_ref())?;
                    let conflicts = compare_fingerprints(saved_fingerprint, &current_fingerprint);
                    (saved_fingerprint.clone(), current_fingerprint, conflicts)
                } else {
                    (
                        ShiftPackageFingerprint::default(),
                        ShiftPackageFingerprint::default(),
                        Vec::new(),
                    )
                };

            return Ok(ShiftPreparedCommit {
                diff,
                impacted_paths,
                expected_fingerprint,
                current_fingerprint,
                conflicts,
                operations: Vec::new(),
            });
        }

        let expected_fingerprint = if let Some(saved_fingerprint) = &self.saved_fingerprint {
            fingerprint_subset(saved_fingerprint, &impacted_paths)
        } else {
            fingerprint_relative_paths(root.as_ref(), &impacted_paths)?
        };

        prepare_package_commit(
            root,
            &self.saved_package,
            &self.package,
            expected_fingerprint,
        )
    }

    pub fn preview_save(
        &self,
        root: impl AsRef<Path>,
    ) -> ShiftSourceResult<ShiftWorkingSourceSavePreview> {
        let root = root.as_ref();
        let staged_recovery_plans = plan_staged_commit_recovery(root)?;
        let prepared = self.prepare_commit(root)?;
        let status = if !staged_recovery_plans.is_empty() {
            ShiftWorkingSourceSavePreviewStatus::BlockedByStagedCommit
        } else if !prepared.conflicts.is_empty() {
            ShiftWorkingSourceSavePreviewStatus::BlockedByExternalChanges
        } else if prepared.diff.changes.is_empty() {
            ShiftWorkingSourceSavePreviewStatus::Unchanged
        } else {
            ShiftWorkingSourceSavePreviewStatus::Ready
        };
        let primary_action = match status {
            ShiftWorkingSourceSavePreviewStatus::Unchanged => {
                ShiftWorkingSourceSavePrimaryAction::NothingToSave
            }
            ShiftWorkingSourceSavePreviewStatus::Ready => ShiftWorkingSourceSavePrimaryAction::Save,
            ShiftWorkingSourceSavePreviewStatus::BlockedByExternalChanges => {
                ShiftWorkingSourceSavePrimaryAction::ResolveExternalChanges
            }
            ShiftWorkingSourceSavePreviewStatus::BlockedByStagedCommit => {
                ShiftWorkingSourceSavePrimaryAction::ResolveStagedCommit
            }
        };

        Ok(ShiftWorkingSourceSavePreview {
            status,
            primary_action,
            summary: save_summary(&prepared, &staged_recovery_plans),
            prepared,
            staged_recovery_plans,
            revision: self.revision,
        })
    }

    pub fn mark_saved(&mut self, root: impl AsRef<Path>) -> ShiftSourceResult<()> {
        let root = root.as_ref();
        let staged_recovery_plans = plan_staged_commit_recovery(root)?;
        if !staged_recovery_plans.is_empty() {
            return Err(ShiftSourceError::ActiveStagedCommits {
                transaction_count: staged_recovery_plans.len(),
            });
        }

        self.package.validate()?;
        let disk_package = load_package(root)?;
        let disk_diff = diff_packages(&disk_package, &self.package)?;
        if !disk_diff.changes.is_empty() {
            return Err(ShiftSourceError::SavedPackageMismatch {
                change_count: disk_diff.changes.len(),
            });
        }

        let saved_fingerprint = fingerprint_package(root)?;
        self.saved_package = self.package.clone();
        self.saved_fingerprint = Some(saved_fingerprint);
        self.revision = 0;
        Ok(())
    }

    pub fn save(
        &mut self,
        root: impl AsRef<Path>,
    ) -> ShiftSourceResult<ShiftWorkingSourceSaveReport> {
        let root = root.as_ref();
        let preview = self.preview_save(root)?;
        let prepared = preview.prepared;

        if preview.status == ShiftWorkingSourceSavePreviewStatus::BlockedByExternalChanges {
            return Err(ShiftSourceError::PreparedCommitHasConflicts {
                conflict_count: prepared.conflicts.len(),
            });
        }
        if preview.status == ShiftWorkingSourceSavePreviewStatus::BlockedByStagedCommit {
            return Err(ShiftSourceError::ActiveStagedCommits {
                transaction_count: preview.staged_recovery_plans.len(),
            });
        }

        if preview.status == ShiftWorkingSourceSavePreviewStatus::Unchanged {
            self.mark_saved(root)?;
            return Ok(ShiftWorkingSourceSaveReport {
                status: ShiftWorkingSourceSaveStatus::Unchanged,
                summary: save_summary(&prepared, &[]),
                prepared,
                staged: None,
                applied: None,
                revision: self.revision,
            });
        }

        let staged = stage_prepared_commit(root, &self.package, &prepared)?;
        let applied = apply_staged_commit(root, &staged.transaction_id)?;
        self.mark_saved(root)?;

        Ok(ShiftWorkingSourceSaveReport {
            status: ShiftWorkingSourceSaveStatus::Saved,
            summary: save_summary(&prepared, &[]),
            prepared,
            staged: Some(staged),
            applied: Some(applied),
            revision: self.revision,
        })
    }
}

fn fingerprint_subset(
    fingerprint: &ShiftPackageFingerprint,
    paths: &[String],
) -> ShiftPackageFingerprint {
    ShiftPackageFingerprint {
        files: paths
            .iter()
            .map(|path| {
                (
                    path.clone(),
                    fingerprint
                        .files
                        .get(path)
                        .cloned()
                        .unwrap_or(ShiftFileFingerprint {
                            exists: false,
                            size: None,
                            hash: None,
                        }),
                )
            })
            .collect(),
    }
}

fn save_summary(
    prepared: &ShiftPreparedCommit,
    staged_recovery_plans: &[ShiftStagedCommitRecoveryPlan],
) -> ShiftWorkingSourceSaveSummary {
    let mut conflict_kind_counts = BTreeMap::<ShiftFingerprintConflictKind, usize>::new();
    let mut conflict_path_class_counts =
        BTreeMap::<ShiftWorkingSourceSaveConflictPathClass, usize>::new();
    for conflict in &prepared.conflicts {
        *conflict_kind_counts.entry(conflict.kind).or_default() += 1;
        *conflict_path_class_counts
            .entry(save_conflict_path_class(&conflict.path))
            .or_default() += 1;
    }
    let staged_recovery_summary = summarize_staged_commit_recovery(staged_recovery_plans);

    let mut summary = ShiftWorkingSourceSaveSummary {
        change_count: prepared.diff.changes.len(),
        impacted_path_count: prepared.impacted_paths.len(),
        canonical_path_count: prepared.diff.impact.canonical_paths.len(),
        removed_canonical_path_count: prepared.diff.impact.removed_canonical_paths.len(),
        derived_path_count: prepared.diff.impact.derived_paths.len(),
        conflict_count: prepared.conflicts.len(),
        conflict_kind_counts: conflict_kind_counts
            .into_iter()
            .map(
                |(kind, conflict_count)| ShiftWorkingSourceSaveConflictKindCount {
                    kind,
                    conflict_count,
                },
            )
            .collect(),
        conflict_path_class_counts: conflict_path_class_counts
            .into_iter()
            .map(
                |(path_class, conflict_count)| ShiftWorkingSourceSaveConflictPathClassCount {
                    path_class,
                    conflict_count,
                },
            )
            .collect(),
        staged_recovery_count: staged_recovery_summary.staged_recovery_count,
        staged_recovery_action_counts: staged_recovery_summary
            .action_counts
            .into_iter()
            .map(|count| ShiftWorkingSourceSaveStagedRecoveryActionCount {
                action: count.action,
                recovery_count: count.recovery_count,
            })
            .collect(),
        staged_recovery_live_state_counts: staged_recovery_summary
            .live_state_counts
            .into_iter()
            .map(|count| ShiftWorkingSourceSaveStagedRecoveryLiveStateCount {
                live_state: count.live_state,
                recovery_count: count.recovery_count,
            })
            .collect(),
        ..Default::default()
    };

    for operation in &prepared.operations {
        match operation {
            ShiftCommitOperation::WriteFile { .. } => summary.write_file_count += 1,
            ShiftCommitOperation::RemoveFile { .. } => summary.remove_file_count += 1,
            ShiftCommitOperation::InvalidateDerived { .. } => {
                summary.invalidate_derived_count += 1;
            }
        }
    }

    summary
}

fn save_conflict_path_class(path: &str) -> ShiftWorkingSourceSaveConflictPathClass {
    if path.starts_with("derived/") {
        ShiftWorkingSourceSaveConflictPathClass::DerivedCache
    } else {
        ShiftWorkingSourceSaveConflictPathClass::CanonicalSource
    }
}
