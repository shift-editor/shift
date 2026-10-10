mod support;

use std::path::{Path, PathBuf};

use serde_json::{Value, json};
use shift_font::test_support::{kerning_between, sample_font, sample_variable_font};
use shift_font::{Font, KerningPosition, SourceId};
use shift_store::ShiftStore;
use support::{load_font, shift, shift_with_stdin};

fn sample_document(directory: &Path) -> PathBuf {
    let path = directory.join("Lab.shift");
    drop(ShiftStore::create_document(&path, &sample_font()).unwrap());
    path
}

fn json_output(args: &[&str]) -> Value {
    let output = shift(args);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}

fn regular() -> SourceId {
    SourceId::from_raw("regular")
}

fn bold() -> SourceId {
    SourceId::from_raw("bold")
}

fn group_members(font: &Font, position: KerningPosition, name: &str) -> Vec<String> {
    let kerning = font.kerning();
    let group_id = kerning.group_id(position, name).unwrap();
    kerning
        .group(group_id)
        .unwrap()
        .members
        .iter()
        .map(|glyph_id| font.glyph(glyph_id).unwrap().name().to_string())
        .collect()
}

#[test]
fn list_reports_each_authored_pair_with_a_value_per_master() {
    let temp = tempfile::tempdir().unwrap();
    let path = sample_document(temp.path());

    let report = json_output(&["kerning", "list", path.to_str().unwrap(), "--json"]);

    let sources = report["sources"]
        .as_array()
        .unwrap()
        .iter()
        .map(|source| source["name"].as_str().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(sources, ["Regular", "Bold"]);
    assert_eq!(
        report["pairs"],
        json!([
            {
                "first": { "kind": "group", "id": "kerningGroup_first_A", "name": "A" },
                "second": { "kind": "group", "id": "kerningGroup_second_A", "name": "A" },
                "values": [-80.0, -120.0],
            },
            {
                "first": { "kind": "glyph", "id": "glyph_A", "name": "A" },
                "second": { "kind": "group", "id": "kerningGroup_second_A", "name": "A" },
                "values": [null, -100.0],
            },
        ])
    );
}

#[test]
fn groups_lists_both_positions_with_their_members() {
    let temp = tempfile::tempdir().unwrap();
    let path = sample_document(temp.path());

    let report = json_output(&["kerning", "groups", path.to_str().unwrap(), "--json"]);
    let second_only = json_output(&[
        "kerning",
        "groups",
        path.to_str().unwrap(),
        "--position",
        "second",
        "--json",
    ]);

    let positions = report["groups"]
        .as_array()
        .unwrap()
        .iter()
        .map(|group| group["position"].as_str().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(positions, ["first", "second"]);
    assert_eq!(report["groups"][0]["members"][0]["name"], "A");
    assert_eq!(second_only["groups"].as_array().unwrap().len(), 1);
    assert_eq!(second_only["groups"][0]["position"], "second");
}

#[test]
fn get_names_the_pair_that_applies_at_each_master() {
    let temp = tempfile::tempdir().unwrap();
    let path = sample_document(temp.path());

    let report = json_output(&["kerning", "get", path.to_str().unwrap(), "A", "A", "--json"]);

    assert_eq!(report["first"]["group"]["name"], "A");
    assert_eq!(report["masters"][0]["name"], "Regular");
    assert_eq!(report["masters"][0]["value"], -80.0);
    assert_eq!(report["masters"][0]["origin"], "authored");
    assert_eq!(report["masters"][0]["rule"], "group");
    assert_eq!(report["masters"][1]["name"], "Bold");
    assert_eq!(report["masters"][1]["value"], -100.0);
    assert_eq!(report["masters"][1]["rule"], "exception");
    assert_eq!(report["masters"][1]["pair"]["first"]["kind"], "glyph");
    assert_eq!(report["location"], Value::Null);
}

#[test]
fn get_interpolates_masters_without_kerning_and_mapped_locations() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Variable.shift");
    drop(ShiftStore::create_document(&path, &sample_variable_font()).unwrap());

    let report = json_output(&[
        "kerning",
        "get",
        path.to_str().unwrap(),
        "A",
        "A",
        "--location",
        "wght=700",
        "--json",
    ]);

    let masters = report["masters"]
        .as_array()
        .unwrap()
        .iter()
        .map(|master| {
            (
                master["value"].as_f64().unwrap(),
                master["origin"].as_str().unwrap(),
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(
        masters,
        [
            (-50.0, "authored"),
            (-70.0, "interpolated"),
            (-90.0, "authored")
        ]
    );
    assert_eq!(report["location"]["design"][0]["value"], 600.0);
    assert_eq!(report["location"]["value"], -70.0);
}

#[test]
fn set_then_remove_edits_one_pair_at_one_master() {
    let temp = tempfile::tempdir().unwrap();
    let path = sample_document(temp.path());
    let path_text = path.to_str().unwrap();

    let set = json_output(&[
        "kerning", "set", path_text, "acute", "@A", "-35", "--source", "Regular", "--json",
    ]);
    let after_set = load_font(path_text);
    let removed = json_output(&[
        "kerning", "remove", path_text, "acute", "@A", "--source", "Regular", "--json",
    ]);
    let after_remove = load_font(path_text);

    assert_eq!(set["changes"][0]["kind"], "kerningValueSet");
    assert_eq!(set["changes"][0]["value"], -35.0);
    assert_eq!(set["changes"][0]["previous"], Value::Null);
    assert_eq!(
        kerning_between(&after_set, &regular(), "acute", "A"),
        Some(-35.0)
    );
    assert_eq!(kerning_between(&after_set, &bold(), "acute", "A"), None);
    assert_eq!(removed["changes"][0]["kind"], "kerningValueRemoved");
    assert_eq!(removed["changes"][0]["previous"], -35.0);
    assert_eq!(
        kerning_between(&after_remove, &regular(), "acute", "A"),
        None
    );
}

#[test]
fn remove_rejects_a_pair_with_no_value_at_that_master() {
    let temp = tempfile::tempdir().unwrap();
    let path = sample_document(temp.path());

    let output = shift(&[
        "kerning",
        "remove",
        path.to_str().unwrap(),
        "A",
        "@A",
        "--source",
        "Regular",
    ]);

    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("has no value"));
}

#[test]
fn a_group_id_on_the_wrong_side_is_rejected_without_writing() {
    let temp = tempfile::tempdir().unwrap();
    let path = sample_document(temp.path());

    let output = shift(&[
        "kerning",
        "set",
        path.to_str().unwrap(),
        "kerningGroup_second_A",
        "A",
        "-10",
        "--source",
        "Regular",
    ]);

    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("is a second group"));
    assert_eq!(
        load_font(path.to_str().unwrap()).kerning(),
        sample_font().kerning()
    );
}

#[test]
fn a_batch_creates_groups_that_its_pairs_reference_in_one_save() {
    let temp = tempfile::tempdir().unwrap();
    let path = sample_document(temp.path());
    let path_text = path.to_str().unwrap();

    let output = shift_with_stdin(
        &["kerning", "set", path_text, "--input", "-", "--json"],
        r#"{
            "groups": [{ "position": "first", "name": "accents", "members": ["acute"] }],
            "pairs": [
                { "source": "Regular", "first": "@accents", "second": "@A", "value": -30 },
                { "source": "Bold", "first": "A", "second": "@A", "value": null }
            ]
        }"#,
    );
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    let after = load_font(path_text);

    let kinds = report["changes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|change| change["kind"].as_str().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(
        kinds,
        [
            "kerningGroupCreated",
            "kerningValueRemoved",
            "kerningValueSet"
        ]
    );
    assert_eq!(
        group_members(&after, KerningPosition::First, "accents"),
        ["acute"]
    );
    assert_eq!(
        kerning_between(&after, &regular(), "acute", "A"),
        Some(-30.0)
    );
    assert_eq!(kerning_between(&after, &bold(), "A", "A"), Some(-120.0));
}

#[test]
fn a_batch_with_members_replaces_the_groups_membership() {
    let temp = tempfile::tempdir().unwrap();
    let path = sample_document(temp.path());
    let path_text = path.to_str().unwrap();

    let output = shift_with_stdin(
        &["kerning", "set", path_text, "--input", "-"],
        r#"{ "groups": [{ "position": "second", "name": "A", "members": ["acute"] }] }"#,
    );
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let after = load_font(path_text);

    assert_eq!(
        group_members(&after, KerningPosition::Second, "A"),
        ["acute"]
    );
    assert_eq!(group_members(&after, KerningPosition::First, "A"), ["A"]);
}

#[test]
fn an_invalid_batch_writes_nothing() {
    let temp = tempfile::tempdir().unwrap();
    let path = sample_document(temp.path());
    let path_text = path.to_str().unwrap();

    let output = shift_with_stdin(
        &["kerning", "set", path_text, "--input", "-"],
        r#"{
            "groups": [{ "position": "first", "name": "accents", "members": ["acute"] }],
            "pairs": [{ "source": "Black", "first": "@accents", "second": "A", "value": -30 }]
        }"#,
    );

    assert!(!output.status.success());
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("entry 1"), "{stderr}");
    assert_eq!(load_font(path_text).kerning(), sample_font().kerning());
}

#[test]
fn group_commands_create_rename_assign_unassign_and_delete() {
    let temp = tempfile::tempdir().unwrap();
    let path = sample_document(temp.path());
    let path_text = path.to_str().unwrap();
    let run = |args: &[&str]| {
        let mut full = vec!["kerning", "group"];
        full.extend_from_slice(args);
        json_output(&full)
    };

    let created = run(&[
        "create",
        path_text,
        "Round",
        "acute",
        "--position",
        "second",
        "--json",
    ]);
    run(&[
        "rename",
        path_text,
        "Round",
        "Rounded",
        "--position",
        "second",
        "--json",
    ]);
    run(&[
        "assign",
        path_text,
        "Rounded",
        "A",
        "--position",
        "second",
        "--json",
    ]);
    let after_assign = load_font(path_text);
    run(&[
        "unassign",
        path_text,
        "acute",
        "--position",
        "second",
        "--json",
    ]);
    let after_unassign = load_font(path_text);
    let deleted = run(&[
        "delete",
        path_text,
        "Rounded",
        "--position",
        "second",
        "--json",
    ]);
    let after_delete = load_font(path_text);

    assert_eq!(created["changes"][0]["kind"], "kerningGroupCreated");
    assert_eq!(created["changes"][0]["members"][0]["name"], "acute");
    assert_eq!(
        group_members(&after_assign, KerningPosition::Second, "Rounded"),
        ["acute", "A"]
    );
    assert!(group_members(&after_assign, KerningPosition::Second, "A").is_empty());
    assert_eq!(
        group_members(&after_unassign, KerningPosition::Second, "Rounded"),
        ["A"]
    );
    let deleted_kinds = deleted["changes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|change| change["kind"].as_str().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(deleted_kinds, ["kerningGroupDeleted"]);
    assert!(
        after_delete
            .kerning()
            .group_id(KerningPosition::Second, "Rounded")
            .is_none()
    );
}

#[test]
fn dry_run_reports_the_change_without_writing() {
    let temp = tempfile::tempdir().unwrap();
    let path = sample_document(temp.path());
    let path_text = path.to_str().unwrap();

    let report = json_output(&[
        "kerning",
        "set",
        path_text,
        "A",
        "A",
        "-5",
        "--source",
        "Regular",
        "--dry-run",
        "--json",
    ]);

    assert_eq!(report["wrote"], false);
    assert_eq!(report["changes"][0]["kind"], "kerningValueSet");
    assert_eq!(load_font(path_text).kerning(), sample_font().kerning());
}
