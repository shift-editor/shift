use std::process::{Command, Output};

use serde_json::Value;
use shift_source::ShiftSourcePackage;

fn shift(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_shift-cli"))
        .args(args)
        .output()
        .expect("shift CLI should run")
}

#[test]
fn authors_axis_and_source_through_the_cli() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    let path = path.to_str().unwrap();

    let created = shift(&["font", "create", path, "--json"]);
    assert!(created.status.success(), "{:?}", created.stderr);

    let axis = shift(&[
        "axis",
        "add",
        path,
        "--tag",
        "wght",
        "--name",
        "Weight",
        "--min",
        "100",
        "--default",
        "400",
        "--max",
        "900",
        "--json",
    ]);
    assert!(axis.status.success(), "{:?}", axis.stderr);
    let report: Value = serde_json::from_slice(&axis.stdout).unwrap();
    assert_eq!(report["valid"], true);
    assert_eq!(report["wrote"], true);
    assert_eq!(report["changes"][0]["kind"], "axisCreated");
    assert!(
        report["changes"][0]["axisId"]
            .as_str()
            .unwrap()
            .starts_with("axis_")
    );

    let source = shift(&[
        "source",
        "add",
        path,
        "--name",
        "Black",
        "--location",
        "wght=900",
        "--json",
    ]);
    assert!(source.status.success(), "{:?}", source.stderr);

    let font = ShiftSourcePackage::load_font(path).unwrap();
    assert_eq!(font.axes()[0].tag(), "wght");
    assert_eq!(font.sources().len(), 2);
    assert_eq!(font.sources()[1].name(), "Black");
    assert_eq!(
        font.sources()[1].location().get(&font.axes()[0].id()),
        Some(900.0)
    );
}

#[test]
fn dry_run_reports_a_valid_change_without_writing() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    let path = path.to_str().unwrap();
    assert!(shift(&["font", "create", path]).status.success());

    let output = shift(&[
        "axis",
        "add",
        path,
        "--tag",
        "wght",
        "--name",
        "Weight",
        "--min",
        "100",
        "--default",
        "400",
        "--max",
        "900",
        "--dry-run",
        "--json",
    ]);

    assert!(output.status.success(), "{:?}", output.stderr);
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["valid"], true);
    assert_eq!(report["wrote"], false);
    assert!(
        ShiftSourcePackage::load_font(path)
            .unwrap()
            .axes()
            .is_empty()
    );
}

#[test]
fn invalid_mutation_exits_nonzero_and_keeps_the_input_unchanged() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    let path_string = path.to_str().unwrap();
    assert!(shift(&["font", "create", path_string]).status.success());
    let before = std::fs::read(&path).unwrap();

    let output = shift(&[
        "axis",
        "add",
        path_string,
        "--tag",
        "wght",
        "--name",
        "Weight",
        "--min",
        "500",
        "--default",
        "400",
        "--max",
        "900",
        "--json",
    ]);

    assert!(!output.status.success());
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["valid"], false);
    assert_eq!(report["error"]["summary"], "authoring change is invalid");
    assert!(
        report["error"]["causes"]
            .as_array()
            .unwrap()
            .iter()
            .any(|cause| cause
                .as_str()
                .unwrap()
                .contains("expected minimum <= default <= maximum"))
    );
    assert!(
        String::from_utf8_lossy(&output.stderr).contains("expected minimum <= default <= maximum")
    );
    assert_eq!(std::fs::read(path).unwrap(), before);
}
