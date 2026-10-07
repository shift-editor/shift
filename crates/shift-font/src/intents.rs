//! Renderer-facing intent vocabulary.
//!
//! Intents are what a caller ASKS for; [`FontChange`] records are what the
//! workspace persists. The vocabularies are deliberately distinct: intents
//! carry caller-minted ids and insertion anchors, while changesets retain
//! expected originals and replacements for atomic persistence and inversion.

use crate::changes::{FontChange, FontChangeSet, Replacement, SourceCollection};
use crate::composite::anchor_aligned_offset;
use crate::error::{CoreError, CoreResult};
use crate::interpolation::GlyphInterpolationValues;
use crate::ir::{
    Anchor, AnchorId, Axis, AxisId, AxisMapping, BooleanOp, Component, ComponentId, Contour,
    ContourId, DecomposedTransform, DesignLocation, Font, FontMetadata, Glyph, GlyphId, GlyphLayer,
    GlyphName, LayerId, LibValue, MetricDefinition, MetricId, MetricValue, NamedInstance,
    NamedInstanceId, PointId, PointType, Source, SourceId, Transform, LANGUAGES_LIB_KEY,
};
use crate::layer_edit::BulkNodePositionUpdates;
use crate::source::source_locations_equal;
use crate::Require;
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::sync::Arc;

/// A point to create, with stable identity minted by a trusted caller.
#[derive(Clone, Debug)]
pub struct PointSeed {
    pub id: PointId,
    pub x: f64,
    pub y: f64,
    pub point_type: PointType,
    pub smooth: bool,
}

/// An anchor to create, with stable identity minted by a trusted caller.
#[derive(Clone, Debug)]
pub struct AnchorSeed {
    pub id: AnchorId,
    pub name: Option<String>,
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug)]
pub enum FontIntent {
    AddPoints {
        layer_id: LayerId,
        /// Target contour; when `None`, derived from `before` (Rust owns
        /// identity resolution — the renderer never bookkeeps pending
        /// point→contour maps).
        contour_id: Option<ContourId>,
        /// Insert before this point; append when `None`.
        before: Option<PointId>,
        points: Vec<PointSeed>,
    },
    AddContour {
        layer_id: LayerId,
        contour_id: ContourId,
        closed: bool,
    },
    SetContourClosed {
        layer_id: LayerId,
        contour_id: ContourId,
        closed: bool,
    },
    MovePoints {
        layer_id: LayerId,
        point_ids: Vec<PointId>,
        /// Interleaved absolute coordinates: x0, y0, x1, y1, …
        coords: Vec<f64>,
    },
    SetPointSmooth {
        layer_id: LayerId,
        point_id: PointId,
        smooth: bool,
    },
    RemovePoints {
        layer_id: LayerId,
        point_ids: Vec<PointId>,
    },
    AddAnchors {
        layer_id: LayerId,
        anchors: Vec<AnchorSeed>,
    },
    MoveAnchors {
        layer_id: LayerId,
        anchor_ids: Vec<AnchorId>,
        /// Interleaved absolute coordinates: x0, y0, x1, y1, …
        coords: Vec<f64>,
    },
    RemoveAnchors {
        layer_id: LayerId,
        anchor_ids: Vec<AnchorId>,
    },
    /// Adds one direct reference after rejecting direct or transitive component cycles.
    AddComponent {
        layer_id: LayerId,
        component_id: ComponentId,
        base_glyph_id: GlyphId,
    },
    /// Replaces direct component transforms without changing component identity or order.
    SetComponentTransforms {
        layer_id: LayerId,
        component_ids: Vec<ComponentId>,
        /// Nine decomposed values per component in interpolation order.
        transforms: Vec<f64>,
    },
    RemoveComponents {
        layer_id: LayerId,
        component_ids: Vec<ComponentId>,
    },
    DecomposeComponents {
        layer_id: LayerId,
        component_ids: Vec<ComponentId>,
    },
    ReverseContour {
        layer_id: LayerId,
        contour_id: ContourId,
    },
    /// Rotates a closed contour to an existing on-curve point without changing its geometry.
    SetContourStart {
        layer_id: LayerId,
        contour_id: ContourId,
        point_id: PointId,
    },
    /// Affine move: O(selection-ids) wire instead of O(N) coords.
    TranslatePoints {
        layer_id: LayerId,
        point_ids: Vec<PointId>,
        dx: f64,
        dy: f64,
    },
    /// Affine transform of the whole layer: every contour point, anchor, and
    /// component placement. The advance width is unchanged.
    TransformLayer {
        layer_id: LayerId,
        transform: Transform,
    },
    SetXAdvance {
        layer_id: LayerId,
        width: f64,
    },
    /// Rust-only computation: the echo is the same replace-grade shape as
    /// every other intent — remote changes are not a special case.
    ApplyBooleanOp {
        layer_id: LayerId,
        contour_id_a: ContourId,
        contour_id_b: ContourId,
        operation: BooleanOp,
    },
    /// Replaces drawing content while preserving layer identity, source, height, guidelines, and lib.
    ///
    /// Values use font units and supplied entity identities. The complete replacement
    /// is validated before installation and refreshes component dependencies.
    ReplaceGlyphLayerContent {
        layer_id: LayerId,
        width: f64,
        contours: Vec<Contour>,
        anchors: Vec<Anchor>,
        components: Vec<Component>,
    },
    /// Creates glyph identity and metadata only. Authored editable data is
    /// created by explicit `CreateGlyphLayer` intents.
    CreateGlyph {
        /// Caller-minted id so the verb returns identity synchronously;
        /// `None` mints Rust-side.
        glyph_id: Option<GlyphId>,
        name: String,
        unicodes: Vec<u32>,
    },
    UpdateGlyph {
        /// Stable id of the existing glyph to rename.
        glyph_id: GlyphId,
        new_name: GlyphName,
        new_unicodes: Vec<u32>,
    },
    /// Replaces authored font metadata without changing font metrics.
    UpdateFontMetadata {
        metadata: FontMetadata,
    },
    /// Replaces the tracked language list stored under
    /// [`LANGUAGES_LIB_KEY`].
    ///
    /// Ids are Hyperglot language ids. Blank ids are dropped and duplicates
    /// keep their first position; an empty list is stored as an empty array,
    /// which is distinct from the key being absent.
    SetLanguages {
        language_ids: Vec<String>,
    },
    CreateAxis {
        axis: Axis,
    },
    UpdateAxis {
        axis: Axis,
    },
    DeleteAxis {
        axis_id: AxisId,
    },
    SetAxisMappings {
        mappings: Vec<AxisMapping>,
    },
    SetMetricDefinitions {
        definitions: Vec<MetricDefinition>,
    },
    CreateNamedInstance {
        instance: NamedInstance,
    },
    UpdateNamedInstance {
        instance: NamedInstance,
    },
    DeleteNamedInstance {
        instance_id: NamedInstanceId,
    },
    DeleteSource {
        source_id: SourceId,
    },
    /// Creates a global source record only. Glyph layers are authored by
    /// explicit `CreateGlyphLayer` intents.
    CreateSource {
        source_id: SourceId,
        name: String,
        location: DesignLocation,
    },
    /// Replaces the editable authoring values of an existing master source.
    UpdateSource {
        source_id: SourceId,
        name: String,
        location: DesignLocation,
        metric_values: BTreeMap<MetricId, MetricValue>,
        italic_angle: Option<f64>,
        line_gap: Option<f64>,
        underline_position: Option<f64>,
        underline_thickness: Option<f64>,
    },
    /// Creates one sparse editable glyph layer at one source.
    CreateGlyphLayer {
        layer_id: LayerId,
        glyph_id: GlyphId,
        source_id: SourceId,
    },
    /// Creates one editable glyph layer by copying another layer's shape with fresh internal ids.
    CloneGlyphLayer {
        layer_id: LayerId,
        glyph_id: GlyphId,
        source_id: SourceId,
        from_layer_id: LayerId,
    },
    /// Creates one editable layer from compatible resolved numeric values.
    ///
    /// The source layer supplies authored structure and non-varying data. The
    /// resolved values replace its advance, coordinates, and component
    /// transforms after fresh internal identities are minted.
    MaterializeGlyphLayer {
        layer_id: LayerId,
        glyph_id: GlyphId,
        source_id: SourceId,
        from_layer_id: LayerId,
        values: GlyphInterpolationValues,
    },
}

impl FontIntent {
    /// The targeted layer for editing intents; `None` for create intents,
    /// whose layers do not exist until the intent applies.
    pub fn layer_id(&self) -> Option<&LayerId> {
        match self {
            Self::AddPoints { layer_id, .. }
            | Self::AddContour { layer_id, .. }
            | Self::SetContourClosed { layer_id, .. }
            | Self::MovePoints { layer_id, .. }
            | Self::SetPointSmooth { layer_id, .. }
            | Self::RemovePoints { layer_id, .. }
            | Self::AddAnchors { layer_id, .. }
            | Self::MoveAnchors { layer_id, .. }
            | Self::RemoveAnchors { layer_id, .. }
            | Self::AddComponent { layer_id, .. }
            | Self::SetComponentTransforms { layer_id, .. }
            | Self::RemoveComponents { layer_id, .. }
            | Self::DecomposeComponents { layer_id, .. }
            | Self::ReverseContour { layer_id, .. }
            | Self::SetContourStart { layer_id, .. }
            | Self::TranslatePoints { layer_id, .. }
            | Self::TransformLayer { layer_id, .. }
            | Self::SetXAdvance { layer_id, .. }
            | Self::ApplyBooleanOp { layer_id, .. }
            | Self::ReplaceGlyphLayerContent { layer_id, .. } => Some(layer_id),

            Self::CreateGlyph { .. }
            | Self::UpdateGlyph { .. }
            | Self::UpdateFontMetadata { .. }
            | Self::SetLanguages { .. }
            | Self::CreateAxis { .. }
            | Self::UpdateAxis { .. }
            | Self::DeleteAxis { .. }
            | Self::SetAxisMappings { .. }
            | Self::SetMetricDefinitions { .. }
            | Self::CreateNamedInstance { .. }
            | Self::UpdateNamedInstance { .. }
            | Self::DeleteNamedInstance { .. }
            | Self::DeleteSource { .. }
            | Self::CreateSource { .. }
            | Self::UpdateSource { .. }
            | Self::CreateGlyphLayer { .. }
            | Self::CloneGlyphLayer { .. }
            | Self::MaterializeGlyphLayer { .. } => None,
        }
    }

    /// Complete authored-layer read set required before applying this intent.
    ///
    /// Keeping this exhaustive match beside the intent vocabulary prevents a
    /// new operation from accidentally mutating a directory placeholder. The
    /// workspace still guards the persistence boundary if a dependency is
    /// ever omitted here.
    pub fn required_layer_ids(&self, font: &Font) -> Vec<LayerId> {
        match self {
            Self::AddPoints { layer_id, .. }
            | Self::AddContour { layer_id, .. }
            | Self::SetContourClosed { layer_id, .. }
            | Self::MovePoints { layer_id, .. }
            | Self::SetPointSmooth { layer_id, .. }
            | Self::RemovePoints { layer_id, .. }
            | Self::AddAnchors { layer_id, .. }
            | Self::MoveAnchors { layer_id, .. }
            | Self::RemoveAnchors { layer_id, .. }
            | Self::AddComponent { layer_id, .. }
            | Self::SetComponentTransforms { layer_id, .. }
            | Self::RemoveComponents { layer_id, .. }
            | Self::DecomposeComponents { layer_id, .. }
            | Self::ReverseContour { layer_id, .. }
            | Self::SetContourStart { layer_id, .. }
            | Self::TranslatePoints { layer_id, .. }
            | Self::TransformLayer { layer_id, .. }
            | Self::SetXAdvance { layer_id, .. }
            | Self::ApplyBooleanOp { layer_id, .. }
            | Self::ReplaceGlyphLayerContent { layer_id, .. } => vec![layer_id.clone()],
            Self::CloneGlyphLayer { from_layer_id, .. }
            | Self::MaterializeGlyphLayer { from_layer_id, .. } => {
                vec![from_layer_id.clone()]
            }
            Self::DeleteSource { source_id } => font
                .glyphs()
                .filter_map(|glyph| {
                    glyph
                        .layer_for_source(source_id.clone())
                        .map(GlyphLayer::id)
                })
                .collect(),
            Self::CreateGlyph { .. }
            | Self::UpdateGlyph { .. }
            | Self::UpdateFontMetadata { .. }
            | Self::SetLanguages { .. }
            | Self::CreateAxis { .. }
            | Self::UpdateAxis { .. }
            | Self::DeleteAxis { .. }
            | Self::SetAxisMappings { .. }
            | Self::SetMetricDefinitions { .. }
            | Self::CreateNamedInstance { .. }
            | Self::UpdateNamedInstance { .. }
            | Self::DeleteNamedInstance { .. }
            | Self::CreateSource { .. }
            | Self::UpdateSource { .. }
            | Self::CreateGlyphLayer { .. } => Vec::new(),
        }
    }

    /// Whether applying this intent changes layer structure (vs values only).
    /// Smooth flags live in structure, so they count.
    fn structural(&self) -> bool {
        !matches!(
            self,
            Self::MovePoints { .. }
                | Self::MoveAnchors { .. }
                | Self::SetComponentTransforms { .. }
                | Self::TranslatePoints { .. }
                | Self::TransformLayer { .. }
                | Self::SetXAdvance { .. }
        )
    }
}

#[derive(Clone, Debug, Default)]
pub struct FontIntentSet {
    pub intents: Vec<FontIntent>,
}

/// One touched layer after an intent set applied.
pub struct TouchedLayer {
    pub layer: Arc<GlyphLayer>,
    pub structural: bool,
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
            pending.extend(
                candidate
                    .layers()
                    .values()
                    .flat_map(|layer| layer.components_iter())
                    .map(Component::base_glyph_id),
            );
        }

        false
    }

    /// Validates and applies an intent set, producing one reversible changeset.
    ///
    /// Mutations are staged on a copy. Repeated writes to the same scope are
    /// coalesced into the first original value and final replacement value.
    pub fn apply_intents(&mut self, set: FontIntentSet) -> CoreResult<AppliedIntents> {
        let before = self.clone();
        let mut after = self.clone();
        let mut touched: Vec<(LayerId, bool)> = Vec::new();
        let mut glyph_ids = Vec::new();

        let touch =
            |touched: &mut Vec<(LayerId, bool)>, layer_id: LayerId, structural| match touched
                .iter_mut()
                .find(|(id, _)| *id == layer_id)
            {
                Some((_, flag)) => *flag |= structural,
                None => touched.push((layer_id, structural)),
            };

        for intent in &set.intents {
            let Some(layer_id) = intent.layer_id() else {
                let (layer_ids, glyph_id) = after.apply_font_intent(intent)?;
                for layer_id in layer_ids {
                    touch(&mut touched, layer_id, true);
                }
                if let Some(glyph_id) = glyph_id {
                    if !glyph_ids.contains(&glyph_id) {
                        glyph_ids.push(glyph_id);
                    }
                }
                continue;
            };

            let layer_id = layer_id.clone();
            let structural = intent.structural();
            after.apply_intent(intent)?;
            touch(&mut touched, layer_id, structural);
        }

        let mut changes = FontChangeSet::default();
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

        for glyph_id in &glyph_ids {
            let original = before.glyph(glyph_id).cloned();
            let replacement = after.glyph(glyph_id).cloned();
            if original != replacement {
                changes.push(FontChange::Glyph(Replacement::new(original, replacement)));
            }
        }

        let mut layers = Vec::new();
        for (layer_id, structural) in touched {
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

        *self = after;
        Ok(AppliedIntents { changes, layers })
    }

    /// Applies one font-level intent and returns touched layer plus glyph identities.
    fn apply_font_intent(
        &mut self,
        intent: &FontIntent,
    ) -> CoreResult<(Vec<LayerId>, Option<GlyphId>)> {
        match intent {
            FontIntent::CreateGlyph {
                glyph_id,
                name,
                unicodes,
            } => {
                let glyph_id = self.apply_create_glyph(glyph_id.clone(), name, unicodes.clone())?;
                Ok((Vec::new(), Some(glyph_id)))
            }
            FontIntent::UpdateGlyph {
                glyph_id,
                new_name,
                new_unicodes,
            } => {
                self.apply_update_glyph(glyph_id.clone(), new_name.clone(), new_unicodes.clone())?;
                Ok((Vec::new(), Some(glyph_id.clone())))
            }
            FontIntent::UpdateFontMetadata { metadata } => {
                self.replace_metadata(metadata.clone());
                Ok((Vec::new(), None))
            }
            FontIntent::SetLanguages { language_ids } => {
                self.apply_set_languages(language_ids);
                Ok((Vec::new(), None))
            }
            FontIntent::CreateAxis { axis } => {
                self.apply_create_axis(axis)?;
                Ok((Vec::new(), None))
            }
            FontIntent::UpdateAxis { axis } => {
                self.apply_update_axis(axis)?;
                Ok((Vec::new(), None))
            }
            FontIntent::DeleteAxis { axis_id } => {
                self.apply_delete_axis(axis_id)?;
                Ok((Vec::new(), None))
            }
            FontIntent::SetAxisMappings { mappings } => {
                self.set_axis_mappings(mappings.clone())?;
                Ok((Vec::new(), None))
            }
            FontIntent::SetMetricDefinitions { definitions } => {
                self.set_metric_definitions(definitions.clone())?;
                Ok((Vec::new(), None))
            }
            FontIntent::CreateNamedInstance { instance } => {
                self.add_named_instance(instance.clone())?;
                Ok((Vec::new(), None))
            }
            FontIntent::UpdateNamedInstance { instance } => {
                self.replace_named_instance(instance.clone())?;
                Ok((Vec::new(), None))
            }
            FontIntent::DeleteNamedInstance { instance_id } => {
                self.remove_named_instance(instance_id.clone())?;
                Ok((Vec::new(), None))
            }
            FontIntent::DeleteSource { source_id } => {
                let layer_ids = self.apply_delete_source(source_id)?;
                Ok((layer_ids, None))
            }
            FontIntent::CreateSource {
                source_id,
                name,
                location,
            } => {
                self.apply_create_source(source_id.clone(), name, location)?;
                Ok((Vec::new(), None))
            }
            FontIntent::UpdateSource {
                source_id,
                name,
                location,
                metric_values,
                italic_angle,
                line_gap,
                underline_position,
                underline_thickness,
            } => {
                self.apply_update_source(
                    source_id,
                    name,
                    location,
                    metric_values,
                    *italic_angle,
                    *line_gap,
                    *underline_position,
                    *underline_thickness,
                )?;
                Ok((Vec::new(), None))
            }
            FontIntent::CreateGlyphLayer {
                layer_id,
                glyph_id,
                source_id,
            } => {
                let layer_ids = self.apply_create_glyph_layer(
                    layer_id.clone(),
                    glyph_id.clone(),
                    source_id.clone(),
                )?;
                Ok((layer_ids, None))
            }
            FontIntent::CloneGlyphLayer {
                layer_id,
                glyph_id,
                source_id,
                from_layer_id,
            } => {
                let layer_ids = self.apply_clone_glyph_layer(
                    layer_id.clone(),
                    glyph_id.clone(),
                    source_id.clone(),
                    from_layer_id.clone(),
                )?;
                Ok((layer_ids, None))
            }
            FontIntent::MaterializeGlyphLayer {
                layer_id,
                glyph_id,
                source_id,
                from_layer_id,
                values,
            } => {
                let layer_ids = self.apply_materialize_glyph_layer(
                    layer_id.clone(),
                    glyph_id.clone(),
                    source_id.clone(),
                    from_layer_id.clone(),
                    values,
                )?;
                Ok((layer_ids, None))
            }
            _ => unreachable!("editing intents take the layer path"),
        }
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
        let mut glyph = Glyph::with_id(glyph_id.clone(), glyph_name.clone());
        glyph.set_unicodes(unicodes);

        self.insert_glyph(glyph)?;
        Ok(glyph_id)
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
        self.remove_axis(axis_id.clone())?;
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
            .filter_map(|glyph| {
                glyph
                    .layer_for_source(source_id.clone())
                    .map(GlyphLayer::id)
            })
            .collect::<Vec<_>>();

        for layer_id in &layer_ids {
            self.remove_glyph_layer(layer_id.clone())?;
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
            source.is_master() && source_locations_equal(source.location(), location, self.axes())
        }) {
            return Err(CoreError::DuplicateSourceLocation {
                first: existing.id(),
                second: source_id,
            });
        }

        for (axis_id, _) in location.iter() {
            if self.axis(axis_id).is_none() {
                return Err(CoreError::AxisNotFound(axis_id.clone()));
            }
        }

        let mut source =
            Source::with_id(source_id.clone(), name.to_string(), location.clone(), None);
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
    fn apply_update_source(
        &mut self,
        source_id: &SourceId,
        name: &str,
        location: &DesignLocation,
        metric_values: &BTreeMap<MetricId, MetricValue>,
        italic_angle: Option<f64>,
        line_gap: Option<f64>,
        underline_position: Option<f64>,
        underline_thickness: Option<f64>,
    ) -> CoreResult<()> {
        let mut source = self.require_source(source_id)?.clone();
        source.set_name(name.trim().to_string());
        source.set_location(location.clone());
        source.set_metric_values(metric_values.clone());
        source.set_italic_angle(italic_angle);
        source.set_line_gap(line_gap);
        source.set_underline_position(underline_position);
        source.set_underline_thickness(underline_thickness);
        self.replace_source(source)?;
        Ok(())
    }

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
        glyph_id: GlyphId,
        new_name: GlyphName,
        new_unicodes: Vec<u32>,
    ) -> CoreResult<()> {
        self.require_glyph(&glyph_id)?;

        self.rename_glyph(glyph_id.clone(), new_name)?;
        self.set_glyph_unicodes(glyph_id, new_unicodes)?;
        Ok(())
    }

    fn apply_intent(&mut self, intent: &FontIntent) -> CoreResult<()> {
        match intent {
            FontIntent::AddPoints {
                layer_id,
                contour_id,
                before,
                points,
            } => {
                let mut point_ids = HashSet::new();
                for seed in points {
                    if self.has_point_id(&seed.id) || !point_ids.insert(seed.id.clone()) {
                        return Err(CoreError::DuplicatePointId(seed.id.clone()));
                    }
                }

                {
                    let layer = self.require_layer_mut(layer_id)?;
                    let contour_id = match (contour_id, before) {
                        (Some(contour_id), _) => contour_id.clone(),
                        (None, Some(before_id)) => layer.contour_of_point(before_id.clone())?,
                        (None, None) => {
                            return Err(CoreError::InvalidContourId(
                                "addPoints requires a contour or a before anchor".to_string(),
                            ));
                        }
                    };

                    let contour = layer.contour_mut(&contour_id).require(&contour_id)?;

                    let insert_at = match before {
                        Some(before_id) => Some(
                            contour
                                .points()
                                .iter()
                                .position(|point| point.id() == *before_id)
                                .require(before_id)?,
                        ),
                        None => None,
                    };

                    for (offset, seed) in points.iter().enumerate() {
                        let point = crate::ir::Point::new(
                            seed.id.clone(),
                            seed.x,
                            seed.y,
                            seed.point_type,
                            seed.smooth,
                        );

                        match insert_at {
                            Some(index) => contour.insert_point(index + offset, point),
                            None => contour.push_point(point),
                        }
                    }
                }

                self.record_point_ids(points.iter().map(|seed| seed.id.clone()));
                Ok(())
            }
            FontIntent::AddContour {
                layer_id,
                contour_id,
                closed,
            } => {
                if self.has_contour_id(contour_id) {
                    return Err(CoreError::DuplicateContourId(contour_id.clone()));
                }

                {
                    let layer = self.require_layer_mut(layer_id)?;
                    let mut contour = Contour::with_id(contour_id.clone());
                    if *closed {
                        contour.close();
                    }

                    layer.add_contour(contour);
                }

                self.record_contour_id(contour_id.clone());
                Ok(())
            }
            FontIntent::SetContourClosed {
                layer_id,
                contour_id,
                closed,
            } => {
                let layer = self.require_layer_mut(layer_id)?;
                if *closed {
                    layer.close_contour(contour_id.clone())?;
                } else {
                    layer.open_contour(contour_id.clone())?;
                }

                Ok(())
            }
            FontIntent::MovePoints {
                layer_id,
                point_ids,
                coords,
            } => {
                if coords.len() != point_ids.len() * 2 {
                    return Err(CoreError::InvalidPointId(format!(
                        "movePoints expects {} coords for {} points, got {}",
                        point_ids.len() * 2,
                        point_ids.len(),
                        coords.len()
                    )));
                }

                let layer = self.require_layer_mut(layer_id)?;
                layer.apply_bulk_node_positions(BulkNodePositionUpdates {
                    point_ids: Some(point_ids),
                    point_coords: Some(coords),
                    anchor_ids: None,
                    anchor_coords: None,
                })?;

                Ok(())
            }
            FontIntent::SetPointSmooth {
                layer_id,
                point_id,
                smooth,
            } => {
                let layer = self.require_layer_mut(layer_id)?;
                layer.set_point_smooth(point_id.clone(), *smooth)?;

                Ok(())
            }
            FontIntent::RemovePoints {
                layer_id,
                point_ids,
            } => {
                let empty_contours = {
                    let layer = self.require_layer_mut(layer_id)?;
                    layer.remove_points(point_ids)?
                };

                if empty_contours.is_empty() {
                    self.forget_point_ids(point_ids);
                } else {
                    self.rebuild_structure_index()?;
                }

                Ok(())
            }
            FontIntent::AddAnchors { layer_id, anchors } => {
                let mut anchor_ids = HashSet::new();
                for seed in anchors {
                    if self.has_anchor_id(&seed.id) || !anchor_ids.insert(seed.id.clone()) {
                        return Err(CoreError::DuplicateAnchorId(seed.id.clone()));
                    }
                }

                {
                    let layer = self.require_layer_mut(layer_id)?;
                    for seed in anchors {
                        layer.add_anchor(Anchor::with_id(
                            seed.id.clone(),
                            seed.name.clone(),
                            seed.x,
                            seed.y,
                        ));
                    }
                }

                self.record_anchor_ids(anchors.iter().map(|seed| seed.id.clone()));
                Ok(())
            }
            FontIntent::MoveAnchors {
                layer_id,
                anchor_ids,
                coords,
            } => {
                if coords.len() != anchor_ids.len() * 2 {
                    return Err(CoreError::InvalidAnchorId(format!(
                        "moveAnchors expects {} coords for {} anchors, got {}",
                        anchor_ids.len() * 2,
                        anchor_ids.len(),
                        coords.len()
                    )));
                }

                let layer = self.require_layer_mut(layer_id)?;
                layer.apply_bulk_node_positions(BulkNodePositionUpdates {
                    point_ids: None,
                    point_coords: None,
                    anchor_ids: Some(anchor_ids),
                    anchor_coords: Some(coords),
                })?;

                Ok(())
            }
            FontIntent::RemoveAnchors {
                layer_id,
                anchor_ids,
            } => {
                {
                    let layer = self.require_layer_mut(layer_id)?;
                    layer.remove_anchors(anchor_ids)?;
                }

                self.forget_anchor_ids(anchor_ids);
                Ok(())
            }
            FontIntent::AddComponent {
                layer_id,
                component_id,
                base_glyph_id,
            } => {
                if self.has_component_id(component_id) {
                    return Err(CoreError::DuplicateComponentId(component_id.clone()));
                }
                let glyph_id = self.require_layer_owner(layer_id)?;
                let base_glyph_name = self.require_glyph(base_glyph_id)?.glyph_name().clone();
                if self.component_reference_would_cycle(&glyph_id, base_glyph_id) {
                    return Err(CoreError::CyclicComponentReference {
                        glyph_id,
                        base_glyph_id: base_glyph_id.clone(),
                    });
                }

                let transform = self.anchor_aligned_component_transform(layer_id, base_glyph_id)?;
                {
                    let layer = self.require_layer_mut(layer_id)?;
                    layer.add_component(Component::with_id(
                        component_id.clone(),
                        base_glyph_id.clone(),
                        base_glyph_name,
                        transform,
                    ));
                }

                self.rebuild_structure_index()?;
                Ok(())
            }
            FontIntent::SetComponentTransforms {
                layer_id,
                component_ids,
                transforms,
            } => {
                if transforms.len() != component_ids.len() * 9 {
                    return Err(CoreError::InvalidPositionUpdateInput {
                        kind: "component transforms",
                        message: format!(
                            "expected {} values for {} components, got {}",
                            component_ids.len() * 9,
                            component_ids.len(),
                            transforms.len()
                        ),
                    });
                }
                if transforms.iter().any(|value| !value.is_finite()) {
                    return Err(CoreError::InvalidPositionUpdateInput {
                        kind: "component transforms",
                        message: "values must be finite".to_string(),
                    });
                }

                let layer = self.require_layer_mut(layer_id)?;
                for component_id in component_ids {
                    if layer.component(component_id).is_none() {
                        return Err(CoreError::InvalidComponentId(component_id.to_string()));
                    }
                }
                for (component_id, values) in component_ids.iter().zip(transforms.chunks_exact(9)) {
                    layer.set_component_transform(
                        component_id,
                        DecomposedTransform {
                            translate_x: values[0],
                            translate_y: values[1],
                            rotation: values[2],
                            scale_x: values[3],
                            scale_y: values[4],
                            skew_x: values[5],
                            skew_y: values[6],
                            t_center_x: values[7],
                            t_center_y: values[8],
                        },
                    )?;
                }

                Ok(())
            }
            FontIntent::RemoveComponents {
                layer_id,
                component_ids,
            } => {
                let component_ids = component_ids.iter().cloned().collect::<HashSet<_>>();
                {
                    let layer = self.require_layer_mut(layer_id)?;
                    for component_id in &component_ids {
                        if layer.component(component_id).is_none() {
                            return Err(CoreError::InvalidComponentId(component_id.to_string()));
                        }
                    }
                    for component_id in &component_ids {
                        layer.remove_component(component_id.clone());
                    }
                }

                self.rebuild_structure_index()?;
                Ok(())
            }
            FontIntent::DecomposeComponents {
                layer_id,
                component_ids,
            } => {
                let component_ids = component_ids.iter().cloned().collect::<HashSet<_>>();
                let (glyph_id, location) = {
                    let glyph_id = self.require_layer_owner(layer_id)?;
                    let layer = self.require_layer_mut(layer_id)?;
                    for component_id in &component_ids {
                        if layer.component(component_id).is_none() {
                            return Err(CoreError::InvalidComponentId(component_id.to_string()));
                        }
                    }
                    let source_id = layer.source_id();
                    let location = self.require_source(&source_id)?.location().clone();
                    (glyph_id, location)
                };
                let resolved_contours = {
                    let mut projection = self.projection(&location);
                    projection.component_contours(&glyph_id, &component_ids)?
                };

                {
                    let layer = self.require_layer_mut(layer_id)?;
                    for component_id in &component_ids {
                        layer.remove_component(component_id.clone());
                    }
                    for resolved in resolved_contours {
                        let mut contour = Contour::new();
                        for point in resolved.points {
                            contour.push_point(point);
                        }
                        if resolved.closed {
                            contour.close();
                        }
                        layer.add_contour(contour);
                    }
                }

                self.rebuild_structure_index()?;
                Ok(())
            }
            FontIntent::ReverseContour {
                layer_id,
                contour_id,
            } => {
                let layer = self.require_layer_mut(layer_id)?;
                layer.reverse_contour(contour_id.clone())?;

                Ok(())
            }
            FontIntent::SetContourStart {
                layer_id,
                contour_id,
                point_id,
            } => {
                let layer = self.require_layer_mut(layer_id)?;
                layer.set_contour_start(contour_id.clone(), point_id.clone())?;

                Ok(())
            }
            FontIntent::TranslatePoints {
                layer_id,
                point_ids,
                dx,
                dy,
            } => {
                let layer = self.require_layer_mut(layer_id)?;
                layer.move_points(point_ids, *dx, *dy)?;

                Ok(())
            }
            FontIntent::TransformLayer {
                layer_id,
                transform,
            } => {
                let values = [
                    transform.xx,
                    transform.xy,
                    transform.yx,
                    transform.yy,
                    transform.dx,
                    transform.dy,
                ];
                if values.iter().any(|value| !value.is_finite()) {
                    return Err(CoreError::InvalidPositionUpdateInput {
                        kind: "layer transform",
                        message: "values must be finite".to_string(),
                    });
                }

                self.require_layer_mut(layer_id)?.transform_layer(transform);
                Ok(())
            }
            FontIntent::ReplaceGlyphLayerContent {
                layer_id,
                width,
                contours,
                anchors,
                components,
            } => {
                let glyph_id = self
                    .glyph_id_by_layer(layer_id)
                    .ok_or_else(|| CoreError::LayerNotFound(layer_id.clone()))?;
                for component in components {
                    let base_glyph_id = component.base_glyph_id();
                    if self.glyph(&base_glyph_id).is_none() {
                        return Err(CoreError::GlyphNotFound(base_glyph_id));
                    }
                    if self.component_reference_would_cycle(&glyph_id, &base_glyph_id) {
                        return Err(CoreError::CyclicComponentReference {
                            glyph_id,
                            base_glyph_id,
                        });
                    }
                }
                let mut layer = self
                    .layer(layer_id)
                    .ok_or_else(|| CoreError::LayerNotFound(layer_id.clone()))?
                    .clone();
                layer.replace_content(
                    *width,
                    contours.clone(),
                    anchors.clone(),
                    components.clone(),
                )?;
                self.replace_glyph_layers(vec![layer])?;

                Ok(())
            }
            FontIntent::SetXAdvance { layer_id, width } => {
                let layer = self.require_layer_mut(layer_id)?;
                layer.set_x_advance(*width);

                Ok(())
            }
            FontIntent::ApplyBooleanOp {
                layer_id,
                contour_id_a,
                contour_id_b,
                operation,
            } => {
                {
                    let layer = self.require_layer_mut(layer_id)?;
                    layer.apply_boolean_op(
                        contour_id_a.clone(),
                        contour_id_b.clone(),
                        *operation,
                    )?;
                }

                self.rebuild_structure_index()?;
                Ok(())
            }
            FontIntent::CreateGlyph { .. }
            | FontIntent::UpdateGlyph { .. }
            | FontIntent::UpdateFontMetadata { .. }
            | FontIntent::SetLanguages { .. }
            | FontIntent::CreateAxis { .. }
            | FontIntent::UpdateAxis { .. }
            | FontIntent::DeleteAxis { .. }
            | FontIntent::SetAxisMappings { .. }
            | FontIntent::SetMetricDefinitions { .. }
            | FontIntent::CreateNamedInstance { .. }
            | FontIntent::UpdateNamedInstance { .. }
            | FontIntent::DeleteNamedInstance { .. }
            | FontIntent::DeleteSource { .. }
            | FontIntent::CreateSource { .. }
            | FontIntent::UpdateSource { .. }
            | FontIntent::CreateGlyphLayer { .. }
            | FontIntent::CloneGlyphLayer { .. }
            | FontIntent::MaterializeGlyphLayer { .. } => {
                unreachable!("font-level intents take the apply_font_intent path")
            }
        }
    }

    /// Places a new component so its `_name` anchor meets the matching sibling anchor.
    ///
    /// Siblings and the new base glyph are read at `layer_id`'s source. A
    /// sibling whose base glyph has no layer there contributes no anchors.
    fn anchor_aligned_component_transform(
        &self,
        layer_id: &LayerId,
        base_glyph_id: &GlyphId,
    ) -> CoreResult<DecomposedTransform> {
        let layer = self.require_layer(layer_id)?;
        let source_id = layer.source_id();
        let base_layer_at_source = |glyph_id: GlyphId| {
            self.glyph(&glyph_id)
                .and_then(|glyph| glyph.layer_for_source(source_id.clone()))
        };
        let Some(component_layer) = base_layer_at_source(base_glyph_id.clone()) else {
            return Ok(DecomposedTransform::default());
        };

        let placed: Vec<_> = layer
            .components_iter()
            .filter_map(|component| {
                base_layer_at_source(component.base_glyph_id())
                    .map(|base_layer| (component.matrix(), base_layer))
            })
            .collect();
        let Some((dx, dy)) = anchor_aligned_offset(&placed, component_layer) else {
            return Ok(DecomposedTransform::default());
        };

        Ok(DecomposedTransform {
            translate_x: dx,
            translate_y: dy,
            ..Default::default()
        })
    }
}

#[cfg(test)]
mod replacement_tests;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deleting_the_default_source_is_rejected_without_mutation() {
        let mut font = Font::new();
        let default_source_id = font.default_source_id().unwrap();
        let axis = Axis::weight();
        let axis_id = axis.id();
        font.add_axis(axis).unwrap();
        let mut location = DesignLocation::new();
        location.set(axis_id, 700.0);
        font.add_source(Source::new("Bold".to_string(), location));
        let original = font.clone();

        let error = match font.apply_intents(FontIntentSet {
            intents: vec![FontIntent::DeleteSource {
                source_id: default_source_id.clone(),
            }],
        }) {
            Ok(_) => panic!("default source deletion should be rejected"),
            Err(error) => error,
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
        let mut location = DesignLocation::new();
        location.set(axis_id, 400.0);

        let result = font.apply_intents(FontIntentSet {
            intents: vec![FontIntent::CreateSource {
                source_id,
                name: "Book".to_string(),
                location,
            }],
        });

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
        let result = candidate.apply_intents(FontIntentSet {
            intents: vec![
                FontIntent::CreateGlyphLayer {
                    layer_id: layer_id.clone(),
                    glyph_id,
                    source_id,
                },
                FontIntent::AddContour {
                    layer_id,
                    contour_id: contour_id.clone(),
                    closed: true,
                },
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

        font.apply_intents(FontIntentSet {
            intents: vec![FontIntent::AddComponent {
                layer_id: root_layer_id.clone(),
                component_id: component_id.clone(),
                base_glyph_id: base_id.clone(),
            }],
        })
        .unwrap();

        let component = font
            .layer(&root_layer_id)
            .unwrap()
            .component(&component_id)
            .unwrap();
        assert_eq!(component.base_glyph_id(), base_id);
        assert_eq!(component.base_glyph_name().as_str(), "base");

        font.apply_intents(FontIntentSet {
            intents: vec![FontIntent::RemoveComponents {
                layer_id: root_layer_id.clone(),
                component_ids: vec![component_id],
            }],
        })
        .unwrap();

        assert!(font.layer(&root_layer_id).unwrap().components().is_empty());
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

        font.apply_intents(FontIntentSet {
            intents: vec![
                FontIntent::AddComponent {
                    layer_id: root_layer_id.clone(),
                    component_id: ComponentId::new(),
                    base_glyph_id: base_id,
                },
                FontIntent::AddComponent {
                    layer_id: root_layer_id.clone(),
                    component_id: mark_component_id.clone(),
                    base_glyph_id: mark_id,
                },
            ],
        })
        .unwrap();

        let layer = font.layer(&root_layer_id).unwrap();
        let mark = layer.component(&mark_component_id).unwrap();
        assert_eq!(mark.matrix(), crate::Transform::translate(321.0, 0.0));
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

        let result = font.apply_intents(FontIntentSet {
            intents: vec![FontIntent::AddComponent {
                layer_id,
                component_id: ComponentId::new(),
                base_glyph_id: glyph_id.clone(),
            }],
        });

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

        let result = font.apply_intents(FontIntentSet {
            intents: vec![FontIntent::AddComponent {
                layer_id: child_layer_id,
                component_id: ComponentId::new(),
                base_glyph_id: parent_id.clone(),
            }],
        });

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

        font.apply_intents(FontIntentSet {
            intents: vec![FontIntent::TransformLayer {
                layer_id: layer_id.clone(),
                transform: Transform::translate(25.0, 0.0),
            }],
        })
        .unwrap();
        let anchor = font
            .require_layer(&layer_id)
            .unwrap()
            .anchor(&anchor_id)
            .unwrap();
        assert_eq!(anchor.x(), 35.0);

        let rejected = font.apply_intents(FontIntentSet {
            intents: vec![FontIntent::TransformLayer {
                layer_id,
                transform: Transform::translate(f64::NAN, 0.0),
            }],
        });
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

        font.apply_intents(FontIntentSet {
            intents: vec![FontIntent::SetComponentTransforms {
                layer_id: layer_id.clone(),
                component_ids: vec![component_id.clone()],
                transforms: vec![12.0, -7.0, 30.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0],
            }],
        })
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
            crate::DecomposedTransform {
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
            crate::DecomposedTransform {
                translate_x: 30.0,
                ..Default::default()
            },
        ));
        let mut root = Glyph::new("root");
        root.set_layer(root_layer);
        font.insert_glyph(root).unwrap();

        font.apply_intents(FontIntentSet {
            intents: vec![FontIntent::DecomposeComponents {
                layer_id: root_layer_id.clone(),
                component_ids: vec![root_component_id],
            }],
        })
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
        let mut location = DesignLocation::new();
        location.set(axis_id, 700.0);
        font.apply_intents(FontIntentSet {
            intents: vec![FontIntent::CreateSource {
                source_id: source_id.clone(),
                name: "Bold".to_string(),
                location,
            }],
        })
        .expect("new source should apply");

        let layer_id = LayerId::new();
        let values = GlyphInterpolationValues::new(vec![600.0, 30.0, 40.0]);
        font.apply_intents(FontIntentSet {
            intents: vec![FontIntent::MaterializeGlyphLayer {
                layer_id: layer_id.clone(),
                glyph_id: glyph_id.clone(),
                source_id,
                from_layer_id,
                values: values.clone(),
            }],
        })
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
                .map(|point| point.id()),
            Some(source_point_id)
        );
    }
}
