use crate::error::{ShiftSourceError, ShiftSourceResult};
use crate::package::{
    apply_staged_commit, build_dependency_index, build_interpolation_compatibility_index,
    diff_packages, fingerprint_package, fingerprint_relative_paths, parse_unicode_scalar,
    prepare_package_commit, stage_prepared_commit, ShiftAppliedCommit, ShiftAxis, ShiftAxisMapping,
    ShiftAxisMappingSample, ShiftComponent, ShiftComponentUse, ShiftComponentVariationSource,
    ShiftCondition, ShiftDependencyIndex, ShiftFileFingerprint, ShiftGlyph, ShiftGlyphDependencies,
    ShiftGlyphInterpolationCompatibility, ShiftGlyphLayer, ShiftGlyphSource,
    ShiftInterpolationCompatibilityIndex, ShiftInterpolationCompatibilityIssue, ShiftPackage,
    ShiftPackageDiff, ShiftPackageFingerprint, ShiftPreparedCommit, ShiftSource, ShiftStagedCommit,
};
use serde::{Deserialize, Serialize};
use shift_ir::variation::{
    normalized_location_from_values, variation_axis_order, NormalizedF64VariationModel,
    NormalizedF64VariationSpace, RoundingBehaviour,
};
use shift_ir::DecomposedTransform;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;

#[derive(Clone, Debug)]
pub struct ShiftWorkingSource {
    package: ShiftPackage,
    saved_package: ShiftPackage,
    saved_fingerprint: Option<ShiftPackageFingerprint>,
    dependency_index: ShiftDependencyIndex,
    interpolation_compatibility_index: ShiftInterpolationCompatibilityIndex,
    axis_mapping_resolvers: Vec<CompiledAxisMapping>,
    component_variation_resolvers:
        HashMap<ComponentVariationResolverKey, CompiledComponentVariationResolver>,
    revision: u64,
}

#[derive(Clone, Debug)]
struct ShiftWorkingSourceViews {
    dependency_index: ShiftDependencyIndex,
    interpolation_compatibility_index: ShiftInterpolationCompatibilityIndex,
    axis_mapping_resolvers: Vec<CompiledAxisMapping>,
    component_variation_resolvers:
        HashMap<ComponentVariationResolverKey, CompiledComponentVariationResolver>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftRenameGlyphPreview {
    pub glyph_id: String,
    pub old_name: String,
    pub new_name: String,
    pub component_dependents: Vec<ShiftComponentUse>,
    pub diff: ShiftPackageDiff,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftRenameGlyphReport {
    pub glyph_id: String,
    pub old_name: String,
    pub new_name: String,
    pub component_dependents: Vec<ShiftComponentUse>,
    pub diff: ShiftPackageDiff,
    pub revision: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftDeleteGlyphPreview {
    pub glyph_id: String,
    pub glyph_name: String,
    pub component_dependents: Vec<ShiftComponentUse>,
    pub component_dependent_recipes: Vec<ShiftComponentRecipeSummary>,
    pub can_remove_without_decomposing: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftDeleteGlyphReport {
    pub glyph_id: String,
    pub glyph_name: String,
    pub diff: ShiftPackageDiff,
    pub revision: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftDeleteGlyphAndRemoveComponentsReport {
    pub glyph_id: String,
    pub glyph_name: String,
    pub removed_component_recipes: Vec<ShiftComponentRecipeSummary>,
    pub diff: ShiftPackageDiff,
    pub revision: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftCreateAxisMapping {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mapping_id: Option<String>,
    pub name: String,
    pub input_axes: Vec<String>,
    pub output_axes: Vec<String>,
    pub samples: Vec<ShiftAxisMappingSample>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftAxisMappingUpdate {
    pub name: String,
    pub input_axes: Vec<String>,
    pub output_axes: Vec<String>,
    pub samples: Vec<ShiftAxisMappingSample>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftCreateAxisMappingReport {
    pub mapping_id: String,
    pub mapping: ShiftAxisMapping,
    pub diff: ShiftPackageDiff,
    pub revision: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftUpdateAxisMappingReport {
    pub mapping_id: String,
    pub mapping: ShiftAxisMapping,
    pub diff: ShiftPackageDiff,
    pub revision: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftDeleteAxisMappingReport {
    pub mapping_id: String,
    pub mapping_name: String,
    pub diff: ShiftPackageDiff,
    pub revision: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftCreateSource {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    pub name: String,
    pub location: BTreeMap<String, f64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftSourceUpdate {
    pub name: String,
    pub location: BTreeMap<String, f64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftCreateSourceReport {
    pub source_id: String,
    pub source: ShiftSourceLocation,
    pub diff: ShiftPackageDiff,
    pub revision: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftUpdateSourceReport {
    pub source_id: String,
    pub source: ShiftSourceLocation,
    pub diff: ShiftPackageDiff,
    pub revision: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftDeleteSourceReport {
    pub source_id: String,
    pub source_name: String,
    pub diff: ShiftPackageDiff,
    pub revision: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftSourceLayerUse {
    pub glyph_id: String,
    pub glyph_name: String,
    pub layer_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftMissingSourceLayer {
    pub glyph_id: String,
    pub glyph_name: String,
    pub expected_layer_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftSourceInterpolationIssue {
    pub glyph_id: String,
    pub glyph_name: String,
    pub issue: ShiftInterpolationCompatibilityIssue,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftSourceLayerCoverage {
    pub source_id: String,
    pub source_name: String,
    pub glyph_count: usize,
    pub layer_count: usize,
    pub missing_layer_count: usize,
    pub interpolation_issue_count: usize,
    pub complete: bool,
    pub interpolation_compatible: bool,
    pub present_layers: Vec<ShiftSourceLayerUse>,
    pub missing_layers: Vec<ShiftMissingSourceLayer>,
    pub interpolation_issues: Vec<ShiftSourceInterpolationIssue>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftGlyphVariationSourceUse {
    pub glyph_id: String,
    pub glyph_name: String,
    pub source_id: String,
    pub source_name: String,
    pub layer_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftDeleteSourcePreview {
    pub source_id: String,
    pub source_name: String,
    pub is_default_source: bool,
    pub layer_uses: Vec<ShiftSourceLayerUse>,
    pub glyph_variation_source_uses: Vec<ShiftGlyphVariationSourceUse>,
    pub can_delete_without_cascade: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftCreateGlyph {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub glyph_id: Option<String>,
    pub name: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unicodes: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_layer: Option<ShiftGlyphLayer>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftCreateGlyphReport {
    pub glyph_id: String,
    pub glyph_name: String,
    pub diff: ShiftPackageDiff,
    pub revision: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftCreateGlyphSourceLayer {
    pub layer: ShiftGlyphLayer,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftCreateGlyphSourceLayerReport {
    pub glyph_id: String,
    pub glyph_name: String,
    pub source_id: String,
    pub source_name: String,
    pub diff: ShiftPackageDiff,
    pub revision: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftDeleteGlyphSourceLayerPreview {
    pub glyph_id: String,
    pub glyph_name: String,
    pub source_id: String,
    pub source_name: String,
    pub glyph_variation_source_uses: Vec<ShiftGlyphVariationSourceUse>,
    pub can_delete_without_cascade: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftDeleteGlyphSourceLayerReport {
    pub glyph_id: String,
    pub glyph_name: String,
    pub source_id: String,
    pub source_name: String,
    pub diff: ShiftPackageDiff,
    pub revision: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftCreateGlyphVariationSource {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    pub name: String,
    pub layer_id: String,
    pub location: BTreeMap<String, f64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftCreateGlyphVariationSourceReport {
    pub glyph_id: String,
    pub glyph_name: String,
    pub source_id: String,
    pub source: ShiftGlyphVariationSourceLocation,
    pub diff: ShiftPackageDiff,
    pub revision: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftGlyphVariationSourceUpdate {
    pub name: String,
    pub layer_id: String,
    pub location: BTreeMap<String, f64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftUpdateGlyphVariationSourceReport {
    pub glyph_id: String,
    pub glyph_name: String,
    pub source_id: String,
    pub source: ShiftGlyphVariationSourceLocation,
    pub diff: ShiftPackageDiff,
    pub revision: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftDeleteGlyphVariationSourceReport {
    pub glyph_id: String,
    pub glyph_name: String,
    pub source_id: String,
    pub source_name: String,
    pub diff: ShiftPackageDiff,
    pub revision: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftCreateComponentVariationSource {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    pub name: String,
    pub parent_location: BTreeMap<String, f64>,
    pub location: BTreeMap<String, f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transform: Option<DecomposedTransform>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftCreateComponentVariationSourceReport {
    pub glyph_id: String,
    pub glyph_name: String,
    pub layer_id: String,
    pub component_id: String,
    pub source_id: String,
    pub source: ShiftComponentVariationSourceLocation,
    pub diff: ShiftPackageDiff,
    pub revision: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftComponentVariationSourceUpdate {
    pub name: String,
    pub parent_location: BTreeMap<String, f64>,
    pub location: BTreeMap<String, f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transform: Option<DecomposedTransform>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftUpdateComponentVariationSourceReport {
    pub glyph_id: String,
    pub glyph_name: String,
    pub layer_id: String,
    pub component_id: String,
    pub source_id: String,
    pub source: ShiftComponentVariationSourceLocation,
    pub diff: ShiftPackageDiff,
    pub revision: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftDeleteComponentVariationSourceReport {
    pub glyph_id: String,
    pub glyph_name: String,
    pub layer_id: String,
    pub component_id: String,
    pub source_id: String,
    pub source_name: String,
    pub diff: ShiftPackageDiff,
    pub revision: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftWorkingSourceSaveReport {
    pub status: ShiftWorkingSourceSaveStatus,
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

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftSourceLocation {
    pub source_id: String,
    pub source_name: String,
    pub values: BTreeMap<String, ShiftSourceAxisValue>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftSourceAxisValue {
    pub value: f64,
    pub source: ShiftSourceAxisValueSource,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ShiftSourceAxisValueSource {
    SourceLocation,
    AxisDefault,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftComponentActivity {
    pub glyph_id: String,
    pub glyph_name: String,
    pub layer_id: String,
    pub component_id: String,
    pub base_glyph_id: String,
    pub base_glyph_name: String,
    pub active: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub condition: Option<ShiftConditionEvaluation>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ShiftConditionEvaluation {
    AxisRange {
        axis_id: String,
        value: f64,
        min: Option<f64>,
        max: Option<f64>,
        active: bool,
    },
    And {
        active: bool,
        conditions: Vec<ShiftConditionEvaluation>,
    },
    Or {
        active: bool,
        conditions: Vec<ShiftConditionEvaluation>,
    },
    Not {
        active: bool,
        condition: Box<ShiftConditionEvaluation>,
    },
}

impl ShiftConditionEvaluation {
    fn active(&self) -> bool {
        match self {
            Self::AxisRange { active, .. }
            | Self::And { active, .. }
            | Self::Or { active, .. }
            | Self::Not { active, .. } => *active,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftComponentRecipeSummary {
    pub glyph_id: String,
    pub glyph_name: String,
    pub layer_id: String,
    pub component_id: String,
    pub base_glyph_id: String,
    pub base_glyph_name: String,
    pub kind: ShiftComponentRecipeKind,
    pub axis_inheritance: crate::package::ShiftAxisInheritance,
    pub condition_axis_ids: Vec<String>,
    pub location_axis_ids: Vec<String>,
    pub variation_source_count: usize,
    pub variation_parent_axis_ids: Vec<String>,
    pub variation_location_axis_ids: Vec<String>,
    pub varies_transform: bool,
    pub lowering_hint: ShiftComponentLoweringHint,
    pub required_capabilities: Vec<ShiftComponentLoweringCapability>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ShiftComponentRecipeKind {
    Static,
    Conditional,
    Variable,
    ConditionalVariable,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ShiftComponentLoweringCapability {
    Condition,
    VariableLocation,
    VariableTransform,
    AxisReset,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ShiftComponentLoweringHint {
    StaticComponent,
    ConditionalComponent,
    VariableComponent,
    ConditionalVariableComponent,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftComponentLoweringTarget {
    pub supported_capabilities: Vec<ShiftComponentLoweringCapability>,
}

impl ShiftComponentLoweringTarget {
    pub fn new(supported_capabilities: Vec<ShiftComponentLoweringCapability>) -> Self {
        Self {
            supported_capabilities,
        }
    }

    pub fn plain_components() -> Self {
        Self::new(Vec::new())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftComponentLoweringDiagnostic {
    pub glyph_id: String,
    pub glyph_name: String,
    pub layer_id: String,
    pub component_id: String,
    pub base_glyph_id: String,
    pub base_glyph_name: String,
    pub lowering_hint: ShiftComponentLoweringHint,
    pub required_capabilities: Vec<ShiftComponentLoweringCapability>,
    pub missing_capabilities: Vec<ShiftComponentLoweringCapability>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftComponentLoweringPreflight {
    pub total_component_count: usize,
    pub supported_component_count: usize,
    pub unsupported_component_count: usize,
    pub skipped_inactive_component_count: usize,
    pub affected_glyph_count: usize,
    pub missing_capabilities: Vec<ShiftComponentLoweringCapability>,
    pub missing_capability_counts: Vec<ShiftComponentLoweringCapabilityCount>,
    pub diagnostics: Vec<ShiftComponentLoweringDiagnostic>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftComponentLoweringCapabilityCount {
    pub capability: ShiftComponentLoweringCapability,
    pub component_count: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftComponentResolvedLocation {
    pub glyph_id: String,
    pub glyph_name: String,
    pub layer_id: String,
    pub component_id: String,
    pub base_glyph_id: String,
    pub base_glyph_name: String,
    pub active: bool,
    pub axis_inheritance: crate::package::ShiftAxisInheritance,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub condition: Option<ShiftConditionEvaluation>,
    pub values: BTreeMap<String, ShiftResolvedAxisValue>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftResolvedAxisValue {
    pub value: f64,
    pub source: ShiftResolvedAxisValueSource,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ShiftResolvedAxisValueSource {
    ParentLocation,
    FontDefault,
    BaseLocalDefault,
    ComponentOverride,
    ComponentVariationSource,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftGlyphVariationSourceLocation {
    pub glyph_id: String,
    pub glyph_name: String,
    pub source_id: String,
    pub source_name: String,
    pub layer_id: String,
    pub layer_source_name: String,
    pub values: BTreeMap<String, ShiftGlyphVariationAxisValue>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftGlyphVariationAxisValue {
    pub value: f64,
    pub source: ShiftGlyphVariationAxisValueSource,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ShiftGlyphVariationAxisValueSource {
    SourceLocation,
    AxisDefault,
    LocalAxisDefault,
    VariationSourceOverride,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftComponentVariationSourceLocation {
    pub glyph_id: String,
    pub glyph_name: String,
    pub layer_id: String,
    pub component_id: String,
    pub base_glyph_id: String,
    pub base_glyph_name: String,
    pub source_id: String,
    pub source_name: String,
    pub parent_values: BTreeMap<String, ShiftComponentVariationParentAxisValue>,
    pub values: BTreeMap<String, ShiftResolvedAxisValue>,
    pub transform: DecomposedTransform,
    pub transform_source: ShiftComponentVariationTransformSource,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftComponentVariationParentAxisValue {
    pub value: f64,
    pub source: ShiftComponentVariationParentAxisValueSource,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ShiftComponentVariationParentAxisValueSource {
    AxisDefault,
    VariationSourceParentLocation,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ShiftComponentVariationTransformSource {
    BaseComponent,
    ComponentVariationSource,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftComponentResolvedState {
    pub glyph_id: String,
    pub glyph_name: String,
    pub layer_id: String,
    pub component_id: String,
    pub base_glyph_id: String,
    pub base_glyph_name: String,
    pub active: bool,
    pub axis_inheritance: crate::package::ShiftAxisInheritance,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub condition: Option<ShiftConditionEvaluation>,
    pub values: BTreeMap<String, ShiftResolvedAxisValue>,
    pub transform: DecomposedTransform,
    pub variation_resolution: ShiftComponentVariationResolution,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variation_source: Option<ShiftComponentResolvedVariationSource>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftComponentResolvedVariationSource {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ShiftComponentVariationResolution {
    Inactive,
    Base,
    ExactSource {
        source: ShiftComponentResolvedVariationSource,
    },
    Interpolated {
        source_count: usize,
    },
    Unsupported {
        reason: ShiftComponentVariationUnsupportedReason,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ShiftComponentVariationUnsupportedReason {
    ModelError { message: String },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftMappedLocation {
    pub values: BTreeMap<String, ShiftMappedAxisValue>,
    pub diagnostics: Vec<ShiftAxisMappingDiagnostic>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftMappedAxisValue {
    pub value: f64,
    pub source: ShiftMappedAxisValueSource,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mapping_id: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ShiftMappedAxisValueSource {
    InputLocation,
    AxisDefault,
    AxisMapping,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftAxisMappingDiagnostic {
    pub mapping_id: String,
    pub kind: ShiftAxisMappingDiagnosticKind,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ShiftAxisMappingDiagnosticKind {
    MissingSampleInput { axis_id: String },
    MissingSampleOutput { axis_id: String },
    OutsideSampleRange { axis_id: String, value: f64 },
    ModelError { message: String },
}

struct ResolvedComponentVariationState {
    values: BTreeMap<String, ShiftResolvedAxisValue>,
    transform: DecomposedTransform,
    resolution: ShiftComponentVariationResolution,
    source: Option<ShiftComponentResolvedVariationSource>,
}

#[derive(Clone, Debug)]
struct CompiledAxisMapping {
    id: String,
    output_axes: Vec<String>,
    kind: CompiledAxisMappingKind,
}

#[derive(Clone, Debug)]
enum CompiledAxisMappingKind {
    Static {
        output: BTreeMap<String, f64>,
    },
    OneDimensional {
        input_axis_id: String,
        samples: Vec<(f64, BTreeMap<String, f64>)>,
    },
    MultiDimensional {
        input_axes: Vec<CompiledAxisMappingInputAxis>,
        model: Result<NormalizedF64VariationModel, String>,
    },
}

#[derive(Clone, Debug)]
struct CompiledAxisMappingInputAxis {
    id: String,
    tag: String,
    minimum: f64,
    default: f64,
    maximum: f64,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct ComponentVariationResolverKey {
    glyph_id: String,
    layer_id: String,
    component_id: String,
}

#[derive(Clone, Debug)]
struct CompiledComponentVariationResolver {
    source_count: usize,
    default_location: shift_ir::variation::NormalizedLocation,
    sources: Vec<CompiledComponentVariationSource>,
    kind: CompiledComponentVariationResolverKind,
}

#[derive(Clone, Debug)]
struct CompiledComponentVariationSource {
    id: String,
    name: String,
    parent_location: shift_ir::variation::NormalizedLocation,
    location: BTreeMap<String, f64>,
    transform: Option<DecomposedTransform>,
}

#[derive(Clone, Debug)]
enum CompiledComponentVariationResolverKind {
    Fixed {
        axis_ids: Vec<String>,
        model: Box<Result<NormalizedF64VariationModel, String>>,
    },
    DynamicQueryValues {
        axis_ids: Vec<String>,
        space: Box<NormalizedF64VariationSpace>,
    },
}

impl ShiftWorkingSource {
    pub fn new(package: ShiftPackage) -> ShiftSourceResult<Self> {
        let views = build_working_source_views(&package)?;

        Ok(Self {
            saved_package: package.clone(),
            package,
            saved_fingerprint: None,
            dependency_index: views.dependency_index,
            interpolation_compatibility_index: views.interpolation_compatibility_index,
            axis_mapping_resolvers: views.axis_mapping_resolvers,
            component_variation_resolvers: views.component_variation_resolvers,
            revision: 0,
        })
    }

    pub fn open_saved(root: impl AsRef<Path>, package: ShiftPackage) -> ShiftSourceResult<Self> {
        package.validate()?;
        let saved_fingerprint = fingerprint_package(root)?;
        let views = build_working_source_views(&package)?;

        Ok(Self {
            saved_package: package.clone(),
            package,
            saved_fingerprint: Some(saved_fingerprint),
            dependency_index: views.dependency_index,
            interpolation_compatibility_index: views.interpolation_compatibility_index,
            axis_mapping_resolvers: views.axis_mapping_resolvers,
            component_variation_resolvers: views.component_variation_resolvers,
            revision: 0,
        })
    }

    pub fn package(&self) -> &ShiftPackage {
        &self.package
    }

    pub fn into_package(self) -> ShiftPackage {
        self.package
    }

    pub fn revision(&self) -> u64 {
        self.revision
    }

    pub fn saved_package(&self) -> &ShiftPackage {
        &self.saved_package
    }

    pub fn dependency_index(&self) -> &ShiftDependencyIndex {
        &self.dependency_index
    }

    pub fn interpolation_compatibility_index(&self) -> &ShiftInterpolationCompatibilityIndex {
        &self.interpolation_compatibility_index
    }

    #[cfg(test)]
    pub(crate) fn compiled_component_variation_resolver_count(&self) -> usize {
        self.component_variation_resolvers.len()
    }

    pub fn source_locations(&self) -> Vec<ShiftSourceLocation> {
        self.package
            .sources
            .iter()
            .map(|source| ShiftSourceLocation {
                source_id: source.id.clone(),
                source_name: source.name.clone(),
                values: self.complete_source_location(&source.location),
            })
            .collect()
    }

    pub fn source_layer_coverage(&self) -> Vec<ShiftSourceLayerCoverage> {
        self.package
            .sources
            .iter()
            .map(|source| {
                let mut present_layers = Vec::new();
                let mut missing_layers = Vec::new();
                let mut interpolation_issues = Vec::new();

                for glyph in &self.package.glyphs {
                    if glyph.layers.contains_key(&source.id) {
                        present_layers.push(ShiftSourceLayerUse {
                            glyph_id: glyph.id.clone(),
                            glyph_name: glyph.name.clone(),
                            layer_id: source.id.clone(),
                        });
                    } else {
                        missing_layers.push(ShiftMissingSourceLayer {
                            glyph_id: glyph.id.clone(),
                            glyph_name: glyph.name.clone(),
                            expected_layer_id: source.id.clone(),
                        });
                    }

                    if let Some(compatibility) =
                        self.interpolation_compatibility_index.glyphs.get(&glyph.id)
                    {
                        interpolation_issues.extend(
                            compatibility
                                .issues
                                .iter()
                                .filter(|issue| {
                                    issue.reference_layer_id == source.id
                                        || issue.layer_id == source.id
                                })
                                .cloned()
                                .map(|issue| ShiftSourceInterpolationIssue {
                                    glyph_id: glyph.id.clone(),
                                    glyph_name: glyph.name.clone(),
                                    issue,
                                }),
                        );
                    }
                }

                ShiftSourceLayerCoverage {
                    source_id: source.id.clone(),
                    source_name: source.name.clone(),
                    glyph_count: self.package.glyphs.len(),
                    layer_count: present_layers.len(),
                    missing_layer_count: missing_layers.len(),
                    interpolation_issue_count: interpolation_issues.len(),
                    complete: missing_layers.is_empty(),
                    interpolation_compatible: interpolation_issues.is_empty(),
                    present_layers,
                    missing_layers,
                    interpolation_issues,
                }
            })
            .collect()
    }

    fn source_location(&self, source_id: &str) -> ShiftSourceResult<ShiftSourceLocation> {
        self.source_locations()
            .into_iter()
            .find(|source| source.source_id == source_id)
            .ok_or_else(|| ShiftSourceError::MissingSource {
                source_id: source_id.to_string(),
            })
    }

    pub fn glyph_dependencies(&self, glyph_id: &str) -> ShiftSourceResult<&ShiftGlyphDependencies> {
        self.dependency_index
            .glyphs
            .get(glyph_id)
            .ok_or_else(|| ShiftSourceError::MissingGlyph {
                glyph_id: glyph_id.to_string(),
            })
    }

    pub fn glyph_interpolation_compatibility(
        &self,
        glyph_id: &str,
    ) -> ShiftSourceResult<&ShiftGlyphInterpolationCompatibility> {
        self.interpolation_compatibility_index
            .glyphs
            .get(glyph_id)
            .ok_or_else(|| ShiftSourceError::MissingGlyph {
                glyph_id: glyph_id.to_string(),
            })
    }

    pub fn glyph_variation_source_locations(
        &self,
        glyph_id: &str,
    ) -> ShiftSourceResult<Vec<ShiftGlyphVariationSourceLocation>> {
        let glyph = self.glyph(glyph_id)?;

        glyph
            .variation_sources
            .iter()
            .map(|variation_source| {
                let layer_source =
                    self.source_for_glyph(&glyph.name, &variation_source.layer_id)?;
                let values = self.complete_glyph_variation_source_location(
                    glyph,
                    layer_source,
                    &variation_source.location,
                );

                Ok(ShiftGlyphVariationSourceLocation {
                    glyph_id: glyph.id.clone(),
                    glyph_name: glyph.name.clone(),
                    source_id: variation_source.id.clone(),
                    source_name: variation_source.name.clone(),
                    layer_id: variation_source.layer_id.clone(),
                    layer_source_name: layer_source.name.clone(),
                    values,
                })
            })
            .collect()
    }

    pub fn preview_delete_glyph(
        &self,
        glyph_id: &str,
    ) -> ShiftSourceResult<ShiftDeleteGlyphPreview> {
        let dependencies = self.glyph_dependencies(glyph_id)?;
        let component_dependent_recipes = self.component_dependent_recipes(glyph_id)?;

        Ok(ShiftDeleteGlyphPreview {
            glyph_id: dependencies.glyph_id.clone(),
            glyph_name: dependencies.glyph_name.clone(),
            component_dependents: dependencies.component_dependents.clone(),
            component_dependent_recipes,
            can_remove_without_decomposing: dependencies.component_dependents.is_empty(),
        })
    }

    pub fn preview_rename_glyph(
        &self,
        glyph_id: &str,
        new_name: impl Into<String>,
    ) -> ShiftSourceResult<ShiftRenameGlyphPreview> {
        let new_name = new_name.into().trim().to_string();
        let glyph = self.glyph(glyph_id)?;
        if self
            .package
            .glyphs
            .iter()
            .any(|glyph| glyph.id != glyph_id && glyph.name == new_name)
        {
            return Err(ShiftSourceError::DuplicateGlyphName {
                glyph_name: new_name,
            });
        }

        let mut next = self.package.clone();
        next.glyphs
            .iter_mut()
            .find(|glyph| glyph.id == glyph_id)
            .expect("glyph was found above")
            .name = new_name.clone();
        refresh_component_base_glyph_names(&mut next, glyph_id, &new_name);
        next.validate()?;
        let diff = diff_packages(&self.package, &next)?;
        let component_dependents = self
            .glyph_dependencies(glyph_id)?
            .component_dependents
            .clone();

        Ok(ShiftRenameGlyphPreview {
            glyph_id: glyph_id.to_string(),
            old_name: glyph.name.clone(),
            new_name,
            component_dependents,
            diff,
        })
    }

    pub fn preview_delete_source(
        &self,
        source_id: &str,
    ) -> ShiftSourceResult<ShiftDeleteSourcePreview> {
        let source = self
            .package
            .sources
            .iter()
            .find(|source| source.id == source_id)
            .ok_or_else(|| ShiftSourceError::MissingSource {
                source_id: source_id.to_string(),
            })?;
        let is_default_source = self
            .package
            .manifest
            .default_source_id
            .as_deref()
            .is_some_and(|default_source_id| default_source_id == source_id);
        let mut layer_uses = Vec::new();
        let mut glyph_variation_source_uses = Vec::new();

        for glyph in &self.package.glyphs {
            if glyph.layers.contains_key(source_id) {
                layer_uses.push(ShiftSourceLayerUse {
                    glyph_id: glyph.id.clone(),
                    glyph_name: glyph.name.clone(),
                    layer_id: source_id.to_string(),
                });
            }

            for variation_source in &glyph.variation_sources {
                if variation_source.layer_id == source_id {
                    glyph_variation_source_uses.push(ShiftGlyphVariationSourceUse {
                        glyph_id: glyph.id.clone(),
                        glyph_name: glyph.name.clone(),
                        source_id: variation_source.id.clone(),
                        source_name: variation_source.name.clone(),
                        layer_id: variation_source.layer_id.clone(),
                    });
                }
            }
        }

        Ok(ShiftDeleteSourcePreview {
            source_id: source.id.clone(),
            source_name: source.name.clone(),
            is_default_source,
            can_delete_without_cascade: !is_default_source
                && layer_uses.is_empty()
                && glyph_variation_source_uses.is_empty(),
            layer_uses,
            glyph_variation_source_uses,
        })
    }

    pub fn preview_delete_glyph_source_layer(
        &self,
        glyph_id: &str,
        source_id: &str,
    ) -> ShiftSourceResult<ShiftDeleteGlyphSourceLayerPreview> {
        let glyph = self.glyph(glyph_id)?;
        let source = self
            .package
            .sources
            .iter()
            .find(|source| source.id == source_id)
            .ok_or_else(|| ShiftSourceError::MissingSource {
                source_id: source_id.to_string(),
            })?;
        if !glyph.layers.contains_key(source_id) {
            return Err(ShiftSourceError::MissingGlyphLayer {
                glyph_id: glyph_id.to_string(),
                layer_id: source_id.to_string(),
            });
        }

        let glyph_variation_source_uses = glyph
            .variation_sources
            .iter()
            .filter(|variation_source| variation_source.layer_id == source_id)
            .map(|variation_source| ShiftGlyphVariationSourceUse {
                glyph_id: glyph.id.clone(),
                glyph_name: glyph.name.clone(),
                source_id: variation_source.id.clone(),
                source_name: variation_source.name.clone(),
                layer_id: variation_source.layer_id.clone(),
            })
            .collect::<Vec<_>>();

        Ok(ShiftDeleteGlyphSourceLayerPreview {
            glyph_id: glyph.id.clone(),
            glyph_name: glyph.name.clone(),
            source_id: source.id.clone(),
            source_name: source.name.clone(),
            can_delete_without_cascade: glyph_variation_source_uses.is_empty(),
            glyph_variation_source_uses,
        })
    }

    pub fn component_activity(
        &self,
        glyph_id: &str,
        layer_id: &str,
        location: &BTreeMap<String, f64>,
    ) -> ShiftSourceResult<Vec<ShiftComponentActivity>> {
        let glyph = self
            .package
            .glyphs
            .iter()
            .find(|glyph| glyph.id == glyph_id)
            .ok_or_else(|| ShiftSourceError::MissingGlyph {
                glyph_id: glyph_id.to_string(),
            })?;
        let layer =
            glyph
                .layers
                .get(layer_id)
                .ok_or_else(|| ShiftSourceError::MissingGlyphLayer {
                    glyph_id: glyph_id.to_string(),
                    layer_id: layer_id.to_string(),
                })?;
        self.validate_query_location("component activity", location)?;

        layer
            .components
            .iter()
            .map(|component| {
                let base_glyph = self.glyph(&component.base_glyph_id)?;
                let condition = component
                    .condition
                    .as_ref()
                    .map(|condition| self.evaluate_condition(&glyph.name, condition, location))
                    .transpose()?;
                let active = condition
                    .as_ref()
                    .map(ShiftConditionEvaluation::active)
                    .unwrap_or(true);

                Ok(ShiftComponentActivity {
                    glyph_id: glyph.id.clone(),
                    glyph_name: glyph.name.clone(),
                    layer_id: layer_id.to_string(),
                    component_id: component.id.clone(),
                    base_glyph_id: component.base_glyph_id.clone(),
                    base_glyph_name: base_glyph.name.clone(),
                    active,
                    condition,
                })
            })
            .collect()
    }

    pub fn component_recipes(
        &self,
        glyph_id: &str,
        layer_id: &str,
    ) -> ShiftSourceResult<Vec<ShiftComponentRecipeSummary>> {
        let glyph = self.glyph(glyph_id)?;
        let layer =
            glyph
                .layers
                .get(layer_id)
                .ok_or_else(|| ShiftSourceError::MissingGlyphLayer {
                    glyph_id: glyph_id.to_string(),
                    layer_id: layer_id.to_string(),
                })?;

        layer
            .components
            .iter()
            .map(|component| {
                let base_glyph = self.glyph(&component.base_glyph_id)?;
                Ok(component_recipe_summary(
                    glyph,
                    layer_id,
                    component,
                    &base_glyph.name,
                ))
            })
            .collect()
    }

    pub fn component_variation_source_locations(
        &self,
        glyph_id: &str,
        layer_id: &str,
        component_id: &str,
    ) -> ShiftSourceResult<Vec<ShiftComponentVariationSourceLocation>> {
        let glyph = self.glyph(glyph_id)?;
        let layer =
            glyph
                .layers
                .get(layer_id)
                .ok_or_else(|| ShiftSourceError::MissingGlyphLayer {
                    glyph_id: glyph_id.to_string(),
                    layer_id: layer_id.to_string(),
                })?;
        let component = layer
            .components
            .iter()
            .find(|component| component.id == component_id)
            .ok_or_else(|| ShiftSourceError::MissingComponent {
                glyph_id: glyph_id.to_string(),
                layer_id: layer_id.to_string(),
                component_id: component_id.to_string(),
            })?;
        let base_glyph = self.glyph(&component.base_glyph_id)?;

        component
            .variation_sources
            .iter()
            .map(|source| {
                let parent_values =
                    self.complete_component_variation_parent_location(&source.parent_location);
                let mut values = self.resolve_component_axis_values(
                    component,
                    base_glyph,
                    &source.parent_location,
                );
                for (axis_id, value) in &source.location {
                    values.insert(
                        axis_id.clone(),
                        ShiftResolvedAxisValue {
                            value: *value,
                            source: ShiftResolvedAxisValueSource::ComponentVariationSource,
                        },
                    );
                }
                let (transform, transform_source) = if let Some(transform) = source.transform {
                    (
                        transform,
                        ShiftComponentVariationTransformSource::ComponentVariationSource,
                    )
                } else {
                    (
                        component.transform,
                        ShiftComponentVariationTransformSource::BaseComponent,
                    )
                };

                Ok(ShiftComponentVariationSourceLocation {
                    glyph_id: glyph.id.clone(),
                    glyph_name: glyph.name.clone(),
                    layer_id: layer_id.to_string(),
                    component_id: component.id.clone(),
                    base_glyph_id: component.base_glyph_id.clone(),
                    base_glyph_name: base_glyph.name.clone(),
                    source_id: source.id.clone(),
                    source_name: source.name.clone(),
                    parent_values,
                    values,
                    transform,
                    transform_source,
                })
            })
            .collect()
    }

    fn component_dependent_recipes(
        &self,
        base_glyph_id: &str,
    ) -> ShiftSourceResult<Vec<ShiftComponentRecipeSummary>> {
        let base_glyph = self.glyph(base_glyph_id)?;
        let mut summaries = Vec::new();
        for glyph in &self.package.glyphs {
            for (layer_id, layer) in &glyph.layers {
                for component in &layer.components {
                    if component.base_glyph_id == base_glyph_id {
                        summaries.push(component_recipe_summary(
                            glyph,
                            layer_id,
                            component,
                            &base_glyph.name,
                        ));
                    }
                }
            }
        }
        summaries.sort_by(|left, right| {
            left.glyph_id
                .cmp(&right.glyph_id)
                .then_with(|| left.layer_id.cmp(&right.layer_id))
                .then_with(|| left.component_id.cmp(&right.component_id))
        });
        Ok(summaries)
    }

    pub fn component_lowering_diagnostics(
        &self,
        target: &ShiftComponentLoweringTarget,
    ) -> Vec<ShiftComponentLoweringDiagnostic> {
        self.component_lowering_preflight(target).diagnostics
    }

    pub fn component_lowering_preflight(
        &self,
        target: &ShiftComponentLoweringTarget,
    ) -> ShiftComponentLoweringPreflight {
        self.component_lowering_preflight_for_location(target, None)
            .expect("location-independent preflight cannot fail condition evaluation")
    }

    pub fn component_lowering_preflight_at_location(
        &self,
        target: &ShiftComponentLoweringTarget,
        location: &BTreeMap<String, f64>,
    ) -> ShiftSourceResult<ShiftComponentLoweringPreflight> {
        self.validate_query_location("component lowering preflight", location)?;
        self.component_lowering_preflight_for_location(target, Some(location))
    }

    fn component_lowering_preflight_for_location(
        &self,
        target: &ShiftComponentLoweringTarget,
        location: Option<&BTreeMap<String, f64>>,
    ) -> ShiftSourceResult<ShiftComponentLoweringPreflight> {
        let supported_capabilities = target
            .supported_capabilities
            .iter()
            .copied()
            .collect::<BTreeSet<_>>();
        let mut diagnostics = Vec::new();
        let mut total_component_count = 0;
        let mut skipped_inactive_component_count = 0;
        let mut affected_glyph_ids = BTreeSet::new();
        let mut missing_capability_counts =
            BTreeMap::<ShiftComponentLoweringCapability, usize>::new();

        for glyph in &self.package.glyphs {
            for (layer_id, layer) in &glyph.layers {
                for component in &layer.components {
                    total_component_count += 1;
                    if let Some(location) = location {
                        let active = component
                            .condition
                            .as_ref()
                            .map(|condition| {
                                self.condition_matches(&glyph.name, condition, location)
                            })
                            .transpose()?
                            .unwrap_or(true);
                        if !active {
                            skipped_inactive_component_count += 1;
                            continue;
                        }
                    }

                    let base_glyph = self.glyph(&component.base_glyph_id)?;
                    let summary =
                        component_recipe_summary(glyph, layer_id, component, &base_glyph.name);
                    let missing_capabilities = summary
                        .required_capabilities
                        .iter()
                        .copied()
                        .filter(|capability| !supported_capabilities.contains(capability))
                        .collect::<Vec<_>>();

                    if missing_capabilities.is_empty() {
                        continue;
                    }

                    affected_glyph_ids.insert(summary.glyph_id.clone());
                    for capability in &missing_capabilities {
                        *missing_capability_counts.entry(*capability).or_default() += 1;
                    }

                    diagnostics.push(ShiftComponentLoweringDiagnostic {
                        glyph_id: summary.glyph_id,
                        glyph_name: summary.glyph_name,
                        layer_id: summary.layer_id,
                        component_id: summary.component_id,
                        base_glyph_id: summary.base_glyph_id,
                        base_glyph_name: summary.base_glyph_name,
                        lowering_hint: summary.lowering_hint,
                        required_capabilities: summary.required_capabilities,
                        missing_capabilities,
                    });
                }
            }
        }

        let missing_capabilities = missing_capability_counts
            .keys()
            .copied()
            .collect::<Vec<_>>();
        let missing_capability_counts = missing_capability_counts
            .into_iter()
            .map(
                |(capability, component_count)| ShiftComponentLoweringCapabilityCount {
                    capability,
                    component_count,
                },
            )
            .collect::<Vec<_>>();
        let unsupported_component_count = diagnostics.len();

        Ok(ShiftComponentLoweringPreflight {
            total_component_count,
            supported_component_count: total_component_count
                - unsupported_component_count
                - skipped_inactive_component_count,
            unsupported_component_count,
            skipped_inactive_component_count,
            affected_glyph_count: affected_glyph_ids.len(),
            missing_capabilities,
            missing_capability_counts,
            diagnostics,
        })
    }

    pub fn component_resolved_locations(
        &self,
        glyph_id: &str,
        layer_id: &str,
        location: &BTreeMap<String, f64>,
    ) -> ShiftSourceResult<Vec<ShiftComponentResolvedLocation>> {
        let glyph = self.glyph(glyph_id)?;
        let layer =
            glyph
                .layers
                .get(layer_id)
                .ok_or_else(|| ShiftSourceError::MissingGlyphLayer {
                    glyph_id: glyph_id.to_string(),
                    layer_id: layer_id.to_string(),
                })?;
        self.validate_query_location("component resolved locations", location)?;

        layer
            .components
            .iter()
            .map(|component| {
                let condition = component
                    .condition
                    .as_ref()
                    .map(|condition| self.evaluate_condition(&glyph.name, condition, location))
                    .transpose()?;
                let active = condition
                    .as_ref()
                    .map(ShiftConditionEvaluation::active)
                    .unwrap_or(true);
                let base_glyph = self.glyph(&component.base_glyph_id)?;
                let values = self.resolve_component_axis_values(component, base_glyph, location);

                Ok(ShiftComponentResolvedLocation {
                    glyph_id: glyph.id.clone(),
                    glyph_name: glyph.name.clone(),
                    layer_id: layer_id.to_string(),
                    component_id: component.id.clone(),
                    base_glyph_id: component.base_glyph_id.clone(),
                    base_glyph_name: base_glyph.name.clone(),
                    active,
                    axis_inheritance: component.axis_inheritance,
                    condition,
                    values,
                })
            })
            .collect()
    }

    pub fn component_resolved_states(
        &self,
        glyph_id: &str,
        layer_id: &str,
        location: &BTreeMap<String, f64>,
    ) -> ShiftSourceResult<Vec<ShiftComponentResolvedState>> {
        let glyph = self.glyph(glyph_id)?;
        let layer =
            glyph
                .layers
                .get(layer_id)
                .ok_or_else(|| ShiftSourceError::MissingGlyphLayer {
                    glyph_id: glyph_id.to_string(),
                    layer_id: layer_id.to_string(),
                })?;
        self.validate_query_location("component resolved states", location)?;

        layer
            .components
            .iter()
            .map(|component| {
                let condition = component
                    .condition
                    .as_ref()
                    .map(|condition| self.evaluate_condition(&glyph.name, condition, location))
                    .transpose()?;
                let active = condition
                    .as_ref()
                    .map(ShiftConditionEvaluation::active)
                    .unwrap_or(true);
                let base_glyph = self.glyph(&component.base_glyph_id)?;
                let base_values =
                    self.resolve_component_axis_values(component, base_glyph, location);
                let resolved = if active {
                    self.resolve_component_variation_state(
                        &glyph.id,
                        layer_id,
                        component,
                        base_values,
                        component.transform,
                        location,
                    )
                } else {
                    ResolvedComponentVariationState {
                        values: base_values,
                        transform: component.transform,
                        resolution: ShiftComponentVariationResolution::Inactive,
                        source: None,
                    }
                };

                Ok(ShiftComponentResolvedState {
                    glyph_id: glyph.id.clone(),
                    glyph_name: glyph.name.clone(),
                    layer_id: layer_id.to_string(),
                    component_id: component.id.clone(),
                    base_glyph_id: component.base_glyph_id.clone(),
                    base_glyph_name: base_glyph.name.clone(),
                    active,
                    axis_inheritance: component.axis_inheritance,
                    condition,
                    values: resolved.values,
                    transform: resolved.transform,
                    variation_resolution: resolved.resolution,
                    variation_source: resolved.source,
                })
            })
            .collect()
    }

    pub fn mapped_location(
        &self,
        location: &BTreeMap<String, f64>,
    ) -> ShiftSourceResult<ShiftMappedLocation> {
        self.validate_query_location("mapped location", location)?;
        let mut values = self.default_mapped_values(location);
        let mut diagnostics = Vec::new();

        for mapping in &self.axis_mapping_resolvers {
            match mapping.resolve(&values) {
                Ok(output) => {
                    for (axis_id, value) in output {
                        values.insert(
                            axis_id,
                            ShiftMappedAxisValue {
                                value,
                                source: ShiftMappedAxisValueSource::AxisMapping,
                                mapping_id: Some(mapping.id.clone()),
                            },
                        );
                    }
                }
                Err(kind) => diagnostics.push(ShiftAxisMappingDiagnostic {
                    mapping_id: mapping.id.clone(),
                    kind,
                }),
            }
        }

        Ok(ShiftMappedLocation {
            values,
            diagnostics,
        })
    }

    pub fn prepare_commit(&self, root: impl AsRef<Path>) -> ShiftSourceResult<ShiftPreparedCommit> {
        let diff = diff_packages(&self.saved_package, &self.package)?;
        let impacted_paths = diff.impact.package_relative_paths();
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

    pub fn mark_saved(&mut self, root: impl AsRef<Path>) -> ShiftSourceResult<()> {
        self.package.validate()?;
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
        let prepared = self.prepare_commit(root)?;
        if prepared.diff.changes.is_empty() {
            self.mark_saved(root)?;
            return Ok(ShiftWorkingSourceSaveReport {
                status: ShiftWorkingSourceSaveStatus::Unchanged,
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
            prepared,
            staged: Some(staged),
            applied: Some(applied),
            revision: self.revision,
        })
    }

    pub fn create_axis_mapping(
        &mut self,
        create: ShiftCreateAxisMapping,
    ) -> ShiftSourceResult<ShiftCreateAxisMappingReport> {
        let before = self.package.clone();
        let mut next = before.clone();
        let mapping_name = unique_member_name_with_fallback(
            create.name.trim(),
            "New Mapping",
            next.axis_mappings
                .iter()
                .map(|mapping| mapping.name.as_str()),
        );
        let mapping_id = create.mapping_id.unwrap_or_else(|| {
            unique_member_id(
                "mapping",
                &mapping_name,
                next.axis_mappings.iter().map(|mapping| mapping.id.as_str()),
            )
        });
        next.axis_mappings.push(ShiftAxisMapping {
            id: mapping_id.clone(),
            name: mapping_name,
            input_axes: create.input_axes,
            output_axes: create.output_axes,
            samples: create.samples,
        });

        self.replace_package(next)?;

        let diff = diff_packages(&before, &self.package)?;
        if !diff.changes.is_empty() {
            self.revision += 1;
        }
        let mapping = self.axis_mapping(&mapping_id)?.clone();

        Ok(ShiftCreateAxisMappingReport {
            mapping_id,
            mapping,
            diff,
            revision: self.revision,
        })
    }

    pub fn update_axis_mapping(
        &mut self,
        mapping_id: &str,
        update: ShiftAxisMappingUpdate,
    ) -> ShiftSourceResult<ShiftUpdateAxisMappingReport> {
        let before = self.package.clone();
        let mut next = before.clone();
        let mapping = next
            .axis_mappings
            .iter_mut()
            .find(|mapping| mapping.id == mapping_id)
            .ok_or_else(|| ShiftSourceError::MissingAxisMapping {
                mapping_id: mapping_id.to_string(),
            })?;
        mapping.name = update.name.trim().to_string();
        mapping.input_axes = update.input_axes;
        mapping.output_axes = update.output_axes;
        mapping.samples = update.samples;

        self.replace_package(next)?;

        let diff = diff_packages(&before, &self.package)?;
        if !diff.changes.is_empty() {
            self.revision += 1;
        }
        let mapping = self.axis_mapping(mapping_id)?.clone();

        Ok(ShiftUpdateAxisMappingReport {
            mapping_id: mapping_id.to_string(),
            mapping,
            diff,
            revision: self.revision,
        })
    }

    pub fn delete_axis_mapping(
        &mut self,
        mapping_id: &str,
    ) -> ShiftSourceResult<ShiftDeleteAxisMappingReport> {
        let before = self.package.clone();
        let mut next = before.clone();
        let mapping_index = next
            .axis_mappings
            .iter()
            .position(|mapping| mapping.id == mapping_id)
            .ok_or_else(|| ShiftSourceError::MissingAxisMapping {
                mapping_id: mapping_id.to_string(),
            })?;
        let mapping = next.axis_mappings.remove(mapping_index);

        self.replace_package(next)?;

        let diff = diff_packages(&before, &self.package)?;
        if !diff.changes.is_empty() {
            self.revision += 1;
        }

        Ok(ShiftDeleteAxisMappingReport {
            mapping_id: mapping.id,
            mapping_name: mapping.name,
            diff,
            revision: self.revision,
        })
    }

    pub fn create_source(
        &mut self,
        create: ShiftCreateSource,
    ) -> ShiftSourceResult<ShiftCreateSourceReport> {
        let before = self.package.clone();
        let mut next = before.clone();
        let source_name = unique_member_name_with_fallback(
            create.name.trim(),
            "New Source",
            next.sources.iter().map(|source| source.name.as_str()),
        );
        let source_id = create.source_id.unwrap_or_else(|| {
            unique_member_id(
                "source",
                &source_name,
                next.sources.iter().map(|source| source.id.as_str()),
            )
        });
        next.sources.push(ShiftSource {
            id: source_id.clone(),
            name: source_name,
            location: create.location,
        });

        self.replace_package(next)?;

        let diff = diff_packages(&before, &self.package)?;
        if !diff.changes.is_empty() {
            self.revision += 1;
        }
        let source = self.source_location(&source_id)?;

        Ok(ShiftCreateSourceReport {
            source_id,
            source,
            diff,
            revision: self.revision,
        })
    }

    pub fn update_source(
        &mut self,
        source_id: &str,
        update: ShiftSourceUpdate,
    ) -> ShiftSourceResult<ShiftUpdateSourceReport> {
        let before = self.package.clone();
        let mut next = before.clone();
        let source = next
            .sources
            .iter_mut()
            .find(|source| source.id == source_id)
            .ok_or_else(|| ShiftSourceError::MissingSource {
                source_id: source_id.to_string(),
            })?;
        source.name = update.name.trim().to_string();
        source.location = update.location;

        self.replace_package(next)?;

        let diff = diff_packages(&before, &self.package)?;
        if !diff.changes.is_empty() {
            self.revision += 1;
        }
        let source = self.source_location(source_id)?;

        Ok(ShiftUpdateSourceReport {
            source_id: source_id.to_string(),
            source,
            diff,
            revision: self.revision,
        })
    }

    pub fn delete_source(&mut self, source_id: &str) -> ShiftSourceResult<ShiftDeleteSourceReport> {
        let preview = self.preview_delete_source(source_id)?;
        if preview.is_default_source {
            return Err(ShiftSourceError::CannotDeleteDefaultSource {
                source_id: source_id.to_string(),
            });
        }
        if !preview.can_delete_without_cascade {
            return Err(ShiftSourceError::SourceHasReferences {
                source_id: source_id.to_string(),
                layer_use_count: preview.layer_uses.len(),
                glyph_variation_source_use_count: preview.glyph_variation_source_uses.len(),
            });
        }

        let before = self.package.clone();
        let mut next = before.clone();
        let source_index = next
            .sources
            .iter()
            .position(|source| source.id == source_id)
            .ok_or_else(|| ShiftSourceError::MissingSource {
                source_id: source_id.to_string(),
            })?;
        let source = next.sources.remove(source_index);

        self.replace_package(next)?;

        let diff = diff_packages(&before, &self.package)?;
        if !diff.changes.is_empty() {
            self.revision += 1;
        }

        Ok(ShiftDeleteSourceReport {
            source_id: preview.source_id,
            source_name: source.name,
            diff,
            revision: self.revision,
        })
    }

    pub fn create_glyph(
        &mut self,
        create: ShiftCreateGlyph,
    ) -> ShiftSourceResult<ShiftCreateGlyphReport> {
        let before = self.package.clone();
        let mut next = before.clone();
        let glyph_name = unique_member_name(
            create.name.trim(),
            next.glyphs.iter().map(|glyph| glyph.name.as_str()),
        );
        let unicodes = canonical_unicode_values(&glyph_name, create.unicodes)?;
        let glyph_id = create.glyph_id.unwrap_or_else(|| {
            unique_member_id(
                "glyph",
                &glyph_name,
                next.glyphs.iter().map(|glyph| glyph.id.as_str()),
            )
        });
        let mut layers = BTreeMap::new();
        if let Some(default_layer) = create.default_layer {
            let default_source_id = next
                .manifest
                .default_source_id
                .clone()
                .ok_or(ShiftSourceError::MissingDefaultSourceId)?;
            layers.insert(default_source_id, default_layer);
        }

        next.glyphs.push(ShiftGlyph {
            id: glyph_id.clone(),
            name: glyph_name.clone(),
            unicodes,
            local_axes: Vec::new(),
            variation_sources: Vec::new(),
            layers,
        });

        self.replace_package(next)?;

        let diff = diff_packages(&before, &self.package)?;
        if !diff.changes.is_empty() {
            self.revision += 1;
        }

        Ok(ShiftCreateGlyphReport {
            glyph_id,
            glyph_name,
            diff,
            revision: self.revision,
        })
    }

    pub fn create_glyph_source_layer(
        &mut self,
        glyph_id: &str,
        source_id: &str,
        create: ShiftCreateGlyphSourceLayer,
    ) -> ShiftSourceResult<ShiftCreateGlyphSourceLayerReport> {
        let before = self.package.clone();
        let mut next = before.clone();
        let source_name = next
            .sources
            .iter()
            .find(|source| source.id == source_id)
            .map(|source| source.name.clone())
            .ok_or_else(|| ShiftSourceError::MissingSource {
                source_id: source_id.to_string(),
            })?;
        let glyph = next
            .glyphs
            .iter_mut()
            .find(|glyph| glyph.id == glyph_id)
            .ok_or_else(|| ShiftSourceError::MissingGlyph {
                glyph_id: glyph_id.to_string(),
            })?;
        let glyph_name = glyph.name.clone();
        if glyph.layers.contains_key(source_id) {
            return Err(ShiftSourceError::GlyphLayerAlreadyExists {
                glyph_id: glyph_id.to_string(),
                layer_id: source_id.to_string(),
            });
        }
        glyph.layers.insert(source_id.to_string(), create.layer);

        self.replace_package(next)?;

        let diff = diff_packages(&before, &self.package)?;
        if !diff.changes.is_empty() {
            self.revision += 1;
        }

        Ok(ShiftCreateGlyphSourceLayerReport {
            glyph_id: glyph_id.to_string(),
            glyph_name,
            source_id: source_id.to_string(),
            source_name,
            diff,
            revision: self.revision,
        })
    }

    pub fn delete_glyph_source_layer(
        &mut self,
        glyph_id: &str,
        source_id: &str,
    ) -> ShiftSourceResult<ShiftDeleteGlyphSourceLayerReport> {
        let preview = self.preview_delete_glyph_source_layer(glyph_id, source_id)?;
        if !preview.can_delete_without_cascade {
            return Err(ShiftSourceError::GlyphLayerHasReferences {
                glyph_id: glyph_id.to_string(),
                layer_id: source_id.to_string(),
                glyph_variation_source_use_count: preview.glyph_variation_source_uses.len(),
            });
        }

        let before = self.package.clone();
        let mut next = before.clone();
        let glyph = next
            .glyphs
            .iter_mut()
            .find(|glyph| glyph.id == glyph_id)
            .ok_or_else(|| ShiftSourceError::MissingGlyph {
                glyph_id: glyph_id.to_string(),
            })?;
        glyph.layers.remove(source_id);

        self.replace_package(next)?;

        let diff = diff_packages(&before, &self.package)?;
        if !diff.changes.is_empty() {
            self.revision += 1;
        }

        Ok(ShiftDeleteGlyphSourceLayerReport {
            glyph_id: preview.glyph_id,
            glyph_name: preview.glyph_name,
            source_id: preview.source_id,
            source_name: preview.source_name,
            diff,
            revision: self.revision,
        })
    }

    pub fn create_glyph_variation_source(
        &mut self,
        glyph_id: &str,
        create: ShiftCreateGlyphVariationSource,
    ) -> ShiftSourceResult<ShiftCreateGlyphVariationSourceReport> {
        let before = self.package.clone();
        let mut next = before.clone();
        let glyph = next
            .glyphs
            .iter_mut()
            .find(|glyph| glyph.id == glyph_id)
            .ok_or_else(|| ShiftSourceError::MissingGlyph {
                glyph_id: glyph_id.to_string(),
            })?;
        let glyph_name = glyph.name.clone();
        let source_name = unique_member_name_with_fallback(
            create.name.trim(),
            "New Variation Source",
            glyph
                .variation_sources
                .iter()
                .map(|source| source.name.as_str()),
        );
        let source_id = create.source_id.unwrap_or_else(|| {
            unique_member_id(
                "glyphSource",
                &source_name,
                glyph
                    .variation_sources
                    .iter()
                    .map(|source| source.id.as_str()),
            )
        });
        glyph.variation_sources.push(ShiftGlyphSource {
            id: source_id.clone(),
            name: source_name,
            layer_id: create.layer_id,
            location: create.location,
        });

        self.replace_package(next)?;

        let diff = diff_packages(&before, &self.package)?;
        if !diff.changes.is_empty() {
            self.revision += 1;
        }

        let source = self
            .glyph_variation_source_locations(glyph_id)?
            .into_iter()
            .find(|source| source.source_id == source_id)
            .ok_or_else(|| ShiftSourceError::MissingGlyphVariationSource {
                glyph_id: glyph_id.to_string(),
                source_id: source_id.clone(),
            })?;

        Ok(ShiftCreateGlyphVariationSourceReport {
            glyph_id: glyph_id.to_string(),
            glyph_name,
            source_id,
            source,
            diff,
            revision: self.revision,
        })
    }

    pub fn update_glyph_variation_source(
        &mut self,
        glyph_id: &str,
        source_id: &str,
        update: ShiftGlyphVariationSourceUpdate,
    ) -> ShiftSourceResult<ShiftUpdateGlyphVariationSourceReport> {
        let before = self.package.clone();
        let mut next = before.clone();
        let glyph = next
            .glyphs
            .iter_mut()
            .find(|glyph| glyph.id == glyph_id)
            .ok_or_else(|| ShiftSourceError::MissingGlyph {
                glyph_id: glyph_id.to_string(),
            })?;
        let glyph_name = glyph.name.clone();
        let source = glyph
            .variation_sources
            .iter_mut()
            .find(|source| source.id == source_id)
            .ok_or_else(|| ShiftSourceError::MissingGlyphVariationSource {
                glyph_id: glyph_id.to_string(),
                source_id: source_id.to_string(),
            })?;
        source.name = update.name.trim().to_string();
        source.layer_id = update.layer_id;
        source.location = update.location;

        self.replace_package(next)?;

        let diff = diff_packages(&before, &self.package)?;
        if !diff.changes.is_empty() {
            self.revision += 1;
        }

        let source = self
            .glyph_variation_source_locations(glyph_id)?
            .into_iter()
            .find(|source| source.source_id == source_id)
            .ok_or_else(|| ShiftSourceError::MissingGlyphVariationSource {
                glyph_id: glyph_id.to_string(),
                source_id: source_id.to_string(),
            })?;

        Ok(ShiftUpdateGlyphVariationSourceReport {
            glyph_id: glyph_id.to_string(),
            glyph_name,
            source_id: source_id.to_string(),
            source,
            diff,
            revision: self.revision,
        })
    }

    pub fn delete_glyph_variation_source(
        &mut self,
        glyph_id: &str,
        source_id: &str,
    ) -> ShiftSourceResult<ShiftDeleteGlyphVariationSourceReport> {
        let before = self.package.clone();
        let mut next = before.clone();
        let glyph = next
            .glyphs
            .iter_mut()
            .find(|glyph| glyph.id == glyph_id)
            .ok_or_else(|| ShiftSourceError::MissingGlyph {
                glyph_id: glyph_id.to_string(),
            })?;
        let glyph_name = glyph.name.clone();
        let source_index = glyph
            .variation_sources
            .iter()
            .position(|source| source.id == source_id)
            .ok_or_else(|| ShiftSourceError::MissingGlyphVariationSource {
                glyph_id: glyph_id.to_string(),
                source_id: source_id.to_string(),
            })?;
        let source = glyph.variation_sources.remove(source_index);

        self.replace_package(next)?;

        let diff = diff_packages(&before, &self.package)?;
        if !diff.changes.is_empty() {
            self.revision += 1;
        }

        Ok(ShiftDeleteGlyphVariationSourceReport {
            glyph_id: glyph_id.to_string(),
            glyph_name,
            source_id: source.id,
            source_name: source.name,
            diff,
            revision: self.revision,
        })
    }

    pub fn create_component_variation_source(
        &mut self,
        glyph_id: &str,
        layer_id: &str,
        component_id: &str,
        create: ShiftCreateComponentVariationSource,
    ) -> ShiftSourceResult<ShiftCreateComponentVariationSourceReport> {
        let before = self.package.clone();
        let mut next = before.clone();
        let glyph = next
            .glyphs
            .iter_mut()
            .find(|glyph| glyph.id == glyph_id)
            .ok_or_else(|| ShiftSourceError::MissingGlyph {
                glyph_id: glyph_id.to_string(),
            })?;
        let glyph_name = glyph.name.clone();
        let layer =
            glyph
                .layers
                .get_mut(layer_id)
                .ok_or_else(|| ShiftSourceError::MissingGlyphLayer {
                    glyph_id: glyph_id.to_string(),
                    layer_id: layer_id.to_string(),
                })?;
        let component = layer
            .components
            .iter_mut()
            .find(|component| component.id == component_id)
            .ok_or_else(|| ShiftSourceError::MissingComponent {
                glyph_id: glyph_id.to_string(),
                layer_id: layer_id.to_string(),
                component_id: component_id.to_string(),
            })?;
        let source_name = unique_member_name_with_fallback(
            create.name.trim(),
            "New Component Source",
            component
                .variation_sources
                .iter()
                .map(|source| source.name.as_str()),
        );
        let source_id = create.source_id.unwrap_or_else(|| {
            unique_member_id(
                "componentSource",
                &source_name,
                component
                    .variation_sources
                    .iter()
                    .map(|source| source.id.as_str()),
            )
        });
        component
            .variation_sources
            .push(ShiftComponentVariationSource {
                id: source_id.clone(),
                name: source_name,
                parent_location: create.parent_location,
                location: create.location,
                transform: create.transform,
            });

        self.replace_package(next)?;

        let diff = diff_packages(&before, &self.package)?;
        if !diff.changes.is_empty() {
            self.revision += 1;
        }

        let source = self
            .component_variation_source_locations(glyph_id, layer_id, component_id)?
            .into_iter()
            .find(|source| source.source_id == source_id)
            .ok_or_else(|| ShiftSourceError::MissingComponentVariationSource {
                glyph_id: glyph_id.to_string(),
                layer_id: layer_id.to_string(),
                component_id: component_id.to_string(),
                source_id: source_id.clone(),
            })?;

        Ok(ShiftCreateComponentVariationSourceReport {
            glyph_id: glyph_id.to_string(),
            glyph_name,
            layer_id: layer_id.to_string(),
            component_id: component_id.to_string(),
            source_id,
            source,
            diff,
            revision: self.revision,
        })
    }

    pub fn update_component_variation_source(
        &mut self,
        glyph_id: &str,
        layer_id: &str,
        component_id: &str,
        source_id: &str,
        update: ShiftComponentVariationSourceUpdate,
    ) -> ShiftSourceResult<ShiftUpdateComponentVariationSourceReport> {
        let before = self.package.clone();
        let mut next = before.clone();
        let glyph = next
            .glyphs
            .iter_mut()
            .find(|glyph| glyph.id == glyph_id)
            .ok_or_else(|| ShiftSourceError::MissingGlyph {
                glyph_id: glyph_id.to_string(),
            })?;
        let glyph_name = glyph.name.clone();
        let layer =
            glyph
                .layers
                .get_mut(layer_id)
                .ok_or_else(|| ShiftSourceError::MissingGlyphLayer {
                    glyph_id: glyph_id.to_string(),
                    layer_id: layer_id.to_string(),
                })?;
        let component = layer
            .components
            .iter_mut()
            .find(|component| component.id == component_id)
            .ok_or_else(|| ShiftSourceError::MissingComponent {
                glyph_id: glyph_id.to_string(),
                layer_id: layer_id.to_string(),
                component_id: component_id.to_string(),
            })?;
        let source = component
            .variation_sources
            .iter_mut()
            .find(|source| source.id == source_id)
            .ok_or_else(|| ShiftSourceError::MissingComponentVariationSource {
                glyph_id: glyph_id.to_string(),
                layer_id: layer_id.to_string(),
                component_id: component_id.to_string(),
                source_id: source_id.to_string(),
            })?;
        source.name = update.name.trim().to_string();
        source.parent_location = update.parent_location;
        source.location = update.location;
        source.transform = update.transform;

        self.replace_package(next)?;

        let diff = diff_packages(&before, &self.package)?;
        if !diff.changes.is_empty() {
            self.revision += 1;
        }

        let source = self
            .component_variation_source_locations(glyph_id, layer_id, component_id)?
            .into_iter()
            .find(|source| source.source_id == source_id)
            .ok_or_else(|| ShiftSourceError::MissingComponentVariationSource {
                glyph_id: glyph_id.to_string(),
                layer_id: layer_id.to_string(),
                component_id: component_id.to_string(),
                source_id: source_id.to_string(),
            })?;

        Ok(ShiftUpdateComponentVariationSourceReport {
            glyph_id: glyph_id.to_string(),
            glyph_name,
            layer_id: layer_id.to_string(),
            component_id: component_id.to_string(),
            source_id: source_id.to_string(),
            source,
            diff,
            revision: self.revision,
        })
    }

    pub fn delete_component_variation_source(
        &mut self,
        glyph_id: &str,
        layer_id: &str,
        component_id: &str,
        source_id: &str,
    ) -> ShiftSourceResult<ShiftDeleteComponentVariationSourceReport> {
        let before = self.package.clone();
        let mut next = before.clone();
        let glyph = next
            .glyphs
            .iter_mut()
            .find(|glyph| glyph.id == glyph_id)
            .ok_or_else(|| ShiftSourceError::MissingGlyph {
                glyph_id: glyph_id.to_string(),
            })?;
        let glyph_name = glyph.name.clone();
        let layer =
            glyph
                .layers
                .get_mut(layer_id)
                .ok_or_else(|| ShiftSourceError::MissingGlyphLayer {
                    glyph_id: glyph_id.to_string(),
                    layer_id: layer_id.to_string(),
                })?;
        let component = layer
            .components
            .iter_mut()
            .find(|component| component.id == component_id)
            .ok_or_else(|| ShiftSourceError::MissingComponent {
                glyph_id: glyph_id.to_string(),
                layer_id: layer_id.to_string(),
                component_id: component_id.to_string(),
            })?;
        let source_index = component
            .variation_sources
            .iter()
            .position(|source| source.id == source_id)
            .ok_or_else(|| ShiftSourceError::MissingComponentVariationSource {
                glyph_id: glyph_id.to_string(),
                layer_id: layer_id.to_string(),
                component_id: component_id.to_string(),
                source_id: source_id.to_string(),
            })?;
        let source = component.variation_sources.remove(source_index);

        self.replace_package(next)?;

        let diff = diff_packages(&before, &self.package)?;
        if !diff.changes.is_empty() {
            self.revision += 1;
        }

        Ok(ShiftDeleteComponentVariationSourceReport {
            glyph_id: glyph_id.to_string(),
            glyph_name,
            layer_id: layer_id.to_string(),
            component_id: component_id.to_string(),
            source_id: source.id,
            source_name: source.name,
            diff,
            revision: self.revision,
        })
    }

    pub fn delete_glyph(&mut self, glyph_id: &str) -> ShiftSourceResult<ShiftDeleteGlyphReport> {
        let preview = self.preview_delete_glyph(glyph_id)?;
        if !preview.component_dependents.is_empty() {
            return Err(ShiftSourceError::GlyphHasComponentDependents {
                glyph_id: glyph_id.to_string(),
                dependent_count: preview.component_dependents.len(),
            });
        }

        let before = self.package.clone();
        let mut next = before.clone();
        let index = next
            .glyphs
            .iter()
            .position(|glyph| glyph.id == glyph_id)
            .ok_or_else(|| ShiftSourceError::MissingGlyph {
                glyph_id: glyph_id.to_string(),
            })?;
        next.glyphs.remove(index);
        self.replace_package(next)?;

        let diff = diff_packages(&before, &self.package)?;
        if !diff.changes.is_empty() {
            self.revision += 1;
        }

        Ok(ShiftDeleteGlyphReport {
            glyph_id: preview.glyph_id,
            glyph_name: preview.glyph_name,
            diff,
            revision: self.revision,
        })
    }

    pub fn delete_glyph_and_remove_component_references(
        &mut self,
        glyph_id: &str,
    ) -> ShiftSourceResult<ShiftDeleteGlyphAndRemoveComponentsReport> {
        let preview = self.preview_delete_glyph(glyph_id)?;

        let before = self.package.clone();
        let mut next = before.clone();
        let removed_component_references = remove_component_references_to_base(&mut next, glyph_id);
        debug_assert_eq!(removed_component_references, preview.component_dependents);
        let index = next
            .glyphs
            .iter()
            .position(|glyph| glyph.id == glyph_id)
            .ok_or_else(|| ShiftSourceError::MissingGlyph {
                glyph_id: glyph_id.to_string(),
            })?;
        next.glyphs.remove(index);
        self.replace_package(next)?;

        let diff = diff_packages(&before, &self.package)?;
        if !diff.changes.is_empty() {
            self.revision += 1;
        }

        Ok(ShiftDeleteGlyphAndRemoveComponentsReport {
            glyph_id: preview.glyph_id,
            glyph_name: preview.glyph_name,
            removed_component_recipes: preview.component_dependent_recipes,
            diff,
            revision: self.revision,
        })
    }

    pub fn rename_glyph(
        &mut self,
        glyph_id: &str,
        new_name: impl Into<String>,
    ) -> ShiftSourceResult<ShiftRenameGlyphReport> {
        let preview = self.preview_rename_glyph(glyph_id, new_name)?;

        let before = self.package.clone();
        let mut next = before.clone();
        let glyph = next
            .glyphs
            .iter_mut()
            .find(|glyph| glyph.id == glyph_id)
            .ok_or_else(|| ShiftSourceError::MissingGlyph {
                glyph_id: glyph_id.to_string(),
            })?;

        let old_name = glyph.name.clone();
        glyph.name = preview.new_name.clone();
        refresh_component_base_glyph_names(&mut next, glyph_id, &preview.new_name);
        self.replace_package(next)?;

        let diff = diff_packages(&before, &self.package)?;
        if !diff.changes.is_empty() {
            self.revision += 1;
        }

        Ok(ShiftRenameGlyphReport {
            glyph_id: preview.glyph_id,
            old_name,
            new_name: preview.new_name,
            component_dependents: preview.component_dependents,
            diff,
            revision: self.revision,
        })
    }

    fn replace_package(&mut self, package: ShiftPackage) -> ShiftSourceResult<()> {
        let views = build_working_source_views(&package)?;
        self.package = package;
        self.dependency_index = views.dependency_index;
        self.interpolation_compatibility_index = views.interpolation_compatibility_index;
        self.axis_mapping_resolvers = views.axis_mapping_resolvers;
        self.component_variation_resolvers = views.component_variation_resolvers;
        Ok(())
    }

    fn axis_mapping(&self, mapping_id: &str) -> ShiftSourceResult<&ShiftAxisMapping> {
        self.package
            .axis_mappings
            .iter()
            .find(|mapping| mapping.id == mapping_id)
            .ok_or_else(|| ShiftSourceError::MissingAxisMapping {
                mapping_id: mapping_id.to_string(),
            })
    }

    fn glyph(&self, glyph_id: &str) -> ShiftSourceResult<&crate::package::ShiftGlyph> {
        self.package
            .glyphs
            .iter()
            .find(|glyph| glyph.id == glyph_id)
            .ok_or_else(|| ShiftSourceError::MissingGlyph {
                glyph_id: glyph_id.to_string(),
            })
    }

    fn source_for_glyph(
        &self,
        glyph_name: &str,
        source_id: &str,
    ) -> ShiftSourceResult<&crate::package::ShiftSource> {
        self.package
            .sources
            .iter()
            .find(|source| source.id == source_id)
            .ok_or_else(|| ShiftSourceError::MissingSourceLayer {
                glyph_name: glyph_name.to_string(),
                source_id: source_id.to_string(),
            })
    }

    fn complete_source_location(
        &self,
        location: &BTreeMap<String, f64>,
    ) -> BTreeMap<String, ShiftSourceAxisValue> {
        let mut values = BTreeMap::new();

        for axis in &self.package.axes {
            let (value, source) = if let Some(value) = location.get(&axis.id) {
                (*value, ShiftSourceAxisValueSource::SourceLocation)
            } else {
                (axis.default, ShiftSourceAxisValueSource::AxisDefault)
            };
            values.insert(axis.id.clone(), ShiftSourceAxisValue { value, source });
        }

        values
    }

    fn complete_glyph_variation_source_location(
        &self,
        glyph: &crate::package::ShiftGlyph,
        layer_source: &crate::package::ShiftSource,
        variation_location: &BTreeMap<String, f64>,
    ) -> BTreeMap<String, ShiftGlyphVariationAxisValue> {
        let mut values = BTreeMap::new();

        for axis in &self.package.axes {
            let (value, source) = if let Some(value) = variation_location.get(&axis.id) {
                (
                    *value,
                    ShiftGlyphVariationAxisValueSource::VariationSourceOverride,
                )
            } else if let Some(value) = layer_source.location.get(&axis.id) {
                (*value, ShiftGlyphVariationAxisValueSource::SourceLocation)
            } else {
                (
                    axis.default,
                    ShiftGlyphVariationAxisValueSource::AxisDefault,
                )
            };
            values.insert(
                axis.id.clone(),
                ShiftGlyphVariationAxisValue { value, source },
            );
        }

        for axis in &glyph.local_axes {
            let (value, source) = if let Some(value) = variation_location.get(&axis.id) {
                (
                    *value,
                    ShiftGlyphVariationAxisValueSource::VariationSourceOverride,
                )
            } else {
                (
                    axis.default,
                    ShiftGlyphVariationAxisValueSource::LocalAxisDefault,
                )
            };
            values.insert(
                axis.id.clone(),
                ShiftGlyphVariationAxisValue { value, source },
            );
        }

        values
    }

    fn complete_component_variation_parent_location(
        &self,
        parent_location: &BTreeMap<String, f64>,
    ) -> BTreeMap<String, ShiftComponentVariationParentAxisValue> {
        let mut values = BTreeMap::new();

        for axis in &self.package.axes {
            let (value, source) = if let Some(value) = parent_location.get(&axis.id) {
                (
                    *value,
                    ShiftComponentVariationParentAxisValueSource::VariationSourceParentLocation,
                )
            } else {
                (
                    axis.default,
                    ShiftComponentVariationParentAxisValueSource::AxisDefault,
                )
            };
            values.insert(
                axis.id.clone(),
                ShiftComponentVariationParentAxisValue { value, source },
            );
        }

        values
    }

    fn resolve_component_axis_values(
        &self,
        component: &crate::package::ShiftComponent,
        base_glyph: &crate::package::ShiftGlyph,
        location: &BTreeMap<String, f64>,
    ) -> BTreeMap<String, ShiftResolvedAxisValue> {
        let mut values = BTreeMap::new();

        for axis in &self.package.axes {
            let (value, source) = match component.axis_inheritance {
                crate::package::ShiftAxisInheritance::InheritParent => {
                    if let Some(value) = location.get(&axis.id) {
                        (*value, ShiftResolvedAxisValueSource::ParentLocation)
                    } else {
                        (axis.default, ShiftResolvedAxisValueSource::FontDefault)
                    }
                }
                crate::package::ShiftAxisInheritance::ResetUnspecifiedToFont => {
                    (axis.default, ShiftResolvedAxisValueSource::FontDefault)
                }
            };
            values.insert(axis.id.clone(), ShiftResolvedAxisValue { value, source });
        }

        for axis in &base_glyph.local_axes {
            values.insert(
                axis.id.clone(),
                ShiftResolvedAxisValue {
                    value: axis.default,
                    source: ShiftResolvedAxisValueSource::BaseLocalDefault,
                },
            );
        }

        for (axis_id, value) in &component.location {
            values.insert(
                axis_id.clone(),
                ShiftResolvedAxisValue {
                    value: *value,
                    source: ShiftResolvedAxisValueSource::ComponentOverride,
                },
            );
        }

        values
    }

    fn resolve_component_variation_state(
        &self,
        glyph_id: &str,
        layer_id: &str,
        component: &crate::package::ShiftComponent,
        base_values: BTreeMap<String, ShiftResolvedAxisValue>,
        base_transform: DecomposedTransform,
        location: &BTreeMap<String, f64>,
    ) -> ResolvedComponentVariationState {
        if component.variation_sources.is_empty() {
            return ResolvedComponentVariationState {
                values: base_values,
                transform: base_transform,
                resolution: ShiftComponentVariationResolution::Base,
                source: None,
            };
        }

        let key = ComponentVariationResolverKey::new(glyph_id, layer_id, &component.id);
        if let Some(resolver) = self.component_variation_resolvers.get(&key) {
            let query_location = self.normalized_component_parent_location(location);
            return resolver.resolve(base_values, base_transform, &query_location);
        }

        ResolvedComponentVariationState {
            values: base_values,
            transform: base_transform,
            resolution: ShiftComponentVariationResolution::Unsupported {
                reason: ShiftComponentVariationUnsupportedReason::ModelError {
                    message: format!(
                        "missing compiled component variation resolver for component '{}'",
                        component.id
                    ),
                },
            },
            source: None,
        }
    }

    fn normalized_component_parent_location(
        &self,
        parent_location: &BTreeMap<String, f64>,
    ) -> shift_ir::variation::NormalizedLocation {
        normalized_component_parent_location_for_axes(&self.package.axes, parent_location)
    }

    fn condition_matches(
        &self,
        glyph_name: &str,
        condition: &ShiftCondition,
        location: &BTreeMap<String, f64>,
    ) -> ShiftSourceResult<bool> {
        self.evaluate_condition(glyph_name, condition, location)
            .map(|evaluation| evaluation.active())
    }

    fn evaluate_condition(
        &self,
        glyph_name: &str,
        condition: &ShiftCondition,
        location: &BTreeMap<String, f64>,
    ) -> ShiftSourceResult<ShiftConditionEvaluation> {
        match condition {
            ShiftCondition::AxisRange { axis_id, min, max } => {
                let value = location
                    .get(axis_id)
                    .copied()
                    .or_else(|| {
                        self.package
                            .axes
                            .iter()
                            .find(|axis| axis.id == *axis_id)
                            .map(|axis| axis.default)
                    })
                    .ok_or_else(|| ShiftSourceError::MissingConditionAxis {
                        glyph_name: glyph_name.to_string(),
                        axis_id: axis_id.clone(),
                    })?;

                Ok(ShiftConditionEvaluation::AxisRange {
                    axis_id: axis_id.clone(),
                    value,
                    min: *min,
                    max: *max,
                    active: min.is_none_or(|min| value >= min)
                        && max.is_none_or(|max| value <= max),
                })
            }
            ShiftCondition::And { conditions } => {
                let conditions = conditions
                    .iter()
                    .map(|condition| self.evaluate_condition(glyph_name, condition, location))
                    .collect::<ShiftSourceResult<Vec<_>>>()?;
                Ok(ShiftConditionEvaluation::And {
                    active: conditions.iter().all(ShiftConditionEvaluation::active),
                    conditions,
                })
            }
            ShiftCondition::Or { conditions } => {
                let conditions = conditions
                    .iter()
                    .map(|condition| self.evaluate_condition(glyph_name, condition, location))
                    .collect::<ShiftSourceResult<Vec<_>>>()?;
                Ok(ShiftConditionEvaluation::Or {
                    active: conditions.iter().any(ShiftConditionEvaluation::active),
                    conditions,
                })
            }
            ShiftCondition::Not { condition } => {
                let condition = self.evaluate_condition(glyph_name, condition, location)?;
                Ok(ShiftConditionEvaluation::Not {
                    active: !condition.active(),
                    condition: Box::new(condition),
                })
            }
        }
    }

    fn validate_query_location(
        &self,
        context: &str,
        location: &BTreeMap<String, f64>,
    ) -> ShiftSourceResult<()> {
        let axes_by_id = self
            .package
            .axes
            .iter()
            .map(|axis| (axis.id.as_str(), axis))
            .collect::<HashMap<_, _>>();

        for (axis_id, value) in location {
            let Some(axis) = axes_by_id.get(axis_id.as_str()) else {
                return Err(ShiftSourceError::MissingQueryLocationAxis {
                    context: context.to_string(),
                    axis_id: axis_id.clone(),
                });
            };
            validate_query_axis_coordinate(context, axis_id, *value, axis.minimum, axis.maximum)?;
        }

        Ok(())
    }

    fn default_mapped_values(
        &self,
        location: &BTreeMap<String, f64>,
    ) -> BTreeMap<String, ShiftMappedAxisValue> {
        self.package
            .axes
            .iter()
            .map(|axis| {
                let (value, source) = if let Some(value) = location.get(&axis.id) {
                    (*value, ShiftMappedAxisValueSource::InputLocation)
                } else {
                    (axis.default, ShiftMappedAxisValueSource::AxisDefault)
                };

                (
                    axis.id.clone(),
                    ShiftMappedAxisValue {
                        value,
                        source,
                        mapping_id: None,
                    },
                )
            })
            .collect()
    }
}

fn validate_query_axis_coordinate(
    context: &str,
    axis_id: &str,
    value: f64,
    minimum: f64,
    maximum: f64,
) -> ShiftSourceResult<()> {
    if !value.is_finite() {
        return Err(ShiftSourceError::NonFiniteNumber {
            context: context.to_string(),
            field: axis_id.to_string(),
            value,
        });
    }
    if minimum <= value && value <= maximum {
        return Ok(());
    }

    Err(ShiftSourceError::AxisCoordinateOutOfRange {
        context: context.to_string(),
        axis_id: axis_id.to_string(),
        value,
        minimum,
        maximum,
    })
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

fn condition_axis_ids(condition: &ShiftCondition) -> Vec<String> {
    let mut axis_ids = BTreeSet::new();
    collect_condition_axis_ids(condition, &mut axis_ids);
    axis_ids.into_iter().collect()
}

fn collect_condition_axis_ids(condition: &ShiftCondition, axis_ids: &mut BTreeSet<String>) {
    match condition {
        ShiftCondition::AxisRange { axis_id, .. } => {
            axis_ids.insert(axis_id.clone());
        }
        ShiftCondition::And { conditions } | ShiftCondition::Or { conditions } => {
            for condition in conditions {
                collect_condition_axis_ids(condition, axis_ids);
            }
        }
        ShiftCondition::Not { condition } => collect_condition_axis_ids(condition, axis_ids),
    }
}

fn component_lowering_capabilities(
    has_condition: bool,
    has_variable_location: bool,
    varies_transform: bool,
    resets_axes: bool,
) -> Vec<ShiftComponentLoweringCapability> {
    let mut capabilities = BTreeSet::new();
    if has_condition {
        capabilities.insert(ShiftComponentLoweringCapability::Condition);
    }
    if has_variable_location {
        capabilities.insert(ShiftComponentLoweringCapability::VariableLocation);
    }
    if varies_transform {
        capabilities.insert(ShiftComponentLoweringCapability::VariableTransform);
    }
    if resets_axes {
        capabilities.insert(ShiftComponentLoweringCapability::AxisReset);
    }
    capabilities.into_iter().collect()
}

fn component_recipe_summary(
    glyph: &ShiftGlyph,
    layer_id: &str,
    component: &ShiftComponent,
    base_glyph_name: &str,
) -> ShiftComponentRecipeSummary {
    let condition_axis_ids = component
        .condition
        .as_ref()
        .map(condition_axis_ids)
        .unwrap_or_default();
    let location_axis_ids = component.location.keys().cloned().collect::<Vec<_>>();
    let variation_parent_axis_ids = component
        .variation_sources
        .iter()
        .flat_map(|source| source.parent_location.keys().cloned())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let variation_location_axis_ids = component
        .variation_sources
        .iter()
        .flat_map(|source| source.location.keys().cloned())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let varies_transform = component
        .variation_sources
        .iter()
        .any(|source| source.transform.is_some());
    let has_condition = component.condition.is_some();
    let has_variable_location =
        !component.location.is_empty() || !component.variation_sources.is_empty();
    let resets_axes =
        component.axis_inheritance != crate::package::ShiftAxisInheritance::InheritParent;
    let has_variable_recipe =
        !component.location.is_empty() || !component.variation_sources.is_empty() || resets_axes;
    let kind = match (has_condition, has_variable_recipe) {
        (false, false) => ShiftComponentRecipeKind::Static,
        (true, false) => ShiftComponentRecipeKind::Conditional,
        (false, true) => ShiftComponentRecipeKind::Variable,
        (true, true) => ShiftComponentRecipeKind::ConditionalVariable,
    };
    let lowering_hint = match kind {
        ShiftComponentRecipeKind::Static => ShiftComponentLoweringHint::StaticComponent,
        ShiftComponentRecipeKind::Conditional => ShiftComponentLoweringHint::ConditionalComponent,
        ShiftComponentRecipeKind::Variable => ShiftComponentLoweringHint::VariableComponent,
        ShiftComponentRecipeKind::ConditionalVariable => {
            ShiftComponentLoweringHint::ConditionalVariableComponent
        }
    };
    let required_capabilities = component_lowering_capabilities(
        has_condition,
        has_variable_location,
        varies_transform,
        resets_axes,
    );

    ShiftComponentRecipeSummary {
        glyph_id: glyph.id.clone(),
        glyph_name: glyph.name.clone(),
        layer_id: layer_id.to_string(),
        component_id: component.id.clone(),
        base_glyph_id: component.base_glyph_id.clone(),
        base_glyph_name: base_glyph_name.to_string(),
        kind,
        axis_inheritance: component.axis_inheritance,
        condition_axis_ids,
        location_axis_ids,
        variation_source_count: component.variation_sources.len(),
        variation_parent_axis_ids,
        variation_location_axis_ids,
        varies_transform,
        lowering_hint,
        required_capabilities,
    }
}

fn normalize_axis_value(value: f64, minimum: f64, default: f64, maximum: f64) -> f64 {
    if value < default {
        if (default - minimum).abs() < f64::EPSILON {
            0.0
        } else {
            (value - default) / (default - minimum)
        }
    } else if value > default {
        if (maximum - default).abs() < f64::EPSILON {
            0.0
        } else {
            (value - default) / (maximum - default)
        }
    } else {
        0.0
    }
}

fn normalized_default_location_for_axes(
    axes: &[ShiftAxis],
) -> shift_ir::variation::NormalizedLocation {
    normalized_location_from_values(axes.iter().map(|axis| axis.tag.as_str()), |_| 0.0)
}

fn normalized_component_parent_location_for_axes(
    axes: &[ShiftAxis],
    parent_location: &BTreeMap<String, f64>,
) -> shift_ir::variation::NormalizedLocation {
    let axis_values = axes
        .iter()
        .map(|axis| {
            (
                axis.tag.as_str(),
                normalize_axis_value(
                    parent_location
                        .get(&axis.id)
                        .copied()
                        .unwrap_or(axis.default),
                    axis.minimum,
                    axis.default,
                    axis.maximum,
                ),
            )
        })
        .collect::<BTreeMap<_, _>>();

    normalized_location_from_values(axes.iter().map(|axis| axis.tag.as_str()), |tag| {
        *axis_values.get(tag).unwrap_or(&0.0)
    })
}

fn component_state_values(
    axis_ids: &[String],
    values: &BTreeMap<String, ShiftResolvedAxisValue>,
    transform: DecomposedTransform,
) -> Vec<f64> {
    let mut out = Vec::with_capacity(9 + axis_ids.len());
    out.extend([
        transform.translate_x,
        transform.translate_y,
        transform.rotation,
        transform.scale_x,
        transform.scale_y,
        transform.skew_x,
        transform.skew_y,
        transform.t_center_x,
        transform.t_center_y,
    ]);
    out.extend(
        axis_ids
            .iter()
            .map(|axis_id| values.get(axis_id).map(|value| value.value).unwrap_or(0.0)),
    );
    out
}

fn component_state_from_values(
    axis_ids: &[String],
    base_values: &BTreeMap<String, ShiftResolvedAxisValue>,
    values: &[f64],
) -> (
    BTreeMap<String, ShiftResolvedAxisValue>,
    DecomposedTransform,
) {
    let transform = DecomposedTransform {
        translate_x: values.first().copied().unwrap_or_default(),
        translate_y: values.get(1).copied().unwrap_or_default(),
        rotation: values.get(2).copied().unwrap_or_default(),
        scale_x: values.get(3).copied().unwrap_or(1.0),
        scale_y: values.get(4).copied().unwrap_or(1.0),
        skew_x: values.get(5).copied().unwrap_or_default(),
        skew_y: values.get(6).copied().unwrap_or_default(),
        t_center_x: values.get(7).copied().unwrap_or_default(),
        t_center_y: values.get(8).copied().unwrap_or_default(),
    };
    let mut resolved_values = base_values.clone();
    for (index, axis_id) in axis_ids.iter().enumerate() {
        if let Some(value) = values.get(index + 9) {
            let base_value = base_values.get(axis_id);
            let source =
                if base_value.is_some_and(|base| (base.value - *value).abs() < f64::EPSILON) {
                    base_value
                        .map(|value| value.source)
                        .unwrap_or(ShiftResolvedAxisValueSource::ComponentVariationSource)
                } else {
                    ShiftResolvedAxisValueSource::ComponentVariationSource
                };
            resolved_values.insert(
                axis_id.clone(),
                ShiftResolvedAxisValue {
                    value: *value,
                    source,
                },
            );
        }
    }
    (resolved_values, transform)
}

impl ComponentVariationResolverKey {
    fn new(glyph_id: &str, layer_id: &str, component_id: &str) -> Self {
        Self {
            glyph_id: glyph_id.to_string(),
            layer_id: layer_id.to_string(),
            component_id: component_id.to_string(),
        }
    }
}

impl CompiledComponentVariationResolver {
    fn resolve(
        &self,
        base_values: BTreeMap<String, ShiftResolvedAxisValue>,
        base_transform: DecomposedTransform,
        query_location: &shift_ir::variation::NormalizedLocation,
    ) -> ResolvedComponentVariationState {
        let exact_source = self.exact_source(query_location);

        match &self.kind {
            CompiledComponentVariationResolverKind::Fixed { axis_ids, model } => {
                let model = match model.as_ref().as_ref().map_err(|message| {
                    ShiftComponentVariationUnsupportedReason::ModelError {
                        message: message.clone(),
                    }
                }) {
                    Ok(model) => model,
                    Err(reason) => {
                        return self.unsupported(base_values, base_transform, reason);
                    }
                };
                let values = model.interpolate(query_location);
                self.finish_interpolation(
                    axis_ids,
                    base_values,
                    base_transform,
                    values,
                    exact_source,
                    query_location,
                )
            }
            CompiledComponentVariationResolverKind::DynamicQueryValues { axis_ids, space } => {
                let points = self.dynamic_points(axis_ids, &base_values, base_transform);
                let values =
                    match space.interpolate(&points, RoundingBehaviour::None, query_location) {
                        Ok(values) => values,
                        Err(message) => {
                            return self.unsupported(
                                base_values,
                                base_transform,
                                ShiftComponentVariationUnsupportedReason::ModelError { message },
                            );
                        }
                    };
                self.finish_interpolation(
                    axis_ids,
                    base_values,
                    base_transform,
                    values,
                    exact_source,
                    query_location,
                )
            }
        }
    }

    fn exact_source(
        &self,
        query_location: &shift_ir::variation::NormalizedLocation,
    ) -> Option<ShiftComponentResolvedVariationSource> {
        self.sources
            .iter()
            .find(|source| source.parent_location == *query_location)
            .map(|source| ShiftComponentResolvedVariationSource {
                id: source.id.clone(),
                name: source.name.clone(),
            })
    }

    fn finish_interpolation(
        &self,
        axis_ids: &[String],
        base_values: BTreeMap<String, ShiftResolvedAxisValue>,
        base_transform: DecomposedTransform,
        values: Vec<f64>,
        exact_source: Option<ShiftComponentResolvedVariationSource>,
        query_location: &shift_ir::variation::NormalizedLocation,
    ) -> ResolvedComponentVariationState {
        let expected_value_count = axis_ids.len() + 9;
        if values.len() != expected_value_count {
            return self.unsupported(
                base_values,
                base_transform,
                ShiftComponentVariationUnsupportedReason::ModelError {
                    message: format!(
                        "component variation model produced {} values for {} expected values",
                        values.len(),
                        expected_value_count
                    ),
                },
            );
        }

        let (values, transform) = component_state_from_values(axis_ids, &base_values, &values);
        let resolution = if let Some(source) = exact_source.clone() {
            ShiftComponentVariationResolution::ExactSource { source }
        } else if query_location == &self.default_location {
            ShiftComponentVariationResolution::Base
        } else {
            ShiftComponentVariationResolution::Interpolated {
                source_count: self.source_count,
            }
        };

        ResolvedComponentVariationState {
            values,
            transform,
            resolution,
            source: exact_source,
        }
    }

    fn dynamic_points(
        &self,
        axis_ids: &[String],
        base_values: &BTreeMap<String, ShiftResolvedAxisValue>,
        base_transform: DecomposedTransform,
    ) -> HashMap<shift_ir::variation::NormalizedLocation, Vec<f64>> {
        let mut points = HashMap::new();
        points.insert(
            self.default_location.clone(),
            component_state_values(axis_ids, base_values, base_transform),
        );

        for source in &self.sources {
            let mut source_values = base_values.clone();
            for (axis_id, value) in &source.location {
                source_values.insert(
                    axis_id.clone(),
                    ShiftResolvedAxisValue {
                        value: *value,
                        source: ShiftResolvedAxisValueSource::ComponentVariationSource,
                    },
                );
            }
            points.insert(
                source.parent_location.clone(),
                component_state_values(
                    axis_ids,
                    &source_values,
                    source.transform.unwrap_or(base_transform),
                ),
            );
        }

        points
    }

    fn unsupported(
        &self,
        values: BTreeMap<String, ShiftResolvedAxisValue>,
        transform: DecomposedTransform,
        reason: ShiftComponentVariationUnsupportedReason,
    ) -> ResolvedComponentVariationState {
        ResolvedComponentVariationState {
            values,
            transform,
            resolution: ShiftComponentVariationResolution::Unsupported { reason },
            source: None,
        }
    }
}

impl CompiledAxisMapping {
    fn resolve(
        &self,
        location: &BTreeMap<String, ShiftMappedAxisValue>,
    ) -> Result<BTreeMap<String, f64>, ShiftAxisMappingDiagnosticKind> {
        match &self.kind {
            CompiledAxisMappingKind::Static { output } => Ok(output.clone()),
            CompiledAxisMappingKind::OneDimensional {
                input_axis_id,
                samples,
            } => self.resolve_one_dimensional(input_axis_id, samples, location),
            CompiledAxisMappingKind::MultiDimensional { input_axes, model } => {
                self.resolve_multi_dimensional(input_axes, model, location)
            }
        }
    }

    fn resolve_one_dimensional(
        &self,
        input_axis_id: &str,
        samples: &[(f64, BTreeMap<String, f64>)],
        location: &BTreeMap<String, ShiftMappedAxisValue>,
    ) -> Result<BTreeMap<String, f64>, ShiftAxisMappingDiagnosticKind> {
        let value = location
            .get(input_axis_id)
            .expect("package validation rejects missing mapping input axes")
            .value;

        if let Some((_, output)) = samples.iter().find(|(input, _)| *input == value) {
            return Ok(output.clone());
        }

        let lower = samples.iter().rev().find(|(input, _)| *input <= value);
        let upper = samples.iter().find(|(input, _)| *input >= value);
        let (Some((lower_input, lower_output)), Some((upper_input, upper_output))) = (lower, upper)
        else {
            return Err(ShiftAxisMappingDiagnosticKind::OutsideSampleRange {
                axis_id: input_axis_id.to_string(),
                value,
            });
        };

        let span = upper_input - lower_input;
        if span == 0.0 {
            return Ok(lower_output.clone());
        }
        let t = (value - lower_input) / span;
        self.interpolate_outputs(lower_output, upper_output, t)
    }

    fn resolve_multi_dimensional(
        &self,
        input_axes: &[CompiledAxisMappingInputAxis],
        model: &Result<NormalizedF64VariationModel, String>,
        location: &BTreeMap<String, ShiftMappedAxisValue>,
    ) -> Result<BTreeMap<String, f64>, ShiftAxisMappingDiagnosticKind> {
        let model =
            model
                .as_ref()
                .map_err(|message| ShiftAxisMappingDiagnosticKind::ModelError {
                    message: message.clone(),
                })?;
        let axis_tags = input_axes
            .iter()
            .map(|axis| axis.tag.as_str())
            .collect::<Vec<_>>();
        let query_location = normalized_location_from_values(axis_tags.iter().copied(), |tag| {
            let axis = input_axes
                .iter()
                .find(|axis| axis.tag == tag)
                .expect("axis tag comes from input axes");
            normalize_axis_value(
                location
                    .get(&axis.id)
                    .expect("package validation rejects missing mapping input axes")
                    .value,
                axis.minimum,
                axis.default,
                axis.maximum,
            )
        });
        let values = model.interpolate(&query_location);
        if values.len() != self.output_axes.len() {
            return Err(ShiftAxisMappingDiagnosticKind::ModelError {
                message: format!(
                    "axis mapping model produced {} output values for {} output axes",
                    values.len(),
                    self.output_axes.len()
                ),
            });
        }

        Ok(self
            .output_axes
            .iter()
            .zip(values)
            .map(|(axis_id, value)| (axis_id.clone(), value))
            .collect())
    }

    fn interpolate_outputs(
        &self,
        lower_output: &BTreeMap<String, f64>,
        upper_output: &BTreeMap<String, f64>,
        t: f64,
    ) -> Result<BTreeMap<String, f64>, ShiftAxisMappingDiagnosticKind> {
        let mut output = BTreeMap::new();

        for axis_id in &self.output_axes {
            let Some(lower_value) = lower_output.get(axis_id) else {
                return Err(ShiftAxisMappingDiagnosticKind::MissingSampleOutput {
                    axis_id: axis_id.clone(),
                });
            };
            let Some(upper_value) = upper_output.get(axis_id) else {
                return Err(ShiftAxisMappingDiagnosticKind::MissingSampleOutput {
                    axis_id: axis_id.clone(),
                });
            };
            output.insert(
                axis_id.clone(),
                lower_value + ((upper_value - lower_value) * t),
            );
        }

        Ok(output)
    }
}

fn build_working_source_views(
    package: &ShiftPackage,
) -> ShiftSourceResult<ShiftWorkingSourceViews> {
    package.validate()?;
    let dependency_index = build_dependency_index(package)?;
    let interpolation_compatibility_index = build_interpolation_compatibility_index(package)?;
    let axis_mapping_resolvers = compile_axis_mapping_resolvers(package);
    let component_variation_resolvers = compile_component_variation_resolvers(package);

    Ok(ShiftWorkingSourceViews {
        dependency_index,
        interpolation_compatibility_index,
        axis_mapping_resolvers,
        component_variation_resolvers,
    })
}

fn refresh_component_base_glyph_names(
    package: &mut ShiftPackage,
    base_glyph_id: &str,
    base_glyph_name: &str,
) {
    for glyph in &mut package.glyphs {
        for layer in glyph.layers.values_mut() {
            for component in &mut layer.components {
                if component.base_glyph_id == base_glyph_id {
                    component.base_glyph_name = base_glyph_name.to_string();
                }
            }
        }
    }
}

fn remove_component_references_to_base(
    package: &mut ShiftPackage,
    base_glyph_id: &str,
) -> Vec<ShiftComponentUse> {
    let mut removed = Vec::new();
    for glyph in &mut package.glyphs {
        for (layer_id, layer) in &mut glyph.layers {
            let mut kept_components = Vec::with_capacity(layer.components.len());
            for component in layer.components.drain(..) {
                if component.base_glyph_id == base_glyph_id {
                    removed.push(ShiftComponentUse {
                        glyph_id: glyph.id.clone(),
                        glyph_name: glyph.name.clone(),
                        layer_id: layer_id.clone(),
                        component_id: component.id,
                    });
                } else {
                    kept_components.push(component);
                }
            }
            layer.components = kept_components;
        }
    }

    removed.sort_by(|left, right| {
        left.glyph_id
            .cmp(&right.glyph_id)
            .then_with(|| left.layer_id.cmp(&right.layer_id))
            .then_with(|| left.component_id.cmp(&right.component_id))
    });
    removed
}

fn unique_member_id<'a>(
    prefix: &str,
    label: &str,
    existing_ids: impl IntoIterator<Item = &'a str>,
) -> String {
    let existing_ids = existing_ids.into_iter().collect::<BTreeSet<_>>();
    let base_id = readable_member_id(prefix, label);
    if !existing_ids.contains(base_id.as_str()) {
        return base_id;
    }

    for suffix in 2.. {
        let candidate = format!("{base_id}_{suffix}");
        if !existing_ids.contains(candidate.as_str()) {
            return candidate;
        }
    }

    unreachable!("unbounded suffix search should always find an unused stable id")
}

fn unique_member_name<'a>(
    label: &str,
    existing_names: impl IntoIterator<Item = &'a str>,
) -> String {
    unique_member_name_with_fallback(label, "newGlyph", existing_names)
}

fn unique_member_name_with_fallback<'a>(
    label: &str,
    fallback_name: &str,
    existing_names: impl IntoIterator<Item = &'a str>,
) -> String {
    let existing_names = existing_names.into_iter().collect::<BTreeSet<_>>();
    let base_name = if label.is_empty() {
        fallback_name
    } else {
        label
    };
    if !existing_names.contains(base_name) {
        return base_name.to_string();
    }

    for suffix in 1.. {
        let candidate = format!("{base_name}.{suffix}");
        if !existing_names.contains(candidate.as_str()) {
            return candidate;
        }
    }

    unreachable!("unbounded suffix search should always find an unused glyph name")
}

fn readable_member_id(prefix: &str, label: &str) -> String {
    let mut id = String::with_capacity(prefix.len() + label.len() + 1);
    id.push_str(prefix);

    let mut has_label = false;
    for ch in label.chars() {
        if ch.is_ascii_alphanumeric() {
            if !has_label {
                id.push('_');
                has_label = true;
            }
            id.push(ch);
        } else if has_label && !id.ends_with('_') {
            id.push('_');
        }
    }

    id.trim_end_matches('_').to_string()
}

fn canonical_unicode_values(
    glyph_name: &str,
    unicodes: Vec<String>,
) -> ShiftSourceResult<Vec<String>> {
    unicodes
        .into_iter()
        .map(|unicode| {
            parse_unicode_scalar(glyph_name, &unicode).map(|parsed| format!("{parsed:04X}"))
        })
        .collect()
}

fn compile_axis_mapping_resolvers(package: &ShiftPackage) -> Vec<CompiledAxisMapping> {
    package
        .axis_mappings
        .iter()
        .map(|mapping| compile_axis_mapping_resolver(mapping, &package.axes))
        .collect()
}

fn compile_axis_mapping_resolver(
    mapping: &ShiftAxisMapping,
    axes: &[ShiftAxis],
) -> CompiledAxisMapping {
    let output_axes = mapping.output_axes.clone();
    let kind = if mapping.input_axes.is_empty() {
        CompiledAxisMappingKind::Static {
            output: mapping
                .samples
                .first()
                .expect("package validation rejects empty mappings")
                .output_location
                .clone(),
        }
    } else if mapping.input_axes.len() == 1 {
        let input_axis_id = mapping.input_axes[0].clone();
        let mut samples = mapping
            .samples
            .iter()
            .map(|sample| {
                (
                    *sample
                        .input_location
                        .get(&input_axis_id)
                        .expect("package validation rejects missing mapping sample inputs"),
                    sample.output_location.clone(),
                )
            })
            .collect::<Vec<_>>();
        samples.sort_by(|left, right| left.0.total_cmp(&right.0));

        CompiledAxisMappingKind::OneDimensional {
            input_axis_id,
            samples,
        }
    } else {
        compile_multi_axis_mapping_kind(mapping, axes)
    };

    CompiledAxisMapping {
        id: mapping.id.clone(),
        output_axes,
        kind,
    }
}

fn compile_multi_axis_mapping_kind(
    mapping: &ShiftAxisMapping,
    axes: &[ShiftAxis],
) -> CompiledAxisMappingKind {
    let input_axes = mapping
        .input_axes
        .iter()
        .map(|axis_id| {
            let axis = axes
                .iter()
                .find(|axis| axis.id == *axis_id)
                .expect("package validation rejects missing mapping input axes");
            CompiledAxisMappingInputAxis {
                id: axis.id.clone(),
                tag: axis.tag.clone(),
                minimum: axis.minimum,
                default: axis.default,
                maximum: axis.maximum,
            }
        })
        .collect::<Vec<_>>();
    let axis_tags = input_axes
        .iter()
        .map(|axis| axis.tag.as_str())
        .collect::<Vec<_>>();
    let axis_order = variation_axis_order(axis_tags.iter().copied());
    let mut points = HashMap::new();

    for sample in &mapping.samples {
        let mut normalized_sample_values = BTreeMap::new();
        for axis in &input_axes {
            let value = sample
                .input_location
                .get(&axis.id)
                .expect("package validation rejects missing mapping sample inputs");
            normalized_sample_values.insert(
                axis.tag.as_str(),
                normalize_axis_value(*value, axis.minimum, axis.default, axis.maximum),
            );
        }
        let sample_location = normalized_location_from_values(axis_tags.iter().copied(), |tag| {
            *normalized_sample_values.get(tag).unwrap_or(&0.0)
        });
        points.insert(sample_location, mapping_output_values(mapping, sample));
    }

    let model = NormalizedF64VariationModel::new(&points, axis_order, RoundingBehaviour::None)
        .map_err(|message| message.to_string());
    CompiledAxisMappingKind::MultiDimensional { input_axes, model }
}

fn mapping_output_values(mapping: &ShiftAxisMapping, sample: &ShiftAxisMappingSample) -> Vec<f64> {
    mapping
        .output_axes
        .iter()
        .map(|axis_id| {
            *sample
                .output_location
                .get(axis_id)
                .expect("package validation rejects missing mapping sample outputs")
        })
        .collect()
}

fn compile_component_variation_resolvers(
    package: &ShiftPackage,
) -> HashMap<ComponentVariationResolverKey, CompiledComponentVariationResolver> {
    let mut resolvers = HashMap::new();
    for glyph in &package.glyphs {
        for (layer_id, layer) in &glyph.layers {
            for component in &layer.components {
                if component.variation_sources.is_empty() {
                    continue;
                }
                let base_glyph = package
                    .glyphs
                    .iter()
                    .find(|base_glyph| base_glyph.id == component.base_glyph_id)
                    .expect("package validation rejects missing component base glyphs");
                resolvers.insert(
                    ComponentVariationResolverKey::new(&glyph.id, layer_id, &component.id),
                    compile_component_variation_resolver(package, component, base_glyph),
                );
            }
        }
    }
    resolvers
}

fn compile_component_variation_resolver(
    package: &ShiftPackage,
    component: &ShiftComponent,
    base_glyph: &ShiftGlyph,
) -> CompiledComponentVariationResolver {
    let default_location = normalized_default_location_for_axes(&package.axes);
    let sources = component
        .variation_sources
        .iter()
        .map(|source| CompiledComponentVariationSource {
            id: source.id.clone(),
            name: source.name.clone(),
            parent_location: normalized_component_parent_location_for_axes(
                &package.axes,
                &source.parent_location,
            ),
            location: source.location.clone(),
            transform: source.transform,
        })
        .collect::<Vec<_>>();
    let source_count = sources.len() + 1;
    let kind = if component_requires_dynamic_variation_values(package, component) {
        compile_dynamic_component_variation_kind(package, component, base_glyph, &default_location)
    } else {
        compile_fixed_component_variation_kind(package, component, base_glyph, &default_location)
    };

    CompiledComponentVariationResolver {
        source_count,
        default_location,
        sources,
        kind,
    }
}

fn component_requires_dynamic_variation_values(
    package: &ShiftPackage,
    component: &ShiftComponent,
) -> bool {
    if component.axis_inheritance != crate::package::ShiftAxisInheritance::InheritParent {
        return false;
    }

    component.variation_sources.iter().any(|source| {
        source.location.keys().any(|axis_id| {
            !component.location.contains_key(axis_id)
                && package.axes.iter().any(|axis| axis.id == *axis_id)
        })
    })
}

fn compile_dynamic_component_variation_kind(
    package: &ShiftPackage,
    component: &ShiftComponent,
    base_glyph: &ShiftGlyph,
    default_location: &shift_ir::variation::NormalizedLocation,
) -> CompiledComponentVariationResolverKind {
    let axis_ids = dynamic_component_axis_ids(package, component, base_glyph);
    let axis_order = variation_axis_order(package.axes.iter().map(|axis| axis.tag.as_str()));
    let mut locations = Vec::with_capacity(component.variation_sources.len() + 1);
    locations.push(default_location.clone());
    locations.extend(component.variation_sources.iter().map(|source| {
        normalized_component_parent_location_for_axes(&package.axes, &source.parent_location)
    }));
    let space = NormalizedF64VariationSpace::new(locations, axis_order);
    CompiledComponentVariationResolverKind::DynamicQueryValues {
        axis_ids,
        space: Box::new(space),
    }
}

fn dynamic_component_axis_ids(
    package: &ShiftPackage,
    component: &ShiftComponent,
    base_glyph: &ShiftGlyph,
) -> Vec<String> {
    let mut axis_ids = package
        .axes
        .iter()
        .map(|axis| axis.id.clone())
        .collect::<BTreeSet<_>>();
    axis_ids.extend(base_glyph.local_axes.iter().map(|axis| axis.id.clone()));
    axis_ids.extend(component.location.keys().cloned());
    axis_ids.extend(
        component
            .variation_sources
            .iter()
            .flat_map(|source| source.location.keys().cloned()),
    );
    axis_ids.into_iter().collect()
}

fn compile_fixed_component_variation_kind(
    package: &ShiftPackage,
    component: &ShiftComponent,
    base_glyph: &ShiftGlyph,
    default_location: &shift_ir::variation::NormalizedLocation,
) -> CompiledComponentVariationResolverKind {
    let axis_ids = component
        .variation_sources
        .iter()
        .flat_map(|source| source.location.keys().cloned())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let base_values = fixed_component_axis_values(package, component, base_glyph, &axis_ids);
    let mut points = HashMap::new();
    points.insert(
        default_location.clone(),
        component_state_values(&axis_ids, &base_values, component.transform),
    );

    for source in &component.variation_sources {
        let mut source_values =
            fixed_component_axis_values(package, component, base_glyph, &axis_ids);
        for (axis_id, value) in &source.location {
            source_values.insert(
                axis_id.clone(),
                ShiftResolvedAxisValue {
                    value: *value,
                    source: ShiftResolvedAxisValueSource::ComponentVariationSource,
                },
            );
        }
        let source_location =
            normalized_component_parent_location_for_axes(&package.axes, &source.parent_location);
        points.insert(
            source_location,
            component_state_values(
                &axis_ids,
                &source_values,
                source.transform.unwrap_or(component.transform),
            ),
        );
    }

    let axis_order = variation_axis_order(package.axes.iter().map(|axis| axis.tag.as_str()));
    let model = NormalizedF64VariationModel::new(&points, axis_order, RoundingBehaviour::None);
    CompiledComponentVariationResolverKind::Fixed {
        axis_ids,
        model: Box::new(model),
    }
}

fn fixed_component_axis_values(
    package: &ShiftPackage,
    component: &ShiftComponent,
    base_glyph: &ShiftGlyph,
    axis_ids: &[String],
) -> BTreeMap<String, ShiftResolvedAxisValue> {
    axis_ids
        .iter()
        .map(|axis_id| {
            let value = fixed_component_axis_value(package, component, base_glyph, axis_id);
            (
                axis_id.clone(),
                ShiftResolvedAxisValue {
                    value,
                    source: fixed_component_axis_source(package, component, base_glyph, axis_id),
                },
            )
        })
        .collect()
}

fn fixed_component_axis_value(
    package: &ShiftPackage,
    component: &ShiftComponent,
    base_glyph: &ShiftGlyph,
    axis_id: &str,
) -> f64 {
    if let Some(value) = component.location.get(axis_id) {
        return *value;
    }
    if let Some(axis) = package.axes.iter().find(|axis| axis.id == axis_id) {
        return axis.default;
    }
    base_glyph
        .local_axes
        .iter()
        .find(|axis| axis.id == axis_id)
        .map(|axis| axis.default)
        .expect("package validation rejects missing component variation axes")
}

fn fixed_component_axis_source(
    package: &ShiftPackage,
    component: &ShiftComponent,
    base_glyph: &ShiftGlyph,
    axis_id: &str,
) -> ShiftResolvedAxisValueSource {
    if component.location.contains_key(axis_id) {
        return ShiftResolvedAxisValueSource::ComponentOverride;
    }
    if package.axes.iter().any(|axis| axis.id == axis_id) {
        return ShiftResolvedAxisValueSource::FontDefault;
    }
    if base_glyph.local_axes.iter().any(|axis| axis.id == axis_id) {
        return ShiftResolvedAxisValueSource::BaseLocalDefault;
    }
    ShiftResolvedAxisValueSource::ComponentVariationSource
}
