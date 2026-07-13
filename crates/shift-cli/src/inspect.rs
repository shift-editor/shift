mod render;
mod report;

use clap::ValueEnum;

pub use render::RenderMode;
pub use report::InspectReport;

#[derive(Clone, Copy, Debug, Eq, PartialEq, ValueEnum)]
pub enum InspectView {
    Summary,
    Axes,
    Mappings,
    Sources,
    Glyphs,
    Layers,
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use serde_json::json;
    use shift_font::{
        Axis, AxisId, AxisMapping, AxisMappingPoint, Contour, Font, Glyph, GlyphLayer, LayerId,
        Location, Point, Source, SourceId,
    };
    use shift_source::ShiftSourcePackage;

    use super::*;

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
        assert_eq!(report.sources[1].location[0].value, 700.0);
        assert_eq!(
            report.glyphs[0].layers[0].source_name.as_deref(),
            Some("Bold")
        );
        assert_eq!(report.glyphs[0].layers[0].contour_count, 1);
        assert_eq!(report.glyphs[0].layers[0].point_count, 2);
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
        let output = report.render(InspectView::Summary, RenderMode::Plain);

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
            report.render(InspectView::Axes, RenderMode::Plain),
            "Axes\nNo axes"
        );
    }

    #[test]
    fn mappings_view_reports_mapping_axes_and_points() {
        let mut font = sample_font();
        let axis_id = font.axes()[0].id();
        let mut input = Location::new();
        input.set(axis_id.clone(), 900.0);
        let mut output = Location::new();
        output.set(axis_id.clone(), 800.0);
        font.set_axis_mappings(vec![AxisMapping::new(
            "Weight curve".to_string(),
            vec![axis_id.clone()],
            vec![axis_id],
            vec![AxisMappingPoint {
                description: None,
                input,
                output,
            }],
        )])
        .unwrap();
        let report = InspectReport::from_font(Path::new("/tmp/Dogfood.shift"), &font);

        assert_eq!(report.axis_mappings.len(), 1);
        assert_eq!(report.axis_mappings[0].kind, "independent");
        assert_eq!(report.axis_mappings[0].inputs[0].tag, "wght");
        assert_eq!(report.axis_mappings[0].points[0].output[0].value, 800.0);
        assert!(
            report
                .render(InspectView::Mappings, RenderMode::Plain)
                .contains("Weight curve")
        );
    }

    #[test]
    fn json_output_includes_stable_sections() {
        let report = InspectReport::from_font(Path::new("/tmp/Dogfood.shift"), &sample_font());
        let json = serde_json::to_value(report).unwrap();

        assert_eq!(json["manifest"]["format"], "shift-source");
        assert_eq!(json["axes"][0]["tag"], "wght");
        assert_eq!(json["axisMappings"], json!([]));
        assert_eq!(json["sources"][1]["location"][0]["axisTag"], "wght");
        assert_eq!(json["sources"][1]["location"][0]["value"], json!(700.0));
        assert_eq!(json["glyphs"][0]["unicodes"][0], "U+0041");
        assert_eq!(json["glyphs"][0]["layers"][0]["pointCount"], json!(2));
    }

    #[test]
    fn layers_view_shows_package_layer_counts() {
        let report = InspectReport::from_font(Path::new("/tmp/Dogfood.shift"), &sample_font());
        let output = report.render(InspectView::Layers, RenderMode::Plain);

        assert!(output.contains("Layers"));
        assert!(output.contains("glyph"));
        assert!(output.contains("source"));
        assert!(output.contains("Bold"));
        assert!(output.contains("600"));
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
            regular_id,
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
        let mut layer = GlyphLayer::with_width(LayerId::from_raw("A_bold"), bold_id, 600.0);
        layer.add_contour(Contour::from_points(
            vec![Point::on_curve(0.0, 0.0), Point::on_curve(100.0, 0.0)],
            false,
        ));
        glyph.set_layer(layer);
        font.insert_glyph(glyph).unwrap();

        font
    }
}
