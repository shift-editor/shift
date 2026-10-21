use skrifa::MetadataProvider;

use super::*;

fn repo_font(path: &str) -> Vec<u8> {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    std::fs::read(root.join(path)).expect("fixture font should exist")
}

fn inter() -> Vec<u8> {
    repo_font("packages/editor/src/ui/assets/fonts/Inter-VariableFont.ttf")
}

fn jetbrains_mono() -> Vec<u8> {
    repo_font("packages/editor/src/ui/assets/fonts/JetBrainsMono[wght].ttf")
}

fn weight(value: f32) -> Coordinates {
    Coordinates::User(vec![AxisValue {
        tag: "wght".to_string(),
        value,
    }])
}

fn options(features: &[&str], direction: Option<&str>) -> ShapingOptions {
    ShapingOptions {
        features: features.iter().map(|text| text.parse().unwrap()).collect(),
        direction: direction.map(|text| text.parse().unwrap()),
        ..ShapingOptions::default()
    }
}

fn names(font: &ProofFont, run: &ShapedRun) -> Vec<String> {
    font.glyph_reports(run)
        .into_iter()
        .map(|glyph| glyph.name.unwrap_or_default())
        .collect()
}

fn request(lines: &[&str], format: ImageFormat) -> ProofRequest {
    ProofRequest {
        lines: lines.iter().map(ToString::to_string).collect(),
        sizes: vec![48.0],
        format,
        ..ProofRequest::default()
    }
}

#[test]
fn shaping_at_a_heavier_location_widens_the_advance() {
    let data = inter();
    let light = ProofFont::new(&data, &weight(100.0)).unwrap();
    let heavy = ProofFont::new(&data, &weight(900.0)).unwrap();
    let plain = ShapingOptions::default();

    assert!(heavy.shape("H", &plain).advance > light.shape("H", &plain).advance);
    let wght = heavy
        .location()
        .iter()
        .find(|axis| axis.tag == "wght")
        .unwrap();
    assert_eq!(wght.value, 900.0);
}

#[test]
fn a_normalized_extreme_matches_the_user_maximum() {
    let data = inter();
    let user = ProofFont::new(&data, &weight(900.0)).unwrap();
    let normalized = ProofFont::new(
        &data,
        &Coordinates::Normalized(vec![AxisValue {
            tag: "wght".to_string(),
            value: 1.0,
        }]),
    )
    .unwrap();
    let plain = ShapingOptions::default();

    assert_eq!(
        normalized.shape("H", &plain).advance,
        user.shape("H", &plain).advance
    );
    let wght = normalized
        .location()
        .iter()
        .find(|axis| axis.tag == "wght")
        .unwrap();
    assert_eq!(wght.value, 900.0);
}

#[test]
fn kerning_applies_unless_the_feature_is_turned_off() {
    let data = inter();
    let font = ProofFont::new(&data, &Coordinates::default()).unwrap();
    let plain = ShapingOptions::default();
    let apart = font.shape("A", &plain).advance + font.shape("V", &plain).advance;

    let kerned = font.shape("AV", &plain).advance;
    let unkerned = font.shape("AV", &options(&["-kern"], None)).advance;

    assert!(
        kerned < apart,
        "AV {kerned} should kern tighter than {apart}"
    );
    assert_eq!(unkerned, apart);
}

#[test]
fn turning_off_contextual_alternates_unsets_a_code_ligature() {
    let data = jetbrains_mono();
    let font = ProofFont::new(&data, &Coordinates::default()).unwrap();

    let with = font.shape("->", &ShapingOptions::default());
    let without = font.shape("->", &options(&["-calt"], None));

    assert_eq!(names(&font, &without), ["hyphen", "greater"]);
    assert_ne!(names(&font, &with), names(&font, &without));
}

#[test]
fn right_to_left_text_runs_in_reverse_visual_order() {
    let data = inter();
    let font = ProofFont::new(&data, &Coordinates::default()).unwrap();

    let run = font.shape("Hi", &options(&[], Some("rtl")));

    assert_eq!(run.direction, TextDirection::RightToLeft);
    assert_eq!(names(&font, &run), ["i", "H"]);
    assert_eq!(run.glyphs[0].cluster, 1);
}

#[test]
fn names_place_glyphs_directly_and_unknown_names_are_missing() {
    let data = inter();
    let font = ProofFont::new(&data, &Coordinates::default()).unwrap();
    let plain = ShapingOptions::default();

    let run = font.set_line("H/a/nosuchglyph H", &plain);

    assert_eq!(names(&font, &run), ["H", "a", ".notdef", "H"]);
    let missing: Vec<bool> = run.glyphs.iter().map(|glyph| glyph.missing).collect();
    assert_eq!(missing, [false, false, true, false]);
    assert_eq!(
        run.glyphs[1].advance,
        font.advance_width(run.glyphs[1].glyph_id).unwrap()
    );
    assert_eq!(
        font.missing_glyph_names("H/a/nosuchglyph H"),
        ["nosuchglyph"]
    );
}

#[test]
fn names_are_placed_last_first_in_a_right_to_left_line() {
    let data = inter();
    let font = ProofFont::new(&data, &Coordinates::default()).unwrap();

    let run = font.set_line("H/a", &options(&[], Some("rtl")));

    assert_eq!(names(&font, &run), ["a", "H"]);
}

#[test]
fn an_unmapped_character_is_flagged_and_still_drawn() {
    let data = inter();
    let font = ProofFont::new(&data, &Coordinates::default()).unwrap();

    let run = font.shape("H\u{10FFFD}", &ShapingOptions::default());

    assert_eq!(font.missing_characters("H\u{10FFFD}"), ['\u{10FFFD}']);
    let missing = &run.glyphs[1];
    assert!(missing.missing);
    assert_eq!(missing.glyph_id, 0);
    assert!(!missing.segments.is_empty(), "a placeholder or .notdef ink");
}

#[test]
fn rejects_axes_the_font_does_not_have_or_values_outside_the_range() {
    let data = inter();
    let width = Coordinates::User(vec![AxisValue {
        tag: "wdth".to_string(),
        value: 100.0,
    }]);

    assert!(matches!(
        ProofFont::new(&data, &width),
        Err(ProofError::UnknownAxis { .. })
    ));
    assert!(matches!(
        ProofFont::new(&data, &weight(2000.0)),
        Err(ProofError::AxisOutOfRange { .. })
    ));
    assert!(matches!(
        "wght".parse::<AxisValue>(),
        Err(ProofError::InvalidLocation { .. })
    ));
    assert!(matches!(
        "ss01=x".parse::<FeatureSetting>(),
        Err(ProofError::InvalidFeature { .. })
    ));
    assert!(matches!(
        "sideways".parse::<TextDirection>(),
        Err(ProofError::InvalidDirection { .. })
    ));
}

#[test]
fn lists_every_named_instance_with_its_name() {
    let data = inter();
    let font = skrifa::FontRef::new(&data).unwrap();

    let instances = named_instances(&data).unwrap();

    assert_eq!(instances.len(), font.named_instances().len());
    assert!(
        instances
            .iter()
            .any(|instance| instance.label.as_deref() == Some("Bold"))
    );
}

#[test]
fn sets_each_line_at_every_location_stacked_for_comparison() {
    let data = inter();
    let mut proof = request(&["HH", "II"], ImageFormat::Svg);
    proof.locations = vec![
        ProofLocation::user(vec!["wght=100".parse().unwrap()]),
        ProofLocation::user(vec!["wght=900".parse().unwrap()]),
    ];

    let report = render_proof(&data, &proof).unwrap().report;

    let order: Vec<(usize, usize)> = report
        .rows
        .iter()
        .map(|row| (row.line, row.location))
        .collect();
    assert_eq!(order, [(0, 0), (0, 1), (1, 0), (1, 1)]);
    assert!(report.rows[1].width > report.rows[0].width);
    assert_eq!(report.locations[1].label, "wght 900");
}

#[test]
fn renders_svg_with_ink_paths_and_a_missing_path() {
    let data = inter();

    let proof = render_proof(&data, &request(&["Hi\u{10FFFD}"], ImageFormat::Svg)).unwrap();

    let svg = String::from_utf8(proof.image).unwrap();
    assert!(svg.starts_with("<svg xmlns=\"http://www.w3.org/2000/svg\""));
    assert!(svg.contains("<path class=\"ink\" fill=\"#000000\""));
    assert!(svg.contains("<path class=\"missing\""));
    assert_eq!(
        proof.report.missing_characters,
        [MissingCharacter {
            character: "\u{10FFFD}".to_string(),
            unicode: "U+10FFFD".to_string(),
        }]
    );
}

#[test]
fn renders_png_at_the_reported_size() {
    let data = inter();
    let mut proof = request(&["Hamburgefonstiv"], ImageFormat::Png);
    proof.width = Some(400);

    let proof = render_proof(&data, &proof).unwrap();

    let pixmap = tiny_skia::Pixmap::decode_png(&proof.image).unwrap();
    assert_eq!(pixmap.width(), 400);
    assert_eq!(pixmap.width(), proof.report.width);
    assert_eq!(pixmap.height(), proof.report.height);
}

#[test]
fn wraps_text_at_spaces_to_a_fixed_width() {
    let data = inter();
    let mut proof = request(&["one two three four five six"], ImageFormat::Svg);
    proof.width = Some(300);

    let report = render_proof(&data, &proof).unwrap().report;

    assert!(report.rows.len() > 1);
    let rejoined: Vec<&str> = report.rows.iter().map(|row| row.text.as_str()).collect();
    assert_eq!(rejoined.join(" "), "one two three four five six");
    assert!(report.rows.iter().all(|row| row.x + row.width <= 300.0));
}

#[test]
fn a_grid_names_each_requested_glyph_in_its_own_cell() {
    let data = inter();
    let mut proof = request(&["Ha /a /nosuchglyph"], ImageFormat::Svg);
    proof.mode = ProofMode::Grid;

    let report = render_proof(&data, &proof).unwrap().report;

    let labels: Vec<&str> = report.grids[0]
        .cells
        .iter()
        .map(|cell| cell.label.as_str())
        .collect();
    assert_eq!(labels, ["H", "a", "a", "nosuchglyph"]);
    assert!(report.grids[0].cells[3].glyph.missing);
    assert!(report.rows.is_empty());
}

#[test]
fn an_empty_grid_shows_every_glyph() {
    let data = jetbrains_mono();
    let font = ProofFont::new(&data, &Coordinates::default()).unwrap();
    let mut proof = request(&[], ImageFormat::Svg);
    proof.mode = ProofMode::Grid;

    let report = render_proof(&data, &proof).unwrap().report;

    assert_eq!(report.grids[0].cells.len(), font.glyph_count() as usize);
    assert_eq!(report.grids[0].cells[0].label, ".notdef");
}

#[test]
fn a_grid_is_set_at_one_size() {
    let data = inter();
    let mut proof = request(&[], ImageFormat::Svg);
    proof.mode = ProofMode::Grid;
    proof.sizes = vec![12.0, 20.0];

    assert!(matches!(
        render_proof(&data, &proof),
        Err(ProofError::MultipleGridSizes)
    ));
}
