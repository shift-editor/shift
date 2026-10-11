use std::collections::HashSet;
use std::sync::Arc;

use crate::{FontChange, FontChangeSet, Replacement, Require, SourceCollection};

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
        target.validate_change_target()?;
        *self = target;
        Ok(())
    }

    fn validate_change_origins(&self, change_set: &FontChangeSet) -> CoreResult<()> {
        for change in &change_set.changes {
            match change {
                FontChange::Metadata(value) => {
                    require_original(self.metadata(), &value.before, "metadata")?;
                }
                FontChange::LibValue { key, value } => {
                    let current = self.lib().get(key).cloned();
                    require_original(&current, &value.before, "font lib value")?;
                }
                FontChange::Axes(value) => {
                    require_original(self.axes(), value.before.as_slice(), "axes")?;
                }
                FontChange::AxisMappings(value) => {
                    require_original(
                        self.axis_mappings(),
                        value.before.as_slice(),
                        "axis mappings",
                    )?;
                }
                FontChange::MetricDefinitions(value) => {
                    require_original(
                        self.metric_definitions(),
                        value.before.as_slice(),
                        "metric definitions",
                    )?;
                }
                FontChange::NamedInstances(value) => {
                    require_original(
                        self.named_instances(),
                        value.before.as_slice(),
                        "named instances",
                    )?;
                }
                FontChange::Sources(value) => {
                    let current = self.source_collection();
                    require_original(&current, &value.before, "sources")?;
                }
                FontChange::Glyph(value) => {
                    let glyph_id = replacement_glyph_id(value)?;
                    let current = self.glyph(&glyph_id).cloned();
                    require_original(&current, &value.before, "glyph")?;
                }
                FontChange::Layer {
                    glyph_id, layer, ..
                } => {
                    let layer_id = replacement_layer_id(layer)?;
                    let current = self
                        .glyph(glyph_id)
                        .and_then(|glyph| glyph.layers().get(&layer_id))
                        .cloned();
                    require_original(&current, &layer.before, "glyph layer")?;
                }
                FontChange::KerningGroup { group_id, group } => {
                    let current = self.kerning().group(group_id).cloned();
                    require_original(&current, &group.before, "kerning group")?;
                }
                FontChange::KerningValue {
                    source_id,
                    pair,
                    value,
                } => {
                    let current = self.kerning().value(source_id, pair);
                    require_original(&current, &value.before, "kerning value")?;
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
        let touched_glyph_ids = touched_glyph_ids(change_set);
        let state = self.state_mut();
        for glyph_id in &touched_glyph_ids {
            if let Some(glyph) = state.data.glyphs.get(glyph_id) {
                state.index.remove_glyph(glyph_id.clone(), glyph);
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
                    data.default_source_id = value.after.default_source_id.clone();
                }
                FontChange::KerningGroup { group_id, group } => {
                    self.kerning_mut().put_group(group_id, group.after.clone());
                }
                FontChange::KerningValue {
                    source_id,
                    pair,
                    value,
                } => match value.after {
                    Some(after) => {
                        self.kerning_mut()
                            .set_value(source_id.clone(), pair.clone(), after);
                    }
                    None => {
                        self.kerning_mut().remove_value(source_id, pair);
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
                let layer_id = replacement_layer_id(layer)?;
                let glyph = self.data_mut().glyphs.get_mut(glyph_id).require(glyph_id)?;
                Arc::make_mut(glyph).remove_layer(layer_id);
            }
        }

        for change in &change_set.changes {
            let FontChange::Glyph(value) = change else {
                continue;
            };
            if value.before.is_some() && value.after.is_none() {
                let glyph_id = replacement_glyph_id(value)?;
                let glyphs = &mut self.data_mut().glyphs;
                let tail_id = glyphs
                    .len()
                    .checked_sub(1)
                    .and_then(|index| glyphs.get_index(index))
                    .map(|(id, _)| id);
                if tail_id != Some(&glyph_id) {
                    return Err(CoreError::InvalidEntityOrder {
                        kind: "glyph",
                        message: format!("identity {glyph_id} is not the directory tail"),
                    });
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
            Arc::make_mut(glyph).set_layer(layer.clone());
        }

        let state = self.state_mut();
        let mut touched_unicodes = HashSet::new();
        for glyph_id in &touched_glyph_ids {
            let Some(glyph) = state.data.glyphs.get(glyph_id) else {
                continue;
            };
            state.index.validate_glyph_insert(glyph_id.clone(), glyph)?;
            state.index.insert_glyph(glyph_id.clone(), glyph);
            touched_unicodes.extend(glyph.unicodes().iter().copied());
        }
        // A full rebuild lists glyphs sharing a code point in glyph order; keep that.
        for unicode in touched_unicodes {
            if let Some(glyph_ids) = state.index.glyphs_by_unicode.get_mut(&unicode) {
                glyph_ids.sort_by_key(|glyph_id| state.data.glyphs.index_of(glyph_id));
            }
        }
        Ok(())
    }

    fn validate_change_target(&self) -> CoreResult<()> {
        let mut axis_ids = HashSet::new();
        let mut axis_tags = HashSet::new();
        for axis in self.axes() {
            axis.validate()?;
            if !axis_ids.insert(axis.id()) {
                return Err(CoreError::InvalidEntityOrder {
                    kind: "axis",
                    message: format!("identity {} is repeated", axis.id()),
                });
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
                let source = self.require_source(&source_id)?;
                if !source.is_master() {
                    return Err(CoreError::InvalidEntityOrder {
                        kind: "source",
                        message: "default identity must name a master".to_string(),
                    });
                }
            }
            None if !self.sources().is_empty() => {
                return Err(CoreError::InvalidEntityOrder {
                    kind: "source",
                    message: "non-empty source collection has no default identity".to_string(),
                });
            }
            None => {}
        }

        for glyph in self.glyphs() {
            for layer in glyph.layers().values() {
                let source_id = layer.source_id();
                self.require_source(&source_id)?;
            }
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

fn replacement_glyph_id(value: &Replacement<Option<Glyph>>) -> CoreResult<GlyphId> {
    let before_id = value.before.as_ref().map(Glyph::id);
    let after_id = value.after.as_ref().map(Glyph::id);
    match (before_id, after_id) {
        (Some(before), Some(after)) if before != after => Err(CoreError::InvalidEntityOrder {
            kind: "changeset",
            message: format!("glyph identity changes from {before} to {after}"),
        }),
        (Some(id), _) | (_, Some(id)) => Ok(id),
        (None, None) => Err(CoreError::InvalidEntityOrder {
            kind: "changeset",
            message: "glyph replacement has no value on either side".to_string(),
        }),
    }
}

fn replacement_layer_id(value: &Replacement<Option<Arc<GlyphLayer>>>) -> CoreResult<LayerId> {
    let before_id = value.before.as_ref().map(|layer| layer.id());
    let after_id = value.after.as_ref().map(|layer| layer.id());
    match (before_id, after_id) {
        (Some(before), Some(after)) if before != after => Err(CoreError::InvalidEntityOrder {
            kind: "changeset",
            message: format!("layer identity changes from {before} to {after}"),
        }),
        (Some(id), _) | (_, Some(id)) => Ok(id),
        (None, None) => Err(CoreError::InvalidEntityOrder {
            kind: "changeset",
            message: "layer replacement has no value on either side".to_string(),
        }),
    }
}

fn require_original<T>(current: &T, expected: &T, target: &'static str) -> CoreResult<()>
where
    T: PartialEq + ?Sized,
{
    if current == expected {
        return Ok(());
    }

    Err(CoreError::InvalidEntityOrder {
        kind: "changeset",
        message: format!("current {target} does not match its expected original value"),
    })
}

/// Glyphs whose own record or any layer `change_set` replaces, in first-touched order.
fn touched_glyph_ids(change_set: &FontChangeSet) -> Vec<GlyphId> {
    let mut seen = HashSet::new();
    change_set
        .changes
        .iter()
        .flat_map(|change| match change {
            FontChange::Glyph(value) => [value.before.as_ref(), value.after.as_ref()]
                .into_iter()
                .flatten()
                .map(Glyph::id)
                .collect::<Vec<_>>(),
            FontChange::Layer { glyph_id, .. } => vec![glyph_id.clone()],
            _ => Vec::new(),
        })
        .filter(|glyph_id| seen.insert(glyph_id.clone()))
        .collect()
}

#[cfg(test)]
mod tests {
    use crate::{EntityChange, FontEntityChange, FontIntent, FontIntentSet};

    use super::*;

    fn assert_index_matches_rebuild(font: &Font) {
        let rebuilt = FontIndex::from_glyphs(&font.state.data.glyphs).unwrap();
        let index = &font.state.index;
        assert_eq!(index.glyph_by_name, rebuilt.glyph_by_name);
        assert_eq!(index.layer_owner, rebuilt.layer_owner);
        assert_eq!(index.layer_by_glyph_source, rebuilt.layer_by_glyph_source);
        assert_eq!(index.glyphs_by_unicode, rebuilt.glyphs_by_unicode);
        assert_eq!(index.entity_ids, rebuilt.entity_ids);
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
        let layer = first.layers().values().next().unwrap().clone();
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
            .apply_intents(FontIntentSet {
                intents: vec![FontIntent::DeleteAxis { axis_id }],
            })
            .unwrap();
        let edited = font.clone();

        font.apply_change_set(&outcome.changes.inverted()).unwrap();
        assert_eq!(font, original);

        font.apply_change_set(&outcome.changes).unwrap();
        assert_eq!(font, edited);
    }

    #[test]
    fn stale_original_rejects_the_complete_changeset_without_mutation() {
        let mut source = crate::test_support::sample_font();
        let mut edited = source.clone();
        let mut metadata = edited.metadata().clone();
        metadata.family_name = Some("Edited".to_string());
        let changes = edited
            .apply_intents(FontIntentSet {
                intents: vec![FontIntent::UpdateFontMetadata { metadata }],
            })
            .unwrap()
            .changes;

        source.metadata_mut().family_name = Some("Concurrent".to_string());
        let concurrent = source.clone();
        assert!(source.apply_change_set(&changes).is_err());
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

        assert!(font.apply_change_set(&changes).is_err());
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
            .apply_intents(FontIntentSet {
                intents: vec![
                    FontIntent::CreateGlyph {
                        glyph_id: Some(glyph_id.clone()),
                        name: "created".to_string(),
                        unicodes: vec![0x63],
                    },
                    FontIntent::CreateGlyphLayer {
                        layer_id: layer_id.clone(),
                        glyph_id: glyph_id.clone(),
                        source_id,
                    },
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
        assert!(outcome
            .changes
            .entity_changes()
            .iter()
            .any(|change| matches!(
                change,
                FontEntityChange::Layer {
                    change: EntityChange::Created(layer),
                    ..
                } if layer.id() == layer_id
            )));
        let edited = font.clone();

        font.apply_change_set(&outcome.changes.inverted()).unwrap();
        assert_eq!(font, original);
        font.apply_change_set(&outcome.changes).unwrap();
        assert_eq!(font, edited);
    }
}
