use std::process::{Command, Output};

use serde_json::Value;
use shift_font::Font;
use shift_store::ShiftStore;

fn shift(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_shift-cli"))
        .args(args)
        .output()
        .expect("shift CLI should run")
}

fn load_font(path: &str) -> Font {
    ShiftStore::open_document(path)
        .unwrap()
        .load_font_state()
        .unwrap()
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

    let font = load_font(path);
    assert_eq!(font.axes()[0].tag(), "wght");
    assert_eq!(font.sources().len(), 2);
    assert_eq!(font.sources()[1].name(), "Black");
    assert_eq!(
        font.sources()[1].location().get(&font.axes()[0].id()),
        Some(900.0)
    );
}

/// Adds a 10–100 axis named after its tag, passing `extra` flags through.
fn add_axis(path: &str, tag: &str, extra: &[&str]) {
    let mut args = vec![
        "axis",
        "add",
        path,
        "--tag",
        tag,
        "--name",
        tag,
        "--min",
        "10",
        "--default",
        "10",
        "--max",
        "100",
    ];
    args.extend_from_slice(extra);
    let output = shift(&args);
    assert!(output.status.success(), "{:?}", output.stderr);
}

#[test]
fn hidden_flag_creates_a_hidden_axis() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Hidden.shift");
    let path = path.to_str().unwrap();
    assert!(shift(&["font", "create", path]).status.success());

    add_axis(path, "wght", &[]);
    add_axis(path, "opsz", &["--hidden"]);

    let font = load_font(path);
    let hidden: Vec<_> = font
        .axes()
        .iter()
        .map(shift_font::Axis::is_hidden)
        .collect();
    assert_eq!(hidden, [false, true]);
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
    assert!(load_font(path).axes().is_empty());
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
