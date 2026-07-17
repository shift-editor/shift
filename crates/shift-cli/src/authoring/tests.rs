use std::fs;
use std::path::Path;

use shift_source::ShiftSourcePackage;

use crate::cli::{AddAxisArgs, AddSourceArgs, CreateFontArgs, MutationArgs};

use super::{add_axis, add_source, create_font};

fn mutation(dry_run: bool) -> MutationArgs {
    MutationArgs {
        output: None,
        dry_run,
        json: false,
    }
}

fn create_package(path: &Path) {
    create_font(CreateFontArgs {
        path: path.to_path_buf(),
        dry_run: false,
        json: false,
    })
    .unwrap();
}

fn weight_axis(path: &Path, mutation: MutationArgs) -> AddAxisArgs {
    AddAxisArgs {
        path: path.to_path_buf(),
        tag: "wght".to_string(),
        name: "Weight".to_string(),
        minimum: 100.0,
        default: 400.0,
        maximum: 900.0,
        mutation,
    }
}

#[test]
fn create_font_writes_a_new_package_and_refuses_to_overwrite_it() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");

    let report = create_font(CreateFontArgs {
        path: path.clone(),
        dry_run: false,
        json: false,
    })
    .unwrap();

    assert!(report.wrote);
    assert_eq!(
        ShiftSourcePackage::load_font(&path)
            .unwrap()
            .sources()
            .len(),
        1
    );
    assert!(
        create_font(CreateFontArgs {
            path,
            dry_run: false,
            json: false,
        })
        .is_err()
    );
}

#[test]
fn axis_dry_run_uses_real_validation_without_writing() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    create_package(&path);
    let before = fs::read(&path).unwrap();

    let report = add_axis(weight_axis(&path, mutation(true))).unwrap();

    assert!(!report.wrote);
    assert_eq!(fs::read(&path).unwrap(), before);
    assert!(
        ShiftSourcePackage::load_font(&path)
            .unwrap()
            .axes()
            .is_empty()
    );
}

#[test]
fn axis_mutation_preserves_package_identity() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    create_package(&path);
    let package_id = ShiftSourcePackage::open(&path)
        .unwrap()
        .package_id()
        .clone();

    add_axis(weight_axis(&path, mutation(false))).unwrap();

    let package = ShiftSourcePackage::open(&path).unwrap();
    let font = ShiftSourcePackage::load_font(&path).unwrap();
    assert_eq!(package.package_id(), &package_id);
    assert_eq!(font.axes()[0].tag(), "wght");
}

#[test]
fn invalid_axis_does_not_change_the_package() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    create_package(&path);
    let before = fs::read(&path).unwrap();
    let mut args = weight_axis(&path, mutation(false));
    args.minimum = 500.0;
    args.default = 400.0;

    assert!(add_axis(args).is_err());
    assert_eq!(fs::read(&path).unwrap(), before);
}

#[test]
fn output_writes_an_independent_package_without_changing_input() {
    let temp = tempfile::tempdir().unwrap();
    let input = temp.path().join("Lab.shift");
    let output = temp.path().join("Variant.shift");
    create_package(&input);
    let before = fs::read(&input).unwrap();
    let mut options = mutation(false);
    options.output = Some(output.clone());

    add_axis(weight_axis(&input, options)).unwrap();

    assert_eq!(fs::read(&input).unwrap(), before);
    assert!(
        ShiftSourcePackage::load_font(&input)
            .unwrap()
            .axes()
            .is_empty()
    );
    assert_eq!(
        ShiftSourcePackage::load_font(&output).unwrap().axes().len(),
        1
    );
    assert_ne!(
        ShiftSourcePackage::open(&input).unwrap().package_id(),
        ShiftSourcePackage::open(&output).unwrap().package_id()
    );
}

#[test]
fn source_location_is_completed_with_axis_defaults() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    create_package(&path);
    add_axis(weight_axis(&path, mutation(false))).unwrap();

    add_source(AddSourceArgs {
        path: path.clone(),
        name: "Black".to_string(),
        location: vec!["wght=900".to_string()],
        mutation: mutation(false),
    })
    .unwrap();

    let font = ShiftSourcePackage::load_font(&path).unwrap();
    let source = font
        .sources()
        .iter()
        .find(|source| source.name() == "Black")
        .unwrap();
    assert_eq!(source.location().get(&font.axes()[0].id()), Some(900.0));
}
