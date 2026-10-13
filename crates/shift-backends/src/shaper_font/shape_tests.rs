use std::sync::Arc;

use shift_font::test_support::sample_variable_font;
use shift_font::{ExternalLocation, Font, Glyph, GlyphCategory, GlyphSubcategory};

use super::*;

const LIGATURE: &str = "feature liga { sub f i by f_i; } liga;";

/// A font with one glyph per entry, mapped to its character when it has one.
fn font_with(glyphs: &[(&str, Option<char>)], feature_source: &str) -> Font {
    let mut font = Font::new();
    for (name, character) in glyphs {
        let mut glyph = Glyph::new(*name);
        if let Some(character) = character {
            glyph.add_unicode(u32::from(*character));
        }
        font.insert_glyph(glyph).unwrap();
    }
    font.features_mut()
        .set_fea_source(Some(feature_source.to_string()));
    font
}

fn ligature_font() -> Font {
    font_with(
        &[("f", Some('f')), ("i", Some('i')), ("f_i", None)],
        LIGATURE,
    )
}

fn shaper(font: &Font) -> LiveShaper {
    let compilation = ShaperFont::compile(&ShaperFontRequest::from_font(font).unwrap()).unwrap();
    assert!(
        compilation.diagnostics.is_empty(),
        "{:?}",
        compilation.diagnostics
    );
    LiveShaper::new(Arc::new(compilation.font.unwrap()), font)
}

fn characters(text: &str) -> Vec<ShapeUnit> {
    text.chars().map(ShapeUnit::Character).collect()
}

fn inserted(font: &Font, name: &str) -> ShapeUnit {
    ShapeUnit::Glyph(font.glyph_by_name(name).unwrap().id())
}

fn request<'a>(units: &'a [ShapeUnit], location: &'a ExternalLocation) -> ShapeRequest<'a> {
    ShapeRequest {
        units,
        location,
        direction: None,
        script: None,
        language: None,
        features: &[],
    }
}

/// Each shaped glyph's name, or `None` for a character with no glyph, and
/// its cluster.
fn names_and_clusters(font: &Font, shaped: &[ShapedGlyph]) -> Vec<(Option<String>, u32)> {
    shaped
        .iter()
        .map(|glyph| {
            let name = glyph
                .glyph_id
                .as_ref()
                .map(|id| font.glyph(id).unwrap().name().to_string());
            (name, glyph.cluster)
        })
        .collect()
}

fn named(name: &str, cluster: u32) -> (Option<String>, u32) {
    (Some(name.to_string()), cluster)
}

#[test]
fn ligature_returns_the_shift_glyph_at_the_first_cluster() {
    let font = ligature_font();
    let location = ExternalLocation::new();
    let units = characters("fi");

    let shaped = shaper(&font).shape(&request(&units, &location)).unwrap();

    assert_eq!(names_and_clusters(&font, &shaped), vec![named("f_i", 0)]);
    assert_eq!(shaped[0].x_advance, 0);
}

#[test]
fn turning_a_feature_off_keeps_the_characters() {
    let font = ligature_font();
    let location = ExternalLocation::new();
    let units = characters("fi");
    let features = [FeatureSetting::parse("liga", 0).unwrap()];

    let shaped = shaper(&font)
        .shape(&ShapeRequest {
            features: &features,
            ..request(&units, &location)
        })
        .unwrap();

    assert_eq!(
        names_and_clusters(&font, &shaped),
        vec![named("f", 0), named("i", 1)]
    );
}

#[test]
fn inserted_glyphs_shape_as_themselves() {
    let font = ligature_font();
    let location = ExternalLocation::new();
    let shaper = shaper(&font);

    let ligature = [inserted(&font, "f_i")];
    let mixed = [ShapeUnit::Character('f'), inserted(&font, "i")];

    let alone = shaper.shape(&request(&ligature, &location)).unwrap();
    let substituted = shaper.shape(&request(&mixed, &location)).unwrap();

    assert_eq!(names_and_clusters(&font, &alone), vec![named("f_i", 0)]);
    assert_eq!(
        names_and_clusters(&font, &substituted),
        vec![named("f_i", 0)]
    );
}

#[test]
fn a_character_without_a_glyph_has_no_glyph_id() {
    let font = ligature_font();
    let location = ExternalLocation::new();
    let units = characters("fx");

    let shaped = shaper(&font).shape(&request(&units, &location)).unwrap();

    assert_eq!(
        names_and_clusters(&font, &shaped),
        vec![named("f", 0), (None, 1)]
    );
}

#[test]
fn right_to_left_runs_come_back_in_visual_order() {
    let font = font_with(&[("a", Some('a')), ("b", Some('b'))], "");
    let location = ExternalLocation::new();
    let units = characters("ab");

    let shaped = shaper(&font)
        .shape(&ShapeRequest {
            direction: Some(TextDirection::RightToLeft),
            ..request(&units, &location)
        })
        .unwrap();

    assert_eq!(
        names_and_clusters(&font, &shaped),
        vec![named("b", 1), named("a", 0)]
    );
}

#[test]
fn language_selects_its_localized_forms() {
    let font = font_with(
        &[("i", Some('i')), ("i.loclTRK", None)],
        "languagesystem DFLT dflt; languagesystem latn dflt; languagesystem latn TRK;\n\
         feature locl { script latn; language TRK; sub i by i.loclTRK; } locl;",
    );
    let location = ExternalLocation::new();
    let units = characters("i");
    let shaper = shaper(&font);

    let default = shaper.shape(&request(&units, &location)).unwrap();
    let turkish = shaper
        .shape(&ShapeRequest {
            language: Some("tr"),
            ..request(&units, &location)
        })
        .unwrap();

    assert_eq!(names_and_clusters(&font, &default), vec![named("i", 0)]);
    assert_eq!(
        names_and_clusters(&font, &turkish),
        vec![named("i.loclTRK", 0)]
    );
}

#[test]
fn variable_positions_follow_the_axis_mapping() {
    let mut font = sample_variable_font();
    font.features_mut().set_fea_source(Some(
        "feature kern { pos A A (wght=400:-50 wght=900:-90); } kern;".to_string(),
    ));
    let weight = font.axes()[0].id();
    let shaper = shaper(&font);
    let units = characters("AA");
    let kern_at = |location: &ExternalLocation| {
        shaper.shape(&request(&units, location)).unwrap()[0].x_advance
    };

    let mut mapped = ExternalLocation::new();
    // The sample maps user 700 to design 600, halfway from its default of 400
    // to its maximum of 800; unmapped, 700 would be three fifths of the way.
    mapped.set(weight, 700.0);

    assert_eq!(kern_at(&ExternalLocation::new()), -50);
    assert_eq!(kern_at(&mapped), -70);
}

#[test]
fn state_shapes_without_features_until_the_source_first_compiles() {
    let font = font_with(
        &[("f", Some('f')), ("i", Some('i')), ("f_i", None)],
        "feature liga {",
    );
    let mut state = ShaperFontState::default();

    assert!(state
        .update(ShaperFontRequest::from_font(&font).unwrap())
        .unwrap());
    assert!(!state.diagnostics().is_empty());

    let shaper = LiveShaper::new(state.font().cloned().unwrap(), &font);
    let location = ExternalLocation::new();
    let units = characters("fi");
    let shaped = shaper.shape(&request(&units, &location)).unwrap();

    assert_eq!(
        names_and_clusters(&font, &shaped),
        vec![named("f", 0), named("i", 1)]
    );
}

/// Beh (U+0628) with isolated, initial, medial, and final forms, and `a`.
fn joining_font() -> Font {
    font_with(
        &[
            ("a", Some('a')),
            ("beh-ar", Some('\u{0628}')),
            ("beh-ar.init", None),
            ("beh-ar.medi", None),
            ("beh-ar.fina", None),
        ],
        "languagesystem DFLT dflt;
         languagesystem arab dflt;
         feature init { sub beh-ar by beh-ar.init; } init;
         feature medi { sub beh-ar by beh-ar.medi; } medi;
         feature fina { sub beh-ar by beh-ar.fina; } fina;",
    )
}

fn paragraph<'a>(units: &'a [ShapeUnit], location: &'a ExternalLocation) -> ParagraphRequest<'a> {
    ParagraphRequest {
        units,
        location,
        language: None,
        features: &[],
    }
}

#[test]
fn an_arabic_paragraph_joins_and_reads_right_to_left() {
    let font = joining_font();
    let location = ExternalLocation::new();
    let units = characters("\u{0628}\u{0628}\u{0628}");

    let runs = shaper(&font)
        .shape_paragraph(&paragraph(&units, &location))
        .unwrap()
        .runs;

    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].script.as_deref(), Some("Arab"));
    assert_eq!(runs[0].direction, TextDirection::RightToLeft);
    assert_eq!(
        names_and_clusters(&font, &runs[0].glyphs),
        vec![
            named("beh-ar.fina", 2),
            named("beh-ar.medi", 1),
            named("beh-ar.init", 0),
        ]
    );
}

#[test]
fn a_mixed_paragraph_splits_into_runs_with_paragraph_clusters() {
    let font = joining_font();
    let location = ExternalLocation::new();
    let units = characters("a \u{0628}\u{0628}");

    let runs = shaper(&font)
        .shape_paragraph(&paragraph(&units, &location))
        .unwrap()
        .runs;

    let summary: Vec<_> = runs
        .iter()
        .map(|run| (run.units.clone(), run.direction))
        .collect();
    assert_eq!(
        summary,
        vec![
            (0..2, TextDirection::LeftToRight),
            (2..4, TextDirection::RightToLeft),
        ]
    );
    assert_eq!(
        names_and_clusters(&font, &runs[1].glyphs),
        vec![named("beh-ar.fina", 3), named("beh-ar.init", 2)]
    );
}

#[test]
fn digits_inside_an_arabic_paragraph_shape_left_to_right() {
    let font = joining_font();
    let location = ExternalLocation::new();
    let units = characters("\u{0628} 12");

    let paragraph = shaper(&font)
        .shape_paragraph(&paragraph(&units, &location))
        .unwrap();

    assert_eq!(paragraph.direction, TextDirection::RightToLeft);
    let runs: Vec<_> = paragraph
        .runs
        .iter()
        .map(|run| {
            let clusters: Vec<u32> = run.glyphs.iter().map(|glyph| glyph.cluster).collect();
            (run.level, clusters)
        })
        .collect();
    assert_eq!(runs, vec![(1, vec![1, 0]), (2, vec![2, 3])]);
}

#[test]
fn features_list_each_tag_once_with_stylistic_set_names() {
    let font = font_with(
        &[
            ("a", Some('a')),
            ("a.ss01", None),
            ("f", Some('f')),
            ("i", Some('i')),
            ("f_i", None),
        ],
        "languagesystem DFLT dflt;
         languagesystem latn dflt;
         feature liga { sub f i by f_i; } liga;
         feature ss01 {
             featureNames { name \"Single-storey a\"; };
             sub a by a.ss01;
         } ss01;",
    );

    let features = shaper(&font).font().features().unwrap();

    assert_eq!(
        features,
        vec![
            FontFeature {
                tag: "liga".to_string(),
                name: None,
            },
            FontFeature {
                tag: "ss01".to_string(),
                name: Some("Single-storey a".to_string()),
            },
        ]
    );
}

#[test]
fn glyphs_the_font_classes_as_marks_are_flagged() {
    let mut font = font_with(&[("f", Some('f')), ("acute", Some('\u{301}'))], "");
    let acute = font.glyph_by_name("acute").unwrap().id();
    font.set_glyph_category(
        acute,
        Some(GlyphCategory::Mark),
        Some(GlyphSubcategory::Nonspacing),
    )
    .unwrap();
    let location = ExternalLocation::new();
    let units = characters("f\u{301}");

    let shaped = shaper(&font).shape(&request(&units, &location)).unwrap();

    let marks: Vec<bool> = shaped.iter().map(|glyph| glyph.is_mark).collect();
    assert_eq!(marks, [false, true]);
}

#[test]
fn glyph_names_generate_features_the_code_does_not_write() {
    let font = font_with(
        &[
            ("f", Some('f')),
            ("i", Some('i')),
            ("f_i", None),
            ("a", Some('a')),
            ("a.ss01", None),
        ],
        "",
    );
    let location = ExternalLocation::new();
    let shaper = shaper(&font);
    let ligature = characters("fi");
    let alternate = characters("a");
    let ss01 = [FeatureSetting::parse("ss01", 1).unwrap()];

    let joined = shaper.shape(&request(&ligature, &location)).unwrap();
    let plain = shaper.shape(&request(&alternate, &location)).unwrap();
    let styled = shaper
        .shape(&ShapeRequest {
            features: &ss01,
            ..request(&alternate, &location)
        })
        .unwrap();

    assert_eq!(names_and_clusters(&font, &joined), vec![named("f_i", 0)]);
    assert_eq!(names_and_clusters(&font, &plain), vec![named("a", 0)]);
    assert_eq!(names_and_clusters(&font, &styled), vec![named("a.ss01", 0)]);
}

#[test]
fn a_feature_written_in_code_replaces_the_generated_one() {
    let font = font_with(
        &[
            ("f", Some('f')),
            ("i", Some('i')),
            ("f_i", None),
            ("x", None),
        ],
        "feature liga { sub f i by x; } liga;",
    );
    let location = ExternalLocation::new();
    let units = characters("fi");

    let shaped = shaper(&font).shape(&request(&units, &location)).unwrap();

    assert_eq!(names_and_clusters(&font, &shaped), vec![named("x", 0)]);
}
