#[allow(dead_code)]
mod support;

use support::shift;

const SOLENOID: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/fonts/Solenoid.shift"
);

fn stroke(args: &[&str]) -> std::process::Output {
    let mut command = vec!["glyph", "stroke"];
    command.extend(args);
    shift(&command)
}

#[test]
fn set_live_stroke_dry_run_reads_layer_payload_for_contours() {
    let output = stroke(&[
        "set-live-stroke",
        SOLENOID,
        "--glyph",
        "dot",
        "--width",
        "20",
        "--dry-run",
    ]);

    assert!(
        output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn stroke_preview_reports_live_outline_bounds_after_set() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("stroke-play.shift");
    std::fs::copy(SOLENOID, &path).unwrap();
    let document = path.to_str().unwrap();

    let attach = stroke(&[
        "set-live-stroke",
        document,
        "--glyph",
        "dot",
        "--width",
        "20",
    ]);
    assert!(
        attach.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&attach.stderr)
    );

    let preview = stroke(&["preview", document, "--glyph", "dot"]);
    assert!(
        preview.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&preview.stderr)
    );
    let stdout = String::from_utf8_lossy(&preview.stdout);
    assert!(
        stdout.contains("outlineCount"),
        "expected preview JSON, got {stdout:?}"
    );
}

#[test]
fn set_live_stroke_rejects_component_only_glyph() {
    let output = stroke(&[
        "set-live-stroke",
        SOLENOID,
        "--glyph",
        "H",
        "--width",
        "20",
        "--dry-run",
    ]);

    assert!(!output.status.success());
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("no contours"));
}

#[test]
fn set_live_stroke_takes_a_position_from_minus_one_to_one() {
    for position in ["-1", "-0.5", "0", "1"] {
        let output = stroke(&[
            "set-live-stroke",
            SOLENOID,
            "--glyph",
            "dot",
            "--width",
            "20",
            "--position",
            position,
            "--dry-run",
        ]);

        assert!(
            output.status.success(),
            "position {position}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}

#[test]
fn set_live_stroke_refuses_a_position_beyond_the_ends_and_says_why() {
    let output = stroke(&[
        "set-live-stroke",
        SOLENOID,
        "--glyph",
        "dot",
        "--width",
        "20",
        "--position",
        "1.5",
        "--dry-run",
    ]);

    assert!(!output.status.success());
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("between -1 and 1"), "{stderr}");
}
