use std::fs::File;

use shift_font::{
    Anchor, AnchorId, Axis, AxisId, Component, ComponentId, Contour, ContourId,
    DecomposedTransform, Font, Glyph, GlyphId, GlyphLayer, Guideline, GuidelineId, KerningPair,
    KerningSide, LayerId, LibValue, Location, Point, PointId, PointType, Source, SourceId,
};
use shift_source::{
    AXES_FILE, FEATURES_FILE, FONT_FILE, GLYPHS_DIR, KERNING_FILE, LIB_MODULE_FILE, MANIFEST_FILE,
    PackageTree, SOURCES_FILE, ShiftSourcePackage, SourcePackageError, font_to_tree, tree_to_font,
    write_tree_atomic,
};
use zip::{CompressionMethod, ZipArchive};

fn sample_font() -> Font {
    let mut font = Font::empty();
    font.metadata_mut().family_name = Some("Dogfood Sans".to_string());
    font.metadata_mut().style_name = Some("Regular".to_string());
    font.metrics_mut().units_per_em = 2048.0;
    font.metrics_mut().ascender = 1500.0;
    font.metrics_mut().descender = -500.0;
    font.features_mut()
        .set_fea_source(Some("feature kern { pos A A -80; } kern;".to_string()));
    font.kerning_mut()
        .set_group1("public.kern1.A".to_string(), vec!["A".into()]);
    font.kerning_mut()
        .set_group2("public.kern2.A".to_string(), vec!["A".into()]);
    font.kerning_mut().add_pair(KerningPair::new(
        KerningSide::Group("public.kern1.A".to_string()),
        KerningSide::Group("public.kern2.A".to_string()),
        -80.0,
    ));
    let mut font_guideline = Guideline::with_id(
        GuidelineId::from_raw("cap_height"),
        None,
        Some(700.0),
        None,
        Some("Cap Height".to_string()),
        Some("blue".to_string()),
    );
    font_guideline.set_color(Some("green".to_string()));
    font.add_guideline(font_guideline);
    font.lib_mut().set(
        "com.shift.note".to_string(),
        LibValue::String("font note".to_string()),
    );

    let weight_id = AxisId::from_raw("weight");
    let mut weight = Axis::with_id(
        weight_id.clone(),
        "wght".to_string(),
        "Weight".to_string(),
        100.0,
        400.0,
        900.0,
    );
    weight.set_hidden(true);
    font.add_axis(weight);

    let regular_id = SourceId::from_raw("regular");
    let bold_id = SourceId::from_raw("bold");
    let mut bold_location = Location::new();
    bold_location.set(weight_id, 900.0);
    font.add_source(Source::with_id(
        regular_id.clone(),
        "Regular".to_string(),
        Location::new(),
        Some("Regular.ufo".to_string()),
    ));
    font.add_source(Source::with_id(
        bold_id.clone(),
        "Bold".to_string(),
        bold_location,
        None,
    ));
    font.set_default_source_id(regular_id.clone());

    let acute_id = GlyphId::from_raw("acute");
    let mut acute = Glyph::with_id(acute_id.clone(), "acute");
    acute.set_layer(GlyphLayer::with_width(
        LayerId::from_raw("acute_regular"),
        regular_id.clone(),
        200.0,
    ));
    font.insert_glyph(acute).unwrap();

    let glyph_id = GlyphId::from_raw("A");
    let mut glyph = Glyph::with_id(glyph_id, "A");
    glyph.set_unicodes(vec![0x0041, 0x00C1]);

    let mut regular_layer =
        GlyphLayer::with_width(LayerId::from_raw("A_regular"), regular_id, 600.0);
    regular_layer.set_height(Some(700.0));
    let mut contour = Contour::with_id(ContourId::from_raw("A_outer"));
    contour.push_point(Point::new(
        PointId::from_raw("A_0"),
        100.0,
        0.0,
        PointType::OnCurve,
        false,
    ));
    contour.push_point(Point::new(
        PointId::from_raw("A_1"),
        300.0,
        700.0,
        PointType::OffCurve,
        true,
    ));
    contour.push_point(Point::new(
        PointId::from_raw("A_2"),
        500.0,
        0.0,
        PointType::OnCurve,
        false,
    ));
    contour.close();
    regular_layer.add_contour(contour);
    regular_layer.add_anchor(Anchor::with_id(
        AnchorId::from_raw("A_top"),
        Some("top".to_string()),
        300.0,
        700.0,
    ));
    regular_layer.add_component(Component::with_id(
        ComponentId::from_raw("acute_component"),
        acute_id,
        "acute",
        DecomposedTransform {
            translate_x: 10.0,
            translate_y: 20.0,
            rotation: 5.0,
            scale_x: 1.1,
            scale_y: 0.9,
            ..Default::default()
        },
    ));
    regular_layer.add_guideline(Guideline::with_id(
        GuidelineId::from_raw("baseline"),
        None,
        Some(0.0),
        None,
        Some("Baseline".to_string()),
        None,
    ));
    regular_layer
        .lib_mut()
        .set("com.shift.layer".to_string(), LibValue::Integer(42));
    glyph.set_layer(regular_layer);

    let mut bold_layer = GlyphLayer::with_width(LayerId::from_raw("A_bold"), bold_id, 650.0);
    let mut bold_contour = Contour::with_id(ContourId::from_raw("A_bold_outer"));
    bold_contour.push_point(Point::new(
        PointId::from_raw("A_bold_0"),
        90.0,
        0.0,
        PointType::OnCurve,
        false,
    ));
    bold_contour.push_point(Point::new(
        PointId::from_raw("A_bold_1"),
        310.0,
        720.0,
        PointType::OnCurve,
        false,
    ));
    bold_layer.add_contour(bold_contour);
    glyph.set_layer(bold_layer);
    glyph
        .lib_mut()
        .set("com.shift.glyph".to_string(), LibValue::Boolean(true));

    font.insert_glyph(glyph).unwrap();
    font
}

fn replace_tree_entry(tree: &mut PackageTree, path: &str, from: &str, to: &str) {
    let entry = tree
        .iter_mut()
        .find(|(entry_path, _)| entry_path == path)
        .unwrap_or_else(|| panic!("missing tree entry {path}"));
    let json = String::from_utf8(entry.1.clone()).unwrap();
    assert!(
        json.contains(from),
        "tree entry {path} did not contain {from:?}"
    );
    entry.1 = json.replacen(from, to, 1).into_bytes();
}

#[test]
fn creates_zip_package_with_manifest_first_and_stored() {
    let temp = tempfile::tempdir().unwrap();
    let package_path = temp.path().join("Dogfood.shift");
    let package = ShiftSourcePackage::save_font(&package_path, &sample_font()).unwrap();

    assert_eq!(package.path(), package_path.as_path());
    assert!(package.path().is_file());

    let mut archive = ZipArchive::new(File::open(&package_path).unwrap()).unwrap();
    let manifest = archive.by_index(0).unwrap();
    assert_eq!(manifest.name(), MANIFEST_FILE);
    assert_eq!(manifest.compression(), CompressionMethod::Stored);
}

#[test]
fn roundtrips_geometry_font_through_zip_package() {
    let temp = tempfile::tempdir().unwrap();
    let package_path = temp.path().join("Dogfood.shift");
    let original = sample_font();

    ShiftSourcePackage::save_font(&package_path, &original).unwrap();
    let loaded = ShiftSourcePackage::load_font(&package_path).unwrap();

    assert_eq!(
        loaded.metadata().family_name.as_deref(),
        Some("Dogfood Sans")
    );
    assert_eq!(loaded.metrics().units_per_em, 2048.0);
    assert_eq!(loaded.axes().len(), 1);
    assert_eq!(loaded.axes()[0].tag(), "wght");
    assert!(loaded.axes()[0].is_hidden());
    assert_eq!(loaded.kerning().get_kerning("A", "A"), Some(-80.0));
    assert!(
        loaded
            .features()
            .fea_source()
            .is_some_and(|source| source.contains("feature kern"))
    );
    assert_eq!(loaded.guidelines().len(), 1);
    assert_eq!(
        loaded.guidelines()[0].id(),
        GuidelineId::from_raw("cap_height")
    );
    assert_eq!(loaded.guidelines()[0].name(), Some("Cap Height"));
    assert_eq!(loaded.guidelines()[0].color(), Some("green"));
    assert!(matches!(
        loaded.lib().get("com.shift.note"),
        Some(LibValue::String(value)) if value == "font note"
    ));
    assert_eq!(loaded.sources().len(), 2);
    assert_eq!(
        loaded.default_source_id(),
        Some(SourceId::from_raw("regular"))
    );

    let glyph = loaded.glyph(GlyphId::from_raw("A")).unwrap();
    assert_eq!(glyph.name(), "A");
    assert_eq!(glyph.unicodes(), &[0x0041, 0x00C1]);
    assert!(matches!(
        glyph.lib().get("com.shift.glyph"),
        Some(LibValue::Boolean(true))
    ));

    let regular_layer = glyph.layer(LayerId::from_raw("A_regular")).unwrap();
    assert_eq!(regular_layer.source_id(), SourceId::from_raw("regular"));
    assert_eq!(regular_layer.width(), 600.0);
    assert_eq!(regular_layer.height(), Some(700.0));
    assert_eq!(regular_layer.contours().len(), 1);
    assert_eq!(regular_layer.components().len(), 1);
    assert_eq!(regular_layer.anchors().len(), 1);
    assert_eq!(regular_layer.guidelines().len(), 1);
    assert_eq!(
        regular_layer.guidelines()[0].id(),
        GuidelineId::from_raw("baseline")
    );
    assert!(matches!(
        regular_layer.lib().get("com.shift.layer"),
        Some(LibValue::Integer(42))
    ));

    let contour = regular_layer
        .contour(ContourId::from_raw("A_outer"))
        .unwrap();
    assert!(contour.is_closed());
    assert_eq!(contour.points().len(), 3);
    assert_eq!(contour.points()[1].point_type(), PointType::OffCurve);
    assert!(contour.points()[1].is_smooth());

    let component = regular_layer
        .component(ComponentId::from_raw("acute_component"))
        .unwrap();
    assert_eq!(component.base_glyph_id(), GlyphId::from_raw("acute"));
    assert_eq!(component.base_glyph_name().as_str(), "acute");
    assert_eq!(component.transform().translate_x, 10.0);

    let bold_layer = glyph.layer(LayerId::from_raw("A_bold")).unwrap();
    assert_eq!(bold_layer.source_id(), SourceId::from_raw("bold"));
    assert_eq!(bold_layer.width(), 650.0);
}

#[test]
fn serializes_same_font_to_byte_identical_tree() {
    let font = sample_font();

    let first = font_to_tree(&font).unwrap();
    let second = font_to_tree(&font).unwrap();

    assert_eq!(first, second);
    assert_eq!(
        first
            .iter()
            .map(|(path, _)| path.as_str())
            .collect::<Vec<_>>(),
        vec![
            MANIFEST_FILE,
            FONT_FILE,
            AXES_FILE,
            SOURCES_FILE,
            FEATURES_FILE,
            KERNING_FILE,
            LIB_MODULE_FILE,
            &format!("{GLYPHS_DIR}/glyph_A.json"),
            &format!("{GLYPHS_DIR}/glyph_acute.json")
        ]
    );
}

#[test]
fn rejects_kerning_references_to_unknown_glyph_names() {
    let mut font = Font::new();
    font.kerning_mut().add_pair(KerningPair::glyph_pair(
        "A".to_string(),
        "Missing".to_string(),
        -80.0,
    ));

    let error = font_to_tree(&font).unwrap_err();

    assert!(matches!(
        error,
        SourcePackageError::UnresolvedGlyphName {
            field: "kerning.pairs.first",
            name
        } if name == "A"
    ));
}

#[test]
fn parses_minimal_handwritten_tree() {
    let tree = vec![
        (
            MANIFEST_FILE.to_string(),
            br#"{
  "format": "shift-source",
  "schemaVersion": 1,
  "defaultSourceId": "source_regular"
}
"#
            .to_vec(),
        ),
        (
            FONT_FILE.to_string(),
            br#"{
  "metadata": {
    "familyName": "Minimal Sans",
    "styleName": "Regular",
    "versionMajor": 1,
    "versionMinor": 0,
    "copyright": null,
    "trademark": null,
    "designer": null,
    "designerUrl": null,
    "manufacturer": null,
    "manufacturerUrl": null,
    "license": null,
    "licenseUrl": null,
    "description": null,
    "note": null
  },
  "metrics": {
    "unitsPerEm": 1000.0,
    "ascender": 800.0,
    "descender": -200.0,
    "capHeight": 700.0,
    "xHeight": 500.0,
    "lineGap": null,
    "italicAngle": null,
    "underlinePosition": null,
    "underlineThickness": null
  }
}
"#
            .to_vec(),
        ),
        (
            AXES_FILE.to_string(),
            br#"{
  "axes": []
}
"#
            .to_vec(),
        ),
        (
            SOURCES_FILE.to_string(),
            br#"{
  "sources": [
    {
      "id": "source_regular",
      "name": "Regular",
      "location": {},
      "filename": null
    }
  ]
}
"#
            .to_vec(),
        ),
    ];

    let font = tree_to_font(tree).unwrap();

    assert_eq!(font.metadata().family_name.as_deref(), Some("Minimal Sans"));
    assert_eq!(font.sources().len(), 1);
    assert_eq!(
        font.default_source_id(),
        Some(SourceId::from_raw("regular"))
    );
    assert_eq!(font.glyph_count(), 0);
}

#[test]
fn rejects_glyph_file_id_mismatch() {
    let mut tree = font_to_tree(&sample_font()).unwrap();
    let glyph_entry = tree
        .iter_mut()
        .find(|(path, _)| path.starts_with(GLYPHS_DIR))
        .unwrap();
    let json = String::from_utf8(glyph_entry.1.clone())
        .unwrap()
        .replace("\"id\": \"glyph_A\"", "\"id\": \"glyph_B\"");
    glyph_entry.1 = json.into_bytes();

    let error = tree_to_font(tree).unwrap_err();

    assert!(matches!(
        error,
        SourcePackageError::MismatchedGlyphFileId { path, id }
            if path == "glyphs/glyph_A.json" && id == "glyph_B"
    ));
}

#[test]
fn rejects_non_finite_metric_values_before_json_serialization() {
    let mut font = sample_font();
    font.metrics_mut().ascender = f64::NAN;

    let error = font_to_tree(&font).unwrap_err();

    assert!(matches!(
        error,
        SourcePackageError::NonFiniteNumber { field } if field == "font.metrics.ascender"
    ));
}

#[test]
fn rejects_non_finite_source_location_values() {
    let mut font = Font::empty();
    let axis_id = AxisId::from_raw("weight");
    font.add_axis(Axis::with_id(
        axis_id.clone(),
        "wght".to_string(),
        "Weight".to_string(),
        100.0,
        400.0,
        900.0,
    ));
    let mut location = Location::new();
    location.set(axis_id, f64::INFINITY);
    font.add_source(Source::with_id(
        SourceId::from_raw("bad"),
        "Bad".to_string(),
        location,
        None,
    ));

    let error = font_to_tree(&font).unwrap_err();

    assert!(matches!(
        error,
        SourcePackageError::NonFiniteNumber { field }
            if field == "sources[source_bad].location[axis_weight]"
    ));
}

#[test]
fn rejects_invalid_axis_ranges_on_load() {
    let mut tree = font_to_tree(&Font::new()).unwrap();
    let axes_entry = tree
        .iter_mut()
        .find(|(path, _)| path == AXES_FILE)
        .expect("axes entry");
    axes_entry.1 = br#"{
  "axes": [
    {
      "id": "axis_weight",
      "tag": "wght",
      "name": "Weight",
      "minimum": 900.0,
      "default": 400.0,
      "maximum": 100.0,
      "hidden": false
    }
  ]
}
"#
    .to_vec();

    let error = tree_to_font(tree).unwrap_err();

    assert!(matches!(
        error,
        SourcePackageError::InvalidAxisRange { tag, .. } if tag == "wght"
    ));
}

#[test]
fn rejects_dangling_default_source_id() {
    let mut tree = font_to_tree(&sample_font()).unwrap();
    replace_tree_entry(
        &mut tree,
        MANIFEST_FILE,
        r#""defaultSourceId": "source_regular""#,
        r#""defaultSourceId": "source_missing""#,
    );

    let error = tree_to_font(tree).unwrap_err();

    assert!(matches!(
        error,
        SourcePackageError::DanglingReference { field, id }
            if field == "manifest.defaultSourceId" && id == "source_missing"
    ));
}

#[test]
fn rejects_glyph_layers_that_reference_missing_sources() {
    let mut tree = font_to_tree(&sample_font()).unwrap();
    let glyph_path = format!("{GLYPHS_DIR}/glyph_A.json");
    replace_tree_entry(
        &mut tree,
        &glyph_path,
        r#""source_regular": {"#,
        r#""source_missing": {"#,
    );

    let error = tree_to_font(tree).unwrap_err();

    assert!(matches!(
        error,
        SourcePackageError::DanglingReference { field, id }
            if field == "glyph.layers.sourceId" && id == "source_missing"
    ));
}

#[test]
fn rejects_non_shift_package_paths() {
    let temp = tempfile::tempdir().unwrap();
    let package_path = temp.path().join("Dogfood");

    let error = ShiftSourcePackage::create_empty(&package_path).unwrap_err();

    assert!(matches!(error, SourcePackageError::InvalidExtension(_)));
}

#[test]
fn does_not_overwrite_existing_package_when_creating_empty() {
    let temp = tempfile::tempdir().unwrap();
    let package_path = temp.path().join("Dogfood.shift");
    ShiftSourcePackage::create_empty(&package_path).unwrap();

    let error = ShiftSourcePackage::create_empty(&package_path).unwrap_err();

    assert!(matches!(error, SourcePackageError::AlreadyExists(_)));
}

#[test]
fn writes_handwritten_tree_as_openable_zip() {
    let temp = tempfile::tempdir().unwrap();
    let package_path = temp.path().join("Minimal.shift");
    let tree = font_to_tree(&Font::new()).unwrap();

    write_tree_atomic(&package_path, tree).unwrap();

    ShiftSourcePackage::open(&package_path).unwrap();
}
