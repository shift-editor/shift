mod support;

use serde_json::Value;
use shift_font::{MetricKind, MetricValue, Source, test_support::sample_font};
use shift_store::ShiftStore;
use skrifa::{FontRef, MetadataProvider, raw::TableProvider, string::StringId};
use support::{load_font, shift, shift_with_stdin};

fn font_info(path: &str, extra: &[&str]) -> Value {
    let mut args = vec!["font", "info", path, "--json"];
    args.extend_from_slice(extra);
    let output = shift(&args);
    assert!(output.status.success(), "{:?}", output.stderr);
    serde_json::from_slice(&output.stdout).unwrap()
}

fn name(font: &FontRef<'_>, id: StringId) -> String {
    font.localized_strings(id)
        .english_or_first()
        .unwrap()
        .to_string()
}

#[test]
fn authors_metadata_and_metrics_through_save_reopen_and_compilation() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    let ttf = temp.path().join("Lab.ttf");
    let path_string = path.to_str().unwrap();
    assert!(shift(&["font", "create", path_string]).status.success());
    assert!(shift_with_stdin(&["glyph", "set", path_string, "--input", "-"],
        r#"{"glyphs":[{"name":"A","unicodes":["U+0041"],"layer":{"advance":600,"svgPath":"M0 0 L300 700 L600 0 Z"}}]}"#).status.success());
    let license = "  License terms\nSecond line\n";
    let output = shift(&[
        "font",
        "set",
        path_string,
        "--family-name",
        "Packet Mono",
        "--style-name",
        "Book",
        "--version",
        "2.125",
        "--copyright",
        "Copyright 2026 Shift",
        "--designer",
        "Shift Test Lab",
        "--designer-url",
        "https://shift.graphics/team",
        "--license",
        license,
        "--license-url",
        "https://openfontlicense.org/",
        "--ascender",
        "850",
        "--descender",
        "-230",
        "--x-height",
        "480",
        "--cap-height",
        "720",
        "--line-gap",
        "24",
        "--italic-angle",
        "-8",
        "--json",
    ]);
    assert!(output.status.success(), "{:?}", output.stderr);
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["changes"][0]["kind"], "fontMetadataUpdated");
    assert_eq!(report["changes"][0]["license"], license);
    assert_eq!(report["changes"][1]["ascender"].as_f64(), Some(850.0));
    let info = font_info(path_string, &[]);
    assert_eq!(info["familyName"], "Packet Mono");
    assert_eq!(info["styleName"], "Book");
    assert_eq!(info["version"], "2.125");
    assert_eq!(info["copyright"], "Copyright 2026 Shift");
    assert_eq!(info["designer"], "Shift Test Lab");
    assert_eq!(info["designerUrl"], "https://shift.graphics/team");
    assert_eq!(info["license"], license);
    assert_eq!(info["licenseUrl"], "https://openfontlicense.org/");
    assert_eq!(info["unitsPerEm"].as_f64(), Some(1000.0));
    assert_eq!(info["source"]["descender"].as_f64(), Some(-230.0));
    assert_eq!(info["source"]["lineGap"].as_f64(), Some(24.0));
    assert_eq!(info["source"]["italicAngle"].as_f64(), Some(-8.0));
    let compiled = shift(&["compile", path_string, "--output", ttf.to_str().unwrap()]);
    assert!(compiled.status.success(), "{:?}", compiled.stderr);
    let bytes = std::fs::read(ttf).unwrap();
    let font = FontRef::new(&bytes).unwrap();
    assert_eq!(
        name(&font, StringId::TYPOGRAPHIC_FAMILY_NAME),
        "Packet Mono"
    );
    assert_eq!(name(&font, StringId::TYPOGRAPHIC_SUBFAMILY_NAME), "Book");
    assert_eq!(name(&font, StringId::VERSION_STRING), "Version 2.125");
    assert_eq!(
        name(&font, StringId::COPYRIGHT_NOTICE),
        "Copyright 2026 Shift"
    );
    assert_eq!(name(&font, StringId::DESIGNER), "Shift Test Lab");
    assert_eq!(
        name(&font, StringId::DESIGNER_URL),
        "https://shift.graphics/team"
    );
    assert_eq!(name(&font, StringId::LICENSE_DESCRIPTION), license);
    assert_eq!(
        name(&font, StringId::LICENSE_URL),
        "https://openfontlicense.org/"
    );
    assert_eq!(font.head().unwrap().font_revision().to_f64(), 2.125);
    let os2 = font.os2().unwrap();
    assert_eq!(os2.s_typo_ascender(), 850);
    assert_eq!(os2.s_typo_descender(), -230);
    assert_eq!(os2.s_typo_line_gap(), 24);
    assert_eq!(os2.sx_height(), Some(480));
    assert_eq!(os2.s_cap_height(), Some(720));
    assert_eq!(font.post().unwrap().italic_angle().to_f64(), -8.0);
}

#[test]
fn metric_edits_target_only_the_selected_master_and_preserve_overshoots() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    let before = sample_font();
    drop(ShiftStore::create_document(&path, &before).unwrap());
    let bold = before
        .sources()
        .iter()
        .find(|source| source.name() == "Bold")
        .unwrap();
    let original = before
        .metric_value(bold.id(), MetricKind::Ascender)
        .unwrap();
    let output = shift(&[
        "font",
        "set",
        path.to_str().unwrap(),
        "--source",
        "Bold",
        "--ascender",
        "1700.25",
        "--line-gap",
        "36.5",
        "--json",
    ]);
    assert!(output.status.success(), "{:?}", output.stderr);
    let after = load_font(path.to_str().unwrap());
    assert_eq!(
        after.metric_value(bold.id(), MetricKind::Ascender),
        Some(MetricValue::new(1700.25, original.overshoot))
    );
    assert_eq!(after.default_source(), before.default_source());
    assert_eq!(after.metadata(), before.metadata());
    assert_eq!(
        after.source(&bold.id()).unwrap().location(),
        bold.location()
    );
    assert_eq!(after.source(&bold.id()).unwrap().lib(), bold.lib());
    assert_eq!(after.source(&bold.id()).unwrap().color(), bold.color());
    assert_eq!(after.source(&bold.id()).unwrap().line_gap(), Some(36.5));
    assert_eq!(
        after.metric_value(bold.id(), MetricKind::CapHeight),
        before.metric_value(bold.id(), MetricKind::CapHeight)
    );
    let selector = bold.id().to_string();
    let info = font_info(path.to_str().unwrap(), &["--source", &selector]);
    assert_eq!(info["source"]["name"], "Bold");
    assert_eq!(info["source"]["ascender"].as_f64(), Some(1700.25));
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["changes"][0]["sourceId"], selector);
    assert_eq!(report["changes"][0]["ascender"].as_f64(), Some(1700.25));
    assert_eq!(report["changes"].as_array().unwrap().len(), 1);
}

#[test]
fn metadata_edits_preserve_omitted_metadata_metrics_and_all_glyph_content() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    let before = sample_font();
    drop(ShiftStore::create_document(&path, &before).unwrap());
    let document_id = ShiftStore::open_document(&path)
        .unwrap()
        .document_metadata()
        .unwrap()
        .document_id;
    let output = shift(&[
        "font",
        "set",
        path.to_str().unwrap(),
        "--family-name",
        "New Family",
        "--json",
    ]);
    assert!(output.status.success(), "{:?}", output.stderr);
    let mut expected = before.clone();
    expected.metadata_mut().family_name = Some("New Family".to_string());
    assert_eq!(load_font(path.to_str().unwrap()), expected);
    assert_eq!(
        ShiftStore::open_document(&path)
            .unwrap()
            .document_metadata()
            .unwrap()
            .document_id,
        document_id
    );
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["changes"].as_array().unwrap().len(), 1);
    assert_eq!(
        report["changes"][0]["license"],
        before.metadata().license.as_deref().unwrap()
    );
}

#[test]
fn missing_standard_metric_is_introduced_without_overwriting_other_authored_roles() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    let mut before = sample_font();
    let definitions = before
        .metric_definitions()
        .iter()
        .filter(|definition| definition.kind() != MetricKind::Ascender)
        .cloned()
        .collect();
    before.set_metric_definitions(definitions).unwrap();
    drop(ShiftStore::create_document(&path, &before).unwrap());
    assert_eq!(
        font_info(path.to_str().unwrap(), &[])["source"]["ascender"],
        Value::Null
    );
    let output = shift(&[
        "font",
        "set",
        path.to_str().unwrap(),
        "--ascender",
        "1650",
        "--json",
    ]);
    assert!(output.status.success(), "{:?}", output.stderr);
    let after = load_font(path.to_str().unwrap());
    assert_eq!(
        after
            .metric_value(after.default_source_id().unwrap(), MetricKind::Ascender)
            .unwrap()
            .position,
        1650.0
    );
    let bold = after
        .sources()
        .iter()
        .find(|source| source.name() == "Bold")
        .unwrap();
    assert_eq!(
        after.metric_value(bold.id(), MetricKind::Ascender),
        Some(MetricValue::for_kind(
            MetricKind::Ascender,
            after.metrics().units_per_em
        ))
    );
    assert_eq!(
        after.metric_value(after.default_source_id().unwrap(), MetricKind::CapHeight),
        before.metric_value(before.default_source_id().unwrap(), MetricKind::CapHeight)
    );
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    let sources = report["changes"].as_array().unwrap();
    assert_eq!(sources.len(), 2);
    let regular = sources
        .iter()
        .find(|source| source["name"] == "Regular")
        .unwrap();
    assert_eq!(regular["ascender"].as_f64(), Some(1650.0));
}

#[test]
fn info_and_header_edits_do_not_acquire_unrelated_geometry() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    let before = sample_font();
    drop(ShiftStore::create_document(&path, &before).unwrap());
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection
        .execute(
            "UPDATE glyph_layer_payloads SET payload = X'00', stored_byte_length = 1",
            [],
        )
        .unwrap();
    drop(connection);
    assert!(
        ShiftStore::open_document(&path)
            .unwrap()
            .load_font_state()
            .is_err()
    );
    let bytes = std::fs::read(&path).unwrap();
    assert_eq!(
        font_info(path.to_str().unwrap(), &[])["familyName"],
        "Dogfood Sans"
    );
    assert_eq!(std::fs::read(&path).unwrap(), bytes);
    let output = shift(&[
        "font",
        "set",
        path.to_str().unwrap(),
        "--family-name",
        "Header Only",
        "--ascender",
        "1600",
    ]);
    assert!(output.status.success(), "{:?}", output.stderr);
    let info = font_info(path.to_str().unwrap(), &[]);
    assert_eq!(info["familyName"], "Header Only");
    assert_eq!(info["source"]["ascender"].as_f64(), Some(1600.0));
    assert!(
        ShiftStore::open_document(&path)
            .unwrap()
            .load_font_state()
            .is_err()
    );
}

#[test]
fn invalid_metadata_or_metrics_leave_the_complete_input_unchanged() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    drop(ShiftStore::create_document(&path, &sample_font()).unwrap());
    let bytes = std::fs::read(&path).unwrap();
    for flags in [
        vec!["--version", "1.5"],
        vec!["--version", "1.1234"],
        vec!["--version=-1.000"],
        vec!["--version", "32768.000"],
        vec!["--family-name", " "],
        vec!["--license", ""],
        vec!["--family-name", "Must Not Persist", "--ascender", "NaN"],
        vec!["--family-name", "Must Not Persist", "--line-gap", "inf"],
        vec![
            "--family-name",
            "Must Not Persist",
            "--source",
            "unknown",
            "--ascender",
            "900",
        ],
        vec!["--family-name", "Must Not Persist", "--source", "Bold"],
        vec![],
    ] {
        let mut args = vec!["font", "set", path.to_str().unwrap(), "--json"];
        args.extend_from_slice(&flags);
        let output = shift(&args);
        assert!(!output.status.success(), "accepted {flags:?}");
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        let report: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(report["valid"], false);
    }
}

#[test]
fn layer_only_sources_cannot_receive_font_metric_edits() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    let mut font = sample_font();
    font.add_source(Source::layer("Background".to_string()));
    drop(ShiftStore::create_document(&path, &font).unwrap());
    let bytes = std::fs::read(&path).unwrap();
    let output = shift(&[
        "font",
        "set",
        path.to_str().unwrap(),
        "--source",
        "Background",
        "--ascender",
        "900",
        "--json",
    ]);
    assert!(!output.status.success());
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert!(
        report["error"]["summary"]
            .as_str()
            .unwrap()
            .contains("not a master")
    );
    assert_eq!(std::fs::read(path).unwrap(), bytes);
}

#[test]
fn dry_run_and_output_preserve_input_and_output_gets_independent_identity() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    let destination = temp.path().join("Variant.shift");
    drop(ShiftStore::create_document(&path, &sample_font()).unwrap());
    let bytes = std::fs::read(&path).unwrap();
    let args = [
        "font",
        "set",
        path.to_str().unwrap(),
        "--family-name",
        "Variant",
        "--ascender",
        "1650",
        "--output",
        destination.to_str().unwrap(),
        "--json",
    ];
    let mut dry_run = args.to_vec();
    dry_run.push("--dry-run");
    let output = shift(&dry_run);
    assert!(output.status.success(), "{:?}", output.stderr);
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["wrote"], false);
    assert_eq!(report["changes"][0]["familyName"], "Variant");
    assert!(!destination.exists());
    assert_eq!(std::fs::read(&path).unwrap(), bytes);
    let output = shift(&args);
    assert!(output.status.success(), "{:?}", output.stderr);
    assert_eq!(
        font_info(destination.to_str().unwrap(), &[])["familyName"],
        "Variant"
    );
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

#[test]
fn integer_version_is_unambiguous_and_human_info_shows_authored_metrics() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    assert!(
        shift(&["font", "create", path.to_str().unwrap()])
            .status
            .success()
    );
    let output = shift(&[
        "font",
        "set",
        path.to_str().unwrap(),
        "--version",
        "3",
        "--ascender",
        "850",
    ]);
    assert!(output.status.success(), "{:?}", output.stderr);
    let info = font_info(path.to_str().unwrap(), &[]);
    assert_eq!(info["version"], "3.000");
    assert_eq!(info["versionMajor"], 3);
    assert_eq!(info["versionMinor"], 0);
    let human = shift(&["font", "info", path.to_str().unwrap()]);
    assert!(human.status.success());
    let text = String::from_utf8(human.stdout).unwrap();
    assert!(text.contains("Version: 3.000"));
    assert!(text.contains("Ascender: 850"));
}
