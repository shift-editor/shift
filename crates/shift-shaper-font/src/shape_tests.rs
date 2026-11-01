use std::sync::Arc;

use shift_font::test_support::sample_variable_font;
use shift_font::{ExternalLocation, Font, Glyph};

use super::test_fonts::request_for;
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
    let compilation = ShaperFont::compile(&request_for(font).unwrap()).unwrap();
    assert!(
        compilation.diagnostics.is_empty(),
        "{:?}",
        compilation.diagnostics
    );
    LiveShaper::new(Arc::new(compilation.font.unwrap()), font.character_map()).unwrap()
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
                .map(|id| font.glyph(*id).unwrap().name().to_string());
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
fn turning_on_a_feature_that_is_off_by_default_applies_it() {
    let font = font_with(
        &[
            ("one", Some('1')),
            ("slash", Some('/')),
            ("two", Some('2')),
            ("onehalf", None),
        ],
        "feature frac { sub one slash two by onehalf; } frac;",
    );
    let location = ExternalLocation::new();
    let units = characters("1/2");
    let features = [FeatureSetting::parse("frac", 1).unwrap()];
    let shaper = shaper(&font);

    let plain = shaper.shape(&request(&units, &location)).unwrap();
    let fraction = shaper
        .shape(&ShapeRequest {
            features: &features,
            ..request(&units, &location)
        })
        .unwrap();

    assert_eq!(
        names_and_clusters(&font, &plain),
        vec![named("one", 0), named("slash", 1), named("two", 2)]
    );
    assert_eq!(
        names_and_clusters(&font, &fraction),
        vec![named("onehalf", 0)]
    );
}

#[test]
fn features_list_each_tag_once_with_names_and_defaults() {
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
         feature ccmp { sub a by a; } ccmp;
         feature liga { sub f i by f_i; } liga;
         feature ss01 {
             featureNames { name \"Single-storey a\"; };
             sub a by a.ss01;
         } ss01;",
    );

    let features: Vec<_> = shaper(&font)
        .features()
        .unwrap()
        .into_iter()
        .map(|feature| (feature.tag, feature.name, feature.default))
        .collect();

    assert_eq!(
        features,
        vec![
            (
                "ccmp".to_string(),
                Some("Glyph Composition".to_string()),
                FeatureDefault::Required
            ),
            (
                "liga".to_string(),
                Some("Standard Ligatures".to_string()),
                FeatureDefault::On
            ),
            (
                "ss01".to_string(),
                Some("Single-storey a".to_string()),
                FeatureDefault::Off
            ),
        ]
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

    assert!(state.update(request_for(&font).unwrap()).unwrap());
    assert!(!state.diagnostics().is_empty());

    let shaper = LiveShaper::new(state.font().cloned().unwrap(), font.character_map()).unwrap();
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
        script: None,
        language: None,
        features: &[],
    }
}

#[test]
fn an_arabic_paragraph_joins_and_reads_right_to_left() {
    let font = joining_font();
    let location = ExternalLocation::new();
    let units = characters("\u{0628}\u{0628}\u{0628}");

    let paragraph = shaper(&font)
        .shape_paragraph(&paragraph(&units, &location))
        .unwrap();
    let runs = &paragraph.runs;

    assert_eq!(paragraph.direction, TextDirection::RightToLeft);
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

/// A state over `font`, compiled once, and a shaper over its font.
fn compiled_state(font: &Font) -> ShaperFontState {
    let mut state = ShaperFontState::default();
    assert!(state.update(request_for(font).unwrap()).unwrap());
    assert_eq!(state.compiles(), 1);
    state
}

/// Brings `state` up to `font` and returns a shaper over its glyph order.
fn updated_shaper(state: &mut ShaperFontState, font: &Font) -> LiveShaper {
    state.update(request_for(font).unwrap()).unwrap();
    let mut shaper = LiveShaper::new(state.font().cloned().unwrap(), font.character_map()).unwrap();
    shaper.set_glyphs(state.glyph_order(), font.character_map());
    shaper
}

fn shaped_names(font: &Font, shaper: &LiveShaper, text: &str) -> Vec<(Option<String>, u32)> {
    let location = ExternalLocation::new();
    let units = characters(text);
    names_and_clusters(font, &shaper.shape(&request(&units, &location)).unwrap())
}

#[test]
fn adding_a_glyph_the_features_do_not_name_does_not_recompile() {
    let mut font = ligature_font();
    let mut state = compiled_state(&font);
    let mut added = Glyph::new("x");
    added.add_unicode(u32::from('x'));
    font.insert_glyph(added).unwrap();

    let shaper = updated_shaper(&mut state, &font);

    assert_eq!(state.compiles(), 1);
    // The added glyph lies past the compiled font's glyph count and shapes as
    // itself, beside a ligature the compiled lookups still form.
    assert_eq!(
        shaped_names(&font, &shaper, "fix"),
        vec![named("f_i", 0), named("x", 2)]
    );
}

#[test]
fn adding_the_glyph_the_features_name_recompiles() {
    let mut font = font_with(&[("f", Some('f')), ("i", Some('i'))], LIGATURE);
    let mut state = ShaperFontState::default();
    state.update(request_for(&font).unwrap()).unwrap();
    let before = state.compiles();
    font.insert_glyph(Glyph::new("f_i")).unwrap();

    let shaper = updated_shaper(&mut state, &font);

    assert_eq!(state.compiles(), before + 1);
    assert_eq!(shaped_names(&font, &shaper, "fi"), vec![named("f_i", 0)]);
}

#[test]
fn renaming_a_glyph_recompiles_only_when_the_features_name_it() {
    let mut font = font_with(
        &[
            ("f", Some('f')),
            ("i", Some('i')),
            ("f_i", None),
            ("x", Some('x')),
        ],
        LIGATURE,
    );
    let mut state = compiled_state(&font);

    let x = font.glyph_by_name("x").unwrap().id();
    font.rename_glyph(x, "ex".into()).unwrap();
    let shaper = updated_shaper(&mut state, &font);
    assert_eq!(state.compiles(), 1);
    assert_eq!(shaped_names(&font, &shaper, "x"), vec![named("ex", 0)]);

    // The feature code then names a glyph the font lacks: the compile fails
    // and the last font stays, shaping the renamed ligature.
    let ligature = font.glyph_by_name("f_i").unwrap().id();
    font.rename_glyph(ligature, "f_i.liga".into()).unwrap();
    let shaper = updated_shaper(&mut state, &font);
    assert!(!state.diagnostics().is_empty());
    assert_eq!(
        shaped_names(&font, &shaper, "fi"),
        vec![named("f_i.liga", 0)]
    );

    font.rename_glyph(ligature, "f_i".into()).unwrap();
    let shaper = updated_shaper(&mut state, &font);
    assert!(state.diagnostics().is_empty());
    assert_eq!(state.compiles(), 3);
    assert_eq!(shaped_names(&font, &shaper, "fi"), vec![named("f_i", 0)]);
}

#[test]
fn adding_a_mark_recompiles_for_its_class() {
    let mut font = ligature_font();
    let mut state = compiled_state(&font);
    let mut mark = Glyph::new("acutecomb");
    mark.add_unicode(0x0301);
    mark.set_category(Some(shift_font::GlyphCategory::Mark));
    mark.set_sub_category(Some(shift_font::GlyphSubcategory::Nonspacing));
    font.insert_glyph(mark).unwrap();

    updated_shaper(&mut state, &font);

    assert_eq!(state.compiles(), 2);
}

#[test]
fn a_removed_glyph_no_longer_shapes() {
    let mut font = font_with(
        &[
            ("f", Some('f')),
            ("i", Some('i')),
            ("f_i", None),
            ("x", Some('x')),
        ],
        LIGATURE,
    );
    let mut state = compiled_state(&font);
    let x = font.glyph_by_name("x").unwrap().id();
    font.pop_glyph(x).unwrap();

    let shaper = updated_shaper(&mut state, &font);

    assert_eq!(state.compiles(), 1);
    assert_eq!(shaped_names(&font, &shaper, "x"), vec![(None, 0)]);
}

#[test]
fn glyphs_the_font_classes_as_marks_are_flagged() {
    let mut font = font_with(&[("f", Some('f')), ("acute", Some('\u{301}'))], "");
    let acute = font.glyph_by_name("acute").unwrap().id();
    font.set_glyph_category(
        acute,
        Some(shift_font::GlyphCategory::Mark),
        Some(shift_font::GlyphSubcategory::Nonspacing),
    )
    .unwrap();
    let location = ExternalLocation::new();
    let units = characters("f\u{301}");

    let shaped = shaper(&font).shape(&request(&units, &location)).unwrap();

    let marks: Vec<bool> = shaped.iter().map(|glyph| glyph.is_mark).collect();
    assert_eq!(marks, [false, true]);
}

#[test]
fn an_english_word_in_arabic_is_its_own_left_to_right_run() {
    let font = font_with(
        &[
            ("a", Some('a')),
            ("beh-ar", Some('\u{0628}')),
            ("space", Some(' ')),
        ],
        "",
    );
    let location = ExternalLocation::new();
    let units = characters("\u{0628} a \u{0628}");

    let paragraph = shaper(&font)
        .shape_paragraph(&paragraph(&units, &location))
        .unwrap();

    let runs: Vec<_> = paragraph
        .runs
        .iter()
        .map(|run| (run.units.clone(), run.level))
        .collect();
    assert_eq!(paragraph.direction, TextDirection::RightToLeft);
    assert_eq!(runs, [(0..2, 1), (2..3, 2), (3..5, 1)]);
}

/// Whether shaping `text` in `script` with `tag` set to `setting` (left
/// to the shaper's default when `None`) applies `tag`, in a font whose only
/// rule is `tag` substituting each character's glyph with its `.alt`.
fn harfrust_applies(tag: &str, script: &str, text: char, setting: Option<u32>) -> bool {
    let name = format!("u{:04X}", u32::from(text));
    let alternate = format!("{name}.alt");
    let script_tag = match script {
        "Arab" => "arab",
        _ => "latn",
    };
    let font = font_with(
        &[(name.as_str(), Some(text)), (alternate.as_str(), None)],
        &format!(
            "languagesystem DFLT dflt;
             languagesystem {script_tag} dflt;
             feature {tag} {{ sub {name} by {alternate}; }} {tag};"
        ),
    );
    let location = ExternalLocation::new();
    let units = [ShapeUnit::Character(text)];
    let features: Vec<FeatureSetting> = setting
        .map(|value| FeatureSetting::parse(tag, value).unwrap())
        .into_iter()
        .collect();
    let shaped = shaper(&font)
        .shape(&ShapeRequest {
            script: Some(script),
            features: &features,
            ..request(&units, &location)
        })
        .unwrap();
    names_and_clusters(&font, &shaped) == [named(&alternate, 0)]
}

/// Checks shift-shape's table of the features the shaper applies by default
/// (`FeatureDefault::of`) against what HarfRust does, which lists them only
/// privately: each substitution feature, shaped with nothing set, applies
/// exactly when the table says `Required` or `On`, and text setting it
/// wins either way, as `FeatureDefault::applies` says.
#[test]
fn the_default_feature_table_matches_what_harfrust_applies() {
    // Substitution features, each in a script that reaches it with one character.
    let cases: [(&str, &str, char); 17] = [
        ("ccmp", "Latn", 'a'),
        ("locl", "Latn", 'a'),
        ("rlig", "Latn", 'a'),
        ("rclt", "Latn", 'a'),
        ("rvrn", "Latn", 'a'),
        ("calt", "Latn", 'a'),
        ("clig", "Latn", 'a'),
        ("liga", "Latn", 'a'),
        ("isol", "Arab", '\u{628}'),
        ("dlig", "Latn", 'a'),
        ("ss01", "Latn", 'a'),
        ("smcp", "Latn", 'a'),
        ("salt", "Latn", 'a'),
        ("onum", "Latn", 'a'),
        ("swsh", "Latn", 'a'),
        ("hist", "Latn", 'a'),
        ("case", "Latn", 'a'),
    ];

    for (tag, script, text) in cases {
        let default = FeatureDefault::of(Tag::new_checked(tag.as_bytes()).unwrap());
        for setting in [None, Some(0), Some(1)] {
            assert_eq!(
                harfrust_applies(tag, script, text, setting),
                default.applies(setting),
                "{tag} ({default:?}) set to {setting:?}"
            );
        }
    }
}
