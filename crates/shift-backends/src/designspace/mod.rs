mod axis_labels;
mod error;
mod reader;
mod writer;

pub use error::DesignspaceError;
pub use reader::DesignspaceReader;
pub use writer::DesignspaceWriter;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::traits::{FontReader, FontWriter};
    use shift_font::{
        Axis, AxisKind, AxisLabel, AxisLabelRange, AxisMapping, AxisMappingPoint, Contour, Font,
        Glyph, GlyphLayer, LayerId, Location, PointType,
    };
    use std::fs;

    fn test_font() -> Font {
        let mut font = Font::new();
        font.metadata_mut().family_name = Some("Placeholder Sans".to_string());
        font.metadata_mut().style_name = Some("Regular".to_string());
        font.metrics_mut().units_per_em = 1000.0;

        let mut glyph = Glyph::with_unicode("o".to_string(), 'o' as u32);
        let mut layer =
            GlyphLayer::with_width(LayerId::new(), font.default_source_id().unwrap(), 520.0);
        let mut contour = Contour::new();
        contour.add_point(100.0, 0.0, PointType::OnCurve, false);
        contour.add_point(420.0, 0.0, PointType::OnCurve, false);
        contour.add_point(420.0, 500.0, PointType::OnCurve, false);
        contour.add_point(100.0, 500.0, PointType::OnCurve, false);
        contour.close();
        layer.add_contour(contour);
        glyph.set_layer(layer);
        font.insert_glyph(glyph).unwrap();

        font
    }

    #[test]
    fn writes_designspace_with_companion_ufo() {
        let temp_dir = std::env::temp_dir().join("shift_test_designspace_writer");
        let designspace_path = temp_dir.join("PlaceholderSans.designspace");
        let ufo_path = temp_dir.join("PlaceholderSans.ufo");
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir).unwrap();

        let font = test_font();
        DesignspaceWriter::new()
            .save(&font, designspace_path.to_str().unwrap())
            .unwrap();

        assert!(designspace_path.exists());
        assert!(ufo_path.exists());
        let designspace_xml = fs::read_to_string(&designspace_path).unwrap();
        assert!(!designspace_xml.contains("<axis "));
        assert!(!designspace_xml.contains("<location"));
        assert!(designspace_xml.contains("PlaceholderSans.ufo"));

        let loaded = DesignspaceReader::new()
            .load(designspace_path.to_str().unwrap())
            .unwrap();

        assert!(loaded.axes().is_empty());
        assert_eq!(
            loaded.metadata().family_name.as_deref(),
            Some("Placeholder Sans")
        );
        assert_eq!(loaded.glyph_count(), 1);
        assert!(loaded.glyph_by_name("o").is_some());

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn round_trips_axis_kinds_labels_and_mappings() {
        let temp_dir = tempfile::tempdir().unwrap();
        let designspace_path = temp_dir.path().join("Mapped.designspace");
        let mut font = test_font();

        let mut weight = Axis::weight();
        weight.set_labels(vec![AxisLabel::new(
            "Regular".to_string(),
            400.0,
            Some(AxisLabelRange {
                minimum: 350.0,
                maximum: 450.0,
            }),
            None,
            true,
        )]);
        let weight_id = weight.id();
        font.add_axis(weight).expect("weight axis should be valid");

        let italic = Axis::discrete_with_id(
            shift_font::AxisId::new(),
            "ital".to_string(),
            "Italic".to_string(),
            vec![0.0, 1.0],
            0.0,
        );
        let italic_id = italic.id();
        font.add_axis(italic).expect("italic axis should be valid");

        let independent = AxisMapping::new(
            "Weight curve".to_string(),
            vec![weight_id.clone()],
            vec![weight_id.clone()],
            vec![
                mapping_point(&[(weight_id.clone(), 100.0)], &[(weight_id.clone(), 80.0)]),
                mapping_point(&[(weight_id.clone(), 400.0)], &[(weight_id.clone(), 400.0)]),
                mapping_point(&[(weight_id.clone(), 900.0)], &[(weight_id.clone(), 850.0)]),
            ],
        );
        let mut cross = AxisMapping::new(
            "Weight by italic".to_string(),
            vec![weight_id.clone(), italic_id.clone()],
            vec![weight_id.clone()],
            vec![mapping_point(
                &[(weight_id.clone(), 850.0), (italic_id.clone(), 1.0)],
                &[(weight_id.clone(), 800.0)],
            )],
        );
        cross.set_description(Some("Italic masters become lighter".to_string()));
        font.set_axis_mappings(vec![independent, cross]).unwrap();

        DesignspaceWriter::new()
            .save(&font, designspace_path.to_str().unwrap())
            .unwrap();

        let xml = fs::read_to_string(&designspace_path).unwrap();
        assert!(xml.contains("format=\"5.2\""));
        assert!(xml.contains("values=\"0 1\""));
        assert!(xml.contains("<map input=\"100\" output=\"80\""));
        assert!(xml.contains("<label name=\"Regular\" uservalue=\"400\""));
        assert!(xml.contains("<mappings"));
        assert!(xml.contains("Italic masters become lighter"));

        let loaded = DesignspaceReader::new()
            .load(designspace_path.to_str().unwrap())
            .unwrap();
        let loaded_weight = loaded
            .axes()
            .iter()
            .find(|axis| axis.tag() == "wght")
            .unwrap();
        assert_eq!(loaded_weight.labels().len(), 1);
        assert_eq!(loaded_weight.labels()[0].name, "Regular");
        assert!(loaded_weight.labels()[0].elidable);

        let loaded_italic = loaded
            .axes()
            .iter()
            .find(|axis| axis.tag() == "ital")
            .unwrap();
        assert_eq!(
            loaded_italic.kind(),
            &AxisKind::Discrete {
                values: vec![0.0, 1.0],
                default: 0.0,
            }
        );
        assert_eq!(loaded.axis_mappings().len(), 2);
        assert!(loaded.axis_mappings()[0].is_independent());
        assert!(!loaded.axis_mappings()[1].is_independent());
        assert_eq!(loaded.axis_mappings()[1].points().len(), 1);
    }

    fn mapping_point(
        input: &[(shift_font::AxisId, f64)],
        output: &[(shift_font::AxisId, f64)],
    ) -> AxisMappingPoint {
        AxisMappingPoint {
            description: None,
            input: location(input),
            output: location(output),
        }
    }

    fn location(values: &[(shift_font::AxisId, f64)]) -> Location {
        let mut location = Location::new();
        for (axis_id, value) in values {
            location.set(axis_id.clone(), *value);
        }
        location
    }
}
