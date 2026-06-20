use std::collections::HashMap;
use std::fmt::Display;
use std::path::{Path, PathBuf};

use anstyle::AnsiColor;
use comfy_table::presets::NOTHING;
use comfy_table::{Attribute, Cell, CellAlignment, Color, ContentArrangement, Table};
use miette::Diagnostic;
use serde::Serialize;
use shift_font::{Axis, Font, Glyph, Source, SourceId};
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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InspectOutput {
    Summary,
    Axes,
    Sources,
    Glyphs,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RenderMode {
    Plain,
    Styled,
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

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSummary {
    pub id: String,
    pub name: String,
    pub location: Vec<LocationValue>,
    pub filename: Option<String>,
    pub is_default: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocationValue {
    pub axis_id: String,
    pub axis_tag: String,
    pub value: String,
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

    fn from_font(path: &Path, font: &Font) -> Self {
        let axes_by_id = axes_by_id(font.axes());
        let default_source_id = font.default_source_id();
        let glyphs = font.glyphs().map(GlyphSummary::from).collect::<Vec<_>>();

        Self {
            path: path.display().to_string(),
            file_name: path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_else(|| path.to_str().unwrap_or("<package>"))
                .to_string(),
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

    pub fn render(&self, output: InspectOutput, mode: RenderMode) -> String {
        match output {
            InspectOutput::Summary => self.render_summary(mode),
            InspectOutput::Axes => self.render_axes(mode),
            InspectOutput::Sources => self.render_sources(mode),
            InspectOutput::Glyphs => self.render_glyphs(mode),
        }
    }

    fn render_summary(&self, mode: RenderMode) -> String {
        let mut lines = vec![
            styled_title(&self.file_name, mode),
            format_kv("format", &self.manifest.format, mode),
            format_kv("schema", &self.manifest.schema_version.to_string(), mode),
            String::new(),
            format_count("axes", self.axes.len(), mode),
            format_count("sources", self.sources.len(), mode),
            format_count("glyphs", self.glyph_count, mode),
        ];

        if !self.sources.is_empty() {
            lines.push(String::new());
            lines.push(styled_section("Sources", mode));
            lines.push(self.sources_table(mode));
        }

        lines.join("\n")
    }

    fn render_axes(&self, mode: RenderMode) -> String {
        if self.axes.is_empty() {
            return format!(
                "{}\n{}",
                styled_section("Axes", mode),
                muted_text("No axes", mode)
            );
        }

        let mut table = base_table();
        table.set_header(vec![
            header("tag", mode),
            header("name", mode),
            header("id", mode),
            header("min", mode),
            header("default", mode),
            header("max", mode),
            header("hidden", mode),
        ]);
        for axis in &self.axes {
            table.add_row(vec![
                accent(&axis.tag, mode),
                Cell::new(axis.name.clone()),
                muted(compact_id(&axis.id), mode),
                number(axis.minimum),
                number(axis.default),
                number(axis.maximum),
                Cell::new(axis.hidden.to_string()).set_alignment(CellAlignment::Right),
            ]);
        }
        align_right(&mut table, &[3, 4, 5, 6]);

        format!("{}\n{}", styled_section("Axes", mode), table)
    }

    fn render_sources(&self, mode: RenderMode) -> String {
        if self.sources.is_empty() {
            return format!(
                "{}\n{}",
                styled_section("Sources", mode),
                muted_text("No sources", mode)
            );
        }

        format!(
            "{}\n{}",
            styled_section("Sources", mode),
            self.sources_table(mode)
        )
    }

    fn render_glyphs(&self, mode: RenderMode) -> String {
        if self.glyphs.is_empty() {
            return format!(
                "{}\n{}",
                styled_section("Glyphs", mode),
                muted_text("No glyphs", mode)
            );
        }

        let mut table = base_table();
        table.set_header(vec![
            header("name", mode),
            header("id", mode),
            header("unicode", mode),
            header("layers", mode),
        ]);
        for glyph in &self.glyphs {
            table.add_row(vec![
                Cell::new(glyph.name.clone()),
                muted(compact_id(&glyph.id), mode),
                Cell::new(if glyph.unicodes.is_empty() {
                    "-".to_string()
                } else {
                    glyph.unicodes.join(" ")
                }),
                Cell::new(glyph.layer_count.to_string()).set_alignment(CellAlignment::Right),
            ]);
        }
        align_right(&mut table, &[3]);

        format!("{}\n{}", styled_section("Glyphs", mode), table)
    }

    fn sources_table(&self, mode: RenderMode) -> String {
        let mut table = base_table();
        table.set_header(vec![
            header("name", mode),
            header("id", mode),
            header("location", mode),
            header("file", mode),
        ]);
        for source in &self.sources {
            let name = if source.is_default {
                format!("{}*", source.name)
            } else {
                source.name.clone()
            };
            table.add_row(vec![
                Cell::new(name),
                muted(compact_id(&source.id), mode),
                Cell::new(format_location(&source.location)),
                Cell::new(source.filename.as_deref().unwrap_or("-")),
            ]);
        }

        table.to_string()
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
        axes_by_id: &HashMap<String, String>,
        default_source_id: &Option<SourceId>,
    ) -> Self {
        let mut location = source
            .location()
            .iter()
            .map(|(axis_id, value)| {
                let axis_id = axis_id.to_string();
                let axis_tag = axes_by_id
                    .get(&axis_id)
                    .cloned()
                    .unwrap_or_else(|| axis_id.clone());
                LocationValue {
                    axis_id,
                    axis_tag,
                    value: format_number(*value),
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

fn axes_by_id(axes: &[Axis]) -> HashMap<String, String> {
    axes.iter()
        .map(|axis| (axis.id().to_string(), axis.tag().to_string()))
        .collect()
}

fn base_table() -> Table {
    let mut table = Table::new();
    table.load_preset(NOTHING);
    table.set_content_arrangement(ContentArrangement::Dynamic);
    table
}

fn align_right(table: &mut Table, columns: &[usize]) {
    for column in columns {
        if let Some(column) = table.column_mut(*column) {
            column.set_cell_alignment(CellAlignment::Right);
        }
    }
}

fn header(value: &str, mode: RenderMode) -> Cell {
    match mode {
        RenderMode::Plain => Cell::new(value),
        RenderMode::Styled => Cell::new(value)
            .add_attribute(Attribute::Bold)
            .fg(Color::DarkGrey),
    }
}

fn accent(value: &str, mode: RenderMode) -> Cell {
    match mode {
        RenderMode::Plain => Cell::new(value),
        RenderMode::Styled => Cell::new(value).fg(Color::Cyan),
    }
}

fn muted(value: impl Into<String>, mode: RenderMode) -> Cell {
    let value = value.into();
    match mode {
        RenderMode::Plain => Cell::new(value),
        RenderMode::Styled => Cell::new(value).fg(Color::DarkGrey),
    }
}

fn muted_text(value: &str, mode: RenderMode) -> String {
    match mode {
        RenderMode::Plain => value.to_string(),
        RenderMode::Styled => format!(
            "{}{}{}",
            anstyle::Style::new()
                .fg_color(Some(AnsiColor::BrightBlack.into()))
                .render(),
            value,
            anstyle::Reset.render()
        ),
    }
}

fn number(value: f64) -> Cell {
    Cell::new(format_number(value)).set_alignment(CellAlignment::Right)
}

fn styled_title(value: &str, mode: RenderMode) -> String {
    match mode {
        RenderMode::Plain => value.to_string(),
        RenderMode::Styled => format!(
            "{}{}{}",
            anstyle::Style::new().bold().render(),
            value,
            anstyle::Reset.render()
        ),
    }
}

fn styled_section(value: &str, mode: RenderMode) -> String {
    match mode {
        RenderMode::Plain => value.to_string(),
        RenderMode::Styled => format!(
            "{}{}{}",
            anstyle::Style::new()
                .bold()
                .fg_color(Some(AnsiColor::BrightCyan.into()))
                .render(),
            value,
            anstyle::Reset.render()
        ),
    }
}

fn format_kv(label: &str, value: &str, mode: RenderMode) -> String {
    match mode {
        RenderMode::Plain => format!("{label:<8}{value}"),
        RenderMode::Styled => format!(
            "{}{label:<8}{}{}",
            anstyle::Style::new()
                .fg_color(Some(AnsiColor::BrightBlack.into()))
                .render(),
            anstyle::Reset.render(),
            value
        ),
    }
}

fn format_count(label: &str, value: usize, mode: RenderMode) -> String {
    format_kv(label, &value.to_string(), mode)
}

fn format_location(location: &[LocationValue]) -> String {
    if location.is_empty() {
        "{}".to_string()
    } else {
        location
            .iter()
            .map(|entry| format!("{}={}", entry.axis_tag, entry.value))
            .collect::<Vec<_>>()
            .join(" ")
    }
}

fn format_number(value: f64) -> String {
    if value.fract().abs() < f64::EPSILON {
        return format!("{value:.0}");
    }

    let mut text = format!("{value:.4}");
    while text.contains('.') && text.ends_with('0') {
        text.pop();
    }
    if text.ends_with('.') {
        text.pop();
    }
    text
}

fn compact_id(value: &str) -> String {
    const MAX: usize = 22;
    const HEAD: usize = 16;

    if value.len() <= MAX {
        value.to_string()
    } else {
        format!("{}...", &value[..HEAD])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use shift_font::{Axis, AxisId, Font, Glyph, GlyphLayer, LayerId, Location, Source, SourceId};
    use shift_source::ShiftSourcePackage;

    #[test]
    fn inspect_report_extracts_summary_from_font() {
        let report = InspectReport::from_font(Path::new("/tmp/Dogfood.shift"), &sample_font());

        assert_eq!(report.file_name, "Dogfood.shift");
        assert_eq!(report.manifest.format, "shift-source");
        assert_eq!(report.manifest.schema_version, 1);
        assert_eq!(report.metadata.display_name, "Dogfood Sans Regular");
        assert_eq!(report.axes.len(), 1);
        assert_eq!(report.sources.len(), 2);
        assert_eq!(report.glyph_count, 1);
        assert_eq!(report.sources[1].location[0].axis_tag, "wght");
        assert_eq!(report.sources[1].location[0].value, "700");
    }

    #[test]
    fn load_reads_shift_source_package() {
        let temp = tempfile::tempdir().unwrap();
        let package_path = temp.path().join("Dogfood.shift");
        ShiftSourcePackage::save_font(&package_path, &sample_font()).unwrap();

        let report = InspectReport::load(&package_path).unwrap();

        assert_eq!(report.file_name, "Dogfood.shift");
        assert_eq!(report.axes[0].tag, "wght");
        assert_eq!(report.sources.len(), 2);
        assert_eq!(report.glyph_count, 1);
    }

    #[test]
    fn summary_render_is_quiet_and_aligned() {
        let report = InspectReport::from_font(Path::new("/tmp/Dogfood.shift"), &sample_font());
        let output = report.render(InspectOutput::Summary, RenderMode::Plain);

        assert!(output.contains("Dogfood.shift"));
        assert!(output.contains("format  shift-source"));
        assert!(output.contains("axes    1"));
        assert!(output.contains("Sources"));
        assert!(output.contains("Bold*"));
        assert!(output.contains("wght=700"));
    }

    #[test]
    fn axes_view_has_empty_state() {
        let report = InspectReport::from_font(Path::new("/tmp/Empty.shift"), &Font::new());

        assert_eq!(
            report.render(InspectOutput::Axes, RenderMode::Plain),
            "Axes\nNo axes"
        );
    }

    #[test]
    fn json_output_includes_stable_sections() {
        let report = InspectReport::from_font(Path::new("/tmp/Dogfood.shift"), &sample_font());
        let json = serde_json::to_value(report).unwrap();

        assert_eq!(json["manifest"]["format"], "shift-source");
        assert_eq!(json["axes"][0]["tag"], "wght");
        assert_eq!(json["sources"][1]["location"][0]["axisTag"], "wght");
        assert_eq!(json["glyphs"][0]["unicodes"][0], "U+0041");
    }

    fn sample_font() -> Font {
        let mut font = Font::empty();
        font.metadata_mut().family_name = Some("Dogfood Sans".to_string());
        font.metadata_mut().style_name = Some("Regular".to_string());

        let axis_id = AxisId::from_raw("weight");
        font.add_axis(Axis::with_id(
            axis_id.clone(),
            "wght".to_string(),
            "Weight".to_string(),
            100.0,
            400.0,
            900.0,
        ));

        let regular_id = SourceId::from_raw("regular");
        font.add_source(Source::with_id(
            regular_id.clone(),
            "Regular".to_string(),
            Location::new(),
            None,
        ));

        let bold_id = SourceId::from_raw("bold");
        let mut bold_location = Location::new();
        bold_location.set(axis_id, 700.0);
        font.add_source(Source::with_id(
            bold_id.clone(),
            "Bold".to_string(),
            bold_location,
            Some("Bold.ufo".to_string()),
        ));
        font.set_default_source_id(bold_id.clone());

        let mut glyph = Glyph::with_unicode("A", 0x41);
        glyph.set_layer(GlyphLayer::with_width(
            LayerId::from_raw("A_bold"),
            bold_id,
            600.0,
        ));
        font.insert_glyph(glyph).unwrap();

        font
    }
}
