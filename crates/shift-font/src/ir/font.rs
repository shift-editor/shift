use crate::Require;
use crate::axis::{Axis, AxisList, AxisMapping, DesignLocation};
use crate::binary_data::BinaryData;
use crate::collection::PersistentEntityList;
use crate::entity::{
    AnchorId, AxisId, ComponentId, ContourId, GlyphEntityId, GlyphId, LayerId, MetricId, PointId,
    SourceId,
};
use crate::error::{CoreError, CoreResult, EntityKind};
use crate::features::FeatureData;
use crate::glyph::{Glyph, GlyphLayer};
use crate::glyph_category::{GlyphCategory, GlyphSubcategory};
use crate::guideline::Guideline;
use crate::interpolation::GlyphInterpolationValues;
use crate::kerning::Kerning;
use crate::lib_data::{LibData, LibValue};
use crate::metrics::{
    FontMetrics, MetricDefinition, MetricDefinitionList, MetricKind, MetricValue, StandardMetrics,
};
use crate::named_instance::{NamedInstance, validate_named_instances};
use crate::source::{Source, SourceList};
use crate::{AxisLabelId, GlyphName, NamedInstanceId};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::collections::{BTreeSet, HashMap, HashSet};
use std::sync::Arc;

mod change_set;
mod index;

use index::{EntityIdTransfer, FontIndex, IndexEntries};

/// Font lib key holding tracked Hyperglot language ids (for example
/// `eng-latin`) as a plist array of strings.
pub const LANGUAGES_LIB_KEY: &str = "com.shift.languages";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontMetadata {
    pub family_name: Option<String>,
    pub style_name: Option<String>,
    pub version_major: Option<i32>,
    pub version_minor: Option<i32>,
    pub copyright: Option<String>,
    pub trademark: Option<String>,
    pub designer: Option<String>,
    pub designer_url: Option<String>,
    pub manufacturer: Option<String>,
    pub manufacturer_url: Option<String>,
    pub license: Option<String>,
    pub license_url: Option<String>,
    pub description: Option<String>,
    pub note: Option<String>,
}

impl Default for FontMetadata {
    fn default() -> Self {
        Self {
            family_name: Some("Untitled Font".to_string()),
            style_name: Some("Regular".to_string()),
            version_major: Some(1),
            version_minor: Some(0),
            copyright: None,
            trademark: None,
            designer: None,
            designer_url: None,
            manufacturer: None,
            manufacturer_url: None,
            license: None,
            license_url: None,
            description: None,
            note: None,
        }
    }
}

impl FontMetadata {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_names(family_name: String, style_name: String) -> Self {
        Self {
            family_name: Some(family_name),
            style_name: Some(style_name),
            ..Self::default()
        }
    }

    pub fn display_name(&self) -> String {
        match (&self.family_name, &self.style_name) {
            (Some(family), Some(style)) => format!("{family} {style}"),
            (Some(family), None) => family.clone(),
            (None, Some(style)) => style.clone(),
            (None, None) => "Untitled".to_string(),
        }
    }
}

#[derive(Clone, Debug)]
pub struct Font {
    state: Arc<FontState>,
}

#[derive(Clone, Debug)]
struct FontState {
    data: FontData,
    index: FontIndex,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct FontData {
    metadata: FontMetadata,
    metrics: FontMetrics,
    metric_definitions: Vec<MetricDefinition>,
    axes: Vec<Axis>,
    #[serde(default)]
    axis_mappings: Vec<AxisMapping>,
    #[serde(default)]
    named_instances: Vec<NamedInstance>,
    sources: Vec<Source>,
    #[serde(default)]
    default_source_id: Option<SourceId>,
    glyphs: PersistentEntityList<Arc<Glyph>>,
    kerning: Kerning,
    features: FeatureData,
    guidelines: Vec<Guideline>,
    lib: LibData,
    #[serde(default)]
    fontinfo_remainder: LibData,
    #[serde(default)]
    data_files: BinaryData,
    #[serde(default)]
    images: BinaryData,
}

impl FontState {
    fn from_data(data: FontData) -> CoreResult<Self> {
        let index = FontIndex::from_glyphs(&data.glyphs)?;
        Ok(Self { data, index })
    }

    fn rebuild_index(&mut self) -> CoreResult<()> {
        self.index = FontIndex::from_glyphs(&self.data.glyphs)?;
        Ok(())
    }
}

impl PartialEq for Font {
    fn eq(&self, other: &Self) -> bool {
        self.state.data == other.state.data
    }
}

impl Serialize for Font {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        self.data().serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for Font {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let data = FontData::deserialize(deserializer)?;
        let state = FontState::from_data(data).map_err(serde::de::Error::custom)?;
        Ok(Self {
            state: Arc::new(state),
        })
    }
}

impl Default for Font {
    fn default() -> Self {
        let metric_definitions = MetricDefinition::defaults();
        let metrics = FontMetrics::default();
        let mut default_source = Source::new("Regular".to_string(), DesignLocation::new());
        default_source.fill_metric_values(&metric_definitions, metrics.units_per_em);
        let default_source_id = default_source.id();

        Self {
            state: Arc::new(FontState {
                data: FontData {
                    metadata: FontMetadata::default(),
                    metrics,
                    metric_definitions,
                    axes: Vec::new(),
                    axis_mappings: Vec::new(),
                    named_instances: Vec::new(),
                    sources: vec![default_source],
                    default_source_id: Some(default_source_id),
                    glyphs: PersistentEntityList::new(),
                    kerning: Kerning::new(),
                    features: FeatureData::new(),
                    guidelines: Vec::new(),
                    lib: LibData::new(),
                    fontinfo_remainder: LibData::new(),
                    data_files: BinaryData::new(),
                    images: BinaryData::new(),
                },
                index: FontIndex::default(),
            }),
        }
    }
}

impl Font {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn empty() -> Self {
        let metric_definitions = MetricDefinition::defaults();
        Self {
            state: Arc::new(FontState {
                data: FontData {
                    metadata: FontMetadata::default(),
                    metrics: FontMetrics::default(),
                    metric_definitions,
                    axes: Vec::new(),
                    axis_mappings: Vec::new(),
                    named_instances: Vec::new(),
                    sources: Vec::new(),
                    default_source_id: None,
                    glyphs: PersistentEntityList::new(),
                    kerning: Kerning::new(),
                    features: FeatureData::new(),
                    guidelines: Vec::new(),
                    lib: LibData::new(),
                    fontinfo_remainder: LibData::new(),
                    data_files: BinaryData::new(),
                    images: BinaryData::new(),
                },
                index: FontIndex::default(),
            }),
        }
    }

    fn data(&self) -> &FontData {
        &self.state.data
    }

    fn data_mut(&mut self) -> &mut FontData {
        &mut Arc::make_mut(&mut self.state).data
    }

    fn index(&self) -> &FontIndex {
        &self.state.index
    }

    fn state_mut(&mut self) -> &mut FontState {
        Arc::make_mut(&mut self.state)
    }

    pub fn metadata(&self) -> &FontMetadata {
        &self.data().metadata
    }

    pub fn metadata_mut(&mut self) -> &mut FontMetadata {
        &mut self.data_mut().metadata
    }

    /// Replaces the authored font metadata and returns the previous snapshot.
    ///
    /// Metrics and every other font-owned collection remain unchanged.
    pub fn replace_metadata(&mut self, metadata: FontMetadata) -> FontMetadata {
        std::mem::replace(&mut self.data_mut().metadata, metadata)
    }

    pub fn metrics(&self) -> &FontMetrics {
        &self.data().metrics
    }

    pub fn metrics_mut(&mut self) -> &mut FontMetrics {
        &mut self.data_mut().metrics
    }

    /// Returns the stable definitions shared by every master source's values.
    pub fn metric_definitions(&self) -> &[MetricDefinition] {
        &self.data().metric_definitions
    }

    pub fn metric_definition(&self, metric_id: MetricId) -> Option<&MetricDefinition> {
        self.metric_definitions().definition(metric_id)
    }

    pub fn metric_definition_for_kind(&self, kind: MetricKind) -> Option<&MetricDefinition> {
        self.metric_definitions().definition_for_kind(kind)
    }

    /// Returns one source's authored value for a standard metric role.
    ///
    /// The font performs the join because it owns both stable metric
    /// definitions and source-local values. `None` means the source or role is
    /// absent; it does not synthesize a default value.
    pub fn metric_value(&self, source_id: SourceId, kind: MetricKind) -> Option<MetricValue> {
        let metric_id = self.metric_definition_for_kind(kind)?.id();
        self.source(source_id)?.metric_value(metric_id)
    }

    /// Replaces metric definitions while retaining source values by stable ID.
    ///
    /// Removed identities are pruned from sources. Newly introduced identities
    /// receive kind-appropriate initial values on every master source.
    ///
    /// # Errors
    ///
    /// Returns a validation error for empty names, duplicate identities, or
    /// duplicate non-custom semantic kinds.
    pub fn set_metric_definitions(&mut self, definitions: Vec<MetricDefinition>) -> CoreResult<()> {
        validate_metric_definitions(&definitions)?;
        let retained = definitions
            .iter()
            .map(MetricDefinition::id)
            .collect::<HashSet<_>>();
        let units_per_em = self.metrics().units_per_em;
        let data = self.data_mut();
        for source in &mut data.sources {
            source
                .metric_values_mut()
                .retain(|metric_id, _| retained.contains(metric_id));
            if source.is_master() {
                source.fill_metric_values(&definitions, units_per_em);
            }
        }
        data.metric_definitions = definitions;
        Ok(())
    }

    pub fn axes(&self) -> &[Axis] {
        &self.data().axes
    }

    /// Reorders axes without changing their identities or values.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::OrderLengthMismatch`] or
    /// [`CoreError::UnknownOrRepeatedId`] unless `order` is an exact
    /// permutation of the current axis identities.
    pub fn set_axis_order(&mut self, order: &[AxisId]) -> CoreResult<()> {
        if order.len() != self.axes().len() {
            return Err(CoreError::OrderLengthMismatch {
                kind: EntityKind::Axis,
                expected: self.axes().len(),
                actual: order.len(),
            });
        }

        let mut remaining = self
            .axes()
            .iter()
            .cloned()
            .map(|axis| (axis.id(), axis))
            .collect::<HashMap<_, _>>();
        let mut reordered = Vec::with_capacity(remaining.len());
        for axis_id in order {
            let Some(axis) = remaining.remove(axis_id) else {
                return Err(CoreError::UnknownOrRepeatedId {
                    kind: EntityKind::Axis,
                    id: axis_id.to_string(),
                });
            };
            reordered.push(axis);
        }
        self.data_mut().axes = reordered;
        Ok(())
    }

    /// Adds an axis and extends every existing product with its external default.
    ///
    /// # Errors
    ///
    /// Returns a validation error for invalid axis data, duplicate tags or
    /// label identities, or a product collection invalid under the new axis.
    pub fn add_axis(&mut self, axis: Axis) -> CoreResult<()> {
        axis.validate()?;
        if self
            .axes()
            .iter()
            .any(|existing| existing.tag() == axis.tag())
        {
            return Err(CoreError::DuplicateAxisTag(axis.tag().to_string()));
        }

        let axis_id = axis.id();
        let axis_default = axis.default();
        let is_external = axis.role() == crate::AxisRole::External;
        let mut axes = self.axes().to_vec();
        axes.push(axis);
        validate_axis_label_ids(&axes)?;

        let mut instances = self.named_instances().to_vec();
        if is_external {
            for instance in &mut instances {
                let mut location = instance.location().clone();
                location.set(axis_id, axis_default);
                *instance = NamedInstance::with_id(
                    instance.id(),
                    instance.name().to_string(),
                    location,
                    instance.postscript_name().map(str::to_string),
                );
            }
        }
        validate_named_instances(&instances, &axes)?;

        let data = self.data_mut();
        data.axes = axes;
        data.named_instances = instances;
        Ok(())
    }

    /// Replaces an axis definition and reshapes products only when its role changes.
    ///
    /// External value/range edits never rewrite existing product coordinates.
    /// Changing an external axis to internal removes that coordinate; the
    /// reverse inserts the new external default. Master coordinates are never
    /// relocated: unmapped edits must retain their bounds and default origin.
    /// Axes participating in mappings permit naming edits but not kind/range
    /// edits, which require an explicit mapping-authoring operation.
    ///
    /// # Errors
    ///
    /// Returns a validation error when the axis is unknown or the replacement
    /// invalidates labels, mappings, master locations, or named products.
    pub fn replace_axis(&mut self, axis: Axis) -> CoreResult<Axis> {
        axis.validate()?;
        let index = self
            .axes()
            .iter()
            .position(|existing| existing.id() == axis.id())
            .require(&axis.id())?;
        let mut axes = self.axes().to_vec();
        let previous = axes[index].clone();
        if axes
            .iter()
            .any(|existing| existing.id() != axis.id() && existing.tag() == axis.tag())
        {
            return Err(CoreError::DuplicateAxisTag(axis.tag().to_string()));
        }
        let mapped = self.axis_mappings().iter().any(|mapping| {
            mapping.inputs().contains(&axis.id()) || mapping.outputs().contains(&axis.id())
        });
        if mapped && previous.kind() != axis.kind() {
            return Err(CoreError::InvalidAxis {
                axis_id: axis.id(),
                message: "mapped-axis kind/range edits require explicit mapping authoring"
                    .to_string(),
            });
        }
        if !mapped {
            for source in self.sources().iter().filter(|source| source.is_master()) {
                let value = source
                    .location()
                    .get(&axis.id())
                    .unwrap_or_else(|| previous.default());
                let is_default = self.default_source_id().as_ref() == Some(&source.id());
                validate_source_axis(&axis, source, value, is_default)?;
                if source.location().get(&axis.id()).is_none()
                    && previous.default() != axis.default()
                {
                    return Err(CoreError::InvalidAxis {
                        axis_id: axis.id(),
                        message: format!(
                            "changing the default would implicitly relocate master {}",
                            source.name()
                        ),
                    });
                }
            }
        }
        axes[index] = axis.clone();
        validate_axis_label_ids(&axes)?;
        validate_axis_mappings(&axes, self.axis_mappings())?;

        let mut instances = self.named_instances().to_vec();
        match (previous.role(), axis.role()) {
            (crate::AxisRole::External, crate::AxisRole::Internal) => {
                for instance in &mut instances {
                    let mut location = instance.location().clone();
                    location.remove(&axis.id());
                    *instance = NamedInstance::with_id(
                        instance.id(),
                        instance.name().to_string(),
                        location,
                        instance.postscript_name().map(str::to_string),
                    );
                }
            }
            (crate::AxisRole::Internal, crate::AxisRole::External) => {
                for instance in &mut instances {
                    let mut location = instance.location().clone();
                    location.set(axis.id(), axis.default());
                    *instance = NamedInstance::with_id(
                        instance.id(),
                        instance.name().to_string(),
                        location,
                        instance.postscript_name().map(str::to_string),
                    );
                }
            }
            _ => {}
        }
        validate_named_instances(&instances, &axes)?;

        let data = self.data_mut();
        data.named_instances = instances;
        Ok(std::mem::replace(&mut data.axes[index], axis))
    }

    pub fn axis_mappings(&self) -> &[AxisMapping] {
        &self.data().axis_mappings
    }

    /// Replaces the font's axis mappings after validating them against its axes.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::InvalidAxisMapping`] when a mapping is invalid, and
    /// [`CoreError::DuplicateAxisMappingId`] or [`CoreError::DuplicateAxisMappingName`] when two
    /// mappings share an id or name. The font is unchanged on failure.
    pub fn set_axis_mappings(&mut self, mappings: Vec<AxisMapping>) -> CoreResult<()> {
        validate_axis_mappings(self.axes(), &mappings)?;
        self.data_mut().axis_mappings = mappings;
        Ok(())
    }

    /// Compiles each axis mapping into the basis that evaluates it.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::InvalidAxisMapping`] when a mapping does not fit the font's axes.
    pub fn axis_mapping_bases(&self) -> CoreResult<Vec<crate::AxisMappingBasis>> {
        self.axis_mappings()
            .iter()
            .map(|mapping| crate::AxisMappingBasis::try_from((mapping, self.axes())))
            .collect()
    }

    /// Maps a user-facing location through the font's axis mappings into design space.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::InvalidAxisMapping`] when a mapping does not fit the font's axes, and
    /// [`CoreError::AxisNotFound`] when a mapping's output axis is missing.
    pub fn mapped_location(
        &self,
        external: &crate::ExternalLocation,
    ) -> CoreResult<DesignLocation> {
        crate::variation::map_location(external, self.axes(), self.axis_mappings())
    }

    /// Removes an axis and its dependent coordinates without leaving invalid products.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::AxisNotFound`] for an unknown identity. Returns a
    /// named-instance validation error when removing the coordinate would make
    /// two explicit products indistinguishable.
    pub fn remove_axis(&mut self, axis_id: AxisId) -> CoreResult<Axis> {
        let index = self
            .axes()
            .iter()
            .position(|axis| axis.id() == axis_id)
            .require(&axis_id)?;
        let mut axes = self.axes().to_vec();
        let axis = axes.remove(index);
        let mut mappings = self.axis_mappings().to_vec();
        mappings.retain(|mapping| {
            !mapping.inputs().contains(&axis_id) && !mapping.outputs().contains(&axis_id)
        });
        let mut sources = self.sources().to_vec();
        for source in &mut sources {
            source.remove_axis_location(axis_id);
        }
        let mut instances = self.named_instances().to_vec();
        for instance in &mut instances {
            let mut location = instance.location().clone();
            location.remove(&axis_id);
            *instance = NamedInstance::with_id(
                instance.id(),
                instance.name().to_string(),
                location,
                instance.postscript_name().map(str::to_string),
            );
        }
        validate_named_instances(&instances, &axes)?;

        let data = self.data_mut();
        data.axes = axes;
        data.axis_mappings = mappings;
        data.sources = sources;
        data.named_instances = instances;
        Ok(axis)
    }

    /// Returns authored product presets in stable author order.
    pub fn named_instances(&self) -> &[NamedInstance] {
        &self.data().named_instances
    }

    /// Replaces authored product presets after validating external locations.
    ///
    /// # Errors
    ///
    /// Returns a [`CoreError`] for invalid or duplicate instance identity,
    /// naming, or locations under the current axes.
    pub fn set_named_instances(&mut self, instances: Vec<NamedInstance>) -> CoreResult<()> {
        validate_named_instances(&instances, self.axes())?;
        self.data_mut().named_instances = instances;
        Ok(())
    }

    /// Appends a validated explicit product preset.
    ///
    /// # Errors
    ///
    /// Returns a duplicate or named-instance validation error.
    pub fn add_named_instance(&mut self, instance: NamedInstance) -> CoreResult<()> {
        if self
            .named_instances()
            .iter()
            .any(|existing| existing.id() == instance.id())
        {
            return Err(CoreError::DuplicateNamedInstanceId(instance.id()));
        }

        let mut instances = self.named_instances().to_vec();
        instances.push(instance);
        self.set_named_instances(instances)
    }

    /// Replaces a product preset and returns its previous authored value.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::NamedInstanceNotFound`] for an unknown identity, or
    /// a named-instance validation error for the replacement collection.
    pub fn replace_named_instance(&mut self, instance: NamedInstance) -> CoreResult<NamedInstance> {
        let index = self
            .named_instances()
            .iter()
            .position(|existing| existing.id() == instance.id())
            .require(&instance.id())?;
        let mut instances = self.named_instances().to_vec();
        let previous = std::mem::replace(&mut instances[index], instance);
        self.set_named_instances(instances)?;
        Ok(previous)
    }

    /// Removes a product preset and returns the removed authored value.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::NamedInstanceNotFound`] for an unknown identity.
    pub fn remove_named_instance(
        &mut self,
        instance_id: NamedInstanceId,
    ) -> CoreResult<NamedInstance> {
        let index = self
            .named_instances()
            .iter()
            .position(|instance| instance.id() == instance_id)
            .require(&instance_id)?;
        Ok(self.data_mut().named_instances.remove(index))
    }

    pub fn axis(&self, axis_id: AxisId) -> Option<&Axis> {
        self.data().axes.axis(axis_id)
    }

    pub fn axis_id_by_tag(&self, tag: &str) -> Option<AxisId> {
        self.data()
            .axes
            .iter()
            .find(|axis| axis.tag() == tag)
            .map(Axis::id)
    }

    pub fn sources(&self) -> &[Source] {
        &self.data().sources
    }

    /// Returns the source with `source_id`, whatever its role.
    pub fn source(&self, source_id: SourceId) -> Option<&Source> {
        self.sources().source(source_id)
    }

    /// Returns the master sources, in source order: the sources the editor shows, edits, and
    /// interpolates.
    ///
    /// Layer sources, such as a UFO's background or support layers, are excluded. They stay in
    /// the font and round-trip through export, but the editor never addresses them.
    pub fn masters(&self) -> impl Iterator<Item = &Source> {
        self.sources().iter().filter(|source| source.is_master())
    }

    /// Returns the default source when it is a master.
    pub fn default_master(&self) -> Option<&Source> {
        self.default_source().filter(|source| source.is_master())
    }

    /// Returns `glyph`'s layer on the [default master](Self::default_master).
    pub fn default_master_layer<'a>(&self, glyph: &'a Glyph) -> Option<&'a Arc<GlyphLayer>> {
        glyph.shared_layer_for_source(self.default_master()?.id())
    }

    /// Returns the layer that stands for `glyph` when no location picks one.
    ///
    /// That is its [default master layer](Self::default_master_layer), or else
    /// the master layer with the most contours and components, taking the
    /// earliest in [`Self::master_layers`] order on a tie.
    pub fn fallback_layer<'a>(&'a self, glyph: &'a Glyph) -> Option<&'a Arc<GlyphLayer>> {
        if let Some(layer) = self.default_master_layer(glyph) {
            return Some(layer);
        }

        let complexity = |layer: &GlyphLayer| layer.contours().len() + layer.components().len();
        self.master_layers(glyph).reduce(|preferred, candidate| {
            if complexity(candidate) > complexity(preferred) {
                candidate
            } else {
                preferred
            }
        })
    }

    /// Returns each master that `glyph` draws, paired with the glyph's layer on it, in source
    /// order.
    pub fn masters_with_layers<'a>(
        &'a self,
        glyph: &'a Glyph,
    ) -> impl Iterator<Item = (&'a Source, &'a GlyphLayer)> {
        self.masters()
            .filter_map(|source| Some((source, glyph.layer_for_source(source.id())?)))
    }

    /// Returns `glyph`'s layers on [master sources](Self::masters), in source order, and by
    /// layer ID among layers on the same source.
    pub fn master_layers<'a>(
        &'a self,
        glyph: &'a Glyph,
    ) -> impl Iterator<Item = &'a Arc<GlyphLayer>> {
        self.masters().flat_map(move |source| {
            let mut layers = glyph
                .layers()
                .values()
                .filter(|layer| layer.source_id() == source.id())
                .collect::<Vec<_>>();
            layers.sort_by(|left, right| left.id().as_str().cmp(right.id().as_str()));
            layers
        })
    }

    /// Reorders sources without changing their identities or values.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::OrderLengthMismatch`] or
    /// [`CoreError::UnknownOrRepeatedId`] unless `order` is an exact
    /// permutation of the current source identities.
    pub fn set_source_order(&mut self, order: &[SourceId]) -> CoreResult<()> {
        if order.len() != self.sources().len() {
            return Err(CoreError::OrderLengthMismatch {
                kind: EntityKind::Source,
                expected: self.sources().len(),
                actual: order.len(),
            });
        }

        let mut remaining = self
            .sources()
            .iter()
            .cloned()
            .map(|source| (source.id(), source))
            .collect::<HashMap<_, _>>();
        let mut reordered = Vec::with_capacity(remaining.len());
        for source_id in order {
            let Some(source) = remaining.remove(source_id) else {
                return Err(CoreError::UnknownOrRepeatedId {
                    kind: EntityKind::Source,
                    id: source_id.to_string(),
                });
            };
            reordered.push(source);
        }
        self.data_mut().sources = reordered;
        Ok(())
    }

    /// Returns `source_id`'s standard metric positions.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::SourceNotFound`] when the font has no such source.
    pub fn standard_metrics(&self, source_id: SourceId) -> CoreResult<StandardMetrics> {
        let source = self.require_source(source_id)?;
        Ok(StandardMetrics::of(source, self.metric_definitions()))
    }

    /// Writes each present position in `metrics` into `source_id`, keeping
    /// the overshoot the source already has.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::SourceNotFound`] when the font has no such source.
    pub fn set_standard_metrics(
        &mut self,
        source_id: SourceId,
        metrics: StandardMetrics,
    ) -> CoreResult<()> {
        let data = self.data_mut();
        let source = data.sources.source_mut(source_id).require(&source_id)?;
        metrics.apply_to(source, &data.metric_definitions);
        Ok(())
    }

    pub fn source_mut(&mut self, source_id: SourceId) -> Option<&mut Source> {
        self.data_mut().sources.source_mut(source_id)
    }

    pub fn add_source(&mut self, mut source: Source) -> SourceId {
        if source.is_master() {
            source.fill_metric_values(self.metric_definitions(), self.metrics().units_per_em);
        }
        let source_id = source.id();
        let data = self.data_mut();
        if data.default_source_id.is_none() {
            data.default_source_id = Some(source_id);
        }
        data.sources.push(source);
        source_id
    }

    /// Replaces one complete source while preserving its stable identity.
    ///
    /// # Errors
    ///
    /// Returns a validation error for unknown identity, duplicate or empty
    /// names, invalid axis references, non-finite values, or incomplete master
    /// metric values.
    pub fn replace_source(&mut self, source: Source) -> CoreResult<Source> {
        validate_source(
            &source,
            self.sources(),
            self.axes(),
            self.metric_definitions(),
        )?;
        let index = self
            .sources()
            .iter()
            .position(|current| current.id() == source.id())
            .require(&source.id())?;
        Ok(std::mem::replace(
            &mut self.data_mut().sources[index],
            source,
        ))
    }

    /// Removes a source record only; the caller removes the source's glyph
    /// layers first so the layer index never points at a missing source.
    /// This low-level replay primitive never invents a replacement default;
    /// authored deletion rejects the default source before reaching it.
    pub fn remove_source(&mut self, source_id: SourceId) -> Option<Source> {
        let data = self.data_mut();
        let index = data
            .sources
            .iter()
            .position(|source| source.id() == source_id)?;
        let source = data.sources.remove(index);

        if data.default_source_id == Some(source_id) {
            data.default_source_id = None;
        }

        Some(source)
    }

    pub fn clear_sources(&mut self) {
        let data = self.data_mut();
        data.sources.clear();
        data.default_source_id = None;
    }

    pub fn default_source_id(&self) -> Option<SourceId> {
        self.data().default_source_id
    }

    pub fn set_default_source_id(&mut self, source_id: SourceId) {
        self.data_mut().default_source_id = Some(source_id);
    }

    pub fn default_source(&self) -> Option<&Source> {
        self.source(*self.data().default_source_id.as_ref()?)
    }

    pub fn is_variable(&self) -> bool {
        !self.data().axes.is_empty()
    }

    pub fn glyphs(&self) -> impl Iterator<Item = &Glyph> {
        self.data().glyphs.values().map(Arc::as_ref)
    }

    /// Returns the id of every layer of every glyph.
    pub fn layer_ids(&self) -> impl Iterator<Item = LayerId> + '_ {
        self.glyphs().flat_map(Glyph::layer_ids)
    }

    /// Returns how many layers the font's glyphs have in total.
    pub fn layer_count(&self) -> usize {
        self.glyphs().map(|glyph| glyph.layers().len()).sum()
    }

    pub fn glyph(&self, glyph_id: GlyphId) -> Option<&Glyph> {
        self.data().glyphs.get(&glyph_id).map(Arc::as_ref)
    }

    /// Returns a glyph's authored directory position in constant time.
    pub fn glyph_order(&self, glyph_id: GlyphId) -> Option<usize> {
        self.data().glyphs.index_of(&glyph_id)
    }

    pub fn glyph_id_by_name(&self, name: &str) -> Option<GlyphId> {
        self.index().id_by_name(name).copied()
    }

    pub fn glyph_by_name(&self, name: &str) -> Option<&Glyph> {
        self.glyph(self.glyph_id_by_name(name)?)
    }

    pub fn glyphs_by_unicode(&self, unicode: u32) -> impl Iterator<Item = &Glyph> {
        self.index()
            .ids_with_unicode(unicode)
            .filter_map(|glyph_id| self.glyph(*glyph_id))
    }

    pub fn glyph_id_by_layer(&self, layer_id: LayerId) -> Option<GlyphId> {
        self.index().owner(layer_id).copied()
    }

    pub fn layer_id_for_glyph_source(
        &self,
        glyph_id: GlyphId,
        source_id: SourceId,
    ) -> Option<LayerId> {
        self.index().layer_at(glyph_id, source_id).copied()
    }

    pub fn layer(&self, layer_id: LayerId) -> Option<&GlyphLayer> {
        let glyph_id = self.glyph_id_by_layer(layer_id)?;
        self.glyph(glyph_id)?.layer(layer_id)
    }

    pub fn layer_mut(&mut self, layer_id: LayerId) -> Option<&mut GlyphLayer> {
        let glyph_id = self.glyph_id_by_layer(layer_id)?;
        self.data_mut()
            .glyphs
            .get_mut(&glyph_id)
            .and_then(|glyph| Arc::make_mut(glyph).layer_mut(layer_id))
    }

    /// Returns the glyph with `glyph_id`.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::GlyphNotFound`] when the font has no such glyph.
    pub fn require_glyph(&self, glyph_id: GlyphId) -> CoreResult<&Glyph> {
        self.glyph(glyph_id).require(&glyph_id)
    }

    /// Returns the id of the glyph that owns `layer_id`.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::LayerNotFound`] when no glyph owns the layer.
    pub fn require_layer_owner(&self, layer_id: LayerId) -> CoreResult<GlyphId> {
        self.glyph_id_by_layer(layer_id).require(&layer_id)
    }

    /// Returns the glyph layer with `layer_id`.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::LayerNotFound`] when no glyph owns the layer.
    pub fn require_layer(&self, layer_id: LayerId) -> CoreResult<&GlyphLayer> {
        self.layer(layer_id).require(&layer_id)
    }

    /// Returns the glyph layer with `layer_id` for editing, unsharing its glyph first.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::LayerNotFound`] when no glyph owns the layer.
    pub fn require_layer_mut(&mut self, layer_id: LayerId) -> CoreResult<&mut GlyphLayer> {
        self.layer_mut(layer_id).require(&layer_id)
    }

    /// Returns the source with `source_id`, whatever its role.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::SourceNotFound`] when the font has no such source.
    pub fn require_source(&self, source_id: SourceId) -> CoreResult<&Source> {
        self.source(source_id).require(&source_id)
    }

    /// Returns the axis with `axis_id`.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::AxisNotFound`] when the font has no such axis.
    pub fn require_axis(&self, axis_id: AxisId) -> CoreResult<&Axis> {
        self.axis(axis_id).require(&axis_id)
    }

    /// Adds `glyph` to the font and returns its id.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::DuplicateGlyphId`] when the id is taken,
    /// [`CoreError::DuplicateGlyphName`] when the name is, and [`CoreError::DuplicateLayerId`] or
    /// [`CoreError::DuplicateGlyphLayer`] when one of its layers clashes with the font's.
    pub fn insert_glyph(&mut self, glyph: Glyph) -> CoreResult<GlyphId> {
        let glyph_id = glyph.id();
        if self.data().glyphs.contains(&glyph_id) {
            return Err(CoreError::DuplicateGlyphId(glyph_id));
        }
        let mut index = self.index().clone();
        index.try_insert(IndexEntries::of_glyph(glyph_id, &glyph))?;

        let state = self.state_mut();
        state.index = index;
        state.data.glyphs.insert(Arc::new(glyph));
        Ok(glyph_id)
    }

    /// Returns whether a contour identity is already in use anywhere in the font.
    pub(crate) fn has_contour_id(&self, contour_id: &ContourId) -> bool {
        self.index()
            .entity_ids
            .contains(&GlyphEntityId::from(contour_id.clone()))
    }

    /// Returns whether a point identity is already in use anywhere in the font.
    pub(crate) fn has_point_id(&self, point_id: &PointId) -> bool {
        self.index()
            .entity_ids
            .contains(&GlyphEntityId::from(point_id.clone()))
    }

    /// Returns whether an anchor identity is already in use anywhere in the font.
    pub(crate) fn has_anchor_id(&self, anchor_id: &AnchorId) -> bool {
        self.index()
            .entity_ids
            .contains(&GlyphEntityId::from(anchor_id.clone()))
    }

    /// Returns whether a component identity is already in use anywhere in the font.
    pub(crate) fn has_component_id(&self, component_id: &ComponentId) -> bool {
        self.index()
            .entity_ids
            .contains(&GlyphEntityId::from(component_id.clone()))
    }

    /// Records a contour minted by an in-place layer edit.
    pub(crate) fn record_contour_id(&mut self, contour_id: ContourId) {
        self.state_mut()
            .index
            .entity_ids
            .insert(GlyphEntityId::from(contour_id));
    }

    /// Records points minted by an in-place layer edit.
    pub(crate) fn record_point_ids(&mut self, point_ids: impl IntoIterator<Item = PointId>) {
        self.state_mut()
            .index
            .entity_ids
            .extend(point_ids.into_iter().map(GlyphEntityId::from));
    }

    /// Records anchors minted by an in-place layer edit.
    pub(crate) fn record_anchor_ids(&mut self, anchor_ids: impl IntoIterator<Item = AnchorId>) {
        self.state_mut()
            .index
            .entity_ids
            .extend(anchor_ids.into_iter().map(GlyphEntityId::from));
    }

    /// Forgets point identities removed by an in-place layer edit.
    pub(crate) fn forget_point_ids(&mut self, point_ids: &[PointId]) {
        for point_id in point_ids {
            self.state_mut()
                .index
                .entity_ids
                .remove(&GlyphEntityId::from(point_id.clone()));
        }
    }

    /// Forgets anchor identities removed by an in-place layer edit.
    pub(crate) fn forget_anchor_ids(&mut self, anchor_ids: &[AnchorId]) {
        for anchor_id in anchor_ids {
            self.state_mut()
                .index
                .entity_ids
                .remove(&GlyphEntityId::from(anchor_id.clone()));
        }
    }

    /// Layers with at least one component whose base is `base_glyph_id`.
    ///
    /// Only layers whose content is loaded are indexed; a directory
    /// placeholder carries no components.
    pub fn layers_using_component_base(
        &self,
        base_glyph_id: &GlyphId,
    ) -> impl Iterator<Item = &LayerId> {
        self.index().composites_of(base_glyph_id)
    }

    /// Glyphs with a loaded layer that has a component of a glyph owning one
    /// of `layer_ids`: the composites that follow those layers' anchors.
    pub fn dependent_glyph_ids<'a>(
        &self,
        layer_ids: impl IntoIterator<Item = &'a LayerId>,
    ) -> BTreeSet<GlyphId> {
        let index = self.index();
        let base_glyph_ids = layer_ids
            .into_iter()
            .filter_map(|layer_id| index.owner(*layer_id));
        base_glyph_ids
            .flat_map(|base_glyph_id| index.composite_glyphs_of(base_glyph_id))
            .copied()
            .collect()
    }

    /// Glyphs the components of the loaded layers among `layer_ids` draw.
    pub fn component_glyph_ids_of_layers<'a>(
        &self,
        layer_ids: impl IntoIterator<Item = &'a LayerId>,
    ) -> BTreeSet<GlyphId> {
        layer_ids
            .into_iter()
            .filter_map(|layer_id| self.layer(*layer_id))
            .flat_map(GlyphLayer::component_glyph_ids)
            .collect()
    }

    /// Glyphs the components of `glyph_ids`' loaded layers draw.
    pub fn component_glyph_ids_of_glyphs<'a>(
        &self,
        glyph_ids: impl IntoIterator<Item = &'a GlyphId>,
    ) -> BTreeSet<GlyphId> {
        glyph_ids
            .into_iter()
            .filter_map(|glyph_id| self.glyph(*glyph_id))
            .flat_map(Glyph::component_glyph_ids)
            .collect()
    }

    /// Every layer of `glyph_ids`.
    pub fn layer_ids_of_glyphs<'a>(
        &self,
        glyph_ids: impl IntoIterator<Item = &'a GlyphId>,
    ) -> BTreeSet<LayerId> {
        glyph_ids
            .into_iter()
            .filter_map(|glyph_id| self.glyph(*glyph_id))
            .flat_map(Glyph::layer_ids)
            .collect()
    }

    /// The shared copy of one layer, kept to re-index it after an in-place edit.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::LayerNotFound`] when no glyph owns `layer_id`.
    pub(crate) fn layer_snapshot(&self, layer_id: LayerId) -> CoreResult<Arc<GlyphLayer>> {
        let glyph_id = self.require_layer_owner(layer_id)?;
        self.require_glyph(glyph_id)?
            .layers()
            .get(&layer_id)
            .cloned()
            .require(&layer_id)
    }

    /// Re-indexes one layer after an in-place structural edit, in time
    /// proportional to the layer rather than the font.
    ///
    /// `before`'s ids move to the edited layer by difference, validated
    /// against the rest of the font.
    ///
    /// # Errors
    ///
    /// Returns a duplicate-identity error when the edited layer reuses an
    /// identity another layer holds; the index is unchanged.
    pub(crate) fn reindex_layer(
        &mut self,
        layer_id: LayerId,
        before: &GlyphLayer,
    ) -> CoreResult<()> {
        let glyph_id = self.require_layer_owner(layer_id)?;
        let after = self.layer_snapshot(layer_id)?;
        let mut transfer = EntityIdTransfer::default();
        transfer.release(before.entity_ids());
        transfer.claim(after.entity_ids(), &self.index().entity_ids)?;

        let mut index = self.index().clone();
        index.remove(&IndexEntries::records_of_layer(glyph_id, before));
        index.try_insert(IndexEntries::records_of_layer(glyph_id, &after))?;
        transfer.apply_to(&mut index.entity_ids);
        self.state_mut().index = index;
        Ok(())
    }

    fn remove_glyph(&mut self, glyph_id: GlyphId) -> Option<Glyph> {
        let state = self.state_mut();
        let glyph = state
            .data
            .glyphs
            .shift_remove(&glyph_id)
            .map(Arc::unwrap_or_clone)?;
        state
            .index
            .remove(&IndexEntries::of_glyph(glyph_id, &glyph));
        Some(glyph)
    }

    /// Removes `glyph_id` only when it is the directory's current tail.
    ///
    /// Workspace undo uses this operation to reverse append-only glyph
    /// creation without reindexing a CJK-scale directory.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::GlyphNotFound`] for an empty directory and
    /// [`CoreError::GlyphNotAtTail`] when `glyph_id` is not the tail.
    pub fn pop_glyph(&mut self, glyph_id: GlyphId) -> CoreResult<Glyph> {
        let Some((tail_id, _)) = self
            .data()
            .glyphs
            .get_index(self.data().glyphs.len().saturating_sub(1))
        else {
            return Err(CoreError::GlyphNotFound(glyph_id));
        };
        if tail_id != glyph_id {
            return Err(CoreError::GlyphNotAtTail(glyph_id));
        }

        self.remove_glyph(glyph_id).require(&glyph_id)
    }

    pub fn glyph_count(&self) -> usize {
        self.data().glyphs.len()
    }

    /// Renames a glyph.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::GlyphNotFound`] when the glyph is missing, and
    /// [`CoreError::DuplicateGlyphName`] when another glyph has the name. The font is unchanged on
    /// failure.
    pub fn rename_glyph(&mut self, glyph_id: GlyphId, name: GlyphName) -> CoreResult<()> {
        let mut state = (*self.state).clone();
        let glyph = state.data.glyphs.get_mut(&glyph_id).require(&glyph_id)?;
        Arc::make_mut(glyph).set_name(name);
        state.rebuild_index()?;
        self.state = Arc::new(state);
        Ok(())
    }

    /// Replaces a glyph's Unicode code points.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::GlyphNotFound`] when the glyph is missing.
    pub fn set_glyph_unicodes(&mut self, glyph_id: GlyphId, unicodes: Vec<u32>) -> CoreResult<()> {
        let mut state = (*self.state).clone();
        let glyph = state.data.glyphs.get_mut(&glyph_id).require(&glyph_id)?;
        Arc::make_mut(glyph).set_unicodes(unicodes);
        state.rebuild_index()?;
        self.state = Arc::new(state);
        Ok(())
    }

    /// Sets or clears the glyph's category overrides; `None` falls back to
    /// glyph data.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::GlyphNotFound`] when the glyph is missing.
    pub fn set_glyph_category(
        &mut self,
        glyph_id: GlyphId,
        category: Option<GlyphCategory>,
        sub_category: Option<GlyphSubcategory>,
    ) -> CoreResult<()> {
        let mut state = (*self.state).clone();
        let glyph = Arc::make_mut(state.data.glyphs.get_mut(&glyph_id).require(&glyph_id)?);
        glyph.set_category(category);
        glyph.set_sub_category(sub_category);
        self.state = Arc::new(state);
        Ok(())
    }

    /// Adds an empty layer for `glyph_id` at `source_id`.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::SourceNotFound`] or [`CoreError::GlyphNotFound`] when the source or
    /// glyph is missing, [`CoreError::DuplicateLayerId`] when `layer_id` is taken, and
    /// [`CoreError::DuplicateGlyphLayer`] when the glyph already has a layer at that source.
    pub fn create_glyph_layer(
        &mut self,
        layer_id: LayerId,
        glyph_id: GlyphId,
        source_id: SourceId,
    ) -> CoreResult<()> {
        if self.source(source_id).is_none() {
            return Err(CoreError::SourceNotFound(source_id));
        }
        if self.index().owner(layer_id).is_some() {
            return Err(CoreError::DuplicateLayerId(layer_id));
        }
        if self
            .layer_id_for_glyph_source(glyph_id, source_id)
            .is_some()
        {
            return Err(CoreError::DuplicateGlyphLayer {
                glyph_id,
                source_id,
            });
        }

        let layer = GlyphLayer::new(layer_id, source_id);
        self.insert_glyph_layer(glyph_id, layer)?;
        Ok(())
    }

    /// Adds `layer` to the glyph `glyph_id`.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::SourceNotFound`] or [`CoreError::GlyphNotFound`] when the layer's
    /// source or the glyph is missing, and [`CoreError::DuplicateLayerId`] or
    /// [`CoreError::DuplicateGlyphLayer`] when the layer's id or source is already used.
    pub fn insert_glyph_layer(&mut self, glyph_id: GlyphId, layer: GlyphLayer) -> CoreResult<()> {
        if self.source(layer.source_id()).is_none() {
            return Err(CoreError::SourceNotFound(layer.source_id()));
        }

        if self.glyph(glyph_id).is_none() {
            return Err(CoreError::GlyphNotFound(glyph_id));
        }
        let mut index = self.index().clone();
        index.try_insert(IndexEntries::of_layer(glyph_id, &layer))?;

        let state = self.state_mut();
        let glyph = state
            .data
            .glyphs
            .get_mut(&glyph_id)
            .expect("glyph existence was checked before mutation");
        state.index = index;
        Arc::make_mut(glyph).set_layer(layer);
        Ok(())
    }

    /// Replaces one layer's canonical numeric values without changing its structure or indexes.
    ///
    /// Value count and finiteness are validated before the layer changes.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::LayerNotFound`] when no glyph owns the layer,
    /// [`CoreError::MissingGlyphValue`] or [`CoreError::TrailingGlyphValues`] when the value count
    /// does not match the layer's structure, and [`CoreError::InvalidPositionUpdateInput`] when a
    /// value is not finite.
    pub fn replace_glyph_layer_values(
        &mut self,
        layer_id: LayerId,
        values: &GlyphInterpolationValues,
    ) -> CoreResult<()> {
        let glyph_id = self.require_layer_owner(layer_id)?;
        let state = self.state_mut();
        let glyph = state
            .data
            .glyphs
            .get_mut(&glyph_id)
            .expect("layer owner was resolved before mutation");
        let layer = Arc::make_mut(glyph)
            .layer_mut(layer_id)
            .require(&layer_id)?;

        layer.apply_interpolation_values(values)
    }

    /// Atomically replaces existing layers after validating the complete batch.
    /// Uniquely owned fonts mutate in place; shared snapshots retain copy-on-write semantics.
    /// Already shared layer snapshots transfer without cloning their geometry.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::DuplicateLayerId`] when the batch names a layer twice,
    /// [`CoreError::LayerNotFound`] when a layer does not exist, and
    /// [`CoreError::LayerSourceMismatch`] when a replacement changes its layer's source. No layer
    /// changes on failure.
    pub fn replace_glyph_layers<L>(&mut self, layers: Vec<L>) -> CoreResult<()>
    where
        L: Into<Arc<GlyphLayer>>,
    {
        if layers.is_empty() {
            return Ok(());
        }

        let mut seen_layer_ids = HashSet::with_capacity(layers.len());
        let mut replacements = Vec::with_capacity(layers.len());
        for layer in layers {
            let layer = layer.into();
            let layer_id = layer.id();
            if !seen_layer_ids.insert(layer_id) {
                return Err(CoreError::DuplicateLayerId(layer_id));
            }

            let glyph_id = self.require_layer_owner(layer_id)?;
            let previous = self
                .data()
                .glyphs
                .get(&glyph_id)
                .and_then(|glyph| glyph.layers().get(&layer_id))
                .cloned()
                .require(&layer_id)?;
            if layer.source_id() != previous.source_id() {
                return Err(CoreError::LayerSourceMismatch {
                    layer_id,
                    expected_source_id: previous.source_id(),
                    actual_source_id: layer.source_id(),
                });
            }
            replacements.push((glyph_id, previous, layer));
        }

        let mut transfer = EntityIdTransfer::default();
        for (_, previous, _) in &replacements {
            transfer.release(previous.entity_ids());
        }
        for (_, _, layer) in &replacements {
            transfer.claim(layer.entity_ids(), &self.index().entity_ids)?;
        }

        let mut index = self.index().clone();
        for (glyph_id, previous, _) in &replacements {
            index.remove(&IndexEntries::records_of_layer(*glyph_id, previous));
        }
        for (glyph_id, _, layer) in &replacements {
            index.try_insert(IndexEntries::records_of_layer(*glyph_id, layer))?;
        }
        transfer.apply_to(&mut index.entity_ids);

        let state = self.state_mut();
        state.index = index;
        for (glyph_id, _, layer) in replacements {
            let glyph = state
                .data
                .glyphs
                .get_mut(&glyph_id)
                .expect("replacement owner was resolved before mutation");
            Arc::make_mut(glyph).set_layer(layer);
        }

        Ok(())
    }

    /// Removes a layer from its glyph and returns it.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::LayerNotFound`] when no glyph owns the layer.
    pub fn remove_glyph_layer(&mut self, layer_id: LayerId) -> CoreResult<GlyphLayer> {
        let glyph_id = self.require_layer_owner(layer_id)?;
        let state = self.state_mut();
        let glyph = state.data.glyphs.get_mut(&glyph_id).require(&glyph_id)?;
        let layer = Arc::make_mut(glyph)
            .remove_layer(layer_id)
            .require(&layer_id)?;
        state
            .index
            .remove(&IndexEntries::of_layer(glyph_id, &layer));
        Ok(layer)
    }

    pub fn kerning(&self) -> &Kerning {
        &self.data().kerning
    }

    pub fn kerning_mut(&mut self) -> &mut Kerning {
        &mut self.data_mut().kerning
    }

    pub fn features(&self) -> &FeatureData {
        &self.data().features
    }

    pub fn features_mut(&mut self) -> &mut FeatureData {
        &mut self.data_mut().features
    }

    pub fn guidelines(&self) -> &[Guideline] {
        &self.data().guidelines
    }

    pub fn add_guideline(&mut self, guideline: Guideline) {
        self.data_mut().guidelines.push(guideline);
    }

    pub fn lib(&self) -> &LibData {
        &self.data().lib
    }

    pub fn lib_mut(&mut self) -> &mut LibData {
        &mut self.data_mut().lib
    }

    /// Returns the tracked language ids stored under [`LANGUAGES_LIB_KEY`].
    ///
    /// `None` means the key is absent, so callers apply their own default
    /// list; `Some` (possibly empty) is the authored list in stored order.
    /// Non-string array entries are skipped, and a non-array value reads as
    /// absent.
    pub fn language_ids(&self) -> Option<Vec<String>> {
        match self.lib().get(LANGUAGES_LIB_KEY)? {
            LibValue::Array(values) => Some(
                values
                    .iter()
                    .filter_map(|value| match value {
                        LibValue::String(id) => Some(id.clone()),
                        _ => None,
                    })
                    .collect(),
            ),
            _ => None,
        }
    }

    /// Source-format font-info fields that Shift does not model, preserved
    /// as a plist-shaped map keyed by the format's field names (e.g. UFO
    /// `fontinfo.plist` keys). Modeled fields never appear here; they live
    /// on [`FontMetadata`] and [`FontMetrics`] and win on save.
    pub fn fontinfo_remainder(&self) -> &LibData {
        &self.data().fontinfo_remainder
    }

    pub fn fontinfo_remainder_mut(&mut self) -> &mut LibData {
        &mut self.data_mut().fontinfo_remainder
    }

    /// Opaque files from the source format's `data/` directory, preserved
    /// verbatim across load and save.
    pub fn data_files(&self) -> &BinaryData {
        &self.data().data_files
    }

    pub fn data_files_mut(&mut self) -> &mut BinaryData {
        &mut self.data_mut().data_files
    }

    /// Opaque files from the source format's `images/` directory, preserved
    /// verbatim across load and save.
    pub fn images(&self) -> &BinaryData {
        &self.data().images
    }

    pub fn images_mut(&mut self) -> &mut BinaryData {
        &mut self.data_mut().images
    }
}

fn validate_axis_label_ids(axes: &[Axis]) -> CoreResult<()> {
    let mut ids = HashSet::<AxisLabelId>::new();
    for label in axes.iter().flat_map(Axis::labels) {
        if !ids.insert(label.id()) {
            return Err(CoreError::DuplicateAxisLabelId(label.id()));
        }
    }

    Ok(())
}

fn validate_metric_definitions(definitions: &[MetricDefinition]) -> CoreResult<()> {
    let mut ids = HashSet::new();
    let mut standard_kinds = HashSet::new();
    for definition in definitions {
        if definition.name().trim().is_empty() {
            return Err(CoreError::InvalidMetricDefinition {
                metric_id: definition.id(),
                message: "name must not be empty".to_string(),
            });
        }
        if !ids.insert(definition.id()) {
            return Err(CoreError::DuplicateMetricId(definition.id()));
        }
        if definition.kind() != MetricKind::Custom && !standard_kinds.insert(definition.kind()) {
            return Err(CoreError::DuplicateMetricKind(definition.kind()));
        }
    }
    Ok(())
}

fn validate_source(
    source: &Source,
    sources: &[Source],
    axes: &[Axis],
    definitions: &[MetricDefinition],
) -> CoreResult<()> {
    let name = source.name().trim();
    if name.is_empty() {
        return Err(CoreError::InvalidSourceName(name.to_string()));
    }
    if sources
        .iter()
        .any(|current| current.id() != source.id() && current.name() == name)
    {
        return Err(CoreError::DuplicateSourceName(name.to_string()));
    }
    if let Some(existing) = sources.iter().find(|current| {
        current.id() != source.id()
            && current.is_master()
            && source.is_master()
            && current.location().is_equivalent_to(source.location(), axes)
    }) {
        return Err(CoreError::DuplicateSourceLocation {
            first: existing.id(),
            second: source.id(),
        });
    }

    validate_source_values(source, axes, definitions)
}

fn validate_source_values(
    source: &Source,
    axes: &[Axis],
    definitions: &[MetricDefinition],
) -> CoreResult<()> {
    for (axis_id, value) in source.location() {
        if !axes.contains_axis(*axis_id) {
            return Err(CoreError::AxisNotFound(*axis_id));
        }
        if !value.is_finite() {
            return Err(CoreError::InvalidSourceName(format!(
                "{} has a non-finite location",
                source.name()
            )));
        }
    }
    if source.is_master() {
        for definition in definitions {
            let metric_id = definition.id();
            let Some(value) = source.metric_value(metric_id) else {
                return Err(CoreError::InvalidSourceMetric {
                    source_id: source.id(),
                    metric_id,
                    message: "master source is missing a value".to_string(),
                });
            };
            if !value.position.is_finite() || !value.overshoot.is_finite() {
                return Err(CoreError::InvalidSourceMetric {
                    source_id: source.id(),
                    metric_id,
                    message: "position and overshoot must be finite".to_string(),
                });
            }
            if definition.kind() == MetricKind::Baseline && value.position != 0.0 {
                return Err(CoreError::InvalidSourceMetric {
                    source_id: source.id(),
                    metric_id,
                    message: "baseline position must be zero".to_string(),
                });
            }
        }
    }
    for metric_id in source.metric_values().keys() {
        if !definitions
            .iter()
            .any(|definition| definition.id() == *metric_id)
        {
            return Err(CoreError::InvalidSourceMetric {
                source_id: source.id(),
                metric_id: *metric_id,
                message: "metric definition does not exist".to_string(),
            });
        }
    }
    for value in [
        source.italic_angle(),
        source.line_gap(),
        source.underline_position(),
        source.underline_thickness(),
    ]
    .into_iter()
    .flatten()
    {
        if !value.is_finite() {
            return Err(CoreError::InvalidSourceName(format!(
                "{} has a non-finite source metric",
                source.name()
            )));
        }
    }
    Ok(())
}

fn validate_source_axis(
    axis: &Axis,
    source: &Source,
    value: f64,
    is_default: bool,
) -> CoreResult<()> {
    if !axis.accepts(value) {
        return Err(CoreError::InvalidAxis {
            axis_id: axis.id(),
            message: format!(
                "master {} ({}) value {value} is outside the replacement axis",
                source.name(),
                source.id()
            ),
        });
    }
    if is_default && value != axis.default() {
        return Err(CoreError::InvalidAxis {
            axis_id: axis.id(),
            message: format!(
                "default master {} must remain at the axis origin; explicit relocation is required",
                source.name()
            ),
        });
    }
    Ok(())
}

fn validate_axis_mappings(axes: &[Axis], mappings: &[AxisMapping]) -> CoreResult<()> {
    let mut mapping_ids = HashSet::new();
    let mut mapping_names = HashSet::new();
    let mut independent_outputs = HashMap::new();
    let mut cross_axis_mapping = None;

    for mapping in mappings {
        mapping.validate(axes)?;

        if !mapping_ids.insert(mapping.id()) {
            return Err(CoreError::DuplicateAxisMappingId(mapping.id()));
        }
        if !mapping_names.insert(mapping.name()) {
            return Err(CoreError::DuplicateAxisMappingName(
                mapping.name().to_string(),
            ));
        }

        if mapping.is_independent() {
            for output in mapping.outputs() {
                if let Some(owner) = independent_outputs.insert(*output, mapping.id()) {
                    return Err(CoreError::InvalidAxisMapping {
                        mapping_id: mapping.id(),
                        message: format!(
                            "output axis {output} is already controlled by mapping {owner}"
                        ),
                    });
                }
            }

            continue;
        }

        if let Some(owner) = cross_axis_mapping.replace(mapping.id()) {
            return Err(CoreError::InvalidAxisMapping {
                mapping_id: mapping.id(),
                message: format!(
                    "only one cross-axis mapping group is supported; mapping {owner} already defines it"
                ),
            });
        }
    }

    Ok(())
}

#[cfg(test)]
#[path = "font/axis_authoring_tests.rs"]
mod axis_authoring_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        Anchor, AxisMappingPoint, AxisRole, Component, ComponentId, Contour, ContourId,
        ExternalLocation, GlyphLayer, GuidelineId, LayerId, Location, PointId, PointType,
        test_support::sample_font,
    };
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    #[derive(Clone, Copy)]
    struct PerfFontMark {
        label: &'static str,
        glyphs: usize,
        contours_per_glyph: usize,
        points_per_contour: usize,
    }

    impl PerfFontMark {
        fn total_points(self) -> usize {
            self.glyphs * self.contours_per_glyph * self.points_per_contour
        }
    }

    fn synthetic_point_heavy_font(mark: PerfFontMark) -> Font {
        let mut font = Font::new();
        let source_id = font.default_source_id().unwrap();

        for glyph_index in 0..mark.glyphs {
            let unicode = u32::try_from(glyph_index).unwrap();
            let mut glyph = Glyph::with_unicode(format!("g{glyph_index:05}"), unicode);
            let mut layer =
                GlyphLayer::with_width(LayerId::new(), source_id, 500.0 + glyph_index as f64);

            for contour_index in 0..mark.contours_per_glyph {
                let mut contour = Contour::new();
                for point_index in 0..mark.points_per_contour {
                    contour.add_point(
                        point_index as f64,
                        (glyph_index + contour_index + point_index) as f64,
                        PointType::OnCurve,
                        false,
                    );
                }
                layer.add_contour(contour);
            }

            glyph.set_layer(layer);
            font.insert_glyph(glyph).unwrap();
        }

        font
    }

    #[test]
    fn glyph_insert_rejects_contour_identity_used_by_another_layer() {
        let mut font = Font::new();
        let source_id = font.default_source_id().unwrap();
        let contour_id = ContourId::from_raw("shared");

        let mut first_contour = Contour::with_id(contour_id.clone());
        first_contour.add_point(0.0, 0.0, PointType::OnCurve, false);
        let mut first_layer = GlyphLayer::new(LayerId::new(), source_id);
        first_layer.add_contour(first_contour);
        let mut first_glyph = Glyph::new("A");
        first_glyph.set_layer(first_layer);
        font.insert_glyph(first_glyph).unwrap();

        let mut second_contour = Contour::with_id(contour_id.clone());
        second_contour.add_point(100.0, 100.0, PointType::OnCurve, false);
        let mut second_layer = GlyphLayer::new(LayerId::new(), source_id);
        second_layer.add_contour(second_contour);
        let mut second_glyph = Glyph::new("B");
        second_glyph.set_layer(second_layer);

        assert!(matches!(
            font.insert_glyph(second_glyph),
            Err(CoreError::DuplicateContourId(id)) if id == contour_id
        ));
        assert_eq!(font.glyph_count(), 1);
    }

    /// Fails when `elapsed` is a second or more, in optimised builds only.
    ///
    /// Budgets describe optimised code; an unoptimised test build still checks
    /// each mark's behaviour but not its time, so a slow runner cannot fail it.
    /// CI enforces the budgets with `cargo test --release -p shift-font -- perf_mark`.
    fn assert_within_budget(elapsed: Duration, what: &str) {
        if cfg!(debug_assertions) {
            return;
        }
        assert!(elapsed < Duration::from_secs(1), "{what}; got {elapsed:?}");
    }

    fn print_perf_mark(operation: &str, mark: PerfFontMark, elapsed: Duration) {
        eprintln!(
            "perf_mark {operation} [{}]: {} glyphs / {} points in {:?}",
            mark.label,
            mark.glyphs,
            mark.total_points(),
            elapsed
        );
    }

    fn independent_axis_mapping(name: &str, axis: &Axis) -> AxisMapping {
        let input = Location::from([(axis.id(), axis.default())]);
        let output = input.clone();

        AxisMapping::new(
            name.to_string(),
            vec![axis.id()],
            vec![axis.id()],
            vec![AxisMappingPoint {
                description: None,
                input,
                output,
            }],
        )
    }

    fn cross_axis_mapping(name: &str, axes: &[Axis]) -> AxisMapping {
        let input = Location::at_defaults(axes);
        let output = input.clone();
        let axis_ids = axes.iter().map(Axis::id).collect::<Vec<_>>();

        AxisMapping::new(
            name.to_string(),
            axis_ids.clone(),
            axis_ids,
            vec![AxisMappingPoint {
                description: None,
                input,
                output,
            }],
        )
    }

    #[test]
    fn font_creation() {
        let font = Font::new();
        assert_eq!(font.glyph_count(), 0);
        assert_eq!(font.sources().len(), 1);
        assert_eq!(font.default_source().map(Source::name), Some("Regular"));
    }

    #[test]
    fn duplicate_axis_mapping_ids_are_rejected() {
        let mut font = Font::new();
        let axis = Axis::weight();
        let mapping = independent_axis_mapping("Weight curve", &axis);
        font.add_axis(axis).expect("test axis should be valid");

        let result = font.set_axis_mappings(vec![mapping.clone(), mapping]);

        assert!(matches!(result, Err(CoreError::DuplicateAxisMappingId(_))));
    }

    #[test]
    fn duplicate_axis_mapping_names_are_rejected() {
        let mut font = Font::new();
        let axis = Axis::weight();
        let first = independent_axis_mapping("Weight curve", &axis);
        let second = independent_axis_mapping("Weight curve", &axis);
        font.add_axis(axis).expect("test axis should be valid");

        let result = font.set_axis_mappings(vec![first, second]);

        assert!(matches!(
            result,
            Err(CoreError::DuplicateAxisMappingName(name)) if name == "Weight curve"
        ));
    }

    #[test]
    fn independent_axis_mappings_cannot_share_an_output() {
        let mut font = Font::new();
        let axis = Axis::weight();
        let first = independent_axis_mapping("Weight curve", &axis);
        let second = independent_axis_mapping("Weight correction", &axis);
        let first_id = first.id();
        let second_id = second.id();
        font.add_axis(axis).expect("test axis should be valid");

        let result = font.set_axis_mappings(vec![first, second]);

        assert!(matches!(
            result,
            Err(CoreError::InvalidAxisMapping {
                mapping_id,
                message,
            }) if mapping_id == second_id && message.contains(&first_id.to_string())
        ));
    }

    #[test]
    fn only_one_cross_axis_mapping_group_is_allowed() {
        let mut font = Font::new();
        let axes = [Axis::weight(), Axis::width()];
        let first = cross_axis_mapping("Weight-width correction", &axes);
        let second = cross_axis_mapping("Optical correction", &axes);
        let first_id = first.id();
        let second_id = second.id();
        for axis in axes {
            font.add_axis(axis).expect("test axis should be valid");
        }

        let result = font.set_axis_mappings(vec![first, second]);

        assert!(matches!(
            result,
            Err(CoreError::InvalidAxisMapping {
                mapping_id,
                message,
            }) if mapping_id == second_id && message.contains(&first_id.to_string())
        ));
    }

    #[test]
    fn replacing_axis_cannot_invalidate_existing_mapping() {
        let mut font = Font::new();
        let axis = Axis::weight();
        let axis_id = axis.id();
        font.add_axis(axis.clone())
            .expect("test axis should be valid");
        let input = Location::from([(axis_id, 900.0)]);
        let output = Location::from([(axis_id, 800.0)]);
        font.set_axis_mappings(vec![AxisMapping::new(
            "Weight curve".to_string(),
            vec![axis_id],
            vec![axis_id],
            vec![AxisMappingPoint {
                description: None,
                input,
                output,
            }],
        )])
        .unwrap();

        let mut replacement = axis;
        replacement.set_role(AxisRole::Internal);
        let result = font.replace_axis(replacement);

        assert!(matches!(result, Err(CoreError::InvalidAxisMapping { .. })));
        assert_eq!(font.axis(axis_id).unwrap().role(), AxisRole::External);
    }

    #[test]
    fn removing_axis_rejects_collapsed_named_instance_locations() {
        let mut font = Font::new();
        let weight = Axis::weight();
        let width = Axis::width();
        let weight_id = weight.id();
        let width_id = width.id();
        font.add_axis(weight).expect("weight axis should be valid");
        font.add_axis(width).expect("width axis should be valid");

        let narrow = ExternalLocation::from([(weight_id, 400.0), (width_id, 75.0)]);
        let wide = ExternalLocation::from([(weight_id, 400.0), (width_id, 125.0)]);
        font.set_named_instances(vec![
            NamedInstance::new("Narrow".to_string(), narrow, None),
            NamedInstance::new("Wide".to_string(), wide, None),
        ])
        .unwrap();

        assert!(matches!(
            font.remove_axis(width_id),
            Err(CoreError::DuplicateNamedInstanceLocation { .. })
        ));
        assert_eq!(font.axes().len(), 2);
        assert_eq!(font.named_instances().len(), 2);
    }

    #[test]
    fn font_glyph_operations() {
        let mut font = Font::new();
        let mut glyph = Glyph::with_unicode("A".to_string(), 65);
        let layer =
            GlyphLayer::with_width(LayerId::new(), font.default_source_id().unwrap(), 600.0);
        let layer_id = layer.id();
        glyph.set_layer(layer);

        let glyph_id = font.insert_glyph(glyph).unwrap();

        assert_eq!(font.glyph_count(), 1);
        assert!(font.glyph(glyph_id).is_some());
        assert_eq!(font.glyph_id_by_name("A"), Some(glyph_id));
        assert!(font.glyph_by_name("A").is_some());
        assert_eq!(font.glyph_id_by_layer(layer_id), Some(glyph_id));
        assert_eq!(
            font.layer_id_for_glyph_source(glyph_id, font.default_source_id().unwrap()),
            Some(layer_id)
        );
        assert_eq!(
            font.glyphs_by_unicode(65)
                .map(Glyph::id)
                .collect::<Vec<_>>(),
            vec![glyph_id]
        );
    }

    #[test]
    fn glyph_layer_batch_replacement_is_atomic() {
        let mut font = Font::new();
        let source_id = font.default_source_id().unwrap();
        let first_layer = GlyphLayer::with_width(LayerId::new(), source_id, 500.0);
        let first_layer_id = first_layer.id();
        let mut first_glyph = Glyph::new("A");
        first_glyph.set_layer(first_layer);
        font.insert_glyph(first_glyph).unwrap();

        let second_layer = GlyphLayer::with_width(LayerId::new(), source_id, 600.0);
        let second_layer_id = second_layer.id();
        let mut second_glyph = Glyph::new("B");
        second_glyph.set_layer(second_layer);
        font.insert_glyph(second_glyph).unwrap();

        let contour_id = ContourId::new();
        let mut first_contour = Contour::with_id(contour_id.clone());
        first_contour.add_point(0.0, 0.0, PointType::OnCurve, false);
        let mut first_replacement = GlyphLayer::with_width(first_layer_id, source_id, 700.0);
        first_replacement.add_contour(first_contour);

        let mut second_contour = Contour::with_id(contour_id.clone());
        second_contour.add_point(10.0, 10.0, PointType::OnCurve, false);
        let mut second_replacement = GlyphLayer::with_width(second_layer_id, source_id, 800.0);
        second_replacement.add_contour(second_contour);

        assert!(matches!(
            font.replace_glyph_layers(vec![first_replacement, second_replacement]),
            Err(CoreError::DuplicateContourId(id)) if id == contour_id
        ));
        assert_eq!(font.layer(first_layer_id).unwrap().width(), 500.0);
        assert_eq!(font.layer(second_layer_id).unwrap().width(), 600.0);

        font.replace_glyph_layers(vec![
            GlyphLayer::with_width(first_layer_id, source_id, 700.0),
            GlyphLayer::with_width(second_layer_id, source_id, 800.0),
        ])
        .unwrap();
        assert_eq!(font.layer(first_layer_id).unwrap().width(), 700.0);
        assert_eq!(font.layer(second_layer_id).unwrap().width(), 800.0);
    }

    #[test]
    fn component_queries_follow_loaded_components_both_ways() {
        let mut font = Font::new();
        let source_id = font.default_source_id().unwrap();
        let glyph_with = |name: &str, bases: &[&Glyph]| {
            let mut layer = GlyphLayer::with_width(LayerId::new(), source_id, 500.0);
            for base in bases {
                layer.add_component(Component::with_id(
                    ComponentId::new(),
                    base.id(),
                    base.name(),
                    crate::DecomposedTransform::default(),
                ));
            }
            let mut glyph = Glyph::new(name);
            glyph.set_layer(layer);
            glyph
        };
        let base = glyph_with("a", &[]);
        let mark = glyph_with("acute", &[]);
        let composite = glyph_with("aacute", &[&base, &mark]);
        let base_layer = base.layer_ids().next().unwrap();
        let composite_layer = composite.layer_ids().next().unwrap();
        let (base_id, mark_id, composite_id) = (base.id(), mark.id(), composite.id());
        for glyph in [base, mark, composite] {
            font.insert_glyph(glyph).unwrap();
        }

        assert_eq!(
            font.dependent_glyph_ids([&base_layer]),
            BTreeSet::from([composite_id])
        );
        let drawn = BTreeSet::from([base_id, mark_id]);
        assert_eq!(
            font.component_glyph_ids_of_layers([&composite_layer]),
            drawn
        );
        assert_eq!(font.component_glyph_ids_of_glyphs([&composite_id]), drawn);
        assert_eq!(
            font.layer_ids_of_glyphs([&composite_id]),
            BTreeSet::from([composite_layer])
        );
    }

    #[test]
    fn glyph_layer_value_replacement_preserves_structure_indexes_and_snapshots() {
        let mut font = Font::new();
        let source_id = font.default_source_id().unwrap();
        let contour_id = ContourId::new();
        let point_id = PointId::new();
        let anchor_id = AnchorId::new();
        let component_id = ComponentId::new();
        let mut contour = Contour::with_id(contour_id.clone());
        contour.add_point_with_id(point_id.clone(), 10.0, 20.0, PointType::OnCurve, false);
        let mut layer = GlyphLayer::with_width(LayerId::new(), source_id, 500.0);
        layer.add_contour(contour);
        layer.add_anchor(Anchor::with_id(
            anchor_id.clone(),
            Some("top".to_string()),
            30.0,
            40.0,
        ));
        layer.add_component(Component::with_id(
            component_id.clone(),
            GlyphId::new(),
            "base",
            crate::DecomposedTransform::default(),
        ));
        let layer_id = layer.id();
        let mut glyph = Glyph::new("A");
        glyph.set_layer(layer);
        font.insert_glyph(glyph).unwrap();

        let snapshot = font.clone();
        let mut expected = font.layer(layer_id).unwrap().clone();
        expected.set_width(700.0);
        expected.contours_iter_mut().next().unwrap().points_mut()[0].set_position(50.0, 60.0);
        expected
            .anchors_iter_mut()
            .next()
            .unwrap()
            .set_position(70.0, 80.0);
        expected
            .components_iter_mut()
            .next()
            .unwrap()
            .translate(90.0, 100.0);
        let values = expected.interpolation_values();

        font.replace_glyph_layer_values(layer_id, &values).unwrap();

        assert_eq!(font.layer(layer_id).unwrap(), &expected);
        assert_ne!(snapshot.layer(layer_id).unwrap(), &expected);
        assert!(font.has_contour_id(&contour_id));
        assert!(font.has_point_id(&point_id));
        assert!(font.has_anchor_id(&anchor_id));
        assert!(
            font.index()
                .entity_ids
                .contains(&GlyphEntityId::from(component_id))
        );

        let committed = font.layer(layer_id).unwrap().clone();
        let mut invalid = values.into_vec();
        invalid[0] = f64::NAN;
        assert!(matches!(
            font.replace_glyph_layer_values(layer_id, &GlyphInterpolationValues::new(invalid)),
            Err(CoreError::InvalidPositionUpdateInput { .. })
        ));
        assert_eq!(font.layer(layer_id).unwrap(), &committed);
    }

    #[test]
    fn glyph_layer_batch_replacement_preserves_snapshots_and_identity_indexes() {
        let mut font = Font::new();
        let source_id = font.default_source_id().unwrap();
        let contour_id = ContourId::new();
        let point_id = PointId::new();
        let component_id = ComponentId::new();
        let anchor_id = AnchorId::new();
        let guideline_id = GuidelineId::new();
        let base_glyph_id = GlyphId::new();
        let mut contour = Contour::with_id(contour_id.clone());
        contour.add_point_with_id(point_id.clone(), 0.0, 0.0, PointType::OnCurve, false);
        let mut first_layer = GlyphLayer::with_width(LayerId::new(), source_id, 500.0);
        first_layer.add_contour(contour);
        first_layer.add_component(Component::with_id(
            component_id.clone(),
            base_glyph_id,
            "base",
            crate::DecomposedTransform::default(),
        ));
        first_layer.add_anchor(Anchor::with_id(
            anchor_id.clone(),
            Some("top".to_string()),
            0.0,
            100.0,
        ));
        first_layer.add_guideline(Guideline::with_id(
            guideline_id.clone(),
            None,
            Some(0.0),
            None,
            None,
            None,
        ));
        let first_layer_id = first_layer.id();
        let mut first_glyph = Glyph::new("A");
        first_glyph.set_layer(first_layer);
        font.insert_glyph(first_glyph).unwrap();

        let second_layer = GlyphLayer::with_width(LayerId::new(), source_id, 600.0);
        let second_layer_id = second_layer.id();
        let mut second_glyph = Glyph::new("B");
        second_glyph.set_layer(second_layer);
        font.insert_glyph(second_glyph).unwrap();

        let snapshot = font.clone();
        let mut replacement = font.layer(first_layer_id).unwrap().clone();
        replacement.set_width(700.0);
        font.replace_glyph_layers(vec![replacement]).unwrap();

        assert_eq!(font.layer(first_layer_id).unwrap().width(), 700.0);
        assert_eq!(snapshot.layer(first_layer_id).unwrap().width(), 500.0);
        assert!(font.has_contour_id(&contour_id));
        assert!(font.has_point_id(&point_id));
        assert!(font.has_anchor_id(&anchor_id));

        let mut conflicting_contour = Contour::new();
        conflicting_contour.add_point_with_id(
            point_id.clone(),
            10.0,
            10.0,
            PointType::OnCurve,
            false,
        );
        let mut conflicting_layer = GlyphLayer::with_width(second_layer_id, source_id, 800.0);
        conflicting_layer.add_contour(conflicting_contour);
        assert!(matches!(
            font.replace_glyph_layers(vec![conflicting_layer]),
            Err(CoreError::DuplicatePointId(id)) if id == point_id
        ));

        let mut conflicting_layer = GlyphLayer::with_width(second_layer_id, source_id, 800.0);
        conflicting_layer.add_component(Component::with_id(
            component_id.clone(),
            base_glyph_id,
            "base",
            crate::DecomposedTransform::default(),
        ));
        assert!(matches!(
            font.replace_glyph_layers(vec![conflicting_layer]),
            Err(CoreError::DuplicateComponentId(id)) if id == component_id
        ));

        let mut conflicting_layer = GlyphLayer::with_width(second_layer_id, source_id, 800.0);
        conflicting_layer.add_anchor(Anchor::with_id(anchor_id.clone(), None, 10.0, 10.0));
        assert!(matches!(
            font.replace_glyph_layers(vec![conflicting_layer]),
            Err(CoreError::DuplicateAnchorId(id)) if id == anchor_id
        ));

        let mut conflicting_layer = GlyphLayer::with_width(second_layer_id, source_id, 800.0);
        conflicting_layer.add_guideline(Guideline::with_id(
            guideline_id.clone(),
            Some(10.0),
            None,
            None,
            None,
            None,
        ));
        assert!(matches!(
            font.replace_glyph_layers(vec![conflicting_layer]),
            Err(CoreError::DuplicateGuidelineId(id)) if id == guideline_id
        ));
        assert_eq!(font.layer(second_layer_id).unwrap().width(), 600.0);

        let emptied = GlyphLayer::with_width(first_layer_id, source_id, 700.0);
        let mut transferred_contour = Contour::with_id(contour_id.clone());
        transferred_contour.add_point_with_id(
            point_id.clone(),
            20.0,
            20.0,
            PointType::OnCurve,
            false,
        );
        let mut transferred = GlyphLayer::with_width(second_layer_id, source_id, 800.0);
        transferred.add_contour(transferred_contour);
        transferred.add_component(Component::with_id(
            component_id,
            base_glyph_id,
            "base",
            crate::DecomposedTransform::default(),
        ));
        transferred.add_anchor(Anchor::with_id(anchor_id.clone(), None, 20.0, 20.0));
        transferred.add_guideline(Guideline::with_id(
            guideline_id,
            None,
            Some(20.0),
            None,
            None,
            None,
        ));
        font.replace_glyph_layers(vec![emptied, transferred])
            .unwrap();

        assert_eq!(font.layer(second_layer_id).unwrap().width(), 800.0);
        assert!(font.has_contour_id(&contour_id));
        assert!(font.has_point_id(&point_id));
        assert!(font.has_anchor_id(&anchor_id));
    }

    #[test]
    fn axis_and_source_order_require_exact_identity_permutations() {
        let mut font = Font::new();
        font.clear_sources();

        let source_a = SourceId::from_raw("a");
        let source_b = SourceId::from_raw("b");
        let source_c = SourceId::from_raw("c");
        for (source_id, name) in [(source_a, "A"), (source_b, "B"), (source_c, "C")] {
            font.add_source(Source::with_id(
                source_id,
                name.to_string(),
                DesignLocation::new(),
                None,
            ));
        }

        font.set_source_order(&[source_c, source_a, source_b])
            .unwrap();
        assert_eq!(
            font.sources().iter().map(Source::id).collect::<Vec<_>>(),
            [source_c, source_a, source_b]
        );
        let reordered_sources = font.clone();
        for invalid in [
            vec![source_a, source_b],
            vec![source_a, source_a, source_c],
            vec![source_a, source_b, SourceId::from_raw("d")],
        ] {
            assert!(matches!(
                font.set_source_order(&invalid),
                Err(CoreError::OrderLengthMismatch {
                    kind: EntityKind::Source,
                    ..
                } | CoreError::UnknownOrRepeatedId {
                    kind: EntityKind::Source,
                    ..
                })
            ));
            assert_eq!(font, reordered_sources);
        }

        let axis_a = AxisId::from_raw("a");
        let axis_b = AxisId::from_raw("b");
        let axis_c = AxisId::from_raw("c");
        for (axis_id, tag, name) in [
            (axis_a, "AAAA", "A"),
            (axis_b, "BBBB", "B"),
            (axis_c, "CCCC", "C"),
        ] {
            font.add_axis(Axis::with_id(
                axis_id,
                tag.to_string(),
                name.to_string(),
                0.0,
                0.0,
                1.0,
            ))
            .unwrap();
        }

        font.set_axis_order(&[axis_c, axis_a, axis_b]).unwrap();
        assert_eq!(
            font.axes().iter().map(Axis::id).collect::<Vec<_>>(),
            [axis_c, axis_a, axis_b]
        );
        let reordered_axes = font.clone();
        for invalid in [
            vec![axis_a, axis_b],
            vec![axis_a, axis_a, axis_c],
            vec![axis_a, axis_b, AxisId::from_raw("d")],
        ] {
            assert!(matches!(
                font.set_axis_order(&invalid),
                Err(CoreError::OrderLengthMismatch {
                    kind: EntityKind::Axis,
                    ..
                } | CoreError::UnknownOrRepeatedId {
                    kind: EntityKind::Axis,
                    ..
                })
            ));
            assert_eq!(font, reordered_axes);
        }
    }

    #[test]
    fn font_pop_insert_glyph() {
        let mut font = Font::new();
        let glyph = Glyph::with_unicode("A".to_string(), 65);
        let glyph_id = font.insert_glyph(glyph).unwrap();

        let taken = font.pop_glyph(glyph_id).unwrap();
        assert_eq!(font.glyph_count(), 0);
        assert_eq!(font.glyph_id_by_name("A"), None);

        font.insert_glyph(taken).unwrap();
        assert_eq!(font.glyph_count(), 1);
        assert_eq!(font.glyph_id_by_name("A"), Some(glyph_id));
        assert_eq!(font.glyph_order(glyph_id), Some(0));

        let second_id = font.insert_glyph(Glyph::new("B")).unwrap();
        let before_invalid_pop = font.clone();
        assert!(matches!(
            font.pop_glyph(glyph_id),
            Err(CoreError::GlyphNotAtTail(_))
        ));
        assert_eq!(font, before_invalid_pop);
        assert_eq!(font.pop_glyph(second_id).unwrap().id(), second_id);
        assert_eq!(font.glyph_order(glyph_id), Some(0));
    }

    #[test]
    fn glyph_names_are_unique() {
        let mut font = Font::new();
        font.insert_glyph(Glyph::new("A")).unwrap();

        let error = font.insert_glyph(Glyph::new("A")).unwrap_err();

        assert!(matches!(error, CoreError::DuplicateGlyphName(name) if name.as_str() == "A"));
    }

    #[test]
    fn glyph_iteration_preserves_insertion_order() {
        let mut font = Font::new();
        font.insert_glyph(Glyph::new("B")).unwrap();
        font.insert_glyph(Glyph::new("A")).unwrap();

        let names: Vec<_> = font
            .glyphs()
            .map(|glyph| glyph.name().to_string())
            .collect();

        assert_eq!(names, vec!["B", "A"]);
    }

    #[test]
    fn rename_glyph_keeps_id_stable_and_updates_name_index() {
        let mut font = Font::new();
        let glyph_id = font.insert_glyph(Glyph::new("A")).unwrap();

        font.rename_glyph(glyph_id, GlyphName::from("A.alt"))
            .unwrap();

        assert_eq!(font.glyph_id_by_name("A"), None);
        assert_eq!(font.glyph_id_by_name("A.alt"), Some(glyph_id));
        assert_eq!(font.glyph(glyph_id).unwrap().name(), "A.alt");
    }

    #[test]
    fn unicode_lookup_returns_all_matching_glyphs() {
        let mut font = Font::new();
        let a = font.insert_glyph(Glyph::with_unicode("A", 0x41)).unwrap();
        let a_alt = font
            .insert_glyph(Glyph::with_unicode("A.alt", 0x41))
            .unwrap();

        let glyph_ids: Vec<_> = font.glyphs_by_unicode(0x41).map(Glyph::id).collect();

        assert_eq!(glyph_ids, vec![a, a_alt]);
    }

    #[test]
    fn serialized_fonts_are_stable_across_a_round_trip() {
        let fonts = [sample_font(), crate::test_support::sample_variable_font()];
        for font in fonts {
            let first = serde_json::to_vec(&font).unwrap();
            let decoded: Font = serde_json::from_slice(&first).unwrap();
            let second = serde_json::to_vec(&decoded).unwrap();

            assert_eq!(String::from_utf8(first), String::from_utf8(second));
        }
    }

    #[test]
    fn deserialization_rebuilds_private_indexes() {
        let mut font = Font::new();
        let source_id = font.default_source_id().unwrap();
        let mut glyph = Glyph::with_unicode("A", 0x41);
        let layer = GlyphLayer::new(LayerId::new(), source_id);
        let layer_id = layer.id();
        glyph.set_layer(layer);
        let glyph_id = font.insert_glyph(glyph).unwrap();

        let json = serde_json::to_string(&font).unwrap();
        let decoded: Font = serde_json::from_str(&json).unwrap();

        assert_eq!(decoded.glyph_id_by_name("A"), Some(glyph_id));
        assert_eq!(decoded.glyph_id_by_layer(layer_id), Some(glyph_id));
        assert_eq!(
            decoded.layer_id_for_glyph_source(glyph_id, source_id),
            Some(layer_id)
        );
        assert_eq!(
            decoded
                .glyphs_by_unicode(0x41)
                .map(Glyph::id)
                .collect::<Vec<_>>(),
            vec![glyph_id]
        );
    }

    #[test]
    fn font_equality_detects_field_divergence() {
        let original = sample_font();
        let mut changed = original.clone();

        let point = changed
            .layer_mut(LayerId::from_raw("A_regular"))
            .unwrap()
            .contour_mut(&ContourId::from_raw("A_outer"))
            .unwrap()
            .get_point_mut(&PointId::from_raw("A_1"))
            .unwrap();
        point.set_position(point.x(), point.y() + 1.0);

        assert_ne!(changed, original);
    }

    #[test]
    fn font_equality_ignores_index() {
        let original = sample_font();
        let mut reindexed = original.clone();
        Arc::make_mut(&mut reindexed.state).index = FontIndex::default();

        assert_ne!(
            reindexed.glyph_id_by_name("A"),
            original.glyph_id_by_name("A")
        );
        assert_eq!(reindexed, original);
    }

    #[test]
    fn duplicate_glyph_source_layer_is_an_error() {
        let mut font = Font::new();
        let source_id = font.default_source_id().unwrap();
        let glyph_id = font.insert_glyph(Glyph::new("A")).unwrap();
        let layer_id = LayerId::new();

        font.create_glyph_layer(layer_id, glyph_id, source_id)
            .unwrap();
        let error = font
            .create_glyph_layer(LayerId::new(), glyph_id, source_id)
            .unwrap_err();

        assert!(matches!(
            error,
            CoreError::DuplicateGlyphLayer {
                glyph_id: id,
                source_id: source
            } if id == glyph_id && source == source_id
        ));
    }

    #[test]
    fn a_rejected_glyph_leaves_the_index_unchanged() {
        let mut font = sample_font();
        let before = font.index().clone();
        let source_id = font.default_source_id().unwrap();
        // The name is free, but the layer id belongs to `A`, so the insert
        // fails after the name index has already accepted the glyph.
        let mut glyph = Glyph::new("fresh");
        glyph.set_layer(GlyphLayer::new(LayerId::from_raw("A_regular"), source_id));

        assert!(matches!(
            font.insert_glyph(glyph),
            Err(CoreError::DuplicateLayerId(_))
        ));
        assert_eq!(*font.index(), before);
        assert_eq!(font.glyph_id_by_name("fresh"), None);
    }

    #[test]
    fn layer_indexes_update_after_layer_removal() {
        let mut font = Font::new();
        let source_id = font.default_source_id().unwrap();
        let glyph_id = font.insert_glyph(Glyph::new("A")).unwrap();
        let layer_id = LayerId::new();
        font.create_glyph_layer(layer_id, glyph_id, source_id)
            .unwrap();

        assert_eq!(font.glyph_id_by_layer(layer_id), Some(glyph_id));
        assert_eq!(
            font.layer_id_for_glyph_source(glyph_id, source_id),
            Some(layer_id)
        );

        font.remove_glyph_layer(layer_id).unwrap();

        assert_eq!(font.glyph_id_by_layer(layer_id), None);
        assert_eq!(font.layer_id_for_glyph_source(glyph_id, source_id), None);
    }

    #[test]
    fn index_validation_rejects_duplicate_layers_for_one_glyph_source() {
        let source_id = SourceId::new();
        let mut glyph = Glyph::new("A");
        glyph.set_layer(GlyphLayer::new(LayerId::new(), source_id));
        glyph.set_layer(GlyphLayer::new(LayerId::new(), source_id));
        let mut glyphs = PersistentEntityList::new();
        glyphs.insert(Arc::new(glyph));

        let error = FontIndex::from_glyphs(&glyphs).unwrap_err();

        assert!(matches!(
            error,
            CoreError::DuplicateGlyphLayer {
                glyph_id: _,
                source_id: source
            } if source == source_id
        ));
    }

    #[test]
    fn cloned_font_shares_storage_until_mutated() {
        let mut font = Font::new();
        let snapshot = font.clone();

        assert!(Arc::ptr_eq(&font.state, &snapshot.state));

        font.metadata_mut().family_name = Some("Edited".to_string());

        assert!(!Arc::ptr_eq(&font.state, &snapshot.state));
        assert_eq!(font.metadata().family_name.as_deref(), Some("Edited"));
        assert_eq!(
            snapshot.metadata().family_name.as_deref(),
            Some("Untitled Font")
        );
    }

    #[test]
    fn mutating_one_glyph_after_snapshot_keeps_other_glyphs_shared() {
        let mut font = Font::new();
        let a = font
            .insert_glyph(Glyph::with_unicode("A".to_string(), 65))
            .unwrap();
        let b = font
            .insert_glyph(Glyph::with_unicode("B".to_string(), 66))
            .unwrap();
        let snapshot = font.clone();

        font.set_glyph_unicodes(a, vec![0x41, 0x00C1]).unwrap();

        assert_eq!(font.glyph(a).unwrap().unicodes(), &[0x41, 0x00C1]);
        assert_eq!(snapshot.glyph(a).unwrap().unicodes(), &[0x41]);
        assert!(!Arc::ptr_eq(
            font.state.data.glyphs.get(&a).unwrap(),
            snapshot.state.data.glyphs.get(&a).unwrap()
        ));
        assert!(Arc::ptr_eq(
            font.state.data.glyphs.get(&b).unwrap(),
            snapshot.state.data.glyphs.get(&b).unwrap()
        ));
    }

    #[test]
    fn perf_mark_large_font_clone_is_cow_snapshot() {
        let marks = [
            PerfFontMark {
                label: "small-latin",
                glyphs: 250,
                contours_per_glyph: 2,
                points_per_contour: 12,
            },
            PerfFontMark {
                label: "large-latin",
                glyphs: 2_000,
                contours_per_glyph: 4,
                points_per_contour: 16,
            },
            PerfFontMark {
                label: "cjk-scale",
                glyphs: 10_000,
                contours_per_glyph: 2,
                points_per_contour: 8,
            },
        ];

        for mark in marks {
            let font = synthetic_point_heavy_font(mark);
            let start = Instant::now();
            let snapshots: Vec<_> = (0..128).map(|_| font.clone()).collect();
            let elapsed = start.elapsed();

            assert_eq!(font.glyph_count(), mark.glyphs);
            for snapshot in &snapshots {
                assert!(Arc::ptr_eq(&font.state, &snapshot.state));
                assert_eq!(snapshot.glyph_count(), font.glyph_count());
            }

            print_perf_mark("font.clone snapshots x128", mark, elapsed);
            assert_within_budget(
                elapsed,
                &format!(
                    "COW snapshot creation should stay comfortably sub-second for {}",
                    mark.label
                ),
            );
        }
    }

    /// Median time of `edit` over fifteen runs, after one warm-up run.
    fn median_time(mut edit: impl FnMut(u32)) -> Duration {
        edit(0);
        let mut samples: Vec<Duration> = (1..=15)
            .map(|run| {
                let start = Instant::now();
                edit(run);
                start.elapsed()
            })
            .collect();
        samples.sort();
        samples[samples.len() / 2]
    }

    #[test]
    fn perf_mark_one_edit_and_its_undo_cost_what_the_edited_layer_costs() {
        // Every glyph carries geometry, the worst case for anything that walks
        // the whole font: one edit used to copy or rehash all of it.
        let mark = PerfFontMark {
            label: "cjk-scale",
            glyphs: 10_000,
            contours_per_glyph: 2,
            points_per_contour: 8,
        };
        let mut font = synthetic_point_heavy_font(mark);
        let glyph_id = font.glyph_id_by_name("g05000").unwrap();
        let layer_id = font
            .layer_id_for_glyph_source(glyph_id, font.default_source_id().unwrap())
            .unwrap();
        let point_ids: Vec<PointId> = font
            .layer(layer_id)
            .unwrap()
            .contours_iter()
            .flat_map(|contour| contour.points().iter().map(crate::Point::id))
            .collect();

        let moved = median_time(|run| {
            font.apply_intents(&crate::FontIntentSet::from(crate::MovePoints {
                layer_id,
                point_ids: vec![point_ids[0].clone()],
                coords: vec![f64::from(run), 0.0],
            }))
            .unwrap();
        });
        // Removing a whole contour also takes the path that re-indexes the layer.
        let removed = median_time(|_| {
            let applied = font
                .apply_intents(&crate::FontIntentSet::from(crate::RemovePoints {
                    layer_id,
                    point_ids: point_ids[8..].to_vec(),
                }))
                .unwrap();
            font.apply_change_set(&applied.changes.inverted()).unwrap();
        });

        print_perf_mark("move one point", mark, moved);
        print_perf_mark("remove a contour, then undo", mark, removed);
        if cfg!(debug_assertions) {
            return;
        }
        let budget = Duration::from_millis(5);
        assert!(moved < budget, "moving one point took {moved:?}");
        assert!(
            removed < budget * 2,
            "removing and restoring a contour took {removed:?}"
        );
    }

    #[test]
    fn perf_mark_one_kerning_edit_costs_the_same_with_many_pairs() {
        let mark = PerfFontMark {
            label: "cjk-scale",
            glyphs: 10_000,
            contours_per_glyph: 2,
            points_per_contour: 8,
        };
        let mut font = synthetic_point_heavy_font(mark);
        let source_id = font.default_source_id().unwrap();
        let glyph_ids: Vec<GlyphId> = font.glyphs().map(Glyph::id).take(530).collect();
        // 280,900 pairs: every pair of the first 530 glyphs.
        for first in &glyph_ids {
            for second in &glyph_ids {
                font.kerning_mut().set_value(
                    source_id,
                    crate::KerningPair::glyphs(*first, *second),
                    -10.0,
                );
            }
        }
        let pair = crate::KerningPair::glyphs(glyph_ids[7], glyph_ids[9]);

        let edited = median_time(|run| {
            font.apply_intents(&crate::FontIntentSet::from(crate::SetKerningValues {
                edits: vec![crate::KerningValueEdit {
                    source_id,
                    pair: pair.clone(),
                    value: Some(f64::from(run)),
                }],
            }))
            .unwrap();
        });

        print_perf_mark("set one kerning value among 280,900 pairs", mark, edited);
        if cfg!(debug_assertions) {
            return;
        }
        assert!(
            edited < Duration::from_millis(1),
            "setting one kerning value took {edited:?}"
        );
    }

    #[test]
    fn perf_mark_large_font_mutating_one_glyph_preserves_unedited_glyph_sharing() {
        let mark = PerfFontMark {
            label: "cjk-scale",
            glyphs: 10_000,
            contours_per_glyph: 2,
            points_per_contour: 8,
        };
        let mut font = synthetic_point_heavy_font(mark);
        let snapshot = font.clone();
        let default_source_id = font.default_source_id().unwrap();
        let glyph_id = font.glyph_id_by_name("g00000").unwrap();
        let layer_id = font
            .layer_id_for_glyph_source(glyph_id, default_source_id)
            .unwrap();
        let other_glyph_id = font.glyph_id_by_name("g00001").unwrap();
        let start = Instant::now();

        font.layer_mut(layer_id)
            .expect("target glyph should exist")
            .set_width(777.0);

        let elapsed = start.elapsed();

        assert_eq!(
            font.layer(layer_id)
                .expect("target source layer should exist")
                .width(),
            777.0
        );
        assert_ne!(
            snapshot
                .layer(layer_id)
                .expect("target source layer should exist")
                .width(),
            777.0
        );
        assert!(!Arc::ptr_eq(
            font.state.data.glyphs.get(&glyph_id).unwrap(),
            snapshot.state.data.glyphs.get(&glyph_id).unwrap()
        ));
        assert!(Arc::ptr_eq(
            font.state.data.glyphs.get(&other_glyph_id).unwrap(),
            snapshot.state.data.glyphs.get(&other_glyph_id).unwrap()
        ));

        print_perf_mark("single glyph mutation after snapshot", mark, elapsed);
        assert_within_budget(
            elapsed,
            "single-glyph COW mutation should stay comfortably sub-second",
        );
    }

    #[test]
    fn perf_mark_large_font_rename_rebuilds_indexes_within_budget() {
        let mark = PerfFontMark {
            label: "cjk-scale",
            glyphs: 10_000,
            contours_per_glyph: 2,
            points_per_contour: 8,
        };
        let mut font = synthetic_point_heavy_font(mark);
        let glyph_id = font.glyph_id_by_name("g00000").unwrap();
        let start = Instant::now();

        font.rename_glyph(glyph_id, GlyphName::from("g00000.alt"))
            .unwrap();

        let elapsed = start.elapsed();

        assert_eq!(font.glyph_id_by_name("g00000"), None);
        assert_eq!(font.glyph_id_by_name("g00000.alt"), Some(glyph_id));
        print_perf_mark("rename glyph and rebuild indexes", mark, elapsed);
        assert_within_budget(
            elapsed,
            "glyph rename index rebuild should stay comfortably sub-second",
        );
    }

    #[test]
    fn perf_mark_large_font_unicode_update_rebuilds_indexes_within_budget() {
        let mark = PerfFontMark {
            label: "cjk-scale",
            glyphs: 10_000,
            contours_per_glyph: 2,
            points_per_contour: 8,
        };
        let mut font = synthetic_point_heavy_font(mark);
        let glyph_id = font.glyph_id_by_name("g00000").unwrap();
        let unicode = 0xE000;
        let start = Instant::now();

        font.set_glyph_unicodes(glyph_id, vec![0x41, unicode])
            .unwrap();

        let elapsed = start.elapsed();

        assert_eq!(
            font.glyphs_by_unicode(unicode)
                .map(Glyph::id)
                .collect::<Vec<_>>(),
            vec![glyph_id]
        );
        print_perf_mark("set glyph unicodes and rebuild indexes", mark, elapsed);
        assert_within_budget(
            elapsed,
            "glyph Unicode index rebuild should stay comfortably sub-second",
        );
    }

    #[test]
    fn perf_mark_large_font_layer_membership_rebuilds_indexes_within_budget() {
        let mark = PerfFontMark {
            label: "cjk-scale",
            glyphs: 10_000,
            contours_per_glyph: 2,
            points_per_contour: 8,
        };
        let mut font = synthetic_point_heavy_font(mark);
        let glyph_id = font.glyph_id_by_name("g00000").unwrap();
        let source_id = font.add_source(Source::new("Bold".to_string(), DesignLocation::new()));
        let start = Instant::now();

        let layer_id = LayerId::new();
        font.create_glyph_layer(layer_id, glyph_id, source_id)
            .unwrap();
        let removed = font.remove_glyph_layer(layer_id).unwrap();

        let elapsed = start.elapsed();

        assert_eq!(removed.id(), layer_id);
        assert_eq!(font.glyph_id_by_layer(layer_id), None);
        assert_eq!(font.layer_id_for_glyph_source(glyph_id, source_id), None);
        print_perf_mark("create/remove layer and rebuild indexes", mark, elapsed);
        assert_within_budget(
            elapsed,
            "glyph layer membership index rebuild should stay comfortably sub-second",
        );
    }

    #[test]
    fn fallback_layer_takes_the_earliest_master_among_equally_complex_layers() {
        let mut font = Font::new();
        let first = font.add_source(Source::new("Light".to_string(), DesignLocation::new()));
        let second = font.add_source(Source::new("Bold".to_string(), DesignLocation::new()));
        // Layer ids sort in source order, so keeping the last tie by id would pick `second`.
        let mut on_first = GlyphLayer::new(LayerId::from_raw("a"), first);
        on_first.add_empty_contour();
        let mut on_second = GlyphLayer::new(LayerId::from_raw("b"), second);
        on_second.add_empty_contour();
        let mut glyph = Glyph::new("A".to_string());
        glyph.set_layer(on_first);
        glyph.set_layer(on_second);
        font.insert_glyph(glyph).unwrap();
        let glyph = font.glyphs().next().unwrap();

        let fallback = font.fallback_layer(glyph).map(|layer| layer.source_id());

        assert_eq!(fallback, Some(first));
    }

    #[test]
    fn master_questions_skip_masters_a_glyph_does_not_draw() {
        let font = crate::test_support::sample_variable_font();
        let glyph = font.glyphs().find(|glyph| glyph.name() == "A").unwrap();
        let default_id = font.default_source_id().unwrap();

        let drawn = font
            .masters_with_layers(glyph)
            .map(|(source, layer)| (source.name(), layer.source_id()))
            .collect::<Vec<_>>();

        assert_eq!(font.default_master().map(Source::id), Some(default_id));
        assert_eq!(
            font.default_master_layer(glyph)
                .map(|layer| layer.source_id()),
            Some(default_id)
        );
        assert_eq!(
            drawn.len(),
            2,
            "the Medium master has no layer for A: {drawn:?}"
        );
        assert!(drawn.iter().all(|(name, _)| *name != "Medium"));
        assert_eq!(font.layer_ids().count(), font.layer_count());
        assert_eq!(font.layer_count(), 2);
    }
}
