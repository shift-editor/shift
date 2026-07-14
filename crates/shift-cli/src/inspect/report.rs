use std::collections::HashMap;
use std::fmt::Display;
use std::path::{Path, PathBuf};

use miette::Diagnostic;
use serde::Serialize;
use shift_font::{
    Axis, AxisId, AxisKind, AxisLabel, AxisMapping, AxisMappingPoint, AxisRole, Font, Glyph,
    GlyphLayer, Location, NamedInstance, Source, SourceId,
};
use shift_source::{FORMAT_ID, SCHEMA_VERSION, ShiftSourcePackage, SourcePackageError};
use thiserror::Error;

#[derive(Debug, Error)]
#[error("failed to inspect source package {path}")]
pub struct InspectError {
    path: PathBuf,
    #[source]
    source: SourcePackageError,
}

impl Diagnostic for InspectError {
    fn code<'a>(&'a self) -> Option<Box<dyn Display + 'a>> {
        Some(Box::new("shift_cli::inspect::package"))
    }

    fn help<'a>(&'a self) -> Option<Box<dyn Display + 'a>> {
        Some(Box::new(
            "Check that the path points to a readable .shift package.",
        ))
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestSummary {
    pub format: String,
    pub schema_version: u32,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataSummary {
    pub family_name: Option<String>,
    pub style_name: Option<String>,
    pub display_name: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AxisSummary {
    pub id: String,
    pub tag: String,
    pub name: String,
    pub role: String,
    pub kind: String,
    pub minimum: f64,
    pub default: f64,
    pub maximum: f64,
    pub values: Option<Vec<f64>>,
    pub labels: Vec<AxisLabelSummary>,
    pub hidden: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AxisLabelSummary {
    pub id: String,
    pub name: String,
    pub value: f64,
    pub minimum: Option<f64>,
    pub maximum: Option<f64>,
    pub linked_value: Option<f64>,
    pub elidable: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedInstanceSummary {
    pub id: String,
    pub name: String,
    pub location: Vec<LocationValue>,
    pub postscript_name: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AxisMappingSummary {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub kind: String,
    pub inputs: Vec<AxisReference>,
    pub outputs: Vec<AxisReference>,
    pub points: Vec<AxisMappingPointSummary>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AxisMappingPointSummary {
    pub description: Option<String>,
    pub input: Vec<LocationValue>,
    pub output: Vec<LocationValue>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AxisReference {
    pub id: String,
    pub tag: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSummary {
    pub id: String,
    pub name: String,
    pub location: Vec<LocationValue>,
    pub filename: Option<String>,
    pub is_default: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocationValue {
    pub axis_id: String,
    pub axis_tag: String,
    pub value: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphSummary {
    pub id: String,
    pub name: String,
    pub unicodes: Vec<String>,
    pub layer_count: usize,
    pub layers: Vec<GlyphLayerSummary>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphLayerSummary {
    pub id: String,
    pub source_id: String,
    pub source_name: Option<String>,
    pub advance: f64,
    pub height: Option<f64>,
    pub contour_count: usize,
    pub point_count: usize,
    pub anchor_count: usize,
    pub component_count: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectReport {
    pub path: String,
    pub file_name: String,
    pub manifest: ManifestSummary,
    pub metadata: MetadataSummary,
    pub axes: Vec<AxisSummary>,
    pub axis_mappings: Vec<AxisMappingSummary>,
    pub named_instances: Vec<NamedInstanceSummary>,
    pub sources: Vec<SourceSummary>,
    pub glyph_count: usize,
    pub glyphs: Vec<GlyphSummary>,
}

impl InspectReport {
    pub fn load(path: impl AsRef<Path>) -> Result<Self, InspectError> {
        let path = path.as_ref();
        let font = ShiftSourcePackage::load_font(path).map_err(|source| InspectError {
            path: path.to_path_buf(),
            source,
        })?;

        Ok(Self::from_font(path, &font))
    }

    pub(crate) fn from_font(path: &Path, font: &Font) -> Self {
        let axes_by_id = axes_by_id(font.axes());
        let default_source_id = font.default_source_id();
        let source_names_by_id = source_names_by_id(font.sources());
        let glyphs = font
            .glyphs()
            .map(|glyph| GlyphSummary::from_glyph(glyph, &source_names_by_id))
            .collect::<Vec<_>>();

        Self {
            path: path.display().to_string(),
            file_name: file_name(path),
            manifest: ManifestSummary {
                format: FORMAT_ID.to_string(),
                schema_version: SCHEMA_VERSION,
            },
            metadata: MetadataSummary {
                family_name: font.metadata().family_name.clone(),
                style_name: font.metadata().style_name.clone(),
                display_name: font.metadata().display_name(),
            },
            axes: font.axes().iter().map(AxisSummary::from).collect(),
            axis_mappings: font
                .axis_mappings()
                .iter()
                .map(|mapping| AxisMappingSummary::from_mapping(mapping, &axes_by_id))
                .collect(),
            named_instances: font
                .named_instances()
                .iter()
                .map(|instance| NamedInstanceSummary::from_instance(instance, &axes_by_id))
                .collect(),
            sources: font
                .sources()
                .iter()
                .map(|source| SourceSummary::from_source(source, &axes_by_id, &default_source_id))
                .collect(),
            glyph_count: glyphs.len(),
            glyphs,
        }
    }
}

impl From<&Axis> for AxisSummary {
    fn from(axis: &Axis) -> Self {
        Self {
            id: axis.id().to_string(),
            tag: axis.tag().to_string(),
            name: axis.name().to_string(),
            role: match axis.role() {
                AxisRole::External => "external",
                AxisRole::Internal => "internal",
            }
            .to_string(),
            kind: match axis.kind() {
                AxisKind::Continuous { .. } => "continuous",
                AxisKind::Discrete { .. } => "discrete",
            }
            .to_string(),
            minimum: axis.minimum(),
            default: axis.default(),
            maximum: axis.maximum(),
            values: axis.discrete_values().map(<[f64]>::to_vec),
            labels: axis.labels().iter().map(AxisLabelSummary::from).collect(),
            hidden: axis.is_hidden(),
        }
    }
}

impl From<&AxisLabel> for AxisLabelSummary {
    fn from(label: &AxisLabel) -> Self {
        Self {
            id: label.id().to_string(),
            name: label.name.clone(),
            value: label.value,
            minimum: label.range.as_ref().map(|range| range.minimum),
            maximum: label.range.as_ref().map(|range| range.maximum),
            linked_value: label.linked_value,
            elidable: label.elidable,
        }
    }
}

impl NamedInstanceSummary {
    fn from_instance(instance: &NamedInstance, axes_by_id: &HashMap<AxisId, String>) -> Self {
        Self {
            id: instance.id().to_string(),
            name: instance.name().to_string(),
            location: location_values(instance.location(), axes_by_id),
            postscript_name: instance.postscript_name().map(str::to_string),
        }
    }
}

impl AxisMappingSummary {
    fn from_mapping(mapping: &AxisMapping, axes_by_id: &HashMap<AxisId, String>) -> Self {
        Self {
            id: mapping.id().to_string(),
            name: mapping.name().to_string(),
            description: mapping.description().map(str::to_string),
            kind: if mapping.is_independent() {
                "independent"
            } else {
                "cross-axis"
            }
            .to_string(),
            inputs: axis_references(mapping.inputs(), axes_by_id),
            outputs: axis_references(mapping.outputs(), axes_by_id),
            points: mapping
                .points()
                .iter()
                .map(|point| AxisMappingPointSummary::from_point(point, axes_by_id))
                .collect(),
        }
    }
}

impl AxisMappingPointSummary {
    fn from_point(point: &AxisMappingPoint, axes_by_id: &HashMap<AxisId, String>) -> Self {
        Self {
            description: point.description.clone(),
            input: location_values(&point.input, axes_by_id),
            output: location_values(&point.output, axes_by_id),
        }
    }
}

impl SourceSummary {
    fn from_source(
        source: &Source,
        axes_by_id: &HashMap<AxisId, String>,
        default_source_id: &Option<SourceId>,
    ) -> Self {
        Self {
            id: source.id().to_string(),
            name: source.name().to_string(),
            location: location_values(source.location(), axes_by_id),
            filename: source.filename().map(ToOwned::to_owned),
            is_default: default_source_id
                .as_ref()
                .is_some_and(|source_id| *source_id == source.id()),
        }
    }
}

fn location_values(
    location: &Location,
    axes_by_id: &HashMap<AxisId, String>,
) -> Vec<LocationValue> {
    let mut values = location
        .iter()
        .map(|(axis_id, value)| {
            let axis_tag = axes_by_id
                .get(axis_id)
                .cloned()
                .unwrap_or_else(|| axis_id.to_string());
            LocationValue {
                axis_id: axis_id.to_string(),
                axis_tag,
                value: *value,
            }
        })
        .collect::<Vec<_>>();
    values.sort_by(|left, right| left.axis_tag.cmp(&right.axis_tag));
    values
}

impl GlyphSummary {
    fn from_glyph(glyph: &Glyph, source_names_by_id: &HashMap<SourceId, String>) -> Self {
        let mut layers = glyph
            .layers()
            .values()
            .map(|layer| GlyphLayerSummary::from_layer(layer.as_ref(), source_names_by_id))
            .collect::<Vec<_>>();
        layers.sort_by(|left, right| {
            left.source_id
                .cmp(&right.source_id)
                .then_with(|| left.id.cmp(&right.id))
        });

        Self {
            id: glyph.id().to_string(),
            name: glyph.name().to_string(),
            unicodes: glyph
                .unicodes()
                .iter()
                .map(|unicode| format!("U+{unicode:04X}"))
                .collect(),
            layer_count: layers.len(),
            layers,
        }
    }
}

impl GlyphLayerSummary {
    fn from_layer(layer: &GlyphLayer, source_names_by_id: &HashMap<SourceId, String>) -> Self {
        let source_id = layer.source_id();
        let point_count = layer.contours_iter().map(|contour| contour.len()).sum();

        Self {
            id: layer.id().to_string(),
            source_id: source_id.to_string(),
            source_name: source_names_by_id.get(&source_id).cloned(),
            advance: layer.width(),
            height: layer.height(),
            contour_count: layer.contours().len(),
            point_count,
            anchor_count: layer.anchors().len(),
            component_count: layer.components().len(),
        }
    }
}

fn axes_by_id(axes: &[Axis]) -> HashMap<AxisId, String> {
    axes.iter()
        .map(|axis| (axis.id(), axis.tag().to_string()))
        .collect()
}

fn axis_references(
    axis_ids: &[AxisId],
    axes_by_id: &HashMap<AxisId, String>,
) -> Vec<AxisReference> {
    axis_ids
        .iter()
        .map(|axis_id| AxisReference {
            id: axis_id.to_string(),
            tag: axes_by_id
                .get(axis_id)
                .cloned()
                .unwrap_or_else(|| axis_id.to_string()),
        })
        .collect()
}

fn source_names_by_id(sources: &[Source]) -> HashMap<SourceId, String> {
    sources
        .iter()
        .map(|source| (source.id(), source.name().to_string()))
        .collect()
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_else(|| path.to_str().unwrap_or("<package>"))
        .to_string()
}
