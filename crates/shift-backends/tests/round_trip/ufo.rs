use std::path::{Path, PathBuf};

use shift_backends::font_loader::FontLoader;
use shift_font::{Anchor, Font, Glyph, GlyphLayer, LibValue};

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

const PNG_BYTES: &[u8] = &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x2A];

/// Builds a UFO exercising everything Shift must preserve without modeling:
/// every plist type in libs, data/ and images/ files, layerinfo color and
/// lib, and fontinfo fields outside the mapped set.
fn preservation_fixture_ufo(dir: &Path) -> PathBuf {
    use norad::fontinfo::{Os2Panose, Os2WidthClass, WoffMetadataUniqueId};

    let mut norad_font = norad::Font::new();

    let info = &mut norad_font.font_info;
    info.family_name = Some("Preservation Sans".to_string());
    info.style_name = Some("Regular".to_string());
    info.units_per_em = Some(1000_u32.into());
    info.ascender = Some(800.0);
    info.descender = Some(-200.0);
    info.postscript_blue_values = Some(vec![-16.0, 0.0, 500.0, 516.0]);
    info.postscript_stem_snap_h = Some(vec![80.0, 88.0]);
    info.postscript_stem_snap_v = Some(vec![92.0, 100.0]);
    info.open_type_os2_weight_class = Some(700);
    info.open_type_os2_width_class = Some(Os2WidthClass::Condensed);
    info.open_type_os2_type = Some(vec![2]);
    info.open_type_os2_unicode_ranges = Some(vec![0, 1, 38]);
    info.open_type_os2_panose = Some(Os2Panose {
        family_type: 2,
        serif_style: 11,
        weight: 8,
        proportion: 3,
        contrast: 5,
        stroke_variation: 2,
        arm_style: 2,
        letterform: 2,
        midline: 2,
        x_height: 4,
    });
    info.woff_metadata_unique_id = Some(WoffMetadataUniqueId {
        id: "preservation-woff-id".to_string(),
    });

    norad_font.guidelines_mut().push(norad::Guideline::new(
        norad::Line::Horizontal(520.0),
        Some(norad::Name::new("x-guide").unwrap()),
        Some("0,0.5,1,1".parse().unwrap()),
        None,
    ));

    let date = plist::Date::from_xml_format("2024-02-02T02:02:02Z").unwrap();
    let mut nested = plist::Dictionary::new();
    nested.insert("nestedString".into(), plist::Value::String("deep".into()));
    nested.insert("nestedInt".into(), plist::Value::Integer(7.into()));
    let lib = &mut norad_font.lib;
    lib.insert(
        "com.shift.string".into(),
        plist::Value::String("lib string".into()),
    );
    lib.insert("com.shift.int".into(), plist::Value::Integer(42.into()));
    lib.insert(
        "com.shift.negativeInt".into(),
        plist::Value::Integer((-42_i64).into()),
    );
    lib.insert(
        "com.shift.hugeUnsigned".into(),
        plist::Value::Integer(u64::MAX.into()),
    );
    lib.insert("com.shift.float".into(), plist::Value::Real(1.25));
    lib.insert("com.shift.bool".into(), plist::Value::Boolean(true));
    lib.insert(
        "com.shift.array".into(),
        plist::Value::Array(vec![
            plist::Value::String("first".into()),
            plist::Value::Integer(2.into()),
            plist::Value::Boolean(false),
        ]),
    );
    lib.insert("com.shift.dict".into(), plist::Value::Dictionary(nested));
    lib.insert(
        "com.shift.data".into(),
        plist::Value::Data(vec![0, 1, 254, 255]),
    );
    lib.insert("com.shift.date".into(), plist::Value::Date(date));

    let mut glyph = norad::Glyph::new("A");
    glyph.width = 600.0;
    glyph.codepoints.insert('A');
    glyph.lib.insert(
        "com.shift.glyphNote".into(),
        plist::Value::String("glyph lib".into()),
    );
    glyph.lib.insert(
        "com.shift.glyphDate".into(),
        plist::Value::Date(plist::Date::from_xml_format("2025-12-31T23:59:59Z").unwrap()),
    );
    norad_font.layers.default_layer_mut().insert_glyph(glyph);

    let background = norad_font.layers.new_layer("background").unwrap();
    background.color = Some("1,0,0,0.5".parse().unwrap());
    background.lib.insert(
        "com.shift.layerRole".into(),
        plist::Value::String("sketch".into()),
    );
    let mut background_glyph = norad::Glyph::new("A");
    background_glyph.width = 600.0;
    background.insert_glyph(background_glyph);

    norad_font
        .data
        .insert(
            PathBuf::from("com.shift.test/nested/payload.bin"),
            vec![0x00, 0x01, 0xFE, 0xFF],
        )
        .unwrap();
    norad_font
        .data
        .insert(PathBuf::from("readme.txt"), b"data dir".to_vec())
        .unwrap();
    norad_font
        .images
        .insert(PathBuf::from("glyph-photo.png"), PNG_BYTES.to_vec())
        .unwrap();

    let ufo_path = dir.join("Preservation.ufo");
    norad_font.save(&ufo_path).expect("fixture UFO should save");
    ufo_path
}

fn lib_string(value: Option<&LibValue>) -> &str {
    match value {
        Some(LibValue::String(value)) => value,
        other => panic!("expected string lib value, got {other:?}"),
    }
}

#[test]
fn preserves_libs_binaries_layerinfo_and_fontinfo_through_round_trip() {
    let temp_dir = tempfile::tempdir().expect("tempdir should be created");
    let fixture = preservation_fixture_ufo(temp_dir.path());

    let original = load_font(&fixture);
    let reloaded = round_trip(&original);

    assert_eq!(
        original.lib().get("com.shift.hugeUnsigned"),
        Some(&LibValue::UnsignedInteger(u64::MAX))
    );
    assert_eq!(
        original.lib().get("com.shift.negativeInt"),
        Some(&LibValue::Integer(-42))
    );
    assert_eq!(
        original.lib().get("com.shift.date"),
        Some(&LibValue::Date("2024-02-02T02:02:02Z".to_string()))
    );
    assert_eq!(
        original.lib().get("com.shift.data"),
        Some(&LibValue::Data(vec![0, 1, 254, 255]))
    );
    assert!(!original.lib().is_empty());
    assert_eq!(reloaded.lib(), original.lib());

    let original_glyph = original.glyph_by_name("A").expect("A should exist");
    let reloaded_glyph = reloaded.glyph_by_name("A").expect("A should survive");
    assert_eq!(
        lib_string(original_glyph.lib().get("com.shift.glyphNote")),
        "glyph lib"
    );
    assert_eq!(
        original_glyph.lib().get("com.shift.glyphDate"),
        Some(&LibValue::Date("2025-12-31T23:59:59Z".to_string()))
    );
    assert_eq!(reloaded_glyph.lib(), original_glyph.lib());

    assert_eq!(
        original
            .data_files()
            .get("com.shift.test/nested/payload.bin"),
        Some([0x00, 0x01, 0xFE, 0xFF].as_slice())
    );
    assert_eq!(
        original.data_files().get("readme.txt"),
        Some(b"data dir".as_slice())
    );
    assert_eq!(original.images().get("glyph-photo.png"), Some(PNG_BYTES));
    assert_eq!(reloaded.data_files(), original.data_files());
    assert_eq!(reloaded.images(), original.images());

    let original_background = original
        .sources()
        .iter()
        .find(|source| source.name() == "background")
        .expect("background source should exist");
    let reloaded_background = reloaded
        .sources()
        .iter()
        .find(|source| source.name() == "background")
        .expect("background source should survive");
    assert_eq!(original_background.color(), Some("1,0,0,0.5"));
    assert_eq!(reloaded_background.color(), original_background.color());
    assert_eq!(
        lib_string(original_background.lib().get("com.shift.layerRole")),
        "sketch"
    );
    assert_eq!(reloaded_background.lib(), original_background.lib());

    let expected_remainder = [
        (
            "postscriptBlueValues",
            LibValue::Array(vec![
                LibValue::Integer(-16),
                LibValue::Integer(0),
                LibValue::Integer(500),
                LibValue::Integer(516),
            ]),
        ),
        (
            "postscriptStemSnapH",
            LibValue::Array(vec![LibValue::Integer(80), LibValue::Integer(88)]),
        ),
        (
            "postscriptStemSnapV",
            LibValue::Array(vec![LibValue::Integer(92), LibValue::Integer(100)]),
        ),
        ("openTypeOS2WeightClass", LibValue::Integer(700)),
        ("openTypeOS2WidthClass", LibValue::Integer(3)),
        (
            "openTypeOS2Type",
            LibValue::Array(vec![LibValue::Integer(2)]),
        ),
        (
            "openTypeOS2UnicodeRanges",
            LibValue::Array(vec![
                LibValue::Integer(0),
                LibValue::Integer(1),
                LibValue::Integer(38),
            ]),
        ),
        (
            "openTypeOS2Panose",
            LibValue::Array(vec![
                LibValue::Integer(2),
                LibValue::Integer(11),
                LibValue::Integer(8),
                LibValue::Integer(3),
                LibValue::Integer(5),
                LibValue::Integer(2),
                LibValue::Integer(2),
                LibValue::Integer(2),
                LibValue::Integer(2),
                LibValue::Integer(4),
            ]),
        ),
    ];
    for (key, expected) in expected_remainder {
        assert_eq!(
            original.fontinfo_remainder().get(key),
            Some(&expected),
            "fontinfo remainder should carry {key}"
        );
    }
    match original.fontinfo_remainder().get("woffMetadataUniqueID") {
        Some(LibValue::Dict(woff)) => {
            assert_eq!(lib_string(woff.get("id")), "preservation-woff-id")
        }
        other => panic!("expected WOFF metadata dict, got {other:?}"),
    }
    assert!(
        original.fontinfo_remainder().get("familyName").is_none(),
        "modeled fields must not leak into the fontinfo remainder"
    );
    assert_eq!(reloaded.fontinfo_remainder(), original.fontinfo_remainder());

    let original_guideline = original
        .guidelines()
        .iter()
        .find(|guideline| guideline.name() == Some("x-guide"))
        .expect("font guideline should exist");
    let reloaded_guideline = reloaded
        .guidelines()
        .iter()
        .find(|guideline| guideline.name() == Some("x-guide"))
        .expect("font guideline should survive");
    assert_eq!(original_guideline.y(), Some(520.0));
    assert_eq!(original_guideline.color(), Some("0,0.5,1,1"));
    assert_eq!(reloaded_guideline.y(), original_guideline.y());
    assert_eq!(reloaded_guideline.color(), original_guideline.color());
}

#[test]
fn edited_ir_fields_win_over_preserved_fontinfo_on_save() {
    let temp_dir = tempfile::tempdir().expect("tempdir should be created");
    let fixture = preservation_fixture_ufo(temp_dir.path());

    let mut font = load_font(&fixture);
    font.metadata_mut().family_name = Some("Renamed Sans".to_string());

    let reloaded = round_trip(&font);

    assert_eq!(
        reloaded.metadata().family_name.as_deref(),
        Some("Renamed Sans"),
        "edited IR metadata must win on save"
    );
    assert!(
        reloaded.fontinfo_remainder().get("familyName").is_none(),
        "no stale familyName may resurrect from the remainder"
    );
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
                .glyph_by_name(glyph_name)
                .unwrap_or_else(|| panic!("original {glyph_name} should exist")),
        );
        let reloaded_layer = main_layer(
            reloaded
                .glyph_by_name(glyph_name)
                .unwrap_or_else(|| panic!("reloaded {glyph_name} should exist")),
        );

        assert!((original_layer.width() - reloaded_layer.width()).abs() < 0.001);
        assert_layer_geometry_matches(original_layer, reloaded_layer);
    }
}

#[test]
fn preserves_components_anchors_layers_and_kerning() {
    let mut original = load_font(&mutatorsans_ufo_path());
    let e_layer_id = original
        .glyph_by_name("E")
        .expect("E glyph should exist")
        .layers()
        .iter()
        .max_by_key(|(_, layer)| layer.contours().len())
        .map(|(layer_id, _)| layer_id.clone())
        .expect("E should have a main layer");
    original
        .layer_mut(e_layer_id)
        .expect("E should have a main layer")
        .add_anchor(Anchor::new(None::<String>, 123.0, 456.0));

    let reloaded = round_trip(&original);

    let aacute = reloaded
        .glyph_by_name("Aacute")
        .expect("Aacute should exist");
    let component_bases: Vec<_> = main_layer(aacute)
        .components_iter()
        .map(|component| component.base_glyph_name().as_str())
        .collect();
    assert_eq!(component_bases.len(), 2);
    assert!(component_bases.contains(&"A"));
    assert!(component_bases.contains(&"acute"));

    let e = reloaded.glyph_by_name("E").expect("E should exist");
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

    let original_source_names: Vec<_> = original
        .sources()
        .iter()
        .map(|source| source.name())
        .collect();
    let reloaded_source_names: Vec<_> = reloaded
        .sources()
        .iter()
        .map(|source| source.name())
        .collect();
    assert_eq!(reloaded_source_names.len(), original_source_names.len());
    for name in original_source_names {
        assert!(reloaded_source_names.contains(&name));
    }

    assert_eq!(reloaded.kerning().get_kerning("T", "A"), Some(-75.0));
    assert_eq!(reloaded.kerning().get_kerning("V", "A"), Some(-100.0));
}
