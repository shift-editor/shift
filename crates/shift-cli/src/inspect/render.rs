use anstyle::AnsiColor;
use comfy_table::presets::NOTHING;
use comfy_table::{Attribute, Cell, CellAlignment, Color, ContentArrangement, Table};

use super::InspectView;
use super::report::{InspectReport, LocationValue};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RenderMode {
    Plain,
    Styled,
}

impl InspectReport {
    pub fn render(&self, view: InspectView, mode: RenderMode) -> String {
        match view {
            InspectView::Summary => self.render_summary(mode),
            InspectView::Axes => self.render_axes(mode),
            InspectView::Sources => self.render_sources(mode),
            InspectView::Glyphs => self.render_glyphs(mode),
            InspectView::Layers => self.render_layers(mode),
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
            return empty_section("Axes", "No axes", mode);
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
                right(axis.hidden),
            ]);
        }
        align_right(&mut table, &[3, 4, 5, 6]);

        section_with_table("Axes", table, mode)
    }

    fn render_sources(&self, mode: RenderMode) -> String {
        if self.sources.is_empty() {
            return empty_section("Sources", "No sources", mode);
        }

        format!(
            "{}\n{}",
            styled_section("Sources", mode),
            self.sources_table(mode)
        )
    }

    fn render_glyphs(&self, mode: RenderMode) -> String {
        if self.glyphs.is_empty() {
            return empty_section("Glyphs", "No glyphs", mode);
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
                Cell::new(display_list(&glyph.unicodes)),
                right(glyph.layer_count),
            ]);
        }
        align_right(&mut table, &[3]);

        section_with_table("Glyphs", table, mode)
    }

    fn render_layers(&self, mode: RenderMode) -> String {
        if self.glyphs.iter().all(|glyph| glyph.layers.is_empty()) {
            return empty_section("Layers", "No layers", mode);
        }

        let mut table = base_table();
        table.set_header(vec![
            header("glyph", mode),
            header("layer", mode),
            header("source", mode),
            header("advance", mode),
            header("contours", mode),
            header("points", mode),
            header("anchors", mode),
            header("components", mode),
        ]);
        for glyph in &self.glyphs {
            for layer in &glyph.layers {
                table.add_row(vec![
                    Cell::new(glyph.name.clone()),
                    muted(compact_id(&layer.id), mode),
                    Cell::new(source_label(layer.source_name.as_deref(), &layer.source_id)),
                    right(format_number(layer.advance)),
                    right(layer.contour_count),
                    right(layer.point_count),
                    right(layer.anchor_count),
                    right(layer.component_count),
                ]);
            }
        }
        align_right(&mut table, &[3, 4, 5, 6, 7]);

        section_with_table("Layers", table, mode)
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
            table.add_row(vec![
                Cell::new(source_name(source.name.as_str(), source.is_default)),
                muted(compact_id(&source.id), mode),
                Cell::new(format_location(&source.location)),
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

fn right(value: impl ToString) -> Cell {
    Cell::new(value.to_string()).set_alignment(CellAlignment::Right)
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

fn empty_section(title: &str, message: &str, mode: RenderMode) -> String {
    format!(
        "{}\n{}",
        styled_section(title, mode),
        muted_text(message, mode)
    )
}

fn section_with_table(title: &str, table: Table, mode: RenderMode) -> String {
    format!("{}\n{}", styled_section(title, mode), table)
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

fn format_location(location: &[LocationValue]) -> String {
    if location.is_empty() {
        "{}".to_string()
    } else {
        location
            .iter()
            .map(|entry| format!("{}={}", entry.axis_tag, format_number(entry.value)))
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

    if value.chars().count() <= MAX {
        value.to_string()
    } else {
        format!("{}...", value.chars().take(HEAD).collect::<String>())
    }
}
