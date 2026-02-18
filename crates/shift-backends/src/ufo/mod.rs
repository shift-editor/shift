mod reader;
mod writer;

pub use reader::UfoReader;
pub use writer::UfoWriter;

use crate::traits::{FontReader, FontWriter};
use shift_ir::Font;

pub struct UfoBackend;

impl FontReader for UfoBackend {
    fn load(&self, path: &str) -> Result<Font, String> {
        UfoReader::new().load(path)
    }
}

impl FontWriter for UfoBackend {
    fn save(&self, font: &Font, path: &str) -> Result<(), String> {
        UfoWriter::new().save(font, path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use shift_ir::{Contour, Glyph, GlyphLayer, PointType};
    use std::fs;

    fn create_test_font() -> Font {
        let mut font = Font::new();
        font.metadata_mut().family_name = Some("TestFamily".to_string());
        font.metadata_mut().style_name = Some("Regular".to_string());
        font.metrics_mut().units_per_em = 1000.0;
        font.metrics_mut().ascender = 800.0;
        font.metrics_mut().descender = -200.0;

        let default_layer_id = font.default_layer_id();

        let mut glyph = Glyph::with_unicode("A".to_string(), 65);
        let mut layer = GlyphLayer::with_width(600.0);

        let mut contour = Contour::new();
        contour.add_point(0.0, 0.0, PointType::OnCurve, false);
        contour.add_point(300.0, 700.0, PointType::OnCurve, false);
        contour.add_point(600.0, 0.0, PointType::OnCurve, false);
        contour.close();
        layer.add_contour(contour);

        let mut inner = Contour::new();
        inner.add_point(150.0, 200.0, PointType::OnCurve, false);
        inner.add_point(300.0, 400.0, PointType::OnCurve, false);
        inner.add_point(450.0, 200.0, PointType::OnCurve, false);
        inner.close();
        layer.add_contour(inner);

        glyph.set_layer(default_layer_id, layer);
        font.insert_glyph(glyph);

        font
    }

    #[test]
    fn round_trip_ufo() {
        let original = create_test_font();
        let temp_dir = std::env::temp_dir().join("shift_test_ufo");
        let ufo_path = temp_dir.join("roundtrip.ufo");
        let ufo_path_str = ufo_path.to_str().unwrap();

        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir).unwrap();

        let writer = UfoWriter::new();
        writer.save(&original, ufo_path_str).unwrap();

        let reader = UfoReader::new();
        let loaded = reader.load(ufo_path_str).unwrap();

        assert_eq!(
            loaded.metadata().family_name,
            original.metadata().family_name
        );
        assert_eq!(loaded.metadata().style_name, original.metadata().style_name);
        assert_eq!(
            loaded.metrics().units_per_em,
            original.metrics().units_per_em
        );
        assert_eq!(loaded.glyph_count(), original.glyph_count());

        let original_glyph = original.glyph("A").unwrap();
        let loaded_glyph = loaded.glyph("A").unwrap();

        assert_eq!(
            original_glyph.primary_unicode(),
            loaded_glyph.primary_unicode()
        );

        let default_layer_id = original.default_layer_id();
        let loaded_default_layer_id = loaded.default_layer_id();

        let original_layer = original_glyph.layer(default_layer_id).unwrap();
        let loaded_layer = loaded_glyph.layer(loaded_default_layer_id).unwrap();

        assert_eq!(original_layer.width(), loaded_layer.width());
        assert_eq!(
            original_layer.contours().len(),
            loaded_layer.contours().len()
        );

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn writer_rounds_coordinates_and_skips_empty_contours() {
        let mut font = Font::new();
        let default_layer_id = font.default_layer_id();

        let mut glyph = Glyph::with_unicode("A".to_string(), 0x0041);
        let mut layer = GlyphLayer::with_width(500.4);

        let mut contour = Contour::new();
        contour.add_point(
            115.29469168717605,
            452.51873449628556,
            PointType::OnCurve,
            false,
        );
        contour.add_point(
            163.40714583709172,
            370.72756244142886,
            PointType::OffCurve,
            false,
        );
        contour.add_point(
            259.6320541369231,
            207.14521833171557,
            PointType::OnCurve,
            true,
        );
        contour.close();
        layer.add_contour(contour);
        layer.add_contour(Contour::new());

        glyph.set_layer(default_layer_id, layer);
        font.insert_glyph(glyph);

        let temp_dir = std::env::temp_dir().join("shift_test_ufo_writer_format");
        let ufo_path = temp_dir.join("writer_format.ufo");
        let ufo_path_str = ufo_path.to_str().unwrap();

        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir).unwrap();

        UfoWriter::new().save(&font, ufo_path_str).unwrap();

        let expected_glif_filename = norad::user_name_to_file_name("A", "", ".glif", |_| true);
        let glif_path = ufo_path.join("glyphs").join(expected_glif_filename);
        let glif = fs::read_to_string(glif_path).unwrap();
        let contents = fs::read_to_string(ufo_path.join("glyphs/contents.plist")).unwrap();

        assert!(contents.contains("<key>A</key>"));
        assert!(contents.contains("<string>A_.glif</string>"));
        assert!(glif.contains("<unicode hex=\"0041\"/>"));
        assert!(glif.contains("<advance width=\"500\"/>"));
        assert!(glif.contains("<glyph name=\"A\""));
        assert!(glif.contains("x=\"115\""));
        assert!(glif.contains("y=\"453\""));
        assert!(!glif.contains("115.29469168717605"));
        assert_eq!(glif.matches("<contour>").count(), 1);

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
