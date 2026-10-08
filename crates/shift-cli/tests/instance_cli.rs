mod support;

use serde_json::Value;
use shift_font::{
    Axis, AxisKind, AxisRole, ExternalLocation, Font, NamedInstance,
    test_support::sample_variable_font,
};
use shift_store::ShiftStore;
use skrifa::{FontRef, MetadataProvider};
use support::{load_font, shift, shift_with_stdin};

#[test]
fn product_crud_preserves_identity_order_omitted_coordinates_and_all_source_geometry() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    let mut before = sample_variable_font();
    let width = Axis::width();
    let weight_id = before.axes()[0].id();
    before.add_axis(width.clone()).unwrap();
    drop(ShiftStore::create_document(&path, &before).unwrap());
    let output = shift(&[
        "instance",
        "add",
        path.to_str().unwrap(),
        "--name",
        "Book",
        "--location",
        "wght=700",
        "--postscript-name",
        "Lab-Book",
        "--json",
    ]);
    assert!(output.status.success(), "{:?}", output.stderr);
    let after_add = load_font(path.to_str().unwrap());
    let book = &after_add.named_instances()[1];
    let id = book.id().to_string();
    assert_eq!(book.location().get(&weight_id), Some(700.0));
    assert_eq!(book.location().get(&width.id()), Some(100.0));
    assert_eq!(
        after_add
            .mapped_location(book.location())
            .unwrap()
            .get(&weight_id),
        Some(600.0)
    );
    assert_eq!(
        &after_add.named_instances()[0],
        &before.named_instances()[0]
    );
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["changes"][0]["instances"][1]["instanceId"], id);
    assert_eq!(
        report["changes"][0]["instances"][1]["location"]["wght"].as_f64(),
        Some(700.0)
    );
    let output = shift(&[
        "instance",
        "set",
        path.to_str().unwrap(),
        &id,
        "--name",
        "Text Book",
        "--location",
        "wdth=110",
        "--json",
    ]);
    assert!(output.status.success(), "{:?}", output.stderr);
    let after = load_font(path.to_str().unwrap());
    let book = &after.named_instances()[1];
    assert_eq!(book.id().to_string(), id);
    assert_eq!(book.name(), "Text Book");
    assert_eq!(book.location().get(&weight_id), Some(700.0));
    assert_eq!(book.location().get(&width.id()), Some(110.0));
    assert_eq!(book.postscript_name(), Some("Lab-Book"));
    let output = shift(&[
        "instance",
        "set",
        path.to_str().unwrap(),
        "Text Book",
        "--clear-postscript-name",
    ]);
    assert!(output.status.success(), "{:?}", output.stderr);
    assert_eq!(
        load_font(path.to_str().unwrap()).named_instances()[1].postscript_name(),
        None
    );
    let output = shift(&["instance", "remove", path.to_str().unwrap(), &id, "--json"]);
    assert!(output.status.success(), "{:?}", output.stderr);
    let after = load_font(path.to_str().unwrap());
    assert_eq!(after, before);
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["changes"][0]["count"], 1);
}

#[test]
fn in_range_standard_weights_are_additive_preserve_existing_names_and_are_idempotent() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    let mut before = Font::new();
    let axis = Axis::new(
        "wght".to_string(),
        "Weight".to_string(),
        300.0,
        400.0,
        700.0,
    );
    before.add_axis(axis.clone()).unwrap();
    let width = Axis::width();
    before.add_axis(width.clone()).unwrap();
    let mut location = ExternalLocation::new();
    location.set(axis.id(), 400.0);
    location.set(width.id(), 100.0);
    before
        .add_named_instance(NamedInstance::new(
            "Keep This Name".to_string(),
            location,
            Some("Lab-Keep".to_string()),
        ))
        .unwrap();
    drop(ShiftStore::create_document(&path, &before).unwrap());
    let args = [
        "instance",
        "add",
        path.to_str().unwrap(),
        "--standard-weights",
        "--json",
    ];
    let output = shift(&args);
    assert!(output.status.success(), "{:?}", output.stderr);
    let after = load_font(path.to_str().unwrap());
    assert_eq!(&after.named_instances()[0], &before.named_instances()[0]);
    assert_eq!(
        after
            .named_instances()
            .iter()
            .map(|instance| instance.name())
            .collect::<Vec<_>>(),
        vec!["Keep This Name", "Light", "Medium", "SemiBold", "Bold"]
    );
    assert_eq!(
        after
            .named_instances()
            .iter()
            .map(|instance| instance.location().get(&axis.id()).unwrap())
            .collect::<Vec<_>>(),
        vec![400.0, 300.0, 500.0, 600.0, 700.0]
    );
    assert!(
        after
            .named_instances()
            .iter()
            .all(|instance| instance.location().get(&width.id()) == Some(100.0))
    );
    assert_eq!(after.sources(), before.sources());
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["changes"].as_array().unwrap().len(), 1);
    assert_eq!(report["changes"][0]["count"], 5);
    assert_eq!(
        report["changes"][0]["instances"].as_array().unwrap().len(),
        5
    );
    let bytes = std::fs::read(&path).unwrap();
    let output = shift(&args);
    assert!(output.status.success(), "{:?}", output.stderr);
    assert_eq!(load_font(path.to_str().unwrap()), after);
    assert_eq!(std::fs::read(path).unwrap(), bytes);
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["wrote"], false);
    assert_eq!(report["changes"], serde_json::json!([]));
}

#[test]
fn mapped_weight_presets_compile_as_external_fvar_coordinates_and_do_not_create_masters() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    let ttf = temp.path().join("Lab.ttf");
    drop(ShiftStore::create_document(&path, &sample_variable_font()).unwrap());
    let glyph = shift_with_stdin(
        &["glyph", "set", path.to_str().unwrap(), "--input", "-"],
        r#"{"glyphs":[{"name":"B","layer":{"advance":600,"svgPath":"M0 0 L300 700 L600 0 Z"}}]}"#,
    );
    assert!(glyph.status.success(), "{:?}", glyph.stderr);
    let before = load_font(path.to_str().unwrap());
    let output = shift(&[
        "instance",
        "add",
        path.to_str().unwrap(),
        "--standard-weights",
    ]);
    assert!(output.status.success(), "{:?}", output.stderr);
    let after = load_font(path.to_str().unwrap());
    assert_eq!(after.sources(), before.sources());
    assert_eq!(
        after.glyphs().collect::<Vec<_>>(),
        before.glyphs().collect::<Vec<_>>()
    );
    assert_eq!(after.axis_mappings(), before.axis_mappings());
    assert_eq!(&after.named_instances()[0], &before.named_instances()[0]);
    assert_eq!(after.named_instances().len(), 9);
    let compile = shift(&[
        "compile",
        path.to_str().unwrap(),
        "--output",
        ttf.to_str().unwrap(),
    ]);
    assert!(compile.status.success(), "{:?}", compile.stderr);
    let bytes = std::fs::read(ttf).unwrap();
    let compiled = FontRef::new(&bytes).unwrap();
    let instances = compiled.named_instances();
    assert_eq!(instances.len(), 9);
    let bold = instances
        .iter()
        .find(|instance| {
            compiled
                .localized_strings(instance.subfamily_name_id())
                .english_or_first()
                .unwrap()
                .to_string()
                == "Bold"
        })
        .unwrap();
    assert_eq!(bold.user_coords().collect::<Vec<_>>(), vec![900.0]);
    let semibold = instances
        .iter()
        .find(|instance| {
            compiled
                .localized_strings(instance.subfamily_name_id())
                .english_or_first()
                .unwrap()
                .to_string()
                == "SemiBold"
        })
        .unwrap();
    assert_eq!(semibold.user_coords().collect::<Vec<_>>(), vec![600.0]);
    assert_eq!(
        compiled
            .localized_strings(bold.postscript_name_id().unwrap())
            .english_or_first()
            .unwrap()
            .to_string(),
        "UntitledFont-Bold"
    );
}

#[test]
fn ambiguous_names_require_ids_but_full_ids_still_edit_one_product() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    let mut font = Font::new();
    let axis = Axis::weight();
    font.add_axis(axis.clone()).unwrap();
    for value in [300.0, 500.0] {
        let mut location = ExternalLocation::new();
        location.set(axis.id(), value);
        font.add_named_instance(NamedInstance::new("Text".to_string(), location, None))
            .unwrap();
    }
    let id = font.named_instances()[1].id().to_string();
    drop(ShiftStore::create_document(&path, &font).unwrap());
    let bytes = std::fs::read(&path).unwrap();
    for command in ["set", "remove"] {
        let mut args = vec![
            "instance",
            command,
            path.to_str().unwrap(),
            "Text",
            "--json",
        ];
        if command == "set" {
            args.extend_from_slice(&["--name", "Book"]);
        }
        let output = shift(&args);
        assert!(!output.status.success());
        let report: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert!(report["error"].to_string().contains("ambiguous"));
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
    }
    assert!(
        shift(&[
            "instance",
            "set",
            path.to_str().unwrap(),
            &id,
            "--name",
            "Book"
        ])
        .status
        .success()
    );
    let after = load_font(path.to_str().unwrap());
    assert_eq!(&after.named_instances()[0], &font.named_instances()[0]);
    assert_eq!(after.named_instances()[1].id().to_string(), id);
    assert_eq!(after.named_instances()[1].name(), "Book");
}

#[test]
fn invalid_product_requests_do_not_write_or_create_partial_output() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    let destination = temp.path().join("Bad.shift");
    drop(ShiftStore::create_document(&path, &sample_variable_font()).unwrap());
    let bytes = std::fs::read(&path).unwrap();
    for flags in [
        vec!["add", "--name", "Duplicate", "--location", "wght=900"],
        vec![
            "add",
            "--name",
            "Book",
            "--location",
            "wght=700",
            "--postscript-name",
            "UntitledFont-Bold",
        ],
        vec!["add", "--name", " ", "--location", "wght=700"],
        vec!["add", "--name", "Book", "--location", "wght=NaN"],
        vec!["add", "--name", "Book", "--location", "wght=1000"],
        vec!["add", "--name", "Book", "--location", "nope=400"],
        vec!["add", "--name", "Book", "--location", "wght=700,wght=600"],
        vec!["add", "--name", "Book", "--location", "700"],
        vec!["add"],
        vec!["set", "Bold"],
        vec![
            "set",
            "Bold",
            "--name",
            "Must Not Persist",
            "--postscript-name",
            "Bad Name",
        ],
        vec!["set", "unknown", "--name", "Book"],
        vec!["remove", "unknown"],
    ] {
        let mut args = vec!["instance", flags[0], path.to_str().unwrap()];
        args.extend_from_slice(&flags[1..]);
        args.extend_from_slice(&["--json", "--output", destination.to_str().unwrap()]);
        let output = shift(&args);
        assert!(!output.status.success(), "accepted {flags:?}");
        let report: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(report["valid"], false);
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        assert!(!destination.exists());
    }
}

#[test]
fn product_mutations_honor_dry_run_and_independent_output_for_add_edit_and_remove() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    drop(ShiftStore::create_document(&path, &sample_variable_font()).unwrap());
    let bytes = std::fs::read(&path).unwrap();
    for flags in [
        vec!["add", "--name", "Book", "--location", "wght=700"],
        vec!["set", "Bold", "--name", "Black"],
        vec!["remove", "Bold"],
        vec!["add", "--standard-weights"],
    ] {
        let destination = temp.path().join(format!("{}.shift", flags.join("_")));
        let mut args = vec!["instance", flags[0], path.to_str().unwrap()];
        args.extend_from_slice(&flags[1..]);
        args.extend_from_slice(&["--output", destination.to_str().unwrap(), "--json"]);
        let mut dry_run = args.clone();
        dry_run.push("--dry-run");
        let output = shift(&dry_run);
        assert!(output.status.success(), "{:?}", output.stderr);
        let report: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(report["wrote"], false);
        assert!(!destination.exists());
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        let output = shift(&args);
        assert!(output.status.success(), "{:?}", output.stderr);
        let after = load_font(destination.to_str().unwrap());
        match flags.as_slice() {
            ["add", "--standard-weights"] => assert_eq!(after.named_instances().len(), 9),
            ["add", ..] => assert_eq!(after.named_instances()[1].name(), "Book"),
            ["set", ..] => assert_eq!(after.named_instances()[0].name(), "Black"),
            ["remove", ..] => assert!(after.named_instances().is_empty()),
            _ => unreachable!(),
        }
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        let input_id = ShiftStore::open_document(&path)
            .unwrap()
            .document_metadata()
            .unwrap()
            .document_id;
        let output_id = ShiftStore::open_document(&destination)
            .unwrap()
            .document_metadata()
            .unwrap()
            .document_id;
        assert_ne!(input_id, output_id);
        let output_bytes = std::fs::read(&destination).unwrap();
        assert!(!shift(&args).status.success());
        assert_eq!(std::fs::read(destination).unwrap(), output_bytes);
    }
}

#[test]
fn internal_axes_are_not_instance_coordinates_and_discrete_presets_use_authored_values_only() {
    for internal in [false, true] {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("Lab.shift");
        let mut font = Font::new();
        let mut axis = Axis::weight();
        axis.set_kind(AxisKind::Discrete {
            values: vec![100.0, 400.0, 700.0],
            default: 400.0,
        });
        if internal {
            axis.set_role(AxisRole::Internal);
        }
        font.add_axis(axis.clone()).unwrap();
        drop(ShiftStore::create_document(&path, &font).unwrap());
        let bytes = std::fs::read(&path).unwrap();
        let output = shift(&[
            "instance",
            "add",
            path.to_str().unwrap(),
            "--standard-weights",
            "--json",
        ]);
        if internal {
            assert!(!output.status.success());
            assert_eq!(std::fs::read(&path).unwrap(), bytes);
            assert!(
                !shift(&[
                    "instance",
                    "add",
                    path.to_str().unwrap(),
                    "--name",
                    "Book",
                    "--location",
                    "wght=700"
                ])
                .status
                .success()
            );
            assert_eq!(std::fs::read(path).unwrap(), bytes);
            continue;
        }
        assert!(output.status.success(), "{:?}", output.stderr);
        let after = load_font(path.to_str().unwrap());
        assert_eq!(
            after
                .named_instances()
                .iter()
                .map(|instance| instance.location().get(&axis.id()).unwrap())
                .collect::<Vec<_>>(),
            vec![100.0, 400.0, 700.0]
        );
        let bytes = std::fs::read(&path).unwrap();
        assert!(
            !shift(&[
                "instance",
                "add",
                path.to_str().unwrap(),
                "--name",
                "Medium",
                "--location",
                "wght=500"
            ])
            .status
            .success()
        );
        assert_eq!(std::fs::read(path).unwrap(), bytes);
    }
}
