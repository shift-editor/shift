use std::sync::Arc;

use crate::shape::GlyphPosition;
use shift_font::{ExternalLocation, Font, Glyph};

use super::test_fonts::request_for;
use super::*;

/// Records what each generated feature saw, and moves the first glyph by
/// `shift` for kern.
#[derive(Default)]
struct Recorder {
    /// Each feature run, with the first glyph's advance when it ran.
    runs: Vec<(String, i32)>,
    shift: i32,
}

impl GeneratedPositioning for Recorder {
    fn position(
        &mut self,
        feature: Tag,
        glyphs: &PositioningGlyphs<'_>,
        positions: &mut [GlyphPosition],
    ) {
        assert_eq!(glyphs.len(), positions.len());
        self.runs
            .push((feature.to_string(), positions[0].x_advance));
        if feature == Tag::new(b"kern") {
            positions[0].x_advance += self.shift;
        }
    }
}

/// A font with A and V, mapped to their characters, and `feature_source`.
fn av_font(feature_source: &str) -> Font {
    let mut font = Font::new();
    for character in ['A', 'V'] {
        let mut glyph = Glyph::new(character.to_string());
        glyph.add_unicode(u32::from(character));
        font.insert_glyph(glyph).unwrap();
    }
    font.features_mut()
        .set_fea_source(Some(feature_source.to_string()));
    font
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

/// Shapes "AV" with `recorder` and returns the first glyph's final advance.
fn shape_av(font: &Font, features: &[FeatureSetting], recorder: &mut Recorder) -> i32 {
    let units: Vec<ShapeUnit> = "AV".chars().map(ShapeUnit::Character).collect();
    let location = ExternalLocation::new();
    let request = ShapeRequest {
        units: &units,
        location: &location,
        direction: None,
        script: None,
        language: None,
        features,
    };
    shaper(font).shape_positioned(&request, recorder).unwrap()[0].x_advance
}

fn ran(feature: &str, advance: i32) -> (String, i32) {
    (feature.to_string(), advance)
}

#[test]
fn a_marked_feature_runs_before_the_lookup_its_marker_precedes() {
    let font = av_font("feature kern {\n# Automatic Code\npos A V -50;\n} kern;");
    let mut recorder = Recorder {
        shift: 100,
        ..Recorder::default()
    };

    let advance = shape_av(&font, &[], &mut recorder);

    // kern sees A before the authored pair, and the authored pair applies
    // to what kern left; the unmarked features run after it.
    assert_eq!(
        recorder.runs,
        [
            ran("kern", 0),
            ran("curs", 50),
            ran("mark", 50),
            ran("mkmk", 50)
        ]
    );
    assert_eq!(advance, 50);
}

#[test]
fn a_marker_past_the_last_lookup_runs_at_the_end_of_positioning() {
    let font = av_font("feature kern {\npos A V -50;\n# Automatic Code\n} kern;");
    let mut recorder = Recorder {
        shift: 100,
        ..Recorder::default()
    };

    let advance = shape_av(&font, &[], &mut recorder);

    assert_eq!(recorder.runs[0], ran("kern", -50));
    assert_eq!(advance, 50);
}

#[test]
fn unmarked_features_run_after_every_authored_lookup_in_insertion_order() {
    let font = av_font("feature dist {\npos A V -50;\n} dist;");
    let mut recorder = Recorder::default();

    shape_av(&font, &[], &mut recorder);

    assert_eq!(
        recorder.runs,
        [
            ran("curs", -50),
            ran("kern", -50),
            ran("mark", -50),
            ran("mkmk", -50),
        ]
    );
}

#[test]
fn a_feature_the_request_turns_off_does_not_run() {
    let font = av_font("feature kern {\n# Automatic Code\npos A V -50;\n} kern;");
    let mut recorder = Recorder {
        shift: 100,
        ..Recorder::default()
    };
    let off = [FeatureSetting::parse("kern", 0).unwrap()];

    let advance = shape_av(&font, &off, &mut recorder);

    assert_eq!(
        recorder.runs,
        [ran("curs", 0), ran("mark", 0), ran("mkmk", 0)]
    );
    assert_eq!(advance, 0);
}

#[test]
fn a_font_whose_features_position_nothing_still_runs_every_generated_feature() {
    let font = av_font("");
    let mut recorder = Recorder::default();

    shape_av(&font, &[], &mut recorder);

    assert_eq!(
        recorder.runs,
        [
            ran("curs", 0),
            ran("kern", 0),
            ran("mark", 0),
            ran("mkmk", 0)
        ]
    );
}
