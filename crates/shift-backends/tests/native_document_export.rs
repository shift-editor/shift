use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

use shift_backends::font_loader::FontLoader;
use shift_font::{
    test_support::sample_font, DesignLocation, ExternalLocation, Font, LibValue, MetricKind,
};
use shift_store::ShiftStore;

fn native_round_trip(temp: &Path, font: &Font) -> Font {
    let path = temp.join("Native.shift");
    let store = ShiftStore::create_document(path, font).expect("create native document");
    store.load_font_state().expect("load native document")
}

fn exportable_sample_font() -> Font {
    let mut font = sample_font();
    let key = "com.shift.allLibVariants";
    let Some(LibValue::Array(values)) = font.lib_mut().remove(key) else {
        panic!("sample font should contain every lib variant");
    };
    font.lib_mut().set(
        key.to_string(),
        LibValue::Array(
            values
                .into_iter()
                .filter(|value| !matches!(value, LibValue::Uid(_)))
                .collect(),
        ),
    );
    font
}

fn tree_snapshot(root: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
    fn collect(root: &Path, path: &Path, snapshot: &mut BTreeMap<PathBuf, Vec<u8>>) {
        if path.is_file() {
            snapshot.insert(
                path.strip_prefix(root).unwrap().to_path_buf(),
                std::fs::read(path).unwrap(),
            );
            return;
        }

        for entry in std::fs::read_dir(path).unwrap() {
            collect(root, &entry.unwrap().path(), snapshot);
        }
    }

    let mut snapshot = BTreeMap::new();
    collect(root, root, &mut snapshot);
    snapshot
}

#[test]
fn mapped_weight_interpolation_survives_native_round_trip() {
    let fixture =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/fonts/MappedWeight.glyphs");
    let original = FontLoader::new()
        .read_font(fixture.to_str().unwrap())
        .unwrap();
    let temp = tempfile::tempdir().unwrap();
    let native = native_round_trip(temp.path(), &original);

    for font in [&original, &native] {
        let axis_id = font.axes()[0].id();
        let glyph = font.glyph_by_name("A").unwrap();
        let interpolation = font.glyph_interpolation(&glyph.id()).unwrap().unwrap();
        let metrics = font.source_metric_interpolation().unwrap();
        let ascender_id = font
            .metric_definition_for_kind(MetricKind::Ascender)
            .unwrap()
            .id();
        let normalization = font.design_normalization().unwrap();
        assert_eq!(normalization[0].minimum, 30.0);
        assert_eq!(normalization[0].default, 86.0);
        assert_eq!(normalization[0].maximum, 160.0);
        assert_eq!(font.axes()[0].default(), 400.0);

        for (external, x, advance, ascender) in [
            (100.0, 30.0, 300.0, 700.0),
            (250.0, 58.0, 450.0, 750.0),
            (400.0, 86.0, 600.0, 800.0),
            (681.25, 123.0, 750.0, 850.0),
            (800.0, 160.0, 900.0, 900.0),
        ] {
            let mut external_location = ExternalLocation::new();
            external_location.set(axis_id.clone(), external);
            let design_location = font.mapped_location(&external_location).unwrap();
            let layer = interpolation
                .resolve(&design_location, font.axes())
                .unwrap();
            assert!((layer.contours_iter().next().unwrap().points()[1].x() - x).abs() < 1e-9);
            assert!((layer.width() - advance).abs() < 1e-9);
            let resolved_metrics = metrics.resolve(&design_location, font.axes()).unwrap();
            assert!(
                (resolved_metrics.metric_values()[&ascender_id].position - ascender).abs() < 1e-9
            );
            let weights = interpolation
                .basis()
                .weights_at(&design_location, font.axes())
                .unwrap();
            assert!((weights.iter().sum::<f64>() - 1.0).abs() < 1e-9);
        }

        let default = interpolation
            .resolve(&DesignLocation::new(), font.axes())
            .unwrap();
        assert_eq!(default.width(), 600.0);
        assert_eq!(
            default.contours_iter().next().unwrap().points()[1].x(),
            86.0
        );
    }
}

#[test]
fn native_document_ufo_export_matches_direct_font_export() {
    let temp = tempfile::tempdir().unwrap();
    let original = exportable_sample_font();
    let native = native_round_trip(temp.path(), &original);
    let direct_root = temp.path().join("direct-ufo");
    let native_root = temp.path().join("native-ufo");
    let direct_path = direct_root.join("Dogfood.ufo");
    let native_path = native_root.join("Dogfood.ufo");

    FontLoader::new()
        .write_font(&original, direct_path.to_str().unwrap())
        .expect("direct UFO export");
    FontLoader::new()
        .write_font(&native, native_path.to_str().unwrap())
        .expect("native UFO export");

    assert_eq!(native, original);
    assert_eq!(tree_snapshot(&native_root), tree_snapshot(&direct_root));
}

#[test]
fn native_document_designspace_export_matches_direct_font_export() {
    let temp = tempfile::tempdir().unwrap();
    let original = exportable_sample_font();
    let native = native_round_trip(temp.path(), &original);
    let direct_root = temp.path().join("direct-designspace");
    let native_root = temp.path().join("native-designspace");
    let direct_path = direct_root.join("Dogfood.designspace");
    let native_path = native_root.join("Dogfood.designspace");

    FontLoader::new()
        .write_font(&original, direct_path.to_str().unwrap())
        .expect("direct Designspace export");
    FontLoader::new()
        .write_font(&native, native_path.to_str().unwrap())
        .expect("native Designspace export");

    assert_eq!(native, original);
    assert_eq!(tree_snapshot(&native_root), tree_snapshot(&direct_root));
}
