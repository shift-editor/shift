mod conversion;
mod families;
mod import;
mod reader;
mod report;
mod source;

pub(crate) use conversion::{
    GlyphsAnchorExt, GlyphsFontExt, GlyphsMasterExt, font_header, missing_component_details,
};
pub(crate) use families::InstanceFamilies;
pub(crate) use import::{stream_font, stream_retained};
pub use reader::GlyphsReader;
pub use source::GlyphsFont;

#[cfg(test)]
mod tests {
    use super::GlyphsReader;
    use crate::FontReader;
    use std::fs;
    use std::path::{Path, PathBuf};

    fn repo_root() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .to_path_buf()
    }

    fn homenaje_path() -> PathBuf {
        repo_root().join("fixtures/fonts/Homenaje.glyphs")
    }

    #[test]
    fn loads_homenaje_glyphs_file() {
        let glyphs_path = homenaje_path();
        assert!(
            glyphs_path.exists(),
            "fixture missing at {glyphs_path:?}; expected fixtures/fonts/Homenaje.glyphs"
        );

        let font = GlyphsReader::new()
            .load(glyphs_path.to_str().unwrap())
            .expect("failed to load .glyphs fixture");

        assert_eq!(font.metadata().family_name.as_deref(), Some("Homenaje"));
        assert_eq!(font.metrics().units_per_em, 1000.0);
        assert!(font.glyph_count() >= 300, "font should contain many glyphs");
        assert!(
            font.glyph_by_name("A").is_some(),
            "glyph A should be present"
        );

        let fea = font
            .features()
            .fea_source()
            .expect("Homenaje should include features");
        assert!(fea.contains("feature frac"));

        assert_eq!(
            shift_font::test_support::default_kerning_between(&font, "A", "V"),
            Some(-55.0)
        );

        let aacute = font.glyph_by_name("Aacute").expect("Aacute should exist");
        let layer = aacute
            .layers()
            .values()
            .next()
            .expect("Aacute should have at least one layer");
        assert_eq!(layer.components().len(), 2);
    }

    #[test]
    fn loads_glyphs_package() {
        let package_dir = std::env::temp_dir().join("shift_test_glyphspackage/Test.glyphspackage");
        let glyphs_dir = package_dir.join("glyphs");

        let _ = fs::remove_dir_all(package_dir.parent().unwrap());
        fs::create_dir_all(&glyphs_dir).unwrap();

        fs::write(
            package_dir.join("fontinfo.plist"),
            r#"{
familyName = "Package Font";
unitsPerEm = 1000;
fontMaster = (
{
ascender = 800;
capHeight = 700;
descender = -200;
id = MASTER1;
xHeight = 500;
}
);
}"#,
        )
        .unwrap();

        fs::write(
            glyphs_dir.join("A_.glyph"),
            r#"{
glyphname = A;
layers = (
{
layerId = MASTER1;
paths = (
{
closed = 1;
nodes = (
"0 0 LINE",
"100 0 LINE",
"100 100 LINE",
"0 100 LINE"
);
}
);
width = 600;
}
);
unicode = 0041;
}"#,
        )
        .unwrap();

        let font = GlyphsReader::new()
            .load(package_dir.to_str().unwrap())
            .expect("failed to load .glyphspackage fixture");

        assert_eq!(font.metadata().family_name.as_deref(), Some("Package Font"));
        assert!(
            font.glyph_by_name("A").is_some(),
            "glyph A should be present"
        );

        let _ = fs::remove_dir_all(package_dir.parent().unwrap());
    }

    fn multi_family_path() -> PathBuf {
        repo_root().join("fixtures/fonts/MultiFamily.glyphs")
    }

    #[test]
    fn imports_only_the_source_familys_instances_once_each() {
        let path = multi_family_path();
        let (font, _, report) = super::stream_font(path.to_str().unwrap()).unwrap();

        let names = font
            .named_instances()
            .iter()
            .map(|instance| instance.name().to_string())
            .collect::<Vec<_>>();
        assert_eq!(names, ["Light", "Bold"]);
        let messages = report
            .losses
            .iter()
            .map(|loss| loss.message.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        assert!(messages.contains("Multi Family UI"));
        assert!(messages.contains("'Bold Copy' (at the same location as 'Bold')"));
    }

    #[test]
    fn a_glyph_marked_not_to_export_is_drawn_through_but_not_compiled() {
        use skrifa::{FontRef, MetadataProvider};

        let font = GlyphsReader::new()
            .load(multi_family_path().to_str().unwrap())
            .unwrap();
        assert!(font.lib().skipped_export_glyphs().contains("_part"));

        let bytes = crate::FontExporter::new().compile_ttf(&font).unwrap();
        let compiled = FontRef::new(&bytes).unwrap();
        let names = compiled
            .glyph_names()
            .iter()
            .map(|(_, name)| name.to_string())
            .collect::<Vec<_>>();
        assert!(names.contains(&"A".to_string()));
        assert!(!names.contains(&"_part".to_string()));

        let a = compiled.charmap().map('A').unwrap();
        let outline = compiled.outline_glyphs().get(a).unwrap();
        let mut pen = skrifa::outline::pen::ControlBoundsPen::default();
        outline
            .draw(
                skrifa::outline::DrawSettings::unhinted(
                    skrifa::instance::Size::unscaled(),
                    skrifa::instance::LocationRef::default(),
                ),
                &mut pen,
            )
            .unwrap();
        assert!(pen.bounding_box().is_some(), "A keeps the part's outline");
    }
}
