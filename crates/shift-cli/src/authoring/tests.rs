use std::path::Path;

use shift_font::Font;
use shift_store::{DocumentId, ShiftStore};

use crate::cli::{AddAxisArgs, AddSourceArgs, CreateFontArgs, MutationArgs};

use super::{add_axis, add_source, create_font};

fn mutation(dry_run: bool) -> MutationArgs {
    MutationArgs {
        output: None,
        dry_run,
        json: false,
    }
}

fn create_document(path: &Path) {
    create_font(CreateFontArgs {
        path: path.to_path_buf(),
        dry_run: false,
        json: false,
    })
    .unwrap();
}

fn load_font(path: &Path) -> Font {
    ShiftStore::open_document(path)
        .unwrap()
        .load_font_state()
        .unwrap()
}

fn document_id(path: &Path) -> DocumentId {
    ShiftStore::open_document(path)
        .unwrap()
        .document_metadata()
        .unwrap()
        .document_id
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
fn create_font_writes_a_new_document_and_refuses_to_overwrite_it() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");

    let report = create_font(CreateFontArgs {
        path: path.clone(),
        dry_run: false,
        json: false,
    })
    .unwrap();

    assert!(report.wrote);
    assert_eq!(load_font(&path).sources().len(), 1);
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
    create_document(&path);
    let before_id = document_id(&path);

    let report = add_axis(weight_axis(&path, mutation(true))).unwrap();

    assert!(!report.wrote);
    assert_eq!(document_id(&path), before_id);
    assert!(load_font(&path).axes().is_empty());
}

#[test]
fn axis_mutation_preserves_document_identity() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    create_document(&path);
    let original_id = document_id(&path);

    add_axis(weight_axis(&path, mutation(false))).unwrap();

    assert_eq!(document_id(&path), original_id);
    assert_eq!(load_font(&path).axes()[0].tag(), "wght");
}

#[test]
fn invalid_axis_does_not_change_the_document() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    create_document(&path);
    let before = load_font(&path);
    let mut args = weight_axis(&path, mutation(false));
    args.minimum = 500.0;
    args.default = 400.0;

    assert!(add_axis(args).is_err());
    assert_eq!(load_font(&path), before);
}

#[test]
fn output_writes_an_independent_document_without_changing_input() {
    let temp = tempfile::tempdir().unwrap();
    let input = temp.path().join("Lab.shift");
    let output = temp.path().join("Variant.shift");
    create_document(&input);
    let before = load_font(&input);
    let mut options = mutation(false);
    options.output = Some(output.clone());

    add_axis(weight_axis(&input, options)).unwrap();

    assert_eq!(load_font(&input), before);
    assert_eq!(load_font(&output).axes().len(), 1);
    assert_ne!(document_id(&input), document_id(&output));
}

#[test]
fn source_location_is_completed_with_axis_defaults() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    create_document(&path);
    add_axis(weight_axis(&path, mutation(false))).unwrap();

    add_source(AddSourceArgs {
        path: path.clone(),
        name: "Black".to_string(),
        location: vec!["wght=900".to_string()],
        mutation: mutation(false),
    })
    .unwrap();

    let font = load_font(&path);
    let source = font
        .sources()
        .iter()
        .find(|source| source.name() == "Black")
        .unwrap();
    assert_eq!(source.location().get(&font.axes()[0].id()), Some(900.0));
}
