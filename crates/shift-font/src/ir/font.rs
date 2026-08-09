use crate::axis::{Axis, AxisMapping, DesignLocation};
use crate::binary_data::BinaryData;
use crate::collection::EntityList;
use crate::entity::{
    AnchorId, AxisId, ContourId, GlyphEntityId, GlyphId, LayerId, MetricId, PointId, SourceId,
};
use crate::error::{CoreError, CoreResult};
use crate::features::FeatureData;
use crate::glyph::{Glyph, GlyphAxis, GlyphLayer, GlyphSource};
use crate::guideline::Guideline;
use crate::interpolation::GlyphInterpolationValues;
use crate::kerning::KerningData;
use crate::lib_data::LibData;
use crate::metrics::{FontMetrics, MetricDefinition, MetricKind, MetricValue};
use crate::named_instance::{validate_named_instances, NamedInstance};
use crate::source::source_locations_equal;
use crate::source::Source;
use crate::{
    AxisLabelId, Component, Condition, GlyphName, GlyphSourceId, GlyphVariantId, NamedInstanceId,
};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

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
    glyphs: EntityList<Arc<Glyph>>,
    kerning: KerningData,
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

#[derive(Clone, Debug, Default)]
struct FontIndex {
    glyph_by_name: HashMap<GlyphName, GlyphId>,
    layer_owner: HashMap<LayerId, GlyphId>,
    layer_by_glyph_source: HashMap<GlyphSourceId, LayerId>,
    glyph_source_owner: HashMap<GlyphSourceId, GlyphId>,
    glyph_variant_owner: HashMap<GlyphVariantId, GlyphId>,
    glyph_axis_owner: HashMap<AxisId, GlyphId>,
    glyphs_by_unicode: HashMap<u32, Vec<GlyphId>>,
    entity_ids: HashSet<GlyphEntityId>,
}

impl FontIndex {
    fn from_font(axes: &[Axis], glyphs: &EntityList<Arc<Glyph>>) -> CoreResult<Self> {
        let mut index = Self::default();
        let mut axis_ids = HashSet::new();
        for axis in axes {
            if !axis_ids.insert(axis.id()) {
                return Err(CoreError::DuplicateAxisId(axis.id()));
            }
        }

        for (glyph_id, glyph) in glyphs.iter() {
            index.validate_glyph_insert(glyph_id.clone(), glyph, &axis_ids)?;
            index.insert_glyph(glyph_id.clone(), glyph);
            axis_ids.extend(glyph.axes().keys().cloned());
        }

        Ok(index)
    }

    fn validate_glyph_insert(
        &self,
        glyph_id: GlyphId,
        glyph: &Glyph,
        font_axis_ids: &HashSet<AxisId>,
    ) -> CoreResult<()> {
        if glyph_id != glyph.id() {
            return Err(CoreError::MismatchedGlyphId {
                key: glyph_id,
                glyph_id: glyph.id(),
            });
        }

        if self.glyph_by_name.contains_key(glyph.glyph_name()) {
            return Err(CoreError::DuplicateGlyphName(glyph.glyph_name().clone()));
        }

        let mut local_axis_ids = HashSet::new();
        for axis in glyph.axes().values() {
            if font_axis_ids.contains(&axis.id())
                || self.glyph_axis_owner.contains_key(&axis.id())
                || !local_axis_ids.insert(axis.id())
            {
                return Err(CoreError::DuplicateAxisId(axis.id()));
            }
        }

        let mut local_variant_ids = HashSet::new();
        for variant in glyph.variants().values() {
            if self.glyph_variant_owner.contains_key(&variant.id())
                || !local_variant_ids.insert(variant.id())
            {
                return Err(CoreError::DuplicateGlyphVariantId(variant.id()));
            }
        }

        let mut local_source_ids = HashSet::new();
        for source in glyph_sources(glyph) {
            if self.glyph_source_owner.contains_key(&source.id())
                || !local_source_ids.insert(source.id())
            {
                return Err(CoreError::DuplicateGlyphSourceId(source.id()));
            }
            if !glyph.layers().contains_key(&source.layer_id()) {
                return Err(CoreError::GlyphSourceLayerNotFound {
                    glyph_source_id: source.id(),
                    layer_id: source.layer_id(),
                });
            }
        }

        let mut local_entities = HashSet::new();
        for layer in glyph.layers().values().map(Arc::as_ref) {
            if self.layer_owner.contains_key(&layer.id()) {
                return Err(CoreError::DuplicateLayerId(layer.id()));
            }

            for entity_id in glyph_entity_ids(layer) {
                if self.entity_ids.contains(&entity_id) || !local_entities.insert(entity_id.clone())
                {
                    return Err(duplicate_entity_error(entity_id));
                }
            }
        }

        Ok(())
    }

    fn validate_layer_insert(&self, layer: &GlyphLayer) -> CoreResult<()> {
        if self.layer_owner.contains_key(&layer.id()) {
            return Err(CoreError::DuplicateLayerId(layer.id()));
        }

        let mut local_entities = HashSet::new();
        for entity_id in glyph_entity_ids(layer) {
            if self.entity_ids.contains(&entity_id) || !local_entities.insert(entity_id.clone()) {
                return Err(duplicate_entity_error(entity_id));
            }
        }

        Ok(())
    }

    fn validate_layer_replacements(
        &self,
        replacements: &[(GlyphId, Arc<GlyphLayer>, Arc<GlyphLayer>)],
    ) -> CoreResult<HashSet<GlyphEntityId>> {
        let removed_ids = replacements
            .iter()
            .flat_map(|(_, previous, _)| glyph_entity_ids(previous))
            .collect::<HashSet<_>>();
        let mut replacement_ids = HashSet::new();

        for (_, _, replacement) in replacements {
            for entity_id in glyph_entity_ids(replacement) {
                if (self.entity_ids.contains(&entity_id) && !removed_ids.contains(&entity_id))
                    || !replacement_ids.insert(entity_id.clone())
                {
                    return Err(duplicate_entity_error(entity_id));
                }
            }
        }

        Ok(replacement_ids)
    }

    fn insert_layer(&mut self, glyph_id: GlyphId, layer: &GlyphLayer) {
        self.layer_owner.insert(layer.id(), glyph_id);
        self.entity_ids.extend(glyph_entity_ids(layer));
    }

    fn remove_layer(&mut self, layer: &GlyphLayer) {
        self.layer_owner.remove(&layer.id());
        for entity_id in glyph_entity_ids(layer) {
            self.entity_ids.remove(&entity_id);
        }
    }

    fn insert_glyph(&mut self, glyph_id: GlyphId, glyph: &Glyph) {
        self.glyph_by_name
            .insert(glyph.glyph_name().clone(), glyph_id.clone());

        for unicode in glyph.unicodes() {
            self.glyphs_by_unicode
                .entry(*unicode)
                .or_default()
                .push(glyph_id.clone());
        }

        for axis in glyph.axes().values() {
            self.glyph_axis_owner.insert(axis.id(), glyph_id.clone());
        }
        for variant in glyph.variants().values() {
            self.glyph_variant_owner
                .insert(variant.id(), glyph_id.clone());
        }
        for source in glyph_sources(glyph) {
            self.glyph_source_owner
                .insert(source.id(), glyph_id.clone());
            self.layer_by_glyph_source
                .insert(source.id(), source.layer_id());
        }
        for layer in glyph.layers().values().map(Arc::as_ref) {
            self.insert_layer(glyph_id.clone(), layer);
        }
    }

    fn remove_glyph(&mut self, glyph_id: GlyphId, glyph: &Glyph) {
        self.glyph_by_name.remove(glyph.glyph_name());

        for unicode in glyph.unicodes() {
            if let Some(glyph_ids) = self.glyphs_by_unicode.get_mut(unicode) {
                glyph_ids.retain(|id| *id != glyph_id);
                if glyph_ids.is_empty() {
                    self.glyphs_by_unicode.remove(unicode);
                }
            }
        }

        for axis in glyph.axes().values() {
            self.glyph_axis_owner.remove(&axis.id());
        }
        for variant in glyph.variants().values() {
            self.glyph_variant_owner.remove(&variant.id());
        }
        for source in glyph_sources(glyph) {
            self.glyph_source_owner.remove(&source.id());
            self.layer_by_glyph_source.remove(&source.id());
        }
        for layer in glyph.layers().values().map(Arc::as_ref) {
            self.remove_layer(layer);
        }
    }
}

fn glyph_sources(glyph: &Glyph) -> impl Iterator<Item = &GlyphSource> {
    glyph.default_sources().values().chain(
        glyph
            .variants()
            .values()
            .flat_map(|variant| variant.sources().values()),
    )
}

fn glyph_entity_ids(layer: &GlyphLayer) -> impl Iterator<Item = GlyphEntityId> + '_ {
    layer
        .contours_iter()
        .map(|contour| GlyphEntityId::from(contour.id()))
        .chain(
            layer
                .contours_iter()
                .flat_map(|contour| contour.points().iter())
                .map(|point| GlyphEntityId::from(point.id())),
        )
        .chain(
            layer
                .components_iter()
                .map(|component| GlyphEntityId::from(component.id())),
        )
        .chain(
            layer
                .anchors_iter()
                .map(|anchor| GlyphEntityId::from(anchor.id())),
        )
        .chain(
            layer
                .guidelines()
                .iter()
                .map(|guideline| GlyphEntityId::from(guideline.id())),
        )
}

fn duplicate_entity_error(id: GlyphEntityId) -> CoreError {
    match id {
        GlyphEntityId::Contour(id) => CoreError::DuplicateContourId(id),
        GlyphEntityId::Point(id) => CoreError::DuplicatePointId(id),
        GlyphEntityId::Component(id) => CoreError::DuplicateComponentId(id),
        GlyphEntityId::Anchor(id) => CoreError::DuplicateAnchorId(id),
        GlyphEntityId::Guideline(id) => CoreError::DuplicateGuidelineId(id),
    }
}

impl FontState {
    fn from_data(data: FontData) -> CoreResult<Self> {
        validate_font_data(&data)?;
        let index = FontIndex::from_font(&data.axes, &data.glyphs)?;
        Ok(Self { data, index })
    }

    fn rebuild_index(&mut self) -> CoreResult<()> {
        self.index = FontIndex::from_font(&self.data.axes, &self.data.glyphs)?;
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
                    glyphs: EntityList::new(),
                    kerning: KerningData::new(),
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

    /// Validates the complete authored graph at a publication boundary.
    pub fn validate(&self) -> CoreResult<()> {
        validate_font_data(self.data())?;
        FontIndex::from_font(self.axes(), &self.data().glyphs)?;
        Ok(())
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
                    glyphs: EntityList::new(),
                    kerning: KerningData::new(),
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

    pub fn metric_definition(&self, metric_id: &MetricId) -> Option<&MetricDefinition> {
        self.metric_definitions()
            .iter()
            .find(|definition| definition.id() == *metric_id)
    }

    pub fn metric_definition_for_kind(&self, kind: MetricKind) -> Option<&MetricDefinition> {
        self.metric_definitions()
            .iter()
            .find(|definition| definition.kind() == kind)
    }

    /// Returns one source's authored value for a standard metric role.
    ///
    /// The font performs the join because it owns both stable metric
    /// definitions and source-local values. `None` means the source or role is
    /// absent; it does not synthesize a default value.
    pub fn metric_value(&self, source_id: SourceId, kind: MetricKind) -> Option<MetricValue> {
        let metric_id = self.metric_definition_for_kind(kind)?.id();
        self.sources()
            .iter()
            .find(|source| source.id() == source_id)?
            .metric_value(&metric_id)
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
            .any(|existing| existing.id() == axis.id())
            || self.index().glyph_axis_owner.contains_key(&axis.id())
        {
            return Err(CoreError::DuplicateAxisId(axis.id()));
        }
        if self
            .axes()
            .iter()
            .any(|existing| existing.tag() == axis.tag())
        {
            return Err(CoreError::DuplicateAxisTag(axis.tag().to_string()));
        }

        let mut axes = self.axes().to_vec();
        axes.push(axis.clone());
        validate_axis_label_ids(&axes)?;

        let mut instances = self.named_instances().to_vec();
        if axis.role() == crate::AxisRole::External {
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
    /// reverse inserts the new external default.
    ///
    /// # Errors
    ///
    /// Returns a validation error when the axis is unknown or the replacement
    /// invalidates labels, mappings, or named products.
    pub fn replace_axis(&mut self, axis: Axis) -> CoreResult<Axis> {
        axis.validate()?;
        let index = self
            .axes()
            .iter()
            .position(|existing| existing.id() == axis.id())
            .ok_or_else(|| CoreError::AxisNotFound(axis.id()))?;
        let mut axes = self.axes().to_vec();
        let previous = axes[index].clone();
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

    pub fn set_axis_mappings(&mut self, mappings: Vec<AxisMapping>) -> CoreResult<()> {
        validate_axis_mappings(self.axes(), &mappings)?;
        self.data_mut().axis_mappings = mappings;
        Ok(())
    }

    pub fn axis_mapping_bases(&self) -> CoreResult<Vec<crate::AxisMappingBasis>> {
        self.axis_mappings()
            .iter()
            .map(|mapping| crate::AxisMappingBasis::try_from((mapping, self.axes())))
            .collect()
    }

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
            .ok_or_else(|| CoreError::AxisNotFound(axis_id.clone()))?;
        if let Some((kind, entity_id)) = self.glyphs().find_map(|glyph| {
            glyph
                .default_sources()
                .values()
                .chain(
                    glyph
                        .variants()
                        .values()
                        .flat_map(|variant| variant.sources().values()),
                )
                .find(|source| source.location().get(&axis_id).is_some())
                .map(|source| ("glyph source", source.id().to_string()))
                .or_else(|| {
                    glyph
                        .variants()
                        .values()
                        .find(|variant| condition_references_axis(variant.condition(), &axis_id))
                        .map(|variant| ("glyph variant", variant.id().to_string()))
                })
                .or_else(|| {
                    glyph
                        .layers()
                        .values()
                        .flat_map(|layer| layer.components_iter())
                        .find(|component| {
                            component.location().get(&axis_id).is_some()
                                || component.condition().is_some_and(|condition| {
                                    condition_references_axis(condition, &axis_id)
                                })
                        })
                        .map(|component| ("component", component.id().to_string()))
                })
        }) {
            return Err(CoreError::AxisReferenced {
                axis_id,
                kind,
                entity_id,
            });
        }
        let mut axes = self.axes().to_vec();
        let axis = axes.remove(index);
        let mut mappings = self.axis_mappings().to_vec();
        mappings.retain(|mapping| {
            !mapping.inputs().contains(&axis_id) && !mapping.outputs().contains(&axis_id)
        });
        let mut sources = self.sources().to_vec();
        for source in &mut sources {
            source.remove_axis_location(&axis_id);
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
            .ok_or_else(|| CoreError::NamedInstanceNotFound(instance.id()))?;
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
            .ok_or_else(|| CoreError::NamedInstanceNotFound(instance_id.clone()))?;
        Ok(self.data_mut().named_instances.remove(index))
    }

    pub fn axis(&self, axis_id: AxisId) -> Option<&Axis> {
        self.data().axes.iter().find(|axis| axis.id() == axis_id)
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

    pub fn source_mut(&mut self, source_id: SourceId) -> Option<&mut Source> {
        self.data_mut()
            .sources
            .iter_mut()
            .find(|source| source.id() == source_id)
    }

    pub fn add_source(&mut self, mut source: Source) -> SourceId {
        if source.is_master() {
            source.fill_metric_values(self.metric_definitions(), self.metrics().units_per_em);
        }
        let source_id = source.id();
        let data = self.data_mut();
        if data.default_source_id.is_none() {
            data.default_source_id = Some(source_id.clone());
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
            .ok_or_else(|| CoreError::SourceNotFound(source.id()))?;
        Ok(std::mem::replace(
            &mut self.data_mut().sources[index],
            source,
        ))
    }

    /// Removes a global source only when no glyph source uses it as a base.
    pub fn remove_source(&mut self, source_id: SourceId) -> CoreResult<Source> {
        if let Some(glyph_source) = self
            .glyphs()
            .flat_map(glyph_sources)
            .find(|glyph_source| glyph_source.base_source_id().as_ref() == Some(&source_id))
        {
            return Err(CoreError::SourceReferencedByGlyphSource {
                source_id,
                glyph_source_id: glyph_source.id(),
            });
        }

        let data = self.data_mut();
        let index = data
            .sources
            .iter()
            .position(|source| source.id() == source_id)
            .ok_or_else(|| CoreError::SourceNotFound(source_id.clone()))?;
        let source = data.sources.remove(index);

        if data.default_source_id == Some(source_id) {
            data.default_source_id = data.sources.first().map(Source::id);
        }

        Ok(source)
    }

    pub fn clear_sources(&mut self) {
        let data = self.data_mut();
        data.sources.clear();
        data.default_source_id = None;
    }

    pub fn default_source_id(&self) -> Option<SourceId> {
        self.data().default_source_id.clone()
    }

    pub fn set_default_source_id(&mut self, source_id: SourceId) {
        self.data_mut().default_source_id = Some(source_id);
    }

    pub fn default_source(&self) -> Option<&Source> {
        let default_source_id = self.data().default_source_id.clone()?;
        self.data()
            .sources
            .iter()
            .find(|source| source.id() == default_source_id)
    }

    pub fn is_variable(&self) -> bool {
        !self.data().axes.is_empty()
    }

    pub fn glyphs(&self) -> impl Iterator<Item = &Glyph> {
        self.data().glyphs.values().map(Arc::as_ref)
    }

    pub fn glyph(&self, glyph_id: GlyphId) -> Option<&Glyph> {
        self.data().glyphs.get(&glyph_id).map(Arc::as_ref)
    }

    pub fn glyph_id_by_name(&self, name: &str) -> Option<GlyphId> {
        self.index().glyph_by_name.get(name).cloned()
    }

    pub fn glyph_by_name(&self, name: &str) -> Option<&Glyph> {
        self.glyph(self.glyph_id_by_name(name)?)
    }

    pub fn glyphs_by_unicode(&self, unicode: u32) -> impl Iterator<Item = &Glyph> {
        self.index()
            .glyphs_by_unicode
            .get(&unicode)
            .into_iter()
            .flatten()
            .filter_map(|glyph_id| self.glyph(glyph_id.clone()))
    }

    pub fn glyph_id_by_layer(&self, layer_id: LayerId) -> Option<GlyphId> {
        self.index().layer_owner.get(&layer_id).cloned()
    }

    pub fn layer_id_for_source(&self, glyph_id: GlyphId, source_id: SourceId) -> Option<LayerId> {
        self.glyph(glyph_id)?
            .layer_for_source(source_id)
            .map(GlyphLayer::id)
    }

    pub fn layer_id_for_glyph_source(&self, glyph_source_id: GlyphSourceId) -> Option<LayerId> {
        self.index()
            .layer_by_glyph_source
            .get(&glyph_source_id)
            .cloned()
    }

    pub fn layer(&self, layer_id: LayerId) -> Option<&GlyphLayer> {
        let glyph_id = self.glyph_id_by_layer(layer_id.clone())?;
        self.glyph(glyph_id)?.layer(layer_id)
    }

    pub fn layer_mut(&mut self, layer_id: LayerId) -> Option<&mut GlyphLayer> {
        let glyph_id = self.glyph_id_by_layer(layer_id.clone())?;
        self.data_mut()
            .glyphs
            .get_mut(&glyph_id)
            .and_then(|glyph| Arc::make_mut(glyph).layer_mut(layer_id))
    }

    pub fn insert_glyph(&mut self, glyph: Glyph) -> CoreResult<GlyphId> {
        let glyph_id = glyph.id();
        if self.data().glyphs.contains(&glyph_id) {
            return Err(CoreError::DuplicateGlyphId(glyph_id));
        }
        let font_axis_ids = self.axes().iter().map(Axis::id).collect();
        self.index()
            .validate_glyph_insert(glyph_id.clone(), &glyph, &font_axis_ids)?;

        let state = self.state_mut();
        state.index.insert_glyph(glyph_id.clone(), &glyph);
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

    /// Rebuilds identity indexes after a structural operation mints nodes internally.
    ///
    /// # Errors
    ///
    /// Returns a duplicate-identity error when the resulting font structure
    /// violates font-wide stable identity.
    pub(crate) fn rebuild_structure_index(&mut self) -> CoreResult<()> {
        let mut state = (*self.state).clone();
        state.rebuild_index()?;
        self.state = Arc::new(state);
        Ok(())
    }

    pub fn remove_glyph(&mut self, glyph_id: GlyphId) -> CoreResult<Glyph> {
        if self.glyph(glyph_id.clone()).is_none() {
            return Err(CoreError::GlyphNotFound(glyph_id));
        }
        if let Some(component) = self
            .glyphs()
            .flat_map(|glyph| glyph.layers().values())
            .flat_map(|layer| layer.components_iter())
            .find(|component| component.base_glyph_id() == glyph_id)
        {
            return Err(CoreError::InvalidAuthoringEntity {
                kind: "glyph",
                entity_id: glyph_id.to_string(),
                message: format!("is referenced by component {}", component.id()),
            });
        }

        let state = self.state_mut();
        let glyph = state
            .data
            .glyphs
            .shift_remove(&glyph_id)
            .map(Arc::unwrap_or_clone)
            .expect("glyph existence was checked");
        state.index.remove_glyph(glyph_id, &glyph);
        Ok(glyph)
    }

    pub fn glyph_count(&self) -> usize {
        self.data().glyphs.len()
    }

    pub fn rename_glyph(&mut self, glyph_id: GlyphId, name: GlyphName) -> CoreResult<()> {
        let mut state = (*self.state).clone();
        let glyph = state
            .data
            .glyphs
            .get_mut(&glyph_id)
            .ok_or(CoreError::GlyphNotFound(glyph_id))?;
        Arc::make_mut(glyph).set_name(name);
        state.rebuild_index()?;
        self.state = Arc::new(state);
        Ok(())
    }

    pub fn set_glyph_unicodes(&mut self, glyph_id: GlyphId, unicodes: Vec<u32>) -> CoreResult<()> {
        let mut state = (*self.state).clone();
        let glyph = state
            .data
            .glyphs
            .get_mut(&glyph_id)
            .ok_or(CoreError::GlyphNotFound(glyph_id))?;
        Arc::make_mut(glyph).set_unicodes(unicodes);
        state.rebuild_index()?;
        self.state = Arc::new(state);
        Ok(())
    }

    pub fn add_glyph_source(
        &mut self,
        glyph_id: GlyphId,
        variant_id: Option<GlyphVariantId>,
        source: GlyphSource,
    ) -> CoreResult<()> {
        if self.index().glyph_source_owner.contains_key(&source.id()) {
            return Err(CoreError::DuplicateGlyphSourceId(source.id()));
        }

        let mut state = (*self.state).clone();
        let glyph = state
            .data
            .glyphs
            .get_mut(&glyph_id)
            .ok_or_else(|| CoreError::GlyphNotFound(glyph_id.clone()))?;
        let glyph = Arc::make_mut(glyph);
        if let Some(variant_id) = variant_id {
            let variant = glyph.variants_mut().get_mut(&variant_id).ok_or_else(|| {
                CoreError::InvalidAuthoringEntity {
                    kind: "glyph variant",
                    entity_id: variant_id.to_string(),
                    message: "does not belong to the glyph".to_string(),
                }
            })?;
            variant.insert_source(source);
        } else {
            glyph.insert_default_source(source);
        }

        state.rebuild_index()?;
        let candidate = Self {
            state: Arc::new(state),
        };
        candidate.validate()?;
        self.state = candidate.state;
        Ok(())
    }

    pub fn remove_glyph_source(
        &mut self,
        glyph_source_id: GlyphSourceId,
    ) -> CoreResult<GlyphSource> {
        let glyph_id = self
            .index()
            .glyph_source_owner
            .get(&glyph_source_id)
            .cloned()
            .ok_or_else(|| CoreError::InvalidAuthoringEntity {
                kind: "glyph source",
                entity_id: glyph_source_id.to_string(),
                message: "does not exist".to_string(),
            })?;

        let mut state = (*self.state).clone();
        let glyph = Arc::make_mut(
            state
                .data
                .glyphs
                .get_mut(&glyph_id)
                .expect("indexed glyph source owner exists"),
        );
        let removed =
            if let Some(source) = glyph.default_sources_mut().shift_remove(&glyph_source_id) {
                source
            } else {
                glyph
                    .variants_mut()
                    .values_mut()
                    .find_map(|variant| variant.sources_mut().shift_remove(&glyph_source_id))
                    .expect("indexed glyph source exists in its owner")
            };

        state.rebuild_index()?;
        let candidate = Self {
            state: Arc::new(state),
        };
        candidate.validate()?;
        self.state = candidate.state;
        Ok(removed)
    }

    pub fn create_glyph_layer(
        &mut self,
        layer_id: LayerId,
        glyph_id: GlyphId,
        source_id: SourceId,
    ) -> CoreResult<()> {
        self.insert_layer_for_source(glyph_id, source_id, GlyphLayer::new(layer_id))?;
        Ok(())
    }

    pub(crate) fn insert_layer_for_source(
        &mut self,
        glyph_id: GlyphId,
        source_id: SourceId,
        layer: GlyphLayer,
    ) -> CoreResult<GlyphSource> {
        let source = self
            .sources()
            .iter()
            .find(|source| source.id() == source_id)
            .ok_or_else(|| CoreError::SourceNotFound(source_id.clone()))?;
        if self.index().layer_owner.contains_key(&layer.id()) {
            return Err(CoreError::DuplicateLayerId(layer.id()));
        }
        if self
            .layer_id_for_source(glyph_id.clone(), source_id.clone())
            .is_some()
        {
            return Err(CoreError::DuplicateGlyphLayer {
                glyph_id,
                source_id,
            });
        }

        let glyph_source = GlyphSource::new(
            source.name().to_string(),
            layer.id(),
            Some(source_id),
            crate::Location::new(),
        );
        let mut state = (*self.state).clone();
        let glyph = state
            .data
            .glyphs
            .get_mut(&glyph_id)
            .ok_or_else(|| CoreError::GlyphNotFound(glyph_id.clone()))?;
        let glyph = Arc::make_mut(glyph);
        glyph.set_layer(layer);
        glyph.insert_default_source(glyph_source.clone());
        state.rebuild_index()?;
        self.state = Arc::new(state);
        Ok(glyph_source)
    }

    pub fn insert_glyph_layer(&mut self, glyph_id: GlyphId, layer: GlyphLayer) -> CoreResult<()> {
        if self.glyph(glyph_id.clone()).is_none() {
            return Err(CoreError::GlyphNotFound(glyph_id));
        }
        self.index().validate_layer_insert(&layer)?;

        let state = self.state_mut();
        let glyph = state
            .data
            .glyphs
            .get_mut(&glyph_id)
            .expect("glyph existence was checked before mutation");
        Arc::make_mut(glyph).set_layer(layer.clone());
        state.index.insert_layer(glyph_id, &layer);
        Ok(())
    }

    /// Replaces one layer's canonical numeric values without changing its structure or indexes.
    ///
    /// Value count and finiteness are validated before the layer changes.
    pub fn replace_glyph_layer_values(
        &mut self,
        layer_id: LayerId,
        values: &GlyphInterpolationValues,
    ) -> CoreResult<()> {
        let glyph_id = self
            .glyph_id_by_layer(layer_id.clone())
            .ok_or(CoreError::LayerNotFound(layer_id.clone()))?;
        let state = self.state_mut();
        let glyph = state
            .data
            .glyphs
            .get_mut(&glyph_id)
            .expect("layer owner was resolved before mutation");
        let layer = Arc::make_mut(glyph)
            .layer_mut(layer_id.clone())
            .ok_or(CoreError::LayerNotFound(layer_id))?;

        layer.apply_interpolation_values(values)
    }

    /// Atomically replaces existing layers after validating the complete batch.
    /// Uniquely owned fonts mutate in place; shared snapshots retain copy-on-write semantics.
    /// Already shared layer snapshots transfer without cloning their geometry.
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
            if !seen_layer_ids.insert(layer_id.clone()) {
                return Err(CoreError::DuplicateLayerId(layer_id));
            }

            let glyph_id = self
                .glyph_id_by_layer(layer_id.clone())
                .ok_or(CoreError::LayerNotFound(layer_id.clone()))?;
            let previous = self
                .data()
                .glyphs
                .get(&glyph_id)
                .and_then(|glyph| glyph.layers().get(&layer_id))
                .cloned()
                .ok_or(CoreError::LayerNotFound(layer_id.clone()))?;
            replacements.push((glyph_id, previous, layer));
        }

        let replacement_ids = self.index().validate_layer_replacements(&replacements)?;

        let state = self.state_mut();
        for (_, previous, _) in &replacements {
            state.index.remove_layer(previous);
        }
        for (glyph_id, _, layer) in replacements {
            state.index.layer_owner.insert(layer.id(), glyph_id.clone());
            let glyph = state
                .data
                .glyphs
                .get_mut(&glyph_id)
                .expect("replacement owner was resolved before mutation");
            Arc::make_mut(glyph).set_layer(layer);
        }
        state.index.entity_ids.extend(replacement_ids);

        Ok(())
    }

    pub fn remove_glyph_layer(&mut self, layer_id: LayerId) -> CoreResult<GlyphLayer> {
        let glyph_id = self
            .glyph_id_by_layer(layer_id.clone())
            .ok_or(CoreError::LayerNotFound(layer_id.clone()))?;
        if let Some(source) = self
            .glyph(glyph_id.clone())
            .into_iter()
            .flat_map(glyph_sources)
            .find(|source| source.layer_id() == layer_id)
        {
            return Err(CoreError::GlyphLayerReferenced {
                layer_id,
                glyph_source_id: source.id(),
            });
        }
        let state = self.state_mut();
        let glyph = state
            .data
            .glyphs
            .get_mut(&glyph_id)
            .ok_or(CoreError::GlyphNotFound(glyph_id.clone()))?;
        let layer = Arc::make_mut(glyph)
            .remove_layer(layer_id.clone())
            .ok_or(CoreError::LayerNotFound(layer_id))?;
        state.index.remove_layer(&layer);
        Ok(layer)
    }

    pub fn kerning(&self) -> &KerningData {
        &self.data().kerning
    }

    pub fn kerning_mut(&mut self) -> &mut KerningData {
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

fn validate_font_data(data: &FontData) -> CoreResult<()> {
    validate_metric_definitions(&data.metric_definitions)?;
    validate_axis_label_ids(&data.axes)?;
    validate_axis_mappings(&data.axes, &data.axis_mappings)?;
    validate_named_instances(&data.named_instances, &data.axes)?;

    let mut axis_ids = HashSet::new();
    for axis in &data.axes {
        axis.validate()?;
        if !axis_ids.insert(axis.id()) {
            return Err(CoreError::DuplicateAxisId(axis.id()));
        }
    }

    let mut source_ids = HashSet::new();
    for source in &data.sources {
        if !source_ids.insert(source.id()) {
            return Err(CoreError::DuplicateSourceId(source.id()));
        }
        validate_source(source, &data.sources, &data.axes, &data.metric_definitions)?;
    }
    if let Some(default_source_id) = &data.default_source_id {
        if !source_ids.contains(default_source_id) {
            return Err(CoreError::SourceNotFound(default_source_id.clone()));
        }
    }

    let glyphs = data
        .glyphs
        .values()
        .map(Arc::as_ref)
        .map(|glyph| (glyph.id(), glyph))
        .collect::<HashMap<_, _>>();
    for glyph in glyphs.values() {
        validate_glyph_authoring(glyph, &data.axes, &source_ids, &glyphs)?;
    }
    validate_component_cycles(&glyphs)?;

    Ok(())
}

fn validate_glyph_authoring(
    glyph: &Glyph,
    font_axes: &[Axis],
    source_ids: &HashSet<SourceId>,
    glyphs: &HashMap<GlyphId, &Glyph>,
) -> CoreResult<()> {
    let mut local_axes = HashMap::new();
    for axis in glyph.axes().values() {
        validate_glyph_axis(axis)?;
        local_axes.insert(axis.id(), axis);
    }

    for source in glyph.default_sources().values() {
        validate_glyph_source(glyph, source, font_axes, &local_axes, source_ids)?;
    }
    for variant in glyph.variants().values() {
        if variant.name().trim().is_empty() {
            return Err(invalid_authoring(
                "glyph variant",
                variant.id().to_string(),
                "name must not be blank",
            ));
        }
        validate_condition(variant.condition(), font_axes, 0)?;
        if variant.sources().is_empty() {
            return Err(invalid_authoring(
                "glyph variant",
                variant.id().to_string(),
                "at least one glyph source is required",
            ));
        }
        for source in variant.sources().values() {
            validate_glyph_source(glyph, source, font_axes, &local_axes, source_ids)?;
        }
    }

    for layer in glyph.layers().values() {
        for component in layer.components_iter() {
            validate_component(component, font_axes, glyphs)?;
        }
    }

    Ok(())
}

fn validate_glyph_axis(axis: &GlyphAxis) -> CoreResult<()> {
    if axis.name().trim().is_empty() {
        return Err(invalid_authoring(
            "glyph axis",
            axis.id().to_string(),
            "name must not be blank",
        ));
    }
    if !axis.minimum().is_finite() || !axis.default().is_finite() || !axis.maximum().is_finite() {
        return Err(invalid_authoring(
            "glyph axis",
            axis.id().to_string(),
            "range values must be finite",
        ));
    }
    if axis.minimum() > axis.default() || axis.default() > axis.maximum() {
        return Err(invalid_authoring(
            "glyph axis",
            axis.id().to_string(),
            "expected minimum <= default <= maximum",
        ));
    }
    Ok(())
}

fn validate_glyph_source(
    glyph: &Glyph,
    source: &GlyphSource,
    font_axes: &[Axis],
    glyph_axes: &HashMap<AxisId, &GlyphAxis>,
    source_ids: &HashSet<SourceId>,
) -> CoreResult<()> {
    if source.name().trim().is_empty() {
        return Err(invalid_authoring(
            "glyph source",
            source.id().to_string(),
            "name must not be blank",
        ));
    }
    if !glyph.layers().contains_key(&source.layer_id()) {
        return Err(CoreError::GlyphSourceLayerNotFound {
            glyph_source_id: source.id(),
            layer_id: source.layer_id(),
        });
    }
    if let Some(base_source_id) = source.base_source_id() {
        if !source_ids.contains(&base_source_id) {
            return Err(CoreError::SourceNotFound(base_source_id));
        }
    }

    for (axis_id, value) in source.location().iter() {
        if !value.is_finite() {
            return Err(invalid_authoring(
                "glyph source",
                source.id().to_string(),
                "location values must be finite",
            ));
        }
        let range = font_axes
            .iter()
            .find(|axis| axis.id() == *axis_id)
            .map(|axis| (axis.minimum(), axis.maximum()))
            .or_else(|| {
                glyph_axes
                    .get(axis_id)
                    .map(|axis| (axis.minimum(), axis.maximum()))
            });
        let Some((minimum, maximum)) = range else {
            return Err(invalid_authoring(
                "glyph source",
                source.id().to_string(),
                format!("location references unknown axis {axis_id}"),
            ));
        };
        if *value < minimum || *value > maximum {
            return Err(invalid_authoring(
                "glyph source",
                source.id().to_string(),
                format!("location on {axis_id} is outside its authored range"),
            ));
        }
    }

    let _ = glyph;
    Ok(())
}

fn validate_component(
    component: &Component,
    font_axes: &[Axis],
    glyphs: &HashMap<GlyphId, &Glyph>,
) -> CoreResult<()> {
    let base_glyph_id = component.base_glyph_id();
    let Some(base_glyph) = glyphs.get(&base_glyph_id) else {
        return Err(invalid_authoring(
            "component",
            component.id().to_string(),
            format!("references missing glyph {base_glyph_id}"),
        ));
    };
    if component.base_glyph_name() != base_glyph.glyph_name() {
        return Err(invalid_authoring(
            "component",
            component.id().to_string(),
            "base glyph name cache does not match its stable glyph reference",
        ));
    }

    let transform = component.transform();
    if [
        transform.translate_x,
        transform.translate_y,
        transform.rotation,
        transform.scale_x,
        transform.scale_y,
        transform.skew_x,
        transform.skew_y,
        transform.t_center_x,
        transform.t_center_y,
    ]
    .iter()
    .any(|value| !value.is_finite())
    {
        return Err(invalid_authoring(
            "component",
            component.id().to_string(),
            "transform values must be finite",
        ));
    }

    for (axis_id, value) in component.location().iter() {
        if !value.is_finite() {
            return Err(invalid_authoring(
                "component",
                component.id().to_string(),
                "location values must be finite",
            ));
        }
        let known = font_axes.iter().any(|axis| axis.id() == *axis_id)
            || base_glyph.axis(axis_id.clone()).is_some();
        if !known {
            return Err(invalid_authoring(
                "component",
                component.id().to_string(),
                format!("location references unsupported axis {axis_id}"),
            ));
        }
    }
    if let Some(condition) = component.condition() {
        validate_condition(condition, font_axes, 0)?;
    }
    Ok(())
}

fn condition_references_axis(condition: &Condition, axis_id: &AxisId) -> bool {
    match condition {
        Condition::AxisRange {
            axis_id: condition_axis_id,
            ..
        } => condition_axis_id == axis_id,
        Condition::And { conditions } | Condition::Or { conditions } => conditions
            .iter()
            .any(|condition| condition_references_axis(condition, axis_id)),
        Condition::Not { condition } => condition_references_axis(condition, axis_id),
    }
}

fn validate_condition(condition: &Condition, font_axes: &[Axis], depth: usize) -> CoreResult<()> {
    if depth >= 64 {
        return Err(invalid_authoring(
            "condition",
            "tree",
            "nesting exceeds 64 levels",
        ));
    }

    match condition {
        Condition::AxisRange {
            axis_id,
            minimum,
            maximum,
        } => {
            if minimum.is_none() && maximum.is_none() {
                return Err(invalid_authoring(
                    "condition",
                    axis_id.to_string(),
                    "axis range requires at least one bound",
                ));
            }
            if !font_axes.iter().any(|axis| axis.id() == *axis_id) {
                return Err(invalid_authoring(
                    "condition",
                    axis_id.to_string(),
                    "axis ranges may reference font axes only",
                ));
            }
            if minimum.is_some_and(|value| !value.is_finite())
                || maximum.is_some_and(|value| !value.is_finite())
            {
                return Err(invalid_authoring(
                    "condition",
                    axis_id.to_string(),
                    "axis range bounds must be finite",
                ));
            }
            if let (Some(minimum), Some(maximum)) = (minimum, maximum) {
                if minimum > maximum {
                    return Err(invalid_authoring(
                        "condition",
                        axis_id.to_string(),
                        "minimum must not exceed maximum",
                    ));
                }
            }
        }
        Condition::And { conditions } | Condition::Or { conditions } => {
            if conditions.is_empty() {
                return Err(invalid_authoring(
                    "condition",
                    "group",
                    "boolean groups must not be empty",
                ));
            }
            for condition in conditions {
                validate_condition(condition, font_axes, depth + 1)?;
            }
        }
        Condition::Not { condition } => {
            validate_condition(condition, font_axes, depth + 1)?;
        }
    }
    Ok(())
}

fn validate_component_cycles(glyphs: &HashMap<GlyphId, &Glyph>) -> CoreResult<()> {
    fn visit(
        glyph_id: &GlyphId,
        glyphs: &HashMap<GlyphId, &Glyph>,
        visiting: &mut HashSet<GlyphId>,
        visited: &mut HashSet<GlyphId>,
    ) -> CoreResult<()> {
        if visited.contains(glyph_id) {
            return Ok(());
        }
        if !visiting.insert(glyph_id.clone()) {
            return Err(invalid_authoring(
                "component graph",
                glyph_id.to_string(),
                "component references form a cycle",
            ));
        }

        let glyph = glyphs
            .get(glyph_id)
            .expect("component validation established every glyph reference");
        for base_glyph_id in glyph
            .layers()
            .values()
            .flat_map(|layer| layer.components_iter())
            .map(Component::base_glyph_id)
        {
            visit(&base_glyph_id, glyphs, visiting, visited)?;
        }

        visiting.remove(glyph_id);
        visited.insert(glyph_id.clone());
        Ok(())
    }

    let mut visiting = HashSet::new();
    let mut visited = HashSet::new();
    for glyph_id in glyphs.keys() {
        visit(glyph_id, glyphs, &mut visiting, &mut visited)?;
    }
    Ok(())
}

fn invalid_authoring(
    kind: &'static str,
    entity_id: impl Into<String>,
    message: impl Into<String>,
) -> CoreError {
    CoreError::InvalidAuthoringEntity {
        kind,
        entity_id: entity_id.into(),
        message: message.into(),
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
            && source_locations_equal(current.location(), source.location(), axes)
    }) {
        return Err(CoreError::DuplicateSourceLocation {
            first: existing.id(),
            second: source.id(),
        });
    }
    for (axis_id, value) in source.location().iter() {
        if !axes.iter().any(|axis| axis.id() == *axis_id) {
            return Err(CoreError::AxisNotFound(axis_id.clone()));
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
            let Some(value) = source.metric_value(&metric_id) else {
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
                metric_id: metric_id.clone(),
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
                if let Some(owner) = independent_outputs.insert(output.clone(), mapping.id()) {
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
mod tests {
    use super::*;
    use crate::{
        test_support::sample_font, Anchor, AxisMappingPoint, AxisRole, Component, ComponentId,
        Contour, ContourId, ExternalLocation, GlyphLayer, GlyphVariant, GuidelineId, LayerId,
        Location, PointId, PointType,
    };
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    fn set_test_layer(glyph: &mut Glyph, source_id: SourceId, layer: GlyphLayer) {
        let layer_id = layer.id();
        glyph.set_layer(layer);
        glyph.insert_default_source(GlyphSource::new(
            source_id.to_string(),
            layer_id,
            Some(source_id),
            Location::new(),
        ));
    }

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
            let mut glyph = Glyph::with_unicode(format!("g{glyph_index:05}"), glyph_index as u32);
            let mut layer = GlyphLayer::with_width(LayerId::new(), 500.0 + glyph_index as f64);

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

            set_test_layer(&mut glyph, source_id.clone(), layer);
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
        let mut first_layer = GlyphLayer::new(LayerId::new());
        first_layer.add_contour(first_contour);
        let mut first_glyph = Glyph::new("A");
        set_test_layer(&mut first_glyph, source_id.clone(), first_layer);
        font.insert_glyph(first_glyph).unwrap();

        let mut second_contour = Contour::with_id(contour_id.clone());
        second_contour.add_point(100.0, 100.0, PointType::OnCurve, false);
        let mut second_layer = GlyphLayer::new(LayerId::new());
        second_layer.add_contour(second_contour);
        let mut second_glyph = Glyph::new("B");
        set_test_layer(&mut second_glyph, source_id.clone(), second_layer);

        assert!(matches!(
            font.insert_glyph(second_glyph),
            Err(CoreError::DuplicateContourId(id)) if id == contour_id
        ));
        assert_eq!(font.glyph_count(), 1);
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
        let mut input = Location::new();
        input.set(axis.id(), axis.default());
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
        let mut input = Location::new();
        for axis in axes {
            input.set(axis.id(), axis.default());
        }
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
        let mut input = Location::new();
        input.set(axis_id.clone(), 900.0);
        let mut output = Location::new();
        output.set(axis_id.clone(), 800.0);
        font.set_axis_mappings(vec![AxisMapping::new(
            "Weight curve".to_string(),
            vec![axis_id.clone()],
            vec![axis_id.clone()],
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

        let mut narrow = ExternalLocation::new();
        narrow.set(weight_id.clone(), 400.0);
        narrow.set(width_id.clone(), 75.0);
        let mut wide = ExternalLocation::new();
        wide.set(weight_id, 400.0);
        wide.set(width_id.clone(), 125.0);
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
        let source_id = font.default_source_id().unwrap();
        let mut glyph = Glyph::with_unicode("A".to_string(), 65);
        let layer = GlyphLayer::with_width(LayerId::new(), 600.0);
        let layer_id = layer.id();
        set_test_layer(&mut glyph, source_id, layer);

        let glyph_id = font.insert_glyph(glyph).unwrap();

        assert_eq!(font.glyph_count(), 1);
        assert!(font.glyph(glyph_id.clone()).is_some());
        assert_eq!(font.glyph_id_by_name("A"), Some(glyph_id.clone()));
        assert!(font.glyph_by_name("A").is_some());
        assert_eq!(
            font.glyph_id_by_layer(layer_id.clone()),
            Some(glyph_id.clone())
        );
        assert_eq!(
            font.layer_id_for_source(glyph_id.clone(), font.default_source_id().unwrap()),
            Some(layer_id.clone())
        );
        assert_eq!(
            font.glyphs_by_unicode(65)
                .map(Glyph::id)
                .collect::<Vec<_>>(),
            vec![glyph_id.clone()]
        );
    }

    #[test]
    fn glyph_layer_batch_replacement_is_atomic() {
        let mut font = Font::new();
        let source_id = font.default_source_id().unwrap();
        let first_layer = GlyphLayer::with_width(LayerId::new(), 500.0);
        let first_layer_id = first_layer.id();
        let mut first_glyph = Glyph::new("A");
        set_test_layer(&mut first_glyph, source_id.clone(), first_layer);
        font.insert_glyph(first_glyph).unwrap();

        let second_layer = GlyphLayer::with_width(LayerId::new(), 600.0);
        let second_layer_id = second_layer.id();
        let mut second_glyph = Glyph::new("B");
        set_test_layer(&mut second_glyph, source_id.clone(), second_layer);
        font.insert_glyph(second_glyph).unwrap();

        let contour_id = ContourId::new();
        let mut first_contour = Contour::with_id(contour_id.clone());
        first_contour.add_point(0.0, 0.0, PointType::OnCurve, false);
        let mut first_replacement = GlyphLayer::with_width(first_layer_id.clone(), 700.0);
        first_replacement.add_contour(first_contour);

        let mut second_contour = Contour::with_id(contour_id.clone());
        second_contour.add_point(10.0, 10.0, PointType::OnCurve, false);
        let mut second_replacement = GlyphLayer::with_width(second_layer_id.clone(), 800.0);
        second_replacement.add_contour(second_contour);

        assert!(matches!(
            font.replace_glyph_layers(vec![first_replacement, second_replacement]),
            Err(CoreError::DuplicateContourId(id)) if id == contour_id
        ));
        assert_eq!(font.layer(first_layer_id.clone()).unwrap().width(), 500.0);
        assert_eq!(font.layer(second_layer_id.clone()).unwrap().width(), 600.0);

        font.replace_glyph_layers(vec![
            GlyphLayer::with_width(first_layer_id.clone(), 700.0),
            GlyphLayer::with_width(second_layer_id.clone(), 800.0),
        ])
        .unwrap();
        assert_eq!(font.layer(first_layer_id).unwrap().width(), 700.0);
        assert_eq!(font.layer(second_layer_id).unwrap().width(), 800.0);
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
        let mut layer = GlyphLayer::with_width(LayerId::new(), 500.0);
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
        set_test_layer(&mut glyph, source_id.clone(), layer);
        font.insert_glyph(glyph).unwrap();

        let snapshot = font.clone();
        let mut expected = font.layer(layer_id.clone()).unwrap().clone();
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

        font.replace_glyph_layer_values(layer_id.clone(), &values)
            .unwrap();

        assert_eq!(font.layer(layer_id.clone()).unwrap(), &expected);
        assert_ne!(snapshot.layer(layer_id.clone()).unwrap(), &expected);
        assert!(font.has_contour_id(&contour_id));
        assert!(font.has_point_id(&point_id));
        assert!(font.has_anchor_id(&anchor_id));
        assert!(font
            .index()
            .entity_ids
            .contains(&GlyphEntityId::from(component_id)));

        let committed = font.layer(layer_id.clone()).unwrap().clone();
        let mut invalid = values.into_vec();
        invalid[0] = f64::NAN;
        assert!(matches!(
            font.replace_glyph_layer_values(
                layer_id.clone(),
                &GlyphInterpolationValues::new(invalid)
            ),
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
        let mut first_layer = GlyphLayer::with_width(LayerId::new(), 500.0);
        first_layer.add_contour(contour);
        first_layer.add_component(Component::with_id(
            component_id.clone(),
            base_glyph_id.clone(),
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
        set_test_layer(&mut first_glyph, source_id.clone(), first_layer);
        font.insert_glyph(first_glyph).unwrap();

        let second_layer = GlyphLayer::with_width(LayerId::new(), 600.0);
        let second_layer_id = second_layer.id();
        let mut second_glyph = Glyph::new("B");
        set_test_layer(&mut second_glyph, source_id.clone(), second_layer);
        font.insert_glyph(second_glyph).unwrap();

        let snapshot = font.clone();
        let mut replacement = font.layer(first_layer_id.clone()).unwrap().clone();
        replacement.set_width(700.0);
        font.replace_glyph_layers(vec![replacement]).unwrap();

        assert_eq!(font.layer(first_layer_id.clone()).unwrap().width(), 700.0);
        assert_eq!(
            snapshot.layer(first_layer_id.clone()).unwrap().width(),
            500.0
        );
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
        let mut conflicting_layer = GlyphLayer::with_width(second_layer_id.clone(), 800.0);
        conflicting_layer.add_contour(conflicting_contour);
        assert!(matches!(
            font.replace_glyph_layers(vec![conflicting_layer]),
            Err(CoreError::DuplicatePointId(id)) if id == point_id
        ));

        let mut conflicting_layer = GlyphLayer::with_width(second_layer_id.clone(), 800.0);
        conflicting_layer.add_component(Component::with_id(
            component_id.clone(),
            base_glyph_id.clone(),
            "base",
            crate::DecomposedTransform::default(),
        ));
        assert!(matches!(
            font.replace_glyph_layers(vec![conflicting_layer]),
            Err(CoreError::DuplicateComponentId(id)) if id == component_id
        ));

        let mut conflicting_layer = GlyphLayer::with_width(second_layer_id.clone(), 800.0);
        conflicting_layer.add_anchor(Anchor::with_id(anchor_id.clone(), None, 10.0, 10.0));
        assert!(matches!(
            font.replace_glyph_layers(vec![conflicting_layer]),
            Err(CoreError::DuplicateAnchorId(id)) if id == anchor_id
        ));

        let mut conflicting_layer = GlyphLayer::with_width(second_layer_id.clone(), 800.0);
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
        assert_eq!(font.layer(second_layer_id.clone()).unwrap().width(), 600.0);

        let emptied = GlyphLayer::with_width(first_layer_id, 700.0);
        let mut transferred_contour = Contour::with_id(contour_id.clone());
        transferred_contour.add_point_with_id(
            point_id.clone(),
            20.0,
            20.0,
            PointType::OnCurve,
            false,
        );
        let mut transferred = GlyphLayer::with_width(second_layer_id.clone(), 800.0);
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
    fn font_remove_insert_glyph() {
        let mut font = Font::new();
        let glyph = Glyph::with_unicode("A".to_string(), 65);
        let glyph_id = font.insert_glyph(glyph).unwrap();

        let taken = font.remove_glyph(glyph_id.clone());
        assert!(taken.is_ok());
        assert_eq!(font.glyph_count(), 0);
        assert_eq!(font.glyph_id_by_name("A"), None);

        font.insert_glyph(taken.unwrap()).unwrap();
        assert_eq!(font.glyph_count(), 1);
        assert_eq!(font.glyph_id_by_name("A"), Some(glyph_id.clone()));
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

        font.rename_glyph(glyph_id.clone(), GlyphName::from("A.alt"))
            .unwrap();

        assert_eq!(font.glyph_id_by_name("A"), None);
        assert_eq!(font.glyph_id_by_name("A.alt"), Some(glyph_id.clone()));
        assert_eq!(font.glyph(glyph_id.clone()).unwrap().name(), "A.alt");
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
    fn deserialization_rebuilds_private_indexes() {
        let mut font = Font::new();
        let source_id = font.default_source_id().unwrap();
        let mut glyph = Glyph::with_unicode("A", 0x41);
        let layer = GlyphLayer::new(LayerId::new());
        let layer_id = layer.id();
        set_test_layer(&mut glyph, source_id.clone(), layer);
        let glyph_id = font.insert_glyph(glyph).unwrap();

        let json = serde_json::to_string(&font).unwrap();
        let decoded: Font = serde_json::from_str(&json).unwrap();

        assert_eq!(decoded.glyph_id_by_name("A"), Some(glyph_id.clone()));
        assert_eq!(
            decoded.glyph_id_by_layer(layer_id.clone()),
            Some(glyph_id.clone())
        );
        assert_eq!(
            decoded.layer_id_for_source(glyph_id.clone(), source_id.clone()),
            Some(layer_id.clone())
        );
        assert_eq!(
            decoded
                .glyphs_by_unicode(0x41)
                .map(Glyph::id)
                .collect::<Vec<_>>(),
            vec![glyph_id.clone()]
        );
    }

    #[test]
    fn font_equality_detects_field_divergence() {
        let original = sample_font();
        let mut changed = original.clone();

        let point = changed
            .layer_mut(LayerId::from_raw("A_regular"))
            .unwrap()
            .contour_mut(ContourId::from_raw("A_outer"))
            .unwrap()
            .get_point_mut(PointId::from_raw("A_1"))
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

        font.create_glyph_layer(layer_id.clone(), glyph_id.clone(), source_id.clone())
            .unwrap();
        let error = font
            .create_glyph_layer(LayerId::new(), glyph_id.clone(), source_id.clone())
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
    fn layer_indexes_update_after_unreferenced_layer_removal() {
        let mut font = Font::new();
        let glyph_id = font.insert_glyph(Glyph::new("A")).unwrap();
        let layer_id = LayerId::new();
        font.insert_glyph_layer(glyph_id.clone(), GlyphLayer::new(layer_id.clone()))
            .unwrap();

        assert_eq!(
            font.glyph_id_by_layer(layer_id.clone()),
            Some(glyph_id.clone())
        );

        font.remove_glyph_layer(layer_id.clone()).unwrap();

        assert_eq!(font.glyph_id_by_layer(layer_id), None);
    }

    #[test]
    fn index_validation_rejects_duplicate_glyph_source_ids() {
        let glyph_source_id = GlyphSourceId::new();
        let source_id = SourceId::new();
        let mut glyphs = EntityList::new();
        for name in ["A", "B"] {
            let mut glyph = Glyph::new(name);
            let layer = GlyphLayer::new(LayerId::new());
            let layer_id = layer.id();
            glyph.set_layer(layer);
            glyph.insert_default_source(GlyphSource::with_id(
                glyph_source_id.clone(),
                name.to_string(),
                layer_id,
                Some(source_id.clone()),
                Location::new(),
            ));
            glyphs.insert(Arc::new(glyph));
        }

        let error = FontIndex::from_font(&[], &glyphs).unwrap_err();

        assert!(matches!(
            error,
            CoreError::DuplicateGlyphSourceId(id) if id == glyph_source_id
        ));
    }

    #[test]
    fn conditions_reject_glyph_local_axis_references() {
        let mut font = Font::new();
        let source_id = font.default_source_id().unwrap();
        let local_axis_id = AxisId::from_raw("local");
        let layer = GlyphLayer::new(LayerId::new());
        let mut glyph = Glyph::new("A");
        glyph.insert_axis(GlyphAxis::with_id(
            local_axis_id.clone(),
            "Local".to_string(),
            0.0,
            0.0,
            1.0,
        ));
        glyph.set_layer(layer.clone());
        glyph.insert_default_source(GlyphSource::new(
            "Default".to_string(),
            layer.id(),
            Some(source_id.clone()),
            Location::new(),
        ));
        let mut variant = GlyphVariant::new(
            "Invalid".to_string(),
            Condition::AxisRange {
                axis_id: local_axis_id,
                minimum: Some(0.5),
                maximum: None,
            },
        );
        variant.insert_source(GlyphSource::new(
            "Variant".to_string(),
            layer.id(),
            Some(source_id),
            Location::new(),
        ));
        glyph.insert_variant(variant);
        font.insert_glyph(glyph).unwrap();

        assert!(matches!(
            font.validate(),
            Err(CoreError::InvalidAuthoringEntity {
                kind: "condition",
                ..
            })
        ));
    }

    #[test]
    fn deletion_rejects_live_glyph_source_and_component_references() {
        let mut font = Font::new();
        let source_id = font.default_source_id().unwrap();
        let base_id = font.insert_glyph(Glyph::new("base")).unwrap();
        let mut parent = Glyph::new("parent");
        let mut layer = GlyphLayer::new(LayerId::new());
        layer.add_component(Component::new(base_id.clone(), "base"));
        parent.set_layer(layer);
        font.insert_glyph(parent).unwrap();

        assert!(matches!(
            font.remove_glyph(base_id),
            Err(CoreError::InvalidAuthoringEntity { kind: "glyph", .. })
        ));

        let glyph_id = font.insert_glyph(Glyph::new("sourced")).unwrap();
        font.create_glyph_layer(LayerId::new(), glyph_id, source_id.clone())
            .unwrap();
        assert!(matches!(
            font.remove_source(source_id.clone()),
            Err(CoreError::SourceReferencedByGlyphSource {
                source_id: actual,
                ..
            }) if actual == source_id
        ));
    }

    #[test]
    fn validation_rejects_component_cycles() {
        let first_id = GlyphId::from_raw("first");
        let second_id = GlyphId::from_raw("second");
        let mut first = Glyph::with_id(first_id.clone(), "first");
        let mut first_layer = GlyphLayer::new(LayerId::new());
        first_layer.add_component(Component::new(second_id.clone(), "second"));
        first.set_layer(first_layer);
        let mut second = Glyph::with_id(second_id.clone(), "second");
        let mut second_layer = GlyphLayer::new(LayerId::new());
        second_layer.add_component(Component::new(first_id, "first"));
        second.set_layer(second_layer);
        let mut font = Font::new();
        font.insert_glyph(first).unwrap();
        font.insert_glyph(second).unwrap();

        assert!(matches!(
            font.validate(),
            Err(CoreError::InvalidAuthoringEntity {
                kind: "component graph",
                ..
            })
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

        font.set_glyph_unicodes(a.clone(), vec![0x41, 0x00C1])
            .unwrap();

        assert_eq!(font.glyph(a.clone()).unwrap().unicodes(), &[0x41, 0x00C1]);
        assert_eq!(snapshot.glyph(a.clone()).unwrap().unicodes(), &[0x41]);
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
            assert!(
                elapsed < Duration::from_secs(1),
                "COW snapshot creation should stay comfortably sub-second for {}; got {elapsed:?}",
                mark.label
            );
        }
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
            .layer_id_for_source(glyph_id.clone(), default_source_id.clone())
            .unwrap();
        let other_glyph_id = font.glyph_id_by_name("g00001").unwrap();
        let start = Instant::now();

        font.layer_mut(layer_id.clone())
            .expect("target glyph should exist")
            .set_width(777.0);

        let elapsed = start.elapsed();

        assert_eq!(
            font.layer(layer_id.clone())
                .expect("target source layer should exist")
                .width(),
            777.0
        );
        assert_ne!(
            snapshot
                .layer(layer_id.clone())
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
        assert!(
            elapsed < Duration::from_secs(1),
            "single-glyph COW mutation should stay comfortably sub-second; got {elapsed:?}"
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

        font.rename_glyph(glyph_id.clone(), GlyphName::from("g00000.alt"))
            .unwrap();

        let elapsed = start.elapsed();

        assert_eq!(font.glyph_id_by_name("g00000"), None);
        assert_eq!(font.glyph_id_by_name("g00000.alt"), Some(glyph_id.clone()));
        print_perf_mark("rename glyph and rebuild indexes", mark, elapsed);
        assert!(
            elapsed < Duration::from_secs(1),
            "glyph rename index rebuild should stay comfortably sub-second; got {elapsed:?}"
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

        font.set_glyph_unicodes(glyph_id.clone(), vec![0x41, unicode])
            .unwrap();

        let elapsed = start.elapsed();

        assert_eq!(
            font.glyphs_by_unicode(unicode)
                .map(Glyph::id)
                .collect::<Vec<_>>(),
            vec![glyph_id.clone()]
        );
        print_perf_mark("set glyph unicodes and rebuild indexes", mark, elapsed);
        assert!(
            elapsed < Duration::from_secs(1),
            "glyph Unicode index rebuild should stay comfortably sub-second; got {elapsed:?}"
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
        let start = Instant::now();

        let layer_id = LayerId::new();
        font.insert_glyph_layer(glyph_id, GlyphLayer::new(layer_id.clone()))
            .unwrap();
        let removed = font.remove_glyph_layer(layer_id.clone()).unwrap();

        let elapsed = start.elapsed();

        assert_eq!(removed.id(), layer_id);
        assert_eq!(font.glyph_id_by_layer(layer_id.clone()), None);
        print_perf_mark("create/remove layer and rebuild indexes", mark, elapsed);
        assert!(
            elapsed < Duration::from_secs(1),
            "glyph layer membership index rebuild should stay comfortably sub-second; got {elapsed:?}"
        );
    }
}
