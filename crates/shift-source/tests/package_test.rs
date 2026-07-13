use std::fs::{self, File};

use shift_font::{
    Axis, AxisId, Font, KerningPair, LibValue, Location, Source, SourceId, SourceRole,
    test_support::sample_font,
};
use shift_source::{
    AXES_FILE, AXIS_MAPPINGS_FILE, DATA_DIR, FEATURES_FILE, FONT_FILE, FONTINFO_MODULE_FILE,
    GLYPHS_DIR, IMAGES_DIR, KERNING_FILE, LIB_MODULE_FILE, MANIFEST_FILE, PackageId, PackageTree,
    SOURCES_FILE, ShiftSourcePackage, SourcePackageError, font_to_tree, tree_to_font,
    write_tree_atomic,
};
use zip::{CompressionMethod, ZipArchive};

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

fn test_package_id() -> PackageId {
    PackageId::from_raw("test")
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
fn created_package_has_stable_identity() {
    let temp = tempfile::tempdir().unwrap();
    let package_path = temp.path().join("Dogfood.shift");

    let created = ShiftSourcePackage::save_font(&package_path, &sample_font()).unwrap();
    let saved = ShiftSourcePackage::save_font(&package_path, &sample_font()).unwrap();

    assert!(created.package_id().as_str().starts_with("package_"));
    assert_eq!(saved.package_id(), created.package_id());
}

#[test]
fn package_identity_survives_move_and_filesystem_copy() {
    let temp = tempfile::tempdir().unwrap();
    let package_path = temp.path().join("Dogfood.shift");
    let moved_path = temp.path().join("Moved.shift");
    let copied_path = temp.path().join("Copied.shift");
    let created = ShiftSourcePackage::save_font(&package_path, &sample_font()).unwrap();

    fs::rename(&package_path, &moved_path).unwrap();
    fs::copy(&moved_path, &copied_path).unwrap();

    assert_eq!(
        ShiftSourcePackage::open(&moved_path).unwrap().package_id(),
        created.package_id()
    );
    assert_eq!(
        ShiftSourcePackage::open(&copied_path).unwrap().package_id(),
        created.package_id()
    );
}

#[test]
fn save_as_mints_new_package_identity() {
    let temp = tempfile::tempdir().unwrap();
    let first_path = temp.path().join("First.shift");
    let second_path = temp.path().join("Second.shift");
    let first = ShiftSourcePackage::save_font(&first_path, &sample_font()).unwrap();

    let second = ShiftSourcePackage::save_font_as(&second_path, &sample_font()).unwrap();

    assert_ne!(second.package_id(), first.package_id());
}

#[test]
fn shift_round_trip_preserves_whole_font() {
    let temp = tempfile::tempdir().unwrap();
    let package_path = temp.path().join("Dogfood.shift");
    let original = sample_font();

    ShiftSourcePackage::save_font(&package_path, &original).unwrap();
    let loaded = ShiftSourcePackage::load_font(&package_path).unwrap();

    assert_eq!(loaded, original);
}

#[test]
fn shift_round_trip_preserves_exotic_lib_values_binaries_and_remainders() {
    let temp = tempfile::tempdir().unwrap();
    let package_path = temp.path().join("Dogfood.shift");

    ShiftSourcePackage::save_font(&package_path, &sample_font()).unwrap();
    let loaded = ShiftSourcePackage::load_font(&package_path).unwrap();

    let Some(LibValue::Array(variants)) = loaded.lib().get("com.shift.allLibVariants") else {
        panic!("font lib should carry the variant corpus");
    };
    assert!(variants.contains(&LibValue::Integer(-12)));
    assert!(variants.contains(&LibValue::UnsignedInteger(u64::MAX)));
    assert!(variants.contains(&LibValue::Date("2024-02-02T02:02:02Z".to_string())));
    assert!(variants.contains(&LibValue::Uid(9)));
    assert!(variants.contains(&LibValue::Data(vec![0, 1, 2, 255])));

    assert_eq!(
        loaded
            .data_files()
            .get("com.shift.testdata/nested/blob.bin"),
        Some([0x00, 0xFF, 0x10, 0x20].as_slice())
    );
    assert!(loaded.images().get("swatch.png").is_some());

    let bold = loaded
        .sources()
        .iter()
        .find(|source| source.name() == "Bold")
        .expect("bold source should survive");
    assert_eq!(bold.color(), Some("1,0.75,0,0.7"));
    assert_eq!(
        bold.lib().get("com.shift.sourceNote"),
        Some(&LibValue::String("bold layer note".to_string()))
    );

    assert_eq!(
        loaded.fontinfo_remainder().get("openTypeOS2WeightClass"),
        Some(&LibValue::Integer(700))
    );
}

#[test]
fn source_tree_round_trip_preserves_whole_font() {
    let original = sample_font();

    let loaded = tree_to_font(font_to_tree(&test_package_id(), &original).unwrap()).unwrap();

    assert_eq!(loaded, original);
}

#[test]
fn serializes_same_font_to_byte_identical_tree() {
    let font = sample_font();

    let first = font_to_tree(&test_package_id(), &font).unwrap();
    let second = font_to_tree(&test_package_id(), &font).unwrap();

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
            AXIS_MAPPINGS_FILE,
            SOURCES_FILE,
            FEATURES_FILE,
            KERNING_FILE,
            LIB_MODULE_FILE,
            FONTINFO_MODULE_FILE,
            &format!("{GLYPHS_DIR}/glyph_A.json"),
            &format!("{GLYPHS_DIR}/glyph_acute.json"),
            &format!("{DATA_DIR}/com.shift.testdata/nested/blob.bin"),
            &format!("{DATA_DIR}/notes.txt"),
            &format!("{IMAGES_DIR}/swatch.png")
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

    let error = font_to_tree(&test_package_id(), &font).unwrap_err();

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
  "packageId": "package_minimal",
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
            AXIS_MAPPINGS_FILE.to_string(),
            br#"{
  "mappings": []
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
    let mut tree = font_to_tree(&test_package_id(), &sample_font()).unwrap();
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

    let error = font_to_tree(&test_package_id(), &font).unwrap_err();

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

    let error = font_to_tree(&test_package_id(), &font).unwrap_err();

    assert!(matches!(
        error,
        SourcePackageError::NonFiniteNumber { field }
            if field == "sources[source_bad].location[axis_weight]"
    ));
}

#[test]
fn rejects_invalid_axis_ranges_on_load() {
    let mut tree = font_to_tree(&test_package_id(), &Font::new()).unwrap();
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
      "role": "external",
      "kind": {
        "type": "continuous",
        "minimum": 900.0,
        "default": 400.0,
        "maximum": 100.0
      },
      "labels": [],
      "hidden": false
    }
  ]
}
"#
    .to_vec();

    let error = tree_to_font(tree).unwrap_err();

    assert!(matches!(
        error,
        SourcePackageError::Font(shift_font::CoreError::InvalidAxis { axis_id, .. })
            if axis_id == AxisId::from_raw("weight")
    ));
}

#[test]
fn rejects_dangling_default_source_id() {
    let mut tree = font_to_tree(&test_package_id(), &sample_font()).unwrap();
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
    let mut tree = font_to_tree(&test_package_id(), &sample_font()).unwrap();
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
    let tree = font_to_tree(&test_package_id(), &Font::new()).unwrap();

    write_tree_atomic(&package_path, tree).unwrap();

    ShiftSourcePackage::open(&package_path).unwrap();
}

#[test]
fn shift_round_trip_preserves_source_roles_and_layer_names() {
    let temp = tempfile::tempdir().unwrap();
    let package_path = temp.path().join("Roles.shift");

    let mut font = Font::new();
    let mut medium = Source::with_filename(
        "Medium".to_string(),
        Location::new(),
        "Family-Bold.ufo".to_string(),
    );
    medium.set_layer_name(Some("Medium".to_string()));
    font.add_source(medium);
    font.add_source(Source::layer("background".to_string()));

    ShiftSourcePackage::save_font(&package_path, &font).unwrap();
    let loaded = ShiftSourcePackage::load_font(&package_path).unwrap();

    let medium = loaded
        .sources()
        .iter()
        .find(|source| source.name() == "Medium")
        .expect("Medium source should survive");
    assert_eq!(medium.role(), SourceRole::Master);
    assert_eq!(medium.layer_name(), Some("Medium"));
    assert_eq!(medium.filename(), Some("Family-Bold.ufo"));

    let background = loaded
        .sources()
        .iter()
        .find(|source| source.name() == "background")
        .expect("background source should survive");
    assert_eq!(background.role(), SourceRole::Layer);
    assert_eq!(background.layer_name(), None);
}
