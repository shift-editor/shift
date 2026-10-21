#[allow(dead_code)]
mod support;

mod proof_support;

use serde_json::{Value, json};
use shift_font::test_support::sample_variable_font;
use shift_store::ShiftStore;
use tiny_skia::Pixmap;

use proof_support::{count_pixels, create_box_font, glyph_advances, glyph_names, proof_json, rgb};
use support::shift;

const BLACK: [u8; 3] = [0, 0, 0];
const WHITE: [u8; 3] = [255, 255, 255];

#[test]
fn shapes_text_into_glyphs_and_draws_them_where_the_report_says() {
    let temp = tempfile::tempdir().unwrap();
    let font = temp.path().join("Box.shift");
    let image = temp.path().join("proof.png");
    create_box_font(&font);

    let report = proof_json(&[
        font.to_str().unwrap(),
        "--output",
        image.to_str().unwrap(),
        "--text",
        "HI",
        "--sizes",
        "100",
    ]);

    assert_eq!(report["format"], "png");
    assert_eq!(report["output"], image.to_str().unwrap());
    assert_eq!(report["missingCharacters"], json!([]));
    assert_eq!(report["locations"][0]["metrics"]["unitsPerEm"], 1000);
    let row = &report["rows"][0];
    assert_eq!(row["text"], "HI");
    assert_eq!(glyph_names(row), ["H", "I"]);
    assert_eq!(glyph_advances(row), [700.0, 300.0]);
    // At 100px per em one font unit is 0.1px.
    assert_eq!(row["width"], 100.0);

    let pixmap = Pixmap::load_png(&image).unwrap();
    assert_eq!(u64::from(pixmap.width()), report["width"].as_u64().unwrap());
    assert_eq!(
        u64::from(pixmap.height()),
        report["height"].as_u64().unwrap()
    );
    let x = row["x"].as_f64().unwrap();
    let baseline = row["baseline"].as_f64().unwrap();
    assert_eq!(rgb(&pixmap, x + 15.0, baseline - 35.0), BLACK, "H stem");
    assert_eq!(rgb(&pixmap, x + 35.0, baseline - 60.0), WHITE, "H counter");
    assert_eq!(rgb(&pixmap, x + 85.0, baseline - 35.0), BLACK, "I stem");
}

#[test]
fn reports_and_marks_characters_the_font_does_not_map() {
    let temp = tempfile::tempdir().unwrap();
    let font = temp.path().join("Box.shift");
    let image = temp.path().join("missing.png");
    create_box_font(&font);

    let report = proof_json(&[
        font.to_str().unwrap(),
        "--output",
        image.to_str().unwrap(),
        "--text",
        "HIx",
        "--text",
        "I H",
    ]);

    assert_eq!(
        report["missingCharacters"],
        json!([
            {"character": "x", "unicode": "U+0078"},
            {"character": " ", "unicode": "U+0020"},
        ])
    );
    assert_eq!(
        report["lines"][0]["missingCharacters"],
        json!([{"character": "x", "unicode": "U+0078"}])
    );
    let missing: Vec<bool> = report["rows"][0]["glyphs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|glyph| glyph["missing"].as_bool().unwrap())
        .collect();
    assert_eq!(missing, [false, false, true]);
    assert_eq!(report["rows"][0]["glyphs"][2]["glyphId"], 0);
    let pixmap = Pixmap::load_png(&image).unwrap();
    assert!(
        count_pixels(&pixmap, [220, 38, 38]) > 100,
        "missing glyphs are drawn as red placeholders"
    );

    let human = shift(&[
        "proof",
        font.to_str().unwrap(),
        "--output",
        image.to_str().unwrap(),
        "--text",
        "HIx",
    ]);
    assert!(human.status.success());
    let stdout = String::from_utf8(human.stdout).unwrap();
    assert!(
        stdout.contains("missing  1 characters (drawn red): x U+0078"),
        "{stdout}"
    );
}

#[test]
fn sets_a_waterfall_line_by_line_with_metric_guides() {
    let temp = tempfile::tempdir().unwrap();
    let font = temp.path().join("Box.shift");
    let image = temp.path().join("waterfall.png");
    create_box_font(&font);

    let report = proof_json(&[
        font.to_str().unwrap(),
        "--output",
        image.to_str().unwrap(),
        "--text",
        "HI",
        "--text",
        "IH",
        "--sizes",
        "24,64",
        "--metrics",
    ]);

    let rows: Vec<(&str, f64)> = report["rows"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| (row["text"].as_str().unwrap(), row["size"].as_f64().unwrap()))
        .collect();
    assert_eq!(
        rows,
        [("HI", 24.0), ("HI", 64.0), ("IH", 24.0), ("IH", 64.0)]
    );
    assert_eq!(glyph_names(&report["rows"][2]), ["I", "H"]);
    let guides: Vec<&str> = report["locations"][0]["guides"]
        .as_array()
        .unwrap()
        .iter()
        .map(|guide| guide["name"].as_str().unwrap())
        .collect();
    assert_eq!(
        guides,
        ["ascender", "capHeight", "xHeight", "baseline", "descender"]
    );

    // Guides sit behind the largest size only.
    let pixmap = Pixmap::load_png(&image).unwrap();
    let large = &report["rows"][1];
    let past_ink = large["x"].as_f64().unwrap() + large["width"].as_f64().unwrap() + 4.0;
    let large_baseline = large["baseline"].as_f64().unwrap().round();
    assert_eq!(
        rgb(&pixmap, past_ink, large_baseline),
        [0x1f, 0x77, 0xb4],
        "baseline guide"
    );
    let small_baseline = report["rows"][0]["baseline"].as_f64().unwrap().round();
    assert_eq!(rgb(&pixmap, past_ink, small_baseline), WHITE);
}

#[test]
fn infers_svg_from_the_output_extension() {
    let temp = tempfile::tempdir().unwrap();
    let font = temp.path().join("Box.shift");
    let image = temp.path().join("proof.svg");
    create_box_font(&font);

    let report = proof_json(&[
        font.to_str().unwrap(),
        "--output",
        image.to_str().unwrap(),
        "--text",
        "Hx",
        "--metrics",
    ]);

    assert_eq!(report["format"], "svg");
    let svg = std::fs::read_to_string(&image).unwrap();
    assert!(svg.starts_with("<svg xmlns=\"http://www.w3.org/2000/svg\""));
    assert!(svg.contains(&format!(
        "width=\"{}\" height=\"{}\"",
        report["width"], report["height"]
    )));
    assert!(svg.contains("<path class=\"ink\" fill=\"#000000\""));
    assert!(svg.contains("<path class=\"missing\""));
    assert!(svg.contains("class=\"guide-xHeight\""));
}

#[test]
fn shapes_at_a_user_space_location() {
    let temp = tempfile::tempdir().unwrap();
    let font = temp.path().join("Variable.shift");
    let image = temp.path().join("variable.png");
    drop(ShiftStore::create_document(&font, &sample_variable_font()).unwrap());

    let shaped_at = |weight: &str| -> Value {
        let report = proof_json(&[
            font.to_str().unwrap(),
            "--output",
            image.to_str().unwrap(),
            "--text",
            "A",
            "--sizes",
            "100",
            "--at",
            weight,
        ]);
        assert_eq!(report["locations"][0]["axes"][0]["tag"], "wght");
        report
    };

    // The advance interpolates from 600 at the default to 700 at wght=700.
    let regular = shaped_at("wght=400");
    let bold = shaped_at("wght=700");
    assert_eq!(glyph_advances(&regular["rows"][0]), [600.0]);
    assert_eq!(glyph_advances(&bold["rows"][0]), [700.0]);
    assert_eq!(bold["locations"][0]["axes"][0]["value"], 700.0);
    assert_eq!(bold["rows"][0]["width"], 70.0);

    let unknown = shift(&[
        "proof",
        font.to_str().unwrap(),
        "--output",
        image.to_str().unwrap(),
        // `--location` is a hidden alias of `--at`.
        "--location",
        "wdth=100",
    ]);
    assert!(!unknown.status.success());
    assert!(String::from_utf8_lossy(&unknown.stderr).contains("no \"wdth\" axis"));
}

#[test]
fn proofs_a_compiled_binary_as_it_is() {
    let temp = tempfile::tempdir().unwrap();
    let font = temp.path().join("Variable.shift");
    let binary = temp.path().join("Variable.ttf");
    let image = temp.path().join("binary.png");
    drop(ShiftStore::create_document(&font, &sample_variable_font()).unwrap());
    let compiled = shift(&[
        "compile",
        font.to_str().unwrap(),
        "--output",
        binary.to_str().unwrap(),
    ]);
    assert!(compiled.status.success());

    let report = proof_json(&[
        binary.to_str().unwrap(),
        "--output",
        image.to_str().unwrap(),
        "--text",
        "A",
        "--location",
        "wght=700",
    ]);

    assert_eq!(glyph_advances(&report["rows"][0]), [700.0]);
}

#[test]
fn refuses_to_proof_a_font_without_characters() {
    let temp = tempfile::tempdir().unwrap();
    let font = temp.path().join("Empty.shift");
    let image = temp.path().join("empty.png");
    assert!(
        shift(&["font", "create", font.to_str().unwrap()])
            .status
            .success()
    );

    let output = shift(&[
        "proof",
        font.to_str().unwrap(),
        "--output",
        image.to_str().unwrap(),
    ]);

    assert!(!output.status.success());
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("maps no characters"), "{stderr}");
    assert!(stderr.contains("glyph add"), "{stderr}");
    assert!(!image.exists());
}

#[test]
fn guides_use_the_authored_ascender_rather_than_padded_line_height() {
    let temp = tempfile::tempdir().unwrap();
    let font = temp.path().join("Box.shift");
    let image = temp.path().join("proof.png");
    create_box_font(&font);
    // fontc pads hhea.ascender to 800 + (1200 - 200 - 800) = 1000 here.
    let set = shift(&[
        "font",
        "set",
        font.to_str().unwrap(),
        "--ascender",
        "800",
        "--descender",
        "-200",
        "--line-gap",
        "0",
    ]);
    assert!(set.status.success(), "{:?}", set.stderr);

    let report = proof_json(&[
        font.to_str().unwrap(),
        "--output",
        image.to_str().unwrap(),
        "--text",
        "HI",
        "--metrics",
    ]);

    assert_eq!(report["locations"][0]["metrics"]["ascender"], 800.0);
    assert_eq!(report["locations"][0]["metrics"]["descender"], -200.0);
}
