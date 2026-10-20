//! Renderer-facing intent vocabulary.
//!
//! Intents are what a caller ASKS for; [`FontChange`] records are what the
//! workspace persists. The vocabularies are deliberately distinct: intents
//! carry caller-minted ids and insertion anchors, while changesets retain
//! expected originals and replacements for atomic persistence and inversion.

use crate::Require;
use crate::anchor_attachment::realign_attached_components;
use crate::changes::{FontChange, FontChangeSet, Replacement, SourceCollection};
use crate::composite::anchor_aligned_offset;
use crate::error::{CoreError, CoreResult};
use crate::interpolation::GlyphInterpolationValues;
use crate::ir::{
    Anchor, AnchorId, Axis, AxisId, AxisMapping, BooleanOp, Component, ComponentAlignment,
    ComponentId, Contour, ContourId, DecomposedTransform, DesignLocation, Font, FontMetadata,
    Glyph, GlyphId, GlyphLayer, GlyphName, LANGUAGES_LIB_KEY, LayerId, LibValue, MetricDefinition,
    MetricId, MetricValue, NamedInstance, NamedInstanceId, PointId, PointType, Source, SourceId,
    Transform,
};
use crate::layer_edit::BulkNodePositionUpdates;
use crate::{KerningGroup, KerningGroupId, KerningPair, KerningPosition, KerningSide};
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::sync::Arc;

mod font_intents;
mod layer_intents;

pub use font_intents::*;
pub use layer_intents::*;

/// A point to create, with stable identity minted by a trusted caller.
#[derive(Clone, Debug)]
pub struct PointSeed {
    pub id: PointId,
    pub x: f64,
    pub y: f64,
    pub point_type: PointType,
    pub smooth: bool,
}

/// One kerning pair value to set or remove at one source.
#[derive(Clone, Debug, PartialEq)]
pub struct KerningValueEdit {
    pub source_id: SourceId,
    pub pair: KerningPair,
    /// The new value in font units; `None` removes the pair at this source.
    pub value: Option<f64>,
}

/// An anchor to create, with stable identity minted by a trusted caller.
#[derive(Clone, Debug)]
pub struct AnchorSeed {
    pub id: AnchorId,
    pub name: Option<String>,
    pub x: f64,
    pub y: f64,
}

/// Declares [`FontIntent`] from the intents of each kind, listed once.
macro_rules! font_intents {
    (layer { $($layer:ident,)* } font { $($font:ident,)* }) => {
        /// An edit a caller asks for. Each variant's struct documents it.
        #[derive(Clone, Debug)]
        pub enum FontIntent {
            $($layer($layer),)*
            $($font($font),)*
        }

        impl FontIntent {
            fn kind(&self) -> IntentKind<'_> {
                match self {
                    $(Self::$layer(intent) => IntentKind::Layer(intent),)*
                    $(Self::$font(intent) => IntentKind::Font(intent),)*
                }
            }
        }

        $(impl From<$layer> for FontIntent {
            fn from(intent: $layer) -> Self {
                Self::$layer(intent)
            }
        }

        impl From<$layer> for FontIntentSet {
            fn from(intent: $layer) -> Self {
                FontIntent::from(intent).into()
            }
        })*
        $(impl From<$font> for FontIntent {
            fn from(intent: $font) -> Self {
                Self::$font(intent)
            }
        }

        impl From<$font> for FontIntentSet {
            fn from(intent: $font) -> Self {
                FontIntent::from(intent).into()
            }
        })*
    };
}

font_intents! {
    layer {
        AddPoints,
        AddContour,
        SetContourClosed,
        MovePoints,
        SetPointSmooth,
        RemovePoints,
        AddAnchors,
        MoveAnchors,
        RemoveAnchors,
        RenameAnchors,
        AddComponent,
        SetComponentTransforms,
        SetComponentAlignment,
        RemoveComponents,
        DecomposeComponents,
        ReverseContour,
        SetContourStart,
        TranslatePoints,
        TransformLayer,
        SetXAdvance,
        ApplyBooleanOp,
        ReplaceGlyphLayerContent,
    }
    font {
        CreateGlyph,
        UpdateGlyph,
        UpdateFontMetadata,
        SetLanguages,
        CreateAxis,
        UpdateAxis,
        DeleteAxis,
        SetAxisMappings,
        SetMetricDefinitions,
        CreateNamedInstance,
        UpdateNamedInstance,
        DeleteNamedInstance,
        DeleteSource,
        CreateSource,
        UpdateSource,
        CreateGlyphLayer,
        CloneGlyphLayer,
        SetKerningValues,
        CreateKerningGroup,
        SetKerningGroupMember,
        RenameKerningGroup,
        DeleteKerningGroup,
        MaterializeGlyphLayer,
    }
}

/// An intent that edits one existing layer.
trait LayerIntent {
    /// The layer the intent edits.
    fn layer_id(&self) -> &LayerId;

    /// Whether applying it changes layer structure, not only values. Smooth
    /// flags live in structure, so they count.
    fn structural(&self) -> bool {
        true
    }

    /// Whether it can change the layer's anchors, so components attached to
    /// them elsewhere may follow.
    fn may_move_anchors(&self) -> bool {
        false
    }

    fn apply(&self, font: &mut Font) -> CoreResult<()>;
}

/// An intent that acts on the font rather than on one existing layer.
trait FontLevelIntent {
    /// Authored layers to load before applying it.
    fn required_layer_ids(&self, _font: &Font) -> Vec<LayerId> {
        Vec::new()
    }

    /// Whether it creates, renames, deletes, or fills kerning groups.
    fn edits_kerning_groups(&self) -> bool {
        false
    }

    /// Applies it, returning the layers it touched and the glyph it created
    /// or changed.
    fn apply(&self, font: &mut Font) -> CoreResult<(Vec<LayerId>, Option<GlyphId>)>;
}

enum IntentKind<'a> {
    Layer(&'a dyn LayerIntent),
    Font(&'a dyn FontLevelIntent),
}

impl FontIntent {
    /// The targeted layer for editing intents; `None` for create intents,
    /// whose layers do not exist until the intent applies.
    pub fn layer_id(&self) -> Option<&LayerId> {
        match self.kind() {
            IntentKind::Layer(intent) => Some(intent.layer_id()),
            IntentKind::Font(_) => None,
        }
    }

    /// Complete authored-layer read set required before applying this intent.
    ///
    /// The workspace still guards the persistence boundary if a dependency is
    /// ever omitted here.
    pub fn required_layer_ids(&self, font: &Font) -> Vec<LayerId> {
        match self.kind() {
            IntentKind::Layer(intent) => vec![intent.layer_id().clone()],
            IntentKind::Font(intent) => intent.required_layer_ids(font),
        }
    }

    /// Whether this intent can change a layer's anchors, so components
    /// attached to them elsewhere may follow.
    pub fn may_move_anchors(&self) -> bool {
        match self.kind() {
            IntentKind::Layer(intent) => intent.may_move_anchors(),
            IntentKind::Font(_) => false,
        }
    }

    /// Whether this intent creates, renames, deletes, or fills kerning groups.
    fn edits_kerning_groups(&self) -> bool {
        match self.kind() {
            IntentKind::Layer(_) => false,
            IntentKind::Font(intent) => intent.edits_kerning_groups(),
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct FontIntentSet {
    pub intents: Vec<FontIntent>,
}

/// A set of one intent, applied as one edit.
impl From<FontIntent> for FontIntentSet {
    fn from(intent: FontIntent) -> Self {
        Self {
            intents: vec![intent],
        }
    }
}

impl FromIterator<FontIntent> for FontIntentSet {
    fn from_iter<I: IntoIterator<Item = FontIntent>>(intents: I) -> Self {
        Self {
            intents: intents.into_iter().collect(),
        }
    }
}

impl FontIntentSet {
    /// Layers whose anchors this set may change; components attached to them
    /// in other glyphs follow.
    pub fn layers_with_anchor_edits(&self) -> Vec<LayerId> {
        self.intents
            .iter()
            .filter(|intent| intent.may_move_anchors())
            .filter_map(FontIntent::layer_id)
            .cloned()
            .collect()
    }
}

/// Layers an intent set touched, in first-touch order, with whether any
/// touch changed structure.
#[derive(Default)]
struct TouchedLayers(Vec<(LayerId, bool)>);

impl TouchedLayers {
    fn touch(&mut self, layer_id: LayerId, structural: bool) {
        match self.0.iter_mut().find(|(id, _)| *id == layer_id) {
            Some((_, flag)) => *flag |= structural,
            None => self.0.push((layer_id, structural)),
        }
    }

    fn ids(&self) -> impl Iterator<Item = &LayerId> {
        self.0.iter().map(|(layer_id, _)| layer_id)
    }
}

/// One touched layer after an intent set applied.
pub struct TouchedLayer {
    pub layer: Arc<GlyphLayer>,
    pub structural: bool,
}

impl TouchedLayer {
    /// A touched layer sharing `layer`'s allocation.
    pub fn new(layer: &Arc<GlyphLayer>, structural: bool) -> Self {
        Self {
            layer: Arc::clone(layer),
            structural,
        }
    }
}

/// Outcome of applying an intent set: one reversible changeset plus
/// replace-grade layer state for echo assembly.
pub struct AppliedIntents {
    pub changes: FontChangeSet,
    /// Unique touched layers in first-touch order; `structural` is OR-ed
    /// across the set.
    pub layers: Vec<TouchedLayer>,
}

impl Font {
    fn default_layer_width(&self) -> f64 {
        self.metrics().units_per_em * 0.5
    }

    fn component_reference_would_cycle(&self, glyph_id: &GlyphId, base_glyph_id: &GlyphId) -> bool {
        let mut pending = vec![base_glyph_id.clone()];
        let mut visited = HashSet::new();

        while let Some(candidate_id) = pending.pop() {
            if candidate_id == *glyph_id {
                return true;
            }
            if !visited.insert(candidate_id.clone()) {
                continue;
            }

            let Some(candidate) = self.glyph(&candidate_id) else {
                continue;
            };
            pending.extend(candidate.component_glyph_ids());
        }

        false
    }

    /// Validates and applies an intent set, producing one reversible changeset.
    ///
    /// Mutations are staged on a copy. Repeated writes to the same scope are
    /// coalesced into the first original value and final replacement value.
    ///
    /// # Errors
    ///
    /// Returns the first intent's error, such as a missing entity or an invalid value; the font is
    /// unchanged when any intent fails.
    pub fn apply_intents(&mut self, set: &FontIntentSet) -> CoreResult<AppliedIntents> {
        let before = self.clone();
        let mut after = self.clone();
        let mut touched = TouchedLayers::default();
        let mut glyph_ids = Vec::new();

        for intent in &set.intents {
            match intent.kind() {
                IntentKind::Layer(intent) => {
                    intent.apply(&mut after)?;
                    touched.touch(intent.layer_id().clone(), intent.structural());
                }
                IntentKind::Font(intent) => {
                    let (layer_ids, glyph_id) = intent.apply(&mut after)?;
                    for layer_id in layer_ids {
                        touched.touch(layer_id, true);
                    }
                    if let Some(glyph_id) = glyph_id
                        && !glyph_ids.contains(&glyph_id)
                    {
                        glyph_ids.push(glyph_id);
                    }
                }
            }
        }

        // Components sitting on anchors this set moved follow them, in the same undo step.
        for (layer_id, structural) in
            realign_attached_components(&before, &mut after, touched.ids())
        {
            touched.touch(layer_id, structural);
        }

        let mut changes = font_record_changes(&before, &after);
        changes.extend(kerning_changes(set, &before, &after));
        changes.extend(glyph_changes(&glyph_ids, &before, &after));
        let (layer_changes, layers) = layer_changes(touched, &glyph_ids, &before, &after)?;
        changes.extend(layer_changes);

        *self = after;
        Ok(AppliedIntents {
            changes: FontChangeSet::new(changes),
            layers,
        })
    }

    fn apply_create_glyph(
        &mut self,
        glyph_id: Option<GlyphId>,
        name: &str,
        unicodes: Vec<u32>,
    ) -> CoreResult<GlyphId> {
        let name = name.trim();
        let glyph_name =
            GlyphName::new(name).map_err(|_| CoreError::InvalidGlyphName(name.to_string()))?;
        if self.glyph_id_by_name(name).is_some() {
            return Err(CoreError::DuplicateGlyphName(glyph_name));
        }

        let glyph_id = glyph_id.unwrap_or_default();
        let mut glyph = Glyph::with_id(glyph_id.clone(), glyph_name);
        glyph.set_unicodes(unicodes);

        self.insert_glyph(glyph)?;
        Ok(glyph_id)
    }

    fn apply_set_kerning_group_member(
        &mut self,
        position: KerningPosition,
        glyph_id: &GlyphId,
        group_id: Option<&KerningGroupId>,
    ) -> CoreResult<()> {
        self.require_glyph(glyph_id)?;
        let Some(group_id) = group_id else {
            let Some(current_id) = self.kerning().group_of(position, glyph_id).cloned() else {
                return Ok(());
            };
            let mut group = self
                .kerning()
                .group(&current_id)
                .require(&current_id)?
                .clone();
            group.members.retain(|member| member != glyph_id);
            self.kerning_mut().set_group(current_id, group)?;
            return Ok(());
        };

        let mut group = self.kerning().group(group_id).require(group_id)?.clone();
        if group.position != position {
            return Err(CoreError::KerningGroupPosition {
                group_id: group_id.clone(),
                position,
            });
        }
        if !group.members.contains(glyph_id) {
            group.members.push(glyph_id.clone());
        }
        self.kerning_mut().set_group(group_id.clone(), group)?;
        Ok(())
    }

    fn apply_set_kerning_values(&mut self, edits: &[KerningValueEdit]) -> CoreResult<()> {
        for edit in edits {
            self.require_source(&edit.source_id)?;
            self.require_kerning_side(KerningPosition::First, &edit.pair.first)?;
            self.require_kerning_side(KerningPosition::Second, &edit.pair.second)?;
            match edit.value {
                Some(value) if !value.is_finite() => {
                    return Err(CoreError::InvalidKerningValue(value));
                }
                Some(value) => {
                    self.kerning_mut()
                        .set_value(edit.source_id.clone(), edit.pair.clone(), value);
                }
                None => {
                    self.kerning_mut().remove_value(&edit.source_id, &edit.pair);
                }
            }
        }
        Ok(())
    }

    fn require_kerning_side(
        &self,
        position: KerningPosition,
        side: &KerningSide,
    ) -> CoreResult<()> {
        match side {
            KerningSide::Glyph(glyph_id) => self.require_glyph(glyph_id).map(|_| ()),
            KerningSide::Group(group_id) => {
                let group = self.kerning().group(group_id).require(group_id)?;
                if group.position == position {
                    Ok(())
                } else {
                    Err(CoreError::KerningGroupPosition {
                        group_id: group_id.clone(),
                        position,
                    })
                }
            }
        }
    }

    fn apply_set_languages(&mut self, language_ids: &[String]) {
        let mut seen = HashSet::new();
        let values = language_ids
            .iter()
            .map(|id| id.trim())
            .filter(|id| !id.is_empty() && seen.insert(*id))
            .map(|id| LibValue::String(id.to_string()))
            .collect();
        let value = LibValue::Array(values);
        self.lib_mut().set(LANGUAGES_LIB_KEY.to_string(), value);
    }

    fn apply_create_axis(&mut self, axis: &Axis) -> CoreResult<()> {
        self.add_axis(axis.clone())
    }

    fn apply_update_axis(&mut self, axis: &Axis) -> CoreResult<()> {
        if self
            .axes()
            .iter()
            .any(|existing| existing.id() != axis.id() && existing.tag() == axis.tag())
        {
            return Err(CoreError::DuplicateAxisTag(axis.tag().to_string()));
        }

        self.replace_axis(axis.clone())?;
        Ok(())
    }

    fn apply_delete_axis(&mut self, axis_id: &AxisId) -> CoreResult<()> {
        self.remove_axis(axis_id)?;
        Ok(())
    }

    fn apply_delete_source(&mut self, source_id: &SourceId) -> CoreResult<Vec<LayerId>> {
        if self.sources().len() <= 1 {
            return Err(CoreError::CannotDeleteLastSource);
        }
        if self.default_source_id().as_ref() == Some(source_id) {
            return Err(CoreError::CannotDeleteDefaultSource(source_id.clone()));
        }

        let layer_ids = self
            .glyphs()
            .filter_map(|glyph| glyph.layer_for_source(source_id).map(GlyphLayer::id))
            .collect::<Vec<_>>();

        for layer_id in &layer_ids {
            self.remove_glyph_layer(layer_id)?;
        }

        self.remove_source(source_id.clone()).require(&source_id)?;
        Ok(layer_ids)
    }

    fn apply_create_source(
        &mut self,
        source_id: SourceId,
        name: &str,
        location: &DesignLocation,
    ) -> CoreResult<()> {
        let name = name.trim();
        if name.is_empty() {
            return Err(CoreError::InvalidSourceName(name.to_string()));
        }
        if self.sources().iter().any(|source| source.name() == name) {
            return Err(CoreError::DuplicateSourceName(name.to_string()));
        }
        if self.source(&source_id).is_some() {
            return Err(CoreError::DuplicateSourceId(source_id));
        }
        if let Some(existing) = self.sources().iter().find(|source| {
            source.is_master() && source.location().is_equivalent_to(location, self.axes())
        }) {
            return Err(CoreError::DuplicateSourceLocation {
                first: existing.id(),
                second: source_id,
            });
        }

        for (axis_id, _) in location {
            if self.axis(axis_id).is_none() {
                return Err(CoreError::AxisNotFound(axis_id.clone()));
            }
        }

        let mut source = Source::with_id(source_id, name.to_string(), location.clone(), None);
        if let Some(default_source) = self.default_source() {
            source.set_metric_values(default_source.metric_values().clone());
            source.set_italic_angle(default_source.italic_angle());
            source.set_line_gap(default_source.line_gap());
            source.set_underline_position(default_source.underline_position());
            source.set_underline_thickness(default_source.underline_thickness());
        }
        source.fill_metric_values(self.metric_definitions(), self.metrics().units_per_em);
        self.add_source(source);

        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn apply_create_glyph_layer(
        &mut self,
        layer_id: LayerId,
        glyph_id: GlyphId,
        source_id: SourceId,
    ) -> CoreResult<Vec<LayerId>> {
        if self.glyph_id_by_layer(&layer_id).is_some() {
            return Err(CoreError::DuplicateLayerId(layer_id));
        }
        if self
            .layer_id_for_glyph_source(glyph_id.clone(), source_id.clone())
            .is_some()
        {
            return Err(CoreError::DuplicateGlyphLayer {
                glyph_id,
                source_id,
            });
        }
        let layer = GlyphLayer::with_width(layer_id.clone(), source_id, self.default_layer_width());

        self.insert_glyph_layer(glyph_id, layer)?;
        Ok(vec![layer_id])
    }

    fn apply_clone_glyph_layer(
        &mut self,
        layer_id: LayerId,
        glyph_id: GlyphId,
        source_id: SourceId,
        from_layer_id: LayerId,
    ) -> CoreResult<Vec<LayerId>> {
        let layer =
            self.cloned_glyph_layer(layer_id.clone(), glyph_id.clone(), source_id, from_layer_id)?;

        self.insert_glyph_layer(glyph_id, layer)?;
        Ok(vec![layer_id])
    }

    fn apply_materialize_glyph_layer(
        &mut self,
        layer_id: LayerId,
        glyph_id: GlyphId,
        source_id: SourceId,
        from_layer_id: LayerId,
        values: &GlyphInterpolationValues,
    ) -> CoreResult<Vec<LayerId>> {
        let mut layer =
            self.cloned_glyph_layer(layer_id.clone(), glyph_id.clone(), source_id, from_layer_id)?;
        layer.apply_interpolation_values(values)?;

        self.insert_glyph_layer(glyph_id, layer)?;
        Ok(vec![layer_id])
    }

    fn cloned_glyph_layer(
        &self,
        layer_id: LayerId,
        glyph_id: GlyphId,
        source_id: SourceId,
        from_layer_id: LayerId,
    ) -> CoreResult<GlyphLayer> {
        if self.glyph_id_by_layer(&layer_id).is_some() {
            return Err(CoreError::DuplicateLayerId(layer_id));
        }
        if self
            .layer_id_for_glyph_source(glyph_id.clone(), source_id.clone())
            .is_some()
        {
            return Err(CoreError::DuplicateGlyphLayer {
                glyph_id,
                source_id,
            });
        }

        let from_glyph_id = self.require_layer_owner(&from_layer_id)?;
        if from_glyph_id != glyph_id {
            return Err(CoreError::LayerGlyphMismatch {
                layer_id: from_layer_id,
                glyph_id,
                actual_glyph_id: from_glyph_id,
            });
        }

        let source_layer = self.require_layer(&from_layer_id)?;
        let layer = source_layer.clone_with_fresh_ids(layer_id, source_id);

        Ok(layer)
    }

    fn apply_update_glyph(
        &mut self,
        glyph_id: &GlyphId,
        new_name: GlyphName,
        new_unicodes: Vec<u32>,
    ) -> CoreResult<()> {
        self.require_glyph(glyph_id)?;

        self.rename_glyph(glyph_id, new_name)?;
        self.set_glyph_unicodes(glyph_id, new_unicodes)?;
        Ok(())
    }

    /// Places a new component so its `_name` anchor meets the matching sibling anchor;
    /// `None` when no anchor pair matches.
    ///
    /// Siblings and the new base glyph are read at `layer_id`'s source. A
    /// sibling whose base glyph has no layer there contributes no anchors.
    fn anchor_aligned_component_transform(
        &self,
        layer_id: &LayerId,
        base_glyph_id: &GlyphId,
    ) -> CoreResult<Option<DecomposedTransform>> {
        let layer = self.require_layer(layer_id)?;
        let source_id = layer.source_id();
        let base_layer_at_source = |glyph_id: GlyphId| {
            self.glyph(&glyph_id)
                .and_then(|glyph| glyph.layer_for_source(&source_id))
        };
        let Some(component_layer) = base_layer_at_source(base_glyph_id.clone()) else {
            return Ok(None);
        };

        let placed: Vec<_> = layer
            .components_iter()
            .filter_map(|component| {
                base_layer_at_source(component.base_glyph_id())
                    .map(|base_layer| (component.matrix(), base_layer))
            })
            .collect();
        Ok(anchor_aligned_offset(&placed, component_layer).map(DecomposedTransform::translation))
    }
}

/// Changes to font-level records: metadata, lib values, axes, mappings,
/// metric definitions, named instances, and sources.
fn font_record_changes(before: &Font, after: &Font) -> Vec<FontChange> {
    let mut changes = Vec::new();
    if before.metadata() != after.metadata() {
        changes.push(FontChange::Metadata(Box::new(Replacement::new(
            before.metadata().clone(),
            after.metadata().clone(),
        ))));
    }

    let lib_keys = before
        .lib()
        .keys()
        .chain(after.lib().keys())
        .cloned()
        .collect::<BTreeSet<_>>();
    for key in lib_keys {
        let original = before.lib().get(&key).cloned();
        let replacement = after.lib().get(&key).cloned();
        if original != replacement {
            changes.push(FontChange::LibValue {
                key,
                value: Replacement::new(original, replacement),
            });
        }
    }

    if before.axes() != after.axes() {
        changes.push(FontChange::Axes(Replacement::new(
            before.axes().to_vec(),
            after.axes().to_vec(),
        )));
    }
    if before.axis_mappings() != after.axis_mappings() {
        changes.push(FontChange::AxisMappings(Replacement::new(
            before.axis_mappings().to_vec(),
            after.axis_mappings().to_vec(),
        )));
    }
    if before.metric_definitions() != after.metric_definitions() {
        changes.push(FontChange::MetricDefinitions(Replacement::new(
            before.metric_definitions().to_vec(),
            after.metric_definitions().to_vec(),
        )));
    }
    if before.named_instances() != after.named_instances() {
        changes.push(FontChange::NamedInstances(Replacement::new(
            before.named_instances().to_vec(),
            after.named_instances().to_vec(),
        )));
    }

    let before_sources = SourceCollection {
        sources: before.sources().to_vec(),
        default_source_id: before.default_source_id(),
    };
    let after_sources = SourceCollection {
        sources: after.sources().to_vec(),
        default_source_id: after.default_source_id(),
    };
    if before_sources != after_sources {
        changes.push(FontChange::Sources(Replacement::new(
            before_sources,
            after_sources,
        )));
    }
    changes
}

/// Kerning values the set edited and groups it created, renamed, filled, or deleted.
fn kerning_changes(set: &FontIntentSet, before: &Font, after: &Font) -> Vec<FontChange> {
    let mut changes = Vec::new();
    let kerning_keys = set
        .intents
        .iter()
        .filter_map(|intent| match intent {
            FontIntent::SetKerningValues(intent) => Some(&intent.edits),
            _ => None,
        })
        .flatten()
        .map(|edit| (edit.source_id.clone(), edit.pair.clone()))
        .collect::<BTreeSet<_>>();
    for (source_id, pair) in kerning_keys {
        let original = before.kerning().value(&source_id, &pair);
        let replacement = after.kerning().value(&source_id, &pair);
        if original != replacement {
            changes.push(FontChange::KerningValue {
                source_id,
                pair,
                value: Replacement::new(original, replacement),
            });
        }
    }

    if set.intents.iter().any(FontIntent::edits_kerning_groups) {
        for (group_id, original, replacement) in before.kerning().changed_groups(after.kerning()) {
            changes.push(FontChange::KerningGroup {
                group_id: group_id.clone(),
                group: Replacement::new(original.cloned(), replacement.cloned()),
            });
        }
    }
    changes
}

/// Whole-glyph replacements for glyphs the set created or changed.
fn glyph_changes(glyph_ids: &[GlyphId], before: &Font, after: &Font) -> Vec<FontChange> {
    let mut changes = Vec::new();
    for glyph_id in glyph_ids {
        let original = before.glyph(glyph_id).cloned();
        let replacement = after.glyph(glyph_id).cloned();
        if original != replacement {
            changes.push(FontChange::Glyph(Box::new(Replacement::new(
                original,
                replacement,
            ))));
        }
    }
    changes
}

/// Layer replacements for touched layers, with the replace-grade layers for
/// the echo. Layers inside a replaced glyph only report their new state.
fn layer_changes(
    touched: TouchedLayers,
    glyph_ids: &[GlyphId],
    before: &Font,
    after: &Font,
) -> CoreResult<(Vec<FontChange>, Vec<TouchedLayer>)> {
    let mut changes = Vec::new();
    let mut layers = Vec::new();
    for (layer_id, structural) in touched.0 {
        let original_owner = before.glyph_id_by_layer(&layer_id);
        let replacement_owner = after.glyph_id_by_layer(&layer_id);
        let glyph_id = match (&original_owner, &replacement_owner) {
            (Some(original), Some(replacement)) if original != replacement => {
                return Err(CoreError::LayerGlyphMismatch {
                    layer_id,
                    glyph_id: original.clone(),
                    actual_glyph_id: replacement.clone(),
                });
            }
            (Some(glyph_id), _) | (_, Some(glyph_id)) => glyph_id.clone(),
            (None, None) => return Err(CoreError::LayerNotFound(layer_id)),
        };

        let original = before
            .glyph(&glyph_id)
            .and_then(|glyph| glyph.layers().get(&layer_id))
            .cloned();
        let replacement = after
            .glyph(&glyph_id)
            .and_then(|glyph| glyph.layers().get(&layer_id))
            .cloned();
        if original == replacement {
            continue;
        }

        if !glyph_ids.contains(&glyph_id) {
            changes.push(FontChange::Layer {
                glyph_id,
                layer: Replacement::new(original, replacement.clone()),
                structural,
            });
        }
        if let Some(layer) = replacement {
            layers.push(TouchedLayer { layer, structural });
        }
    }
    Ok((changes, layers))
}

#[cfg(test)]
mod replacement_tests;

#[cfg(test)]
mod kerning_tests;

/// A kerning group name trimmed of surrounding space.
///
/// # Errors
///
/// Returns [`CoreError::InvalidKerningGroupName`] when the name is blank or
/// holds a control character.
fn kerning_group_name(name: &str) -> CoreResult<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.chars().any(char::is_control) {
        return Err(CoreError::InvalidKerningGroupName(name.to_string()));
    }
    Ok(trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn is_structural(intent: &FontIntent) -> bool {
        match intent.kind() {
            IntentKind::Layer(intent) => intent.structural(),
            IntentKind::Font(_) => true,
        }
    }

    #[test]
    fn layer_intents_report_their_layer_and_what_they_change() {
        let layer_id = LayerId::new();
        let moved = FontIntent::from(MovePoints {
            layer_id: layer_id.clone(),
            point_ids: Vec::new(),
            coords: Vec::new(),
        });
        let removed = FontIntent::from(RemovePoints {
            layer_id: layer_id.clone(),
            point_ids: Vec::new(),
        });
        let renamed = FontIntent::from(RenameAnchors {
            layer_id: layer_id.clone(),
            anchor_ids: Vec::new(),
            names: Vec::new(),
        });

        assert_eq!(moved.layer_id(), Some(&layer_id));
        assert!(!is_structural(&moved));
        assert!(is_structural(&removed));
        assert!(renamed.may_move_anchors());
        assert!(!moved.may_move_anchors());
        assert_eq!(removed.required_layer_ids(&Font::new()), vec![layer_id]);
    }

    #[test]
    fn font_intents_load_the_layers_they_read() {
        let font = Font::new();
        let from_layer_id = LayerId::new();
        let cloned = FontIntent::from(CloneGlyphLayer {
            layer_id: LayerId::new(),
            glyph_id: GlyphId::new(),
            source_id: font.default_source_id().unwrap(),
            from_layer_id: from_layer_id.clone(),
        });
        let renamed = FontIntent::from(RenameKerningGroup {
            group_id: KerningGroupId::new(),
            name: "O".to_string(),
        });

        assert_eq!(cloned.layer_id(), None);
        assert_eq!(cloned.required_layer_ids(&font), vec![from_layer_id]);
        assert!(renamed.edits_kerning_groups());
        assert!(!cloned.edits_kerning_groups());
        assert!(renamed.required_layer_ids(&font).is_empty());
    }

    #[test]
    fn deleting_the_default_source_is_rejected_without_mutation() {
        let mut font = Font::new();
        let default_source_id = font.default_source_id().unwrap();
        let axis = Axis::weight();
        let axis_id = axis.id();
        font.add_axis(axis).unwrap();
        let location = DesignLocation::from([(axis_id, 700.0)]);
        font.add_source(Source::new("Bold".to_string(), location));
        let original = font.clone();

        let Err(error) = font.apply_intents(&FontIntentSet::from(DeleteSource {
            source_id: default_source_id.clone(),
        })) else {
            panic!("default source deletion should be rejected");
        };

        assert!(matches!(
            error,
            CoreError::CannotDeleteDefaultSource(source_id)
                if source_id == default_source_id
        ));
        assert_eq!(font, original);
    }

    #[test]
    fn duplicate_master_locations_include_omitted_axis_defaults() {
        let mut font = Font::new();
        let axis = Axis::weight();
        let axis_id = axis.id();
        font.add_axis(axis).expect("weight axis should be valid");
        let source_id = SourceId::new();
        let location = DesignLocation::from([(axis_id, 400.0)]);

        let result = font.apply_intents(&FontIntentSet::from(CreateSource {
            source_id,
            name: "Book".to_string(),
            location,
        }));

        assert!(matches!(
            result,
            Err(CoreError::DuplicateSourceLocation { .. })
        ));
    }

    #[test]
    fn intent_set_rejects_contour_identity_used_by_another_layer() {
        let mut font = Font::new();
        let default_source_id = font.default_source_id().unwrap();
        let contour_id = ContourId::from_raw("shared");
        let glyph_id = GlyphId::new();
        let mut contour = Contour::with_id(contour_id.clone());
        contour.add_point(0.0, 0.0, PointType::OnCurve, false);
        let mut layer = GlyphLayer::new(LayerId::new(), default_source_id);
        layer.add_contour(contour);
        let mut glyph = Glyph::with_id(glyph_id.clone(), "A");
        glyph.set_layer(layer);
        font.insert_glyph(glyph).unwrap();

        let source_id = font.add_source(Source::new("Other".to_string(), DesignLocation::new()));
        let layer_id = LayerId::new();
        let mut candidate = font.clone();
        let result = candidate.apply_intents(&FontIntentSet {
            intents: vec![
                CreateGlyphLayer {
                    layer_id: layer_id.clone(),
                    glyph_id,
                    source_id,
                }
                .into(),
                AddContour {
                    layer_id,
                    contour_id: contour_id.clone(),
                    closed: true,
                }
                .into(),
            ],
        });

        assert!(matches!(
            result,
            Err(CoreError::DuplicateContourId(id)) if id == contour_id
        ));
        assert_eq!(font.glyphs().next().unwrap().layers().len(), 1);
    }

    #[test]
    fn component_intents_add_and_remove_one_reference() {
        let mut font = Font::new();
        let source_id = font.default_source_id().unwrap();
        let base_id = GlyphId::new();
        let mut base = Glyph::with_id(base_id.clone(), "base");
        base.set_layer(GlyphLayer::new(LayerId::new(), source_id.clone()));
        font.insert_glyph(base).unwrap();

        let root_id = GlyphId::new();
        let root_layer_id = LayerId::new();
        let mut root = Glyph::with_id(root_id, "root");
        root.set_layer(GlyphLayer::new(root_layer_id.clone(), source_id));
        font.insert_glyph(root).unwrap();
        let component_id = ComponentId::new();

        font.apply_intents(&FontIntentSet::from(AddComponent {
            layer_id: root_layer_id.clone(),
            component_id: component_id.clone(),
            base_glyph_id: base_id.clone(),
        }))
        .unwrap();

        let component = font
            .layer(&root_layer_id)
            .unwrap()
            .component(&component_id)
            .unwrap();
        assert_eq!(component.base_glyph_id(), base_id);
        assert_eq!(component.base_glyph_name().as_str(), "base");

        font.apply_intents(&FontIntentSet::from(RemoveComponents {
            layer_id: root_layer_id.clone(),
            component_ids: vec![component_id],
        }))
        .unwrap();

        assert!(font.layer(&root_layer_id).unwrap().components().is_empty());
    }

    #[test]
    fn removing_unknown_components_reports_the_first_one_requested() {
        let mut font = Font::new();
        let source_id = font.default_source_id().unwrap();
        let layer_id = LayerId::new();
        let mut glyph = Glyph::with_id(GlyphId::new(), "a");
        glyph.set_layer(GlyphLayer::new(layer_id.clone(), source_id));
        font.insert_glyph(glyph).unwrap();
        let unknown = (0..8).map(|_| ComponentId::new()).collect::<Vec<_>>();

        let result = font.apply_intents(&FontIntentSet::from(RemoveComponents {
            layer_id,
            component_ids: unknown.clone(),
        }));

        assert!(matches!(
            result,
            Err(CoreError::InvalidComponentId(id)) if id == unknown[0].to_string()
        ));
    }

    #[test]
    fn adding_a_mark_stores_its_anchor_aligned_position() {
        let mut font = Font::new();
        let source_id = font.default_source_id().unwrap();
        let base_id = GlyphId::new();
        let mut base = Glyph::with_id(base_id.clone(), "o");
        let mut base_layer = GlyphLayer::new(LayerId::new(), source_id.clone());
        base_layer.add_anchor(Anchor::new(Some("top".to_string()), 321.0, 485.0));
        base.set_layer(base_layer);
        font.insert_glyph(base).unwrap();

        let mark_id = GlyphId::new();
        let mut mark = Glyph::with_id(mark_id.clone(), "acutecomb");
        let mut mark_layer = GlyphLayer::new(LayerId::new(), source_id.clone());
        mark_layer.add_anchor(Anchor::new(Some("_top".to_string()), 0.0, 485.0));
        mark.set_layer(mark_layer);
        font.insert_glyph(mark).unwrap();

        let root_layer_id = LayerId::new();
        let mut root = Glyph::with_id(GlyphId::new(), "oacute");
        root.set_layer(GlyphLayer::new(root_layer_id.clone(), source_id));
        font.insert_glyph(root).unwrap();
        let mark_component_id = ComponentId::new();

        font.apply_intents(&FontIntentSet {
            intents: vec![
                AddComponent {
                    layer_id: root_layer_id.clone(),
                    component_id: ComponentId::new(),
                    base_glyph_id: base_id,
                }
                .into(),
                AddComponent {
                    layer_id: root_layer_id.clone(),
                    component_id: mark_component_id.clone(),
                    base_glyph_id: mark_id,
                }
                .into(),
            ],
        })
        .unwrap();

        let layer = font.layer(&root_layer_id).unwrap();
        let mark = layer.component(&mark_component_id).unwrap();
        assert_eq!(mark.matrix(), Transform::translate(321.0, 0.0));
    }

    #[test]
    fn adding_a_component_rejects_a_direct_cycle() {
        let mut font = Font::new();
        let source_id = font.default_source_id().unwrap();
        let glyph_id = GlyphId::new();
        let layer_id = LayerId::new();
        let mut glyph = Glyph::with_id(glyph_id.clone(), "self-referencing");
        glyph.set_layer(GlyphLayer::new(layer_id.clone(), source_id));
        font.insert_glyph(glyph).unwrap();

        let result = font.apply_intents(&FontIntentSet::from(AddComponent {
            layer_id,
            component_id: ComponentId::new(),
            base_glyph_id: glyph_id.clone(),
        }));

        assert!(matches!(
            result,
            Err(CoreError::CyclicComponentReference {
                glyph_id: rejected_glyph_id,
                base_glyph_id,
            }) if rejected_glyph_id == glyph_id && base_glyph_id == glyph_id
        ));
    }

    #[test]
    fn adding_a_component_rejects_an_indirect_cycle() {
        let mut font = Font::new();
        let source_id = font.default_source_id().unwrap();
        let parent_id = GlyphId::new();
        let child_id = GlyphId::new();

        let mut parent_layer = GlyphLayer::new(LayerId::new(), source_id.clone());
        parent_layer.add_component(Component::new(child_id.clone(), "child"));
        let mut parent = Glyph::with_id(parent_id.clone(), "parent");
        parent.set_layer(parent_layer);
        font.insert_glyph(parent).unwrap();

        let child_layer_id = LayerId::new();
        let mut child = Glyph::with_id(child_id.clone(), "child");
        child.set_layer(GlyphLayer::new(child_layer_id.clone(), source_id));
        font.insert_glyph(child).unwrap();

        let result = font.apply_intents(&FontIntentSet::from(AddComponent {
            layer_id: child_layer_id,
            component_id: ComponentId::new(),
            base_glyph_id: parent_id.clone(),
        }));

        assert!(matches!(
            result,
            Err(CoreError::CyclicComponentReference {
                glyph_id: rejected_glyph_id,
                base_glyph_id,
            }) if rejected_glyph_id == child_id && base_glyph_id == parent_id
        ));
    }

    #[test]
    fn transform_layer_intent_moves_the_whole_layer_and_rejects_non_finite_values() {
        let mut font = Font::new();
        let source_id = font.default_source_id().unwrap();
        let layer_id = LayerId::new();
        let mut layer = GlyphLayer::new(layer_id.clone(), source_id);
        let anchor_id = layer.add_anchor(Anchor::new(Some("top".to_string()), 10.0, 0.0));
        let mut glyph = Glyph::new("root");
        glyph.set_layer(layer);
        font.insert_glyph(glyph).unwrap();

        font.apply_intents(&FontIntentSet::from(TransformLayer {
            layer_id: layer_id.clone(),
            transform: Transform::translate(25.0, 0.0),
        }))
        .unwrap();
        let anchor = font
            .require_layer(&layer_id)
            .unwrap()
            .anchor(&anchor_id)
            .unwrap();
        assert_eq!(anchor.x(), 35.0);

        let rejected = font.apply_intents(&FontIntentSet::from(TransformLayer {
            layer_id,
            transform: Transform::translate(f64::NAN, 0.0),
        }));
        assert!(matches!(
            rejected,
            Err(CoreError::InvalidPositionUpdateInput {
                kind: "layer transform",
                ..
            })
        ));
    }

    #[test]
    fn component_transform_intent_replaces_authored_values() {
        let mut font = Font::new();
        let source_id = font.default_source_id().unwrap();
        let layer_id = LayerId::new();
        let component_id = ComponentId::new();
        let mut layer = GlyphLayer::new(layer_id.clone(), source_id);
        layer.add_component(Component::with_id(
            component_id.clone(),
            GlyphId::new(),
            "base",
            DecomposedTransform::default(),
        ));
        let mut glyph = Glyph::new("root");
        glyph.set_layer(layer);
        font.insert_glyph(glyph).unwrap();

        font.apply_intents(&FontIntentSet::from(SetComponentTransforms {
            layer_id: layer_id.clone(),
            component_ids: vec![component_id.clone()],
            transforms: vec![12.0, -7.0, 30.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0],
        }))
        .unwrap();

        let transform = font
            .layer(&layer_id)
            .unwrap()
            .component(&component_id)
            .unwrap()
            .transform();
        assert_eq!(transform.translate_x, 12.0);
        assert_eq!(transform.translate_y, -7.0);
        assert_eq!(transform.rotation, 30.0);
        assert_eq!(transform.scale_x, 2.0);
        assert_eq!(transform.scale_y, 3.0);
        assert_eq!(transform.skew_x, 4.0);
        assert_eq!(transform.skew_y, 5.0);
        assert_eq!(transform.t_center_x, 6.0);
        assert_eq!(transform.t_center_y, 7.0);
    }

    #[test]
    fn decomposing_a_component_recursively_flattens_its_transformed_subtree() {
        let mut font = Font::new();
        let source_id = font.default_source_id().unwrap();

        let leaf_id = GlyphId::new();
        let mut leaf_layer = GlyphLayer::new(LayerId::new(), source_id.clone());
        let mut leaf_contour = Contour::new();
        leaf_contour.add_point(10.0, 20.0, PointType::OnCurve, false);
        leaf_layer.add_contour(leaf_contour);
        let mut leaf = Glyph::with_id(leaf_id.clone(), "leaf");
        leaf.set_layer(leaf_layer);
        font.insert_glyph(leaf).unwrap();

        let middle_id = GlyphId::new();
        let mut middle_layer = GlyphLayer::new(LayerId::new(), source_id.clone());
        middle_layer.add_component(Component::with_transform(
            leaf_id,
            "leaf",
            DecomposedTransform {
                translate_y: 5.0,
                ..Default::default()
            },
        ));
        let mut middle = Glyph::with_id(middle_id.clone(), "middle");
        middle.set_layer(middle_layer);
        font.insert_glyph(middle).unwrap();

        let root_layer_id = LayerId::new();
        let root_component_id = ComponentId::new();
        let mut root_layer = GlyphLayer::new(root_layer_id.clone(), source_id);
        root_layer.add_component(Component::with_id(
            root_component_id.clone(),
            middle_id,
            "middle",
            DecomposedTransform {
                translate_x: 30.0,
                ..Default::default()
            },
        ));
        let mut root = Glyph::new("root");
        root.set_layer(root_layer);
        font.insert_glyph(root).unwrap();

        font.apply_intents(&FontIntentSet::from(DecomposeComponents {
            layer_id: root_layer_id.clone(),
            component_ids: vec![root_component_id],
        }))
        .unwrap();

        let layer = font.layer(&root_layer_id).unwrap();
        let point = &layer.contours_iter().next().unwrap().points()[0];
        assert!(layer.components().is_empty());
        assert_eq!((point.x(), point.y()), (40.0, 25.0));
    }

    #[test]
    fn materialize_glyph_layer_applies_values_with_fresh_structure_ids() {
        let mut font = Font::new();
        let default_source_id = font
            .default_source_id()
            .expect("new font should have a default source");
        let axis = Axis::weight();
        let axis_id = axis.id();
        font.add_axis(axis).expect("weight axis should be valid");

        let glyph_id = GlyphId::new();
        let from_layer_id = LayerId::new();
        let mut source_layer =
            GlyphLayer::with_width(from_layer_id.clone(), default_source_id, 500.0);
        let mut contour = Contour::new();
        let source_point_id = contour.add_point(10.0, 20.0, PointType::OnCurve, false);
        source_layer.add_contour(contour);
        let mut glyph = Glyph::with_id(glyph_id.clone(), "A");
        glyph.set_layer(source_layer);
        font.insert_glyph(glyph)
            .expect("test glyph should be valid");

        let source_id = SourceId::new();
        let location = DesignLocation::from([(axis_id, 700.0)]);
        font.apply_intents(&FontIntentSet::from(CreateSource {
            source_id: source_id.clone(),
            name: "Bold".to_string(),
            location,
        }))
        .expect("new source should apply");

        let layer_id = LayerId::new();
        let values = GlyphInterpolationValues::new(vec![600.0, 30.0, 40.0]);
        font.apply_intents(&FontIntentSet::from(MaterializeGlyphLayer {
            layer_id: layer_id.clone(),
            glyph_id,
            source_id,
            from_layer_id,
            values: values.clone(),
        }))
        .expect("materialized layer should apply");

        let layer = font
            .layer(&layer_id)
            .expect("materialized layer should be present");
        assert_eq!(layer.interpolation_values(), values);
        assert_ne!(
            layer
                .contours_iter()
                .next()
                .and_then(|contour| contour.points().first())
                .map(crate::Point::id),
            Some(source_point_id)
        );
    }
}
