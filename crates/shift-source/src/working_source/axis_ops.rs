use super::{
    collect_condition_axis_ids, diff_packages, unique_member_id, unique_member_name_with_fallback,
    ShiftInterpolationCompatibilityUpdateReport, ShiftSourceLayerCoverageReport,
    ShiftSourceLocationReport, ShiftSourceMappedLocationReport, ShiftWorkingSource,
};
use crate::error::{ShiftSourceError, ShiftSourceResult};
use crate::package::{
    ShiftAxis, ShiftAxisRole, ShiftComponent, ShiftComponentVariationSource, ShiftCondition,
    ShiftGlyph, ShiftPackageDiff,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftCreateAxis {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub axis_id: Option<String>,
    pub tag: String,
    pub name: String,
    pub minimum: f64,
    pub default: f64,
    pub maximum: f64,
    pub hidden: bool,
    #[serde(default)]
    pub role: ShiftAxisRole,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftAxisUpdate {
    pub tag: String,
    pub name: String,
    pub minimum: f64,
    pub default: f64,
    pub maximum: f64,
    pub hidden: bool,
    #[serde(default)]
    pub role: ShiftAxisRole,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftCreateAxisReport {
    pub axis_id: String,
    pub axis: ShiftAxis,
    pub axes: ShiftAxisReport,
    pub source_locations: ShiftSourceLocationReport,
    pub source_mapped_locations: ShiftSourceMappedLocationReport,
    pub interpolation_compatibility: ShiftInterpolationCompatibilityUpdateReport,
    pub source_coverage: ShiftSourceLayerCoverageReport,
    pub diff: ShiftPackageDiff,
    pub revision: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftUpdateAxisReport {
    pub axis_id: String,
    pub axis: ShiftAxis,
    pub axes: ShiftAxisReport,
    pub source_locations: ShiftSourceLocationReport,
    pub source_mapped_locations: ShiftSourceMappedLocationReport,
    pub interpolation_compatibility: ShiftInterpolationCompatibilityUpdateReport,
    pub source_coverage: ShiftSourceLayerCoverageReport,
    pub diff: ShiftPackageDiff,
    pub revision: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftDeleteAxisPreview {
    pub axis_id: String,
    pub axis_name: String,
    pub source_location_uses: Vec<ShiftAxisSourceLocationUse>,
    pub axis_mapping_uses: Vec<ShiftAxisMappingUse>,
    pub glyph_variation_source_uses: Vec<ShiftGlyphVariationAxisUse>,
    pub component_axis_uses: Vec<ShiftComponentAxisUse>,
    pub can_delete_without_cascade: bool,
    pub revision: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftDeleteAxisReport {
    pub axis_id: String,
    pub axis_name: String,
    pub axes: ShiftAxisReport,
    pub source_locations: ShiftSourceLocationReport,
    pub source_mapped_locations: ShiftSourceMappedLocationReport,
    pub interpolation_compatibility: ShiftInterpolationCompatibilityUpdateReport,
    pub source_coverage: ShiftSourceLayerCoverageReport,
    pub diff: ShiftPackageDiff,
    pub revision: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftAxisReport {
    pub revision: u64,
    pub summary: ShiftAxisSummary,
    pub axes: Vec<ShiftAxis>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftAxisSummary {
    pub axis_count: usize,
    pub user_facing_axis_count: usize,
    pub internal_axis_count: usize,
    pub hidden_axis_count: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftAxisSourceLocationUse {
    pub source_id: String,
    pub source_name: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftAxisMappingUse {
    pub mapping_id: String,
    pub mapping_name: String,
    pub roles: Vec<ShiftAxisMappingAxisRole>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ShiftAxisMappingAxisRole {
    InputAxis,
    OutputAxis,
    SampleInput,
    SampleOutput,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftGlyphVariationAxisUse {
    pub glyph_id: String,
    pub glyph_name: String,
    pub source_id: String,
    pub source_name: String,
    pub layer_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftComponentAxisUse {
    pub glyph_id: String,
    pub glyph_name: String,
    pub layer_id: String,
    pub component_id: String,
    pub base_glyph_id: String,
    pub base_glyph_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variation_source_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variation_source_name: Option<String>,
    pub kind: ShiftComponentAxisUseKind,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ShiftComponentAxisUseKind {
    ComponentLocation,
    ComponentVariationParentLocation,
    ComponentVariationLocation,
    ComponentCondition,
}

impl ShiftWorkingSource {
    pub fn axes_report(&self) -> ShiftAxisReport {
        ShiftAxisReport {
            revision: self.revision,
            summary: axis_summary(&self.package.axes),
            axes: self.package.axes.clone(),
        }
    }

    pub fn preview_delete_axis(&self, axis_id: &str) -> ShiftSourceResult<ShiftDeleteAxisPreview> {
        let axis = self.axis(axis_id)?;
        let mut source_location_uses = Vec::new();
        let mut axis_mapping_uses = Vec::new();
        let mut glyph_variation_source_uses = Vec::new();
        let mut component_axis_uses = Vec::new();

        for source in &self.package.sources {
            if source.location.contains_key(axis_id) {
                source_location_uses.push(ShiftAxisSourceLocationUse {
                    source_id: source.id.clone(),
                    source_name: source.name.clone(),
                });
            }
        }

        for mapping in &self.package.axis_mappings {
            let mut roles = BTreeSet::new();
            if mapping.input_axes.iter().any(|id| id == axis_id) {
                roles.insert(ShiftAxisMappingAxisRole::InputAxis);
            }
            if mapping.output_axes.iter().any(|id| id == axis_id) {
                roles.insert(ShiftAxisMappingAxisRole::OutputAxis);
            }
            if mapping
                .samples
                .iter()
                .any(|sample| sample.input_location.contains_key(axis_id))
            {
                roles.insert(ShiftAxisMappingAxisRole::SampleInput);
            }
            if mapping
                .samples
                .iter()
                .any(|sample| sample.output_location.contains_key(axis_id))
            {
                roles.insert(ShiftAxisMappingAxisRole::SampleOutput);
            }
            if !roles.is_empty() {
                axis_mapping_uses.push(ShiftAxisMappingUse {
                    mapping_id: mapping.id.clone(),
                    mapping_name: mapping.name.clone(),
                    roles: roles.into_iter().collect(),
                });
            }
        }

        for glyph in &self.package.glyphs {
            for source in &glyph.variation_sources {
                if source.location.contains_key(axis_id) {
                    glyph_variation_source_uses.push(ShiftGlyphVariationAxisUse {
                        glyph_id: glyph.id.clone(),
                        glyph_name: glyph.name.clone(),
                        source_id: source.id.clone(),
                        source_name: source.name.clone(),
                        layer_id: source.layer_id.clone(),
                    });
                }
            }

            for (layer_id, layer) in &glyph.layers {
                for component in &layer.components {
                    collect_component_axis_uses(
                        axis_id,
                        glyph,
                        layer_id,
                        component,
                        &mut component_axis_uses,
                    );
                }
            }
        }

        Ok(ShiftDeleteAxisPreview {
            axis_id: axis.id.clone(),
            axis_name: axis.name.clone(),
            can_delete_without_cascade: source_location_uses.is_empty()
                && axis_mapping_uses.is_empty()
                && glyph_variation_source_uses.is_empty()
                && component_axis_uses.is_empty(),
            source_location_uses,
            axis_mapping_uses,
            glyph_variation_source_uses,
            component_axis_uses,
            revision: self.revision,
        })
    }

    pub fn create_axis(
        &mut self,
        create: ShiftCreateAxis,
    ) -> ShiftSourceResult<ShiftCreateAxisReport> {
        let before = self.package.clone();
        let mut next = before.clone();
        let axis_name = unique_member_name_with_fallback(
            create.name.trim(),
            "New Axis",
            next.axes.iter().map(|axis| axis.name.as_str()),
        );
        let axis_tag = create.tag.trim().to_string();
        let axis_id = create.axis_id.unwrap_or_else(|| {
            unique_member_id(
                "axis",
                &axis_tag,
                next.axes.iter().map(|axis| axis.id.as_str()),
            )
        });
        next.axes.push(ShiftAxis {
            id: axis_id.clone(),
            tag: axis_tag,
            name: axis_name,
            minimum: create.minimum,
            default: create.default,
            maximum: create.maximum,
            hidden: create.hidden,
            role: create.role,
        });

        self.replace_package(next)?;

        let diff = diff_packages(&before, &self.package)?;
        if !diff.changes.is_empty() {
            self.revision += 1;
        }
        let axis = self.axis(&axis_id)?.clone();
        let source_locations = self.source_locations_report();
        let source_mapped_locations = self.source_mapped_locations_report()?;

        Ok(ShiftCreateAxisReport {
            axis_id,
            axis,
            axes: self.axes_report(),
            source_locations,
            source_mapped_locations,
            interpolation_compatibility: self.interpolation_compatibility_update_report(&diff),
            source_coverage: self.source_layer_coverage_report(),
            diff,
            revision: self.revision,
        })
    }

    pub fn update_axis(
        &mut self,
        axis_id: &str,
        update: ShiftAxisUpdate,
    ) -> ShiftSourceResult<ShiftUpdateAxisReport> {
        let before = self.package.clone();
        let mut next = before.clone();
        let axis = next
            .axes
            .iter_mut()
            .find(|axis| axis.id == axis_id)
            .ok_or_else(|| ShiftSourceError::MissingAxis {
                axis_id: axis_id.to_string(),
            })?;
        axis.tag = update.tag.trim().to_string();
        axis.name = update.name.trim().to_string();
        axis.minimum = update.minimum;
        axis.default = update.default;
        axis.maximum = update.maximum;
        axis.hidden = update.hidden;
        axis.role = update.role;

        self.replace_package(next)?;

        let diff = diff_packages(&before, &self.package)?;
        if !diff.changes.is_empty() {
            self.revision += 1;
        }
        let axis = self.axis(axis_id)?.clone();
        let source_locations = self.source_locations_report();
        let source_mapped_locations = self.source_mapped_locations_report()?;

        Ok(ShiftUpdateAxisReport {
            axis_id: axis_id.to_string(),
            axis,
            axes: self.axes_report(),
            source_locations,
            source_mapped_locations,
            interpolation_compatibility: self.interpolation_compatibility_update_report(&diff),
            source_coverage: self.source_layer_coverage_report(),
            diff,
            revision: self.revision,
        })
    }

    pub fn delete_axis(&mut self, axis_id: &str) -> ShiftSourceResult<ShiftDeleteAxisReport> {
        let preview = self.preview_delete_axis(axis_id)?;
        if !preview.can_delete_without_cascade {
            return Err(ShiftSourceError::AxisHasReferences {
                axis_id: axis_id.to_string(),
                source_location_use_count: preview.source_location_uses.len(),
                axis_mapping_use_count: preview.axis_mapping_uses.len(),
                glyph_variation_source_use_count: preview.glyph_variation_source_uses.len(),
                component_axis_use_count: preview.component_axis_uses.len(),
            });
        }

        let before = self.package.clone();
        let mut next = before.clone();
        let axis_index = next
            .axes
            .iter()
            .position(|axis| axis.id == axis_id)
            .ok_or_else(|| ShiftSourceError::MissingAxis {
                axis_id: axis_id.to_string(),
            })?;
        let axis = next.axes.remove(axis_index);

        self.replace_package(next)?;

        let diff = diff_packages(&before, &self.package)?;
        if !diff.changes.is_empty() {
            self.revision += 1;
        }
        let source_locations = self.source_locations_report();
        let source_mapped_locations = self.source_mapped_locations_report()?;

        Ok(ShiftDeleteAxisReport {
            axis_id: preview.axis_id,
            axis_name: axis.name,
            axes: self.axes_report(),
            source_locations,
            source_mapped_locations,
            interpolation_compatibility: self.interpolation_compatibility_update_report(&diff),
            source_coverage: self.source_layer_coverage_report(),
            diff,
            revision: self.revision,
        })
    }
}

pub(super) fn axis_summary(axes: &[ShiftAxis]) -> ShiftAxisSummary {
    let mut summary = ShiftAxisSummary {
        axis_count: axes.len(),
        user_facing_axis_count: 0,
        internal_axis_count: 0,
        hidden_axis_count: 0,
    };

    for axis in axes {
        match axis.role {
            ShiftAxisRole::UserFacing => summary.user_facing_axis_count += 1,
            ShiftAxisRole::Internal => summary.internal_axis_count += 1,
        }
        if axis.hidden {
            summary.hidden_axis_count += 1;
        }
    }

    summary
}

fn collect_component_axis_uses(
    axis_id: &str,
    glyph: &ShiftGlyph,
    layer_id: &str,
    component: &ShiftComponent,
    uses: &mut Vec<ShiftComponentAxisUse>,
) {
    if component.location.contains_key(axis_id) {
        uses.push(component_axis_use(
            glyph,
            layer_id,
            component,
            None,
            ShiftComponentAxisUseKind::ComponentLocation,
        ));
    }

    for source in &component.variation_sources {
        if source.parent_location.contains_key(axis_id) {
            uses.push(component_axis_use(
                glyph,
                layer_id,
                component,
                Some(source),
                ShiftComponentAxisUseKind::ComponentVariationParentLocation,
            ));
        }
        if source.location.contains_key(axis_id) {
            uses.push(component_axis_use(
                glyph,
                layer_id,
                component,
                Some(source),
                ShiftComponentAxisUseKind::ComponentVariationLocation,
            ));
        }
    }

    if component
        .condition
        .as_ref()
        .is_some_and(|condition| condition_references_axis(condition, axis_id))
    {
        uses.push(component_axis_use(
            glyph,
            layer_id,
            component,
            None,
            ShiftComponentAxisUseKind::ComponentCondition,
        ));
    }
}

fn condition_references_axis(condition: &ShiftCondition, axis_id: &str) -> bool {
    let mut axis_ids = BTreeSet::new();
    collect_condition_axis_ids(condition, &mut axis_ids);
    axis_ids.contains(axis_id)
}

fn component_axis_use(
    glyph: &ShiftGlyph,
    layer_id: &str,
    component: &ShiftComponent,
    source: Option<&ShiftComponentVariationSource>,
    kind: ShiftComponentAxisUseKind,
) -> ShiftComponentAxisUse {
    ShiftComponentAxisUse {
        glyph_id: glyph.id.clone(),
        glyph_name: glyph.name.clone(),
        layer_id: layer_id.to_string(),
        component_id: component.id.clone(),
        base_glyph_id: component.base_glyph_id.clone(),
        base_glyph_name: component.base_glyph_name.clone(),
        variation_source_id: source.map(|source| source.id.clone()),
        variation_source_name: source.map(|source| source.name.clone()),
        kind,
    }
}
