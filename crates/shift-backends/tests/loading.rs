use std::path::{Path, PathBuf};

use shift_backends::font_loader::FontLoader;
use shift_font::{Font, Glyph, GlyphLayer, PointType};

fn fixtures_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("fixtures")
}

fn mutatorsans_ufo_path() -> PathBuf {
    fixtures_path().join("fonts/mutatorsans/MutatorSansLightCondensed.ufo")
}

fn mutatorsans_ttf_path() -> PathBuf {
    fixtures_path().join("fonts/mutatorsans/MutatorSans.ttf")
}

fn mutatorsans_otf_path() -> PathBuf {
    fixtures_path().join("fonts/mutatorsans/MutatorSans.otf")
}

fn homenaje_glyphs_path() -> PathBuf {
    fixtures_path().join("fonts/Homenaje.glyphs")
}

fn mutatorsans_variable_glyphs_path() -> PathBuf {
    fixtures_path().join("fonts/MutatorSansVariable.glyphs")
}

fn mutatorsans_designspace_path() -> PathBuf {
    fixtures_path().join("fonts/mutatorsans-variable/MutatorSans.designspace")
}

fn load_font(path: &Path) -> Font {
    assert!(path.exists(), "missing font fixture at {}", path.display());
    FontLoader::new()
        .read_font(path.to_str().unwrap())
        .unwrap_or_else(|error| panic!("failed to load {}: {error}", path.display()))
}

fn main_layer(glyph: &Glyph) -> &GlyphLayer {
    glyph
        .layers()
        .values()
        .max_by_key(|layer| layer.contours().len())
        .expect("glyph should have at least one layer")
}

#[test]
fn loads_ufo_metadata_metrics_and_geometry() {
    let font = load_font(&mutatorsans_ufo_path());
    let metadata = font.metadata();
    let metrics = font.metrics();

    assert_eq!(font.glyph_count(), 48);
    assert_eq!(metadata.family_name.as_deref(), Some("MutatorMathTest"));
    assert_eq!(metadata.style_name.as_deref(), Some("LightCondensed"));
    assert_eq!(metrics.units_per_em, 1000.0);
    assert_eq!(metrics.ascender, 700.0);
    assert_eq!(metrics.descender, -200.0);
    assert_eq!(metrics.cap_height, Some(700.0));
    assert_eq!(metrics.x_height, Some(500.0));

    let glyph_a = font.glyph_by_name("A").expect("A glyph should exist");
    assert!(!main_layer(glyph_a).contours().is_empty());

    let glyph_o = font.glyph_by_name("O").expect("O glyph should exist");
    let has_off_curve = main_layer(glyph_o)
        .contours_iter()
        .flat_map(|contour| contour.points())
        .any(|point| point.point_type() == PointType::OffCurve);
    assert!(has_off_curve, "O should contain curve control points");
}

#[test]
fn loads_ufo_components_anchors_layers_and_kerning() {
    let font = load_font(&mutatorsans_ufo_path());

    let aacute = font
        .glyph_by_name("Aacute")
        .expect("Aacute glyph should exist");
    let component_bases: Vec<_> = main_layer(aacute)
        .components_iter()
        .map(|component| component.base_glyph().as_str())
        .collect();
    assert_eq!(component_bases.len(), 2);
    assert!(component_bases.contains(&"A"));
    assert!(component_bases.contains(&"acute"));

    let e = font.glyph_by_name("E").expect("E glyph should exist");
    let anchor_names: Vec<_> = e
        .layers()
        .values()
        .flat_map(|layer| layer.anchors_iter())
        .filter_map(|anchor| anchor.name())
        .collect();
    assert!(anchor_names.contains(&"top"));

    let source_names: Vec<_> = font.sources().iter().map(|source| source.name()).collect();
    assert!(source_names.contains(&"Regular"));
    assert!(font.sources().len() >= 2);
    assert!(font
        .glyphs()
        .flat_map(|glyph| glyph.layers().values())
        .all(|layer| font
            .sources()
            .iter()
            .any(|source| source.id() == layer.source_id())));

    assert_eq!(font.kerning().get_kerning("T", "A"), Some(-75.0));
    assert_eq!(font.kerning().get_kerning("V", "A"), Some(-100.0));
}

#[test]
fn loads_binary_fonts_with_contours() {
    for path in [mutatorsans_ttf_path(), mutatorsans_otf_path()] {
        let font = load_font(&path);
        let glyph_a = font
            .glyphs_by_unicode(65)
            .next()
            .unwrap_or_else(|| panic!("{} should contain U+0041", path.display()));

        assert!(font.glyph_count() > 0);
        assert!(!main_layer(glyph_a).contours().is_empty());
    }
}

#[test]
fn loads_glyphs_file_features_kerning_components_and_anchors() {
    let font = load_font(&homenaje_glyphs_path());

    assert_eq!(font.metadata().family_name.as_deref(), Some("Homenaje"));
    assert_eq!(font.metrics().units_per_em, 1000.0);
    assert_eq!(font.metrics().ascender, 700.0);
    assert_eq!(font.metrics().descender, -160.0);
    assert!(font.glyph_count() >= 300);

    let fea = font
        .features()
        .fea_source()
        .expect("Homenaje should include feature source");
    assert!(fea.contains("feature locl"));
    assert!(fea.contains("feature frac"));
    assert!(fea.contains("feature ordn"));

    assert_eq!(font.kerning().get_kerning("A", "V"), Some(-55.0));
    assert_eq!(font.kerning().get_kerning("V", "a"), Some(-65.0));

    let aacute = font
        .glyph_by_name("Aacute")
        .expect("Aacute glyph should exist");
    let component_bases: Vec<_> = main_layer(aacute)
        .components_iter()
        .map(|component| component.base_glyph().as_str())
        .collect();
    assert_eq!(component_bases.len(), 2);
    assert!(component_bases.contains(&"A"));
    assert!(component_bases.contains(&"acute"));

    let u = font.glyph_by_name("u").expect("u glyph should exist");
    let anchor_names: Vec<_> = main_layer(u)
        .anchors_iter()
        .filter_map(|anchor| anchor.name())
        .collect();
    assert!(anchor_names.contains(&"top"));
    assert!(anchor_names.contains(&"bottom"));
    assert!(anchor_names.contains(&"ogonek"));
}

#[test]
fn loads_variable_glyphs_sources_and_compatible_layers() {
    let font = load_font(&mutatorsans_variable_glyphs_path());

    assert!(font.is_variable());
    assert_eq!(font.axes().len(), 1);
    assert_eq!(font.axes()[0].tag(), "wght");
    assert_eq!(font.axes()[0].minimum(), 100.0);
    assert_eq!(font.axes()[0].maximum(), 900.0);
    assert_eq!(font.sources().len(), 2);
    assert_eq!(font.sources()[0].location().get("wght"), Some(100.0));
    assert_eq!(font.sources()[1].location().get("wght"), Some(900.0));

    let glyph_a = font.glyph_by_name("A").expect("A glyph should exist");
    let layers: Vec<_> = glyph_a.layers().values().collect();
    assert_eq!(layers.len(), 2);
    assert_eq!(layers[0].contours().len(), layers[1].contours().len());
    assert_eq!(
        layers[0]
            .contours()
            .values()
            .map(|contour| contour.points().len())
            .sum::<usize>(),
        layers[1]
            .contours()
            .values()
            .map(|contour| contour.points().len())
            .sum::<usize>()
    );
}

#[test]
fn loads_designspace_sources_axes_and_default_metadata() {
    let font = load_font(&mutatorsans_designspace_path());

    assert!(font.is_variable());
    assert_eq!(
        font.metadata().family_name.as_deref(),
        Some("MutatorMathTest")
    );
    assert!(font.glyph_count() > 10);
    assert_eq!(font.axes().len(), 2);
    assert_eq!(font.axes()[0].tag(), "wdth");
    assert_eq!(font.axes()[1].tag(), "wght");
    assert_eq!(font.sources().len(), 7);
    assert_eq!(font.sources()[0].location().get("wdth"), Some(0.0));
    assert_eq!(font.sources()[0].location().get("wght"), Some(0.0));
    assert!(font.sources()[0].filename().is_some());

    let glyph_a = font.glyph_by_name("A").expect("A glyph should exist");
    assert!(glyph_a.layers().len() >= 4);
}
