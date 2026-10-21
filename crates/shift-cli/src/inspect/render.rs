use anstyle::AnsiColor;
use comfy_table::presets::NOTHING;
use comfy_table::{Attribute, Cell, CellAlignment, Color, ContentArrangement, Table};

use crate::format::{Coordinates, Number};

use super::InspectView;
use super::report::{AxisReference, InspectReport};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum RenderMode {
    Plain,
    Styled,
}

impl RenderMode {
    fn header(self, value: &str) -> Cell {
        match self {
            Self::Plain => Cell::new(value),
            Self::Styled => Cell::new(value)
                .add_attribute(Attribute::Bold)
                .fg(Color::DarkGrey),
        }
    }

    fn accent(self, value: &str) -> Cell {
        match self {
            Self::Plain => Cell::new(value),
            Self::Styled => Cell::new(value).fg(Color::Cyan),
        }
    }

    fn muted(self, value: impl Into<String>) -> Cell {
        let value = value.into();
        match self {
            Self::Plain => Cell::new(value),
            Self::Styled => Cell::new(value).fg(Color::DarkGrey),
        }
    }

    fn muted_text(self, value: &str) -> String {
        match self {
            Self::Plain => value.to_string(),
            Self::Styled => format!(
                "{}{}{}",
                anstyle::Style::new()
                    .fg_color(Some(AnsiColor::BrightBlack.into()))
                    .render(),
                value,
                anstyle::Reset.render()
            ),
        }
    }

    fn styled_title(self, value: &str) -> String {
        match self {
            Self::Plain => value.to_string(),
            Self::Styled => format!(
                "{}{}{}",
                anstyle::Style::new().bold().render(),
                value,
                anstyle::Reset.render()
            ),
        }
    }

    fn styled_section(self, value: &str) -> String {
        match self {
            Self::Plain => value.to_string(),
            Self::Styled => format!(
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

    /// Renders label/value rows with values aligned two spaces past the longest label.
    fn key_values(self, rows: &[(&str, String)]) -> Vec<String> {
        let width = rows
            .iter()
            .map(|(label, _)| label.chars().count() + 2)
            .max()
            .unwrap_or(0);
        rows.iter()
            .map(|(label, value)| match self {
                Self::Plain => format!("{label:<width$}{value}"),
                Self::Styled => format!(
                    "{}{label:<width$}{}{value}",
                    anstyle::Style::new()
                        .fg_color(Some(AnsiColor::BrightBlack.into()))
                        .render(),
                    anstyle::Reset.render(),
                ),
            })
            .collect()
    }

    fn empty_section(self, title: &str, message: &str) -> String {
        format!(
            "{}\n{}",
            self.styled_section(title),
            self.muted_text(message)
        )
    }

    fn section_with_table(self, title: &str, table: &Table) -> String {
        format!("{}\n{}", self.styled_section(title), table)
    }
}

impl InspectReport {
    pub(crate) fn render(&self, view: InspectView, mode: RenderMode) -> String {
        match view {
            InspectView::Summary => self.render_summary(mode),
            InspectView::Axes => self.render_axes(mode),
            InspectView::Mappings => self.render_mappings(mode),
            InspectView::Instances => self.render_instances(mode),
            InspectView::Sources => self.render_sources(mode),
            InspectView::Glyphs => self.render_glyphs(mode),
            InspectView::Layers => self.render_layers(mode),
            InspectView::Kerning => self.render_kerning(mode),
        }
    }

    fn render_summary(&self, mode: RenderMode) -> String {
        let mut lines = vec![mode.styled_title(&self.file_name)];
        lines.extend(mode.key_values(&[
            ("app id", self.document.application_id.clone()),
            ("schema", self.document.schema_version.to_string()),
            ("document", self.document.document_id.clone()),
        ]));
        lines.push(String::new());
        lines.extend(mode.key_values(&[
            ("axes", self.axes.len().to_string()),
            ("mappings", self.axis_mappings.len().to_string()),
            ("instances", self.named_instances.len().to_string()),
            (
                "metric definitions",
                self.metric_definitions.len().to_string(),
            ),
            ("sources", self.sources.len().to_string()),
            ("glyphs", self.glyph_count.to_string()),
            ("kerning pairs", self.kerning.pair_count().to_string()),
        ]));

        if !self.sources.is_empty() {
            lines.push(String::new());
            lines.push(mode.styled_section("Sources"));
            lines.push(self.sources_table(mode));
        }

        lines.join("\n")
    }

    fn render_axes(&self, mode: RenderMode) -> String {
        if self.axes.is_empty() {
            return mode.empty_section("Axes", "No axes");
        }

        let mut table = base_table();
        table.set_header(vec![
            mode.header("tag"),
            mode.header("name"),
            mode.header("id"),
            mode.header("role"),
            mode.header("kind"),
            mode.header("min"),
            mode.header("default"),
            mode.header("max"),
            mode.header("values"),
            mode.header("labels"),
            mode.header("hidden"),
        ]);
        for axis in &self.axes {
            table.add_row(vec![
                mode.accent(&axis.tag),
                Cell::new(axis.name.clone()),
                mode.muted(compact_id(&axis.id)),
                Cell::new(axis.role.clone()),
                Cell::new(axis.kind.clone()),
                number(axis.minimum),
                number(axis.default),
                number(axis.maximum),
                right(axis.values.as_ref().map_or(0, Vec::len)),
                right(axis.labels.len()),
                right(axis.hidden),
            ]);
        }
        align_right(&mut table, &[5, 6, 7, 8, 9, 10]);

        let axes = mode.section_with_table("Axes", &table);
        if self.axes.iter().all(|axis| axis.labels.is_empty()) {
            return axes;
        }

        let mut values = base_table();
        values.set_header(vec![
            mode.header("axis"),
            mode.header("name"),
            mode.header("id"),
            mode.header("value"),
            mode.header("min"),
            mode.header("max"),
            mode.header("linked"),
            mode.header("elidable"),
        ]);
        for axis in &self.axes {
            for label in &axis.labels {
                values.add_row(vec![
                    mode.accent(&axis.tag),
                    Cell::new(label.name.clone()),
                    mode.muted(compact_id(&label.id)),
                    number(label.value),
                    optional_number(label.minimum),
                    optional_number(label.maximum),
                    optional_number(label.linked_value),
                    right(label.elidable),
                ]);
            }
        }
        align_right(&mut values, &[3, 4, 5, 6, 7]);

        format!(
            "{axes}\n\n{}",
            mode.section_with_table("Axis Values", &values)
        )
    }

    fn render_mappings(&self, mode: RenderMode) -> String {
        if self.axis_mappings.is_empty() {
            return mode.empty_section("Mappings", "No axis mappings");
        }

        let mut table = base_table();
        table.set_header(vec![
            mode.header("name"),
            mode.header("kind"),
            mode.header("inputs"),
            mode.header("outputs"),
            mode.header("points"),
            mode.header("id"),
        ]);
        for mapping in &self.axis_mappings {
            table.add_row(vec![
                Cell::new(mapping.name.clone()),
                Cell::new(mapping.kind.clone()),
                Cell::new(format_axis_references(&mapping.inputs)),
                Cell::new(format_axis_references(&mapping.outputs)),
                right(mapping.points.len()),
                mode.muted(compact_id(&mapping.id)),
            ]);
        }
        align_right(&mut table, &[4]);

        mode.section_with_table("Mappings", &table)
    }

    fn render_sources(&self, mode: RenderMode) -> String {
        if self.sources.is_empty() {
            return mode.empty_section("Sources", "No sources");
        }

        format!(
            "{}\n{}",
            mode.styled_section("Sources"),
            self.sources_table(mode)
        )
    }

    fn render_instances(&self, mode: RenderMode) -> String {
        if self.named_instances.is_empty() {
            return mode.empty_section("Instances", "No named instances");
        }

        let mut table = base_table();
        table.set_header(vec![
            mode.header("name"),
            mode.header("id"),
            mode.header("external location"),
            mode.header("PostScript name"),
        ]);
        for instance in &self.named_instances {
            table.add_row(vec![
                Cell::new(instance.name.clone()),
                mode.muted(compact_id(&instance.id)),
                Cell::new(Coordinates::of(&instance.location)),
                Cell::new(instance.postscript_name.as_deref().unwrap_or("-")),
            ]);
        }

        mode.section_with_table("Instances", &table)
    }

    fn render_glyphs(&self, mode: RenderMode) -> String {
        if self.glyphs.is_empty() {
            return mode.empty_section("Glyphs", "No glyphs");
        }

        let mut table = base_table();
        table.set_header(vec![
            mode.header("name"),
            mode.header("id"),
            mode.header("unicode"),
            mode.header("layers"),
        ]);
        for glyph in &self.glyphs {
            table.add_row(vec![
                Cell::new(glyph.name.clone()),
                mode.muted(compact_id(&glyph.id)),
                Cell::new(display_list(&glyph.unicodes)),
                right(glyph.layer_count),
            ]);
        }
        align_right(&mut table, &[3]);

        mode.section_with_table("Glyphs", &table)
    }

    fn render_layers(&self, mode: RenderMode) -> String {
        if self.glyphs.iter().all(|glyph| glyph.layers.is_empty()) {
            return mode.empty_section("Layers", "No layers");
        }

        let mut table = base_table();
        table.set_header(vec![
            mode.header("glyph"),
            mode.header("layer"),
            mode.header("source"),
            mode.header("advance"),
            mode.header("contours"),
            mode.header("points"),
            mode.header("anchors"),
            mode.header("components"),
        ]);
        for glyph in &self.glyphs {
            for layer in &glyph.layers {
                table.add_row(vec![
                    Cell::new(glyph.name.clone()),
                    mode.muted(compact_id(&layer.id)),
                    Cell::new(source_label(layer.source_name.as_deref(), &layer.source_id)),
                    right(Number(layer.advance)),
                    right(layer.contour_count),
                    right(layer.point_count),
                    right(layer.anchor_count),
                    right(layer.component_count),
                ]);
            }
        }
        align_right(&mut table, &[3, 4, 5, 6, 7]);

        mode.section_with_table("Layers", &table)
    }

    fn render_kerning(&self, mode: RenderMode) -> String {
        let kerning = &self.kerning;
        let group_count = kerning.first_group_count + kerning.second_group_count;
        if group_count == 0 && kerning.pair_count() == 0 {
            return mode.empty_section("Kerning", "No kerning");
        }

        let mut lines = vec![mode.styled_section("Kerning")];
        lines.extend(mode.key_values(&[
            ("first groups", kerning.first_group_count.to_string()),
            ("second groups", kerning.second_group_count.to_string()),
            ("empty groups", kerning.empty_group_count.to_string()),
        ]));
        lines.push(String::new());
        let mut table = base_table();
        table.set_header(vec![
            mode.header("master"),
            mode.header("pairs"),
            mode.header("glyph"),
            mode.header("exception"),
            mode.header("group"),
            mode.header("unresolved"),
        ]);
        for source in &kerning.sources {
            if source.pair_count == 0 {
                table.add_row(vec![Cell::new(source.name.clone()), mode.muted("no pairs")]);
                continue;
            }
            table.add_row(vec![
                Cell::new(source.name.clone()),
                right(source.pair_count),
                right(source.glyph_pair_count),
                right(source.exception_count),
                right(source.group_pair_count),
                right(source.unresolved_count),
            ]);
        }
        align_right(&mut table, &[1, 2, 3, 4, 5]);
        lines.push(table.to_string());
        lines.join("\n")
    }

    fn sources_table(&self, mode: RenderMode) -> String {
        let mut table = base_table();
        table.set_header(vec![
            mode.header("name"),
            mode.header("id"),
            mode.header("location"),
            mode.header("metrics"),
            mode.header("file"),
        ]);
        for source in &self.sources {
            table.add_row(vec![
                Cell::new(source_name(source.name.as_str(), source.is_default)),
                mode.muted(compact_id(&source.id)),
                Cell::new(Coordinates::of(&source.location)),
                Cell::new(
                    source
                        .metric_values
                        .iter()
                        .map(|value| {
                            format!(
                                "{} {}/{}",
                                value.name,
                                Number(value.position),
                                Number(value.overshoot)
                            )
                        })
                        .collect::<Vec<_>>()
                        .join(", "),
                ),
                Cell::new(source.filename.as_deref().unwrap_or("-")),
            ]);
        }

        table.to_string()
    }
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

fn number(value: f64) -> Cell {
    Cell::new(Number(value)).set_alignment(CellAlignment::Right)
}

fn optional_number(value: Option<f64>) -> Cell {
    match value {
        Some(value) => number(value),
        None => right("-"),
    }
}

#[allow(
    clippy::needless_pass_by_value,
    reason = "a display helper called with values and temporaries"
)]
fn right(value: impl ToString) -> Cell {
    Cell::new(value.to_string()).set_alignment(CellAlignment::Right)
}

fn source_name(name: &str, is_default: bool) -> String {
    if is_default {
        format!("{name}*")
    } else {
        name.to_string()
    }
}

fn source_label(name: Option<&str>, source_id: &str) -> String {
    match name {
        Some(name) => name.to_string(),
        None => compact_id(source_id),
    }
}

fn display_list(values: &[String]) -> String {
    if values.is_empty() {
        "-".to_string()
    } else {
        values.join(" ")
    }
}

fn format_axis_references(axes: &[AxisReference]) -> String {
    if axes.is_empty() {
        return "-".to_string();
    }

    axes.iter()
        .map(|axis| axis.tag.as_str())
        .collect::<Vec<_>>()
        .join(" ")
}

fn compact_id(value: &str) -> String {
    const MAX: usize = 22;
    const HEAD: usize = 16;

    if value.chars().count() <= MAX {
        value.to_string()
    } else {
        format!("{}...", value.chars().take(HEAD).collect::<String>())
    }
}
