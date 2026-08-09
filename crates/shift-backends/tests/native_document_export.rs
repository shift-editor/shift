use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

use shift_backends::font_loader::FontLoader;
use shift_font::{test_support::sample_font, Font, LibValue};
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
