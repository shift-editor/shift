use std::path::PathBuf;

#[derive(Debug, thiserror::Error)]
pub enum ShiftSourceError {
    #[error("failed to read Shift source file '{path}': {source}")]
    ReadFile {
        path: PathBuf,
        source: std::io::Error,
    },

    #[error("failed to write Shift source file '{path}': {source}")]
    WriteFile {
        path: PathBuf,
        source: std::io::Error,
    },

    #[error("failed to remove stale Shift source file '{path}': {source}")]
    RemoveFile {
        path: PathBuf,
        source: std::io::Error,
    },

    #[error("failed to create Shift source directory '{path}': {source}")]
    CreateDir {
        path: PathBuf,
        source: std::io::Error,
    },

    #[error("failed to inspect Shift source file '{path}': {source}")]
    InspectFile {
        path: PathBuf,
        source: std::io::Error,
    },

    #[error("failed to parse Shift source JSON '{path}': {source}")]
    ParseJson {
        path: PathBuf,
        source: serde_json::Error,
    },

    #[error("failed to serialize Shift source JSON '{path}': {source}")]
    SerializeJson {
        path: PathBuf,
        source: serde_json::Error,
    },

    #[error("failed to compare Shift source module '{module}': {source}")]
    CompareJson {
        module: String,
        source: serde_json::Error,
    },

    #[error("unsupported Shift source format '{format}' version {version}")]
    UnsupportedFormat { format: String, version: u32 },

    #[error("invalid Shift source relative path '{path}'")]
    InvalidRelativePath { path: String },

    #[error("cannot prepare commit payload for Shift source path '{path}'")]
    MissingCommitPayload { path: String },

    #[error("cannot stage Shift prepared commit with {conflict_count} unresolved conflicts")]
    PreparedCommitHasConflicts { conflict_count: usize },

    #[error("prepared commit payload for '{path}' did not match planned size/hash")]
    PreparedCommitPayloadMismatch { path: String },

    #[error("cannot stage Shift commit '{new_transaction_id}' because staged commit '{existing_transaction_id}' is already active")]
    ActiveStagedCommitExists {
        existing_transaction_id: String,
        new_transaction_id: String,
    },

    #[error("cannot load Shift source package with unresolved staged commits: {resume_count} resumable, {blocked_count} blocked, {invalid_count} invalid")]
    UnresolvedStagedCommits {
        resume_count: usize,
        blocked_count: usize,
        invalid_count: usize,
    },

    #[error("cannot apply Shift staged commit '{transaction_id}' because it has {issue_count} recovery issues")]
    StagedCommitHasIssues {
        transaction_id: String,
        issue_count: usize,
    },

    #[error("cannot apply Shift staged commit '{transaction_id}' because {conflict_count} live files changed since prepare")]
    StagedCommitLiveConflicts {
        transaction_id: String,
        conflict_count: usize,
    },

    #[error(
        "cannot clean up Shift staged commit '{transaction_id}' because live state is {live_state}"
    )]
    StagedCommitNotApplied {
        transaction_id: String,
        live_state: String,
    },

    #[error("missing Shift glyph id '{glyph_id}'")]
    MissingGlyph { glyph_id: String },

    #[error("missing Shift glyph layer '{layer_id}' in glyph id '{glyph_id}'")]
    MissingGlyphLayer { glyph_id: String, layer_id: String },

    #[error("glyph file '{path}' contains glyph id '{actual_glyph_id}', expected '{expected_glyph_id}' from the file name")]
    GlyphFileIdMismatch {
        path: PathBuf,
        expected_glyph_id: String,
        actual_glyph_id: String,
    },

    #[error("cannot delete Shift glyph id '{glyph_id}' because {dependent_count} component dependents still reference it")]
    GlyphHasComponentDependents {
        glyph_id: String,
        dependent_count: usize,
    },

    #[error(
        "glyph component in '{glyph_name}' references missing base glyph id '{base_glyph_id}'"
    )]
    MissingComponentBase {
        glyph_name: String,
        base_glyph_id: String,
    },

    #[error("duplicate component id '{component_id}' in glyph '{glyph_name}' layer '{layer_id}'")]
    DuplicateComponentId {
        glyph_name: String,
        layer_id: String,
        component_id: String,
    },

    #[error("glyph '{glyph_name}' has a layer for missing source id '{source_id}'")]
    MissingSourceLayer {
        glyph_name: String,
        source_id: String,
    },

    #[error("Shift package must define at least one source")]
    EmptySources,

    #[error("manifest must define a default source id")]
    MissingDefaultSourceId,

    #[error("manifest default source id '{source_id}' does not reference a declared source")]
    MissingDefaultSource { source_id: String },

    #[error("default source '{source_id}' has coordinate {value} for axis '{axis_id}', expected axis default {default}")]
    DefaultSourceLocationNotAtAxisDefault {
        source_id: String,
        axis_id: String,
        value: f64,
        default: f64,
    },

    #[error("glyph '{glyph_name}' has invalid unicode value '{value}'")]
    InvalidUnicode { glyph_name: String, value: String },

    #[error("duplicate Shift glyph id '{glyph_id}'")]
    DuplicateGlyphId { glyph_id: String },

    #[error("duplicate Shift glyph name '{glyph_name}'")]
    DuplicateGlyphName { glyph_name: String },

    #[error("duplicate Shift source id '{source_id}'")]
    DuplicateSourceId { source_id: String },

    #[error(
        "source '{source_id}' has the same completed location as source '{existing_source_id}'"
    )]
    DuplicateSourceLocation {
        source_id: String,
        existing_source_id: String,
    },

    #[error("duplicate Shift axis id '{axis_id}'")]
    DuplicateAxisId { axis_id: String },

    #[error("duplicate Shift axis tag '{axis_tag}'")]
    DuplicateAxisTag { axis_tag: String },

    #[error("invalid Shift axis tag '{axis_tag}'")]
    InvalidAxisTag { axis_tag: String },

    #[error("axis '{axis_id}' default {default} is outside [{minimum}, {maximum}]")]
    AxisDefaultOutOfRange {
        axis_id: String,
        minimum: f64,
        default: f64,
        maximum: f64,
    },

    #[error("axis coordinate for '{axis_id}' in {context} has value {value} outside [{minimum}, {maximum}]")]
    AxisCoordinateOutOfRange {
        context: String,
        axis_id: String,
        value: f64,
        minimum: f64,
        maximum: f64,
    },

    #[error("non-finite number in {context} field '{field}': {value}")]
    NonFiniteNumber {
        context: String,
        field: String,
        value: f64,
    },

    #[error("invalid stable identifier in {context}: '{identifier}'")]
    InvalidIdentifier { context: String, identifier: String },

    #[error("source '{source_id}' location references missing axis id '{axis_id}'")]
    MissingSourceLocationAxis { source_id: String, axis_id: String },

    #[error("{context} location references missing axis id '{axis_id}'")]
    MissingQueryLocationAxis { context: String, axis_id: String },

    #[error("glyph '{glyph_name}' defines duplicate local axis id '{axis_id}'")]
    DuplicateGlyphLocalAxis { glyph_name: String, axis_id: String },

    #[error("glyph '{glyph_name}' local axis id '{axis_id}' conflicts with a global axis id")]
    GlyphLocalAxisConflictsWithGlobalAxis { glyph_name: String, axis_id: String },

    #[error("glyph '{glyph_name}' defines duplicate local variation source id '{source_id}'")]
    DuplicateGlyphVariationSource {
        glyph_name: String,
        source_id: String,
    },

    #[error("glyph '{glyph_name}' variation source '{source_id}' has the same completed location as source '{existing_source_id}'")]
    DuplicateGlyphVariationSourceLocation {
        glyph_name: String,
        source_id: String,
        existing_source_id: String,
    },

    #[error("glyph '{glyph_name}' variation source '{source_id}' references missing layer id '{layer_id}'")]
    MissingGlyphVariationLayer {
        glyph_name: String,
        source_id: String,
        layer_id: String,
    },

    #[error("glyph '{glyph_name}' variation source '{source_id}' location references missing axis id '{axis_id}'")]
    MissingGlyphVariationAxis {
        glyph_name: String,
        source_id: String,
        axis_id: String,
    },

    #[error("component in glyph '{glyph_name}' references missing axis id '{axis_id}' on base glyph '{base_glyph_id}'")]
    MissingComponentLocationAxis {
        glyph_name: String,
        base_glyph_id: String,
        axis_id: String,
    },

    #[error("duplicate component variation source id '{source_id}' in glyph '{glyph_name}' targeting '{base_glyph_id}'")]
    DuplicateComponentVariationSource {
        glyph_name: String,
        base_glyph_id: String,
        source_id: String,
    },

    #[error("component variation source '{source_id}' in glyph '{glyph_name}' targeting '{base_glyph_id}' is at the default parent location; use the component's base transform/location for the default state")]
    ComponentVariationSourceAtDefaultParentLocation {
        glyph_name: String,
        base_glyph_id: String,
        source_id: String,
    },

    #[error("component variation source '{source_id}' in glyph '{glyph_name}' targeting '{base_glyph_id}' has the same parent location as source '{existing_source_id}'")]
    DuplicateComponentVariationParentLocation {
        glyph_name: String,
        base_glyph_id: String,
        source_id: String,
        existing_source_id: String,
    },

    #[error("component variation source '{source_id}' in glyph '{glyph_name}' targeting '{base_glyph_id}' references missing parent axis id '{axis_id}'")]
    MissingComponentVariationParentAxis {
        glyph_name: String,
        base_glyph_id: String,
        source_id: String,
        axis_id: String,
    },

    #[error("component condition in glyph '{glyph_name}' references missing axis id '{axis_id}'")]
    MissingConditionAxis { glyph_name: String, axis_id: String },

    #[error("component condition in glyph '{glyph_name}' has an empty {kind} condition")]
    EmptyCondition { glyph_name: String, kind: String },

    #[error("component condition in glyph '{glyph_name}' has invalid range for axis '{axis_id}': min {min:?}, max {max:?}")]
    InvalidConditionRange {
        glyph_name: String,
        axis_id: String,
        min: Option<f64>,
        max: Option<f64>,
    },

    #[error("component graph contains a cycle: {path:?}")]
    ComponentCycle { path: Vec<String> },

    #[error("duplicate Shift axis mapping id '{mapping_id}'")]
    DuplicateAxisMappingId { mapping_id: String },

    #[error("axis mapping '{mapping_id}' declares duplicate input axis id '{axis_id}'")]
    DuplicateAxisMappingInputAxis { mapping_id: String, axis_id: String },

    #[error("axis mapping '{mapping_id}' declares duplicate output axis id '{axis_id}'")]
    DuplicateAxisMappingOutputAxis { mapping_id: String, axis_id: String },

    #[error("axis mapping '{mapping_id}' output axis '{axis_id}' is used as an input by mapping '{input_mapping_id}'; chained mappings need an explicit graph before they are supported")]
    AxisMappingOutputFeedsMappingInput {
        mapping_id: String,
        input_mapping_id: String,
        axis_id: String,
    },

    #[error("axis mapping '{mapping_id}' input references missing axis id '{axis_id}'")]
    MissingAxisMappingInputAxis { mapping_id: String, axis_id: String },

    #[error("axis mapping '{mapping_id}' output references missing axis id '{axis_id}'")]
    MissingAxisMappingOutputAxis { mapping_id: String, axis_id: String },

    #[error("axis mapping '{mapping_id}' must have at least one sample")]
    EmptyAxisMapping { mapping_id: String },

    #[error("axis mapping '{mapping_id}' sample {sample_index} has no output coordinates")]
    EmptyAxisMappingOutput {
        mapping_id: String,
        sample_index: usize,
    },

    #[error(
        "axis mapping '{mapping_id}' sample {sample_index} is missing input axis id '{axis_id}'"
    )]
    MissingAxisMappingSampleInput {
        mapping_id: String,
        sample_index: usize,
        axis_id: String,
    },

    #[error(
        "axis mapping '{mapping_id}' sample {sample_index} is missing output axis id '{axis_id}'"
    )]
    MissingAxisMappingSampleOutput {
        mapping_id: String,
        sample_index: usize,
        axis_id: String,
    },

    #[error("axis mapping '{mapping_id}' sample {sample_index} has the same completed input location as sample {existing_sample_index}")]
    DuplicateAxisMappingSampleInputLocation {
        mapping_id: String,
        sample_index: usize,
        existing_sample_index: usize,
    },
}

pub type ShiftSourceResult<T> = Result<T, ShiftSourceError>;
