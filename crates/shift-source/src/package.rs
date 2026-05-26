use crate::error::{ShiftSourceError, ShiftSourceResult};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use shift_ir::{
    Anchor, Axis, AxisId, AxisInheritance, Component, ComponentCondition, ComponentLocation,
    Contour, DecomposedTransform, Font, FontMetadata, FontMetrics, Glyph, GlyphId, GlyphLayer,
    Guideline, Location, Point, PointType, Source,
};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub const SHIFT_SOURCE_FORMAT: &str = "shift-source";
pub const SHIFT_SOURCE_VERSION: u32 = 1;
pub const SHIFT_DEPENDENCY_INDEX_VERSION: u32 = 1;
pub const SHIFT_INTERPOLATION_COMPATIBILITY_INDEX_VERSION: u32 = 1;
pub const DEPENDENCY_INDEX_PATH: &str = "derived/dependencies.json";
pub const INTERPOLATION_COMPATIBILITY_INDEX_PATH: &str = "derived/interpolation-compatibility.json";
const FNV_64_OFFSET_BASIS: u64 = 0xcbf29ce484222325;
const FNV_64_PRIME: u64 = 0x100000001b3;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftManifest {
    pub format: String,
    pub version: u32,
    pub family_id: String,
    pub default_source_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftFontInfo {
    pub metadata: FontMetadata,
    pub metrics: FontMetrics,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftAxis {
    pub id: String,
    pub tag: String,
    pub name: String,
    pub minimum: f64,
    pub default: f64,
    pub maximum: f64,
    pub hidden: bool,
    #[serde(default)]
    pub role: ShiftAxisRole,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ShiftAxisRole {
    #[default]
    UserFacing,
    Internal,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftSource {
    pub id: String,
    pub name: String,
    pub location: BTreeMap<String, f64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftAxisMapping {
    pub id: String,
    pub name: String,
    pub input_axes: Vec<String>,
    pub output_axes: Vec<String>,
    pub samples: Vec<ShiftAxisMappingSample>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftAxisMappingSample {
    pub input_location: BTreeMap<String, f64>,
    pub output_location: BTreeMap<String, f64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ShiftPointType {
    OnCurve,
    OffCurve,
    QCurve,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftPoint {
    pub x: f64,
    pub y: f64,
    pub point_type: ShiftPointType,
    pub smooth: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftContour {
    pub points: Vec<ShiftPoint>,
    pub closed: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftComponent {
    pub id: String,
    pub base_glyph_id: String,
    pub base_glyph_name: String,
    pub transform: DecomposedTransform,
    #[serde(default)]
    pub location: BTreeMap<String, f64>,
    #[serde(default)]
    pub axis_inheritance: ShiftAxisInheritance,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub variation_sources: Vec<ShiftComponentVariationSource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub condition: Option<ShiftCondition>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftComponentVariationSource {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub parent_location: BTreeMap<String, f64>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub location: BTreeMap<String, f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transform: Option<DecomposedTransform>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ShiftAxisInheritance {
    #[default]
    InheritParent,
    ResetUnspecifiedToFont,
}

impl ShiftAxisInheritance {
    fn into_ir(self) -> AxisInheritance {
        match self {
            Self::InheritParent => AxisInheritance::InheritParent,
            Self::ResetUnspecifiedToFont => AxisInheritance::ResetUnspecifiedToDefault,
        }
    }

    fn from_ir(axis_inheritance: AxisInheritance) -> Self {
        match axis_inheritance {
            AxisInheritance::InheritParent => Self::InheritParent,
            AxisInheritance::ResetUnspecifiedToDefault => Self::ResetUnspecifiedToFont,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ShiftCondition {
    AxisRange {
        axis_id: String,
        min: Option<f64>,
        max: Option<f64>,
    },
    And {
        conditions: Vec<ShiftCondition>,
    },
    Or {
        conditions: Vec<ShiftCondition>,
    },
    Not {
        condition: Box<ShiftCondition>,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftGlyphLayer {
    pub advance_width: f64,
    pub advance_height: Option<f64>,
    pub contours: Vec<ShiftContour>,
    pub components: Vec<ShiftComponent>,
    pub anchors: Vec<Anchor>,
    pub guidelines: Vec<Guideline>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftGlyph {
    pub id: String,
    pub name: String,
    pub unicodes: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub local_axes: Vec<ShiftGlyphAxis>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub variation_sources: Vec<ShiftGlyphSource>,
    pub layers: BTreeMap<String, ShiftGlyphLayer>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftGlyphAxis {
    pub id: String,
    pub name: String,
    pub minimum: f64,
    pub default: f64,
    pub maximum: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftGlyphSource {
    pub id: String,
    pub name: String,
    pub location: BTreeMap<String, f64>,
    pub layer_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftPackage {
    pub manifest: ShiftManifest,
    pub font: ShiftFontInfo,
    pub axes: Vec<ShiftAxis>,
    pub sources: Vec<ShiftSource>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub axis_mappings: Vec<ShiftAxisMapping>,
    pub glyphs: Vec<ShiftGlyph>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftDependencyIndex {
    pub version: u32,
    pub glyphs: BTreeMap<String, ShiftGlyphDependencies>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftGlyphDependencies {
    pub glyph_id: String,
    pub glyph_name: String,
    pub component_dependencies: Vec<ShiftComponentUse>,
    pub component_dependents: Vec<ShiftComponentUse>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftInterpolationCompatibilityIndex {
    pub version: u32,
    pub glyphs: BTreeMap<String, ShiftGlyphInterpolationCompatibility>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftGlyphInterpolationCompatibility {
    pub glyph_id: String,
    pub glyph_name: String,
    pub compatible: bool,
    pub layer_signatures: BTreeMap<String, ShiftLayerCompatibilitySignature>,
    pub issues: Vec<ShiftInterpolationCompatibilityIssue>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftLayerCompatibilitySignature {
    pub contour_point_types: Vec<Vec<ShiftPointType>>,
    pub contour_closed: Vec<bool>,
    pub components: Vec<ShiftComponentCompatibilitySignature>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftComponentCompatibilitySignature {
    pub component_id: String,
    pub base_glyph_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftInterpolationCompatibilityIssue {
    pub kind: ShiftInterpolationCompatibilityIssueKind,
    pub reference_layer_id: String,
    pub layer_id: String,
    pub expected: String,
    pub actual: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ShiftInterpolationCompatibilityIssueKind {
    ContourCountMismatch,
    ContourTopologyMismatch,
    ComponentCountMismatch,
    ComponentIdMismatch,
    ComponentBaseMismatch,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftComponentUse {
    pub glyph_id: String,
    pub glyph_name: String,
    pub layer_id: String,
    pub component_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ShiftPackageChange {
    UpdateManifest,
    UpdateFontInfo,
    UpdateAxes,
    UpdateSources,
    UpdateAxisMappings,
    CreateGlyph { glyph_id: String },
    UpdateGlyph { glyph_id: String },
    RenameGlyph { glyph_id: String },
    DeleteGlyph { glyph_id: String },
    RebuildDerivedIndexes,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftWriteImpact {
    pub canonical_paths: Vec<String>,
    pub removed_canonical_paths: Vec<String>,
    pub derived_paths: Vec<String>,
}

impl ShiftWriteImpact {
    pub fn package_relative_paths(&self) -> Vec<String> {
        let mut paths = BTreeSet::new();
        paths.extend(self.canonical_paths.iter().cloned());
        paths.extend(self.removed_canonical_paths.iter().cloned());
        paths.extend(self.derived_paths.iter().cloned());
        paths.into_iter().collect()
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ShiftPackageDiff {
    pub changes: Vec<ShiftPackageChange>,
    pub impact: ShiftWriteImpact,
}

impl Serialize for ShiftPackageDiff {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Serializable<'a> {
            changes: &'a [ShiftPackageChange],
            impact: &'a ShiftWriteImpact,
        }

        Serializable {
            changes: &self.changes,
            impact: &self.impact,
        }
        .serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for ShiftPackageDiff {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Serializable {
            changes: Vec<ShiftPackageChange>,
            impact: ShiftWriteImpact,
        }

        let value = Serializable::deserialize(deserializer)?;
        Ok(Self {
            changes: value.changes,
            impact: value.impact,
        })
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftPackageFingerprint {
    pub files: BTreeMap<String, ShiftFileFingerprint>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftFileFingerprint {
    pub exists: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftFingerprintConflict {
    pub path: String,
    pub kind: ShiftFingerprintConflictKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected: Option<ShiftFileFingerprint>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actual: Option<ShiftFileFingerprint>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ShiftFingerprintConflictKind {
    Created,
    Deleted,
    Modified,
    MissingExpectedFingerprint,
    MissingActualFingerprint,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftPreparedCommit {
    pub diff: ShiftPackageDiff,
    pub impacted_paths: Vec<String>,
    pub expected_fingerprint: ShiftPackageFingerprint,
    pub current_fingerprint: ShiftPackageFingerprint,
    pub conflicts: Vec<ShiftFingerprintConflict>,
    pub operations: Vec<ShiftCommitOperation>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftStagedCommit {
    pub transaction_id: String,
    pub transaction_path: PathBuf,
    pub marker_path: PathBuf,
    pub payload_paths: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftAppliedCommit {
    pub transaction_id: String,
    pub backup_path: PathBuf,
    pub applied_paths: Vec<String>,
    pub backup_paths: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftStagedCommitRecovery {
    pub transaction_id: String,
    pub transaction_path: PathBuf,
    pub marker_path: PathBuf,
    pub live_state: ShiftStagedCommitLiveState,
    pub paths: Vec<ShiftStagedPathRecovery>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prepared: Option<ShiftPreparedCommit>,
    pub issues: Vec<ShiftStagedCommitIssue>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftStagedCommitRecoveryPlan {
    pub transaction_id: String,
    pub action: ShiftStagedCommitRecoveryAction,
    pub live_state: ShiftStagedCommitLiveState,
    pub pending_path_count: usize,
    pub applied_path_count: usize,
    pub diverged_path_count: usize,
    pub issue_count: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftStagedCommitRecoveryRun {
    pub outcomes: Vec<ShiftStagedCommitRecoveryOutcome>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftStagedCommitRecoveryOutcome {
    pub transaction_id: String,
    pub action: ShiftStagedCommitRecoveryAction,
    pub applied_paths: Vec<String>,
    pub backup_paths: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ShiftStagedCommitRecoveryAction {
    Resume,
    Cleanup,
    BlockedByLiveConflict,
    CannotRecover,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ShiftStagedCommitLiveState {
    Unknown,
    Pending,
    PartiallyApplied,
    Applied,
    Diverged,
}

impl ShiftStagedCommitLiveState {
    fn as_str(self) -> &'static str {
        match self {
            Self::Unknown => "unknown",
            Self::Pending => "pending",
            Self::PartiallyApplied => "partiallyApplied",
            Self::Applied => "applied",
            Self::Diverged => "diverged",
        }
    }
}

impl ShiftStagedCommitRecoveryPlan {
    fn from_recovery(recovery: &ShiftStagedCommitRecovery) -> Self {
        let pending_path_count = recovery
            .paths
            .iter()
            .filter(|path| path.live_state == ShiftStagedCommitLiveState::Pending)
            .count();
        let applied_path_count = recovery
            .paths
            .iter()
            .filter(|path| path.live_state == ShiftStagedCommitLiveState::Applied)
            .count();
        let diverged_path_count = recovery
            .paths
            .iter()
            .filter(|path| path.live_state == ShiftStagedCommitLiveState::Diverged)
            .count();
        let issue_count = recovery.issues.len();
        let action = if issue_count > 0 || recovery.prepared.is_none() {
            ShiftStagedCommitRecoveryAction::CannotRecover
        } else if diverged_path_count > 0
            || recovery.live_state == ShiftStagedCommitLiveState::Diverged
        {
            ShiftStagedCommitRecoveryAction::BlockedByLiveConflict
        } else if pending_path_count > 0 {
            ShiftStagedCommitRecoveryAction::Resume
        } else if recovery.live_state == ShiftStagedCommitLiveState::Applied {
            ShiftStagedCommitRecoveryAction::Cleanup
        } else {
            ShiftStagedCommitRecoveryAction::CannotRecover
        };

        Self {
            transaction_id: recovery.transaction_id.clone(),
            action,
            live_state: recovery.live_state,
            pending_path_count,
            applied_path_count,
            diverged_path_count,
            issue_count,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftStagedPathRecovery {
    pub path: String,
    pub live_state: ShiftStagedCommitLiveState,
    pub expected: ShiftFileFingerprint,
    pub current: ShiftFileFingerprint,
    pub applied: ShiftFileFingerprint,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftStagedCommitIssue {
    pub kind: ShiftStagedCommitIssueKind,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ShiftStagedCommitIssueKind {
    MissingMarker,
    InvalidMarker {
        message: String,
    },
    MissingPayload {
        path: String,
    },
    PayloadMismatch {
        path: String,
        expected_size: u64,
        actual_size: u64,
        expected_hash: String,
        actual_hash: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ShiftCommitOperation {
    WriteFile {
        path: String,
        purpose: ShiftCommitOperationPurpose,
        size: u64,
        hash: String,
    },
    RemoveFile {
        path: String,
        purpose: ShiftCommitOperationPurpose,
    },
    InvalidateDerived {
        path: String,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ShiftCommitOperationPurpose {
    Canonical,
    Derived,
}

impl ShiftPackage {
    pub fn from_font(font: &Font) -> Self {
        let source_ids_by_layer = source_ids_by_layer(font);
        let glyph_names_by_id = glyph_names_by_id(font);
        let default_source_id = font
            .default_source()
            .map(|source| source.id_ref().as_str().to_string());

        let mut glyphs: Vec<_> = font
            .glyphs()
            .values()
            .map(|glyph| glyph_from_ir(glyph, &source_ids_by_layer, &glyph_names_by_id))
            .collect();
        glyphs.sort_by(|left, right| left.id.cmp(&right.id));

        Self {
            manifest: ShiftManifest {
                format: SHIFT_SOURCE_FORMAT.to_string(),
                version: SHIFT_SOURCE_VERSION,
                family_id: family_id(font.metadata()),
                default_source_id,
            },
            font: ShiftFontInfo {
                metadata: font.metadata().clone(),
                metrics: *font.metrics(),
            },
            axes: axes_from_ir(font.axes()),
            sources: sources_from_ir(font.sources(), font.axes()),
            axis_mappings: Vec::new(),
            glyphs,
        }
    }

    pub fn into_font(self) -> ShiftSourceResult<Font> {
        self.validate()?;

        let mut font = Font::empty();
        *font.metadata_mut() = self.font.metadata;
        *font.metrics_mut() = self.font.metrics;

        for axis in self.axes {
            font.add_axis(axis.into_ir()?);
        }

        let axis_tags_by_id: HashMap<_, _> = font
            .axes()
            .iter()
            .map(|axis| (axis.id_ref().as_str().to_string(), axis.tag().to_string()))
            .collect();
        let mut layer_ids_by_source_id = HashMap::new();
        let mut is_first_source = true;
        for source in self.sources {
            let layer_id = if is_first_source {
                is_first_source = false;
                let layer_id = font.default_layer_id();
                if let Some(layer) = font.layer_mut(layer_id) {
                    layer.set_name(source.name.clone());
                }
                layer_id
            } else {
                let layer = shift_ir::Layer::new(source.name.clone());
                font.add_layer(layer)
            };
            let source_id = source.id.clone();
            let source = source.into_ir(layer_id, &axis_tags_by_id)?;
            let ir_source_id = font.add_source(source);
            if self.manifest.default_source_id.as_deref() == Some(source_id.as_str()) {
                font.set_default_source_id(ir_source_id);
            }
            layer_ids_by_source_id.insert(source_id, layer_id);
        }

        let glyph_names_by_id: HashMap<_, _> = self
            .glyphs
            .iter()
            .map(|glyph| (glyph.id.clone(), glyph.name.clone()))
            .collect();

        for glyph in self.glyphs {
            let glyph = glyph.into_ir(&layer_ids_by_source_id, &glyph_names_by_id)?;
            font.insert_glyph(glyph);
        }

        Ok(font)
    }

    pub fn validate(&self) -> ShiftSourceResult<()> {
        if self.manifest.format != SHIFT_SOURCE_FORMAT
            || self.manifest.version != SHIFT_SOURCE_VERSION
        {
            return Err(ShiftSourceError::UnsupportedFormat {
                format: self.manifest.format.clone(),
                version: self.manifest.version,
            });
        }
        validate_identifier("manifest family id", &self.manifest.family_id)?;
        validate_font_metrics(&self.font.metrics)?;

        let mut axis_ids = HashSet::new();
        let mut axis_tags = HashSet::new();
        for axis in &self.axes {
            validate_identifier(format!("axis '{}'", axis.name), &axis.id)?;
            validate_axis_tag(&axis.tag)?;
            if !axis_ids.insert(axis.id.as_str()) {
                return Err(ShiftSourceError::DuplicateAxisId {
                    axis_id: axis.id.clone(),
                });
            }
            if !axis_tags.insert(axis.tag.as_str()) {
                return Err(ShiftSourceError::DuplicateAxisTag {
                    axis_tag: axis.tag.clone(),
                });
            }
            validate_axis_range(&axis.id, axis.minimum, axis.default, axis.maximum)?;
        }
        let axis_ranges: HashMap<_, _> = self
            .axes
            .iter()
            .map(|axis| (axis.id.as_str(), (axis.minimum, axis.maximum)))
            .collect();

        if self.sources.is_empty() {
            return Err(ShiftSourceError::EmptySources);
        }

        let mut source_ids = HashSet::new();
        let mut source_locations_by_id = HashMap::new();
        let mut completed_source_locations = HashMap::new();
        for source in &self.sources {
            validate_identifier(format!("source '{}'", source.name), &source.id)?;
            if !source_ids.insert(source.id.as_str()) {
                return Err(ShiftSourceError::DuplicateSourceId {
                    source_id: source.id.clone(),
                });
            }
            source_locations_by_id.insert(source.id.as_str(), &source.location);

            for (axis_id, value) in &source.location {
                if let Some((minimum, maximum)) = axis_ranges.get(axis_id.as_str()) {
                    validate_axis_coordinate(
                        format!("source '{}'", source.id),
                        axis_id,
                        *value,
                        *minimum,
                        *maximum,
                    )?;
                } else {
                    return Err(ShiftSourceError::MissingSourceLocationAxis {
                        source_id: source.id.clone(),
                        axis_id: axis_id.clone(),
                    });
                }
            }
            if !self.axes.is_empty() {
                let location_key = source_location_key(&source.location, &self.axes);
                if let Some(existing_source_id) =
                    completed_source_locations.insert(location_key, source.id.clone())
                {
                    return Err(ShiftSourceError::DuplicateSourceLocation {
                        source_id: source.id.clone(),
                        existing_source_id,
                    });
                }
            }
        }
        let default_source_id = self
            .manifest
            .default_source_id
            .as_deref()
            .ok_or(ShiftSourceError::MissingDefaultSourceId)?;
        if !source_ids.contains(default_source_id) {
            return Err(ShiftSourceError::MissingDefaultSource {
                source_id: default_source_id.to_string(),
            });
        }
        let default_source_location = source_locations_by_id
            .get(default_source_id)
            .expect("default source id existence was checked");
        for axis in &self.axes {
            let value = default_source_location
                .get(&axis.id)
                .copied()
                .unwrap_or(axis.default);
            if value != axis.default {
                return Err(ShiftSourceError::DefaultSourceLocationNotAtAxisDefault {
                    source_id: default_source_id.to_string(),
                    axis_id: axis.id.clone(),
                    value,
                    default: axis.default,
                });
            }
        }

        let mut axis_mapping_ids = HashSet::new();
        let mut axis_mapping_axis_sets = Vec::new();
        for mapping in &self.axis_mappings {
            validate_identifier(format!("axis mapping '{}'", mapping.name), &mapping.id)?;
            if !axis_mapping_ids.insert(mapping.id.as_str()) {
                return Err(ShiftSourceError::DuplicateAxisMappingId {
                    mapping_id: mapping.id.clone(),
                });
            }
            if mapping.samples.is_empty() {
                return Err(ShiftSourceError::EmptyAxisMapping {
                    mapping_id: mapping.id.clone(),
                });
            }
            let mut input_axis_ids = HashSet::new();
            for axis_id in &mapping.input_axes {
                if !input_axis_ids.insert(axis_id.as_str()) {
                    return Err(ShiftSourceError::DuplicateAxisMappingInputAxis {
                        mapping_id: mapping.id.clone(),
                        axis_id: axis_id.clone(),
                    });
                }
                if !axis_ids.contains(axis_id.as_str()) {
                    return Err(ShiftSourceError::MissingAxisMappingInputAxis {
                        mapping_id: mapping.id.clone(),
                        axis_id: axis_id.clone(),
                    });
                }
            }
            let mut output_axis_ids = HashSet::new();
            for axis_id in &mapping.output_axes {
                if !output_axis_ids.insert(axis_id.as_str()) {
                    return Err(ShiftSourceError::DuplicateAxisMappingOutputAxis {
                        mapping_id: mapping.id.clone(),
                        axis_id: axis_id.clone(),
                    });
                }
                if !axis_ids.contains(axis_id.as_str()) {
                    return Err(ShiftSourceError::MissingAxisMappingOutputAxis {
                        mapping_id: mapping.id.clone(),
                        axis_id: axis_id.clone(),
                    });
                }
            }
            axis_mapping_axis_sets.push((mapping.id.as_str(), input_axis_ids, output_axis_ids));
            let mut sample_input_locations = HashMap::new();
            for (sample_index, sample) in mapping.samples.iter().enumerate() {
                if sample.output_location.is_empty() {
                    return Err(ShiftSourceError::EmptyAxisMappingOutput {
                        mapping_id: mapping.id.clone(),
                        sample_index,
                    });
                }
                for axis_id in &mapping.input_axes {
                    if !sample.input_location.contains_key(axis_id) {
                        return Err(ShiftSourceError::MissingAxisMappingSampleInput {
                            mapping_id: mapping.id.clone(),
                            sample_index,
                            axis_id: axis_id.clone(),
                        });
                    }
                }
                for axis_id in &mapping.output_axes {
                    if !sample.output_location.contains_key(axis_id) {
                        return Err(ShiftSourceError::MissingAxisMappingSampleOutput {
                            mapping_id: mapping.id.clone(),
                            sample_index,
                            axis_id: axis_id.clone(),
                        });
                    }
                }
                let input_location_key =
                    axis_mapping_input_location_key(&sample.input_location, &mapping.input_axes);
                if let Some(existing_sample_index) =
                    sample_input_locations.insert(input_location_key, sample_index)
                {
                    return Err(ShiftSourceError::DuplicateAxisMappingSampleInputLocation {
                        mapping_id: mapping.id.clone(),
                        sample_index,
                        existing_sample_index,
                    });
                }
                for (axis_id, value) in &sample.input_location {
                    if !mapping.input_axes.contains(axis_id) {
                        return Err(ShiftSourceError::MissingAxisMappingInputAxis {
                            mapping_id: mapping.id.clone(),
                            axis_id: axis_id.clone(),
                        });
                    }
                    if let Some((minimum, maximum)) = axis_ranges.get(axis_id.as_str()) {
                        validate_axis_coordinate(
                            format!(
                                "axis mapping '{}' sample {} input",
                                mapping.id, sample_index
                            ),
                            axis_id,
                            *value,
                            *minimum,
                            *maximum,
                        )?;
                    }
                }
                for (axis_id, value) in &sample.output_location {
                    if !mapping.output_axes.contains(axis_id) {
                        return Err(ShiftSourceError::MissingAxisMappingOutputAxis {
                            mapping_id: mapping.id.clone(),
                            axis_id: axis_id.clone(),
                        });
                    }
                    if let Some((minimum, maximum)) = axis_ranges.get(axis_id.as_str()) {
                        validate_axis_coordinate(
                            format!(
                                "axis mapping '{}' sample {} output",
                                mapping.id, sample_index
                            ),
                            axis_id,
                            *value,
                            *minimum,
                            *maximum,
                        )?;
                    }
                }
            }
        }
        for (mapping_id, _, output_axes) in &axis_mapping_axis_sets {
            for output_axis_id in output_axes {
                for (input_mapping_id, input_axes, _) in &axis_mapping_axis_sets {
                    if mapping_id == input_mapping_id {
                        continue;
                    }
                    if input_axes.contains(output_axis_id) {
                        return Err(ShiftSourceError::AxisMappingOutputFeedsMappingInput {
                            mapping_id: (*mapping_id).to_string(),
                            input_mapping_id: (*input_mapping_id).to_string(),
                            axis_id: (*output_axis_id).to_string(),
                        });
                    }
                }
            }
        }

        let mut glyph_ids = HashSet::new();
        let mut glyph_names = HashSet::new();
        let mut unicode_owners = HashMap::new();
        let declared_glyph_ids: HashSet<_> =
            self.glyphs.iter().map(|glyph| glyph.id.as_str()).collect();
        let local_axes_by_glyph_id: HashMap<_, _> = self
            .glyphs
            .iter()
            .map(|glyph| {
                (
                    glyph.id.as_str(),
                    glyph
                        .local_axes
                        .iter()
                        .map(|axis| axis.id.as_str())
                        .collect::<HashSet<_>>(),
                )
            })
            .collect();
        let local_axis_ranges_by_glyph_id: HashMap<_, _> = self
            .glyphs
            .iter()
            .map(|glyph| {
                (
                    glyph.id.as_str(),
                    glyph
                        .local_axes
                        .iter()
                        .map(|axis| (axis.id.as_str(), (axis.minimum, axis.maximum)))
                        .collect::<HashMap<_, _>>(),
                )
            })
            .collect();
        for glyph in &self.glyphs {
            validate_identifier(format!("glyph '{}'", glyph.name), &glyph.id)?;
            if glyph.name.trim().is_empty() {
                return Err(ShiftSourceError::InvalidGlyphName {
                    glyph_name: glyph.name.clone(),
                });
            }
            if !glyph_ids.insert(glyph.id.as_str()) {
                return Err(ShiftSourceError::DuplicateGlyphId {
                    glyph_id: glyph.id.clone(),
                });
            }
            if !glyph_names.insert(glyph.name.as_str()) {
                return Err(ShiftSourceError::DuplicateGlyphName {
                    glyph_name: glyph.name.clone(),
                });
            }

            let mut local_axis_ids = HashSet::new();
            for axis in &glyph.local_axes {
                validate_identifier(
                    format!("glyph '{}' local axis '{}'", glyph.name, axis.name),
                    &axis.id,
                )?;
                if axis_ranges.contains_key(axis.id.as_str()) {
                    return Err(ShiftSourceError::GlyphLocalAxisConflictsWithGlobalAxis {
                        glyph_name: glyph.name.clone(),
                        axis_id: axis.id.clone(),
                    });
                }
                if !local_axis_ids.insert(axis.id.as_str()) {
                    return Err(ShiftSourceError::DuplicateGlyphLocalAxis {
                        glyph_name: glyph.name.clone(),
                        axis_id: axis.id.clone(),
                    });
                }
                validate_axis_range(&axis.id, axis.minimum, axis.default, axis.maximum)?;
            }
            let mut variation_source_ids = HashSet::new();
            let mut variation_source_locations = HashMap::new();
            for source in &glyph.variation_sources {
                validate_identifier(
                    format!("glyph '{}' variation source '{}'", glyph.name, source.name),
                    &source.id,
                )?;
                if !variation_source_ids.insert(source.id.as_str()) {
                    return Err(ShiftSourceError::DuplicateGlyphVariationSource {
                        glyph_name: glyph.name.clone(),
                        source_id: source.id.clone(),
                    });
                }
                if !glyph.layers.contains_key(&source.layer_id) {
                    return Err(ShiftSourceError::MissingGlyphVariationLayer {
                        glyph_name: glyph.name.clone(),
                        source_id: source.id.clone(),
                        layer_id: source.layer_id.clone(),
                    });
                }
                let Some(source_location) = source_locations_by_id
                    .get(source.layer_id.as_str())
                    .copied()
                else {
                    return Err(ShiftSourceError::MissingSourceLayer {
                        glyph_name: glyph.name.clone(),
                        source_id: source.layer_id.clone(),
                    });
                };
                let local_axis_ranges = local_axis_ranges_by_glyph_id
                    .get(glyph.id.as_str())
                    .expect("current glyph local ranges should be indexed");
                for (axis_id, value) in &source.location {
                    if let Some((minimum, maximum)) = axis_ranges.get(axis_id.as_str()) {
                        validate_axis_coordinate(
                            format!("glyph '{}' variation source '{}'", glyph.name, source.id),
                            axis_id,
                            *value,
                            *minimum,
                            *maximum,
                        )?;
                    } else if let Some((minimum, maximum)) = local_axis_ranges.get(axis_id.as_str())
                    {
                        validate_axis_coordinate(
                            format!("glyph '{}' variation source '{}'", glyph.name, source.id),
                            axis_id,
                            *value,
                            *minimum,
                            *maximum,
                        )?;
                    } else {
                        return Err(ShiftSourceError::MissingGlyphVariationAxis {
                            glyph_name: glyph.name.clone(),
                            source_id: source.id.clone(),
                            axis_id: axis_id.clone(),
                        });
                    }
                }
                let location_key = glyph_variation_location_key(
                    source_location,
                    &source.location,
                    &self.axes,
                    &glyph.local_axes,
                );
                if let Some(existing_source_id) =
                    variation_source_locations.insert(location_key, source.id.clone())
                {
                    return Err(ShiftSourceError::DuplicateGlyphVariationSourceLocation {
                        glyph_name: glyph.name.clone(),
                        source_id: source.id.clone(),
                        existing_source_id,
                    });
                }
            }

            for unicode in &glyph.unicodes {
                let parsed = parse_unicode_scalar(&glyph.name, unicode)?;
                if let Some(existing_glyph_name) = unicode_owners.insert(parsed, glyph.name.clone())
                {
                    return Err(ShiftSourceError::DuplicateUnicode {
                        value: format!("{parsed:04X}"),
                        glyph_name: glyph.name.clone(),
                        existing_glyph_name,
                    });
                }
            }

            for (source_id, layer) in &glyph.layers {
                if !source_ids.contains(source_id.as_str()) {
                    return Err(ShiftSourceError::MissingSourceLayer {
                        glyph_name: glyph.name.clone(),
                        source_id: source_id.clone(),
                    });
                }
                validate_glyph_layer_numbers(&glyph.name, source_id, layer)?;

                let mut component_ids = HashSet::new();
                for component in &layer.components {
                    validate_identifier(
                        format!("component on glyph '{}' layer '{}'", glyph.name, source_id),
                        &component.id,
                    )?;
                    if !component_ids.insert(component.id.as_str()) {
                        return Err(ShiftSourceError::DuplicateComponentId {
                            glyph_name: glyph.name.clone(),
                            layer_id: source_id.clone(),
                            component_id: component.id.clone(),
                        });
                    }
                    if !declared_glyph_ids.contains(component.base_glyph_id.as_str()) {
                        return Err(ShiftSourceError::MissingComponentBase {
                            glyph_name: glyph.name.clone(),
                            base_glyph_id: component.base_glyph_id.clone(),
                        });
                    }
                    let base_local_axes = local_axes_by_glyph_id
                        .get(component.base_glyph_id.as_str())
                        .cloned()
                        .unwrap_or_default();
                    let base_local_axis_ranges = local_axis_ranges_by_glyph_id
                        .get(component.base_glyph_id.as_str())
                        .cloned()
                        .unwrap_or_default();
                    validate_transform_numbers(
                        format!(
                            "component on glyph '{}' layer '{}' targeting '{}'",
                            glyph.name, source_id, component.base_glyph_id
                        ),
                        &component.transform,
                    )?;
                    for (axis_id, value) in &component.location {
                        validate_component_location_axis(
                            &glyph.name,
                            &component.base_glyph_id,
                            axis_id,
                            *value,
                            &axis_ranges,
                            &base_local_axes,
                            &base_local_axis_ranges,
                        )?;
                    }
                    let mut component_source_ids = HashSet::new();
                    let mut component_parent_locations = HashMap::new();
                    let default_parent_location =
                        component_parent_location_key(&BTreeMap::new(), &self.axes);
                    for component_source in &component.variation_sources {
                        validate_identifier(
                            format!(
                                "component variation source '{}' on glyph '{}' targeting '{}'",
                                component_source.name, glyph.name, component.base_glyph_id
                            ),
                            &component_source.id,
                        )?;
                        if !component_source_ids.insert(component_source.id.as_str()) {
                            return Err(ShiftSourceError::DuplicateComponentVariationSource {
                                glyph_name: glyph.name.clone(),
                                base_glyph_id: component.base_glyph_id.clone(),
                                source_id: component_source.id.clone(),
                            });
                        }
                        if let Some(transform) = &component_source.transform {
                            validate_transform_numbers(
                                format!(
                                    "component variation source '{}' on glyph '{}' layer '{}' targeting '{}'",
                                    component_source.id,
                                    glyph.name,
                                    source_id,
                                    component.base_glyph_id
                                ),
                                transform,
                            )?;
                        }
                        for (axis_id, value) in &component_source.parent_location {
                            let Some((minimum, maximum)) = axis_ranges.get(axis_id.as_str()) else {
                                return Err(
                                    ShiftSourceError::MissingComponentVariationParentAxis {
                                        glyph_name: glyph.name.clone(),
                                        base_glyph_id: component.base_glyph_id.clone(),
                                        source_id: component_source.id.clone(),
                                        axis_id: axis_id.clone(),
                                    },
                                );
                            };
                            validate_axis_coordinate(
                                format!(
                                    "component variation source '{}' on glyph '{}' targeting '{}'",
                                    component_source.id, glyph.name, component.base_glyph_id
                                ),
                                axis_id,
                                *value,
                                *minimum,
                                *maximum,
                            )?;
                        }
                        let parent_location_key = component_parent_location_key(
                            &component_source.parent_location,
                            &self.axes,
                        );
                        if parent_location_key == default_parent_location {
                            return Err(
                                ShiftSourceError::ComponentVariationSourceAtDefaultParentLocation {
                                    glyph_name: glyph.name.clone(),
                                    base_glyph_id: component.base_glyph_id.clone(),
                                    source_id: component_source.id.clone(),
                                },
                            );
                        }
                        if let Some(existing_source_id) = component_parent_locations
                            .insert(parent_location_key, component_source.id.clone())
                        {
                            return Err(
                                ShiftSourceError::DuplicateComponentVariationParentLocation {
                                    glyph_name: glyph.name.clone(),
                                    base_glyph_id: component.base_glyph_id.clone(),
                                    source_id: component_source.id.clone(),
                                    existing_source_id,
                                },
                            );
                        }
                        for (axis_id, value) in &component_source.location {
                            validate_component_location_axis(
                                &glyph.name,
                                &component.base_glyph_id,
                                axis_id,
                                *value,
                                &axis_ranges,
                                &base_local_axes,
                                &base_local_axis_ranges,
                            )?;
                        }
                    }
                    if let Some(condition) = &component.condition {
                        condition.validate(&axis_ranges, &glyph.name)?;
                    }
                }
            }
        }

        validate_component_graph_is_acyclic(self)?;

        Ok(())
    }
}

impl ShiftAxis {
    fn into_ir(self) -> ShiftSourceResult<Axis> {
        let axis_id = AxisId::from_stable(self.id.clone()).map_err(|_| {
            ShiftSourceError::InvalidIdentifier {
                context: format!("axis '{}'", self.name),
                identifier: self.id,
            }
        })?;
        let mut axis = Axis::with_id(
            axis_id,
            self.tag,
            self.name,
            self.minimum,
            self.default,
            self.maximum,
        );
        axis.set_hidden(self.hidden);
        Ok(axis)
    }
}

fn validate_axis_range(
    id: &str,
    minimum: f64,
    default: f64,
    maximum: f64,
) -> ShiftSourceResult<()> {
    validate_finite_number(format!("axis '{id}'"), "minimum", minimum)?;
    validate_finite_number(format!("axis '{id}'"), "default", default)?;
    validate_finite_number(format!("axis '{id}'"), "maximum", maximum)?;

    if minimum <= default && default <= maximum {
        return Ok(());
    }

    Err(ShiftSourceError::AxisDefaultOutOfRange {
        axis_id: id.to_string(),
        minimum,
        default,
        maximum,
    })
}

fn validate_axis_coordinate(
    context: impl Into<String>,
    axis_id: &str,
    value: f64,
    minimum: f64,
    maximum: f64,
) -> ShiftSourceResult<()> {
    let context = context.into();
    validate_finite_number(&context, axis_id, value)?;

    if minimum <= value && value <= maximum {
        return Ok(());
    }

    Err(ShiftSourceError::AxisCoordinateOutOfRange {
        context,
        axis_id: axis_id.to_string(),
        value,
        minimum,
        maximum,
    })
}

fn validate_finite_number(
    context: impl Into<String>,
    field: impl Into<String>,
    value: f64,
) -> ShiftSourceResult<()> {
    if value.is_finite() {
        return Ok(());
    }

    Err(ShiftSourceError::NonFiniteNumber {
        context: context.into(),
        field: field.into(),
        value,
    })
}

fn validate_optional_finite_number(
    context: impl Into<String>,
    field: impl Into<String>,
    value: Option<f64>,
) -> ShiftSourceResult<()> {
    if let Some(value) = value {
        validate_finite_number(context, field, value)?;
    }

    Ok(())
}

fn validate_identifier(context: impl Into<String>, identifier: &str) -> ShiftSourceResult<()> {
    let is_valid = !identifier.is_empty()
        && identifier
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-');
    if is_valid {
        return Ok(());
    }

    Err(ShiftSourceError::InvalidIdentifier {
        context: context.into(),
        identifier: identifier.to_string(),
    })
}

fn parse_unicode_scalar(glyph_name: &str, value: &str) -> ShiftSourceResult<u32> {
    let parsed = u32::from_str_radix(value, 16).map_err(|_| ShiftSourceError::InvalidUnicode {
        glyph_name: glyph_name.to_string(),
        value: value.to_string(),
    })?;
    if char::from_u32(parsed).is_none() {
        return Err(ShiftSourceError::InvalidUnicode {
            glyph_name: glyph_name.to_string(),
            value: value.to_string(),
        });
    }

    Ok(parsed)
}

fn validate_axis_tag(axis_tag: &str) -> ShiftSourceResult<()> {
    let is_valid = axis_tag.len() == 4 && axis_tag.chars().all(|ch| ch.is_ascii_alphanumeric());
    if is_valid {
        return Ok(());
    }

    Err(ShiftSourceError::InvalidAxisTag {
        axis_tag: axis_tag.to_string(),
    })
}

fn validate_font_metrics(metrics: &FontMetrics) -> ShiftSourceResult<()> {
    let context = "font metrics";
    validate_finite_number(context, "unitsPerEm", metrics.units_per_em)?;
    validate_finite_number(context, "ascender", metrics.ascender)?;
    validate_finite_number(context, "descender", metrics.descender)?;
    validate_optional_finite_number(context, "capHeight", metrics.cap_height)?;
    validate_optional_finite_number(context, "xHeight", metrics.x_height)?;
    validate_optional_finite_number(context, "lineGap", metrics.line_gap)?;
    validate_optional_finite_number(context, "italicAngle", metrics.italic_angle)?;
    validate_optional_finite_number(context, "underlinePosition", metrics.underline_position)?;
    validate_optional_finite_number(context, "underlineThickness", metrics.underline_thickness)?;
    Ok(())
}

fn validate_glyph_layer_numbers(
    glyph_name: &str,
    source_id: &str,
    layer: &ShiftGlyphLayer,
) -> ShiftSourceResult<()> {
    let context = format!("glyph '{glyph_name}' layer '{source_id}'");
    validate_finite_number(&context, "advanceWidth", layer.advance_width)?;
    validate_optional_finite_number(&context, "advanceHeight", layer.advance_height)?;

    for (contour_index, contour) in layer.contours.iter().enumerate() {
        for (point_index, point) in contour.points.iter().enumerate() {
            let point_context = format!(
                "glyph '{glyph_name}' layer '{source_id}' contour {contour_index} point {point_index}"
            );
            validate_finite_number(&point_context, "x", point.x)?;
            validate_finite_number(&point_context, "y", point.y)?;
        }
    }

    for (anchor_index, anchor) in layer.anchors.iter().enumerate() {
        let anchor_context =
            format!("glyph '{glyph_name}' layer '{source_id}' anchor {anchor_index}");
        validate_finite_number(&anchor_context, "x", anchor.x())?;
        validate_finite_number(&anchor_context, "y", anchor.y())?;
    }

    for (guideline_index, guideline) in layer.guidelines.iter().enumerate() {
        let guideline_context =
            format!("glyph '{glyph_name}' layer '{source_id}' guideline {guideline_index}");
        validate_optional_finite_number(&guideline_context, "x", guideline.x())?;
        validate_optional_finite_number(&guideline_context, "y", guideline.y())?;
        validate_optional_finite_number(&guideline_context, "angle", guideline.angle())?;
    }

    Ok(())
}

fn validate_transform_numbers(
    context: impl Into<String>,
    transform: &DecomposedTransform,
) -> ShiftSourceResult<()> {
    let context = context.into();
    validate_finite_number(&context, "translateX", transform.translate_x)?;
    validate_finite_number(&context, "translateY", transform.translate_y)?;
    validate_finite_number(&context, "rotation", transform.rotation)?;
    validate_finite_number(&context, "scaleX", transform.scale_x)?;
    validate_finite_number(&context, "scaleY", transform.scale_y)?;
    validate_finite_number(&context, "skewX", transform.skew_x)?;
    validate_finite_number(&context, "skewY", transform.skew_y)?;
    validate_finite_number(&context, "tCenterX", transform.t_center_x)?;
    validate_finite_number(&context, "tCenterY", transform.t_center_y)?;
    Ok(())
}

fn source_location_key(source_location: &BTreeMap<String, f64>, axes: &[ShiftAxis]) -> Vec<u64> {
    axes.iter()
        .map(|axis| {
            let value = source_location
                .get(&axis.id)
                .copied()
                .unwrap_or(axis.default);
            let value = if value == 0.0 { 0.0 } else { value };
            value.to_bits()
        })
        .collect()
}

fn axis_mapping_input_location_key(
    input_location: &BTreeMap<String, f64>,
    input_axes: &[String],
) -> Vec<(String, u64)> {
    input_axes
        .iter()
        .map(|axis_id| {
            let value = input_location
                .get(axis_id)
                .expect("caller validates declared input axes before keying");
            let value = if *value == 0.0 { 0.0 } else { *value };
            (axis_id.clone(), value.to_bits())
        })
        .collect()
}

fn component_parent_location_key(
    parent_location: &BTreeMap<String, f64>,
    axes: &[ShiftAxis],
) -> Vec<(String, u64)> {
    axes.iter()
        .map(|axis| {
            let value = parent_location
                .get(&axis.id)
                .copied()
                .unwrap_or(axis.default);
            let value = if value == 0.0 { 0.0 } else { value };
            (axis.id.clone(), value.to_bits())
        })
        .collect()
}

fn glyph_variation_location_key(
    source_location: &BTreeMap<String, f64>,
    variation_location: &BTreeMap<String, f64>,
    axes: &[ShiftAxis],
    local_axes: &[ShiftGlyphAxis],
) -> Vec<(String, u64)> {
    let global_axis_values = axes.iter().map(|axis| {
        let value = variation_location
            .get(&axis.id)
            .copied()
            .or_else(|| source_location.get(&axis.id).copied())
            .unwrap_or(axis.default);
        let value = if value == 0.0 { 0.0 } else { value };
        (axis.id.clone(), value.to_bits())
    });
    let local_axis_values = local_axes.iter().map(|axis| {
        let value = variation_location
            .get(&axis.id)
            .copied()
            .unwrap_or(axis.default);
        let value = if value == 0.0 { 0.0 } else { value };
        (axis.id.clone(), value.to_bits())
    });

    global_axis_values.chain(local_axis_values).collect()
}

fn validate_component_location_axis(
    glyph_name: &str,
    base_glyph_id: &str,
    axis_id: &str,
    value: f64,
    axis_ranges: &HashMap<&str, (f64, f64)>,
    base_local_axes: &HashSet<&str>,
    base_local_axis_ranges: &HashMap<&str, (f64, f64)>,
) -> ShiftSourceResult<()> {
    if let Some((minimum, maximum)) = axis_ranges.get(axis_id) {
        validate_axis_coordinate(
            format!("component on glyph '{glyph_name}' targeting '{base_glyph_id}'"),
            axis_id,
            value,
            *minimum,
            *maximum,
        )
    } else if let Some((minimum, maximum)) = base_local_axis_ranges.get(axis_id) {
        validate_axis_coordinate(
            format!("component on glyph '{glyph_name}' targeting '{base_glyph_id}'"),
            axis_id,
            value,
            *minimum,
            *maximum,
        )
    } else if base_local_axes.contains(axis_id) {
        Ok(())
    } else {
        Err(ShiftSourceError::MissingComponentLocationAxis {
            glyph_name: glyph_name.to_string(),
            base_glyph_id: base_glyph_id.to_string(),
            axis_id: axis_id.to_string(),
        })
    }
}

impl ShiftSource {
    fn into_ir(
        self,
        layer_id: shift_ir::LayerId,
        axis_tags_by_id: &HashMap<String, String>,
    ) -> ShiftSourceResult<Source> {
        let mut location = Location::new();
        for (axis_id, value) in self.location {
            let tag = axis_tags_by_id.get(&axis_id).cloned().unwrap_or(axis_id);
            location.set(tag, value);
        }
        let source_id = shift_ir::SourceId::from_stable(self.id.clone()).map_err(|_| {
            ShiftSourceError::InvalidIdentifier {
                context: format!("source '{}'", self.name),
                identifier: self.id,
            }
        })?;
        Ok(Source::with_id(source_id, self.name, location, layer_id))
    }
}

impl ShiftCondition {
    fn into_ir(self, glyph_name: &str) -> ShiftSourceResult<ComponentCondition> {
        match self {
            Self::AxisRange { axis_id, min, max } => {
                let axis_id = AxisId::from_stable(axis_id.clone()).map_err(|_| {
                    ShiftSourceError::InvalidIdentifier {
                        context: format!("component condition in glyph '{glyph_name}'"),
                        identifier: axis_id,
                    }
                })?;
                Ok(ComponentCondition::AxisRange { axis_id, min, max })
            }
            Self::And { conditions } => Ok(ComponentCondition::And {
                conditions: conditions
                    .into_iter()
                    .map(|condition| condition.into_ir(glyph_name))
                    .collect::<ShiftSourceResult<_>>()?,
            }),
            Self::Or { conditions } => Ok(ComponentCondition::Or {
                conditions: conditions
                    .into_iter()
                    .map(|condition| condition.into_ir(glyph_name))
                    .collect::<ShiftSourceResult<_>>()?,
            }),
            Self::Not { condition } => Ok(ComponentCondition::Not {
                condition: Box::new(condition.into_ir(glyph_name)?),
            }),
        }
    }

    fn validate(
        &self,
        axis_ranges: &HashMap<&str, (f64, f64)>,
        glyph_name: &str,
    ) -> ShiftSourceResult<()> {
        match self {
            Self::AxisRange { axis_id, min, max } => {
                let Some((axis_minimum, axis_maximum)) = axis_ranges.get(axis_id.as_str()) else {
                    return Err(ShiftSourceError::MissingConditionAxis {
                        glyph_name: glyph_name.to_string(),
                        axis_id: axis_id.clone(),
                    });
                };
                let context = format!("component condition in glyph '{glyph_name}'");
                validate_optional_finite_number(&context, "min", *min)?;
                validate_optional_finite_number(&context, "max", *max)?;
                if let (Some(min), Some(max)) = (min, max) {
                    if min > max {
                        return Err(ShiftSourceError::InvalidConditionRange {
                            glyph_name: glyph_name.to_string(),
                            axis_id: axis_id.clone(),
                            min: Some(*min),
                            max: Some(*max),
                        });
                    }
                }
                let effective_min = min.unwrap_or(*axis_minimum);
                let effective_max = max.unwrap_or(*axis_maximum);
                if effective_max < *axis_minimum || effective_min > *axis_maximum {
                    return Err(ShiftSourceError::InvalidConditionRange {
                        glyph_name: glyph_name.to_string(),
                        axis_id: axis_id.clone(),
                        min: *min,
                        max: *max,
                    });
                }
                Ok(())
            }
            Self::And { conditions } => {
                if conditions.is_empty() {
                    return Err(ShiftSourceError::EmptyCondition {
                        glyph_name: glyph_name.to_string(),
                        kind: "and".to_string(),
                    });
                }
                for condition in conditions {
                    condition.validate(axis_ranges, glyph_name)?;
                }
                Ok(())
            }
            Self::Or { conditions } => {
                if conditions.is_empty() {
                    return Err(ShiftSourceError::EmptyCondition {
                        glyph_name: glyph_name.to_string(),
                        kind: "or".to_string(),
                    });
                }
                for condition in conditions {
                    condition.validate(axis_ranges, glyph_name)?;
                }
                Ok(())
            }
            Self::Not { condition } => condition.validate(axis_ranges, glyph_name),
        }
    }
}

pub fn plan_write_impact(changes: &[ShiftPackageChange]) -> ShiftWriteImpact {
    let mut canonical_paths = BTreeSet::new();
    let mut removed_canonical_paths = BTreeSet::new();
    let mut derived_paths = BTreeSet::new();

    for change in changes {
        match change {
            ShiftPackageChange::UpdateManifest => {
                canonical_paths.insert("manifest.json".to_string());
            }
            ShiftPackageChange::UpdateFontInfo => {
                canonical_paths.insert("font.json".to_string());
            }
            ShiftPackageChange::UpdateAxes => {
                canonical_paths.insert("axes.json".to_string());
                derived_paths.insert(INTERPOLATION_COMPATIBILITY_INDEX_PATH.to_string());
            }
            ShiftPackageChange::UpdateSources => {
                canonical_paths.insert("sources.json".to_string());
                derived_paths.insert(INTERPOLATION_COMPATIBILITY_INDEX_PATH.to_string());
            }
            ShiftPackageChange::UpdateAxisMappings => {
                canonical_paths.insert("axis-mappings.json".to_string());
                derived_paths.insert(INTERPOLATION_COMPATIBILITY_INDEX_PATH.to_string());
            }
            ShiftPackageChange::CreateGlyph { glyph_id }
            | ShiftPackageChange::UpdateGlyph { glyph_id } => {
                canonical_paths.insert(glyph_file_path(glyph_id));
                derived_paths.insert(DEPENDENCY_INDEX_PATH.to_string());
                derived_paths.insert(INTERPOLATION_COMPATIBILITY_INDEX_PATH.to_string());
            }
            ShiftPackageChange::RenameGlyph { glyph_id } => {
                canonical_paths.insert(glyph_file_path(glyph_id));
                derived_paths.insert(DEPENDENCY_INDEX_PATH.to_string());
            }
            ShiftPackageChange::DeleteGlyph { glyph_id } => {
                removed_canonical_paths.insert(glyph_file_path(glyph_id));
                derived_paths.insert(DEPENDENCY_INDEX_PATH.to_string());
                derived_paths.insert(INTERPOLATION_COMPATIBILITY_INDEX_PATH.to_string());
            }
            ShiftPackageChange::RebuildDerivedIndexes => {
                derived_paths.insert(DEPENDENCY_INDEX_PATH.to_string());
                derived_paths.insert(INTERPOLATION_COMPATIBILITY_INDEX_PATH.to_string());
            }
        }
    }

    ShiftWriteImpact {
        canonical_paths: canonical_paths.into_iter().collect(),
        removed_canonical_paths: removed_canonical_paths.into_iter().collect(),
        derived_paths: derived_paths.into_iter().collect(),
    }
}

pub fn diff_packages(
    before: &ShiftPackage,
    after: &ShiftPackage,
) -> ShiftSourceResult<ShiftPackageDiff> {
    before.validate()?;
    after.validate()?;

    let mut changes = Vec::new();

    if before.manifest != after.manifest {
        changes.push(ShiftPackageChange::UpdateManifest);
    }
    if !json_equal("font", &before.font, &after.font)? {
        changes.push(ShiftPackageChange::UpdateFontInfo);
    }
    if !json_equal("axes", &before.axes, &after.axes)? {
        changes.push(ShiftPackageChange::UpdateAxes);
    }
    if !json_equal("sources", &before.sources, &after.sources)? {
        changes.push(ShiftPackageChange::UpdateSources);
    }
    if !json_equal("axis-mappings", &before.axis_mappings, &after.axis_mappings)? {
        changes.push(ShiftPackageChange::UpdateAxisMappings);
    }

    let before_glyphs: BTreeMap<_, _> = before
        .glyphs
        .iter()
        .map(|glyph| (glyph.id.as_str(), glyph))
        .collect();
    let after_glyphs: BTreeMap<_, _> = after
        .glyphs
        .iter()
        .map(|glyph| (glyph.id.as_str(), glyph))
        .collect();

    for glyph_id in before_glyphs.keys() {
        if !after_glyphs.contains_key(glyph_id) {
            changes.push(ShiftPackageChange::DeleteGlyph {
                glyph_id: (*glyph_id).to_string(),
            });
        }
    }

    for (glyph_id, after_glyph) in &after_glyphs {
        let Some(before_glyph) = before_glyphs.get(glyph_id) else {
            changes.push(ShiftPackageChange::CreateGlyph {
                glyph_id: (*glyph_id).to_string(),
            });
            continue;
        };

        if json_equal(
            format!("glyph {glyph_id}").as_str(),
            before_glyph,
            after_glyph,
        )? {
            continue;
        }

        if glyph_change_is_rename_only(before_glyph, after_glyph)? {
            changes.push(ShiftPackageChange::RenameGlyph {
                glyph_id: (*glyph_id).to_string(),
            });
        } else {
            changes.push(ShiftPackageChange::UpdateGlyph {
                glyph_id: (*glyph_id).to_string(),
            });
        }
    }

    let impact = plan_write_impact(&changes);

    Ok(ShiftPackageDiff { changes, impact })
}

pub fn fingerprint_package(path: impl AsRef<Path>) -> ShiftSourceResult<ShiftPackageFingerprint> {
    let path = path.as_ref();
    let mut relative_paths = BTreeSet::from([
        "manifest.json".to_string(),
        "font.json".to_string(),
        "axes.json".to_string(),
        "sources.json".to_string(),
    ]);

    if path.join("axis-mappings.json").exists() {
        relative_paths.insert("axis-mappings.json".to_string());
    }
    collect_json_relative_paths(path, "glyphs", &mut relative_paths)?;
    collect_json_relative_paths(path, "derived", &mut relative_paths)?;

    let relative_paths: Vec<_> = relative_paths.into_iter().collect();
    fingerprint_relative_paths(path, &relative_paths)
}

pub fn fingerprint_relative_paths(
    root: impl AsRef<Path>,
    relative_paths: &[String],
) -> ShiftSourceResult<ShiftPackageFingerprint> {
    let root = root.as_ref();
    let mut files = BTreeMap::new();

    for relative_path in relative_paths {
        let path = resolve_package_relative_path(root, relative_path)?;
        files.insert(relative_path.clone(), fingerprint_file(&path)?);
    }

    Ok(ShiftPackageFingerprint { files })
}

pub fn compare_fingerprints(
    expected: &ShiftPackageFingerprint,
    actual: &ShiftPackageFingerprint,
) -> Vec<ShiftFingerprintConflict> {
    let paths: BTreeSet<_> = expected
        .files
        .keys()
        .chain(actual.files.keys())
        .cloned()
        .collect();
    let mut conflicts = Vec::new();

    for path in paths {
        let expected_file = expected.files.get(&path);
        let actual_file = actual.files.get(&path);
        let Some(expected_file) = expected_file else {
            conflicts.push(ShiftFingerprintConflict {
                path,
                kind: ShiftFingerprintConflictKind::MissingExpectedFingerprint,
                expected: None,
                actual: actual_file.cloned(),
            });
            continue;
        };
        let Some(actual_file) = actual_file else {
            conflicts.push(ShiftFingerprintConflict {
                path,
                kind: ShiftFingerprintConflictKind::MissingActualFingerprint,
                expected: Some(expected_file.clone()),
                actual: None,
            });
            continue;
        };

        if expected_file == actual_file {
            continue;
        }

        let kind = match (expected_file.exists, actual_file.exists) {
            (false, true) => ShiftFingerprintConflictKind::Created,
            (true, false) => ShiftFingerprintConflictKind::Deleted,
            _ => ShiftFingerprintConflictKind::Modified,
        };

        conflicts.push(ShiftFingerprintConflict {
            path,
            kind,
            expected: Some(expected_file.clone()),
            actual: Some(actual_file.clone()),
        });
    }

    conflicts
}

pub fn prepare_package_commit(
    root: impl AsRef<Path>,
    before: &ShiftPackage,
    after: &ShiftPackage,
    expected_fingerprint: ShiftPackageFingerprint,
) -> ShiftSourceResult<ShiftPreparedCommit> {
    let diff = diff_packages(before, after)?;
    let impacted_paths = diff.impact.package_relative_paths();
    let current_fingerprint = fingerprint_relative_paths(root, &impacted_paths)?;
    let conflicts = compare_fingerprints(&expected_fingerprint, &current_fingerprint);
    let operations = planned_commit_operations(after, &diff.impact)?;

    Ok(ShiftPreparedCommit {
        diff,
        impacted_paths,
        expected_fingerprint,
        current_fingerprint,
        conflicts,
        operations,
    })
}

pub fn stage_prepared_commit(
    root: impl AsRef<Path>,
    package: &ShiftPackage,
    prepared: &ShiftPreparedCommit,
) -> ShiftSourceResult<ShiftStagedCommit> {
    if !prepared.conflicts.is_empty() {
        return Err(ShiftSourceError::PreparedCommitHasConflicts {
            conflict_count: prepared.conflicts.len(),
        });
    }

    let root = root.as_ref();
    let marker_bytes = json_bytes("commit.json", prepared)?;
    let transaction_id = fnv64_hex(&marker_bytes);
    refuse_distinct_active_staged_commit(root, &transaction_id)?;
    let transaction_path = root.join(".shift-txn").join(&transaction_id);
    let payload_root = transaction_path.join("payloads");
    create_dir(&payload_root)?;

    let mut payload_paths = Vec::new();
    for operation in &prepared.operations {
        let ShiftCommitOperation::WriteFile {
            path,
            purpose,
            size,
            hash,
        } = operation
        else {
            continue;
        };
        let bytes = match purpose {
            ShiftCommitOperationPurpose::Canonical => canonical_payload_bytes(package, path)?,
            ShiftCommitOperationPurpose::Derived => derived_payload_bytes(package, path)?
                .ok_or_else(|| ShiftSourceError::MissingCommitPayload { path: path.clone() })?,
        };
        if bytes.len() as u64 != *size || fnv64_hex(&bytes) != *hash {
            return Err(ShiftSourceError::PreparedCommitPayloadMismatch { path: path.clone() });
        }

        let payload_path = resolve_package_relative_path(&payload_root, path)?;
        write_bytes_atomically_synced(&payload_path, &bytes)?;
        payload_paths.push(path.clone());
    }

    let marker_path = transaction_path.join("commit.json");
    write_bytes_atomically_synced(&marker_path, &marker_bytes)?;

    Ok(ShiftStagedCommit {
        transaction_id,
        transaction_path,
        marker_path,
        payload_paths,
    })
}

fn refuse_distinct_active_staged_commit(
    root: &Path,
    new_transaction_id: &str,
) -> ShiftSourceResult<()> {
    let transaction_root = root.join(".shift-txn");
    let entries = match fs::read_dir(&transaction_root) {
        Ok(entries) => entries,
        Err(source) if source.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(source) => {
            return Err(ShiftSourceError::ReadFile {
                path: transaction_root,
                source,
            });
        }
    };

    for entry in entries {
        let entry = entry.map_err(|source| ShiftSourceError::ReadFile {
            path: transaction_root.clone(),
            source,
        })?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(existing_transaction_id) = path
            .file_name()
            .and_then(|name| name.to_str())
            .map(ToString::to_string)
        else {
            continue;
        };
        if existing_transaction_id != new_transaction_id {
            return Err(ShiftSourceError::ActiveStagedCommitExists {
                existing_transaction_id,
                new_transaction_id: new_transaction_id.to_string(),
            });
        }
    }

    Ok(())
}

pub fn inspect_staged_commits(
    root: impl AsRef<Path>,
) -> ShiftSourceResult<Vec<ShiftStagedCommitRecovery>> {
    let root = root.as_ref();
    let transaction_root = root.join(".shift-txn");
    if !transaction_root.exists() {
        return Ok(Vec::new());
    }

    let mut entries = fs::read_dir(&transaction_root)
        .map_err(|source| ShiftSourceError::ReadFile {
            path: transaction_root.clone(),
            source,
        })?
        .map(|entry| entry.map(|entry| entry.path()))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|source| ShiftSourceError::ReadFile {
            path: transaction_root.clone(),
            source,
        })?;
    entries.sort();

    let mut recoveries = Vec::new();
    for transaction_path in entries {
        if !transaction_path.is_dir() {
            continue;
        }
        let Some(transaction_id) = transaction_path
            .file_name()
            .and_then(|name| name.to_str())
            .map(ToString::to_string)
        else {
            continue;
        };
        recoveries.push(inspect_staged_commit(
            root,
            transaction_id,
            transaction_path,
        )?);
    }

    Ok(recoveries)
}

pub fn plan_staged_commit_recovery(
    root: impl AsRef<Path>,
) -> ShiftSourceResult<Vec<ShiftStagedCommitRecoveryPlan>> {
    inspect_staged_commits(root).map(|recoveries| {
        recoveries
            .iter()
            .map(ShiftStagedCommitRecoveryPlan::from_recovery)
            .collect()
    })
}

pub fn recover_staged_commits(
    root: impl AsRef<Path>,
) -> ShiftSourceResult<ShiftStagedCommitRecoveryRun> {
    let root = root.as_ref();
    let plans = plan_staged_commit_recovery(root)?;
    let resume_count = plans
        .iter()
        .filter(|plan| plan.action == ShiftStagedCommitRecoveryAction::Resume)
        .count();
    let blocked_count = plans
        .iter()
        .filter(|plan| plan.action == ShiftStagedCommitRecoveryAction::BlockedByLiveConflict)
        .count();
    let invalid_count = plans
        .iter()
        .filter(|plan| plan.action == ShiftStagedCommitRecoveryAction::CannotRecover)
        .count();

    if blocked_count > 0 || invalid_count > 0 {
        return Err(ShiftSourceError::UnresolvedStagedCommits {
            resume_count,
            blocked_count,
            invalid_count,
        });
    }

    let mut outcomes = Vec::new();
    for plan in plans {
        match plan.action {
            ShiftStagedCommitRecoveryAction::Resume => {
                let applied = apply_staged_commit(root, &plan.transaction_id)?;
                outcomes.push(ShiftStagedCommitRecoveryOutcome {
                    transaction_id: applied.transaction_id,
                    action: ShiftStagedCommitRecoveryAction::Resume,
                    applied_paths: applied.applied_paths,
                    backup_paths: applied.backup_paths,
                });
            }
            ShiftStagedCommitRecoveryAction::Cleanup => {
                let recovery = cleanup_applied_staged_commit(root, &plan.transaction_id)?;
                outcomes.push(ShiftStagedCommitRecoveryOutcome {
                    transaction_id: recovery.transaction_id,
                    action: ShiftStagedCommitRecoveryAction::Cleanup,
                    applied_paths: Vec::new(),
                    backup_paths: Vec::new(),
                });
            }
            ShiftStagedCommitRecoveryAction::BlockedByLiveConflict
            | ShiftStagedCommitRecoveryAction::CannotRecover => {
                unreachable!("blocked and invalid actions are handled before mutation")
            }
        }
    }

    Ok(ShiftStagedCommitRecoveryRun { outcomes })
}

pub fn apply_staged_commit(
    root: impl AsRef<Path>,
    transaction_id: &str,
) -> ShiftSourceResult<ShiftAppliedCommit> {
    let root = root.as_ref();
    let transaction_path = root.join(".shift-txn").join(transaction_id);
    let recovery =
        inspect_staged_commit(root, transaction_id.to_string(), transaction_path.clone())?;
    if !recovery.issues.is_empty() {
        return Err(ShiftSourceError::StagedCommitHasIssues {
            transaction_id: transaction_id.to_string(),
            issue_count: recovery.issues.len(),
        });
    }
    let diverged_count = recovery
        .paths
        .iter()
        .filter(|path| path.live_state == ShiftStagedCommitLiveState::Diverged)
        .count();
    if diverged_count > 0 {
        return Err(ShiftSourceError::StagedCommitLiveConflicts {
            transaction_id: transaction_id.to_string(),
            conflict_count: diverged_count,
        });
    }
    let live_states_by_path = recovery
        .paths
        .iter()
        .map(|path| (path.path.clone(), path.live_state))
        .collect::<HashMap<_, _>>();
    let prepared = recovery
        .prepared
        .expect("missing marker should have produced a recovery issue");

    let backup_path = root
        .join(".shift-backups")
        .join(transaction_id)
        .join("originals");
    let mut applied_paths = Vec::new();
    let mut backup_paths = Vec::new();

    for operation in &prepared.operations {
        match operation {
            ShiftCommitOperation::WriteFile { path, purpose, .. } => {
                if live_states_by_path.get(path) == Some(&ShiftStagedCommitLiveState::Applied) {
                    applied_paths.push(path.clone());
                    continue;
                }

                if *purpose == ShiftCommitOperationPurpose::Canonical {
                    if let Some(backup) = backup_live_file(root, &backup_path, path)? {
                        backup_paths.push(backup);
                    }
                }

                let payload_path =
                    resolve_package_relative_path(&transaction_path.join("payloads"), path)?;
                let live_path = resolve_package_relative_path(root, path)?;
                promote_payload_to_live_file(&payload_path, &live_path)?;
                applied_paths.push(path.clone());
            }
            ShiftCommitOperation::RemoveFile { path, purpose } => {
                if live_states_by_path.get(path) == Some(&ShiftStagedCommitLiveState::Applied) {
                    applied_paths.push(path.clone());
                    continue;
                }

                if *purpose == ShiftCommitOperationPurpose::Canonical {
                    if let Some(backup) = backup_live_file(root, &backup_path, path)? {
                        backup_paths.push(backup);
                    }
                }
                remove_live_file_if_exists(root, path)?;
                applied_paths.push(path.clone());
            }
            ShiftCommitOperation::InvalidateDerived { path } => {
                if live_states_by_path.get(path) == Some(&ShiftStagedCommitLiveState::Applied) {
                    applied_paths.push(path.clone());
                    continue;
                }

                remove_live_file_if_exists(root, path)?;
                applied_paths.push(path.clone());
            }
        }
    }

    fs::remove_dir_all(&transaction_path).map_err(|source| ShiftSourceError::RemoveFile {
        path: transaction_path,
        source,
    })?;

    Ok(ShiftAppliedCommit {
        transaction_id: transaction_id.to_string(),
        backup_path,
        applied_paths,
        backup_paths,
    })
}

pub fn cleanup_applied_staged_commit(
    root: impl AsRef<Path>,
    transaction_id: &str,
) -> ShiftSourceResult<ShiftStagedCommitRecovery> {
    let root = root.as_ref();
    let transaction_path = root.join(".shift-txn").join(transaction_id);
    let recovery =
        inspect_staged_commit(root, transaction_id.to_string(), transaction_path.clone())?;
    if !recovery.issues.is_empty() {
        return Err(ShiftSourceError::StagedCommitHasIssues {
            transaction_id: transaction_id.to_string(),
            issue_count: recovery.issues.len(),
        });
    }
    if recovery.live_state != ShiftStagedCommitLiveState::Applied {
        return Err(ShiftSourceError::StagedCommitNotApplied {
            transaction_id: transaction_id.to_string(),
            live_state: recovery.live_state.as_str().to_string(),
        });
    }

    fs::remove_dir_all(&transaction_path).map_err(|source| ShiftSourceError::RemoveFile {
        path: transaction_path,
        source,
    })?;

    Ok(recovery)
}

fn inspect_staged_commit(
    root: &Path,
    transaction_id: String,
    transaction_path: PathBuf,
) -> ShiftSourceResult<ShiftStagedCommitRecovery> {
    let marker_path = transaction_path.join("commit.json");
    let mut issues = Vec::new();
    let prepared = match fs::read_to_string(&marker_path) {
        Ok(marker_json) => match serde_json::from_str::<ShiftPreparedCommit>(&marker_json) {
            Ok(prepared) => Some(prepared),
            Err(source) => {
                issues.push(ShiftStagedCommitIssue {
                    kind: ShiftStagedCommitIssueKind::InvalidMarker {
                        message: source.to_string(),
                    },
                });
                None
            }
        },
        Err(source) if source.kind() == std::io::ErrorKind::NotFound => {
            issues.push(ShiftStagedCommitIssue {
                kind: ShiftStagedCommitIssueKind::MissingMarker,
            });
            None
        }
        Err(source) => {
            return Err(ShiftSourceError::ReadFile {
                path: marker_path.clone(),
                source,
            });
        }
    };

    if let Some(prepared) = &prepared {
        inspect_staged_payloads(&transaction_path, prepared, &mut issues)?;
    }
    let (live_state, paths) = if let Some(prepared) = &prepared {
        staged_commit_live_recovery(root, &transaction_path, prepared)?
    } else {
        (ShiftStagedCommitLiveState::Unknown, Vec::new())
    };

    Ok(ShiftStagedCommitRecovery {
        transaction_id,
        transaction_path,
        marker_path,
        live_state,
        paths,
        prepared,
        issues,
    })
}

fn backup_live_file(
    root: &Path,
    backup_root: &Path,
    relative_path: &str,
) -> ShiftSourceResult<Option<String>> {
    let live_path = resolve_package_relative_path(root, relative_path)?;
    if !live_path.exists() {
        return Ok(None);
    }

    let backup_path = resolve_package_relative_path(backup_root, relative_path)?;
    if let Some(parent) = backup_path.parent() {
        create_dir(parent)?;
    }
    fs::copy(&live_path, &backup_path).map_err(|source| ShiftSourceError::WriteFile {
        path: backup_path,
        source,
    })?;

    Ok(Some(relative_path.to_string()))
}

pub(crate) fn promote_payload_to_live_file(
    payload_path: &Path,
    live_path: &Path,
) -> ShiftSourceResult<()> {
    let mut payload = match fs::File::open(payload_path) {
        Ok(payload) => payload,
        Err(source) => {
            let _ = fs::remove_file(staged_payload_temp_path(live_path));
            return Err(ShiftSourceError::ReadFile {
                path: payload_path.to_path_buf(),
                source,
            });
        }
    };
    promote_reader_to_live_file(&mut payload, live_path)
}

fn write_bytes_atomically_synced(path: &Path, bytes: &[u8]) -> ShiftSourceResult<()> {
    promote_reader_to_live_file(&mut io::Cursor::new(bytes), path)
}

fn promote_reader_to_live_file(
    reader: &mut impl io::Read,
    live_path: &Path,
) -> ShiftSourceResult<()> {
    if let Some(parent) = live_path.parent() {
        create_dir(parent)?;
    }

    let temp_path = staged_payload_temp_path(live_path);
    let result = (|| -> ShiftSourceResult<()> {
        let mut temp_file = fs::OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&temp_path)
            .map_err(|source| ShiftSourceError::WriteFile {
                path: temp_path.clone(),
                source,
            })?;
        io::copy(reader, &mut temp_file).map_err(|source| ShiftSourceError::WriteFile {
            path: temp_path.clone(),
            source,
        })?;
        temp_file
            .sync_all()
            .map_err(|source| ShiftSourceError::WriteFile {
                path: temp_path.clone(),
                source,
            })?;
        drop(temp_file);
        fs::rename(&temp_path, live_path).map_err(|source| ShiftSourceError::WriteFile {
            path: live_path.to_path_buf(),
            source,
        })?;
        sync_parent_directory_best_effort(live_path);
        Ok(())
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }

    result
}

pub(crate) fn staged_payload_temp_path(live_path: &Path) -> PathBuf {
    let file_name = live_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("payload");
    let live_hash = fnv64_hex(live_path.to_string_lossy().as_bytes());
    live_path.with_file_name(format!(".{file_name}.shift-tmp-{live_hash}"))
}

fn sync_parent_directory_best_effort(path: &Path) {
    let Some(parent) = path.parent() else {
        return;
    };
    let Ok(directory) = fs::File::open(parent) else {
        return;
    };
    let _ = directory.sync_all();
}

fn staged_commit_live_recovery(
    root: &Path,
    transaction_path: &Path,
    prepared: &ShiftPreparedCommit,
) -> ShiftSourceResult<(ShiftStagedCommitLiveState, Vec<ShiftStagedPathRecovery>)> {
    let current_fingerprint = fingerprint_relative_paths(root, &prepared.impacted_paths)?;
    let applied_fingerprint = expected_applied_fingerprint(root, transaction_path, prepared)?;
    let mut path_recoveries = Vec::new();

    for path in &prepared.impacted_paths {
        let expected = prepared
            .expected_fingerprint
            .files
            .get(path)
            .cloned()
            .unwrap_or(ShiftFileFingerprint {
                exists: false,
                size: None,
                hash: None,
            });
        let current =
            current_fingerprint
                .files
                .get(path)
                .cloned()
                .unwrap_or(ShiftFileFingerprint {
                    exists: false,
                    size: None,
                    hash: None,
                });
        let applied =
            applied_fingerprint
                .files
                .get(path)
                .cloned()
                .unwrap_or(ShiftFileFingerprint {
                    exists: false,
                    size: None,
                    hash: None,
                });

        let live_state = if current == expected {
            ShiftStagedCommitLiveState::Pending
        } else if current == applied {
            ShiftStagedCommitLiveState::Applied
        } else {
            ShiftStagedCommitLiveState::Diverged
        };

        path_recoveries.push(ShiftStagedPathRecovery {
            path: path.clone(),
            live_state,
            expected,
            current,
            applied,
        });
    }

    let live_state = if path_recoveries
        .iter()
        .all(|path| path.live_state == ShiftStagedCommitLiveState::Pending)
    {
        ShiftStagedCommitLiveState::Pending
    } else if path_recoveries
        .iter()
        .all(|path| path.live_state == ShiftStagedCommitLiveState::Applied)
    {
        ShiftStagedCommitLiveState::Applied
    } else if path_recoveries
        .iter()
        .any(|path| path.live_state == ShiftStagedCommitLiveState::Diverged)
    {
        ShiftStagedCommitLiveState::Diverged
    } else {
        ShiftStagedCommitLiveState::PartiallyApplied
    };

    Ok((live_state, path_recoveries))
}

fn expected_applied_fingerprint(
    root: &Path,
    transaction_path: &Path,
    prepared: &ShiftPreparedCommit,
) -> ShiftSourceResult<ShiftPackageFingerprint> {
    let mut files = prepared.expected_fingerprint.files.clone();
    let payload_root = transaction_path.join("payloads");

    for operation in &prepared.operations {
        match operation {
            ShiftCommitOperation::WriteFile { path, .. } => {
                let payload_path = resolve_package_relative_path(&payload_root, path)?;
                files.insert(path.clone(), fingerprint_file(&payload_path)?);
            }
            ShiftCommitOperation::RemoveFile { path, .. }
            | ShiftCommitOperation::InvalidateDerived { path } => {
                let live_path = resolve_package_relative_path(root, path)?;
                files.insert(
                    path.clone(),
                    ShiftFileFingerprint {
                        exists: false,
                        size: None,
                        hash: None,
                    },
                );
                if live_path.exists() && !prepared.impacted_paths.contains(path) {
                    files.insert(path.clone(), fingerprint_file(&live_path)?);
                }
            }
        }
    }

    Ok(ShiftPackageFingerprint { files })
}

fn remove_live_file_if_exists(root: &Path, relative_path: &str) -> ShiftSourceResult<()> {
    let live_path = resolve_package_relative_path(root, relative_path)?;
    match fs::remove_file(&live_path) {
        Ok(()) => Ok(()),
        Err(source) if source.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(source) => Err(ShiftSourceError::RemoveFile {
            path: live_path,
            source,
        }),
    }
}

fn inspect_staged_payloads(
    transaction_path: &Path,
    prepared: &ShiftPreparedCommit,
    issues: &mut Vec<ShiftStagedCommitIssue>,
) -> ShiftSourceResult<()> {
    let payload_root = transaction_path.join("payloads");
    for operation in &prepared.operations {
        let ShiftCommitOperation::WriteFile {
            path, size, hash, ..
        } = operation
        else {
            continue;
        };
        let payload_path = resolve_package_relative_path(&payload_root, path)?;
        let bytes = match fs::read(&payload_path) {
            Ok(bytes) => bytes,
            Err(source) if source.kind() == std::io::ErrorKind::NotFound => {
                issues.push(ShiftStagedCommitIssue {
                    kind: ShiftStagedCommitIssueKind::MissingPayload { path: path.clone() },
                });
                continue;
            }
            Err(source) => {
                return Err(ShiftSourceError::ReadFile {
                    path: payload_path,
                    source,
                });
            }
        };
        let actual_size = bytes.len() as u64;
        let actual_hash = fnv64_hex(&bytes);
        if actual_size != *size || actual_hash != *hash {
            issues.push(ShiftStagedCommitIssue {
                kind: ShiftStagedCommitIssueKind::PayloadMismatch {
                    path: path.clone(),
                    expected_size: *size,
                    actual_size,
                    expected_hash: hash.clone(),
                    actual_hash,
                },
            });
        }
    }

    Ok(())
}

impl ShiftGlyph {
    fn into_ir(
        self,
        layer_ids_by_source_id: &HashMap<String, shift_ir::LayerId>,
        glyph_names_by_id: &HashMap<String, String>,
    ) -> ShiftSourceResult<Glyph> {
        let glyph_id = GlyphId::from_stable(self.id.clone()).map_err(|_| {
            ShiftSourceError::InvalidIdentifier {
                context: format!("glyph '{}'", self.name),
                identifier: self.id.clone(),
            }
        })?;
        let mut glyph = Glyph::with_id(glyph_id, self.name.clone());
        let mut unicodes = Vec::with_capacity(self.unicodes.len());
        for unicode in self.unicodes {
            let parsed = parse_unicode_scalar(&self.name, &unicode)?;
            unicodes.push(parsed);
        }
        glyph.set_unicodes(unicodes);

        for (source_id, layer) in self.layers {
            let Some(layer_id) = layer_ids_by_source_id.get(&source_id).copied() else {
                return Err(ShiftSourceError::MissingSourceLayer {
                    glyph_name: self.name.clone(),
                    source_id,
                });
            };
            glyph.set_layer(layer_id, layer.into_ir(&self.name, glyph_names_by_id)?);
        }

        Ok(glyph)
    }
}

impl ShiftGlyphLayer {
    fn into_ir(
        self,
        glyph_name: &str,
        glyph_names_by_id: &HashMap<String, String>,
    ) -> ShiftSourceResult<GlyphLayer> {
        let mut layer = GlyphLayer::with_width(self.advance_width);
        layer.set_height(self.advance_height);

        for contour in self.contours {
            layer.add_contour(contour.into_ir());
        }

        for component in self.components {
            let base_glyph_id = component.base_glyph_id.clone();
            let Some(base_name) = glyph_names_by_id.get(&base_glyph_id) else {
                return Err(ShiftSourceError::MissingComponentBase {
                    glyph_name: glyph_name.to_string(),
                    base_glyph_id,
                });
            };
            let component_id =
                shift_ir::ComponentId::from_stable(component.id.clone()).map_err(|_| {
                    ShiftSourceError::InvalidIdentifier {
                        context: format!("component in glyph '{glyph_name}'"),
                        identifier: component.id,
                    }
                })?;
            let base_glyph_id = GlyphId::from_stable(base_glyph_id.clone()).map_err(|_| {
                ShiftSourceError::InvalidIdentifier {
                    context: format!("component in glyph '{glyph_name}'"),
                    identifier: base_glyph_id,
                }
            })?;
            let mut ir_component = Component::with_base_glyph_id(
                component_id,
                base_glyph_id,
                base_name.as_str(),
                component.transform,
            );
            let mut location = ComponentLocation::new();
            for (axis_id, value) in component.location {
                let axis_id = AxisId::from_stable(axis_id.clone()).map_err(|_| {
                    ShiftSourceError::InvalidIdentifier {
                        context: format!("component location in glyph '{glyph_name}'"),
                        identifier: axis_id,
                    }
                })?;
                location.set(axis_id, value);
            }
            ir_component.set_location(location);
            ir_component.set_axis_inheritance(component.axis_inheritance.into_ir());
            ir_component.set_condition(
                component
                    .condition
                    .map(|condition| condition.into_ir(glyph_name))
                    .transpose()?,
            );
            layer.add_component(ir_component);
        }

        for anchor in self.anchors {
            layer.add_anchor(anchor);
        }

        for guideline in self.guidelines {
            layer.add_guideline(guideline);
        }

        Ok(layer)
    }
}

impl ShiftContour {
    fn into_ir(self) -> Contour {
        let mut contour = Contour::new();
        for point in self.points {
            contour.push_point(point.into_ir());
        }
        if self.closed {
            contour.close();
        }
        contour
    }
}

impl ShiftPoint {
    fn into_ir(self) -> Point {
        Point::new(
            shift_ir::PointId::new(),
            self.x,
            self.y,
            self.point_type.into_ir(),
            self.smooth,
        )
    }
}

impl ShiftPointType {
    fn into_ir(self) -> PointType {
        match self {
            Self::OnCurve => PointType::OnCurve,
            Self::OffCurve => PointType::OffCurve,
            Self::QCurve => PointType::QCurve,
        }
    }
}

pub fn save_font(font: &Font, path: impl AsRef<Path>) -> ShiftSourceResult<()> {
    save_package(&ShiftPackage::from_font(font), path)
}

pub fn load_font(path: impl AsRef<Path>) -> ShiftSourceResult<Font> {
    load_package(path)?.into_font()
}

pub fn save_package(package: &ShiftPackage, path: impl AsRef<Path>) -> ShiftSourceResult<()> {
    package.validate()?;

    let path = path.as_ref();
    let glyphs_dir = path.join("glyphs");
    let derived_dir = path.join("derived");

    create_dir(path)?;
    create_dir(&glyphs_dir)?;
    create_dir(&derived_dir)?;

    remove_stale_glyph_files(&glyphs_dir, package)?;

    write_json(path.join("manifest.json"), &package.manifest)?;
    write_json(path.join("font.json"), &package.font)?;
    write_json(path.join("axes.json"), &package.axes)?;
    write_json(path.join("sources.json"), &package.sources)?;
    if !package.axis_mappings.is_empty() {
        write_json(path.join("axis-mappings.json"), &package.axis_mappings)?;
    } else {
        remove_optional_file(&path.join("axis-mappings.json"))?;
    }

    for glyph in &package.glyphs {
        write_json(glyphs_dir.join(format!("{}.json", glyph.id)), glyph)?;
    }
    write_json(
        derived_dir.join("dependencies.json"),
        &build_dependency_index(package)?,
    )?;
    write_json(
        derived_dir.join("interpolation-compatibility.json"),
        &build_interpolation_compatibility_index(package)?,
    )?;

    Ok(())
}

pub fn build_dependency_index(package: &ShiftPackage) -> ShiftSourceResult<ShiftDependencyIndex> {
    package.validate()?;

    let glyph_names_by_id: HashMap<_, _> = package
        .glyphs
        .iter()
        .map(|glyph| (glyph.id.as_str(), glyph.name.as_str()))
        .collect();
    let mut glyphs: BTreeMap<_, _> = package
        .glyphs
        .iter()
        .map(|glyph| {
            (
                glyph.id.clone(),
                ShiftGlyphDependencies {
                    glyph_id: glyph.id.clone(),
                    glyph_name: glyph.name.clone(),
                    component_dependencies: Vec::new(),
                    component_dependents: Vec::new(),
                },
            )
        })
        .collect();

    for glyph in &package.glyphs {
        for (layer_id, layer) in &glyph.layers {
            for component in &layer.components {
                let base_name = glyph_names_by_id
                    .get(component.base_glyph_id.as_str())
                    .expect("package.validate should reject missing component bases");
                let component_use = ShiftComponentUse {
                    glyph_id: glyph.id.clone(),
                    glyph_name: glyph.name.clone(),
                    layer_id: layer_id.clone(),
                    component_id: component.id.clone(),
                };

                glyphs
                    .get_mut(&glyph.id)
                    .expect("owner glyph should be indexed")
                    .component_dependencies
                    .push(ShiftComponentUse {
                        glyph_id: component.base_glyph_id.clone(),
                        glyph_name: (*base_name).to_string(),
                        layer_id: layer_id.clone(),
                        component_id: component.id.clone(),
                    });
                glyphs
                    .get_mut(&component.base_glyph_id)
                    .expect("base glyph should be indexed")
                    .component_dependents
                    .push(component_use);
            }
        }
    }

    for dependencies in glyphs.values_mut() {
        dependencies
            .component_dependencies
            .sort_by(component_use_sort_key);
        dependencies
            .component_dependents
            .sort_by(component_use_sort_key);
    }

    Ok(ShiftDependencyIndex {
        version: SHIFT_DEPENDENCY_INDEX_VERSION,
        glyphs,
    })
}

pub fn build_interpolation_compatibility_index(
    package: &ShiftPackage,
) -> ShiftSourceResult<ShiftInterpolationCompatibilityIndex> {
    package.validate()?;

    let glyphs = package
        .glyphs
        .iter()
        .map(|glyph| {
            let compatibility = glyph_interpolation_compatibility(glyph);
            (glyph.id.clone(), compatibility)
        })
        .collect();

    Ok(ShiftInterpolationCompatibilityIndex {
        version: SHIFT_INTERPOLATION_COMPATIBILITY_INDEX_VERSION,
        glyphs,
    })
}

pub fn load_package(path: impl AsRef<Path>) -> ShiftSourceResult<ShiftPackage> {
    let path = path.as_ref();
    ensure_no_unresolved_staged_commits(path)?;
    let manifest: ShiftManifest = read_json(path.join("manifest.json"))?;
    let font: ShiftFontInfo = read_json(path.join("font.json"))?;
    let axes: Vec<ShiftAxis> = read_json(path.join("axes.json"))?;
    let sources: Vec<ShiftSource> = read_json(path.join("sources.json"))?;
    let axis_mappings: Vec<ShiftAxisMapping> =
        read_json_optional(path.join("axis-mappings.json"), Vec::new())?;

    let mut glyph_paths = fs::read_dir(path.join("glyphs"))
        .map_err(|source| ShiftSourceError::ReadFile {
            path: path.join("glyphs"),
            source,
        })?
        .map(|entry| entry.map(|entry| entry.path()))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|source| ShiftSourceError::ReadFile {
            path: path.join("glyphs"),
            source,
        })?;
    glyph_paths.sort();

    let glyphs = glyph_paths
        .into_iter()
        .filter(|path| path.extension().and_then(|ext| ext.to_str()) == Some("json"))
        .map(read_glyph_json)
        .collect::<ShiftSourceResult<Vec<ShiftGlyph>>>()?;

    let package = ShiftPackage {
        manifest,
        font,
        axes,
        sources,
        axis_mappings,
        glyphs,
    };
    package.validate()?;

    Ok(package)
}

fn ensure_no_unresolved_staged_commits(root: &Path) -> ShiftSourceResult<()> {
    let recovery_plans = plan_staged_commit_recovery(root)?;
    let resume_count = recovery_plans
        .iter()
        .filter(|plan| plan.action == ShiftStagedCommitRecoveryAction::Resume)
        .count();
    let blocked_count = recovery_plans
        .iter()
        .filter(|plan| plan.action == ShiftStagedCommitRecoveryAction::BlockedByLiveConflict)
        .count();
    let invalid_count = recovery_plans
        .iter()
        .filter(|plan| plan.action == ShiftStagedCommitRecoveryAction::CannotRecover)
        .count();

    if resume_count > 0 || blocked_count > 0 || invalid_count > 0 {
        return Err(ShiftSourceError::UnresolvedStagedCommits {
            resume_count,
            blocked_count,
            invalid_count,
        });
    }

    Ok(())
}

fn read_glyph_json(path: PathBuf) -> ShiftSourceResult<ShiftGlyph> {
    let expected_glyph_id = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or_default()
        .to_string();
    let glyph: ShiftGlyph = read_json(path.clone())?;

    if glyph.id != expected_glyph_id {
        return Err(ShiftSourceError::GlyphFileIdMismatch {
            path,
            expected_glyph_id,
            actual_glyph_id: glyph.id,
        });
    }

    Ok(glyph)
}

fn create_dir(path: &Path) -> ShiftSourceResult<()> {
    fs::create_dir_all(path).map_err(|source| ShiftSourceError::CreateDir {
        path: path.to_path_buf(),
        source,
    })
}

fn remove_stale_glyph_files(glyphs_dir: &Path, package: &ShiftPackage) -> ShiftSourceResult<()> {
    let expected_files: BTreeSet<_> = package
        .glyphs
        .iter()
        .map(|glyph| format!("{}.json", glyph.id))
        .collect();

    for entry in fs::read_dir(glyphs_dir).map_err(|source| ShiftSourceError::ReadFile {
        path: glyphs_dir.to_path_buf(),
        source,
    })? {
        let path = entry
            .map_err(|source| ShiftSourceError::ReadFile {
                path: glyphs_dir.to_path_buf(),
                source,
            })?
            .path();

        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }

        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };

        if expected_files.contains(file_name) {
            continue;
        }

        fs::remove_file(&path).map_err(|source| ShiftSourceError::RemoveFile {
            path: path.clone(),
            source,
        })?;
    }

    Ok(())
}

fn remove_optional_file(path: &Path) -> ShiftSourceResult<()> {
    if !path.exists() {
        return Ok(());
    }

    fs::remove_file(path).map_err(|source| ShiftSourceError::RemoveFile {
        path: path.to_path_buf(),
        source,
    })
}

fn planned_commit_operations(
    package: &ShiftPackage,
    impact: &ShiftWriteImpact,
) -> ShiftSourceResult<Vec<ShiftCommitOperation>> {
    let mut operations = Vec::new();

    for path in &impact.canonical_paths {
        if path == "axis-mappings.json" && package.axis_mappings.is_empty() {
            operations.push(ShiftCommitOperation::RemoveFile {
                path: path.clone(),
                purpose: ShiftCommitOperationPurpose::Canonical,
            });
            continue;
        }

        let bytes = canonical_payload_bytes(package, path)?;
        operations.push(write_operation(
            path.clone(),
            ShiftCommitOperationPurpose::Canonical,
            &bytes,
        ));
    }

    for path in &impact.removed_canonical_paths {
        operations.push(ShiftCommitOperation::RemoveFile {
            path: path.clone(),
            purpose: ShiftCommitOperationPurpose::Canonical,
        });
    }

    for path in &impact.derived_paths {
        let Some(bytes) = derived_payload_bytes(package, path)? else {
            operations.push(ShiftCommitOperation::InvalidateDerived { path: path.clone() });
            continue;
        };
        operations.push(write_operation(
            path.clone(),
            ShiftCommitOperationPurpose::Derived,
            &bytes,
        ));
    }

    Ok(operations)
}

fn write_operation(
    path: String,
    purpose: ShiftCommitOperationPurpose,
    bytes: &[u8],
) -> ShiftCommitOperation {
    ShiftCommitOperation::WriteFile {
        path,
        purpose,
        size: bytes.len() as u64,
        hash: fnv64_hex(bytes),
    }
}

fn canonical_payload_bytes(package: &ShiftPackage, path: &str) -> ShiftSourceResult<Vec<u8>> {
    match path {
        "manifest.json" => json_bytes(path, &package.manifest),
        "font.json" => json_bytes(path, &package.font),
        "axes.json" => json_bytes(path, &package.axes),
        "sources.json" => json_bytes(path, &package.sources),
        "axis-mappings.json" => json_bytes(path, &package.axis_mappings),
        _ if path.starts_with("glyphs/") && path.ends_with(".json") => {
            let glyph_id = path
                .strip_prefix("glyphs/")
                .and_then(|path| path.strip_suffix(".json"))
                .expect("prefix and suffix were checked");
            let Some(glyph) = package.glyphs.iter().find(|glyph| glyph.id == glyph_id) else {
                return Err(ShiftSourceError::MissingCommitPayload {
                    path: path.to_string(),
                });
            };
            json_bytes(path, glyph)
        }
        _ => Err(ShiftSourceError::MissingCommitPayload {
            path: path.to_string(),
        }),
    }
}

fn derived_payload_bytes(package: &ShiftPackage, path: &str) -> ShiftSourceResult<Option<Vec<u8>>> {
    match path {
        DEPENDENCY_INDEX_PATH => Ok(Some(json_bytes(path, &build_dependency_index(package)?)?)),
        INTERPOLATION_COMPATIBILITY_INDEX_PATH => Ok(Some(json_bytes(
            path,
            &build_interpolation_compatibility_index(package)?,
        )?)),
        _ => Ok(None),
    }
}

fn collect_json_relative_paths(
    root: &Path,
    relative_dir: &str,
    relative_paths: &mut BTreeSet<String>,
) -> ShiftSourceResult<()> {
    let dir = root.join(relative_dir);
    if !dir.exists() {
        return Ok(());
    }

    let entries = fs::read_dir(&dir).map_err(|source| ShiftSourceError::ReadFile {
        path: dir.clone(),
        source,
    })?;

    for entry in entries {
        let path = entry
            .map_err(|source| ShiftSourceError::ReadFile {
                path: dir.clone(),
                source,
            })?
            .path();

        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }

        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };

        relative_paths.insert(format!("{relative_dir}/{file_name}"));
    }

    Ok(())
}

fn resolve_package_relative_path(root: &Path, relative_path: &str) -> ShiftSourceResult<PathBuf> {
    let path = Path::new(relative_path);
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, std::path::Component::Normal(_)))
    {
        return Err(ShiftSourceError::InvalidRelativePath {
            path: relative_path.to_string(),
        });
    }

    Ok(root.join(path))
}

fn fingerprint_file(path: &Path) -> ShiftSourceResult<ShiftFileFingerprint> {
    match fs::read(path) {
        Ok(bytes) => Ok(ShiftFileFingerprint {
            exists: true,
            size: Some(bytes.len() as u64),
            hash: Some(fnv64_hex(&bytes)),
        }),
        Err(source) if source.kind() == std::io::ErrorKind::NotFound => Ok(ShiftFileFingerprint {
            exists: false,
            size: None,
            hash: None,
        }),
        Err(source) => Err(ShiftSourceError::InspectFile {
            path: path.to_path_buf(),
            source,
        }),
    }
}

fn fnv64_hex(bytes: &[u8]) -> String {
    let mut hash = FNV_64_OFFSET_BASIS;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(FNV_64_PRIME);
    }
    format!("{hash:016x}")
}

fn json_equal<T: Serialize>(module: &str, left: &T, right: &T) -> ShiftSourceResult<bool> {
    Ok(json_value(module, left)? == json_value(module, right)?)
}

fn json_value<T: Serialize>(module: &str, value: &T) -> ShiftSourceResult<serde_json::Value> {
    serde_json::to_value(value).map_err(|source| ShiftSourceError::CompareJson {
        module: module.to_string(),
        source,
    })
}

fn glyph_change_is_rename_only(before: &ShiftGlyph, after: &ShiftGlyph) -> ShiftSourceResult<bool> {
    if before.name == after.name {
        return Ok(false);
    }

    let mut renamed_before = before.clone();
    renamed_before.name = after.name.clone();

    json_equal(
        format!("glyph {}", before.id).as_str(),
        &renamed_before,
        after,
    )
}

fn glyph_file_path(glyph_id: &str) -> String {
    format!("glyphs/{glyph_id}.json")
}

fn validate_component_graph_is_acyclic(package: &ShiftPackage) -> ShiftSourceResult<()> {
    let adjacency: HashMap<_, Vec<_>> = package
        .glyphs
        .iter()
        .map(|glyph| {
            let dependencies = glyph
                .layers
                .values()
                .flat_map(|layer| {
                    layer
                        .components
                        .iter()
                        .map(|component| component.base_glyph_id.clone())
                })
                .collect();
            (glyph.id.clone(), dependencies)
        })
        .collect();

    let mut visited = HashSet::new();
    let mut visiting = HashSet::new();
    let mut stack = Vec::new();

    for glyph in &package.glyphs {
        visit_component_graph(
            glyph.id.as_str(),
            &adjacency,
            &mut visited,
            &mut visiting,
            &mut stack,
        )?;
    }

    Ok(())
}

fn visit_component_graph(
    glyph_id: &str,
    adjacency: &HashMap<String, Vec<String>>,
    visited: &mut HashSet<String>,
    visiting: &mut HashSet<String>,
    stack: &mut Vec<String>,
) -> ShiftSourceResult<()> {
    if visited.contains(glyph_id) {
        return Ok(());
    }

    if visiting.contains(glyph_id) {
        let cycle_start = stack
            .iter()
            .position(|id| id == glyph_id)
            .unwrap_or_default();
        let mut path = stack[cycle_start..].to_vec();
        path.push(glyph_id.to_string());
        return Err(ShiftSourceError::ComponentCycle { path });
    }

    visiting.insert(glyph_id.to_string());
    stack.push(glyph_id.to_string());

    if let Some(dependencies) = adjacency.get(glyph_id) {
        for dependency in dependencies {
            visit_component_graph(dependency, adjacency, visited, visiting, stack)?;
        }
    }

    stack.pop();
    visiting.remove(glyph_id);
    visited.insert(glyph_id.to_string());

    Ok(())
}

fn component_use_sort_key(
    left: &ShiftComponentUse,
    right: &ShiftComponentUse,
) -> std::cmp::Ordering {
    left.glyph_id
        .cmp(&right.glyph_id)
        .then_with(|| left.layer_id.cmp(&right.layer_id))
        .then_with(|| left.component_id.cmp(&right.component_id))
}

fn glyph_interpolation_compatibility(glyph: &ShiftGlyph) -> ShiftGlyphInterpolationCompatibility {
    let layer_signatures: BTreeMap<_, _> = glyph
        .layers
        .iter()
        .map(|(layer_id, layer)| (layer_id.clone(), layer_compatibility_signature(layer)))
        .collect();
    let mut issues = Vec::new();

    if let Some((reference_layer_id, reference_signature)) = layer_signatures.iter().next() {
        for (layer_id, signature) in layer_signatures.iter().skip(1) {
            issues.extend(compare_layer_signatures(
                reference_layer_id,
                reference_signature,
                layer_id,
                signature,
            ));
        }
    }

    ShiftGlyphInterpolationCompatibility {
        glyph_id: glyph.id.clone(),
        glyph_name: glyph.name.clone(),
        compatible: issues.is_empty(),
        layer_signatures,
        issues,
    }
}

fn layer_compatibility_signature(layer: &ShiftGlyphLayer) -> ShiftLayerCompatibilitySignature {
    ShiftLayerCompatibilitySignature {
        contour_point_types: layer
            .contours
            .iter()
            .map(|contour| {
                contour
                    .points
                    .iter()
                    .map(|point| point.point_type.clone())
                    .collect()
            })
            .collect(),
        contour_closed: layer
            .contours
            .iter()
            .map(|contour| contour.closed)
            .collect(),
        components: layer
            .components
            .iter()
            .map(|component| ShiftComponentCompatibilitySignature {
                component_id: component.id.clone(),
                base_glyph_id: component.base_glyph_id.clone(),
            })
            .collect(),
    }
}

fn compare_layer_signatures(
    reference_layer_id: &str,
    reference: &ShiftLayerCompatibilitySignature,
    layer_id: &str,
    signature: &ShiftLayerCompatibilitySignature,
) -> Vec<ShiftInterpolationCompatibilityIssue> {
    let mut issues = Vec::new();

    if reference.contour_point_types.len() != signature.contour_point_types.len() {
        issues.push(ShiftInterpolationCompatibilityIssue {
            kind: ShiftInterpolationCompatibilityIssueKind::ContourCountMismatch,
            reference_layer_id: reference_layer_id.to_string(),
            layer_id: layer_id.to_string(),
            expected: reference.contour_point_types.len().to_string(),
            actual: signature.contour_point_types.len().to_string(),
        });
    } else if reference.contour_point_types != signature.contour_point_types
        || reference.contour_closed != signature.contour_closed
    {
        issues.push(ShiftInterpolationCompatibilityIssue {
            kind: ShiftInterpolationCompatibilityIssueKind::ContourTopologyMismatch,
            reference_layer_id: reference_layer_id.to_string(),
            layer_id: layer_id.to_string(),
            expected: contour_topology_label(reference),
            actual: contour_topology_label(signature),
        });
    }

    if reference.components.len() != signature.components.len() {
        issues.push(ShiftInterpolationCompatibilityIssue {
            kind: ShiftInterpolationCompatibilityIssueKind::ComponentCountMismatch,
            reference_layer_id: reference_layer_id.to_string(),
            layer_id: layer_id.to_string(),
            expected: reference.components.len().to_string(),
            actual: signature.components.len().to_string(),
        });
    } else if component_ids(reference) != component_ids(signature) {
        issues.push(ShiftInterpolationCompatibilityIssue {
            kind: ShiftInterpolationCompatibilityIssueKind::ComponentIdMismatch,
            reference_layer_id: reference_layer_id.to_string(),
            layer_id: layer_id.to_string(),
            expected: component_ids(reference).join(","),
            actual: component_ids(signature).join(","),
        });
    } else if component_base_labels(reference) != component_base_labels(signature) {
        issues.push(ShiftInterpolationCompatibilityIssue {
            kind: ShiftInterpolationCompatibilityIssueKind::ComponentBaseMismatch,
            reference_layer_id: reference_layer_id.to_string(),
            layer_id: layer_id.to_string(),
            expected: component_base_labels(reference).join(","),
            actual: component_base_labels(signature).join(","),
        });
    }

    issues
}

fn component_ids(signature: &ShiftLayerCompatibilitySignature) -> Vec<String> {
    signature
        .components
        .iter()
        .map(|component| component.component_id.clone())
        .collect()
}

fn component_base_labels(signature: &ShiftLayerCompatibilitySignature) -> Vec<String> {
    signature
        .components
        .iter()
        .map(|component| format!("{}:{}", component.component_id, component.base_glyph_id))
        .collect()
}

fn contour_topology_label(signature: &ShiftLayerCompatibilitySignature) -> String {
    signature
        .contour_point_types
        .iter()
        .zip(signature.contour_closed.iter())
        .map(|(point_types, closed)| {
            let points = point_types
                .iter()
                .map(|point_type| match point_type {
                    ShiftPointType::OnCurve => "on",
                    ShiftPointType::OffCurve => "off",
                    ShiftPointType::QCurve => "q",
                })
                .collect::<Vec<_>>()
                .join("-");
            format!("{points}:{}", if *closed { "closed" } else { "open" })
        })
        .collect::<Vec<_>>()
        .join("|")
}

fn write_json<T: Serialize>(path: PathBuf, value: &T) -> ShiftSourceResult<()> {
    let bytes = json_bytes(&path.to_string_lossy(), value)?;
    fs::write(&path, bytes).map_err(|source| ShiftSourceError::WriteFile { path, source })
}

fn json_bytes<T: Serialize>(path: &str, value: &T) -> ShiftSourceResult<Vec<u8>> {
    let mut bytes =
        serde_json::to_vec_pretty(value).map_err(|source| ShiftSourceError::SerializeJson {
            path: PathBuf::from(path),
            source,
        })?;
    bytes.push(b'\n');
    Ok(bytes)
}

fn read_json<T: DeserializeOwned>(path: PathBuf) -> ShiftSourceResult<T> {
    let bytes = fs::read(&path).map_err(|source| ShiftSourceError::ReadFile {
        path: path.clone(),
        source,
    })?;
    serde_json::from_slice(&bytes).map_err(|source| ShiftSourceError::ParseJson { path, source })
}

fn read_json_optional<T: DeserializeOwned>(path: PathBuf, fallback: T) -> ShiftSourceResult<T> {
    if !path.exists() {
        return Ok(fallback);
    }

    read_json(path)
}

fn family_id(metadata: &FontMetadata) -> String {
    let family_name = metadata.family_name.as_deref().unwrap_or("Untitled Font");
    stable_family_id(family_name)
}

fn stable_family_id(family_name: &str) -> String {
    let mut id = String::from("family_");
    for ch in family_name.chars() {
        if ch.is_ascii_alphanumeric() {
            id.push(ch);
        } else {
            id.push('_');
        }
    }
    while id.contains("__") {
        id = id.replace("__", "_");
    }
    id.trim_end_matches('_').to_string()
}

fn source_ids_by_layer(font: &Font) -> HashMap<shift_ir::LayerId, String> {
    font.sources()
        .iter()
        .map(|source| (source.layer_id(), source.id_ref().as_str().to_string()))
        .collect()
}

fn glyph_names_by_id(font: &Font) -> HashMap<String, String> {
    font.glyphs()
        .values()
        .map(|glyph| {
            (
                glyph.id_ref().as_str().to_string(),
                glyph.name().to_string(),
            )
        })
        .collect()
}

fn axes_from_ir(axes: &[Axis]) -> Vec<ShiftAxis> {
    axes.iter()
        .map(|axis| ShiftAxis {
            id: axis.id_ref().as_str().to_string(),
            tag: axis.tag().to_string(),
            name: axis.name().to_string(),
            minimum: axis.minimum(),
            default: axis.default(),
            maximum: axis.maximum(),
            hidden: axis.is_hidden(),
            role: ShiftAxisRole::UserFacing,
        })
        .collect()
}

fn sources_from_ir(sources: &[Source], axes: &[Axis]) -> Vec<ShiftSource> {
    let mut sources: Vec<_> = sources
        .iter()
        .map(|source| ShiftSource {
            id: source.id_ref().as_str().to_string(),
            name: source.name().to_string(),
            location: source
                .location()
                .iter()
                .map(|(tag, value)| {
                    let axis_id = axes
                        .iter()
                        .find(|axis| axis.tag() == tag)
                        .map(|axis| axis.id_ref().as_str().to_string())
                        .unwrap_or_else(|| tag.to_string());
                    (axis_id, *value)
                })
                .collect(),
        })
        .collect();
    sources.sort_by(|left, right| left.id.cmp(&right.id));
    sources
}

fn glyph_from_ir(
    glyph: &Glyph,
    source_ids_by_layer: &HashMap<shift_ir::LayerId, String>,
    glyph_names_by_id: &HashMap<String, String>,
) -> ShiftGlyph {
    let layers = glyph
        .layers()
        .iter()
        .filter_map(|(layer_id, layer)| {
            let source_id = source_ids_by_layer.get(layer_id)?;
            Some((
                source_id.clone(),
                glyph_layer_from_ir(layer, glyph_names_by_id),
            ))
        })
        .collect();

    ShiftGlyph {
        id: glyph.id_ref().as_str().to_string(),
        name: glyph.name().to_string(),
        unicodes: glyph
            .unicodes()
            .iter()
            .map(|unicode| format!("{unicode:04X}"))
            .collect(),
        local_axes: Vec::new(),
        variation_sources: Vec::new(),
        layers,
    }
}

fn glyph_layer_from_ir(
    layer: &GlyphLayer,
    glyph_names_by_id: &HashMap<String, String>,
) -> ShiftGlyphLayer {
    ShiftGlyphLayer {
        advance_width: layer.width(),
        advance_height: layer.height(),
        contours: layer.contours_iter().map(contour_from_ir).collect(),
        components: layer
            .components_iter()
            .map(|component| component_from_ir(component, glyph_names_by_id))
            .collect(),
        anchors: layer.anchors_iter().cloned().collect(),
        guidelines: layer.guidelines().to_vec(),
    }
}

fn contour_from_ir(contour: &Contour) -> ShiftContour {
    ShiftContour {
        points: contour.points().iter().map(point_from_ir).collect(),
        closed: contour.is_closed(),
    }
}

fn point_from_ir(point: &Point) -> ShiftPoint {
    ShiftPoint {
        x: point.x(),
        y: point.y(),
        point_type: point_type_from_ir(point.point_type()),
        smooth: point.is_smooth(),
    }
}

fn point_type_from_ir(point_type: PointType) -> ShiftPointType {
    match point_type {
        PointType::OnCurve => ShiftPointType::OnCurve,
        PointType::OffCurve => ShiftPointType::OffCurve,
        PointType::QCurve => ShiftPointType::QCurve,
    }
}

fn component_from_ir(
    component: &Component,
    glyph_names_by_id: &HashMap<String, String>,
) -> ShiftComponent {
    let base_glyph_id = component.base_glyph_id_ref().as_str().to_string();
    let base_glyph_name = glyph_names_by_id
        .get(base_glyph_id.as_str())
        .cloned()
        .unwrap_or_else(|| component.base_glyph().to_string());

    ShiftComponent {
        id: component.id_ref().as_str().to_string(),
        base_glyph_id,
        base_glyph_name,
        transform: *component.transform(),
        location: location_from_ir(component.location()),
        axis_inheritance: ShiftAxisInheritance::from_ir(component.axis_inheritance()),
        variation_sources: Vec::new(),
        condition: component.condition().map(condition_from_ir),
    }
}

fn location_from_ir(location: &ComponentLocation) -> BTreeMap<String, f64> {
    location
        .iter()
        .map(|(axis_id, value)| (axis_id.as_str().to_string(), *value))
        .collect()
}

fn condition_from_ir(condition: &ComponentCondition) -> ShiftCondition {
    match condition {
        ComponentCondition::AxisRange { axis_id, min, max } => ShiftCondition::AxisRange {
            axis_id: axis_id.as_str().to_string(),
            min: *min,
            max: *max,
        },
        ComponentCondition::And { conditions } => ShiftCondition::And {
            conditions: conditions.iter().map(condition_from_ir).collect(),
        },
        ComponentCondition::Or { conditions } => ShiftCondition::Or {
            conditions: conditions.iter().map(condition_from_ir).collect(),
        },
        ComponentCondition::Not { condition } => ShiftCondition::Not {
            condition: Box::new(condition_from_ir(condition)),
        },
    }
}
