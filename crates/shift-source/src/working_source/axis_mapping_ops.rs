use super::{
    diff_packages, unique_member_id, unique_member_name_with_fallback,
    ShiftSourceMappedLocationReport, ShiftWorkingSource,
};
use crate::error::{ShiftSourceError, ShiftSourceResult};
use crate::package::{ShiftAxisMapping, ShiftAxisMappingSample, ShiftPackageDiff};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftCreateAxisMapping {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mapping_id: Option<String>,
    pub name: String,
    pub input_axes: Vec<String>,
    pub output_axes: Vec<String>,
    pub samples: Vec<ShiftAxisMappingSample>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftAxisMappingUpdate {
    pub name: String,
    pub input_axes: Vec<String>,
    pub output_axes: Vec<String>,
    pub samples: Vec<ShiftAxisMappingSample>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftCreateAxisMappingReport {
    pub mapping_id: String,
    pub mapping: ShiftAxisMapping,
    pub axis_mappings: ShiftAxisMappingReport,
    pub source_mapped_locations: ShiftSourceMappedLocationReport,
    pub diff: ShiftPackageDiff,
    pub revision: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftUpdateAxisMappingReport {
    pub mapping_id: String,
    pub mapping: ShiftAxisMapping,
    pub axis_mappings: ShiftAxisMappingReport,
    pub source_mapped_locations: ShiftSourceMappedLocationReport,
    pub diff: ShiftPackageDiff,
    pub revision: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftDeleteAxisMappingReport {
    pub mapping_id: String,
    pub mapping_name: String,
    pub axis_mappings: ShiftAxisMappingReport,
    pub source_mapped_locations: ShiftSourceMappedLocationReport,
    pub diff: ShiftPackageDiff,
    pub revision: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftAxisMappingReport {
    pub revision: u64,
    pub summary: ShiftAxisMappingSummary,
    pub mappings: Vec<ShiftAxisMappingListItem>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftAxisMappingSummary {
    pub mapping_count: usize,
    pub input_axis_reference_count: usize,
    pub output_axis_reference_count: usize,
    pub unique_input_axis_count: usize,
    pub unique_output_axis_count: usize,
    pub sample_count: usize,
    pub static_mapping_count: usize,
    pub one_dimensional_mapping_count: usize,
    pub multi_dimensional_mapping_count: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftAxisMappingListItem {
    pub mapping_id: String,
    pub mapping_name: String,
    pub kind: ShiftAxisMappingKind,
    pub input_axes: Vec<String>,
    pub output_axes: Vec<String>,
    pub input_axis_count: usize,
    pub output_axis_count: usize,
    pub sample_count: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ShiftAxisMappingKind {
    Static,
    OneDimensional,
    MultiDimensional,
}

impl ShiftWorkingSource {
    pub fn axis_mappings_report(&self) -> ShiftAxisMappingReport {
        let mappings = self
            .package
            .axis_mappings
            .iter()
            .map(axis_mapping_list_item)
            .collect::<Vec<_>>();
        ShiftAxisMappingReport {
            revision: self.revision,
            summary: axis_mapping_summary(&mappings),
            mappings,
        }
    }

    pub fn create_axis_mapping(
        &mut self,
        create: ShiftCreateAxisMapping,
    ) -> ShiftSourceResult<ShiftCreateAxisMappingReport> {
        let before = self.package.clone();
        let mut next = before.clone();
        let mapping_name = unique_member_name_with_fallback(
            create.name.trim(),
            "New Mapping",
            next.axis_mappings
                .iter()
                .map(|mapping| mapping.name.as_str()),
        );
        let mapping_id = create.mapping_id.unwrap_or_else(|| {
            unique_member_id(
                "mapping",
                &mapping_name,
                next.axis_mappings.iter().map(|mapping| mapping.id.as_str()),
            )
        });
        next.axis_mappings.push(ShiftAxisMapping {
            id: mapping_id.clone(),
            name: mapping_name,
            input_axes: create.input_axes,
            output_axes: create.output_axes,
            samples: create.samples,
        });

        self.replace_package(next)?;

        let diff = diff_packages(&before, &self.package)?;
        if !diff.changes.is_empty() {
            self.revision += 1;
        }
        let mapping = self.axis_mapping(&mapping_id)?.clone();
        let axis_mappings = self.axis_mappings_report();
        let source_mapped_locations = self.source_mapped_locations_report()?;

        Ok(ShiftCreateAxisMappingReport {
            mapping_id,
            mapping,
            axis_mappings,
            source_mapped_locations,
            diff,
            revision: self.revision,
        })
    }

    pub fn update_axis_mapping(
        &mut self,
        mapping_id: &str,
        update: ShiftAxisMappingUpdate,
    ) -> ShiftSourceResult<ShiftUpdateAxisMappingReport> {
        let before = self.package.clone();
        let mut next = before.clone();
        let mapping = next
            .axis_mappings
            .iter_mut()
            .find(|mapping| mapping.id == mapping_id)
            .ok_or_else(|| ShiftSourceError::MissingAxisMapping {
                mapping_id: mapping_id.to_string(),
            })?;
        mapping.name = update.name.trim().to_string();
        mapping.input_axes = update.input_axes;
        mapping.output_axes = update.output_axes;
        mapping.samples = update.samples;

        self.replace_package(next)?;

        let diff = diff_packages(&before, &self.package)?;
        if !diff.changes.is_empty() {
            self.revision += 1;
        }
        let mapping = self.axis_mapping(mapping_id)?.clone();
        let axis_mappings = self.axis_mappings_report();
        let source_mapped_locations = self.source_mapped_locations_report()?;

        Ok(ShiftUpdateAxisMappingReport {
            mapping_id: mapping_id.to_string(),
            mapping,
            axis_mappings,
            source_mapped_locations,
            diff,
            revision: self.revision,
        })
    }

    pub fn delete_axis_mapping(
        &mut self,
        mapping_id: &str,
    ) -> ShiftSourceResult<ShiftDeleteAxisMappingReport> {
        let before = self.package.clone();
        let mut next = before.clone();
        let mapping_index = next
            .axis_mappings
            .iter()
            .position(|mapping| mapping.id == mapping_id)
            .ok_or_else(|| ShiftSourceError::MissingAxisMapping {
                mapping_id: mapping_id.to_string(),
            })?;
        let mapping = next.axis_mappings.remove(mapping_index);

        self.replace_package(next)?;

        let diff = diff_packages(&before, &self.package)?;
        if !diff.changes.is_empty() {
            self.revision += 1;
        }
        let axis_mappings = self.axis_mappings_report();
        let source_mapped_locations = self.source_mapped_locations_report()?;

        Ok(ShiftDeleteAxisMappingReport {
            mapping_id: mapping.id,
            mapping_name: mapping.name,
            axis_mappings,
            source_mapped_locations,
            diff,
            revision: self.revision,
        })
    }
}

fn axis_mapping_list_item(mapping: &ShiftAxisMapping) -> ShiftAxisMappingListItem {
    let kind = axis_mapping_kind(mapping);
    ShiftAxisMappingListItem {
        mapping_id: mapping.id.clone(),
        mapping_name: mapping.name.clone(),
        kind,
        input_axis_count: mapping.input_axes.len(),
        output_axis_count: mapping.output_axes.len(),
        sample_count: mapping.samples.len(),
        input_axes: mapping.input_axes.clone(),
        output_axes: mapping.output_axes.clone(),
    }
}

fn axis_mapping_kind(mapping: &ShiftAxisMapping) -> ShiftAxisMappingKind {
    match mapping.input_axes.len() {
        0 => ShiftAxisMappingKind::Static,
        1 => ShiftAxisMappingKind::OneDimensional,
        _ => ShiftAxisMappingKind::MultiDimensional,
    }
}

fn axis_mapping_summary(mappings: &[ShiftAxisMappingListItem]) -> ShiftAxisMappingSummary {
    let mut input_axis_reference_count = 0;
    let mut output_axis_reference_count = 0;
    let mut input_axes = BTreeSet::new();
    let mut output_axes = BTreeSet::new();
    let mut sample_count = 0;
    let mut static_mapping_count = 0;
    let mut one_dimensional_mapping_count = 0;
    let mut multi_dimensional_mapping_count = 0;

    for mapping in mappings {
        input_axis_reference_count += mapping.input_axis_count;
        output_axis_reference_count += mapping.output_axis_count;
        input_axes.extend(mapping.input_axes.iter().cloned());
        output_axes.extend(mapping.output_axes.iter().cloned());
        sample_count += mapping.sample_count;
        match mapping.kind {
            ShiftAxisMappingKind::Static => static_mapping_count += 1,
            ShiftAxisMappingKind::OneDimensional => one_dimensional_mapping_count += 1,
            ShiftAxisMappingKind::MultiDimensional => multi_dimensional_mapping_count += 1,
        }
    }

    ShiftAxisMappingSummary {
        mapping_count: mappings.len(),
        input_axis_reference_count,
        output_axis_reference_count,
        unique_input_axis_count: input_axes.len(),
        unique_output_axis_count: output_axes.len(),
        sample_count,
        static_mapping_count,
        one_dimensional_mapping_count,
        multi_dimensional_mapping_count,
    }
}
