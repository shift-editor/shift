//! Stable CLI mutation reports derived from committed semantic changes.

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::Serialize;
use shift_font::{
    EntityChange, Font, FontChangeImpact, FontChangeSet, FontEntityChange, FontMetadata, GlyphLayer,
};

use super::font_info::report::{SourceMetrics, format_version};
use super::instance::report::InstanceReport;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthoringReport {
    pub valid: bool,
    pub document: PathBuf,
    pub output: PathBuf,
    pub wrote: bool,
    pub changes: Vec<AuthoringChange>,
}

#[derive(Debug, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AuthoringChange {
    FontCreated {
        document_id: Option<String>,
    },
    FontMetadataUpdated {
        #[serde(flatten)]
        metadata: FontMetadata,
        version: Option<String>,
    },
    AxisCreated {
        axis_id: String,
        tag: String,
        name: String,
        minimum: f64,
        default: f64,
        maximum: f64,
    },
    AxisUpdated {
        axis_id: String,
        tag: String,
        name: String,
        minimum: f64,
        default: f64,
        maximum: f64,
    },
    SourceCreated {
        source_id: String,
        name: String,
        location: BTreeMap<String, f64>,
    },
    SourceUpdated {
        #[serde(flatten)]
        metrics: SourceMetrics,
    },
    GlyphCreated {
        glyph_id: String,
        name: String,
        unicodes: Vec<String>,
    },
    GlyphUpdated {
        glyph_id: String,
        name: String,
        unicodes: Vec<String>,
    },
    GlyphLayerUpdated {
        #[serde(flatten)]
        layer: LayerReport,
    },
    GlyphLayerCreated {
        #[serde(flatten)]
        layer: LayerReport,
    },
    NamedInstancesUpdated {
        count: usize,
        instances: Vec<InstanceReport>,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerReport {
    layer_id: String,
    glyph_id: String,
    source_id: String,
    advance: f64,
    contour_count: usize,
    point_count: usize,
    anchor_count: usize,
    component_count: usize,
}

impl LayerReport {
    fn from_layer(font: &Font, layer: &GlyphLayer) -> Option<Self> {
        Some(Self {
            layer_id: layer.id().to_string(),
            glyph_id: font.glyph_id_by_layer(layer.id())?.to_string(),
            source_id: layer.source_id().to_string(),
            advance: layer.width(),
            contour_count: layer.contours().len(),
            point_count: layer
                .contours_iter()
                .map(|contour| contour.points().len())
                .sum(),
            anchor_count: layer.anchors().len(),
            component_count: layer.components().len(),
        })
    }

    fn render(&self, marker: char) -> String {
        format!(
            "{marker} layer   {}  {} @ {}  advance {}; {} contours, {} points, {} anchors, {} components",
            self.layer_id,
            self.glyph_id,
            self.source_id,
            self.advance,
            self.contour_count,
            self.point_count,
            self.anchor_count,
            self.component_count
        )
    }
}

impl AuthoringReport {
    pub fn render(&self) -> String {
        let mut lines = vec![self.document.display().to_string(), String::new()];
        for change in &self.changes {
            match change {
                AuthoringChange::FontCreated { document_id } => {
                    let id = document_id.as_deref().unwrap_or("assigned when written");
                    lines.push(format!("+ font    {id}"));
                }
                AuthoringChange::FontMetadataUpdated { metadata, version } => {
                    let family = metadata.family_name.as_deref().unwrap_or("-");
                    let style = metadata.style_name.as_deref().unwrap_or("-");
                    let version = version.as_deref().unwrap_or("-");
                    lines.push(format!("~ font    {family} / {style}  version {version}"));
                }
                AuthoringChange::AxisCreated {
                    axis_id,
                    tag,
                    name,
                    minimum,
                    default,
                    maximum,
                }
                | AuthoringChange::AxisUpdated {
                    axis_id,
                    tag,
                    name,
                    minimum,
                    default,
                    maximum,
                } => {
                    let marker = if matches!(change, AuthoringChange::AxisCreated { .. }) {
                        '+'
                    } else {
                        '~'
                    };
                    lines.push(format!(
                        "{marker} axis    {name} ({tag})  {axis_id}  {minimum} · {default} · {maximum}"
                    ));
                }
                AuthoringChange::SourceCreated {
                    source_id,
                    name,
                    location,
                } => {
                    let location = location
                        .iter()
                        .map(|(tag, value)| format!("{tag}={value}"))
                        .collect::<Vec<_>>()
                        .join(", ");
                    lines.push(format!("+ source  {name}  {source_id}  {location}"));
                }
                AuthoringChange::SourceUpdated { metrics } => {
                    lines.push(format!("~ {}", metrics.render()))
                }
                AuthoringChange::GlyphCreated {
                    glyph_id,
                    name,
                    unicodes,
                } => {
                    let unicodes = unicodes.join(", ");
                    let suffix = if unicodes.is_empty() {
                        String::new()
                    } else {
                        format!("  {unicodes}")
                    };
                    lines.push(format!("+ glyph   {name}  {glyph_id}{suffix}"));
                }
                AuthoringChange::GlyphUpdated {
                    glyph_id,
                    name,
                    unicodes,
                } => {
                    lines.push(format!(
                        "~ glyph   {name}  {glyph_id}  [{}]",
                        unicodes.join(", ")
                    ));
                }
                AuthoringChange::GlyphLayerCreated { layer } => lines.push(layer.render('+')),
                AuthoringChange::GlyphLayerUpdated { layer } => lines.push(layer.render('~')),
                AuthoringChange::NamedInstancesUpdated { count, instances } => {
                    lines.push(format!("~ instances  {count} product presets"));
                    lines.extend(instances.iter().map(InstanceReport::render));
                }
            }
        }
        lines.push(String::new());
        if self.wrote {
            lines.push(format!("Saved {}", self.output.display()));
        } else {
            lines.push("Valid. No files written.".to_string());
        }
        lines.join("\n")
    }
}

pub(super) fn report_changes(font: &Font, changes: &FontChangeSet) -> Vec<AuthoringChange> {
    let impact = changes.impact();
    let mut report = Vec::new();

    if impact.contains(FontChangeImpact::METADATA) {
        let metadata = font.metadata().clone();
        report.push(AuthoringChange::FontMetadataUpdated {
            version: format_version(metadata.version_major, metadata.version_minor),
            metadata,
        });
    }

    report.extend(changes.entity_changes().into_iter().filter_map(|change| {
        match change {
            FontEntityChange::Axis(EntityChange::Created(axis)) => {
                Some(AuthoringChange::AxisCreated {
                    axis_id: axis.id().to_string(),
                    tag: axis.tag().to_string(),
                    name: axis.name().to_string(),
                    minimum: axis.minimum(),
                    default: axis.default(),
                    maximum: axis.maximum(),
                })
            }
            FontEntityChange::Axis(EntityChange::Updated { after: axis, .. }) => {
                Some(AuthoringChange::AxisUpdated {
                    axis_id: axis.id().to_string(),
                    tag: axis.tag().to_string(),
                    name: axis.name().to_string(),
                    minimum: axis.minimum(),
                    default: axis.default(),
                    maximum: axis.maximum(),
                })
            }
            FontEntityChange::Source(EntityChange::Created(source)) => {
                Some(AuthoringChange::SourceCreated {
                    source_id: source.id().to_string(),
                    name: source.name().to_string(),
                    location: source
                        .location()
                        .iter()
                        .filter_map(|(axis_id, value)| {
                            let axis = font.axis(axis_id.clone())?;
                            Some((axis.tag().to_string(), *value))
                        })
                        .collect(),
                })
            }
            FontEntityChange::Source(EntityChange::Updated { after: source, .. }) => {
                Some(AuthoringChange::SourceUpdated {
                    metrics: SourceMetrics::from_source(font, source),
                })
            }
            FontEntityChange::Glyph(EntityChange::Created(glyph)) => {
                Some(AuthoringChange::GlyphCreated {
                    glyph_id: glyph.id().to_string(),
                    name: glyph.glyph_name().to_string(),
                    unicodes: format_unicodes(glyph.unicodes()),
                })
            }
            FontEntityChange::Glyph(EntityChange::Updated { after: glyph, .. }) => {
                Some(AuthoringChange::GlyphUpdated {
                    glyph_id: glyph.id().to_string(),
                    name: glyph.glyph_name().to_string(),
                    unicodes: format_unicodes(glyph.unicodes()),
                })
            }
            FontEntityChange::Layer {
                change: EntityChange::Created(layer),
                ..
            } => Some(AuthoringChange::GlyphLayerCreated {
                layer: LayerReport::from_layer(font, layer)?,
            }),
            FontEntityChange::Layer {
                change: EntityChange::Updated { after: layer, .. },
                ..
            } => Some(AuthoringChange::GlyphLayerUpdated {
                layer: LayerReport::from_layer(font, layer)?,
            }),
            _ => None,
        }
    }));

    if impact.contains(FontChangeImpact::NAMED_INSTANCES) {
        let instances = font
            .named_instances()
            .iter()
            .map(|instance| InstanceReport::from_instance(font, instance))
            .collect::<Vec<_>>();
        report.push(AuthoringChange::NamedInstancesUpdated {
            count: instances.len(),
            instances,
        });
    }

    report
}

fn format_unicodes(unicodes: &[u32]) -> Vec<String> {
    unicodes
        .iter()
        .map(|unicode| format!("U+{unicode:04X}"))
        .collect()
}
