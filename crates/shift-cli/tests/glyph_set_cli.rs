mod support;

use serde_json::{Value, json};
use shift_font::{Contour, PointType, test_support::sample_font};
use shift_store::ShiftStore;
use support::{load_font, shift, shift_with_stdin};

#[test]
fn layer_set_replaces_content_without_changing_identity_or_auxiliary_data() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    let mut before = sample_font();
    let layer_id = before
        .glyph_by_name("A")
        .unwrap()
        .layer_for_source(before.default_source_id().unwrap())
        .unwrap()
        .id();
    before
        .layer_mut(&layer_id)
        .unwrap()
        .add_contour(Contour::new());
    drop(ShiftStore::create_document(&path, &before).unwrap());
    let output = shift_with_stdin(
        &[
            "layer",
            "set",
            path.to_str().unwrap(),
            "--glyph",
            "A",
            "--source",
            "Regular",
            "--input",
            "-",
            "--json",
        ],
        r#"{"advance":720,"svgPath":"M10 20 L30 80 L70 20 Z","anchors":[{"name":"top","x":40,"y":90}]}"#,
    );
    assert!(output.status.success(), "{:?}", output.stderr);
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["changes"][0]["kind"], "glyphLayerUpdated");
    assert_eq!(report["changes"][0]["pointCount"], 3);
    assert_eq!(report["changes"][0]["componentCount"], 0);
    let after = load_font(path.to_str().unwrap());
    let layer = after.layer(&layer_id).unwrap();
    let original = before.layer(&layer_id).unwrap();
    assert_eq!(layer.width(), 720.0);
    assert_eq!(layer.source_id(), original.source_id());
    assert_eq!(layer.height(), original.height());
    assert_eq!(layer.guidelines(), original.guidelines());
    assert_eq!(layer.lib(), original.lib());
    assert!(layer.components().is_empty());
    assert_eq!(layer.contours().len(), 1);
    let contour = layer.contours_iter().next().unwrap();
    assert!(contour.is_closed());
    assert_ne!(contour.id(), original.contours_iter().next().unwrap().id());
    assert_eq!(contour.points()[1].y(), 80.0);
    assert_eq!(layer.anchors()[0].name(), Some("top"));
    assert_eq!(layer.anchors()[0].y(), 90.0);
    assert_eq!(
        after.glyph_by_name("A").unwrap().unicodes(),
        before.glyph_by_name("A").unwrap().unicodes()
    );
    let bold = before
        .sources()
        .iter()
        .find(|source| source.name() == "Bold")
        .unwrap()
        .id();
    assert_eq!(
        after
            .glyph_by_name("A")
            .unwrap()
            .layer_for_source(bold.clone()),
        before.glyph_by_name("A").unwrap().layer_for_source(bold)
    );
}

#[test]
fn layer_set_creates_an_absent_layer_then_can_replace_it_with_a_blank_drawing() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    drop(ShiftStore::create_document(&path, &sample_font()).unwrap());
    let args = [
        "layer",
        "set",
        path.to_str().unwrap(),
        "--glyph",
        "acute",
        "--source",
        "Bold",
        "--input",
        "-",
        "--json",
    ];
    let output = shift_with_stdin(&args, r#"{"advance":300,"svgPath":"M1 2 L3 4"}"#);
    assert!(output.status.success(), "{:?}", output.stderr);
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["changes"][0]["kind"], "glyphLayerCreated");
    let layer_id = report["changes"][0]["layerId"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    assert!(shift_with_stdin(&args, r#"{"advance":0}"#).status.success());
    let font = load_font(path.to_str().unwrap());
    let layer = font.layer(&layer_id).unwrap();
    assert_eq!(layer.width(), 0.0);
    assert!(layer.is_empty());
}

#[test]
fn svg_relative_shorthand_quadratic_and_post_close_commands_preserve_geometry() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    drop(ShiftStore::create_document(&path, &sample_font()).unwrap());
    let output = shift_with_stdin(
        &[
            "layer",
            "set",
            path.to_str().unwrap(),
            "--glyph",
            "A",
            "--source",
            "Regular",
            "--input",
            "-",
        ],
        r#"{"advance":600,"svgPath":"m10 20 20 0 h30 v40 c10 0 20 10 30 20 s20 10 30 0 q10 -10 20 0 t20 0 z l5 10"}"#,
    );
    assert!(output.status.success(), "{:?}", output.stderr);
    let font = load_font(path.to_str().unwrap());
    let layer = font
        .glyph_by_name("A")
        .unwrap()
        .layer_for_source(font.default_source_id().unwrap())
        .unwrap();
    let contours = layer.contours_iter().collect::<Vec<_>>();
    let points = contours[0].points();
    assert!(contours[0].is_closed());
    assert_eq!((points[0].x(), points[0].y()), (10.0, 20.0));
    assert_eq!((points[3].x(), points[3].y()), (60.0, 60.0));
    assert_eq!((points[7].x(), points[7].y()), (100.0, 90.0));
    assert_eq!(points[11].point_type(), PointType::QCurve);
    assert_eq!((points[12].x(), points[12].y()), (150.0, 90.0));
    assert_eq!(points[13].point_type(), PointType::QCurve);
    assert_eq!(contours.len(), 2);
    assert!(!contours[1].is_closed());
    assert_eq!(
        (contours[1].points()[1].x(), contours[1].points()[1].y()),
        (15.0, 30.0)
    );
}

#[test]
fn invalid_svg_or_mixed_outline_formats_never_replace_the_layer() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    drop(ShiftStore::create_document(&path, &sample_font()).unwrap());
    let before = std::fs::read(&path).unwrap();
    for payload in [
        r#"{"advance":600,"contours":[],"svgPath":"M0 0 L1 2"}"#,
        r#"{"advance":600,"svgPath":"M0 0 A10 20 0 0 1 50 60"}"#,
        r#"{"advance":600,"svgPath":"M0 0 L1"}"#,
        r#"{"advance":600,"svgPath":"L1 2"}"#,
        r#"{"advance":600,"svgPath":"M0 0 X1 2"}"#,
        r#"{"advance":600,"svgPath":"M0 0 L1e309 2"}"#,
    ] {
        let output = shift_with_stdin(
            &[
                "layer",
                "set",
                path.to_str().unwrap(),
                "--glyph",
                "A",
                "--source",
                "Regular",
                "--input",
                "-",
                "--json",
            ],
            payload,
        );
        assert!(!output.status.success(), "accepted {payload}");
        let report: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(report["valid"], false);
        assert_eq!(std::fs::read(&path).unwrap(), before);
    }
}

#[test]
fn glyph_batch_creates_updates_and_authors_distinct_sources_from_one_file() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    let input = temp.path().join("glyphs.json");
    drop(ShiftStore::create_document(&path, &sample_font()).unwrap());
    std::fs::write(
        &input,
        json!({"glyphs": [
            {"name":"B", "layer":{"advance":500,"svgPath":"M0 0 L10 20"}},
            {"name":"B", "source":"Bold", "unicodes":["U+0042"], "layer":{"advance":550}},
            {"name":"A", "layer":{"advance":700}},
            {"name":"acute", "unicodes":[], "source":"Bold", "layer":{"advance":200}},
            {"name":"space", "unicodes":["U+0020"]}
        ]})
        .to_string(),
    )
    .unwrap();
    let output = shift(&[
        "glyph",
        "set",
        path.to_str().unwrap(),
        "--input",
        input.to_str().unwrap(),
        "--json",
    ]);
    assert!(output.status.success(), "{:?}", output.stderr);
    let font = load_font(path.to_str().unwrap());
    let glyph = font.glyph_by_name("B").unwrap();
    assert_eq!(glyph.unicodes(), &[0x42]);
    assert_eq!(glyph.layers().len(), 2);
    assert_eq!(
        glyph
            .layer_for_source(font.default_source_id().unwrap())
            .unwrap()
            .width(),
        500.0
    );
    assert_eq!(font.glyph_by_name("A").unwrap().unicodes(), &[0x41, 0xC1]);
    assert!(font.glyph_by_name("acute").unwrap().unicodes().is_empty());
    assert!(font.glyph_by_name("space").unwrap().layers().is_empty());
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["wrote"], true);
    assert!(
        report["changes"]
            .as_array()
            .unwrap()
            .iter()
            .any(|change| change["kind"] == "glyphLayerUpdated")
    );
}

#[test]
fn glyph_batch_unicode_omission_preserves_and_empty_list_clears_assignments() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    drop(ShiftStore::create_document(&path, &sample_font()).unwrap());
    let output = shift_with_stdin(
        &[
            "glyph",
            "set",
            path.to_str().unwrap(),
            "--input",
            "-",
            "--json",
        ],
        r#"{"glyphs":[{"name":"A","unicodes":[]}]}"#,
    );
    assert!(output.status.success(), "{:?}", output.stderr);
    let font = load_font(path.to_str().unwrap());
    assert!(font.glyph_by_name("A").unwrap().unicodes().is_empty());
    assert_eq!(
        font.glyph_by_name("A").unwrap().layers(),
        sample_font().glyph_by_name("A").unwrap().layers()
    );
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["changes"][0]["kind"], "glyphUpdated");
    assert_eq!(report["changes"][0]["unicodes"], json!([]));
}

#[test]
fn batch_entry_failures_name_the_glyph_and_leave_all_canonical_bytes_unchanged() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    drop(ShiftStore::create_document(&path, &sample_font()).unwrap());
    let before = std::fs::read(&path).unwrap();
    for entry in [
        json!({"name":"broken", "source":"missing", "layer":{"advance":500}}),
        json!({"name":"broken", "unicodes":["U+D800"]}),
        json!({"name":"broken", "layer":{"advance":500,"svgPath":"M0 0 A10 10 0 0 1 20 20"}}),
        json!({"name":"broken", "layer":{"advance":500,"contours":[{"id":"caller-owned", "closed":true,"points":[]}]}}),
        json!({"name":"broken", "layer":{"advance":500,"anchors":[{"x":"bad","y":0}]}}),
    ] {
        let payload = json!({"glyphs":[{"name":"new","layer":{"advance":600}}, entry]});
        let output = shift_with_stdin(
            &[
                "glyph",
                "set",
                path.to_str().unwrap(),
                "--input",
                "-",
                "--json",
            ],
            &payload.to_string(),
        );
        assert!(!output.status.success());
        let report: Value = serde_json::from_slice(&output.stdout).unwrap();
        let summary = report["error"]["summary"].as_str().unwrap();
        assert!(
            summary.contains("broken") && summary.contains("entry 2"),
            "{report}"
        );
        assert_eq!(std::fs::read(&path).unwrap(), before);
        assert!(
            load_font(path.to_str().unwrap())
                .glyph_by_name("new")
                .is_none()
        );
    }
}

#[test]
fn batch_rejects_duplicate_resolved_sources_and_conflicting_unicode_assignments() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    let font = sample_font();
    let source_id = font.default_source_id().unwrap().to_string();
    drop(ShiftStore::create_document(&path, &font).unwrap());
    let before = std::fs::read(&path).unwrap();
    for payload in [
        json!({"glyphs":[{"name":"A"},{"name":"A","source":source_id}]}),
        json!({"glyphs":[{"name":"A","unicodes":["U+0041"]},{"name":"A","source":"Bold","unicodes":[]}]}),
    ] {
        let output = shift_with_stdin(
            &[
                "glyph",
                "set",
                path.to_str().unwrap(),
                "--input",
                "-",
                "--json",
            ],
            &payload.to_string(),
        );
        assert!(!output.status.success());
        let report: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert!(
            report["error"]["summary"]
                .as_str()
                .unwrap()
                .contains("entry 2")
        );
        assert_eq!(std::fs::read(&path).unwrap(), before);
    }
}

#[test]
fn batch_accepts_matching_unicode_assignments_across_distinct_sources() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    drop(ShiftStore::create_document(&path, &sample_font()).unwrap());
    let output = shift_with_stdin(
        &["glyph", "set", path.to_str().unwrap(), "--input", "-"],
        r#"{"glyphs":[{"name":"B","unicodes":["U+0042"],"layer":{"advance":500}},{"name":"B","source":"Bold","unicodes":["U+0042"],"layer":{"advance":600}}]}"#,
    );
    assert!(output.status.success(), "{:?}", output.stderr);
    let font = load_font(path.to_str().unwrap());
    assert_eq!(font.glyph_by_name("B").unwrap().unicodes(), &[0x42]);
    assert_eq!(font.glyph_by_name("B").unwrap().layers().len(), 2);
}

#[test]
fn mutation_dry_runs_validate_without_writing_either_document() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    let destination = temp.path().join("Variant.shift");
    drop(ShiftStore::create_document(&path, &sample_font()).unwrap());
    let before = std::fs::read(&path).unwrap();
    for (command, payload) in [
        (
            vec!["glyph", "set", path.to_str().unwrap(), "--input", "-"],
            r#"{"glyphs":[{"name":"B","layer":{"advance":500,"svgPath":"M0 0 L10 20"}}]}"#,
        ),
        (
            vec![
                "layer",
                "set",
                path.to_str().unwrap(),
                "--glyph",
                "A",
                "--source",
                "Regular",
                "--input",
                "-",
            ],
            r#"{"advance":500,"svgPath":"M0 0 L10 20"}"#,
        ),
    ] {
        let mut args = command;
        args.extend([
            "--dry-run",
            "--json",
            "--output",
            destination.to_str().unwrap(),
        ]);
        let output = shift_with_stdin(&args, payload);
        assert!(output.status.success(), "{:?}", output.stderr);
        let report: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(report["valid"], true);
        assert_eq!(report["wrote"], false);
        assert!(!report["changes"].as_array().unwrap().is_empty());
        assert_eq!(std::fs::read(&path).unwrap(), before);
        assert!(!destination.exists());
    }
}

#[test]
fn output_creates_an_independent_document_and_refuses_overwriting() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    let destination = temp.path().join("Variant.shift");
    drop(ShiftStore::create_document(&path, &sample_font()).unwrap());
    let before = std::fs::read(&path).unwrap();
    let args = [
        "glyph",
        "set",
        path.to_str().unwrap(),
        "--input",
        "-",
        "--output",
        destination.to_str().unwrap(),
    ];
    let payload = r#"{"glyphs":[{"name":"B","layer":{"advance":500}}]}"#;
    let output = shift_with_stdin(&args, payload);
    assert!(output.status.success(), "{:?}", output.stderr);
    assert_eq!(std::fs::read(&path).unwrap(), before);
    assert!(
        load_font(destination.to_str().unwrap())
            .glyph_by_name("B")
            .is_some()
    );
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
    assert!(!shift_with_stdin(&args, payload).status.success());
    assert_eq!(std::fs::read(destination).unwrap(), output_bytes);
    assert_eq!(std::fs::read(path).unwrap(), before);
}

#[test]
fn malformed_or_empty_batch_reports_json_location_or_validation_without_writing() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    drop(ShiftStore::create_document(&path, &sample_font()).unwrap());
    let before = std::fs::read(&path).unwrap();
    for (payload, expected) in [
        ("{\"glyphs\":[\n{", "line 2"),
        (r#"{"glyphs":[]}"#, "no glyphs"),
        (r#"{"glyphs":[{"name":" "}]}"#, "entry 1"),
    ] {
        let output = shift_with_stdin(
            &[
                "glyph",
                "set",
                path.to_str().unwrap(),
                "--input",
                "-",
                "--json",
            ],
            payload,
        );
        assert!(!output.status.success());
        let report: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert!(report.to_string().contains(expected), "{report}");
        assert_eq!(std::fs::read(&path).unwrap(), before);
    }
}
