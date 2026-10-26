use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use crate::{FontChange, FontChangeSet, Require, SourceCollection};

use super::*;

impl Font {
    /// Applies every replacement in `change_set` as one validated target.
    ///
    /// Current values must match every `before` value. Replacements are
    /// installed on a copy, indexes are updated for the touched glyphs, and the complete result is
    /// checked against persisted-state invariants before this font changes.
    /// Intent-specific creation and update guards are not rerun during replay.
    ///
    /// # Errors
    ///
    /// Returns a conflict when a current value differs from its expected
    /// original value, or a domain validation error when the complete target
    /// violates a persisted-state invariant. Failure leaves the font unchanged.
    pub fn apply_change_set(&mut self, change_set: &FontChangeSet) -> CoreResult<()> {
        self.validate_change_origins(change_set)?;

        let mut target = self.clone();
        target.install_change_targets(change_set)?;
        target.validate_change_target(change_set)?;
        *self = target;
        Ok(())
    }

    fn validate_change_origins(&self, change_set: &FontChangeSet) -> CoreResult<()> {
        for change in &change_set.changes {
            match change {
                FontChange::Metadata(value) => {
                    value.require_before(self.metadata(), "metadata")?;
                }
                FontChange::LibValue { key, value } => {
                    let current = self.lib().get(key).cloned();
                    value.require_before(&current, "font lib value")?;
                }
                FontChange::Axes(value) => {
                    value.require_before(self.axes(), "axes")?;
                }
                FontChange::AxisMappings(value) => {
                    value.require_before(self.axis_mappings(), "axis mappings")?;
                }
                FontChange::MetricDefinitions(value) => {
                    value.require_before(self.metric_definitions(), "metric definitions")?;
                }
                FontChange::NamedInstances(value) => {
                    value.require_before(self.named_instances(), "named instances")?;
                }
                FontChange::Sources(value) => {
                    let current = self.source_collection();
                    value.require_before(&current, "sources")?;
                }
                FontChange::Glyph(value) => {
                    let glyph_id = value.glyph_id()?;
                    let current = self.glyph(glyph_id).cloned();
                    value.require_before(&current, "glyph")?;
                }
                FontChange::Layer {
                    glyph_id, layer, ..
                } => {
                    let layer_id = layer.layer_id()?;
                    let current = self
                        .glyph(*glyph_id)
                        .and_then(|glyph| glyph.layers().get(&layer_id))
                        .cloned();
                    // A recorded changeset usually holds the very layer the font
                    // holds, so identity settles it without comparing every point.
                    let same_layer = current
                        .as_ref()
                        .zip(layer.before.as_ref())
                        .is_some_and(|(current, before)| Arc::ptr_eq(current, before));
                    if !same_layer {
                        layer.require_before(&current, "glyph layer")?;
                    }
                }
                FontChange::KerningGroup { group_id, group } => {
                    let current = self.kerning().group(*group_id).cloned();
                    group.require_before(&current, "kerning group")?;
                }
                FontChange::KerningValue {
                    source_id,
                    pair,
                    value,
                } => {
                    let current = self.kerning().value(*source_id, pair);
                    value.require_before(&current, "kerning value")?;
                }
            }
        }

        Ok(())
    }

    fn install_change_targets(&mut self, change_set: &FontChangeSet) -> CoreResult<()> {
        // Re-index only the glyphs this change set touches. Rebuilding the whole
        // index hashes every point, contour, and anchor id in the font, and made up
        // most of each undo and redo on a large font. Every touched glyph leaves the
        // index before any data changes and is validated against the rest when it
        // returns, so duplicates are caught exactly as a full rebuild would.
        //
        // Entity ids move by difference: a replaced glyph usually keeps every
        // point, contour, and anchor id, and removing then re-adding thousands
        // of them was most of a large batch's cost.
        let touched_glyph_ids = change_set.touched_glyph_ids();
        let state = self.state_mut();
        let mut before_glyphs = HashMap::new();
        for glyph_id in &touched_glyph_ids {
            if let Some(glyph) = state.data.glyphs.get(glyph_id) {
                state
                    .index
                    .remove(&IndexEntries::records_of_glyph(*glyph_id, glyph));
                before_glyphs.insert(*glyph_id, Arc::clone(glyph));
            }
        }

        for change in &change_set.changes {
            match change {
                FontChange::Metadata(value) => {
                    self.data_mut().metadata = value.after.clone();
                }
                FontChange::LibValue { key, value } => match &value.after {
                    Some(value) => self.lib_mut().set(key.clone(), value.clone()),
                    None => {
                        self.lib_mut().remove(key);
                    }
                },
                FontChange::Axes(value) => self.data_mut().axes = value.after.clone(),
                FontChange::AxisMappings(value) => {
                    self.data_mut().axis_mappings = value.after.clone();
                }
                FontChange::MetricDefinitions(value) => {
                    self.data_mut().metric_definitions = value.after.clone();
                }
                FontChange::NamedInstances(value) => {
                    self.data_mut().named_instances = value.after.clone();
                }
                FontChange::Sources(value) => {
                    let data = self.data_mut();
                    data.sources = value.after.sources.clone();
                    data.default_source_id = value.after.default_source_id;
                }
                FontChange::KerningGroup { group_id, group } => {
                    self.kerning_mut().put_group(*group_id, group.after.clone());
                }
                FontChange::KerningValue {
                    source_id,
                    pair,
                    value,
                } => match value.after {
                    Some(after) => {
                        self.kerning_mut()
                            .set_value(*source_id, pair.clone(), after);
                    }
                    None => {
                        self.kerning_mut().remove_value(*source_id, pair);
                    }
                },
                FontChange::Glyph(_) | FontChange::Layer { .. } => {}
            }
        }

        for change in &change_set.changes {
            let FontChange::Layer {
                glyph_id, layer, ..
            } = change
            else {
                continue;
            };
            if layer.before.is_some() && layer.after.is_none() {
                let layer_id = layer.layer_id()?;
                let glyph = self.data_mut().glyphs.get_mut(glyph_id).require(glyph_id)?;
                Arc::make_mut(glyph).remove_layer(layer_id);
            }
        }

        for change in &change_set.changes {
            let FontChange::Glyph(value) = change else {
                continue;
            };
            if value.before.is_some() && value.after.is_none() {
                let glyph_id = value.glyph_id()?;
                let glyphs = &mut self.data_mut().glyphs;
                let tail_id = glyphs
                    .len()
                    .checked_sub(1)
                    .and_then(|index| glyphs.get_index(index))
                    .map(|(id, _)| id);
                if tail_id.as_ref() != Some(&glyph_id) {
                    return Err(CoreError::GlyphNotAtTail(glyph_id));
                }
                glyphs.shift_remove(&glyph_id);
            }
        }

        for change in &change_set.changes {
            let FontChange::Glyph(value) = change else {
                continue;
            };
            if let Some(glyph) = &value.after {
                self.data_mut().glyphs.insert(Arc::new(glyph.clone()));
            }
        }

        for change in &change_set.changes {
            let FontChange::Layer {
                glyph_id, layer, ..
            } = change
            else {
                continue;
            };
            let Some(layer) = &layer.after else {
                continue;
            };
            let glyph = self.data_mut().glyphs.get_mut(glyph_id).require(glyph_id)?;
            Arc::make_mut(glyph).set_layer(Arc::clone(layer));
        }

        let FontState { data, index } = self.state_mut();
        index.return_glyphs(&touched_glyph_ids, &before_glyphs, &data.glyphs)
    }

    fn validate_change_target(&self, change_set: &FontChangeSet) -> CoreResult<()> {
        let mut axis_ids = HashSet::new();
        let mut axis_tags = HashSet::new();
        for axis in self.axes() {
            axis.validate()?;
            if !axis_ids.insert(axis.id()) {
                return Err(CoreError::RepeatedAxisId(axis.id()));
            }
            if !axis_tags.insert(axis.tag()) {
                return Err(CoreError::DuplicateAxisTag(axis.tag().to_string()));
            }
        }
        validate_axis_label_ids(self.axes())?;
        validate_axis_mappings(self.axes(), self.axis_mappings())?;
        validate_metric_definitions(self.metric_definitions())?;
        validate_named_instances(self.named_instances(), self.axes())?;

        let mut source_ids = HashSet::new();
        for source in self.sources() {
            if !source_ids.insert(source.id()) {
                return Err(CoreError::DuplicateSourceId(source.id()));
            }
            validate_source_values(source, self.axes(), self.metric_definitions())?;
        }

        match self.default_source_id() {
            Some(source_id) => {
                let source = self.require_source(source_id)?;
                if !source.is_master() {
                    return Err(CoreError::DefaultSourceNotMaster);
                }
            }
            None if !self.sources().is_empty() => {
                return Err(CoreError::MissingDefaultSource);
            }
            None => {}
        }

        self.require_layer_sources_after(change_set)
    }

    /// Requires every layer's source to exist after `change_set`.
    ///
    /// Untouched glyphs were valid before, so only the touched glyphs are
    /// checked unless the change set replaces the sources.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::SourceNotFound`] for the first layer whose source
    /// is missing.
    fn require_layer_sources_after(&self, change_set: &FontChangeSet) -> CoreResult<()> {
        if change_set.replaces_sources() {
            return self
                .glyphs()
                .try_for_each(|glyph| self.require_layer_sources(glyph));
        }
        change_set
            .touched_glyph_ids()
            .iter()
            .filter_map(|glyph_id| self.glyph(*glyph_id))
            .try_for_each(|glyph| self.require_layer_sources(glyph))
    }

    fn require_layer_sources(&self, glyph: &Glyph) -> CoreResult<()> {
        for layer in glyph.layers().values() {
            self.require_source(layer.source_id())?;
        }
        Ok(())
    }

    fn source_collection(&self) -> SourceCollection {
        SourceCollection {
            sources: self.sources().to_vec(),
            default_source_id: self.default_source_id(),
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::{
        AddComponent, AddContour, AddPoints, ApplyBooleanOp, BooleanOp, Contour, CreateGlyph,
        CreateGlyphLayer, DecomposeComponents, DeleteAxis, EntityChange, FontEntityChange,
        FontIntent, FontIntentSet, PointSeed, PointType, RemoveComponents, RemovePoints,
        Replacement, UpdateFontMetadata,
    };

    use super::*;

    fn assert_index_matches_rebuild(font: &Font) {
        let rebuilt = FontIndex::from_glyphs(&font.state.data.glyphs).unwrap();
        assert_eq!(font.state.index, rebuilt);
    }

    /// A closed 100-unit square on `A_regular`.
    fn square(id: &str, x: f64) -> (ContourId, Vec<FontIntent>) {
        let layer_id = LayerId::from_raw("A_regular");
        let contour_id = ContourId::from_raw(id);
        let points = [(x, 0.0), (x + 100.0, 0.0), (x + 100.0, 100.0), (x, 100.0)]
            .into_iter()
            .enumerate()
            .map(|(index, (x, y))| PointSeed {
                id: PointId::from_raw(format!("{id}_{index}")),
                x,
                y,
                point_type: PointType::OnCurve,
                smooth: false,
            })
            .collect();
        let intents = vec![
            AddContour {
                layer_id,
                contour_id: contour_id.clone(),
                closed: true,
            }
            .into(),
            AddPoints {
                layer_id,
                contour_id: Some(contour_id.clone()),
                before: None,
                points,
            }
            .into(),
        ];
        (contour_id, intents)
    }

    #[test]
    fn structural_intents_index_exactly_as_a_full_rebuild() {
        let mut font = crate::test_support::sample_font();
        let layer_id = LayerId::from_raw("A_regular");
        let (left, mut squares) = square("left", 0.0);
        let (right, right_square) = square("right", 50.0);
        squares.extend(right_square);
        let steps: Vec<Vec<FontIntent>> = vec![
            squares,
            vec![
                AddComponent {
                    layer_id,
                    component_id: ComponentId::from_raw("added"),
                    base_glyph_id: GlyphId::from_raw("acute"),
                }
                .into(),
            ],
            vec![
                RemoveComponents {
                    layer_id,
                    component_ids: vec![ComponentId::from_raw("z_first")],
                }
                .into(),
            ],
            vec![
                DecomposeComponents {
                    layer_id,
                    component_ids: vec![ComponentId::from_raw("a_second")],
                }
                .into(),
            ],
            vec![
                ApplyBooleanOp {
                    layer_id,
                    contour_id_a: left,
                    contour_id_b: right,
                    operation: BooleanOp::Union,
                }
                .into(),
            ],
            // Removing every point of a contour removes the contour too.
            vec![
                RemovePoints {
                    layer_id,
                    point_ids: ["A_0", "A_1", "A_2"].map(PointId::from_raw).to_vec(),
                }
                .into(),
            ],
        ];

        for intents in steps {
            let applied = font.apply_intents(&intents.into_iter().collect()).unwrap();
            assert_index_matches_rebuild(&font);

            let mut undone = font.clone();
            undone
                .apply_change_set(&applied.changes.inverted())
                .unwrap();
            assert_index_matches_rebuild(&undone);
        }
    }

    #[test]
    fn touched_glyphs_index_exactly_as_a_full_rebuild() {
        let original = crate::test_support::sample_font();
        let glyphs = original.glyphs().take(2).cloned().collect::<Vec<_>>();
        let [first, second] = glyphs.as_slice() else {
            panic!("sample font needs two glyphs");
        };

        // Swap the two glyphs' names and give both the first one's code points, so
        // a step-by-step index would see a duplicate name and must keep glyph order.
        let mut renamed_first = first.clone();
        renamed_first.set_name(second.glyph_name().clone());
        let mut renamed_second = second.clone();
        renamed_second.set_name(first.glyph_name().clone());
        renamed_second.set_unicodes(first.unicodes().to_vec());
        let layer = Arc::clone(first.layers().values().next().unwrap());
        let mut moved_layer = (*layer).clone();
        moved_layer.set_width(moved_layer.width() + 10.0);
        renamed_first.set_layer(moved_layer.clone());

        let changes = FontChangeSet::new(vec![
            FontChange::Glyph(Box::new(Replacement::new(
                Some(second.clone()),
                Some(renamed_second),
            ))),
            FontChange::Glyph(Box::new(Replacement::new(
                Some(first.clone()),
                Some(renamed_first),
            ))),
            FontChange::Layer {
                glyph_id: first.id(),
                layer: Replacement::new(Some(layer), Some(Arc::new(moved_layer))),
                structural: false,
            },
        ]);

        let mut font = original.clone();
        font.apply_change_set(&changes).unwrap();
        assert_index_matches_rebuild(&font);

        font.apply_change_set(&changes.inverted()).unwrap();
        assert_index_matches_rebuild(&font);
        assert_eq!(font, original);
    }

    #[test]
    fn applying_an_inverse_and_original_changeset_roundtrips_coupled_state() {
        let original = crate::test_support::sample_font();
        let axis_id = original.axes()[0].id();
        let mut font = original.clone();
        let outcome = font
            .apply_intents(&FontIntentSet::from(DeleteAxis { axis_id }))
            .unwrap();
        let edited = font.clone();

        font.apply_change_set(&outcome.changes.inverted()).unwrap();
        assert_eq!(font, original);

        font.apply_change_set(&outcome.changes).unwrap();
        assert_eq!(font, edited);
    }

    /// Edits a copy of one layer.
    type LayerEdit<'a> = &'a dyn Fn(&mut GlyphLayer);

    /// A changeset replacing each named layer with what its edit makes of it.
    fn layer_edits(font: &Font, edits: &[(&str, LayerEdit<'_>)]) -> FontChangeSet {
        FontChangeSet::new(
            edits
                .iter()
                .map(|(layer_id, edit)| {
                    let layer_id = LayerId::from_raw(*layer_id);
                    let glyph_id = font.glyph_id_by_layer(layer_id).unwrap();
                    let before = font.layer_snapshot(layer_id).unwrap();
                    let mut after = (*before).clone();
                    edit(&mut after);
                    FontChange::Layer {
                        glyph_id,
                        layer: Replacement::new(Some(before), Some(Arc::new(after))),
                        structural: true,
                    }
                })
                .collect(),
        )
    }

    fn single_point_contour(contour_id: &str, point_id: &str) -> Contour {
        let mut contour = Contour::with_id(ContourId::from_raw(contour_id));
        contour.push_point(crate::Point::new(
            PointId::from_raw(point_id),
            0.0,
            0.0,
            PointType::OnCurve,
            false,
        ));
        contour
    }

    #[test]
    fn changesets_reject_an_id_an_untouched_glyph_holds() {
        let mut font = crate::test_support::sample_font();
        let original = font.clone();
        // `A_0` belongs to `A`, which this changeset leaves alone.
        let changes = layer_edits(
            &font,
            &[("acute_regular", &|layer| {
                layer.add_contour(single_point_contour("acute_new", "A_0"));
            })],
        );

        assert!(matches!(
            font.apply_change_set(&changes),
            Err(CoreError::DuplicatePointId(_))
        ));
        assert_eq!(font, original);
        assert_index_matches_rebuild(&font);
    }

    #[test]
    fn changesets_reject_two_touched_glyphs_claiming_one_new_id() {
        let mut font = crate::test_support::sample_font();
        let original = font.clone();
        let changes = layer_edits(
            &font,
            &[
                ("acute_regular", &|layer| {
                    layer.add_contour(single_point_contour("acute_new", "shared"));
                }),
                ("A_bold", &|layer| {
                    layer.add_contour(single_point_contour("A_new", "shared"));
                }),
            ],
        );

        assert!(matches!(
            font.apply_change_set(&changes),
            Err(CoreError::DuplicatePointId(_))
        ));
        assert_eq!(font, original);
    }

    #[test]
    fn changesets_move_ids_between_touched_glyphs_as_a_full_rebuild_would() {
        let mut font = crate::test_support::sample_font();
        let outer = font
            .layer(LayerId::from_raw("A_regular"))
            .unwrap()
            .contour(&ContourId::from_raw("A_outer"))
            .unwrap()
            .clone();
        let changes = layer_edits(
            &font,
            &[
                ("A_regular", &|layer| {
                    layer.remove_contour(&ContourId::from_raw("A_outer"));
                }),
                ("acute_regular", &|layer| {
                    layer.add_contour(outer.clone());
                }),
            ],
        );

        font.apply_change_set(&changes).unwrap();
        assert_index_matches_rebuild(&font);
        font.apply_change_set(&changes.inverted()).unwrap();
        assert_index_matches_rebuild(&font);
    }

    #[test]
    fn stale_original_rejects_the_complete_changeset_without_mutation() {
        let mut source = crate::test_support::sample_font();
        let mut edited = source.clone();
        let mut metadata = edited.metadata().clone();
        metadata.family_name = Some("Edited".to_string());
        let changes = edited
            .apply_intents(&FontIntentSet::from(UpdateFontMetadata { metadata }))
            .unwrap()
            .changes;

        source.metadata_mut().family_name = Some("Concurrent".to_string());
        let concurrent = source.clone();
        source.apply_change_set(&changes).unwrap_err();
        assert_eq!(source, concurrent);
    }

    #[test]
    fn incomplete_axis_replacement_rejects_invalid_coupled_state_atomically() {
        let mut font = crate::test_support::sample_font();
        let original = font.clone();
        let mut axes = font.axes().to_vec();
        axes.remove(0);
        let changes = FontChangeSet::from(FontChange::Axes(Replacement::new(
            font.axes().to_vec(),
            axes,
        )));

        font.apply_change_set(&changes).unwrap_err();
        assert_eq!(font, original);
    }

    #[test]
    fn glyph_creation_owns_its_new_layers_during_inversion() {
        let mut font = crate::test_support::sample_font();
        let source_id = font.default_source_id().unwrap();
        let glyph_id = GlyphId::from_raw("created");
        let layer_id = LayerId::from_raw("created_regular");
        let original = font.clone();
        let outcome = font
            .apply_intents(&FontIntentSet {
                intents: vec![
                    CreateGlyph {
                        glyph_id: Some(glyph_id),
                        name: "created".to_string(),
                        unicodes: vec![0x63],
                    }
                    .into(),
                    CreateGlyphLayer {
                        layer_id,
                        glyph_id,
                        source_id,
                    }
                    .into(),
                ],
            })
            .unwrap();
        assert_eq!(
            outcome
                .changes
                .changes
                .iter()
                .filter(|change| matches!(change, FontChange::Layer { .. }))
                .count(),
            0
        );
        assert!(
            outcome
                .changes
                .entity_changes()
                .iter()
                .any(|change| matches!(
                    change,
                    FontEntityChange::Layer {
                        change: EntityChange::Created(layer),
                        ..
                    } if layer.id() == layer_id
                ))
        );
        let edited = font.clone();

        font.apply_change_set(&outcome.changes.inverted()).unwrap();
        assert_eq!(font, original);
        font.apply_change_set(&outcome.changes).unwrap();
        assert_eq!(font, edited);
    }
}
