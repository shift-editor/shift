use super::{
    diff_packages, unique_member_id, unique_member_name_with_fallback,
    ShiftInterpolationCompatibilityUpdateReport, ShiftSourceLayerCoverageReport,
    ShiftSourceLocation, ShiftSourceLocationReport, ShiftSourceMappedLocationReport,
    ShiftWorkingSource,
};
use crate::error::{ShiftSourceError, ShiftSourceResult};
use crate::package::{ShiftPackageDiff, ShiftSource};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftCreateSource {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    pub name: String,
    pub location: BTreeMap<String, f64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftSourceUpdate {
    pub name: String,
    pub location: BTreeMap<String, f64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftCreateSourceReport {
    pub source_id: String,
    pub source: ShiftSourceLocation,
    pub source_locations: ShiftSourceLocationReport,
    pub source_mapped_locations: ShiftSourceMappedLocationReport,
    pub interpolation_compatibility: ShiftInterpolationCompatibilityUpdateReport,
    pub source_coverage: ShiftSourceLayerCoverageReport,
    pub diff: ShiftPackageDiff,
    pub revision: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftUpdateSourceReport {
    pub source_id: String,
    pub source: ShiftSourceLocation,
    pub source_locations: ShiftSourceLocationReport,
    pub source_mapped_locations: ShiftSourceMappedLocationReport,
    pub interpolation_compatibility: ShiftInterpolationCompatibilityUpdateReport,
    pub source_coverage: ShiftSourceLayerCoverageReport,
    pub diff: ShiftPackageDiff,
    pub revision: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftDeleteSourceReport {
    pub source_id: String,
    pub source_name: String,
    pub source_locations: ShiftSourceLocationReport,
    pub source_mapped_locations: ShiftSourceMappedLocationReport,
    pub interpolation_compatibility: ShiftInterpolationCompatibilityUpdateReport,
    pub source_coverage: ShiftSourceLayerCoverageReport,
    pub diff: ShiftPackageDiff,
    pub revision: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftSourceLayerUse {
    pub glyph_id: String,
    pub glyph_name: String,
    pub layer_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftGlyphVariationSourceUse {
    pub glyph_id: String,
    pub glyph_name: String,
    pub source_id: String,
    pub source_name: String,
    pub layer_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftDeleteSourcePreview {
    pub source_id: String,
    pub source_name: String,
    pub is_default_source: bool,
    pub layer_uses: Vec<ShiftSourceLayerUse>,
    pub glyph_variation_source_uses: Vec<ShiftGlyphVariationSourceUse>,
    pub can_delete_without_cascade: bool,
    pub revision: u64,
}

impl ShiftWorkingSource {
    pub fn preview_delete_source(
        &self,
        source_id: &str,
    ) -> ShiftSourceResult<ShiftDeleteSourcePreview> {
        let source = self
            .package
            .sources
            .iter()
            .find(|source| source.id == source_id)
            .ok_or_else(|| ShiftSourceError::MissingSource {
                source_id: source_id.to_string(),
            })?;
        let is_default_source = self.is_default_source(source_id);
        let mut layer_uses = Vec::new();
        let mut glyph_variation_source_uses = Vec::new();

        for glyph in &self.package.glyphs {
            if glyph.layers.contains_key(source_id) {
                layer_uses.push(ShiftSourceLayerUse {
                    glyph_id: glyph.id.clone(),
                    glyph_name: glyph.name.clone(),
                    layer_id: source_id.to_string(),
                });
            }

            for variation_source in &glyph.variation_sources {
                if variation_source.layer_id == source_id {
                    glyph_variation_source_uses.push(ShiftGlyphVariationSourceUse {
                        glyph_id: glyph.id.clone(),
                        glyph_name: glyph.name.clone(),
                        source_id: variation_source.id.clone(),
                        source_name: variation_source.name.clone(),
                        layer_id: variation_source.layer_id.clone(),
                    });
                }
            }
        }

        Ok(ShiftDeleteSourcePreview {
            source_id: source.id.clone(),
            source_name: source.name.clone(),
            is_default_source,
            can_delete_without_cascade: !is_default_source
                && layer_uses.is_empty()
                && glyph_variation_source_uses.is_empty(),
            layer_uses,
            glyph_variation_source_uses,
            revision: self.revision,
        })
    }

    pub fn create_source(
        &mut self,
        create: ShiftCreateSource,
    ) -> ShiftSourceResult<ShiftCreateSourceReport> {
        let before = self.package.clone();
        let mut next = before.clone();
        let source_name = unique_member_name_with_fallback(
            create.name.trim(),
            "New Source",
            next.sources.iter().map(|source| source.name.as_str()),
        );
        let source_id = create.source_id.unwrap_or_else(|| {
            unique_member_id(
                "source",
                &source_name,
                next.sources.iter().map(|source| source.id.as_str()),
            )
        });
        next.sources.push(ShiftSource {
            id: source_id.clone(),
            name: source_name,
            location: create.location,
        });

        self.replace_package(next)?;

        let diff = diff_packages(&before, &self.package)?;
        if !diff.changes.is_empty() {
            self.revision += 1;
        }
        let source = self.source_location(&source_id)?;
        let source_locations = self.source_locations_report();
        let source_mapped_locations = self.source_mapped_locations_report()?;

        Ok(ShiftCreateSourceReport {
            source_id,
            source,
            source_locations,
            source_mapped_locations,
            interpolation_compatibility: self.interpolation_compatibility_update_report(&diff),
            source_coverage: self.source_layer_coverage_report(),
            diff,
            revision: self.revision,
        })
    }

    pub fn update_source(
        &mut self,
        source_id: &str,
        update: ShiftSourceUpdate,
    ) -> ShiftSourceResult<ShiftUpdateSourceReport> {
        let before = self.package.clone();
        let mut next = before.clone();
        let source = next
            .sources
            .iter_mut()
            .find(|source| source.id == source_id)
            .ok_or_else(|| ShiftSourceError::MissingSource {
                source_id: source_id.to_string(),
            })?;
        source.name = update.name.trim().to_string();
        source.location = update.location;

        self.replace_package(next)?;

        let diff = diff_packages(&before, &self.package)?;
        if !diff.changes.is_empty() {
            self.revision += 1;
        }
        let source = self.source_location(source_id)?;
        let source_locations = self.source_locations_report();
        let source_mapped_locations = self.source_mapped_locations_report()?;

        Ok(ShiftUpdateSourceReport {
            source_id: source_id.to_string(),
            source,
            source_locations,
            source_mapped_locations,
            interpolation_compatibility: self.interpolation_compatibility_update_report(&diff),
            source_coverage: self.source_layer_coverage_report(),
            diff,
            revision: self.revision,
        })
    }

    pub fn delete_source(&mut self, source_id: &str) -> ShiftSourceResult<ShiftDeleteSourceReport> {
        let preview = self.preview_delete_source(source_id)?;
        if preview.is_default_source {
            return Err(ShiftSourceError::CannotDeleteDefaultSource {
                source_id: source_id.to_string(),
            });
        }
        if !preview.can_delete_without_cascade {
            return Err(ShiftSourceError::SourceHasReferences {
                source_id: source_id.to_string(),
                layer_use_count: preview.layer_uses.len(),
                glyph_variation_source_use_count: preview.glyph_variation_source_uses.len(),
            });
        }

        let before = self.package.clone();
        let mut next = before.clone();
        let source_index = next
            .sources
            .iter()
            .position(|source| source.id == source_id)
            .ok_or_else(|| ShiftSourceError::MissingSource {
                source_id: source_id.to_string(),
            })?;
        let source = next.sources.remove(source_index);

        self.replace_package(next)?;

        let diff = diff_packages(&before, &self.package)?;
        if !diff.changes.is_empty() {
            self.revision += 1;
        }
        let source_locations = self.source_locations_report();
        let source_mapped_locations = self.source_mapped_locations_report()?;

        Ok(ShiftDeleteSourceReport {
            source_id: preview.source_id,
            source_name: source.name,
            source_locations,
            source_mapped_locations,
            interpolation_compatibility: self.interpolation_compatibility_update_report(&diff),
            source_coverage: self.source_layer_coverage_report(),
            diff,
            revision: self.revision,
        })
    }
}
