use std::fs;

use shift_source::{MANIFEST_FILE, ShiftSourcePackage, SourcePackageError};

#[test]
fn creates_empty_shift_package_directory_with_manifest() {
    let temp = tempfile::tempdir().unwrap();
    let package_path = temp.path().join("TestFont.shift");

    let package = ShiftSourcePackage::create_empty(&package_path).unwrap();

    assert_eq!(package.path(), package_path.as_path());
    assert!(package.path().is_dir());
    assert!(package.manifest_path().is_file());
    assert_eq!(package.manifest_path(), package_path.join(MANIFEST_FILE));

    let manifest = fs::read_to_string(package.manifest_path()).unwrap();
    assert!(manifest.contains("\"format\": \"shift-source\""));
}

#[test]
fn opens_existing_shift_package() {
    let temp = tempfile::tempdir().unwrap();
    let package_path = temp.path().join("TestFont.shift");
    ShiftSourcePackage::create_empty(&package_path).unwrap();

    let package = ShiftSourcePackage::open(&package_path).unwrap();

    assert_eq!(package.path(), package_path.as_path());
}

#[test]
fn rejects_non_shift_package_paths() {
    let temp = tempfile::tempdir().unwrap();
    let package_path = temp.path().join("TestFont");

    let error = ShiftSourcePackage::create_empty(&package_path).unwrap_err();

    assert!(matches!(error, SourcePackageError::InvalidExtension(_)));
}

#[test]
fn does_not_overwrite_existing_shift_package() {
    let temp = tempfile::tempdir().unwrap();
    let package_path = temp.path().join("TestFont.shift");
    ShiftSourcePackage::create_empty(&package_path).unwrap();

    let error = ShiftSourcePackage::create_empty(&package_path).unwrap_err();

    assert!(matches!(error, SourcePackageError::AlreadyExists(_)));
}
