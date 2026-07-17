//! Renderer-facing intent vocabulary.
//!
//! Intents are what a caller ASKS for; [`FontChange`] records are what the
//! workspace persists. The vocabularies are deliberately distinct: intents
//! carry caller-minted ids and insertion anchors, records carry
//! post-mutation snapshots for the store. CS1 covers the pen scope; later
//! milestones add variants alongside the tools that emit them.

use crate::changes::{AnchorPosition, FontChange, FontChangeSet, PointPosition};
use crate::error::{CoreError, CoreResult};
use crate::interpolation::GlyphInterpolationValues;
use crate::ir::{
    Anchor, AnchorId, Axis, AxisId, AxisMapping, BooleanOp, Contour, ContourId, Font, FontMetadata,
    Glyph, GlyphId, GlyphLayer, GlyphName, LayerId, Location, MetricDefinition, MetricId,
    MetricValue, NamedInstance, NamedInstanceId, PointId, PointType, Source, SourceId,
};
use crate::layer_edit::BulkNodePositionUpdates;
use crate::source::source_locations_equal;
use std::collections::BTreeMap;

/// A point to create, with its caller-minted id.
#[derive(Clone, Debug)]
pub struct PointSeed {
    pub id: PointId,
    pub x: f64,
    pub y: f64,
    pub point_type: PointType,
    pub smooth: bool,
}

/// An anchor to create, with its caller-minted id.
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
    ReverseContour {
        layer_id: LayerId,
        contour_id: ContourId,
    },
    /// Affine move: O(selection-ids) wire instead of O(N) coords.
    TranslatePoints {
        layer_id: LayerId,
        point_ids: Vec<PointId>,
        dx: f64,
        dy: f64,
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
        location: Location,
    },
    /// Replaces the editable authoring values of an existing master source.
    UpdateSource {
        source_id: SourceId,
        name: String,
        location: Location,
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
            | Self::ReverseContour { layer_id, .. }
            | Self::TranslatePoints { layer_id, .. }
            | Self::SetXAdvance { layer_id, .. }
            | Self::ApplyBooleanOp { layer_id, .. } => Some(layer_id),

            Self::CreateGlyph { .. }
            | Self::UpdateGlyph { .. }
            | Self::UpdateFontMetadata { .. }
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

    /// Whether applying this intent changes layer structure (vs values only).
    /// Smooth flags live in structure, so they count.
    fn structural(&self) -> bool {
        !matches!(
            self,
            Self::MovePoints { .. }
                | Self::MoveAnchors { .. }
                | Self::TranslatePoints { .. }
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
    pub layer: GlyphLayer,
    pub structural: bool,
}

/// Outcome of applying an intent set: canonical records for the store plus
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

    /// Validates and applies an intent set, producing the canonical change
    /// records. All-or-nothing only when the caller applies to a clone and
    /// swaps on success (the workspace's commit pattern).
    pub fn apply_intents(&mut self, set: FontIntentSet) -> CoreResult<AppliedIntents> {
        let mut changes = FontChangeSet::default();
        let mut touched: Vec<(LayerId, bool)> = Vec::new();

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
                for layer_id in self.apply_font_intent(intent, &mut changes)? {
                    touch(&mut touched, layer_id, true);
                }
                continue;
            };

            let layer_id = layer_id.clone();
            let structural = intent.structural();

            let change = self.apply_intent(intent)?;
            changes.push(change);

            touch(&mut touched, layer_id, structural);
        }

        let layers = touched
            .into_iter()
            .map(|(layer_id, structural)| {
                let layer = self
                    .layer(layer_id.clone())
                    .ok_or(CoreError::LayerNotFound(layer_id))?
                    .clone();
                Ok(TouchedLayer { layer, structural })
            })
            .collect::<CoreResult<Vec<_>>>()?;

        Ok(AppliedIntents { changes, layers })
    }

    /// Applies one font-level intent, pushing every change it produces.
    /// Returns the created layer ids so the caller can mark them touched.
    fn apply_font_intent(
        &mut self,
        intent: &FontIntent,
        changes: &mut FontChangeSet,
    ) -> CoreResult<Vec<LayerId>> {
        match intent {
            FontIntent::CreateGlyph {
                glyph_id,
                name,
                unicodes,
            } => self.apply_create_glyph(glyph_id.clone(), name, unicodes.clone(), changes),
            FontIntent::UpdateGlyph {
                glyph_id,
                new_name,
                new_unicodes,
            } => {
                changes.push(self.apply_update_glyph(
                    glyph_id.clone(),
                    new_name.clone(),
                    new_unicodes.clone(),
                )?);
                Ok(Vec::new())
            }
            FontIntent::UpdateFontMetadata { metadata } => {
                self.replace_metadata(metadata.clone());
                changes.push(FontChange::font_metadata_updated(metadata));
                Ok(Vec::new())
            }
            FontIntent::CreateAxis { axis } => {
                self.apply_create_axis(axis, changes)?;
                Ok(Vec::new())
            }
            FontIntent::UpdateAxis { axis } => {
                self.apply_update_axis(axis, changes)?;
                Ok(Vec::new())
            }
            FontIntent::DeleteAxis { axis_id } => {
                self.apply_delete_axis(axis_id, changes)?;
                Ok(Vec::new())
            }
            FontIntent::SetAxisMappings { mappings } => {
                self.set_axis_mappings(mappings.clone())?;
                changes.push(FontChange::axis_mappings_updated(mappings));
                Ok(Vec::new())
            }
            FontIntent::SetMetricDefinitions { definitions } => {
                self.set_metric_definitions(definitions.clone())?;
                changes.push(FontChange::metric_definitions_updated(definitions));
                for source in self.sources() {
                    changes.push(FontChange::source_updated(source));
                }
                Ok(Vec::new())
            }
            FontIntent::CreateNamedInstance { instance } => {
                self.add_named_instance(instance.clone())?;
                changes.push(FontChange::named_instances_updated(self.named_instances()));
                Ok(Vec::new())
            }
            FontIntent::UpdateNamedInstance { instance } => {
                self.replace_named_instance(instance.clone())?;
                changes.push(FontChange::named_instances_updated(self.named_instances()));
                Ok(Vec::new())
            }
            FontIntent::DeleteNamedInstance { instance_id } => {
                self.remove_named_instance(instance_id.clone())?;
                changes.push(FontChange::named_instances_updated(self.named_instances()));
                Ok(Vec::new())
            }
            FontIntent::DeleteSource { source_id } => {
                self.apply_delete_source(source_id, changes)?;
                Ok(Vec::new())
            }
            FontIntent::CreateSource {
                source_id,
                name,
                location,
            } => self.apply_create_source(source_id.clone(), name, location, changes),
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
                    changes,
                )?;
                Ok(Vec::new())
            }
            FontIntent::CreateGlyphLayer {
                layer_id,
                glyph_id,
                source_id,
            } => self.apply_create_glyph_layer(
                layer_id.clone(),
                glyph_id.clone(),
                source_id.clone(),
                changes,
            ),
            FontIntent::CloneGlyphLayer {
                layer_id,
                glyph_id,
                source_id,
                from_layer_id,
            } => self.apply_clone_glyph_layer(
                layer_id.clone(),
                glyph_id.clone(),
                source_id.clone(),
                from_layer_id.clone(),
                changes,
            ),
            FontIntent::MaterializeGlyphLayer {
                layer_id,
                glyph_id,
                source_id,
                from_layer_id,
                values,
            } => self.apply_materialize_glyph_layer(
                layer_id.clone(),
                glyph_id.clone(),
                source_id.clone(),
                from_layer_id.clone(),
                values,
                changes,
            ),
            _ => unreachable!("editing intents take the layer path"),
        }
    }

    fn apply_create_glyph(
        &mut self,
        glyph_id: Option<GlyphId>,
        name: &str,
        unicodes: Vec<u32>,
        changes: &mut FontChangeSet,
    ) -> CoreResult<Vec<LayerId>> {
        let name = name.trim();
        let glyph_name =
            GlyphName::new(name).map_err(|_| CoreError::InvalidGlyphName(name.to_string()))?;
        if self.glyph_id_by_name(name).is_some() {
            return Err(CoreError::DuplicateGlyphName(glyph_name));
        }

        let glyph_id = glyph_id.unwrap_or_default();
        let mut glyph = Glyph::with_id(glyph_id, glyph_name.clone());
        glyph.set_unicodes(unicodes);
        changes.push(FontChange::glyph_created(&glyph));

        self.insert_glyph(glyph)?;
        Ok(Vec::new())
    }

    fn apply_create_axis(&mut self, axis: &Axis, changes: &mut FontChangeSet) -> CoreResult<()> {
        let previous_instances = self.named_instances().to_vec();
        self.add_axis(axis.clone())?;
        changes.push(FontChange::axis_created(axis));
        if self.named_instances() != previous_instances {
            changes.push(FontChange::named_instances_updated(self.named_instances()));
        }
        Ok(())
    }

    fn apply_update_axis(&mut self, axis: &Axis, changes: &mut FontChangeSet) -> CoreResult<()> {
        if self
            .axes()
            .iter()
            .any(|existing| existing.id() != axis.id() && existing.tag() == axis.tag())
        {
            return Err(CoreError::DuplicateAxisTag(axis.tag().to_string()));
        }

        let previous_instances = self.named_instances().to_vec();
        self.replace_axis(axis.clone())?;
        changes.push(FontChange::axis_updated(axis));
        if self.named_instances() != previous_instances {
            changes.push(FontChange::named_instances_updated(self.named_instances()));
        }
        Ok(())
    }

    fn apply_delete_axis(
        &mut self,
        axis_id: &AxisId,
        changes: &mut FontChangeSet,
    ) -> CoreResult<()> {
        let previous_mappings = self.axis_mappings().to_vec();
        let previous_instances = self.named_instances().to_vec();
        self.remove_axis(axis_id.clone())?;
        if self.axis_mappings() != previous_mappings {
            changes.push(FontChange::axis_mappings_updated(self.axis_mappings()));
        }
        changes.push(FontChange::axis_deleted(axis_id.clone()));
        if self.named_instances() != previous_instances {
            changes.push(FontChange::named_instances_updated(self.named_instances()));
        }
        Ok(())
    }

    fn apply_delete_source(
        &mut self,
        source_id: &SourceId,
        changes: &mut FontChangeSet,
    ) -> CoreResult<()> {
        if self.sources().len() <= 1 {
            return Err(CoreError::CannotDeleteLastSource);
        }

        let layers: Vec<(GlyphId, GlyphLayer)> = self
            .glyphs()
            .filter_map(|glyph| {
                glyph
                    .layer_for_source(source_id.clone())
                    .map(|layer| (glyph.id(), layer.clone()))
            })
            .collect();

        for (glyph_id, layer) in layers {
            changes.push(FontChange::glyph_layer_deleted(glyph_id, &layer));
            self.remove_glyph_layer(layer.id())?;
        }

        self.remove_source(source_id.clone())
            .ok_or_else(|| CoreError::SourceNotFound(source_id.clone()))?;
        changes.push(FontChange::source_deleted(source_id.clone()));
        Ok(())
    }

    fn apply_create_source(
        &mut self,
        source_id: SourceId,
        name: &str,
        location: &Location,
        changes: &mut FontChangeSet,
    ) -> CoreResult<Vec<LayerId>> {
        let name = name.trim();
        if name.is_empty() {
            return Err(CoreError::InvalidSourceName(name.to_string()));
        }
        if self.sources().iter().any(|source| source.name() == name) {
            return Err(CoreError::DuplicateSourceName(name.to_string()));
        }
        if self.sources().iter().any(|source| source.id() == source_id) {
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
            if !self.axes().iter().any(|axis| axis.id() == *axis_id) {
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
        changes.push(FontChange::source_created(&source));
        self.add_source(source);

        Ok(Vec::new())
    }

    #[allow(clippy::too_many_arguments)]
    fn apply_update_source(
        &mut self,
        source_id: &SourceId,
        name: &str,
        location: &Location,
        metric_values: &BTreeMap<MetricId, MetricValue>,
        italic_angle: Option<f64>,
        line_gap: Option<f64>,
        underline_position: Option<f64>,
        underline_thickness: Option<f64>,
        changes: &mut FontChangeSet,
    ) -> CoreResult<()> {
        let mut source = self
            .sources()
            .iter()
            .find(|source| source.id() == *source_id)
            .cloned()
            .ok_or_else(|| CoreError::SourceNotFound(source_id.clone()))?;
        source.set_name(name.trim().to_string());
        source.set_location(location.clone());
        source.set_metric_values(metric_values.clone());
        source.set_italic_angle(italic_angle);
        source.set_line_gap(line_gap);
        source.set_underline_position(underline_position);
        source.set_underline_thickness(underline_thickness);
        self.replace_source(source.clone())?;
        changes.push(FontChange::source_updated(&source));
        Ok(())
    }

    fn apply_create_glyph_layer(
        &mut self,
        layer_id: LayerId,
        glyph_id: GlyphId,
        source_id: SourceId,
        changes: &mut FontChangeSet,
    ) -> CoreResult<Vec<LayerId>> {
        let glyph_name = self
            .glyph(glyph_id.clone())
            .ok_or_else(|| CoreError::GlyphNotFound(glyph_id.clone()))?
            .glyph_name()
            .clone();
        if self.glyph_id_by_layer(layer_id.clone()).is_some() {
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

        self.insert_glyph_layer(glyph_id.clone(), layer.clone())?;
        changes.push(FontChange::glyph_layer_created(
            glyph_id,
            Some(glyph_name),
            &layer,
        ));

        Ok(vec![layer_id])
    }

    fn apply_clone_glyph_layer(
        &mut self,
        layer_id: LayerId,
        glyph_id: GlyphId,
        source_id: SourceId,
        from_layer_id: LayerId,
        changes: &mut FontChangeSet,
    ) -> CoreResult<Vec<LayerId>> {
        let (glyph_name, layer) =
            self.cloned_glyph_layer(layer_id.clone(), glyph_id.clone(), source_id, from_layer_id)?;

        self.insert_glyph_layer(glyph_id.clone(), layer.clone())?;
        changes.push(FontChange::glyph_layer_created(
            glyph_id,
            Some(glyph_name),
            &layer,
        ));

        Ok(vec![layer_id])
    }

    fn apply_materialize_glyph_layer(
        &mut self,
        layer_id: LayerId,
        glyph_id: GlyphId,
        source_id: SourceId,
        from_layer_id: LayerId,
        values: &GlyphInterpolationValues,
        changes: &mut FontChangeSet,
    ) -> CoreResult<Vec<LayerId>> {
        let (glyph_name, mut layer) =
            self.cloned_glyph_layer(layer_id.clone(), glyph_id.clone(), source_id, from_layer_id)?;
        layer.apply_interpolation_values(values)?;

        self.insert_glyph_layer(glyph_id.clone(), layer.clone())?;
        changes.push(FontChange::glyph_layer_created(
            glyph_id,
            Some(glyph_name),
            &layer,
        ));

        Ok(vec![layer_id])
    }

    fn cloned_glyph_layer(
        &self,
        layer_id: LayerId,
        glyph_id: GlyphId,
        source_id: SourceId,
        from_layer_id: LayerId,
    ) -> CoreResult<(GlyphName, GlyphLayer)> {
        let glyph_name = self
            .glyph(glyph_id.clone())
            .ok_or_else(|| CoreError::GlyphNotFound(glyph_id.clone()))?
            .glyph_name()
            .clone();

        if self.glyph_id_by_layer(layer_id.clone()).is_some() {
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

        let from_glyph_id = self
            .glyph_id_by_layer(from_layer_id.clone())
            .ok_or_else(|| CoreError::LayerNotFound(from_layer_id.clone()))?;
        if from_glyph_id != glyph_id {
            return Err(CoreError::LayerGlyphMismatch {
                layer_id: from_layer_id,
                glyph_id,
                actual_glyph_id: from_glyph_id,
            });
        }

        let source_layer = self
            .layer(from_layer_id.clone())
            .ok_or(CoreError::LayerNotFound(from_layer_id))?;
        let layer = source_layer.clone_with_fresh_ids(layer_id, source_id);

        Ok((glyph_name, layer))
    }

    fn apply_update_glyph(
        &mut self,
        glyph_id: GlyphId,
        new_name: GlyphName,
        new_unicodes: Vec<u32>,
    ) -> CoreResult<FontChange> {
        let old_glyph = self
            .glyph(glyph_id.clone())
            .ok_or(CoreError::GlyphNotFound(glyph_id.clone()))?;
        let old_name = old_glyph.glyph_name().clone();
        let old_unicodes = old_glyph.unicodes().to_vec();

        self.rename_glyph(glyph_id.clone(), new_name.clone())?;
        self.set_glyph_unicodes(glyph_id.clone(), new_unicodes.clone())?;

        Ok(FontChange::glyph_identity_changed(
            glyph_id,
            old_name,
            new_name,
            old_unicodes,
            new_unicodes,
        ))
    }

    fn apply_intent(&mut self, intent: &FontIntent) -> CoreResult<FontChange> {
        match intent {
            FontIntent::AddPoints {
                layer_id,
                contour_id,
                before,
                points,
            } => {
                let layer = self.layer_mut_or_err(layer_id)?;

                for seed in points {
                    if layer.has_point(seed.id.clone()) {
                        return Err(CoreError::DuplicatePointId(seed.id.clone()));
                    }
                }

                let contour_id = match (contour_id, before) {
                    (Some(contour_id), _) => contour_id.clone(),
                    (None, Some(before_id)) => layer.contour_of_point(before_id.clone())?,
                    (None, None) => {
                        return Err(CoreError::InvalidContourId(
                            "addPoints requires a contour or a before anchor".to_string(),
                        ));
                    }
                };

                let contour = layer
                    .contour_mut(contour_id.clone())
                    .ok_or(CoreError::ContourNotFound(contour_id))?;

                let insert_at = match before {
                    Some(before_id) => Some(
                        contour
                            .points()
                            .iter()
                            .position(|point| point.id() == *before_id)
                            .ok_or(CoreError::PointNotFound(before_id.clone()))?,
                    ),
                    None => None,
                };

                let mut ids = Vec::with_capacity(points.len());
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
                    ids.push(seed.id.clone());
                }

                Ok(FontChange::points_added(layer_id.clone(), contour, ids))
            }
            FontIntent::AddContour {
                layer_id,
                contour_id,
                closed,
            } => {
                let layer = self.layer_mut_or_err(layer_id)?;
                if layer.contour(contour_id.clone()).is_some() {
                    return Err(CoreError::DuplicateContourId(contour_id.clone()));
                }

                let mut contour = Contour::with_id(contour_id.clone());
                if *closed {
                    contour.close();
                }

                layer.add_contour(contour.clone());
                Ok(FontChange::contour_added(layer_id.clone(), &contour))
            }
            FontIntent::SetContourClosed {
                layer_id,
                contour_id,
                closed,
            } => {
                let layer = self.layer_mut_or_err(layer_id)?;
                if *closed {
                    layer.close_contour(contour_id.clone())?;
                } else {
                    layer.open_contour(contour_id.clone())?;
                }

                Ok(FontChange::contour_open_closed_changed(
                    layer_id.clone(),
                    contour_id.clone(),
                    *closed,
                ))
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

                let layer = self.layer_mut_or_err(layer_id)?;
                layer.apply_bulk_node_positions(BulkNodePositionUpdates {
                    point_ids: Some(point_ids),
                    point_coords: Some(coords),
                    anchor_ids: None,
                    anchor_coords: None,
                })?;

                let positions = point_ids
                    .iter()
                    .zip(coords.chunks_exact(2))
                    .map(|(point_id, xy)| PointPosition {
                        point_id: point_id.clone(),
                        x: xy[0],
                        y: xy[1],
                    })
                    .collect();

                Ok(FontChange::point_positions_changed(
                    layer_id.clone(),
                    positions,
                ))
            }
            FontIntent::SetPointSmooth {
                layer_id,
                point_id,
                smooth,
            } => {
                let layer = self.layer_mut_or_err(layer_id)?;
                layer.set_point_smooth(point_id.clone(), *smooth)?;

                Ok(FontChange::point_smooth_changed(
                    layer_id.clone(),
                    point_id.clone(),
                    *smooth,
                ))
            }
            FontIntent::RemovePoints {
                layer_id,
                point_ids,
            } => {
                let layer = self.layer_mut_or_err(layer_id)?;
                layer.remove_points(point_ids)?;

                Ok(FontChange::layer_geometry_replaced(layer))
            }
            FontIntent::AddAnchors { layer_id, anchors } => {
                let layer = self.layer_mut_or_err(layer_id)?;

                for seed in anchors {
                    if layer.has_anchor(seed.id.clone()) {
                        return Err(CoreError::DuplicateAnchorId(seed.id.clone()));
                    }
                }

                for seed in anchors {
                    layer.add_anchor(Anchor::with_id(
                        seed.id.clone(),
                        seed.name.clone(),
                        seed.x,
                        seed.y,
                    ));
                }

                Ok(FontChange::layer_geometry_replaced(layer))
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

                let layer = self.layer_mut_or_err(layer_id)?;
                layer.apply_bulk_node_positions(BulkNodePositionUpdates {
                    point_ids: None,
                    point_coords: None,
                    anchor_ids: Some(anchor_ids),
                    anchor_coords: Some(coords),
                })?;

                let positions = anchor_ids
                    .iter()
                    .zip(coords.chunks_exact(2))
                    .map(|(anchor_id, xy)| AnchorPosition {
                        anchor_id: anchor_id.clone(),
                        x: xy[0],
                        y: xy[1],
                    })
                    .collect();

                Ok(FontChange::anchor_positions_changed(
                    layer_id.clone(),
                    positions,
                ))
            }
            FontIntent::RemoveAnchors {
                layer_id,
                anchor_ids,
            } => {
                let layer = self.layer_mut_or_err(layer_id)?;
                layer.remove_anchors(anchor_ids)?;

                Ok(FontChange::layer_geometry_replaced(layer))
            }
            FontIntent::ReverseContour {
                layer_id,
                contour_id,
            } => {
                let layer = self.layer_mut_or_err(layer_id)?;
                layer.reverse_contour(contour_id.clone())?;

                Ok(FontChange::layer_geometry_replaced(layer))
            }
            FontIntent::TranslatePoints {
                layer_id,
                point_ids,
                dx,
                dy,
            } => {
                let layer = self.layer_mut_or_err(layer_id)?;
                layer.move_points(point_ids, *dx, *dy)?;

                let positions = point_ids
                    .iter()
                    .map(|point_id| {
                        let contour_id = layer.contour_of_point(point_id.clone())?;
                        let point = layer
                            .contour(contour_id)
                            .and_then(|contour| contour.get_point(point_id.clone()))
                            .ok_or(CoreError::PointNotFound(point_id.clone()))?;
                        Ok(PointPosition {
                            point_id: point_id.clone(),
                            x: point.x(),
                            y: point.y(),
                        })
                    })
                    .collect::<CoreResult<Vec<_>>>()?;

                Ok(FontChange::point_positions_changed(
                    layer_id.clone(),
                    positions,
                ))
            }
            FontIntent::SetXAdvance { layer_id, width } => {
                let layer = self.layer_mut_or_err(layer_id)?;
                layer.set_x_advance(*width);

                Ok(FontChange::layer_metrics_changed(layer))
            }
            FontIntent::ApplyBooleanOp {
                layer_id,
                contour_id_a,
                contour_id_b,
                operation,
            } => {
                let layer = self.layer_mut_or_err(layer_id)?;
                layer.apply_boolean_op(contour_id_a.clone(), contour_id_b.clone(), *operation)?;

                Ok(FontChange::layer_geometry_replaced(layer))
            }
            FontIntent::CreateGlyph { .. }
            | FontIntent::UpdateGlyph { .. }
            | FontIntent::UpdateFontMetadata { .. }
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

    /// Ids of glyphs whose components reference the glyphs owning the
    /// given layers — the composites a renderer must re-render after an
    /// edit. Stable ids (not names): references survive renames. Sorted,
    /// deduplicated, excludes the touched glyphs themselves.
    pub fn dependents_of_layers(&self, layer_ids: &[LayerId]) -> Vec<GlyphId> {
        let touched: Vec<GlyphId> = self
            .glyphs()
            .filter(|glyph| {
                glyph
                    .layers()
                    .keys()
                    .any(|layer_id| layer_ids.contains(layer_id))
            })
            .map(|glyph| glyph.id())
            .collect();

        let mut dependents: Vec<GlyphId> = self
            .glyphs()
            .filter(|glyph| !touched.contains(&glyph.id()))
            .filter(|glyph| {
                glyph.layers().values().any(|layer| {
                    layer
                        .components_iter()
                        .any(|component| touched.contains(&component.base_glyph_id()))
                })
            })
            .map(|glyph| glyph.id())
            .collect();

        dependents.sort();
        dependents.dedup();
        dependents
    }

    fn layer_mut_or_err(&mut self, layer_id: &LayerId) -> CoreResult<&mut GlyphLayer> {
        self.layer_mut(layer_id.clone())
            .ok_or(CoreError::LayerNotFound(layer_id.clone()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duplicate_master_locations_include_omitted_axis_defaults() {
        let mut font = Font::new();
        let axis = Axis::weight();
        let axis_id = axis.id();
        font.add_axis(axis).expect("weight axis should be valid");
        let source_id = SourceId::new();
        let mut location = Location::new();
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
        let mut location = Location::new();
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
            .layer(layer_id)
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
