use std::collections::HashSet;

use crate::{
    Axis, AxisKind, CoreError, CoreResult, Font, FontChange, FontChangeSet, Source,
    VariationAuthoring,
};

use super::{
    validate_axis_label_ids, validate_axis_mappings, validate_named_instances,
    validate_source_values,
};

impl Font {
    /// Copies coupled authoring while leaving glyph payloads and metadata untouched.
    ///
    /// The owned snapshot retains collection order, source values, and stable
    /// identities. Taking it performs no I/O or variation-model compilation.
    pub fn variation_authoring(&self) -> VariationAuthoring {
        VariationAuthoring {
            axes: self.axes().to_vec(),
            axis_mappings: self.axis_mappings().to_vec(),
            sources: self.sources().to_vec(),
            default_source_id: self.default_source_id(),
            named_instances: self.named_instances().to_vec(),
        }
    }

    /// Installs one complete, validated authoring target and returns its changes.
    ///
    /// Validation observes target axes, sources, mappings, and products together,
    /// never intermediate replay states. Unlike ordinary axis edits, restoration
    /// may change mapped ranges or default coordinates. Restoration validates
    /// identities, references, and values, not source-creation placement/name
    /// uniqueness or ordinary axis-edit guards. Axis deletion may retain sources
    /// whose coordinates collapse; restoring that saved state keeps them distinct
    /// by identity. This boundary does not promise compiler readiness.
    ///
    /// Glyphs, layers, font metadata, UPM, and metric definitions are untouched.
    /// Source metric values validate against the current metric definitions, so
    /// callers must restore those first. Source-existence and matching layer
    /// restorations belong in the same surrounding workspace transaction.
    ///
    /// # Errors
    ///
    /// Returns a validation error for duplicate identities/tags, invalid mappings,
    /// labels, products or source values, or an invalid default source.
    /// Failure leaves the font unchanged.
    pub fn restore_variation_authoring(
        &mut self,
        authoring: VariationAuthoring,
    ) -> CoreResult<FontChangeSet> {
        let mut axis_ids = HashSet::new();
        let mut axis_tags = HashSet::new();
        for axis in &authoring.axes {
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
        validate_axis_label_ids(&authoring.axes)?;
        validate_axis_mappings(&authoring.axes, &authoring.axis_mappings)?;
        validate_named_instances(&authoring.named_instances, &authoring.axes)?;

        match &authoring.default_source_id {
            Some(id) => {
                let source = authoring
                    .sources
                    .iter()
                    .find(|source| source.id() == *id)
                    .ok_or_else(|| CoreError::SourceNotFound(id.clone()))?;
                if !source.is_master() {
                    return Err(CoreError::InvalidEntityOrder {
                        kind: "source",
                        message: "default identity must name a master".to_string(),
                    });
                }
            }
            None if !authoring.sources.is_empty() => {
                return Err(CoreError::InvalidEntityOrder {
                    kind: "source",
                    message: "non-empty source collection has no default identity".to_string(),
                });
            }
            None => {}
        }
        let mut source_ids = HashSet::new();
        for source in &authoring.sources {
            if !source_ids.insert(source.id()) {
                return Err(CoreError::DuplicateSourceId(source.id()));
            }
            validate_source_values(source, &authoring.axes, self.metric_definitions())?;
        }

        let mut changes = FontChangeSet::default();
        for axis in self.axes() {
            if !authoring.axes.iter().any(|target| target.id() == axis.id()) {
                changes.push(FontChange::axis_deleted(axis.id()));
            }
        }
        for axis in &authoring.axes {
            match self.axes().iter().find(|current| current.id() == axis.id()) {
                None => changes.push(FontChange::axis_created(axis)),
                Some(current) if current != axis => changes.push(FontChange::axis_updated(axis)),
                _ => {}
            }
        }
        if self.axis_mappings() != authoring.axis_mappings {
            changes.push(FontChange::axis_mappings_updated(&authoring.axis_mappings));
        }
        if self.named_instances() != authoring.named_instances {
            changes.push(FontChange::named_instances_updated(
                &authoring.named_instances,
            ));
        }
        for source in self.sources() {
            if !authoring
                .sources
                .iter()
                .any(|target| target.id() == source.id())
            {
                changes.push(FontChange::source_deleted(source.id()));
            }
        }
        for source in &authoring.sources {
            match self.source(source.id()) {
                None => changes.push(FontChange::source_created(source)),
                Some(current) if current != source => {
                    changes.push(FontChange::source_updated(source))
                }
                _ => {}
            }
        }
        let data = self.data_mut();
        data.axes = authoring.axes;
        data.axis_mappings = authoring.axis_mappings;
        data.sources = authoring.sources;
        data.default_source_id = authoring.default_source_id;
        data.named_instances = authoring.named_instances;
        Ok(changes)
    }
}

pub(super) fn validate_source_axis(
    axis: &Axis,
    source: &Source,
    value: f64,
    is_default: bool,
) -> CoreResult<()> {
    let valid_value = match axis.kind() {
        AxisKind::Continuous {
            minimum, maximum, ..
        } => value.is_finite() && value >= *minimum && value <= *maximum,
        AxisKind::Discrete { values, .. } => values.contains(&value),
    };
    if !valid_value {
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
