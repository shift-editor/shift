use indexmap::IndexSet;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use bitflags::bitflags;

use crate::collection::Identified;
use crate::error::{CoreError, CoreResult, EntityKind};

use crate::{
    Axis, AxisMapping, Component, FontMetadata, Glyph, GlyphId, GlyphLayer, KerningGroup,
    KerningGroupId, KerningPair, LANGUAGES_LIB_KEY, LayerId, LibValue, MetricDefinition,
    NamedInstance, Source, SourceId, TouchedLayer,
};

bitflags! {
    /// Domain projections invalidated by a font change.
    #[derive(Clone, Copy, Debug, Default, Eq, Hash, PartialEq)]
    pub struct FontChangeImpact: u16 {
        const METADATA = 1 << 0;
        const LANGUAGES = 1 << 1;
        const GLYPHS = 1 << 2;
        const AXES = 1 << 3;
        const AXIS_MAPPINGS = 1 << 4;
        const AXIS_MAPPING_BASES = 1 << 5;
        const METRIC_DEFINITIONS = 1 << 6;
        const SOURCE_METRICS = 1 << 7;
        const NAMED_INSTANCES = 1 << 8;
        const SOURCES = 1 << 9;
        /// Kerning values or the sources, axes, and mappings its
        /// interpolation basis is built from.
        const KERNING = 1 << 10;
    }
}

/// Original and replacement values for one authored scope.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Replacement<T> {
    pub before: T,
    pub after: T,
}

impl<T> Replacement<Option<T>> {
    /// The values this replacement holds, before then after.
    pub fn sides(&self) -> impl Iterator<Item = &T> {
        self.before.iter().chain(&self.after)
    }

    /// Whether this replacement creates its value.
    pub fn creates(&self) -> bool {
        self.before.is_none() && self.after.is_some()
    }
}

impl<T> Replacement<T> {
    pub fn new(before: T, after: T) -> Self {
        Self { before, after }
    }

    /// Checks that `current` still equals the original value, so the
    /// replacement applies to the state it was recorded against.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::ChangeOriginMismatch`] naming `target` when it differs.
    pub fn require_before<C>(&self, current: &C, target: &'static str) -> CoreResult<()>
    where
        C: PartialEq<T> + ?Sized,
    {
        if current == &self.before {
            return Ok(());
        }

        Err(CoreError::ChangeOriginMismatch { target })
    }
}

impl Replacement<Option<Glyph>> {
    /// The glyph this replacement creates, replaces, or deletes.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::ReplacementIdentityChanged`] when the two sides
    /// name different glyphs and [`CoreError::EmptyReplacement`] when neither
    /// side has a glyph.
    pub fn glyph_id(&self) -> CoreResult<GlyphId> {
        same_identity(
            EntityKind::Glyph,
            self.before.as_ref().map(Glyph::id),
            self.after.as_ref().map(Glyph::id),
        )
    }

    /// The layers this replacement writes: every layer of a new glyph, and
    /// the layers of a replaced glyph that differ from what it had.
    pub fn changed_layers(&self) -> impl Iterator<Item = &GlyphLayer> {
        self.after.iter().flat_map(move |glyph| {
            glyph
                .layers()
                .iter()
                .filter(move |(layer_id, layer)| {
                    self.before
                        .as_ref()
                        .and_then(|before| before.layers().get(*layer_id))
                        .is_none_or(|before| before != *layer)
                })
                .map(|(_, layer)| layer.as_ref())
        })
    }
}

impl Replacement<Option<Arc<GlyphLayer>>> {
    /// The layer this replacement creates, replaces, or deletes.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::ReplacementIdentityChanged`] when the two sides
    /// name different layers and [`CoreError::EmptyReplacement`] when neither
    /// side has a layer.
    pub fn layer_id(&self) -> CoreResult<LayerId> {
        same_identity(
            EntityKind::Layer,
            self.before.as_deref().map(GlyphLayer::id),
            self.after.as_deref().map(GlyphLayer::id),
        )
    }

    /// Whether this replacement changes what its glyph's record lists: the
    /// glyph's layers and the glyphs its components reference.
    fn changes_glyph_record(&self) -> bool {
        match (&self.before, &self.after) {
            (Some(before), Some(after)) => !before
                .components_iter()
                .map(Component::base_glyph_id)
                .eq(after.components_iter().map(Component::base_glyph_id)),
            _ => true,
        }
    }
}

/// The one identity both sides of a replacement share.
fn same_identity<Id>(kind: EntityKind, before: Option<Id>, after: Option<Id>) -> CoreResult<Id>
where
    Id: PartialEq + std::fmt::Display,
{
    match (before, after) {
        (Some(before), Some(after)) if before != after => {
            Err(CoreError::ReplacementIdentityChanged {
                kind,
                before: before.to_string(),
                after: after.to_string(),
            })
        }
        (Some(id), _) | (_, Some(id)) => Ok(id),
        (None, None) => Err(CoreError::EmptyReplacement { kind }),
    }
}

impl<T> Replacement<Vec<T>>
where
    T: Identified + PartialEq,
{
    /// The entities this replacement creates, updates, and deletes; reordering alone is not a change.
    pub fn entity_changes(&self) -> impl Iterator<Item = EntityChange<'_, T>> {
        collection_entity_changes(&self.before, &self.after, Identified::id).into_iter()
    }
}

impl Replacement<SourceCollection> {
    /// The sources this replacement creates, updates, and deletes.
    pub fn entity_changes(&self) -> impl Iterator<Item = EntityChange<'_, Source>> {
        collection_entity_changes(&self.before.sources, &self.after.sources, Source::id).into_iter()
    }
}

/// Ordered sources and the identity of their authored default.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SourceCollection {
    pub sources: Vec<Source>,
    pub default_source_id: Option<SourceId>,
}

/// One entity's lifecycle within a reversible replacement.
#[derive(Debug, PartialEq)]
pub enum EntityChange<'a, T> {
    Created(&'a T),
    Updated { before: &'a T, after: &'a T },
    Deleted(&'a T),
}

/// Typed entity lifecycle derived from a font changeset.
#[derive(Debug, PartialEq)]
pub enum FontEntityChange<'a> {
    Axis(EntityChange<'a, Axis>),
    AxisMapping(EntityChange<'a, AxisMapping>),
    MetricDefinition(EntityChange<'a, MetricDefinition>),
    NamedInstance(EntityChange<'a, NamedInstance>),
    Source(EntityChange<'a, Source>),
    Glyph(EntityChange<'a, Glyph>),
    Layer {
        glyph_id: GlyphId,
        change: EntityChange<'a, GlyphLayer>,
    },
}

/// One reversible replacement within a font changeset.
///
/// Collection variants retain authored order. A changeset installs every
/// replacement as one target, so references between variants are never
/// validated in an intermediate state.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum FontChange {
    Metadata(Box<Replacement<FontMetadata>>),
    LibValue {
        key: String,
        value: Replacement<Option<LibValue>>,
    },
    Axes(Replacement<Vec<Axis>>),
    AxisMappings(Replacement<Vec<AxisMapping>>),
    MetricDefinitions(Replacement<Vec<MetricDefinition>>),
    NamedInstances(Replacement<Vec<NamedInstance>>),
    Sources(Replacement<SourceCollection>),
    Glyph(Box<Replacement<Option<Glyph>>>),
    Layer {
        glyph_id: GlyphId,
        layer: Replacement<Option<Arc<GlyphLayer>>>,
        structural: bool,
    },
    /// One kerning group's whole state; `None` is no group with that id.
    KerningGroup {
        group_id: KerningGroupId,
        group: Replacement<Option<KerningGroup>>,
    },
    /// One pair's value at one source; `None` is no value.
    KerningValue {
        source_id: SourceId,
        pair: KerningPair,
        value: Replacement<Option<f64>>,
    },
}

impl FontChange {
    /// The glyphs whose record or layer this change replaces.
    pub fn glyph_ids(&self) -> impl Iterator<Item = GlyphId> + '_ {
        let replaced = match self {
            Self::Glyph(value) => Some(value.sides().map(Glyph::id)),
            _ => None,
        };
        let owner = match self {
            Self::Layer { glyph_id, .. } => Some(glyph_id.clone()),
            _ => None,
        };
        replaced.into_iter().flatten().chain(owner)
    }

    /// The layers this change leaves behind; a created glyph's layers are
    /// structural.
    pub fn touched_layers(&self) -> impl Iterator<Item = TouchedLayer> + '_ {
        let replaced = match self {
            Self::Layer {
                layer, structural, ..
            } => layer
                .after
                .as_ref()
                .map(|layer| TouchedLayer::new(layer, *structural)),
            _ => None,
        };
        let created = match self {
            Self::Glyph(value) if value.creates() => value.after.as_ref(),
            _ => None,
        };
        replaced.into_iter().chain(
            created
                .into_iter()
                .flat_map(|glyph| glyph.layers().values())
                .map(|layer| TouchedLayer::new(layer, true)),
        )
    }

    /// The layers this change writes: a replaced layer, or the changed
    /// layers of a replaced glyph.
    pub fn written_layers(&self) -> impl Iterator<Item = &GlyphLayer> + '_ {
        let replaced = match self {
            Self::Glyph(value) => Some(value.changed_layers()),
            _ => None,
        };
        let layer = match self {
            Self::Layer { layer, .. } => layer.after.as_deref(),
            _ => None,
        };
        replaced.into_iter().flatten().chain(layer)
    }

    /// Whether this change can take layers out of the font: replacing a
    /// glyph or the sources, or removing a layer.
    pub fn can_remove_layers(&self) -> bool {
        match self {
            Self::Glyph(_) | Self::Sources(_) => true,
            Self::Layer { layer, .. } => layer.after.is_none(),
            _ => false,
        }
    }

    /// Returns every domain projection invalidated by this replacement.
    pub fn impact(&self) -> FontChangeImpact {
        match self {
            Self::Metadata(_) => FontChangeImpact::METADATA,
            Self::LibValue { key, .. } if key == LANGUAGES_LIB_KEY => FontChangeImpact::LANGUAGES,
            Self::Axes(_) => {
                FontChangeImpact::AXES
                    | FontChangeImpact::SOURCES
                    | FontChangeImpact::AXIS_MAPPING_BASES
                    | FontChangeImpact::SOURCE_METRICS
                    | FontChangeImpact::KERNING
            }
            Self::AxisMappings(_) => {
                FontChangeImpact::AXIS_MAPPINGS
                    | FontChangeImpact::AXIS_MAPPING_BASES
                    | FontChangeImpact::SOURCE_METRICS
                    | FontChangeImpact::KERNING
            }
            Self::MetricDefinitions(_) => {
                FontChangeImpact::METRIC_DEFINITIONS | FontChangeImpact::SOURCE_METRICS
            }
            Self::NamedInstances(_) => FontChangeImpact::NAMED_INSTANCES,
            Self::Sources(_) => {
                FontChangeImpact::SOURCES
                    | FontChangeImpact::SOURCE_METRICS
                    | FontChangeImpact::KERNING
            }
            Self::Glyph(_) => FontChangeImpact::GLYPHS,
            Self::Layer { layer, .. } if layer.changes_glyph_record() => FontChangeImpact::GLYPHS,
            Self::KerningGroup { .. } | Self::KerningValue { .. } => FontChangeImpact::KERNING,
            Self::LibValue { .. } | Self::Layer { .. } => FontChangeImpact::empty(),
        }
    }

    fn inverted(&self) -> Self {
        match self {
            Self::Metadata(value) => Self::Metadata(Box::new(Replacement::new(
                value.after.clone(),
                value.before.clone(),
            ))),
            Self::LibValue { key, value } => Self::LibValue {
                key: key.clone(),
                value: Replacement::new(value.after.clone(), value.before.clone()),
            },
            Self::Axes(value) => {
                Self::Axes(Replacement::new(value.after.clone(), value.before.clone()))
            }
            Self::AxisMappings(value) => {
                Self::AxisMappings(Replacement::new(value.after.clone(), value.before.clone()))
            }
            Self::MetricDefinitions(value) => {
                Self::MetricDefinitions(Replacement::new(value.after.clone(), value.before.clone()))
            }
            Self::NamedInstances(value) => {
                Self::NamedInstances(Replacement::new(value.after.clone(), value.before.clone()))
            }
            Self::Sources(value) => {
                Self::Sources(Replacement::new(value.after.clone(), value.before.clone()))
            }
            Self::Glyph(value) => Self::Glyph(Box::new(Replacement::new(
                value.after.clone(),
                value.before.clone(),
            ))),
            Self::Layer {
                glyph_id,
                layer,
                structural,
            } => Self::Layer {
                glyph_id: glyph_id.clone(),
                layer: Replacement::new(layer.after.clone(), layer.before.clone()),
                structural: *structural,
            },
            Self::KerningGroup { group_id, group } => Self::KerningGroup {
                group_id: group_id.clone(),
                group: Replacement::new(group.after.clone(), group.before.clone()),
            },
            Self::KerningValue {
                source_id,
                pair,
                value,
            } => Self::KerningValue {
                source_id: source_id.clone(),
                pair: pair.clone(),
                value: Replacement::new(value.after, value.before),
            },
        }
    }

    /// Returns the layer identity affected by this replacement.
    pub fn layer_id(&self) -> Option<LayerId> {
        match self {
            Self::Layer { layer, .. } => layer
                .before
                .iter()
                .chain(layer.after.iter())
                .next()
                .map(Identified::id),
            _ => None,
        }
    }

    /// Returns the glyph identity affected by this replacement.
    pub fn glyph_id(&self) -> Option<GlyphId> {
        match self {
            Self::Glyph(value) => value
                .before
                .iter()
                .chain(value.after.iter())
                .next()
                .map(Glyph::id),
            Self::Layer { glyph_id, .. } => Some(glyph_id.clone()),
            _ => None,
        }
    }
}

/// Reversible authored replacements produced by one atomic edit.
///
/// Serializable so a process that applied it can hand it to another session
/// over the same font to replay, as undo and redo do for the editor's engine.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct FontChangeSet {
    pub changes: Vec<FontChange>,
}

impl FontChangeSet {
    pub fn new(changes: Vec<FontChange>) -> Self {
        Self { changes }
    }

    pub fn push(&mut self, change: FontChange) {
        self.changes.push(change);
    }

    pub fn is_empty(&self) -> bool {
        self.changes.is_empty()
    }

    /// Returns the glyphs whose own record or any layer this changeset
    /// replaces, in first-touched order.
    pub fn touched_glyph_ids(&self) -> IndexSet<GlyphId> {
        self.changes
            .iter()
            .flat_map(FontChange::glyph_ids)
            .collect()
    }

    /// Every layer this changeset creates, updates or deletes, in change
    /// order: what replaying it, for undo or redo, reads.
    pub fn changed_layer_ids(&self) -> IndexSet<LayerId> {
        self.entity_changes()
            .into_iter()
            .filter_map(|entity| match entity {
                FontEntityChange::Layer { change, .. } => Some(match change {
                    EntityChange::Created(layer) | EntityChange::Deleted(layer) => layer.id(),
                    EntityChange::Updated { after, .. } => after.id(),
                }),
                _ => None,
            })
            .collect()
    }

    /// Glyphs this changeset replaces whole: created, deleted or renamed
    /// with all their layers.
    pub fn replaced_glyph_ids(&self) -> impl Iterator<Item = GlyphId> {
        self.changes.iter().filter_map(|change| match change {
            FontChange::Glyph(glyph) => glyph.sides().next().map(Glyph::id),
            _ => None,
        })
    }

    /// The layers this changeset writes, in change order.
    pub fn written_layers(&self) -> impl Iterator<Item = &GlyphLayer> {
        self.changes.iter().flat_map(FontChange::written_layers)
    }

    /// Whether this changeset can take layers out of the font.
    pub fn can_remove_layers(&self) -> bool {
        self.changes.iter().any(FontChange::can_remove_layers)
    }

    /// Whether this changeset replaces the font's sources.
    pub fn replaces_sources(&self) -> bool {
        self.changes
            .iter()
            .any(|change| matches!(change, FontChange::Sources(_)))
    }

    /// Returns the layers this changeset leaves behind: each replaced layer,
    /// and every layer of a glyph it creates, which counts as structural.
    pub fn touched_layers(&self) -> Vec<TouchedLayer> {
        self.changes
            .iter()
            .flat_map(FontChange::touched_layers)
            .collect()
    }

    /// Returns the union of domain projections invalidated by this changeset.
    pub fn impact(&self) -> FontChangeImpact {
        self.changes
            .iter()
            .fold(FontChangeImpact::empty(), |impact, change| {
                impact | change.impact()
            })
    }

    /// Derives created, updated, and deleted entities from collection replacements.
    ///
    /// Collection reordering does not produce entity changes; callers that
    /// react to ordering should use [`FontChangeSet::impact`].
    pub fn entity_changes(&self) -> Vec<FontEntityChange<'_>> {
        let mut entities = Vec::new();
        for change in &self.changes {
            match change {
                FontChange::Axes(value) => {
                    entities.extend(value.entity_changes().map(FontEntityChange::Axis));
                }
                FontChange::AxisMappings(value) => {
                    entities.extend(value.entity_changes().map(FontEntityChange::AxisMapping));
                }
                FontChange::MetricDefinitions(value) => {
                    entities.extend(
                        value
                            .entity_changes()
                            .map(FontEntityChange::MetricDefinition),
                    );
                }
                FontChange::NamedInstances(value) => {
                    entities.extend(value.entity_changes().map(FontEntityChange::NamedInstance));
                }
                FontChange::Sources(value) => {
                    entities.extend(value.entity_changes().map(FontEntityChange::Source));
                }
                FontChange::Glyph(value) => {
                    entities.extend(
                        optional_entity_changes(
                            value.before.as_ref(),
                            value.after.as_ref(),
                            Glyph::id,
                        )
                        .into_iter()
                        .map(FontEntityChange::Glyph),
                    );
                    entities.extend(
                        glyph_layer_entity_changes(value.before.as_ref(), value.after.as_ref())
                            .into_iter()
                            .map(|(glyph_id, change)| FontEntityChange::Layer { glyph_id, change }),
                    );
                }
                FontChange::Layer {
                    glyph_id, layer, ..
                } => entities.extend(
                    optional_entity_changes(
                        layer.before.as_deref(),
                        layer.after.as_deref(),
                        GlyphLayer::id,
                    )
                    .into_iter()
                    .map(|change| FontEntityChange::Layer {
                        glyph_id: glyph_id.clone(),
                        change,
                    }),
                ),
                FontChange::Metadata(_)
                | FontChange::LibValue { .. }
                | FontChange::KerningGroup { .. }
                | FontChange::KerningValue { .. } => {}
            }
        }
        entities
    }

    /// Returns the changeset that restores every original value.
    pub fn inverted(&self) -> Self {
        Self::new(
            self.changes
                .iter()
                .rev()
                .map(FontChange::inverted)
                .collect(),
        )
    }
}

impl From<FontChange> for FontChangeSet {
    fn from(change: FontChange) -> Self {
        Self::new(vec![change])
    }
}

fn collection_entity_changes<'a, T, Id>(
    before: &'a [T],
    after: &'a [T],
    id: impl Fn(&T) -> Id,
) -> Vec<EntityChange<'a, T>>
where
    T: PartialEq,
    Id: PartialEq,
{
    let mut changes = Vec::new();
    for original in before {
        match after
            .iter()
            .find(|replacement| id(replacement) == id(original))
        {
            Some(replacement) if replacement != original => changes.push(EntityChange::Updated {
                before: original,
                after: replacement,
            }),
            Some(_) => {}
            None => changes.push(EntityChange::Deleted(original)),
        }
    }
    for replacement in after {
        if !before
            .iter()
            .any(|original| id(original) == id(replacement))
        {
            changes.push(EntityChange::Created(replacement));
        }
    }
    changes
}

fn glyph_layer_entity_changes<'a>(
    before: Option<&'a Glyph>,
    after: Option<&'a Glyph>,
) -> Vec<(GlyphId, EntityChange<'a, GlyphLayer>)> {
    let glyph_id = after.or(before).map(Glyph::id);
    let mut changes = Vec::new();
    if let Some(original) = before {
        for (layer_id, original_layer) in original.layers() {
            match after.and_then(|glyph| glyph.layers().get(layer_id)) {
                Some(replacement) if replacement != original_layer => changes.push((
                    glyph_id.clone().expect("a glyph exists"),
                    EntityChange::Updated {
                        before: original_layer.as_ref(),
                        after: replacement.as_ref(),
                    },
                )),
                Some(_) => {}
                None => changes.push((
                    original.id(),
                    EntityChange::Deleted(original_layer.as_ref()),
                )),
            }
        }
    }
    if let Some(replacement) = after {
        for (layer_id, replacement_layer) in replacement.layers() {
            let existed = before.is_some_and(|glyph| glyph.layers().contains_key(layer_id));
            if !existed {
                changes.push((
                    replacement.id(),
                    EntityChange::Created(replacement_layer.as_ref()),
                ));
            }
        }
    }
    changes
}

fn optional_entity_changes<'a, T, Id>(
    before: Option<&'a T>,
    after: Option<&'a T>,
    id: impl Fn(&T) -> Id,
) -> Vec<EntityChange<'a, T>>
where
    T: PartialEq,
    Id: PartialEq,
{
    match (before, after) {
        (Some(original), Some(replacement)) if id(original) == id(replacement) => {
            if original == replacement {
                Vec::new()
            } else {
                vec![EntityChange::Updated {
                    before: original,
                    after: replacement,
                }]
            }
        }
        (Some(original), Some(replacement)) => vec![
            EntityChange::Deleted(original),
            EntityChange::Created(replacement),
        ],
        (Some(original), None) => vec![EntityChange::Deleted(original)],
        (None, Some(replacement)) => vec![EntityChange::Created(replacement)],
        (None, None) => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn glyph_with_layer() -> (Glyph, Arc<GlyphLayer>) {
        let layer = GlyphLayer::new(LayerId::new(), SourceId::new());
        let mut glyph = Glyph::with_id(GlyphId::new(), "a");
        glyph.set_layer(layer);
        let layer = Arc::clone(glyph.layers().values().next().expect("layer was set"));
        (glyph, layer)
    }

    #[test]
    fn touched_glyphs_come_once_in_first_touched_order_and_created_layers_are_structural() {
        let (edited, edited_layer) = glyph_with_layer();
        let (created, created_layer) = glyph_with_layer();
        let layer_edit = FontChange::Layer {
            glyph_id: edited.id(),
            layer: Replacement::new(
                Some(Arc::clone(&edited_layer)),
                Some(Arc::clone(&edited_layer)),
            ),
            structural: false,
        };
        let change_set = FontChangeSet {
            changes: vec![
                layer_edit.clone(),
                FontChange::Glyph(Box::new(Replacement::new(None, Some(created.clone())))),
                layer_edit,
            ],
        };

        let glyph_ids = change_set
            .touched_glyph_ids()
            .into_iter()
            .collect::<Vec<_>>();
        let layers = change_set.touched_layers();

        assert_eq!(glyph_ids, [edited.id(), created.id()]);
        assert_eq!(
            layers
                .iter()
                .map(|touched| (touched.layer.id(), touched.structural))
                .collect::<Vec<_>>(),
            [
                (edited_layer.id(), false),
                (created_layer.id(), true),
                (edited_layer.id(), false),
            ]
        );
    }

    #[test]
    fn collection_replacements_report_created_updated_and_deleted_entities() {
        let kept = Axis::weight();
        let removed = Axis::width();
        let mut renamed = kept.clone();
        renamed.set_name("Heaviness".to_string());
        let added = Axis::new("opsz".into(), "Optical size".into(), 6.0, 12.0, 72.0);
        let replacement = Replacement::new(
            vec![kept.clone(), removed.clone()],
            vec![added.clone(), renamed.clone()],
        );

        let changes = replacement.entity_changes().collect::<Vec<_>>();

        assert_eq!(
            changes,
            vec![
                EntityChange::Updated {
                    before: &kept,
                    after: &renamed,
                },
                EntityChange::Deleted(&removed),
                EntityChange::Created(&added),
            ]
        );
    }

    #[test]
    fn a_glyph_replacement_names_one_glyph() {
        let glyph = Glyph::new("A".to_string());
        let other = Glyph::new("B".to_string());

        let created = Replacement::new(None, Some(glyph.clone()));
        let renamed = Replacement::new(Some(glyph.clone()), Some(other));
        let empty: Replacement<Option<Glyph>> = Replacement::new(None, None);

        assert_eq!(created.glyph_id().unwrap(), glyph.id());
        assert!(matches!(
            renamed.glyph_id(),
            Err(CoreError::ReplacementIdentityChanged {
                kind: EntityKind::Glyph,
                ..
            })
        ));
        let Err(error) = empty.glyph_id() else {
            panic!("an empty replacement names no glyph");
        };
        assert_eq!(
            error.to_string(),
            "invalid changeset order: glyph replacement has no value on either side"
        );
    }

    #[test]
    fn a_replacement_applies_only_to_its_original_value() {
        let replacement = Replacement::new(vec![1, 2], vec![2, 1]);

        replacement.require_before(&[1, 2][..], "order").unwrap();
        let Err(error) = replacement.require_before(&[2, 1][..], "order") else {
            panic!("a changed original must be rejected");
        };
        assert!(matches!(
            error,
            CoreError::ChangeOriginMismatch { target: "order" }
        ));
    }

    #[test]
    fn double_inversion_recovers_the_original_changeset() {
        let before = FontMetadata {
            family_name: Some("Before".to_string()),
            ..FontMetadata::default()
        };
        let mut after = before.clone();
        after.family_name = Some("After".to_string());
        let changes = FontChangeSet::from(FontChange::Metadata(Box::new(Replacement::new(
            before, after,
        ))));

        assert_eq!(changes.inverted().inverted(), changes);
    }

    #[test]
    fn changeset_impact_unions_direct_and_transitive_impacts() {
        let changes = FontChangeSet::new(vec![
            FontChange::Axes(Replacement::new(Vec::new(), Vec::new())),
            FontChange::NamedInstances(Replacement::new(Vec::new(), Vec::new())),
        ]);

        assert!(changes.impact().contains(FontChangeImpact::AXES));
        assert!(changes.impact().contains(FontChangeImpact::SOURCES));
        assert!(
            changes
                .impact()
                .contains(FontChangeImpact::AXIS_MAPPING_BASES)
        );
        assert!(changes.impact().contains(FontChangeImpact::SOURCE_METRICS));
        assert!(changes.impact().contains(FontChangeImpact::NAMED_INSTANCES));
    }
}
