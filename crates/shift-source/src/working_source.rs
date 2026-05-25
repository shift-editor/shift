use crate::error::{ShiftSourceError, ShiftSourceResult};
use crate::package::{
    build_dependency_index, build_interpolation_compatibility_index, diff_packages,
    fingerprint_package, fingerprint_relative_paths, prepare_package_commit, ShiftAxis,
    ShiftAxisMapping, ShiftAxisMappingSample, ShiftComponent, ShiftComponentUse, ShiftCondition,
    ShiftDependencyIndex, ShiftFileFingerprint, ShiftGlyph, ShiftGlyphDependencies,
    ShiftGlyphInterpolationCompatibility, ShiftInterpolationCompatibilityIndex, ShiftPackage,
    ShiftPackageDiff, ShiftPackageFingerprint, ShiftPreparedCommit,
};
use serde::{Deserialize, Serialize};
use shift_ir::variation::{
    normalized_location_from_values, variation_axis_order, NormalizedF64VariationModel,
    RoundingBehaviour,
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
    revision: u64,
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

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftComponentActivity {
    pub glyph_id: String,
    pub glyph_name: String,
    pub layer_id: String,
    pub component_id: String,
    pub base_glyph_id: String,
    pub base_glyph_name: String,
    pub active: bool,
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
pub struct ShiftComponentResolvedState {
    pub glyph_id: String,
    pub glyph_name: String,
    pub layer_id: String,
    pub component_id: String,
    pub base_glyph_id: String,
    pub base_glyph_name: String,
    pub active: bool,
    pub axis_inheritance: crate::package::ShiftAxisInheritance,
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

impl ShiftWorkingSource {
    pub fn new(package: ShiftPackage) -> ShiftSourceResult<Self> {
        package.validate()?;
        let dependency_index = build_dependency_index(&package)?;
        let interpolation_compatibility_index = build_interpolation_compatibility_index(&package)?;
        let axis_mapping_resolvers = compile_axis_mapping_resolvers(&package);

        Ok(Self {
            saved_package: package.clone(),
            package,
            saved_fingerprint: None,
            dependency_index,
            interpolation_compatibility_index,
            axis_mapping_resolvers,
            revision: 0,
        })
    }

    pub fn open_saved(root: impl AsRef<Path>, package: ShiftPackage) -> ShiftSourceResult<Self> {
        package.validate()?;
        let saved_fingerprint = fingerprint_package(root)?;
        let dependency_index = build_dependency_index(&package)?;
        let interpolation_compatibility_index = build_interpolation_compatibility_index(&package)?;
        let axis_mapping_resolvers = compile_axis_mapping_resolvers(&package);

        Ok(Self {
            saved_package: package.clone(),
            package,
            saved_fingerprint: Some(saved_fingerprint),
            dependency_index,
            interpolation_compatibility_index,
            axis_mapping_resolvers,
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

        Ok(ShiftDeleteGlyphPreview {
            glyph_id: dependencies.glyph_id.clone(),
            glyph_name: dependencies.glyph_name.clone(),
            component_dependents: dependencies.component_dependents.clone(),
            can_remove_without_decomposing: dependencies.component_dependents.is_empty(),
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
                let active = component
                    .condition
                    .as_ref()
                    .map(|condition| self.condition_matches(&glyph.name, condition, location))
                    .transpose()?
                    .unwrap_or(true);

                Ok(ShiftComponentActivity {
                    glyph_id: glyph.id.clone(),
                    glyph_name: glyph.name.clone(),
                    layer_id: layer_id.to_string(),
                    component_id: component.id.clone(),
                    base_glyph_id: component.base_glyph_id.clone(),
                    base_glyph_name: component.base_glyph_name.clone(),
                    active,
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

        Ok(layer
            .components
            .iter()
            .map(|component| component_recipe_summary(glyph, layer_id, component))
            .collect())
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

                    let summary = component_recipe_summary(glyph, layer_id, component);
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
                let active = component
                    .condition
                    .as_ref()
                    .map(|condition| self.condition_matches(&glyph.name, condition, location))
                    .transpose()?
                    .unwrap_or(true);
                let base_glyph = self.glyph(&component.base_glyph_id)?;
                let values = self.resolve_component_axis_values(component, base_glyph, location);

                Ok(ShiftComponentResolvedLocation {
                    glyph_id: glyph.id.clone(),
                    glyph_name: glyph.name.clone(),
                    layer_id: layer_id.to_string(),
                    component_id: component.id.clone(),
                    base_glyph_id: component.base_glyph_id.clone(),
                    base_glyph_name: component.base_glyph_name.clone(),
                    active,
                    axis_inheritance: component.axis_inheritance,
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
                let active = component
                    .condition
                    .as_ref()
                    .map(|condition| self.condition_matches(&glyph.name, condition, location))
                    .transpose()?
                    .unwrap_or(true);
                let base_glyph = self.glyph(&component.base_glyph_id)?;
                let base_values =
                    self.resolve_component_axis_values(component, base_glyph, location);
                let resolved = if active {
                    self.resolve_component_variation_state(
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
                    base_glyph_name: component.base_glyph_name.clone(),
                    active,
                    axis_inheritance: component.axis_inheritance,
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
        self.saved_package = self.package.clone();
        self.saved_fingerprint = Some(fingerprint_package(root)?);
        self.revision = 0;
        Ok(())
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
        let index = self
            .package
            .glyphs
            .iter()
            .position(|glyph| glyph.id == glyph_id)
            .ok_or_else(|| ShiftSourceError::MissingGlyph {
                glyph_id: glyph_id.to_string(),
            })?;
        self.package.glyphs.remove(index);
        self.refresh_indexes()?;

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

    pub fn rename_glyph(
        &mut self,
        glyph_id: &str,
        new_name: impl Into<String>,
    ) -> ShiftSourceResult<ShiftRenameGlyphReport> {
        let new_name = new_name.into();
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

        let before = self.package.clone();
        let glyph = self
            .package
            .glyphs
            .iter_mut()
            .find(|glyph| glyph.id == glyph_id)
            .ok_or_else(|| ShiftSourceError::MissingGlyph {
                glyph_id: glyph_id.to_string(),
            })?;

        let old_name = glyph.name.clone();
        glyph.name = new_name.clone();
        self.refresh_indexes()?;

        let diff = diff_packages(&before, &self.package)?;
        if !diff.changes.is_empty() {
            self.revision += 1;
        }

        let component_dependents = self
            .glyph_dependencies(glyph_id)?
            .component_dependents
            .clone();

        Ok(ShiftRenameGlyphReport {
            glyph_id: glyph_id.to_string(),
            old_name,
            new_name,
            component_dependents,
            diff,
            revision: self.revision,
        })
    }

    fn refresh_indexes(&mut self) -> ShiftSourceResult<()> {
        self.package.validate()?;
        self.dependency_index = build_dependency_index(&self.package)?;
        self.interpolation_compatibility_index =
            build_interpolation_compatibility_index(&self.package)?;
        self.axis_mapping_resolvers = compile_axis_mapping_resolvers(&self.package);
        Ok(())
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

        let axis_tags = self
            .package
            .axes
            .iter()
            .map(|axis| axis.tag.as_str())
            .collect::<Vec<_>>();
        let axis_order = variation_axis_order(axis_tags.iter().copied());
        let axis_values = self
            .package
            .axes
            .iter()
            .map(|axis| {
                (
                    axis.tag.as_str(),
                    normalize_axis_value(
                        location.get(&axis.id).copied().unwrap_or(axis.default),
                        axis.minimum,
                        axis.default,
                        axis.maximum,
                    ),
                )
            })
            .collect::<BTreeMap<_, _>>();
        let query_location = normalized_location_from_values(axis_tags.iter().copied(), |tag| {
            *axis_values.get(tag).unwrap_or(&0.0)
        });

        let axis_ids = base_values.keys().cloned().collect::<Vec<_>>();
        let mut points = HashMap::new();
        points.insert(
            self.normalized_default_location(),
            component_state_values(&axis_ids, &base_values, base_transform),
        );

        let mut exact_source = None;
        for source in &component.variation_sources {
            let source_location =
                self.normalized_component_parent_location(&source.parent_location);
            if source_location == query_location {
                exact_source = Some(ShiftComponentResolvedVariationSource {
                    id: source.id.clone(),
                    name: source.name.clone(),
                });
            }

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
                source_location,
                component_state_values(
                    &axis_ids,
                    &source_values,
                    source.transform.unwrap_or(base_transform),
                ),
            );
        }

        let variation_model =
            match NormalizedF64VariationModel::new(&points, axis_order, RoundingBehaviour::None) {
                Ok(model) => model,
                Err(message) => {
                    return ResolvedComponentVariationState {
                        values: base_values,
                        transform: base_transform,
                        resolution: ShiftComponentVariationResolution::Unsupported {
                            reason: ShiftComponentVariationUnsupportedReason::ModelError {
                                message,
                            },
                        },
                        source: None,
                    };
                }
            };

        let values = variation_model.interpolate(&query_location);
        if values.is_empty() {
            return ResolvedComponentVariationState {
                values: base_values,
                transform: base_transform,
                resolution: ShiftComponentVariationResolution::Unsupported {
                    reason: ShiftComponentVariationUnsupportedReason::ModelError {
                        message: "variation model produced no component values".to_string(),
                    },
                },
                source: None,
            };
        }

        let (values, transform) = component_state_from_values(&axis_ids, &base_values, &values);
        let resolution = if let Some(source) = exact_source.clone() {
            ShiftComponentVariationResolution::ExactSource { source }
        } else if query_location == self.normalized_default_location() {
            ShiftComponentVariationResolution::Base
        } else {
            ShiftComponentVariationResolution::Interpolated {
                source_count: component.variation_sources.len() + 1,
            }
        };

        ResolvedComponentVariationState {
            values,
            transform,
            resolution,
            source: exact_source,
        }
    }

    fn normalized_default_location(&self) -> shift_ir::variation::NormalizedLocation {
        normalized_location_from_values(
            self.package.axes.iter().map(|axis| axis.tag.as_str()),
            |_| 0.0,
        )
    }

    fn normalized_component_parent_location(
        &self,
        parent_location: &BTreeMap<String, f64>,
    ) -> shift_ir::variation::NormalizedLocation {
        let axis_values = self
            .package
            .axes
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

        normalized_location_from_values(
            self.package.axes.iter().map(|axis| axis.tag.as_str()),
            |tag| *axis_values.get(tag).unwrap_or(&0.0),
        )
    }

    fn condition_matches(
        &self,
        glyph_name: &str,
        condition: &ShiftCondition,
        location: &BTreeMap<String, f64>,
    ) -> ShiftSourceResult<bool> {
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

                Ok(min.is_none_or(|min| value >= min) && max.is_none_or(|max| value <= max))
            }
            ShiftCondition::And { conditions } => {
                conditions.iter().try_fold(true, |active, condition| {
                    Ok(active && self.condition_matches(glyph_name, condition, location)?)
                })
            }
            ShiftCondition::Or { conditions } => {
                conditions.iter().try_fold(false, |active, condition| {
                    Ok(active || self.condition_matches(glyph_name, condition, location)?)
                })
            }
            ShiftCondition::Not { condition } => {
                Ok(!self.condition_matches(glyph_name, condition, location)?)
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
        base_glyph_name: component.base_glyph_name.clone(),
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
