//! Stable kerning reports and their plain-text rendering.

use std::path::PathBuf;

use serde::Serialize;
use shift_font::{Font, GlyphId, KerningGroup, KerningGroupId, KerningPair, KerningSide};

use super::selector::{GROUP_PREFIX, position_label};

/// One side of an authored pair. `name` is `None` for a glyph or group the
/// font no longer has; such a pair is kept but never applies.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SideReport {
    Glyph { id: String, name: Option<String> },
    Group { id: String, name: Option<String> },
}

impl SideReport {
    pub(crate) fn from_side(font: &Font, side: &KerningSide) -> Self {
        match side {
            KerningSide::Glyph(glyph_id) => Self::Glyph {
                id: glyph_id.to_string(),
                name: font.glyph(glyph_id).map(|glyph| glyph.name().to_string()),
            },
            KerningSide::Group(group_id) => Self::Group {
                id: group_id.to_string(),
                name: font
                    .kerning()
                    .group(group_id)
                    .map(|group| group.name.clone()),
            },
        }
    }

    /// Renders the side as a glyph name, `@group`, or its id when missing.
    pub(crate) fn label(&self) -> String {
        match self {
            Self::Glyph { id, name } => name.clone().unwrap_or_else(|| format!("{id} (missing)")),
            Self::Group { id, name } => match name {
                Some(name) => format!("{GROUP_PREFIX}{name}"),
                None => format!("{GROUP_PREFIX}{id} (missing)"),
            },
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairReport {
    pub first: SideReport,
    pub second: SideReport,
}

impl PairReport {
    pub(crate) fn from_pair(font: &Font, pair: &KerningPair) -> Self {
        Self {
            first: SideReport::from_side(font, &pair.first),
            second: SideReport::from_side(font, &pair.second),
        }
    }

    pub(crate) fn label(&self) -> String {
        format!("{} {}", self.first.label(), self.second.label())
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceReference {
    pub source_id: String,
    pub name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphReference {
    pub glyph_id: String,
    pub name: Option<String>,
}

impl GlyphReference {
    pub(crate) fn from_id(font: &Font, glyph_id: &GlyphId) -> Self {
        Self {
            glyph_id: glyph_id.to_string(),
            name: font.glyph(glyph_id).map(|glyph| glyph.name().to_string()),
        }
    }

    fn label(&self) -> &str {
        self.name.as_deref().unwrap_or(&self.glyph_id)
    }
}

/// Authored pairs, with one value column per listed source.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KerningListReport {
    pub document: PathBuf,
    pub sources: Vec<SourceReference>,
    pub pairs: Vec<PairRow>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairRow {
    #[serde(flatten)]
    pub pair: PairReport,
    /// Values in the order of the report's `sources`; `None` is not authored there.
    pub values: Vec<Option<f64>>,
}

impl KerningListReport {
    pub fn render(&self) -> String {
        let mut lines = vec![self.document.display().to_string(), String::new()];
        if self.pairs.is_empty() {
            lines.push("No kerning pairs.".to_string());
            return lines.join("\n");
        }

        let mut header = vec!["Pair".to_string()];
        header.extend(self.sources.iter().map(|source| source.name.clone()));
        let mut rows = vec![header];
        for row in &self.pairs {
            let mut cells = vec![row.pair.label()];
            cells.extend(row.values.iter().map(|value| format_value(*value)));
            rows.push(cells);
        }
        let numeric = (1..rows[0].len()).collect::<Vec<_>>();
        lines.extend(render_columns(&rows, &numeric));
        lines.push(String::new());
        lines.push(format!("{} pairs", self.pairs.len()));
        lines.join("\n")
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KerningGroupsReport {
    pub document: PathBuf,
    pub groups: Vec<GroupReport>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupReport {
    pub group_id: String,
    pub position: &'static str,
    pub name: String,
    pub members: Vec<GlyphReference>,
}

impl GroupReport {
    pub(crate) fn from_group(font: &Font, group_id: &KerningGroupId, group: &KerningGroup) -> Self {
        Self {
            group_id: group_id.to_string(),
            position: position_label(group.position),
            name: group.name.clone(),
            members: group
                .members
                .iter()
                .map(|glyph_id| GlyphReference::from_id(font, glyph_id))
                .collect(),
        }
    }

    pub(crate) fn render(&self) -> String {
        let members = self
            .members
            .iter()
            .map(GlyphReference::label)
            .collect::<Vec<_>>()
            .join(" ");
        format!(
            "{:<6} {GROUP_PREFIX}{}  {members}",
            self.position, self.name
        )
    }
}

impl KerningGroupsReport {
    pub fn render(&self) -> String {
        let mut lines = vec![self.document.display().to_string(), String::new()];
        if self.groups.is_empty() {
            lines.push("No kerning groups.".to_string());
            return lines.join("\n");
        }
        lines.extend(self.groups.iter().map(GroupReport::render));
        lines.join("\n")
    }
}

/// Where a glyph pair's value at one master comes from.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum KerningOrigin {
    /// An authored pair at this master applies.
    Authored,
    /// The master authors other pairs but none applies, so the value is zero.
    Unkerned,
    /// The master authors no kerning; the value blends the masters that do.
    Interpolated,
}

/// The kind of authored pair that supplied a value.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum KerningRule {
    /// A glyph-to-glyph pair.
    Glyph,
    /// A glyph-to-group or group-to-glyph pair, overriding the group pair.
    Exception,
    /// A group-to-group pair.
    Group,
    /// No authored pair applies.
    None,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KerningResolutionReport {
    pub document: PathBuf,
    pub first: GlyphSides,
    pub second: GlyphSides,
    pub masters: Vec<MasterKerning>,
    pub location: Option<LocationKerning>,
}

/// A glyph and the group it belongs to at its side of the pair.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphSides {
    #[serde(flatten)]
    pub glyph: GlyphReference,
    pub group: Option<SideReport>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MasterKerning {
    #[serde(flatten)]
    pub source: SourceReference,
    pub value: f64,
    pub origin: KerningOrigin,
    pub rule: KerningRule,
    /// The authored pair that supplied the value, when `origin` is authored.
    pub pair: Option<PairReport>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocationKerning {
    pub external: Vec<AxisValue>,
    pub design: Vec<AxisValue>,
    pub value: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AxisValue {
    pub axis_tag: String,
    pub value: f64,
}

impl KerningResolutionReport {
    pub fn render(&self) -> String {
        let side = |sides: &GlyphSides| match &sides.group {
            Some(group) => format!("{} ({})", sides.glyph.label(), group.label()),
            None => sides.glyph.label().to_string(),
        };
        let mut lines = vec![
            self.document.display().to_string(),
            String::new(),
            format!("{} {}", side(&self.first), side(&self.second)),
            String::new(),
        ];

        let mut rows = Vec::new();
        for master in &self.masters {
            let source = match master.origin {
                KerningOrigin::Authored => master
                    .pair
                    .as_ref()
                    .map(PairReport::label)
                    .unwrap_or_default(),
                KerningOrigin::Unkerned => "no pair".to_string(),
                KerningOrigin::Interpolated => "interpolated".to_string(),
            };
            rows.push(vec![
                master.source.name.clone(),
                format_number(master.value),
                source,
            ]);
        }
        lines.extend(render_columns(&rows, &[1]));

        if let Some(location) = &self.location {
            let coordinates = location
                .external
                .iter()
                .map(|axis| format!("{}={}", axis.axis_tag, format_number(axis.value)))
                .collect::<Vec<_>>()
                .join(", ");
            lines.push(String::new());
            lines.push(format!(
                "At {coordinates}: {}",
                format_number(location.value)
            ));
        }
        lines.join("\n")
    }
}

fn format_value(value: Option<f64>) -> String {
    value.map_or_else(|| "-".to_string(), format_number)
}

pub(crate) fn format_number(value: f64) -> String {
    let rounded = (value * 1000.0).round() / 1000.0;
    if rounded == 0.0 {
        return "0".to_string();
    }
    rounded.to_string()
}

/// Pads cells into columns, right-aligning the `numeric` ones.
fn render_columns(rows: &[Vec<String>], numeric: &[usize]) -> Vec<String> {
    let column_count = rows.iter().map(Vec::len).max().unwrap_or(0);
    let widths = (0..column_count)
        .map(|column| {
            rows.iter()
                .filter_map(|row| row.get(column))
                .map(|cell| cell.chars().count())
                .max()
                .unwrap_or(0)
        })
        .collect::<Vec<_>>();

    rows.iter()
        .map(|row| {
            row.iter()
                .zip(&widths)
                .enumerate()
                .map(|(column, (cell, width))| {
                    if numeric.contains(&column) {
                        format!("{cell:>width$}")
                    } else {
                        format!("{cell:<width$}")
                    }
                })
                .collect::<Vec<_>>()
                .join("  ")
                .trim_end()
                .to_string()
        })
        .collect()
}
