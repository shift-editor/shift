mod reader;
mod writer;

pub use reader::UfoReader;
pub use writer::UfoWriter;

use crate::traits::{FontReader, FontWriter};
use crate::FormatBackendResult;
use shift_font::Font;

pub struct UfoBackend;

impl FontReader for UfoBackend {
    fn load(&self, path: &str) -> FormatBackendResult<Font> {
        UfoReader::new().load(path)
    }
}

impl FontWriter for UfoBackend {
    fn save(&self, font: &Font, path: &str) -> FormatBackendResult<()> {
        UfoWriter::new().save(font, path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use shift_font::{Contour, Glyph, GlyphLayer, LayerId, PointType};
    use std::fs;

    fn create_test_font() -> Font {
        let mut font = Font::new();
        font.metadata_mut().family_name = Some("TestFamily".to_string());
        font.metadata_mut().style_name = Some("Regular".to_string());
        font.metrics_mut().units_per_em = 1000.0;
        font.metrics_mut().ascender = 800.0;
        font.metrics_mut().descender = -200.0;

        let default_source_id = font.default_source_id().unwrap();

        let mut glyph = Glyph::with_unicode("A".to_string(), 65);
        let mut layer = GlyphLayer::with_width(LayerId::new(), default_source_id, 600.0);

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

        glyph.set_layer(layer);
        font.insert_glyph(glyph).unwrap();

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

        let original_glyph = original.glyph_by_name("A").unwrap();
        let loaded_glyph = loaded.glyph_by_name("A").unwrap();

        assert_eq!(
            original_glyph.primary_unicode(),
            loaded_glyph.primary_unicode()
        );

        let original_layer = original_glyph
            .layer_for_source(original.default_source_id().unwrap())
            .unwrap();
        let loaded_layer = loaded_glyph
            .layer_for_source(loaded.default_source_id().unwrap())
            .unwrap();

        assert_eq!(original_layer.width(), loaded_layer.width());
        assert_eq!(
            original_layer.contours().len(),
            loaded_layer.contours().len()
        );

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn writer_preserves_fractional_coordinates_and_skips_empty_contours() {
        let mut font = Font::new();
        let default_source_id = font.default_source_id().unwrap();

        let mut glyph = Glyph::with_unicode("A".to_string(), 0x0041);
        let mut layer = GlyphLayer::with_width(LayerId::new(), default_source_id, 500.4);

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

        glyph.set_layer(layer);
        font.insert_glyph(glyph).unwrap();

        let temp_dir = tempfile::tempdir().unwrap();
        let ufo_path = temp_dir.path().join("writer_format.ufo");
        let ufo_path_str = ufo_path.to_str().unwrap();

        UfoWriter::new().save(&font, ufo_path_str).unwrap();

        let expected_glif_filename = norad::user_name_to_file_name("A", "", ".glif", |_| true);
        let glif_path = ufo_path.join("glyphs").join(expected_glif_filename);
        let glif = fs::read_to_string(glif_path).unwrap();
        let contents = fs::read_to_string(ufo_path.join("glyphs/contents.plist")).unwrap();

        assert!(contents.contains("<key>A</key>"));
        assert!(contents.contains("<string>A_.glif</string>"));
        assert!(glif.contains("<unicode hex=\"0041\"/>"));
        assert!(glif.contains("<advance width=\"500.4\"/>"));
        assert!(glif.contains("<glyph name=\"A\""));
        assert!(glif.contains("x=\"115.29469168717605\""));
        assert!(glif.contains("y=\"452.51873449628556\""));
        assert_eq!(glif.matches("<contour>").count(), 1);
    }

    #[test]
    fn failed_save_preserves_existing_ufo() {
        let font = create_test_font();
        let temp_dir = tempfile::tempdir().unwrap();
        let ufo_path = temp_dir.path().join("target.ufo");
        let ufo_path_str = ufo_path.to_str().unwrap();

        UfoWriter::new().save(&font, ufo_path_str).unwrap();

        // norad refuses to serialize fonts carrying public.objectLibs, so this
        // save fails during the write phase, after conversion succeeded.
        let mut broken = create_test_font();
        broken.lib_mut().set(
            "public.objectLibs".to_string(),
            shift_font::LibValue::Dict(std::collections::HashMap::new()),
        );
        UfoWriter::new()
            .save(&broken, ufo_path_str)
            .expect_err("save should fail");

        let reloaded = UfoReader::new()
            .load(ufo_path_str)
            .expect("original UFO should still load after a failed save");
        assert_eq!(
            reloaded.metadata().family_name.as_deref(),
            Some("TestFamily")
        );
        assert_eq!(reloaded.glyph_count(), font.glyph_count());

        let entries: Vec<_> = fs::read_dir(temp_dir.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(entries, vec!["target.ufo"], "no staging leftovers");
    }

    #[test]
    fn saves_multi_glyph_multi_layer_font() {
        let mut font = create_test_font();
        let default_source_id = font.default_source_id().unwrap();
        let bold_source_id = font.add_source(shift_font::Source::new(
            "Bold".to_string(),
            shift_font::Location::new(),
        ));

        for (name, unicode) in [("B", 0x0042_u32), ("C", 0x0043)] {
            let mut glyph = Glyph::with_unicode(name.to_string(), unicode);
            glyph.set_layer(GlyphLayer::with_width(
                LayerId::new(),
                default_source_id.clone(),
                500.0,
            ));
            glyph.set_layer(GlyphLayer::with_width(
                LayerId::new(),
                bold_source_id.clone(),
                550.0,
            ));
            font.insert_glyph(glyph).unwrap();
        }

        let temp_dir = tempfile::tempdir().unwrap();
        let ufo_path = temp_dir.path().join("multi.ufo");
        let ufo_path_str = ufo_path.to_str().unwrap();

        UfoWriter::new().save(&font, ufo_path_str).unwrap();

        let loaded = UfoReader::new().load(ufo_path_str).unwrap();
        assert_eq!(loaded.glyph_count(), 3);
        assert_eq!(loaded.sources().len(), 2);
    }

    #[test]
    fn save_replaces_existing_ufo() {
        let font = create_test_font();
        let temp_dir = tempfile::tempdir().unwrap();
        let ufo_path = temp_dir.path().join("target.ufo");
        let ufo_path_str = ufo_path.to_str().unwrap();

        UfoWriter::new().save(&font, ufo_path_str).unwrap();

        let mut updated = create_test_font();
        updated.metadata_mut().family_name = Some("UpdatedFamily".to_string());
        UfoWriter::new().save(&updated, ufo_path_str).unwrap();

        let reloaded = UfoReader::new().load(ufo_path_str).unwrap();
        assert_eq!(
            reloaded.metadata().family_name.as_deref(),
            Some("UpdatedFamily")
        );

        let entries: Vec<_> = fs::read_dir(temp_dir.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(entries, vec!["target.ufo"], "no staging leftovers");
    }

    #[test]
    fn round_trip_preserves_feature_source() {
        let mut font = create_test_font();
        font.features_mut()
            .set_fea_source(Some("feature liga {\n} liga;\n".to_string()));

        let temp_dir = tempfile::tempdir().unwrap();
        let ufo_path = temp_dir.path().join("features.ufo");
        let ufo_path_str = ufo_path.to_str().unwrap();

        UfoWriter::new().save(&font, ufo_path_str).unwrap();
        let loaded = UfoReader::new().load(ufo_path_str).unwrap();

        assert_eq!(
            loaded.features().fea_source(),
            Some("feature liga {\n} liga;\n")
        );
    }

    #[test]
    fn save_fails_loudly_on_invalid_glyph_name() {
        let mut font = Font::new();
        let default_source_id = font.default_source_id().unwrap();

        let bad_name = "A\u{0001}B".to_string();
        let mut glyph = Glyph::with_unicode(bad_name.clone(), 0x0041);
        glyph.set_layer(GlyphLayer::with_width(
            LayerId::new(),
            default_source_id,
            600.0,
        ));
        font.insert_glyph(glyph).unwrap();

        let temp_dir = tempfile::tempdir().unwrap();
        let ufo_path = temp_dir.path().join("invalid_name.ufo");

        let error = UfoWriter::new()
            .save(&font, ufo_path.to_str().unwrap())
            .expect_err("glyph name with control character should fail to save");

        let message = error.to_string();
        assert!(message.contains("glyph"), "unexpected error: {message}");
        assert!(
            message.contains("A\\u{1}B"),
            "error should include the offending name: {message}"
        );
        assert!(!ufo_path.exists(), "no partial UFO should be left behind");
    }

    #[test]
    fn save_fails_loudly_on_invalid_kerning_group_name() {
        let mut font = Font::new();
        font.kerning_mut().set_group1(
            "public.kern1.bad\u{0000}group".to_string(),
            vec!["A".to_string().into()],
        );

        let temp_dir = tempfile::tempdir().unwrap();
        let ufo_path = temp_dir.path().join("invalid_group.ufo");

        let error = UfoWriter::new()
            .save(&font, ufo_path.to_str().unwrap())
            .expect_err("kerning group name with control character should fail to save");

        let message = error.to_string();
        assert!(
            message.contains("kerning group"),
            "unexpected error: {message}"
        );
    }

    #[test]
    fn round_trip_preserves_fractional_coordinates_exactly() {
        let mut font = Font::new();
        let default_source_id = font.default_source_id().unwrap();

        let mut glyph = Glyph::with_unicode("A".to_string(), 0x0041);
        let mut layer = GlyphLayer::with_width(LayerId::new(), default_source_id, 512.5);

        let mut contour = Contour::new();
        contour.add_point(100.5, 33.25, PointType::OnCurve, false);
        contour.add_point(300.125, 700.75, PointType::OnCurve, false);
        contour.add_point(600.0625, 0.5, PointType::OnCurve, false);
        contour.close();
        layer.add_contour(contour);
        layer.add_anchor(shift_font::Anchor::new("top".to_string(), 10.75, 720.5));

        glyph.set_layer(layer);
        font.insert_glyph(glyph).unwrap();

        let temp_dir = tempfile::tempdir().unwrap();
        let ufo_path = temp_dir.path().join("fractional.ufo");
        let ufo_path_str = ufo_path.to_str().unwrap();

        UfoWriter::new().save(&font, ufo_path_str).unwrap();
        let loaded = UfoReader::new().load(ufo_path_str).unwrap();

        let loaded_glyph = loaded.glyph_by_name("A").unwrap();
        let loaded_layer = loaded_glyph
            .layer_for_source(loaded.default_source_id().unwrap())
            .unwrap();

        assert_eq!(loaded_layer.width(), 512.5);

        let expected = [(100.5, 33.25), (300.125, 700.75), (600.0625, 0.5)];
        let loaded_contour = loaded_layer.contours_iter().next().unwrap();
        assert_eq!(loaded_contour.points().len(), expected.len());
        for (point, (x, y)) in loaded_contour.points().iter().zip(expected) {
            assert_eq!(point.x(), x);
            assert_eq!(point.y(), y);
        }

        let anchor = loaded_layer.anchors_iter().next().unwrap();
        assert_eq!(anchor.x(), 10.75);
        assert_eq!(anchor.y(), 720.5);
    }
}
