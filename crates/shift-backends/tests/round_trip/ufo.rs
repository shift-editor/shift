use std::path::{Path, PathBuf};

use shift_backends::font_loader::FontLoader;
use shift_font::{Anchor, Font, Glyph, GlyphLayer};

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

fn load_font(path: &Path) -> Font {
    assert!(path.exists(), "missing font fixture at {}", path.display());
    FontLoader::new()
        .read_font(path.to_str().unwrap())
        .unwrap_or_else(|error| panic!("failed to load {}: {error}", path.display()))
}

fn round_trip(font: &Font) -> Font {
    let temp_dir = tempfile::tempdir().expect("tempdir should be created");
    let output_path = temp_dir.path().join("round-trip.ufo");
    let loader = FontLoader::new();

    loader
        .write_font(font, output_path.to_str().unwrap())
        .expect("UFO writer should save the font");
    loader
        .read_font(output_path.to_str().unwrap())
        .expect("UFO reader should reload the saved font")
}

fn main_layer(glyph: &Glyph) -> &GlyphLayer {
    glyph
        .layers()
        .values()
        .max_by_key(|layer| layer.contours().len())
        .expect("glyph should have at least one layer")
}

fn sorted_contours(layer: &GlyphLayer) -> Vec<&shift_font::Contour> {
    let mut contours: Vec<_> = layer.contours_iter().collect();
    contours.sort_by(|a, b| {
        let a_first = a.points().first().map(|point| {
            (
                (point.x() * 1000.0).round() as i64,
                (point.y() * 1000.0).round() as i64,
            )
        });
        let b_first = b.points().first().map(|point| {
            (
                (point.x() * 1000.0).round() as i64,
                (point.y() * 1000.0).round() as i64,
            )
        });
        a_first.cmp(&b_first)
    });
    contours
}

fn assert_layer_geometry_matches(original: &GlyphLayer, reloaded: &GlyphLayer) {
    let original_contours = sorted_contours(original);
    let reloaded_contours = sorted_contours(reloaded);

    assert_eq!(original_contours.len(), reloaded_contours.len());
    for (original_contour, reloaded_contour) in original_contours.iter().zip(&reloaded_contours) {
        assert_eq!(original_contour.is_closed(), reloaded_contour.is_closed());
        assert_eq!(
            original_contour.points().len(),
            reloaded_contour.points().len()
        );

        for (original_point, reloaded_point) in original_contour
            .points()
            .iter()
            .zip(reloaded_contour.points())
        {
            assert!((original_point.x() - reloaded_point.x()).abs() < 0.001);
            assert!((original_point.y() - reloaded_point.y()).abs() < 0.001);
            assert_eq!(original_point.point_type(), reloaded_point.point_type());
            assert_eq!(original_point.is_smooth(), reloaded_point.is_smooth());
        }
    }
}

#[test]
fn preserves_metadata_metrics_and_glyph_count() {
    let original = load_font(&mutatorsans_ufo_path());
    let reloaded = round_trip(&original);

    assert_eq!(reloaded.glyph_count(), original.glyph_count());
    assert_eq!(
        reloaded.metadata().family_name,
        original.metadata().family_name
    );
    assert_eq!(
        reloaded.metadata().style_name,
        original.metadata().style_name
    );
    assert_eq!(
        reloaded.metrics().units_per_em,
        original.metrics().units_per_em
    );
    assert_eq!(reloaded.metrics().ascender, original.metrics().ascender);
    assert_eq!(reloaded.metrics().descender, original.metrics().descender);
    assert_eq!(reloaded.metrics().cap_height, original.metrics().cap_height);
    assert_eq!(reloaded.metrics().x_height, original.metrics().x_height);
}

#[test]
fn preserves_contours_points_and_widths_for_default_geometry() {
    let original = load_font(&mutatorsans_ufo_path());
    let reloaded = round_trip(&original);

    for glyph_name in ["A", "O"] {
        let original_layer = main_layer(
            original
                .glyph(glyph_name)
                .unwrap_or_else(|| panic!("original {glyph_name} should exist")),
        );
        let reloaded_layer = main_layer(
            reloaded
                .glyph(glyph_name)
                .unwrap_or_else(|| panic!("reloaded {glyph_name} should exist")),
        );

        assert!((original_layer.width() - reloaded_layer.width()).abs() < 0.001);
        assert_layer_geometry_matches(original_layer, reloaded_layer);
    }
}

#[test]
fn preserves_components_anchors_layers_and_kerning() {
    let mut original = load_font(&mutatorsans_ufo_path());
    original
        .glyph_mut("E")
        .expect("E glyph should exist")
        .layers()
        .iter()
        .max_by_key(|(_, layer)| layer.contours().len())
        .map(|(layer_id, _)| *layer_id)
        .and_then(|layer_id| original.glyph_mut("E").unwrap().layer_mut(layer_id))
        .expect("E should have a main layer")
        .add_anchor(Anchor::new(None::<String>, 123.0, 456.0));

    let reloaded = round_trip(&original);

    let aacute = reloaded.glyph("Aacute").expect("Aacute should exist");
    let component_bases: Vec<_> = main_layer(aacute)
        .components_iter()
        .map(|component| component.base_glyph().as_str())
        .collect();
    assert_eq!(component_bases.len(), 2);
    assert!(component_bases.contains(&"A"));
    assert!(component_bases.contains(&"acute"));

    let e = reloaded.glyph("E").expect("E should exist");
    let anchors: Vec<_> = e
        .layers()
        .values()
        .flat_map(|layer| layer.anchors_iter())
        .collect();
    assert!(anchors.iter().any(|anchor| anchor.name() == Some("top")));
    assert!(anchors.iter().any(|anchor| {
        anchor.name().is_none()
            && (anchor.x() - 123.0).abs() < 0.001
            && (anchor.y() - 456.0).abs() < 0.001
    }));

    let original_layer_names: Vec<_> = original
        .layers()
        .values()
        .map(|layer| layer.name())
        .collect();
    let reloaded_layer_names: Vec<_> = reloaded
        .layers()
        .values()
        .map(|layer| layer.name())
        .collect();
    assert_eq!(reloaded_layer_names.len(), original_layer_names.len());
    for name in original_layer_names {
        assert!(reloaded_layer_names.contains(&name));
    }

    assert_eq!(reloaded.kerning().get_kerning("T", "A"), Some(-75.0));
    assert_eq!(reloaded.kerning().get_kerning("V", "A"), Some(-100.0));
}
