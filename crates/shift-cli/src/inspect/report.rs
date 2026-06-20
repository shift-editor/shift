use std::collections::HashMap;
use std::fmt::Display;
use std::path::{Path, PathBuf};

use miette::Diagnostic;
use serde::Serialize;
use shift_font::{Axis, AxisId, Font, Glyph, Source, SourceId};
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
    pub minimum: f64,
    pub default: f64,
    pub maximum: f64,
    pub hidden: bool,
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

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphSummary {
    pub id: String,
    pub name: String,
    pub unicodes: Vec<String>,
    pub layer_count: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectReport {
    pub path: String,
    pub file_name: String,
    pub manifest: ManifestSummary,
    pub metadata: MetadataSummary,
    pub axes: Vec<AxisSummary>,
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
        let glyphs = font.glyphs().map(GlyphSummary::from).collect::<Vec<_>>();

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
            minimum: axis.minimum(),
            default: axis.default(),
            maximum: axis.maximum(),
            hidden: axis.is_hidden(),
        }
    }
}

impl SourceSummary {
    fn from_source(
        source: &Source,
        axes_by_id: &HashMap<AxisId, String>,
        default_source_id: &Option<SourceId>,
    ) -> Self {
        let mut location = source
            .location()
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
        location.sort_by(|left, right| left.axis_tag.cmp(&right.axis_tag));

        Self {
            id: source.id().to_string(),
            name: source.name().to_string(),
            location,
            filename: source.filename().map(ToOwned::to_owned),
            is_default: default_source_id
                .as_ref()
                .is_some_and(|source_id| *source_id == source.id()),
        }
    }
}

impl From<&Glyph> for GlyphSummary {
    fn from(glyph: &Glyph) -> Self {
        Self {
            id: glyph.id().to_string(),
            name: glyph.name().to_string(),
            unicodes: glyph
                .unicodes()
                .iter()
                .map(|unicode| format!("U+{unicode:04X}"))
                .collect(),
            layer_count: glyph.layers().len(),
        }
    }
}

fn axes_by_id(axes: &[Axis]) -> HashMap<AxisId, String> {
    axes.iter()
        .map(|axis| (axis.id(), axis.tag().to_string()))
        .collect()
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_else(|| path.to_str().unwrap_or("<package>"))
        .to_string()
}
