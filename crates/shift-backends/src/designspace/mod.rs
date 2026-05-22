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
    use shift_ir::{Contour, Font, Glyph, GlyphLayer, PointType};
    use std::fs;

    fn test_font() -> Font {
        let mut font = Font::new();
        font.metadata_mut().family_name = Some("Placeholder Sans".to_string());
        font.metadata_mut().style_name = Some("Regular".to_string());
        font.metrics_mut().units_per_em = 1000.0;

        let mut glyph = Glyph::with_unicode("o".to_string(), 'o' as u32);
        let mut layer = GlyphLayer::with_width(520.0);
        let mut contour = Contour::new();
        contour.add_point(100.0, 0.0, PointType::OnCurve, false);
        contour.add_point(420.0, 0.0, PointType::OnCurve, false);
        contour.add_point(420.0, 500.0, PointType::OnCurve, false);
        contour.add_point(100.0, 500.0, PointType::OnCurve, false);
        contour.close();
        layer.add_contour(contour);
        glyph.set_layer(font.default_layer_id(), layer);
        font.insert_glyph(glyph);

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
        assert!(loaded.glyph("o").is_some());

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
