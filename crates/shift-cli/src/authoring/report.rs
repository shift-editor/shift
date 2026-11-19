//! Stable CLI mutation reports derived from committed semantic changes.

use crate::Report;
use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::Serialize;
use shift_font::{
    AxisId, AxisNaming, EntityChange, Font, FontChange, FontChangeImpact, FontChangeSet,
    FontEntityChange, FontMetadata, Glyph, GlyphAxis, GlyphLayer, KerningGroup, KerningGroupId,
    KerningPair, NeverUsedReason, SourceId, SwapId,
};

use super::font_info::report::SourceMetrics;
use super::instance::report::InstanceReport;
use crate::format::FontVersion;
use crate::kerning::selector::position_label;
use crate::kerning::{GroupReport, PairReport, SideReport};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuthoringReport {
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
pub(crate) enum AuthoringChange {
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
        /// The glyph's mark colour as `glyph set` reads it, `None` without one.
        mark_color: Option<String>,
    },
    GlyphUpdated {
        glyph_id: String,
        name: String,
        unicodes: Vec<String>,
        /// The glyph's mark colour as `glyph set` reads it, `None` without one.
        mark_color: Option<String>,
    },
    GlyphLayerUpdated {
        #[serde(flatten)]
        layer: LayerReport,
    },
    GlyphLayerCreated {
        #[serde(flatten)]
        layer: LayerReport,
    },
    GlyphLayerDeleted {
        layer_id: String,
        glyph_id: String,
    },
    GlyphAxisCreated {
        #[serde(flatten)]
        axis: GlyphAxisReport,
    },
    GlyphAxisUpdated {
        #[serde(flatten)]
        axis: GlyphAxisReport,
    },
    GlyphAxisDeleted {
        #[serde(flatten)]
        axis: GlyphAxisReport,
    },
    GlyphSwapsSet {
        glyph_id: String,
        glyph_name: String,
        /// Every swap after the change, in the order they are tried.
        swaps: Vec<SwapReport>,
    },
    NamedInstancesUpdated {
        count: usize,
        instances: Vec<InstanceReport>,
    },
    KerningGroupCreated {
        #[serde(flatten)]
        group: GroupReport,
    },
    KerningGroupUpdated {
        #[serde(flatten)]
        group: GroupReport,
    },
    KerningGroupDeleted {
        group_id: String,
        position: &'static str,
        name: String,
    },
    KerningValueSet {
        source_id: String,
        source_name: Option<String>,
        first: SideReport,
        second: SideReport,
        value: f64,
        previous: Option<f64>,
    },
    KerningValueRemoved {
        source_id: String,
        source_name: Option<String>,
        first: SideReport,
        second: SideReport,
        previous: f64,
    },
}

/// One of a glyph's own axes, in its own units, with the glyph it belongs to.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GlyphAxisReport {
    glyph_id: String,
    glyph_name: String,
    #[serde(flatten)]
    axis: GlyphAxis,
}

impl GlyphAxisReport {
    fn from_axis(glyph: &Glyph, axis: &GlyphAxis) -> Self {
        Self {
            glyph_id: glyph.id().to_string(),
            glyph_name: glyph.name().to_string(),
            axis: axis.clone(),
        }
    }

    fn render(&self, marker: char) -> String {
        let Self {
            glyph_name, axis, ..
        } = self;
        format!(
            "{marker} glyph axis  {glyph_name}: {} ({})  {}  {} · {} · {}",
            axis.name(),
            axis.tag(),
            axis.id(),
            axis.minimum(),
            axis.as_axis().default(),
            axis.maximum()
        )
    }
}

/// How each of a glyph's own axes changed between `before` and `after`.
fn glyph_axis_changes(before: Option<&Glyph>, after: Option<&Glyph>) -> Vec<AuthoringChange> {
    let mut changes = Vec::new();
    if let Some(glyph) = after {
        for axis in glyph.axes() {
            let report = GlyphAxisReport::from_axis(glyph, axis);
            match before.and_then(|before| before.axis(axis.id())) {
                None => changes.push(AuthoringChange::GlyphAxisCreated { axis: report }),
                Some(old) if old != axis => {
                    changes.push(AuthoringChange::GlyphAxisUpdated { axis: report });
                }
                Some(_) => {}
            }
        }
    }
    if let Some(glyph) = before {
        for axis in glyph.axes() {
            if after.and_then(|after| after.axis(axis.id())).is_none() {
                changes.push(AuthoringChange::GlyphAxisDeleted {
                    axis: GlyphAxisReport::from_axis(glyph, axis),
                });
            }
        }
    }
    changes
}

/// One swap as a report lists it.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SwapReport {
    pub swap_id: String,
    /// Counting from 1.
    pub position: usize,
    pub glyph: String,
    /// One range per text, by axis name, in user units on font axes;
    /// empty when it always applies.
    pub when: Vec<String>,
    /// Why no location draws it, when none does.
    pub never_used: Option<String>,
}

impl SwapReport {
    /// Each of `glyph`'s swaps in `font`, with never-used warnings.
    pub(crate) fn of_glyph(font: &Font, glyph: &Glyph) -> Vec<Self> {
        // Both fail only when an axis mapping doesn't compile; the report then
        // lists the swaps without condition text or warnings, and
        // `check` reports the mapping.
        let space = font.condition_space(Some(glyph.id())).ok();
        let unused: BTreeMap<SwapId, NeverUsedReason> = font
            .never_used_swaps(glyph.id())
            .unwrap_or_default()
            .into_iter()
            .map(|unused| (unused.swap_id, unused.reason))
            .collect();
        let described: BTreeMap<SwapId, String> = glyph
            .swaps()
            .iter()
            .enumerate()
            .map(|(index, swap)| {
                let name = glyph_name(font, swap.glyph());
                (swap.id(), format!("{name} (swap {})", index + 1))
            })
            .collect();
        let name_at = |swap_id: SwapId| described.get(&swap_id).cloned().unwrap_or_default();
        glyph
            .swaps()
            .iter()
            .enumerate()
            .map(|(index, swap)| {
                let never_used = unused.get(&swap.id()).map(|reason| match reason {
                    NeverUsedReason::OutsideAxes => {
                        "its condition holds nowhere in the axes' ranges".to_string()
                    }
                    NeverUsedReason::Covered { by } => {
                        let earlier: Vec<String> = by.iter().map(|id| name_at(*id)).collect();
                        format!("{} always applies first", earlier.join(" and "))
                    }
                });
                Self {
                    swap_id: swap.id().to_string(),
                    position: index + 1,
                    glyph: glyph_name(font, swap.glyph()),
                    when: space.as_ref().map_or_else(Vec::new, |space| {
                        space.format(swap.condition(), AxisNaming::Name)
                    }),
                    never_used,
                }
            })
            .collect()
    }

    /// One line: `2. dollar.bled  when Bleed ≥ 70`, with a warning when it
    /// is never used.
    pub(crate) fn render(&self) -> String {
        let when = if self.when.is_empty() {
            "always".to_string()
        } else {
            format!("when {}", self.when.join(", "))
        };
        let line = format!("{}. {}  {when}", self.position, self.glyph);
        match &self.never_used {
            Some(why) => format!("{line}\n     warning: never used, because {why}"),
            None => line,
        }
    }
}

fn glyph_name(font: &Font, glyph_id: shift_font::GlyphId) -> String {
    font.glyph(glyph_id)
        .map_or_else(|| glyph_id.to_string(), |glyph| glyph.name().to_string())
}

/// The swaps of `after` when they differ from those of `before`.
fn swap_changes(font: &Font, before: Option<&Glyph>, after: &Glyph) -> Option<AuthoringChange> {
    let unchanged = match before {
        Some(before) => before.swaps() == after.swaps(),
        None => after.swaps().is_empty(),
    };
    if unchanged {
        return None;
    }
    Some(AuthoringChange::GlyphSwapsSet {
        glyph_id: after.id().to_string(),
        glyph_name: after.name().to_string(),
        swaps: SwapReport::of_glyph(font, after),
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LayerReport {
    layer_id: String,
    glyph_id: String,
    /// `None` for a layer placed by coordinates alone.
    source_id: Option<String>,
    /// Coordinates that place the layer off its source, by axis tag; empty
    /// for a layer exactly on its source.
    location: BTreeMap<String, f64>,
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
            source_id: layer.source_id().map(|source_id| source_id.to_string()),
            location: layer
                .location()
                .coordinates()
                .iter()
                .map(|(axis_id, value)| (axis_tag(font, *axis_id), *value))
                .collect(),
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
        let source = self.source_id.as_deref().unwrap_or("no source");
        let place = if self.location.is_empty() {
            source.to_string()
        } else {
            let coordinates: Vec<String> = self
                .location
                .iter()
                .map(|(tag, value)| format!("{tag}={value}"))
                .collect();
            format!("{source} + {}", coordinates.join(","))
        };
        format!(
            "{marker} layer   {}  {} @ {}  advance {}; {} contours, {} points, {} anchors, {} components",
            self.layer_id,
            self.glyph_id,
            place,
            self.advance,
            self.contour_count,
            self.point_count,
            self.anchor_count,
            self.component_count
        )
    }
}

impl Report for AuthoringReport {
    fn render(&self) -> String {
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
                    lines.push(format!("~ {}", metrics.render()));
                }
                AuthoringChange::GlyphCreated {
                    glyph_id,
                    name,
                    unicodes,
                    mark_color,
                } => {
                    let unicodes = unicodes.join(", ");
                    let suffix = if unicodes.is_empty() {
                        String::new()
                    } else {
                        format!("  {unicodes}")
                    };
                    lines.push(format!(
                        "+ glyph   {name}  {glyph_id}{suffix}{}",
                        mark_color_suffix(mark_color.as_deref())
                    ));
                }
                AuthoringChange::GlyphUpdated {
                    glyph_id,
                    name,
                    unicodes,
                    mark_color,
                } => {
                    lines.push(format!(
                        "~ glyph   {name}  {glyph_id}  [{}]{}",
                        unicodes.join(", "),
                        mark_color_suffix(mark_color.as_deref())
                    ));
                }
                AuthoringChange::GlyphLayerCreated { layer } => lines.push(layer.render('+')),
                AuthoringChange::GlyphLayerUpdated { layer } => lines.push(layer.render('~')),
                AuthoringChange::GlyphLayerDeleted { layer_id, glyph_id } => {
                    lines.push(format!("- layer   {layer_id}  {glyph_id}"));
                }
                AuthoringChange::GlyphAxisCreated { axis } => lines.push(axis.render('+')),
                AuthoringChange::GlyphAxisUpdated { axis } => lines.push(axis.render('~')),
                AuthoringChange::GlyphAxisDeleted { axis } => lines.push(axis.render('-')),
                AuthoringChange::GlyphSwapsSet {
                    glyph_name, swaps, ..
                } => {
                    lines.push(format!("~ swaps  {glyph_name}"));
                    if swaps.is_empty() {
                        lines.push("    none".to_string());
                    }
                    lines.extend(swaps.iter().map(|swap| format!("    {}", swap.render())));
                }
                AuthoringChange::NamedInstancesUpdated { count, instances } => {
                    lines.push(format!("~ instances  {count} product presets"));
                    lines.extend(instances.iter().map(InstanceReport::render));
                }
                AuthoringChange::KerningGroupCreated { group } => {
                    lines.push(format!("+ group   {}", group.render()));
                }
                AuthoringChange::KerningGroupUpdated { group } => {
                    lines.push(format!("~ group   {}", group.render()));
                }
                AuthoringChange::KerningGroupDeleted { position, name, .. } => {
                    lines.push(format!("- group   {position:<6} @{name}"));
                }
                AuthoringChange::KerningValueSet {
                    source_id,
                    source_name,
                    first,
                    second,
                    value,
                    previous,
                } => {
                    let marker = if previous.is_some() { '~' } else { '+' };
                    let source = source_name.as_deref().unwrap_or(source_id);
                    lines.push(format!(
                        "{marker} kern    {} {}  {value} @ {source}",
                        first.label(),
                        second.label()
                    ));
                }
                AuthoringChange::KerningValueRemoved {
                    source_id,
                    source_name,
                    first,
                    second,
                    previous,
                } => {
                    let source = source_name.as_deref().unwrap_or(source_id);
                    lines.push(format!(
                        "- kern    {} {}  was {previous} @ {source}",
                        first.label(),
                        second.label()
                    ));
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
            version: FontVersion::from_metadata(metadata.version_major, metadata.version_minor)
                .map(|version| version.to_string()),
            metadata,
        });
    }

    report.extend(
        changes
            .entity_changes()
            .into_iter()
            .flat_map(|change| match change {
                FontEntityChange::Glyph(EntityChange::Created(glyph)) => {
                    let mut reported = vec![AuthoringChange::GlyphCreated {
                        glyph_id: glyph.id().to_string(),
                        name: glyph.glyph_name().to_string(),
                        unicodes: format_unicodes(glyph.unicodes()),
                        mark_color: glyph.mark_color().map(|color| color.to_string()),
                    }];
                    reported.extend(glyph_axis_changes(None, Some(glyph)));
                    reported.extend(swap_changes(font, None, glyph));
                    reported
                }
                FontEntityChange::Glyph(EntityChange::Updated { before, after }) => {
                    let mut reported = vec![AuthoringChange::GlyphUpdated {
                        glyph_id: after.id().to_string(),
                        name: after.glyph_name().to_string(),
                        unicodes: format_unicodes(after.unicodes()),
                        mark_color: after.mark_color().map(|color| color.to_string()),
                    }];
                    reported.extend(glyph_axis_changes(Some(before), Some(after)));
                    reported.extend(swap_changes(font, Some(before), after));
                    reported
                }
                other => entity_report(font, &other).into_iter().collect(),
            }),
    );

    // Groups first, so a report reads in the order a batch applies.
    report.extend(changes.changes.iter().filter_map(|change| match change {
        FontChange::KerningGroup { group_id, group } => {
            kerning_group_change(font, *group_id, group.before.as_ref(), group.after.as_ref())
        }
        _ => None,
    }));
    report.extend(changes.changes.iter().filter_map(|change| match change {
        FontChange::KerningValue {
            source_id,
            pair,
            value,
        } => kerning_value_change(font, *source_id, pair, value.before, value.after),
        _ => None,
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

/// The report of one entity change other than a glyph's.
fn entity_report(font: &Font, change: &FontEntityChange<'_>) -> Option<AuthoringChange> {
    match change {
        FontEntityChange::Axis(EntityChange::Created(axis)) => Some(AuthoringChange::AxisCreated {
            axis_id: axis.id().to_string(),
            tag: axis.tag().to_string(),
            name: axis.name().to_string(),
            minimum: axis.minimum(),
            default: axis.default(),
            maximum: axis.maximum(),
        }),
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
                        let axis = font.axis(*axis_id)?;
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
        FontEntityChange::Layer {
            glyph_id,
            change: EntityChange::Deleted(layer),
        } => Some(AuthoringChange::GlyphLayerDeleted {
            layer_id: layer.id().to_string(),
            glyph_id: glyph_id.to_string(),
        }),
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
}

fn kerning_group_change(
    font: &Font,
    group_id: KerningGroupId,
    before: Option<&KerningGroup>,
    after: Option<&KerningGroup>,
) -> Option<AuthoringChange> {
    match (before, after) {
        (None, Some(group)) => Some(AuthoringChange::KerningGroupCreated {
            group: GroupReport::from_group(font, group_id, group),
        }),
        (Some(_), Some(group)) => Some(AuthoringChange::KerningGroupUpdated {
            group: GroupReport::from_group(font, group_id, group),
        }),
        (Some(group), None) => Some(AuthoringChange::KerningGroupDeleted {
            group_id: group_id.to_string(),
            position: position_label(group.position),
            name: group.name.clone(),
        }),
        (None, None) => None,
    }
}

fn kerning_value_change(
    font: &Font,
    source_id: SourceId,
    pair: &KerningPair,
    before: Option<f64>,
    after: Option<f64>,
) -> Option<AuthoringChange> {
    let PairReport { first, second } = PairReport::from_pair(font, pair);
    let source_name = font
        .source(source_id)
        .map(|source| source.name().to_string());
    match (before, after) {
        (previous, Some(value)) => Some(AuthoringChange::KerningValueSet {
            source_id: source_id.to_string(),
            source_name,
            first,
            second,
            value,
            previous,
        }),
        (Some(previous), None) => Some(AuthoringChange::KerningValueRemoved {
            source_id: source_id.to_string(),
            source_name,
            first,
            second,
            previous,
        }),
        (None, None) => None,
    }
}

/// An axis's tag, a font axis or a glyph's own, else its id.
fn axis_tag(font: &Font, axis_id: AxisId) -> String {
    font.axis(axis_id)
        .map(|axis| axis.tag().to_string())
        .or_else(|| font.glyph_axis(axis_id).map(|axis| axis.tag().to_string()))
        .unwrap_or_else(|| axis_id.to_string())
}

/// A glyph line's mark colour, or nothing for a glyph without one.
fn mark_color_suffix(mark_color: Option<&str>) -> String {
    mark_color.map_or_else(String::new, |color| format!("  mark {color}"))
}

fn format_unicodes(unicodes: &[u32]) -> Vec<String> {
    unicodes
        .iter()
        .map(|unicode| format!("U+{unicode:04X}"))
        .collect()
}
