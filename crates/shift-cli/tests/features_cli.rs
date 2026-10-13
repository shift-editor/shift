mod support;

use serde_json::Value;
use shift_font::test_support::sample_font;
use shift_store::ShiftStore;
use support::{load_font, shift, shift_with_stdin};

const LIGA: &str = "feature liga {\n    sub f i by f_i;\n} liga;\n";

fn document(temp: &tempfile::TempDir) -> String {
    let path = temp.path().join("Lab.shift");
    drop(ShiftStore::create_document(&path, &sample_font()).unwrap());
    path.to_string_lossy().into_owned()
}

fn shown(path: &str) -> String {
    let output = shift(&["features", "show", path]);
    assert!(
        output.status.success(),
        "{:?}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap()
}

#[test]
fn set_stores_the_code_and_show_prints_it_back_exactly() {
    let temp = tempfile::tempdir().unwrap();
    let path = document(&temp);
    let input = temp.path().join("lab.fea");
    std::fs::write(&input, LIGA).unwrap();

    let output = shift(&[
        "features",
        "set",
        &path,
        "--input",
        input.to_str().unwrap(),
        "--json",
    ]);

    assert!(
        output.status.success(),
        "{:?}",
        String::from_utf8_lossy(&output.stderr)
    );
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert!(
        report["changes"]
            .as_array()
            .unwrap()
            .iter()
            .any(|change| change["kind"] == "featureCodeUpdated" && change["lines"] == 3)
    );
    assert_eq!(shown(&path), LIGA);
}

#[test]
fn empty_input_removes_the_code() {
    let temp = tempfile::tempdir().unwrap();
    let path = document(&temp);
    assert!(
        shift_with_stdin(&["features", "set", &path, "--input", "-"], LIGA)
            .status
            .success()
    );

    let output = shift_with_stdin(&["features", "set", &path, "--input", "-"], "\n");

    assert!(output.status.success());
    assert_eq!(load_font(&path).features().fea_source(), None);
    assert_eq!(shown(&path), "");
}

#[test]
fn dry_run_describes_the_change_without_writing() {
    let temp = tempfile::tempdir().unwrap();
    let path = document(&temp);
    let before = load_font(&path).features().fea_source().map(str::to_string);

    let output = shift_with_stdin(
        &["features", "set", &path, "--input", "-", "--dry-run"],
        LIGA,
    );

    assert!(output.status.success());
    assert_eq!(
        load_font(&path).features().fea_source().map(str::to_string),
        before
    );
}
