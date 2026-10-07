mod support;

use serde_json::Value;
use shift_font::{
    Axis, AxisKind, AxisLabel, AxisRole, ExternalLocation, Font, NamedInstance,
    test_support::sample_variable_font,
};
use shift_store::ShiftStore;
use skrifa::{FontRef, raw::TableProvider};
use support::{load_font, shift, shift_with_stdin};

#[test]
fn mapped_axis_rename_preserves_identity_labels_visibility_and_all_dependents() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    let mut before = sample_variable_font();
    let mut original = before.axes()[0].clone();
    original.set_hidden(true);
    before.replace_axis(original.clone()).unwrap();
    drop(ShiftStore::create_document(&path, &before).unwrap());
    let id = original.id().to_string();
    let output = shift(&[
        "axis",
        "set",
        path.to_str().unwrap(),
        &id,
        "--tag",
        "WGHT",
        "--name",
        "Mass",
        "--json",
    ]);
    assert!(output.status.success(), "{:?}", output.stderr);
    let after = load_font(path.to_str().unwrap());
    let axis = after.axis(&original.id()).unwrap();
    assert_eq!(axis.tag(), "WGHT");
    assert_eq!(axis.name(), "Mass");
    assert_eq!(axis.kind(), original.kind());
    assert_eq!(axis.role(), original.role());
    assert_eq!(axis.labels(), original.labels());
    assert!(axis.is_hidden());
    assert_eq!(after.sources(), before.sources());
    assert_eq!(after.named_instances(), before.named_instances());
    assert_eq!(after.axis_mappings(), before.axis_mappings());
    assert_eq!(after.metadata(), before.metadata());
    assert_eq!(
        after.glyphs().collect::<Vec<_>>(),
        before.glyphs().collect::<Vec<_>>()
    );
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["changes"][0]["kind"], "axisUpdated");
    assert_eq!(report["changes"][0]["axisId"], id);
    assert_eq!(report["changes"][0]["tag"], "WGHT");
}

#[test]
fn renamed_axis_remains_addressable_by_stable_id_and_new_tag() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    let before = sample_variable_font();
    let axis_id = before.axes()[0].id();
    let id = axis_id.to_string();
    drop(ShiftStore::create_document(&path, &before).unwrap());

    for (selector, name) in [("wght", "Mass"), (id.as_str(), "Text"), ("WGHT", "Weight")] {
        let output = shift(&[
            "axis",
            "set",
            path.to_str().unwrap(),
            selector,
            "--tag",
            "WGHT",
            "--name",
            name,
            "--json",
        ]);
        assert!(output.status.success(), "{:?}", output.stderr);
        let after = load_font(path.to_str().unwrap());
        let axis = after.axis(&axis_id).unwrap();
        assert_eq!(axis.tag(), "WGHT");
        assert_eq!(axis.name(), name);
        assert_eq!(after.sources(), before.sources());
        assert_eq!(after.axis_mappings(), before.axis_mappings());
        let report: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(report["changes"][0]["axisId"], id);
    }

    let bytes = std::fs::read(&path).unwrap();
    for selector in ["wght", "axis_missing"] {
        let output = shift(&[
            "axis",
            "set",
            path.to_str().unwrap(),
            selector,
            "--name",
            "Must Not Persist",
            "--json",
        ]);
        assert!(!output.status.success());
        let report: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(report["valid"], false);
        assert_eq!(
            report["error"]["summary"],
            format!("axis {selector:?} does not exist; use its tag or full id")
        );
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
    }
}

#[test]
fn expanded_unmapped_range_survives_compilation_without_changing_glyphs_or_masters() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    let ttf = temp.path().join("Lab.ttf");
    let mut font = sample_variable_font();
    font.set_axis_mappings(Vec::new()).unwrap();
    drop(ShiftStore::create_document(&path, &font).unwrap());
    let glyph = shift_with_stdin(
        &["glyph", "set", path.to_str().unwrap(), "--input", "-"],
        r#"{"glyphs":[{"name":"B","layer":{"advance":600,"svgPath":"M0 0 L300 700 L600 0 Z"}}]}"#,
    );
    assert!(glyph.status.success(), "{:?}", glyph.stderr);
    let before = load_font(path.to_str().unwrap());
    let output = shift(&[
        "axis",
        "set",
        path.to_str().unwrap(),
        "wght",
        "--min",
        "0",
        "--max",
        "1000",
    ]);
    assert!(output.status.success(), "{:?}", output.stderr);
    let after = load_font(path.to_str().unwrap());
    assert_eq!(after.sources(), before.sources());
    assert_eq!(after.named_instances(), before.named_instances());
    assert_eq!(
        after.glyphs().collect::<Vec<_>>(),
        before.glyphs().collect::<Vec<_>>()
    );
    let compiled = shift(&[
        "compile",
        path.to_str().unwrap(),
        "--output",
        ttf.to_str().unwrap(),
    ]);
    assert!(compiled.status.success(), "{:?}", compiled.stderr);
    let bytes = std::fs::read(ttf).unwrap();
    let font = FontRef::new(&bytes).unwrap();
    let fvar = font.fvar().unwrap();
    let axes = fvar.axes().unwrap();
    assert_eq!(axes[0].min_value().to_f64(), 0.0);
    assert_eq!(axes[0].default_value().to_f64(), 400.0);
    assert_eq!(axes[0].max_value().to_f64(), 1000.0);
}

#[test]
fn invalid_axis_edits_leave_the_complete_input_unchanged_and_report_json_errors() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    let mut font = sample_variable_font();
    font.set_axis_mappings(Vec::new()).unwrap();
    let mut axis = font.axes()[0].clone();
    axis.set_labels(Vec::new());
    font.replace_axis(axis).unwrap();
    font.add_axis(Axis::width()).unwrap();
    drop(ShiftStore::create_document(&path, &font).unwrap());
    let bytes = std::fs::read(&path).unwrap();
    for flags in [
        vec!["--max", "700"],
        vec!["--default", "500"],
        vec!["--max", "NaN"],
        vec!["--min", "inf"],
        vec!["--name", " "],
        vec!["--tag", "bad"],
        vec!["--tag", "wdth"],
        vec![],
    ] {
        let mut args = vec!["axis", "set", path.to_str().unwrap(), "wght", "--json"];
        args.extend_from_slice(&flags);
        let output = shift(&args);
        assert!(!output.status.success(), "accepted {flags:?}");
        let report: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(report["valid"], false);
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
    }
    let output = shift(&[
        "axis",
        "set",
        path.to_str().unwrap(),
        "absent",
        "--name",
        "Mass",
        "--json",
    ]);
    assert!(!output.status.success());
    assert_eq!(std::fs::read(path).unwrap(), bytes);
}

#[test]
fn range_edits_cannot_strand_labels_or_named_instances() {
    for labels in [false, true] {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("Lab.shift");
        let mut font = Font::new();
        let mut axis = Axis::weight();
        if labels {
            axis.set_labels(vec![AxisLabel::new(
                "Thin".to_string(),
                100.0,
                None,
                None,
                false,
            )]);
        }
        font.add_axis(axis.clone()).unwrap();
        if !labels {
            let mut location = ExternalLocation::new();
            location.set(axis.id(), 100.0);
            font.add_named_instance(NamedInstance::new("Thin".to_string(), location, None))
                .unwrap();
        }
        drop(ShiftStore::create_document(&path, &font).unwrap());
        let bytes = std::fs::read(&path).unwrap();
        let output = shift(&[
            "axis",
            "set",
            path.to_str().unwrap(),
            "wght",
            "--min",
            "200",
            "--json",
        ]);
        assert!(!output.status.success());
        let report: Value = serde_json::from_slice(&output.stdout).unwrap();
        let error = report["error"].to_string();
        assert!(error.contains(if labels {
            "axis label"
        } else {
            "named instance"
        }));
        assert_eq!(std::fs::read(path).unwrap(), bytes);
    }
}

#[test]
fn mapped_range_edits_fail_and_dry_run_or_output_renames_preserve_the_input() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    let destination = temp.path().join("Variant.shift");
    drop(ShiftStore::create_document(&path, &sample_variable_font()).unwrap());
    let bytes = std::fs::read(&path).unwrap();
    let invalid = shift(&[
        "axis",
        "set",
        path.to_str().unwrap(),
        "wght",
        "--max",
        "1000",
        "--json",
    ]);
    assert!(!invalid.status.success());
    let report: Value = serde_json::from_slice(&invalid.stdout).unwrap();
    assert!(report["error"].to_string().contains("mapping authoring"));
    assert_eq!(std::fs::read(&path).unwrap(), bytes);
    let args = [
        "axis",
        "set",
        path.to_str().unwrap(),
        "wght",
        "--name",
        "Mass",
        "--output",
        destination.to_str().unwrap(),
        "--json",
    ];
    let mut dry_run = args.to_vec();
    dry_run.push("--dry-run");
    let output = shift(&dry_run);
    assert!(output.status.success(), "{:?}", output.stderr);
    assert!(!destination.exists());
    assert_eq!(std::fs::read(&path).unwrap(), bytes);
    let output = shift(&args);
    assert!(output.status.success(), "{:?}", output.stderr);
    assert_eq!(
        load_font(destination.to_str().unwrap()).axes()[0].name(),
        "Mass"
    );
    assert_eq!(std::fs::read(&path).unwrap(), bytes);
    let input_id = ShiftStore::open_document(&path)
        .unwrap()
        .document_metadata()
        .unwrap()
        .document_id;
    let output_id = ShiftStore::open_document(destination)
        .unwrap()
        .document_metadata()
        .unwrap()
        .document_id;
    assert_ne!(input_id, output_id);
}

#[test]
fn discrete_internal_axis_naming_edits_do_not_change_kind_or_role() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    let mut font = Font::new();
    let mut axis = Axis::weight();
    axis.set_kind(AxisKind::Discrete {
        values: vec![100.0, 400.0, 700.0],
        default: 400.0,
    });
    axis.set_role(AxisRole::Internal);
    font.add_axis(axis.clone()).unwrap();
    drop(ShiftStore::create_document(&path, &font).unwrap());
    let output = shift(&[
        "axis",
        "set",
        path.to_str().unwrap(),
        "wght",
        "--name",
        "Grades",
    ]);
    assert!(output.status.success(), "{:?}", output.stderr);
    let after = load_font(path.to_str().unwrap());
    assert_eq!(after.axes()[0].kind(), axis.kind());
    assert_eq!(after.axes()[0].role(), AxisRole::Internal);
    assert_eq!(after.axes()[0].name(), "Grades");
    let bytes = std::fs::read(&path).unwrap();
    assert!(
        !shift(&["axis", "set", path.to_str().unwrap(), "wght", "--min", "0"])
            .status
            .success()
    );
    assert_eq!(std::fs::read(path).unwrap(), bytes);
}
