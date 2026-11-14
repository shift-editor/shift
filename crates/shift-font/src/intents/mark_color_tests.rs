use crate::test_support::sample_font;
use crate::{
    CoreError, Font, FontChange, FontIntentSet, GlyphId, MarkColor, NamedMarkColor, Rgba,
    SetMarkColor,
};

const RED: Option<MarkColor> = Some(MarkColor::Named(NamedMarkColor::Red));
const TEAL: Option<MarkColor> = Some(MarkColor::Custom(Rgba {
    red: 0.0,
    green: 0.5,
    blue: 0.5,
    alpha: 1.0,
}));

fn colors(font: &Font, glyph_ids: &[GlyphId]) -> Vec<Option<MarkColor>> {
    glyph_ids
        .iter()
        .map(|id| font.glyph(*id).unwrap().mark_color())
        .collect()
}

/// The sample font with `acute` already tagged teal, and the ids of `A` and
/// `acute`.
fn font_with_teal_acute() -> (Font, [GlyphId; 2]) {
    let mut font = sample_font();
    let ids = ["A", "acute"].map(|name| font.glyph_by_name(name).unwrap().id());
    font.set_mark_color(&ids[1..], TEAL).unwrap();
    (font, ids)
}

#[test]
fn tagging_several_glyphs_is_one_change_set_that_undoes_to_each_glyphs_own_colour() {
    let (mut font, ids) = font_with_teal_acute();

    let applied = font
        .apply_intents(&FontIntentSet::from(SetMarkColor {
            glyph_ids: ids.to_vec(),
            color: RED,
        }))
        .unwrap();

    assert_eq!(colors(&font, &ids), [RED, RED]);
    assert_eq!(applied.changes.changes.len(), 2);
    assert!(
        applied
            .changes
            .changes
            .iter()
            .all(|change| matches!(change, FontChange::Glyph(_)))
    );
    assert!(applied.layers.is_empty());

    font.apply_change_set(&applied.changes.inverted()).unwrap();
    assert_eq!(colors(&font, &ids), [None, TEAL]);

    font.apply_change_set(&applied.changes).unwrap();
    assert_eq!(colors(&font, &ids), [RED, RED]);
}

#[test]
fn no_colour_clears_the_tag() {
    let (mut font, ids) = font_with_teal_acute();

    font.apply_intents(&FontIntentSet::from(SetMarkColor {
        glyph_ids: ids.to_vec(),
        color: None,
    }))
    .unwrap();

    assert_eq!(colors(&font, &ids), [None, None]);
}

#[test]
fn tagging_glyphs_with_the_colour_they_have_changes_nothing() {
    let (mut font, ids) = font_with_teal_acute();

    let applied = font
        .apply_intents(&FontIntentSet::from(SetMarkColor {
            glyph_ids: vec![ids[1]],
            color: TEAL,
        }))
        .unwrap();

    assert!(applied.changes.changes.is_empty());
}

#[test]
fn a_missing_glyph_or_a_colour_out_of_range_leaves_every_glyph_as_it_was() {
    let (mut font, ids) = font_with_teal_acute();
    let missing = GlyphId::new();
    let too_bright = Rgba {
        red: 1.5,
        green: 0.0,
        blue: 0.0,
        alpha: 1.0,
    };

    let no_glyph = font.apply_intents(&FontIntentSet::from(SetMarkColor {
        glyph_ids: vec![ids[0], missing],
        color: RED,
    }));
    let out_of_range = font.apply_intents(&FontIntentSet::from(SetMarkColor {
        glyph_ids: ids.to_vec(),
        color: Some(MarkColor::Custom(too_bright)),
    }));

    assert!(matches!(no_glyph, Err(CoreError::GlyphNotFound(id)) if id == missing));
    assert!(
        matches!(out_of_range, Err(CoreError::MarkColorOutOfRange(color)) if color == too_bright)
    );
    assert_eq!(colors(&font, &ids), [None, TEAL]);
}
