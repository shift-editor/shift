use shift_core::font_loader::FontLoader;
use shift_core::{Anchor, GlyphLayer};
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

#[test]
fn test_ufo_round_trip_glyph_count() {
    let ufo_path = mutatorsans_ufo_path();
    if !ufo_path.exists() {
        return;
    }

    let loader = FontLoader::new();
    let original = loader.read_font(ufo_path.to_str().unwrap()).unwrap();
    let original_count = original.glyph_count();

    let temp_dir = tempfile::tempdir().expect("Failed to create temp dir");
    let temp_ufo = temp_dir.path().join("test_output.ufo");

    loader
        .write_font(&original, temp_ufo.to_str().unwrap())
        .expect("Failed to write UFO");

    let reloaded = loader
        .read_font(temp_ufo.to_str().unwrap())
        .expect("Failed to reload UFO");

    assert_eq!(
        reloaded.glyph_count(),
        original_count,
        "Glyph count should match after round-trip"
    );
}

#[test]
fn test_ufo_round_trip_metrics() {
    let ufo_path = mutatorsans_ufo_path();
    if !ufo_path.exists() {
        return;
    }

    let loader = FontLoader::new();
    let original = loader.read_font(ufo_path.to_str().unwrap()).unwrap();

    let temp_dir = tempfile::tempdir().expect("Failed to create temp dir");
    let temp_ufo = temp_dir.path().join("test_output.ufo");

    loader
        .write_font(&original, temp_ufo.to_str().unwrap())
        .expect("Failed to write UFO");

    let reloaded = loader
        .read_font(temp_ufo.to_str().unwrap())
        .expect("Failed to reload UFO");

    let orig_metrics = original.metrics();
    let reload_metrics = reloaded.metrics();

    assert_eq!(
        orig_metrics.units_per_em, reload_metrics.units_per_em,
        "UPM should match after round-trip"
    );
    assert_eq!(
        orig_metrics.ascender, reload_metrics.ascender,
        "Ascender should match after round-trip"
    );
    assert_eq!(
        orig_metrics.descender, reload_metrics.descender,
        "Descender should match after round-trip"
    );
    assert_eq!(
        orig_metrics.cap_height, reload_metrics.cap_height,
        "Cap height should match after round-trip"
    );
    assert_eq!(
        orig_metrics.x_height, reload_metrics.x_height,
        "x-height should match after round-trip"
    );
}

#[test]
fn test_ufo_round_trip_point_coordinates() {
    let ufo_path = mutatorsans_ufo_path();
    if !ufo_path.exists() {
        return;
    }

    let loader = FontLoader::new();
    let original = loader.read_font(ufo_path.to_str().unwrap()).unwrap();

    let temp_dir = tempfile::tempdir().expect("Failed to create temp dir");
    let temp_ufo = temp_dir.path().join("test_output.ufo");

    loader
        .write_font(&original, temp_ufo.to_str().unwrap())
        .expect("Failed to write UFO");

    let reloaded = loader
        .read_font(temp_ufo.to_str().unwrap())
        .expect("Failed to reload UFO");

    let glyph_name = "A";
    let orig_glyph = original
        .glyph(glyph_name)
        .expect("Original glyph A missing");
    let reload_glyph = reloaded
        .glyph(glyph_name)
        .expect("Reloaded glyph A missing");

    let orig_layer = get_main_layer(orig_glyph).expect("Original glyph should have a layer");
    let reload_layer = get_main_layer(reload_glyph).expect("Reloaded glyph should have a layer");

    assert_eq!(
        orig_layer.contours().len(),
        reload_layer.contours().len(),
        "Contour count should match for glyph '{glyph_name}'"
    );

    let mut orig_contours: Vec<_> = orig_layer.contours_iter().collect();
    let mut reload_contours: Vec<_> = reload_layer.contours_iter().collect();

    orig_contours.sort_by(|a, b| {
        let a_first = a.points().first().map(|p| (p.x() as i64, p.y() as i64));
        let b_first = b.points().first().map(|p| (p.x() as i64, p.y() as i64));
        a_first.cmp(&b_first)
    });
    reload_contours.sort_by(|a, b| {
        let a_first = a.points().first().map(|p| (p.x() as i64, p.y() as i64));
        let b_first = b.points().first().map(|p| (p.x() as i64, p.y() as i64));
        a_first.cmp(&b_first)
    });

    for (orig_contour, reload_contour) in orig_contours.iter().zip(reload_contours.iter()) {
        assert_eq!(
            orig_contour.points().len(),
            reload_contour.points().len(),
            "Point count should match in contour"
        );

        for (orig_point, reload_point) in orig_contour
            .points()
            .iter()
            .zip(reload_contour.points().iter())
        {
            assert!(
                (orig_point.x() - reload_point.x()).abs() < 0.001,
                "X coordinate should match: {} vs {}",
                orig_point.x(),
                reload_point.x()
            );
            assert!(
                (orig_point.y() - reload_point.y()).abs() < 0.001,
                "Y coordinate should match: {} vs {}",
                orig_point.y(),
                reload_point.y()
            );
        }
    }
}

#[test]
fn test_ufo_round_trip_point_types() {
    let ufo_path = mutatorsans_ufo_path();
    if !ufo_path.exists() {
        return;
    }

    let loader = FontLoader::new();
    let original = loader.read_font(ufo_path.to_str().unwrap()).unwrap();

    let temp_dir = tempfile::tempdir().expect("Failed to create temp dir");
    let temp_ufo = temp_dir.path().join("test_output.ufo");

    loader
        .write_font(&original, temp_ufo.to_str().unwrap())
        .expect("Failed to write UFO");

    let reloaded = loader
        .read_font(temp_ufo.to_str().unwrap())
        .expect("Failed to reload UFO");

    let glyph_name = "O";
    let orig_glyph = original
        .glyph(glyph_name)
        .expect("Original glyph O missing");
    let reload_glyph = reloaded
        .glyph(glyph_name)
        .expect("Reloaded glyph O missing");

    let orig_layer = get_main_layer(orig_glyph).expect("Original glyph should have a layer");
    let reload_layer = get_main_layer(reload_glyph).expect("Reloaded glyph should have a layer");

    let mut orig_contours: Vec<_> = orig_layer.contours_iter().collect();
    let mut reload_contours: Vec<_> = reload_layer.contours_iter().collect();

    orig_contours.sort_by(|a, b| {
        let a_first = a.points().first().map(|p| (p.x() as i64, p.y() as i64));
        let b_first = b.points().first().map(|p| (p.x() as i64, p.y() as i64));
        a_first.cmp(&b_first)
    });
    reload_contours.sort_by(|a, b| {
        let a_first = a.points().first().map(|p| (p.x() as i64, p.y() as i64));
        let b_first = b.points().first().map(|p| (p.x() as i64, p.y() as i64));
        a_first.cmp(&b_first)
    });

    for (orig_contour, reload_contour) in orig_contours.iter().zip(reload_contours.iter()) {
        for (orig_point, reload_point) in orig_contour
            .points()
            .iter()
            .zip(reload_contour.points().iter())
        {
            assert_eq!(
                orig_point.point_type(),
                reload_point.point_type(),
                "Point types should match"
            );
        }
    }
}

#[test]
fn test_ufo_round_trip_smooth_flags() {
    let ufo_path = mutatorsans_ufo_path();
    if !ufo_path.exists() {
        return;
    }

    let loader = FontLoader::new();
    let original = loader.read_font(ufo_path.to_str().unwrap()).unwrap();

    let temp_dir = tempfile::tempdir().expect("Failed to create temp dir");
    let temp_ufo = temp_dir.path().join("test_output.ufo");

    loader
        .write_font(&original, temp_ufo.to_str().unwrap())
        .expect("Failed to write UFO");

    let reloaded = loader
        .read_font(temp_ufo.to_str().unwrap())
        .expect("Failed to reload UFO");

    let glyph_name = "O";
    let orig_glyph = original
        .glyph(glyph_name)
        .expect("Original glyph O missing");
    let reload_glyph = reloaded
        .glyph(glyph_name)
        .expect("Reloaded glyph O missing");

    let orig_layer = get_main_layer(orig_glyph).expect("Original glyph should have a layer");
    let reload_layer = get_main_layer(reload_glyph).expect("Reloaded glyph should have a layer");

    let mut orig_contours: Vec<_> = orig_layer.contours_iter().collect();
    let mut reload_contours: Vec<_> = reload_layer.contours_iter().collect();

    orig_contours.sort_by(|a, b| {
        let a_first = a.points().first().map(|p| (p.x() as i64, p.y() as i64));
        let b_first = b.points().first().map(|p| (p.x() as i64, p.y() as i64));
        a_first.cmp(&b_first)
    });
    reload_contours.sort_by(|a, b| {
        let a_first = a.points().first().map(|p| (p.x() as i64, p.y() as i64));
        let b_first = b.points().first().map(|p| (p.x() as i64, p.y() as i64));
        a_first.cmp(&b_first)
    });

    for (orig_contour, reload_contour) in orig_contours.iter().zip(reload_contours.iter()) {
        for (orig_point, reload_point) in orig_contour
            .points()
            .iter()
            .zip(reload_contour.points().iter())
        {
            assert_eq!(
                orig_point.is_smooth(),
                reload_point.is_smooth(),
                "Smooth flags should match"
            );
        }
    }
}

#[test]
fn test_ufo_round_trip_contour_closed_state() {
    let ufo_path = mutatorsans_ufo_path();
    if !ufo_path.exists() {
        return;
    }

    let loader = FontLoader::new();
    let original = loader.read_font(ufo_path.to_str().unwrap()).unwrap();

    let temp_dir = tempfile::tempdir().expect("Failed to create temp dir");
    let temp_ufo = temp_dir.path().join("test_output.ufo");

    loader
        .write_font(&original, temp_ufo.to_str().unwrap())
        .expect("Failed to write UFO");

    let reloaded = loader
        .read_font(temp_ufo.to_str().unwrap())
        .expect("Failed to reload UFO");

    let glyph_name = "A";
    let orig_glyph = original
        .glyph(glyph_name)
        .expect("Original glyph A missing");
    let reload_glyph = reloaded
        .glyph(glyph_name)
        .expect("Reloaded glyph A missing");

    let orig_layer = get_main_layer(orig_glyph).expect("Original glyph should have a layer");
    let reload_layer = get_main_layer(reload_glyph).expect("Reloaded glyph should have a layer");

    let mut orig_contours: Vec<_> = orig_layer.contours_iter().collect();
    let mut reload_contours: Vec<_> = reload_layer.contours_iter().collect();

    orig_contours.sort_by(|a, b| {
        let a_first = a.points().first().map(|p| (p.x() as i64, p.y() as i64));
        let b_first = b.points().first().map(|p| (p.x() as i64, p.y() as i64));
        a_first.cmp(&b_first)
    });
    reload_contours.sort_by(|a, b| {
        let a_first = a.points().first().map(|p| (p.x() as i64, p.y() as i64));
        let b_first = b.points().first().map(|p| (p.x() as i64, p.y() as i64));
        a_first.cmp(&b_first)
    });

    for (orig_contour, reload_contour) in orig_contours.iter().zip(reload_contours.iter()) {
        assert_eq!(
            orig_contour.is_closed(),
            reload_contour.is_closed(),
            "Contour closed state should match"
        );
    }
}

#[test]
fn test_ufo_round_trip_glyph_widths() {
    let ufo_path = mutatorsans_ufo_path();
    if !ufo_path.exists() {
        return;
    }

    let loader = FontLoader::new();
    let original = loader.read_font(ufo_path.to_str().unwrap()).unwrap();

    let temp_dir = tempfile::tempdir().expect("Failed to create temp dir");
    let temp_ufo = temp_dir.path().join("test_output.ufo");

    loader
        .write_font(&original, temp_ufo.to_str().unwrap())
        .expect("Failed to write UFO");

    let reloaded = loader
        .read_font(temp_ufo.to_str().unwrap())
        .expect("Failed to reload UFO");

    for glyph_name in ["A", "B", "O", "space"] {
        let orig_glyph = match original.glyph(glyph_name) {
            Some(g) => g,
            None => continue,
        };
        let reload_glyph = reloaded.glyph(glyph_name).expect("Reloaded glyph missing");

        let mut orig_widths: Vec<_> = orig_glyph.layers().values().map(|l| l.width()).collect();
        let mut reload_widths: Vec<_> = reload_glyph.layers().values().map(|l| l.width()).collect();

        orig_widths.sort_by(|a, b| a.partial_cmp(b).unwrap());
        reload_widths.sort_by(|a, b| a.partial_cmp(b).unwrap());

        assert_eq!(
            orig_widths.len(),
            reload_widths.len(),
            "Layer count should match for glyph '{glyph_name}'"
        );

        for (orig_w, reload_w) in orig_widths.iter().zip(reload_widths.iter()) {
            assert!(
                (orig_w - reload_w).abs() < 0.001,
                "Width should match for glyph '{glyph_name}': {orig_w} vs {reload_w}"
            );
        }
    }
}

#[test]
fn test_ufo_round_trip_kerning_pairs() {
    let ufo_path = mutatorsans_ufo_path();
    if !ufo_path.exists() {
        return;
    }

    let loader = FontLoader::new();
    let original = loader.read_font(ufo_path.to_str().unwrap()).unwrap();

    let temp_dir = tempfile::tempdir().expect("Failed to create temp dir");
    let temp_ufo = temp_dir.path().join("test_output.ufo");

    loader
        .write_font(&original, temp_ufo.to_str().unwrap())
        .expect("Failed to write UFO");

    let reloaded = loader
        .read_font(temp_ufo.to_str().unwrap())
        .expect("Failed to reload UFO");

    let orig_kerning = original.kerning();
    let reload_kerning = reloaded.kerning();

    assert!(
        !orig_kerning.is_empty(),
        "MutatorSans should have kerning data"
    );
    assert_eq!(
        orig_kerning.pairs().len(),
        reload_kerning.pairs().len(),
        "Kerning pair count should match after round-trip"
    );

    for orig_pair in orig_kerning.pairs() {
        let found = reload_kerning.pairs().iter().any(|reload_pair| {
            orig_pair.first == reload_pair.first
                && orig_pair.second == reload_pair.second
                && (orig_pair.value - reload_pair.value).abs() < 0.001
        });
        assert!(
            found,
            "Kerning pair {orig_pair:?} not found after round-trip"
        );
    }
}

#[test]
fn test_ufo_round_trip_kerning_groups() {
    let ufo_path = mutatorsans_ufo_path();
    if !ufo_path.exists() {
        return;
    }

    let loader = FontLoader::new();
    let original = loader.read_font(ufo_path.to_str().unwrap()).unwrap();

    let temp_dir = tempfile::tempdir().expect("Failed to create temp dir");
    let temp_ufo = temp_dir.path().join("test_output.ufo");

    loader
        .write_font(&original, temp_ufo.to_str().unwrap())
        .expect("Failed to write UFO");

    let reloaded = loader
        .read_font(temp_ufo.to_str().unwrap())
        .expect("Failed to reload UFO");

    let orig_kerning = original.kerning();
    let reload_kerning = reloaded.kerning();

    assert_eq!(
        orig_kerning.groups1().len(),
        reload_kerning.groups1().len(),
        "Kerning group1 count should match"
    );
    assert_eq!(
        orig_kerning.groups2().len(),
        reload_kerning.groups2().len(),
        "Kerning group2 count should match"
    );

    for (name, members) in orig_kerning.groups1() {
        let reload_members = reload_kerning
            .groups1()
            .get(name)
            .unwrap_or_else(|| panic!("Group1 '{name}' should exist after round-trip"));
        assert_eq!(
            members.len(),
            reload_members.len(),
            "Group1 '{name}' member count should match"
        );
        for member in members {
            assert!(
                reload_members.contains(member),
                "Group1 '{name}' should contain member '{member}'"
            );
        }
    }
}

#[test]
fn test_ufo_round_trip_kerning_lookup() {
    let ufo_path = mutatorsans_ufo_path();
    if !ufo_path.exists() {
        return;
    }

    let loader = FontLoader::new();
    let original = loader.read_font(ufo_path.to_str().unwrap()).unwrap();

    let temp_dir = tempfile::tempdir().expect("Failed to create temp dir");
    let temp_ufo = temp_dir.path().join("test_output.ufo");

    loader
        .write_font(&original, temp_ufo.to_str().unwrap())
        .expect("Failed to write UFO");

    let reloaded = loader
        .read_font(temp_ufo.to_str().unwrap())
        .expect("Failed to reload UFO");

    let test_pairs = [("T", "A", -75.0), ("V", "A", -100.0), ("A", "V", -15.0)];

    for (first, second, expected) in test_pairs {
        let orig_value = original
            .kerning()
            .get_kerning(&first.to_string(), &second.to_string());
        let reload_value = reloaded
            .kerning()
            .get_kerning(&first.to_string(), &second.to_string());

        assert_eq!(
            orig_value,
            Some(expected),
            "Original kerning for {first} -> {second} should be {expected}"
        );
        assert_eq!(
            reload_value,
            Some(expected),
            "Reloaded kerning for {first} -> {second} should be {expected}"
        );
    }
}

#[test]
fn test_ufo_round_trip_components() {
    let ufo_path = mutatorsans_ufo_path();
    if !ufo_path.exists() {
        return;
    }

    let loader = FontLoader::new();
    let original = loader.read_font(ufo_path.to_str().unwrap()).unwrap();

    let temp_dir = tempfile::tempdir().expect("Failed to create temp dir");
    let temp_ufo = temp_dir.path().join("test_output.ufo");

    loader
        .write_font(&original, temp_ufo.to_str().unwrap())
        .expect("Failed to write UFO");

    let reloaded = loader
        .read_font(temp_ufo.to_str().unwrap())
        .expect("Failed to reload UFO");

    let glyph_name = "Aacute";
    let orig_glyph = original
        .glyph(glyph_name)
        .expect("Original glyph Aacute missing");
    let reload_glyph = reloaded
        .glyph(glyph_name)
        .expect("Reloaded glyph Aacute missing");

    let orig_layer = get_main_layer(orig_glyph).expect("Original glyph should have a layer");
    let reload_layer = get_main_layer(reload_glyph).expect("Reloaded glyph should have a layer");

    assert!(
        !orig_layer.components().is_empty(),
        "Aacute should have components"
    );

    let orig_components: Vec<_> = orig_layer.components_iter().collect();
    let reload_components: Vec<_> = reload_layer.components_iter().collect();

    assert_eq!(
        orig_components.len(),
        reload_components.len(),
        "Component count should match for Aacute"
    );

    assert_eq!(orig_components.len(), 2, "Aacute should have 2 components");

    for orig_comp in &orig_components {
        let found = reload_components
            .iter()
            .any(|reload_comp| orig_comp.base_glyph() == reload_comp.base_glyph());
        assert!(
            found,
            "Component with base '{}' not found after round-trip",
            orig_comp.base_glyph()
        );
    }

    let orig_bases: Vec<_> = orig_components.iter().map(|c| c.base_glyph()).collect();
    assert!(
        orig_bases.contains(&&"A".to_string()),
        "Aacute should have A component"
    );
    assert!(
        orig_bases.contains(&&"acute".to_string()),
        "Aacute should have acute component"
    );
}

#[test]
fn test_ufo_round_trip_component_transforms() {
    let ufo_path = mutatorsans_ufo_path();
    if !ufo_path.exists() {
        return;
    }

    let loader = FontLoader::new();
    let original = loader.read_font(ufo_path.to_str().unwrap()).unwrap();

    let temp_dir = tempfile::tempdir().expect("Failed to create temp dir");
    let temp_ufo = temp_dir.path().join("test_output.ufo");

    loader
        .write_font(&original, temp_ufo.to_str().unwrap())
        .expect("Failed to write UFO");

    let reloaded = loader
        .read_font(temp_ufo.to_str().unwrap())
        .expect("Failed to reload UFO");

    let glyph_name = "Aacute";
    let orig_glyph = original.glyph(glyph_name).expect("Original glyph missing");
    let reload_glyph = reloaded.glyph(glyph_name).expect("Reloaded glyph missing");

    let orig_layer = get_main_layer(orig_glyph).expect("Original glyph should have a layer");
    let reload_layer = get_main_layer(reload_glyph).expect("Reloaded glyph should have a layer");

    let orig_acute = orig_layer
        .components_iter()
        .find(|c| c.base_glyph() == "acute")
        .expect("Original should have acute component");
    let reload_acute = reload_layer
        .components_iter()
        .find(|c| c.base_glyph() == "acute")
        .expect("Reloaded should have acute component");

    let orig_matrix = orig_acute.matrix();
    let reload_matrix = reload_acute.matrix();

    assert!(
        (orig_matrix.dx - 99.0).abs() < 0.1,
        "Original acute xOffset should be ~99, got {}",
        orig_matrix.dx
    );
    assert!(
        (orig_matrix.dy - 20.0).abs() < 0.1,
        "Original acute yOffset should be ~20, got {}",
        orig_matrix.dy
    );

    assert!(
        (orig_matrix.dx - reload_matrix.dx).abs() < 0.1,
        "xOffset should match after round-trip: {} vs {}",
        orig_matrix.dx,
        reload_matrix.dx
    );
    assert!(
        (orig_matrix.dy - reload_matrix.dy).abs() < 0.1,
        "yOffset should match after round-trip: {} vs {}",
        orig_matrix.dy,
        reload_matrix.dy
    );
}

#[test]
fn test_ufo_round_trip_multiple_layers() {
    let ufo_path = mutatorsans_ufo_path();
    if !ufo_path.exists() {
        return;
    }

    let loader = FontLoader::new();
    let original = loader.read_font(ufo_path.to_str().unwrap()).unwrap();

    let temp_dir = tempfile::tempdir().expect("Failed to create temp dir");
    let temp_ufo = temp_dir.path().join("test_output.ufo");

    loader
        .write_font(&original, temp_ufo.to_str().unwrap())
        .expect("Failed to write UFO");

    let reloaded = loader
        .read_font(temp_ufo.to_str().unwrap())
        .expect("Failed to reload UFO");

    let orig_layer_count = original.layers().len();
    let reload_layer_count = reloaded.layers().len();

    assert!(
        orig_layer_count >= 2,
        "MutatorSans should have multiple layers, got {orig_layer_count}"
    );

    assert_eq!(
        orig_layer_count, reload_layer_count,
        "Layer count should match after round-trip: {orig_layer_count} vs {reload_layer_count}"
    );

    for orig_layer in original.layers().values() {
        let orig_name = orig_layer.name();
        let found = reloaded.layers().values().any(|l| l.name() == orig_name);
        assert!(found, "Layer '{orig_name}' should exist after round-trip");
    }
}

#[test]
fn test_ufo_round_trip_layer_glyph_counts() {
    let ufo_path = mutatorsans_ufo_path();
    if !ufo_path.exists() {
        return;
    }

    let loader = FontLoader::new();
    let original = loader.read_font(ufo_path.to_str().unwrap()).unwrap();

    let temp_dir = tempfile::tempdir().expect("Failed to create temp dir");
    let temp_ufo = temp_dir.path().join("test_output.ufo");

    loader
        .write_font(&original, temp_ufo.to_str().unwrap())
        .expect("Failed to write UFO");

    let reloaded = loader
        .read_font(temp_ufo.to_str().unwrap())
        .expect("Failed to reload UFO");

    for (orig_layer_id, orig_layer) in original.layers() {
        let orig_name = orig_layer.name();

        let mut orig_glyph_count = 0;
        for glyph in original.glyphs().values() {
            if glyph.layer(*orig_layer_id).is_some() {
                orig_glyph_count += 1;
            }
        }

        let reload_layer = reloaded
            .layers()
            .values()
            .find(|l| l.name() == orig_name)
            .unwrap_or_else(|| panic!("Layer '{orig_name}' should exist"));
        let reload_layer_id = reload_layer.id();

        let mut reload_glyph_count = 0;
        for glyph in reloaded.glyphs().values() {
            if glyph.layer(reload_layer_id).is_some() {
                reload_glyph_count += 1;
            }
        }

        assert_eq!(
            orig_glyph_count, reload_glyph_count,
            "Glyph count in layer '{orig_name}' should match: {orig_glyph_count} vs {reload_glyph_count}"
        );
    }
}

#[test]
fn test_ufo_round_trip_anchors_preserve_order_and_values() {
    let ufo_path = mutatorsans_ufo_path();
    if !ufo_path.exists() {
        return;
    }

    let loader = FontLoader::new();
    let original = loader.read_font(ufo_path.to_str().unwrap()).unwrap();

    let temp_dir = tempfile::tempdir().expect("Failed to create temp dir");
    let temp_ufo = temp_dir.path().join("test_output.ufo");

    loader
        .write_font(&original, temp_ufo.to_str().unwrap())
        .expect("Failed to write UFO");

    let reloaded = loader
        .read_font(temp_ufo.to_str().unwrap())
        .expect("Failed to reload UFO");

    let glyph_name = "E";
    let orig_glyph = original.glyph(glyph_name).expect("Original glyph missing");
    let reload_glyph = reloaded.glyph(glyph_name).expect("Reloaded glyph missing");

    for (orig_layer_id, orig_font_layer) in original.layers() {
        let Some(orig_layer) = orig_glyph.layer(*orig_layer_id) else {
            continue;
        };

        let reload_layer_id = reloaded
            .layers()
            .iter()
            .find(|(_, layer)| layer.name() == orig_font_layer.name())
            .map(|(id, _)| *id)
            .unwrap_or_else(|| panic!("Missing reloaded layer '{}'", orig_font_layer.name()));

        let Some(reload_layer) = reload_glyph.layer(reload_layer_id) else {
            panic!(
                "Glyph '{}' missing in reloaded layer '{}'",
                glyph_name,
                orig_font_layer.name()
            );
        };

        let orig_anchors: Vec<_> = orig_layer.anchors_iter().collect();
        let reload_anchors: Vec<_> = reload_layer.anchors_iter().collect();

        assert_eq!(
            orig_anchors.len(),
            reload_anchors.len(),
            "Anchor count should match after round-trip in layer '{}'",
            orig_font_layer.name()
        );

        for (orig_anchor, reload_anchor) in orig_anchors.iter().zip(reload_anchors.iter()) {
            assert_eq!(
                orig_anchor.name(),
                reload_anchor.name(),
                "Anchor names should preserve order and value in layer '{}'",
                orig_font_layer.name()
            );
            assert!(
                (orig_anchor.x() - reload_anchor.x()).abs() < 0.001,
                "Anchor x should match after round-trip in layer '{}': {} vs {}",
                orig_font_layer.name(),
                orig_anchor.x(),
                reload_anchor.x()
            );
            assert!(
                (orig_anchor.y() - reload_anchor.y()).abs() < 0.001,
                "Anchor y should match after round-trip in layer '{}': {} vs {}",
                orig_font_layer.name(),
                orig_anchor.y(),
                reload_anchor.y()
            );
        }
    }
}

#[test]
fn test_ufo_round_trip_preserves_unnamed_anchor() {
    let ufo_path = mutatorsans_ufo_path();
    if !ufo_path.exists() {
        return;
    }

    let loader = FontLoader::new();
    let mut original = loader.read_font(ufo_path.to_str().unwrap()).unwrap();

    let target_layer_id = {
        let glyph = original
            .glyph_mut("E")
            .expect("Glyph 'E' should exist to append unnamed anchor");
        let target_layer_id = glyph
            .layers()
            .iter()
            .max_by_key(|(_, layer)| layer.contours().len())
            .map(|(id, _)| *id)
            .expect("Glyph 'E' should have at least one layer");
        let layer = glyph
            .layer_mut(target_layer_id)
            .expect("Layer should exist");
        layer.add_anchor(Anchor::new(None::<String>, 123.0, 456.0));
        target_layer_id
    };
    let target_layer_name = original
        .layers()
        .get(&target_layer_id)
        .map(|layer| layer.name().to_string())
        .expect("Target layer should exist");

    let temp_dir = tempfile::tempdir().expect("Failed to create temp dir");
    let temp_ufo = temp_dir.path().join("test_output.ufo");

    loader
        .write_font(&original, temp_ufo.to_str().unwrap())
        .expect("Failed to write UFO");

    let reloaded = loader
        .read_font(temp_ufo.to_str().unwrap())
        .expect("Failed to reload UFO");

    let glyph = reloaded
        .glyph("E")
        .expect("Reloaded glyph 'E' should exist after round-trip");
    let reload_layer_id = reloaded
        .layers()
        .iter()
        .find(|(_, layer)| layer.name() == target_layer_name)
        .map(|(id, _)| *id)
        .unwrap_or_else(|| reloaded.default_layer_id());
    let layer = glyph
        .layer(reload_layer_id)
        .or_else(|| get_main_layer(glyph))
        .expect("Reloaded glyph should have a matching layer");
    let unnamed = layer.anchors_iter().find(|a| {
        a.name().is_none() && (a.x() - 123.0).abs() < 0.001 && (a.y() - 456.0).abs() < 0.001
    });

    assert!(
        unnamed.is_some(),
        "Unnamed anchor should survive UFO round-trip with preserved coordinates"
    );
}
