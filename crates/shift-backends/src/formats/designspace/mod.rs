mod axis_ext;
mod axis_labels;
mod error;
mod import;
mod reader;
mod source;
mod writer;

pub(crate) use axis_ext::{DesignspaceAxisExt, DesignspaceDocumentExt};
pub use error::DesignspaceError;
pub(crate) use import::{stream_font, stream_retained};
pub use reader::DesignspaceReader;
pub use source::DesignspaceFont;
pub use writer::DesignspaceWriter;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::traits::{FontReader, FontWriter};
    use shift_font::{
        Axis, AxisKind, AxisLabel, AxisLabelRange, AxisMapping, AxisMappingPoint, ExternalLocation,
        Font, Glyph, GlyphLayer, LayerId, Location, NamedInstance,
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
        let contour =
            shift_font::contour![(100.0, 0.0), (420.0, 0.0), (420.0, 500.0), (100.0, 500.0)];
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
        font.set_named_instances(vec![NamedInstance::new(
            "Black Italic".to_string(),
            ExternalLocation::from_untyped(location(&[(weight_id, 900.0), (italic_id, 1.0)])),
            Some("PlaceholderSans-BlackItalic".to_string()),
        )])
        .unwrap();

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
        assert!(xml.contains("stylename=\"Black Italic\""));
        assert!(xml.contains("postscriptfontname=\"PlaceholderSans-BlackItalic\""));
        assert!(xml.contains("<dimension name=\"Weight\" uservalue=\"900\""));

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
        assert_eq!(loaded.named_instances().len(), 1);
        assert_eq!(loaded.named_instances()[0].name(), "Black Italic");
        assert_eq!(
            loaded.named_instances()[0]
                .location()
                .get(&loaded_weight.id()),
            Some(900.0)
        );
        assert_eq!(
            loaded.named_instances()[0].postscript_name(),
            Some("PlaceholderSans-BlackItalic")
        );
    }

    #[test]
    fn round_trips_a_linked_label_outside_a_constant_discrete_axis() {
        let temp_dir = tempfile::tempdir().unwrap();
        let designspace_path = temp_dir.path().join("Roman.designspace");
        let mut font = test_font();
        let mut italic = Axis::discrete_with_id(
            shift_font::AxisId::new(),
            "ital".to_string(),
            "Italic".to_string(),
            vec![0.0],
            0.0,
        );
        italic.set_labels(vec![AxisLabel::new(
            "Roman".to_string(),
            0.0,
            None,
            Some(1.0),
            true,
        )]);
        font.add_axis(italic)
            .expect("a linked family counterpart may be outside the local axis");

        DesignspaceWriter::new()
            .save(&font, designspace_path.to_str().unwrap())
            .unwrap();

        let xml = fs::read_to_string(&designspace_path).unwrap();
        assert!(xml.contains("values=\"0\""));
        assert!(xml.contains("linkeduservalue=\"1\""));

        let loaded = DesignspaceReader::new()
            .load(designspace_path.to_str().unwrap())
            .unwrap();
        let loaded_italic = loaded
            .axes()
            .iter()
            .find(|axis| axis.tag() == "ital")
            .unwrap();

        assert_eq!(loaded_italic.labels()[0].linked_value, Some(1.0));
        loaded_italic.validate().unwrap();
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
        let location: Location = values
            .iter()
            .map(|(axis_id, value)| (axis_id.clone(), *value))
            .collect();
        location
    }

    #[test]
    fn reports_an_instance_left_out_for_sharing_a_location() {
        let temp_dir = tempfile::tempdir().unwrap();
        let designspace_path = temp_dir.path().join("Instances.designspace");
        let mut font = test_font();
        let weight = Axis::weight();
        let weight_id = weight.id();
        font.add_axis(weight).expect("weight axis should be valid");
        font.set_named_instances(vec![NamedInstance::new(
            "Bold".to_string(),
            ExternalLocation::from_untyped(location(&[(weight_id, 700.0)])),
            None,
        )])
        .unwrap();
        DesignspaceWriter::new()
            .save(&font, designspace_path.to_str().unwrap())
            .unwrap();

        let xml = fs::read_to_string(&designspace_path).unwrap();
        let start = xml
            .find("<instance ")
            .expect("the writer should write the instance");
        let end = start + xml[start..].find("</instance>").unwrap() + "</instance>".len();
        let copy = xml[start..end].replace("stylename=\"Bold\"", "stylename=\"Bold Copy\"");
        assert_ne!(copy, xml[start..end], "the copy should rename the instance");
        let xml = format!("{}\n{copy}{}", &xml[..end], &xml[end..]);
        fs::write(&designspace_path, xml).unwrap();

        let (font, _, report) = stream_font(designspace_path.to_str().unwrap()).unwrap();

        let names = font
            .named_instances()
            .iter()
            .map(NamedInstance::name)
            .collect::<Vec<_>>();
        assert_eq!(names, ["Bold"]);
        let messages = report
            .losses
            .iter()
            .map(|loss| loss.message.as_str())
            .collect::<Vec<_>>();
        assert!(
            messages
                .iter()
                .any(|message| message.contains("'Bold Copy' (at the same location as 'Bold')")),
            "{messages:?}"
        );
    }
}
