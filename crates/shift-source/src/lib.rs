mod error;
mod ids;
mod package;
mod working_source;

#[cfg(test)]
mod tests;

pub use error::{ShiftSourceError, ShiftSourceResult};
pub use ids::{axis_id_for_tag, glyph_id_for_name, source_id_for_name};
pub use package::{
    apply_staged_commit, build_dependency_index, build_interpolation_compatibility_index,
    cleanup_applied_staged_commit, compare_fingerprints, diff_packages, fingerprint_package,
    fingerprint_relative_paths, inspect_staged_commits, load_font, load_package,
    plan_staged_commit_recovery, plan_write_impact, prepare_package_commit, recover_staged_commits,
    save_font, save_package, stage_prepared_commit, ShiftAppliedCommit, ShiftAxis,
    ShiftAxisInheritance, ShiftAxisMapping, ShiftAxisMappingSample, ShiftAxisRole,
    ShiftCommitOperation, ShiftCommitOperationPurpose, ShiftComponent,
    ShiftComponentCompatibilitySignature, ShiftComponentUse, ShiftComponentVariationSource,
    ShiftCondition, ShiftContour, ShiftDependencyIndex, ShiftFileFingerprint,
    ShiftFingerprintConflict, ShiftFingerprintConflictKind, ShiftFontInfo, ShiftGlyph,
    ShiftGlyphAxis, ShiftGlyphDependencies, ShiftGlyphInterpolationCompatibility, ShiftGlyphLayer,
    ShiftGlyphSource, ShiftInterpolationCompatibilityIndex, ShiftInterpolationCompatibilityIssue,
    ShiftInterpolationCompatibilityIssueKind, ShiftLayerCompatibilitySignature, ShiftManifest,
    ShiftPackage, ShiftPackageChange, ShiftPackageDiff, ShiftPackageFingerprint, ShiftPoint,
    ShiftPointType, ShiftPreparedCommit, ShiftSource, ShiftStagedCommit, ShiftStagedCommitIssue,
    ShiftStagedCommitIssueKind, ShiftStagedCommitLiveState, ShiftStagedCommitRecovery,
    ShiftStagedCommitRecoveryAction, ShiftStagedCommitRecoveryOutcome,
    ShiftStagedCommitRecoveryPlan, ShiftStagedCommitRecoveryRun, ShiftStagedPathRecovery,
    ShiftWriteImpact, DEPENDENCY_INDEX_PATH, INTERPOLATION_COMPATIBILITY_INDEX_PATH,
    SHIFT_INTERPOLATION_COMPATIBILITY_INDEX_VERSION,
};
pub use working_source::{
    ShiftAxisMappingDiagnostic, ShiftAxisMappingDiagnosticKind, ShiftAxisMappingUpdate,
    ShiftComponentActivity, ShiftComponentLoweringCapability,
    ShiftComponentLoweringCapabilityCount, ShiftComponentLoweringDiagnostic,
    ShiftComponentLoweringHint, ShiftComponentLoweringPreflight, ShiftComponentLoweringTarget,
    ShiftComponentRecipeKind, ShiftComponentRecipeSummary, ShiftComponentResolveContext,
    ShiftComponentResolvedLocation, ShiftComponentResolvedState,
    ShiftComponentResolvedVariationSource, ShiftComponentVariationParentAxisValue,
    ShiftComponentVariationParentAxisValueSource, ShiftComponentVariationResolution,
    ShiftComponentVariationSourceLocation, ShiftComponentVariationSourceUpdate,
    ShiftComponentVariationTransformSource, ShiftComponentVariationUnsupportedReason,
    ShiftConditionEvaluation, ShiftCreateAxisMapping, ShiftCreateAxisMappingReport,
    ShiftCreateComponentVariationSource, ShiftCreateComponentVariationSourceReport,
    ShiftCreateGlyph, ShiftCreateGlyphReport, ShiftCreateGlyphSourceLayer,
    ShiftCreateGlyphSourceLayerReport, ShiftCreateGlyphVariationSource,
    ShiftCreateGlyphVariationSourceReport, ShiftCreateSource, ShiftCreateSourceReport,
    ShiftDeleteAxisMappingReport, ShiftDeleteComponentVariationSourceReport,
    ShiftDeleteGlyphAndRelinkComponentsPreview, ShiftDeleteGlyphAndRelinkComponentsReport,
    ShiftDeleteGlyphAndRemoveComponentsPreview, ShiftDeleteGlyphAndRemoveComponentsReport,
    ShiftDeleteGlyphPreview, ShiftDeleteGlyphReport, ShiftDeleteGlyphSourceLayerPreview,
    ShiftDeleteGlyphSourceLayerReport, ShiftDeleteGlyphVariationSourceReport,
    ShiftDeleteSourcePreview, ShiftDeleteSourceReport, ShiftGlyphRelinkReplacementBlocker,
    ShiftGlyphRelinkReplacementCandidate, ShiftGlyphVariationAxisValue,
    ShiftGlyphVariationAxisValueSource, ShiftGlyphVariationSourceLocation,
    ShiftGlyphVariationSourceUpdate, ShiftGlyphVariationSourceUse, ShiftMappedAxisValue,
    ShiftMappedAxisValueSource, ShiftMappedLocation, ShiftMissingSourceLayer,
    ShiftRenameGlyphPreview, ShiftRenameGlyphReport, ShiftResolvedAxisValue,
    ShiftResolvedAxisValueSource, ShiftSourceAxisValue, ShiftSourceAxisValueSource,
    ShiftSourceInterpolationIssue, ShiftSourceLayerCoverage, ShiftSourceLayerUse,
    ShiftSourceLocation, ShiftSourceUpdate, ShiftUpdateAxisMappingReport,
    ShiftUpdateComponentVariationSourceReport, ShiftUpdateGlyphVariationSourceReport,
    ShiftUpdateSourceReport, ShiftWorkingSource, ShiftWorkingSourceSavePreview,
    ShiftWorkingSourceSavePreviewStatus, ShiftWorkingSourceSaveReport,
    ShiftWorkingSourceSaveStatus, ShiftWorkingSourceSaveSummary,
};
