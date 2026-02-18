use shift_core::font_loader::FontLoader;
use shift_core::GlyphLayer;
use std::path::PathBuf;

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

fn get_main_layer(glyph: &shift_core::Glyph) -> Option<&GlyphLayer> {
    glyph
        .layers()
        .values()
        .max_by_key(|layer| layer.contours().len())
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

#[test]
fn test_load_mutatorsans_ufo() {
    let ufo_path = mutatorsans_ufo_path();
    if !ufo_path.exists() {
        panic!(
            "Test font not found at {ufo_path:?}. Please download MutatorSans from fontmake repo."
        );
    }

    let loader = FontLoader::new();
    let font = loader
        .read_font(ufo_path.to_str().unwrap())
        .expect("Failed to load UFO font");

    assert_eq!(font.glyph_count(), 48, "MutatorSans should have 48 glyphs");
}

#[test]
fn test_mutatorsans_ufo_metrics() {
    let ufo_path = mutatorsans_ufo_path();
    if !ufo_path.exists() {
        return;
    }

    let loader = FontLoader::new();
    let font = loader.read_font(ufo_path.to_str().unwrap()).unwrap();

    let metrics = font.metrics();
    assert_eq!(metrics.units_per_em, 1000.0, "UPM should be 1000");
    assert_eq!(metrics.ascender, 700.0, "Ascender should be 700");
    assert_eq!(metrics.descender, -200.0, "Descender should be -200");
    assert_eq!(metrics.cap_height, Some(700.0), "Cap height should be 700");
    assert_eq!(metrics.x_height, Some(500.0), "x-height should be 500");
}

#[test]
fn test_mutatorsans_ufo_metadata() {
    let ufo_path = mutatorsans_ufo_path();
    if !ufo_path.exists() {
        return;
    }

    let loader = FontLoader::new();
    let font = loader.read_font(ufo_path.to_str().unwrap()).unwrap();

    let metadata = font.metadata();
    assert_eq!(
        metadata.family_name.as_deref(),
        Some("MutatorMathTest"),
        "Family name should be MutatorMathTest"
    );
    assert_eq!(
        metadata.style_name.as_deref(),
        Some("LightCondensed"),
        "Style name should be LightCondensed"
    );
}

#[test]
fn test_mutatorsans_ufo_glyph_structure() {
    let ufo_path = mutatorsans_ufo_path();
    if !ufo_path.exists() {
        return;
    }

    let loader = FontLoader::new();
    let font = loader.read_font(ufo_path.to_str().unwrap()).unwrap();

    let glyph_a = font.glyph("A").expect("Glyph 'A' should exist");
    let layer = get_main_layer(glyph_a).expect("Glyph 'A' should have at least one layer");

    assert!(
        !layer.contours().is_empty(),
        "Glyph 'A' should have contours"
    );

    for contour in layer.contours_iter() {
        assert!(!contour.points().is_empty(), "Contours should have points");
    }
}

#[test]
fn test_mutatorsans_ufo_point_types() {
    let ufo_path = mutatorsans_ufo_path();
    if !ufo_path.exists() {
        return;
    }

    let loader = FontLoader::new();
    let font = loader.read_font(ufo_path.to_str().unwrap()).unwrap();

    let glyph_o = font.glyph("O").expect("Glyph 'O' should exist");
    let layer = get_main_layer(glyph_o).expect("Glyph 'O' should have at least one layer");

    let mut has_on_curve = false;
    let mut has_off_curve = false;

    for contour in layer.contours_iter() {
        for point in contour.points() {
            match point.point_type() {
                shift_core::PointType::OnCurve | shift_core::PointType::QCurve => {
                    has_on_curve = true
                }
                shift_core::PointType::OffCurve => has_off_curve = true,
            }
        }
    }

    assert!(has_on_curve, "Glyph 'O' should have on-curve points");
    assert!(
        has_off_curve,
        "Glyph 'O' should have off-curve points (bezier curves)"
    );
}

#[test]
fn test_load_mutatorsans_ttf() {
    let ttf_path = mutatorsans_ttf_path();
    if !ttf_path.exists() {
        println!("Skipping TTF test - file not found at {ttf_path:?}");
        return;
    }

    let loader = FontLoader::new();
    let font = loader
        .read_font(ttf_path.to_str().unwrap())
        .expect("Failed to load TTF font");

    assert!(font.glyph_count() > 0, "TTF should have glyphs");
}

#[test]
fn test_load_mutatorsans_otf() {
    let otf_path = mutatorsans_otf_path();
    if !otf_path.exists() {
        println!("Skipping OTF test - file not found at {otf_path:?}");
        return;
    }

    let loader = FontLoader::new();
    let font = loader
        .read_font(otf_path.to_str().unwrap())
        .expect("Failed to load OTF font");

    assert!(font.glyph_count() > 0, "OTF should have glyphs");
}

#[test]
fn test_load_homenaje_glyphs_file() {
    let glyphs_path = homenaje_glyphs_path();
    if !glyphs_path.exists() {
        return;
    }

    let loader = FontLoader::new();
    let font = loader
        .read_font(glyphs_path.to_str().unwrap())
        .expect("Failed to load Homenaje .glyphs font");

    assert_eq!(font.metadata().family_name.as_deref(), Some("Homenaje"));
    assert_eq!(font.metadata().version_major, Some(1));
    assert_eq!(font.metadata().version_minor, Some(100));
    assert_eq!(font.metrics().units_per_em, 1000.0);
    assert_eq!(font.metrics().ascender, 700.0);
    assert_eq!(font.metrics().descender, -160.0);
    assert_eq!(font.metrics().cap_height, Some(700.0));
    assert_eq!(font.metrics().x_height, Some(520.0));
    assert!(
        font.glyph_count() >= 300,
        "Homenaje should have a substantial glyph set"
    );

    let fea = font
        .features()
        .fea_source()
        .expect("Homenaje should have feature source");
    assert!(fea.contains("feature locl"));
    assert!(fea.contains("feature frac"));
    assert!(fea.contains("feature ordn"));

    assert_eq!(
        font.kerning()
            .get_kerning(&"A".to_string(), &"V".to_string()),
        Some(-55.0)
    );
    assert_eq!(
        font.kerning()
            .get_kerning(&"V".to_string(), &"a".to_string()),
        Some(-65.0)
    );
}

#[test]
fn test_homenaje_glyph_components_and_anchors() {
    let glyphs_path = homenaje_glyphs_path();
    if !glyphs_path.exists() {
        return;
    }

    let loader = FontLoader::new();
    let font = loader.read_font(glyphs_path.to_str().unwrap()).unwrap();

    let aacute = font.glyph("Aacute").expect("Glyph 'Aacute' should exist");
    let aacute_layer = get_main_layer(aacute).expect("Aacute should have a layer");
    let component_bases: Vec<_> = aacute_layer
        .components_iter()
        .map(|c| c.base_glyph().to_string())
        .collect();
    assert_eq!(aacute_layer.components().len(), 2);
    assert!(component_bases.contains(&"A".to_string()));
    assert!(component_bases.contains(&"acute".to_string()));

    let u = font.glyph("u").expect("Glyph 'u' should exist");
    let u_layer = get_main_layer(u).expect("u should have a layer");
    let anchor_names: Vec<_> = u_layer
        .anchors_iter()
        .filter_map(|a| a.name().map(str::to_string))
        .collect();
    assert!(anchor_names.contains(&"top".to_string()));
    assert!(anchor_names.contains(&"bottom".to_string()));
    assert!(anchor_names.contains(&"ogonek".to_string()));
}

#[test]
fn test_mutatorsans_ufo_anchors() {
    let ufo_path = mutatorsans_ufo_path();
    if !ufo_path.exists() {
        return;
    }

    let loader = FontLoader::new();
    let font = loader.read_font(ufo_path.to_str().unwrap()).unwrap();

    let glyph_e = font.glyph("E").expect("Glyph 'E' should exist");

    let mut found_anchor = false;
    for layer in glyph_e.layers().values() {
        if !layer.anchors().is_empty() {
            found_anchor = true;
            let anchors: Vec<_> = layer.anchors_iter().collect();
            let top_anchor = anchors.iter().find(|a| a.name() == Some("top"));
            assert!(
                top_anchor.is_some(),
                "If glyph 'E' has anchors, it should have 'top' anchor"
            );
            break;
        }
    }

    assert!(
        found_anchor,
        "Glyph 'E' should have anchors in at least one layer"
    );
}

#[test]
fn test_mutatorsans_ufo_components() {
    let ufo_path = mutatorsans_ufo_path();
    if !ufo_path.exists() {
        return;
    }

    let loader = FontLoader::new();
    let font = loader.read_font(ufo_path.to_str().unwrap()).unwrap();

    let glyph = font.glyph("Aacute").expect("Glyph 'Aacute' should exist");
    let layer = get_main_layer(glyph).expect("Glyph 'Aacute' should have at least one layer");

    assert!(
        !layer.components().is_empty(),
        "Glyph 'Aacute' should have components"
    );

    let components: Vec<_> = layer.components_iter().collect();
    assert_eq!(
        components.len(),
        2,
        "Aacute should have 2 components (A + acute)"
    );

    let bases: Vec<_> = components.iter().map(|c| c.base_glyph().as_str()).collect();
    assert!(
        bases.contains(&"A"),
        "Aacute should reference 'A' component"
    );
    assert!(
        bases.contains(&"acute"),
        "Aacute should reference 'acute' component"
    );
}

#[test]
fn test_mutatorsans_ufo_kerning() {
    let ufo_path = mutatorsans_ufo_path();
    if !ufo_path.exists() {
        return;
    }

    let loader = FontLoader::new();
    let font = loader.read_font(ufo_path.to_str().unwrap()).unwrap();

    let kerning = font.kerning();

    assert!(!kerning.is_empty(), "MutatorSans should have kerning data");
    assert!(
        kerning.pairs().len() >= 3,
        "MutatorSans should have at least 3 kerning pairs"
    );

    let t_a_kern = kerning.get_kerning(&"T".to_string(), &"A".to_string());
    assert_eq!(t_a_kern, Some(-75.0), "T -> A kerning should be -75");

    let v_a_kern = kerning.get_kerning(&"V".to_string(), &"A".to_string());
    assert_eq!(v_a_kern, Some(-100.0), "V -> A kerning should be -100");

    let a_v_kern = kerning.get_kerning(&"A".to_string(), &"V".to_string());
    assert_eq!(a_v_kern, Some(-15.0), "A -> V kerning should be -15");
}

#[test]
fn test_mutatorsans_ufo_multiple_layers() {
    let ufo_path = mutatorsans_ufo_path();
    if !ufo_path.exists() {
        return;
    }

    let loader = FontLoader::new();
    let font = loader.read_font(ufo_path.to_str().unwrap()).unwrap();

    assert!(
        font.layers().len() >= 2,
        "MutatorSans should have multiple layers, got {}",
        font.layers().len()
    );

    let layer_names: Vec<_> = font.layers().values().map(|l| l.name()).collect();
    assert!(
        layer_names
            .iter()
            .any(|n| *n == "foreground" || *n == "public.default"),
        "Should have foreground/default layer"
    );
}

#[test]
fn test_ttf_has_glyph_contours() {
    let ttf_path = mutatorsans_ttf_path();
    if !ttf_path.exists() {
        println!("Skipping TTF contour test - file not found at {ttf_path:?}");
        return;
    }

    let loader = FontLoader::new();
    let font = loader
        .read_font(ttf_path.to_str().unwrap())
        .expect("Failed to load TTF font");

    let glyph_a = font
        .glyph_by_unicode(65)
        .expect("Glyph for 'A' (unicode 65) should exist");
    let layer = get_main_layer(glyph_a);

    assert!(
        layer.is_some(),
        "TTF glyph 'A' should have a layer with contours"
    );

    let layer = layer.unwrap();
    assert!(
        !layer.contours().is_empty(),
        "TTF glyph 'A' should have contours"
    );
}

#[test]
fn test_ttf_point_types() {
    let ttf_path = mutatorsans_ttf_path();
    if !ttf_path.exists() {
        println!("Skipping TTF point type test - file not found");
        return;
    }

    let loader = FontLoader::new();
    let font = loader
        .read_font(ttf_path.to_str().unwrap())
        .expect("Failed to load TTF font");

    let glyph_o = font.glyph_by_unicode(79);
    if glyph_o.is_none() {
        println!("Skipping - glyph O not found in TTF");
        return;
    }

    let glyph_o = glyph_o.unwrap();
    let layer = get_main_layer(glyph_o);
    if layer.is_none() {
        println!("Skipping - glyph O has no layer");
        return;
    }

    let layer = layer.unwrap();
    let mut has_on_curve = false;

    for contour in layer.contours_iter() {
        for point in contour.points() {
            match point.point_type() {
                shift_core::PointType::OnCurve | shift_core::PointType::QCurve => {
                    has_on_curve = true
                }
                shift_core::PointType::OffCurve => {}
            }
        }
    }

    assert!(
        has_on_curve,
        "TTF glyph 'O' should have on-curve points (or QCurve)"
    );
}

#[test]
fn test_otf_has_glyph_contours() {
    let otf_path = mutatorsans_otf_path();
    if !otf_path.exists() {
        println!("Skipping OTF contour test - file not found at {otf_path:?}");
        return;
    }

    let loader = FontLoader::new();
    let font = loader
        .read_font(otf_path.to_str().unwrap())
        .expect("Failed to load OTF font");

    let glyph_a = font
        .glyph_by_unicode(65)
        .expect("Glyph for 'A' (unicode 65) should exist");
    let layer = get_main_layer(glyph_a);

    assert!(
        layer.is_some(),
        "OTF glyph 'A' should have a layer with contours"
    );

    let layer = layer.unwrap();
    assert!(
        !layer.contours().is_empty(),
        "OTF glyph 'A' should have contours"
    );
}
