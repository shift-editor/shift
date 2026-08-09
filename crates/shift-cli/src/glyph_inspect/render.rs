use comfy_table::presets::NOTHING;
use comfy_table::{Cell, CellAlignment, ContentArrangement, Table};

use crate::inspect::RenderMode;

use super::GlyphInspectView;
use super::types::{Bounds, GlyphInspection, LocationValue};

impl GlyphInspection {
    pub fn render(&self, view: GlyphInspectView, _mode: RenderMode) -> String {
        match view {
            GlyphInspectView::Summary => self.render_summary(),
            GlyphInspectView::Structure => self.render_structure(),
            GlyphInspectView::Sources => self.render_sources(),
            GlyphInspectView::Variation => self.render_variation(),
            GlyphInspectView::Resolved => self.render_resolved(),
        }
    }

    fn render_summary(&self) -> String {
        [
            format!("{}  {}", self.glyph.name, self.glyph.id),
            format!("format      {}", self.format),
            format!("unicode     {}", display_list(&self.glyph.unicodes)),
            format!("external    {}", format_location(&self.location.external)),
            format!("design      {}", format_location(&self.location.design)),
            format!("selection   {}", self.variation.selection),
            format!("advance     {}", format_number(self.summary.advance)),
            format!("bounds      {}", format_bounds(self.summary.bounds)),
            format!(
                "structure   {} contours, {} points, {} anchors, {} direct components",
                self.summary.contour_count,
                self.summary.point_count,
                self.summary.anchor_count,
                self.summary.direct_component_count
            ),
            format!(
                "resolved    {} contours, {} points, {} component occurrences",
                self.summary.resolved_contour_count,
                self.summary.resolved_point_count,
                self.summary.component_occurrence_count
            ),
        ]
        .join("\n")
    }

    fn render_structure(&self) -> String {
        let mut lines = vec![self.render_summary(), String::new(), "Contours".to_string()];
        if self.structure.contours.is_empty() {
            lines.push("No direct contours".to_string());
        } else {
            let mut table = table(&["order", "id", "closed", "points"]);
            for (order, contour) in self.structure.contours.iter().enumerate() {
                table.add_row(vec![
                    right(order),
                    Cell::new(&contour.id),
                    Cell::new(contour.closed),
                    right(contour.points.len()),
                ]);
            }
            lines.push(table.to_string());
        }

        lines.push(String::new());
        lines.push("Anchors".to_string());
        if self.structure.anchors.is_empty() {
            lines.push("No anchors".to_string());
        } else {
            let mut table = table(&["name", "id", "x", "y"]);
            for anchor in &self.structure.anchors {
                table.add_row(vec![
                    Cell::new(anchor.name.as_deref().unwrap_or("-")),
                    Cell::new(&anchor.id),
                    right(format_number(anchor.x)),
                    right(format_number(anchor.y)),
                ]);
            }
            lines.push(table.to_string());
        }

        lines.push(String::new());
        lines.push("Components".to_string());
        if self.components.is_empty() {
            lines.push("No components".to_string());
        } else {
            let mut table = table(&[
                "order", "parent", "base", "path", "tx", "ty", "rotation", "scale x", "scale y",
            ]);
            for component in &self.components {
                table.add_row(vec![
                    right(component.order),
                    Cell::new(&component.parent_glyph_name),
                    Cell::new(&component.base_glyph_name),
                    Cell::new(component.component_path.join("/")),
                    right(format_number(component.decomposed_transform.translate_x)),
                    right(format_number(component.decomposed_transform.translate_y)),
                    right(format_number(component.decomposed_transform.rotation)),
                    right(format_number(component.decomposed_transform.scale_x)),
                    right(format_number(component.decomposed_transform.scale_y)),
                ]);
            }
            lines.push(table.to_string());
        }

        lines.join("\n")
    }

    fn render_sources(&self) -> String {
        let mut lines = vec![self.render_summary(), String::new(), "Sources".to_string()];
        let mut table = table(&[
            "name",
            "location",
            "layer",
            "compatible",
            "contours",
            "points",
            "components",
        ]);
        for source in &self.sources {
            let layer = source.layer.as_ref();
            table.add_row(vec![
                Cell::new(if source.master {
                    source.name.clone()
                } else {
                    format!("{} (layer)", source.name)
                }),
                Cell::new(format_location(&source.location)),
                Cell::new(layer.map_or("-", |layer| layer.id.as_str())),
                Cell::new(match source.compatible_with_reference {
                    Some(true) => "yes",
                    Some(false) => "no",
                    None => "-",
                }),
                right(layer.map_or(0, |layer| layer.contour_count)),
                right(layer.map_or(0, |layer| layer.point_count)),
                right(layer.map_or(0, |layer| layer.component_count)),
            ]);
        }
        lines.push(table.to_string());

        let differences = self
            .sources
            .iter()
            .filter(|source| !source.differences.is_empty())
            .collect::<Vec<_>>();
        if !differences.is_empty() {
            lines.push(String::new());
            lines.push("Compatibility differences".to_string());
            for source in differences {
                for difference in &source.differences {
                    lines.push(format!("{}: {difference}", source.name));
                }
            }
        }

        lines.join("\n")
    }

    fn render_variation(&self) -> String {
        let mut lines = vec![
            self.render_summary(),
            String::new(),
            "Source weights".to_string(),
        ];
        if self.variation.source_weights.is_empty() {
            lines.push("No compatible interpolation basis".to_string());
        } else {
            let mut table = table(&["source", "id", "weight"]);
            for source in &self.variation.source_weights {
                table.add_row(vec![
                    Cell::new(&source.source_name),
                    Cell::new(&source.source_id),
                    right(format_number(source.weight)),
                ]);
            }
            lines.push(table.to_string());
        }

        lines.push(String::new());
        lines.push("Variation regions".to_string());
        if self.variation.regions.is_empty() {
            lines.push("No variation regions".to_string());
        } else {
            let mut table = table(&["order", "supports", "scalar", "values", "non-zero"]);
            for (order, region) in self.variation.regions.iter().enumerate() {
                let supports = region
                    .supports
                    .iter()
                    .map(|support| {
                        format!(
                            "{}={}/{}/{}",
                            support.axis_tag,
                            format_number(support.minimum),
                            format_number(support.peak),
                            format_number(support.maximum)
                        )
                    })
                    .collect::<Vec<_>>()
                    .join(" ");
                table.add_row(vec![
                    right(order),
                    Cell::new(supports),
                    right(format_number(region.scalar)),
                    right(region.value_count),
                    right(region.non_zero_value_count),
                ]);
            }
            lines.push(table.to_string());
        }

        lines.join("\n")
    }

    fn render_resolved(&self) -> String {
        let mut lines = vec![
            self.render_summary(),
            String::new(),
            "Resolved points".to_string(),
        ];
        if self.resolved.contours.is_empty() {
            lines.push("No resolved contours".to_string());
            return lines.join("\n");
        }

        let mut table = table(&["contour", "point", "x", "y", "type", "smooth"]);
        for (contour_index, contour) in self.resolved.contours.iter().enumerate() {
            for (point_index, point) in contour.points.iter().enumerate() {
                table.add_row(vec![
                    right(contour_index),
                    right(point_index),
                    right(format_number(point.x)),
                    right(format_number(point.y)),
                    Cell::new(&point.point_type),
                    Cell::new(point.smooth),
                ]);
            }
        }
        lines.push(table.to_string());
        lines.join("\n")
    }
}

fn table(headers: &[&str]) -> Table {
    let mut table = Table::new();
    table.load_preset(NOTHING);
    table.set_content_arrangement(ContentArrangement::Dynamic);
    table.set_header(headers.iter().map(Cell::new));
    table
}

fn right(value: impl ToString) -> Cell {
    Cell::new(value.to_string()).set_alignment(CellAlignment::Right)
}

fn display_list(values: &[String]) -> String {
    if values.is_empty() {
        "-".to_string()
    } else {
        values.join(" ")
    }
}

fn format_location(location: &[LocationValue]) -> String {
    location
        .iter()
        .map(|coordinate| {
            format!(
                "{}={}",
                coordinate.axis_tag,
                format_number(coordinate.value)
            )
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn format_bounds(bounds: Option<Bounds>) -> String {
    bounds.map_or_else(
        || "-".to_string(),
        |bounds| {
            format!(
                "{},{}, {},{}",
                format_number(bounds.min_x),
                format_number(bounds.min_y),
                format_number(bounds.max_x),
                format_number(bounds.max_y)
            )
        },
    )
}

fn format_number(value: f64) -> String {
    if value.fract().abs() < f64::EPSILON {
        return format!("{value:.0}");
    }

    let mut text = format!("{value:.6}");
    while text.ends_with('0') {
        text.pop();
    }
    if text.ends_with('.') {
        text.pop();
    }
    text
}
