//! A glyph's mark colour survives saving and reopening a document, and
//! follows the change sets that set and undo it.

use shift_font::test_support::sample_font;
use shift_font::{
    CoreResult, Font, FontIntentSet, Glyph, MarkColor, NamedMarkColor, Rgba, SetMarkColor,
};
use shift_store::ShiftStore;

const PURPLE: Option<MarkColor> = Some(MarkColor::Named(NamedMarkColor::Purple));
const TEAL: Option<MarkColor> = Some(MarkColor::Custom(Rgba {
    red: 0.0,
    green: 0.5,
    blue: 0.5,
    alpha: 0.75,
}));

/// The colours of the sample font's `A` and `acute`.
fn sample_colors(font: &Font) -> [Option<MarkColor>; 2] {
    ["A", "acute"].map(|name| font.glyph_by_name(name).and_then(Glyph::mark_color))
}

/// Tags `A` and then `acute`, each with its own colour, as two edits.
fn tagged(
    font: &mut Font,
    colors: [Option<MarkColor>; 2],
) -> CoreResult<Vec<shift_font::FontChangeSet>> {
    ["A", "acute"]
        .into_iter()
        .zip(colors)
        .map(|(name, color)| {
            let glyph_ids = font
                .glyph_by_name(name)
                .map(Glyph::id)
                .into_iter()
                .collect();
            let tag = FontIntentSet::from(SetMarkColor { glyph_ids, color });
            Ok(font.apply_intents(&tag)?.changes)
        })
        .collect()
}

#[test]
fn named_and_custom_colours_round_trip_through_a_document() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Tagged.shift");
    let mut font = sample_font();
    tagged(&mut font, [PURPLE, TEAL]).unwrap();
    drop(ShiftStore::create_document(&path, &font).unwrap());

    let loaded = ShiftStore::open_document(&path)
        .unwrap()
        .load_font_state()
        .unwrap();

    assert_eq!(sample_colors(&loaded), [PURPLE, TEAL]);
}

#[test]
fn tagging_change_sets_and_their_undo_are_stored() {
    let mut store = ShiftStore::open_memory_for_test().unwrap();
    let mut font = sample_font();
    store.replace_font_state(&font).unwrap();
    let edits = tagged(&mut font, [PURPLE, TEAL]).unwrap();

    for edit in &edits {
        store.apply_change_set(edit).unwrap();
    }
    assert_eq!(
        sample_colors(&store.load_font_state().unwrap()),
        [PURPLE, TEAL]
    );

    store.apply_change_set(&edits[1].inverted()).unwrap();
    assert_eq!(
        sample_colors(&store.load_font_state().unwrap()),
        [PURPLE, None]
    );
}
