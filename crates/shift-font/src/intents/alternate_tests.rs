//! Alternates and component conditions edited through intents.
//!
//! Alternates are tried on `conditions_font`: `dollar` has `compact-heavy`
//! (Weight ≥ 700, Width ≤ 80) then `heavy` (Weight ≥ 700). Component
//! conditions are set on `glyph_axis_font`'s `H`: two `dot` components in
//! its Regular, Bled and Bleed 50 drawings.

use crate::test_support::{conditions_font, glyph_axis_font};
use crate::{
    AddGlyphAlternate, AlternateId, AxisId, Component, Condition, ConditionRange, CoreError,
    DesignLocation, EditGlyphAlternate, Font, FontIntentSet, GlyphAlternate, GlyphAlternateEdit,
    GlyphId, LayerId, ReplaceGlyphLayerContent, SetComponentCondition, SetGlyphAlternates,
};

fn glyph(font: &Font, name: &str) -> GlyphId {
    font.glyph_by_name(name).unwrap().id()
}

fn axis(font: &Font, tag: &str) -> AxisId {
    font.axis_id_by_tag(tag).unwrap()
}

fn from(font: &Font, tag: &str, min: f64) -> Condition {
    Condition::all([ConditionRange::new(axis(font, tag), Some(min), None)])
}

/// The name of the glyph drawn for `dollar` at Weight `weight`, Width `width`.
fn drawn_dollar(font: &Font, weight: f64, width: f64) -> String {
    let location =
        DesignLocation::from([(axis(font, "wght"), weight), (axis(font, "wdth"), width)]);
    let drawn = font.drawn_glyph_at(glyph(font, "dollar"), &location);
    font.glyph(drawn).unwrap().name().to_string()
}

/// `dollar`'s alternates, as the raw ids they were made with.
fn dollar_alternates(font: &Font) -> Vec<String> {
    font.glyph_by_name("dollar")
        .unwrap()
        .alternates()
        .iter()
        .map(|alternate| {
            let id = alternate.id().as_str();
            id.strip_prefix("alternate_").unwrap_or(id).to_string()
        })
        .collect()
}

/// Applies `set`, then checks that undoing it restores the font and redoing
/// it brings the edit back. Returns the edited font.
fn apply_undo_redo(font: &mut Font, set: impl Into<FontIntentSet>) -> Font {
    let before = font.clone();
    let applied = font.apply_intents(&set.into()).unwrap();
    let after = font.clone();

    font.apply_change_set(&applied.changes.inverted()).unwrap();
    assert_eq!(*font, before, "undo restores the font");
    font.apply_change_set(&applied.changes).unwrap();
    assert_eq!(*font, after, "redo brings the edit back");
    after
}

/// Applies `set` and returns its error, checking the font is unchanged.
fn refused(font: &mut Font, set: impl Into<FontIntentSet>) -> CoreError {
    let before = font.clone();
    let error = font.apply_intents(&set.into()).unwrap_err();
    assert_eq!(*font, before, "a refused edit leaves the font as it was");
    error
}

fn edit(alternate: &str, edit: GlyphAlternateEdit) -> EditGlyphAlternate {
    EditGlyphAlternate {
        alternate_id: AlternateId::from_raw(alternate),
        edit,
    }
}

/// An alternate of `dollar` drawing `glyph_name` where `condition` holds.
fn add_to_dollar(
    font: &Font,
    id: &str,
    condition: Condition,
    glyph_name: &str,
    position: Option<usize>,
) -> AddGlyphAlternate {
    AddGlyphAlternate {
        glyph_id: glyph(font, "dollar"),
        alternate: GlyphAlternate::new(
            AlternateId::from_raw(id),
            condition,
            glyph(font, glyph_name),
        ),
        position,
    }
}

#[test]
fn an_added_alternate_is_tried_at_its_position() {
    let mut font = conditions_font();
    let light = font
        .insert_glyph(crate::Glyph::new("dollar.light"))
        .unwrap();
    let below_300 = Condition::all([ConditionRange::new(axis(&font, "wght"), None, Some(300.0))]);
    let first = add_to_dollar(&font, "light", below_300, "dollar.light", Some(0));
    let last_heavier = add_to_dollar(&font, "x", from(&font, "wght", 800.0), "bar", None);

    let font = apply_undo_redo(
        &mut font,
        FontIntentSet::from_iter([first.into(), last_heavier.into()]),
    );

    assert_eq!(
        dollar_alternates(&font),
        ["light", "compact-heavy", "heavy", "x"]
    );
    assert_eq!(drawn_dollar(&font, 200.0, 100.0), "dollar.light");
    // `heavy` covers Weight ≥ 800, so `x` never wins.
    assert_eq!(drawn_dollar(&font, 850.0, 100.0), "dollar.heavy");
    assert_eq!(font.glyph(light).unwrap().name(), "dollar.light");
}

#[test]
fn moving_an_alternate_changes_which_one_wins() {
    let mut font = conditions_font();

    let font = apply_undo_redo(&mut font, edit("heavy", GlyphAlternateEdit::Move(0)));

    assert_eq!(dollar_alternates(&font), ["heavy", "compact-heavy"]);
    assert_eq!(drawn_dollar(&font, 800.0, 60.0), "dollar.heavy");
}

#[test]
fn an_alternates_condition_and_glyph_can_be_replaced() {
    let mut font = conditions_font();
    let narrow = Condition::all([ConditionRange::new(axis(&font, "wdth"), None, Some(80.0))]);
    let set = FontIntentSet::from_iter([
        edit("compact-heavy", GlyphAlternateEdit::Condition(narrow)).into(),
        edit("heavy", GlyphAlternateEdit::Glyph(glyph(&font, "bar"))).into(),
    ]);

    let font = apply_undo_redo(&mut font, set);

    assert_eq!(drawn_dollar(&font, 400.0, 60.0), "dollar.compact-heavy");
    assert_eq!(drawn_dollar(&font, 800.0, 100.0), "bar");
}

#[test]
fn a_removed_alternate_no_longer_applies_and_its_glyph_stays() {
    let mut font = conditions_font();

    let font = apply_undo_redo(&mut font, edit("compact-heavy", GlyphAlternateEdit::Remove));

    assert_eq!(dollar_alternates(&font), ["heavy"]);
    assert_eq!(drawn_dollar(&font, 800.0, 60.0), "dollar.heavy");
    assert!(font.glyph_by_name("dollar.compact-heavy").is_some());
}

#[test]
fn setting_the_whole_list_replaces_every_alternate() {
    let mut font = conditions_font();
    let only = GlyphAlternate::new(
        AlternateId::from_raw("only"),
        from(&font, "wght", 500.0),
        glyph(&font, "bar"),
    );
    let set = SetGlyphAlternates {
        glyph_id: glyph(&font, "dollar"),
        alternates: vec![only],
    };

    let font = apply_undo_redo(&mut font, set);

    assert_eq!(dollar_alternates(&font), ["only"]);
    assert_eq!(drawn_dollar(&font, 800.0, 60.0), "bar");
}

#[test]
fn an_alternate_must_draw_another_glyph_the_font_has() {
    let mut font = conditions_font();
    let dollar = glyph(&font, "dollar");
    let itself = add_to_dollar(&font, "r", Condition::always(), "dollar", None);
    let mut missing = add_to_dollar(&font, "r", Condition::always(), "bar", None);
    missing.alternate = GlyphAlternate::new(
        AlternateId::from_raw("r"),
        Condition::always(),
        GlyphId::from_raw("missing"),
    );

    assert!(matches!(
        refused(&mut font, itself),
        CoreError::AlternateIsItself { glyph_id, .. } if glyph_id == dollar
    ));
    assert!(matches!(
        refused(&mut font, missing),
        CoreError::GlyphNotFound(id) if id == GlyphId::from_raw("missing")
    ));
}

#[test]
fn an_alternate_condition_must_be_well_formed_on_font_axes() {
    let mut font = conditions_font();
    let weight = axis(&font, "wght");
    let spread = font
        .axis_id_in_glyph_space(Some(glyph(&font, "dot")), "SPRD")
        .unwrap();
    let on = |axis_id, min, max| Condition::all([ConditionRange::new(axis_id, min, max)]);
    let unknown = AxisId::from_raw("opsz");

    let reversed = add_to_dollar(
        &font,
        "r",
        on(weight, Some(800.0), Some(700.0)),
        "bar",
        None,
    );
    let glyph_axis = add_to_dollar(&font, "r", on(spread, Some(1.0), None), "bar", None);
    let nowhere = add_to_dollar(&font, "r", on(unknown, Some(1.0), None), "bar", None);
    let reversed_edit = edit(
        "heavy",
        GlyphAlternateEdit::Condition(on(weight, Some(900.0), Some(100.0))),
    );

    assert!(matches!(
        refused(&mut font, reversed),
        CoreError::ConditionRangeReversed {
            min: 800.0,
            max: 700.0,
            ..
        }
    ));
    assert!(matches!(
        refused(&mut font, glyph_axis),
        CoreError::AlternateConditionOffFontAxes { axis_id, .. } if axis_id == spread
    ));
    assert!(matches!(
        refused(&mut font, nowhere),
        CoreError::AxisNotFound(axis_id) if axis_id == unknown
    ));
    assert!(matches!(
        refused(&mut font, reversed_edit),
        CoreError::ConditionRangeReversed { .. }
    ));
}

#[test]
fn an_alternate_must_exist_and_stay_within_the_list() {
    let mut font = conditions_font();
    let past_end = add_to_dollar(&font, "r", Condition::always(), "bar", Some(3));

    assert!(matches!(
        refused(&mut font, past_end),
        CoreError::AlternatePositionOutOfRange {
            position: 3,
            count: 2,
            ..
        }
    ));
    assert!(matches!(
        refused(&mut font, edit("heavy", GlyphAlternateEdit::Move(2))),
        CoreError::AlternatePositionOutOfRange {
            position: 2,
            count: 2,
            ..
        }
    ));
    assert!(matches!(
        refused(&mut font, edit("nope", GlyphAlternateEdit::Remove)),
        CoreError::AlternateNotFound(id) if id == AlternateId::from_raw("nope")
    ));
}

/// `H`'s drawings with the condition of each component, in layer order.
fn h_conditions(font: &Font) -> Vec<Vec<Condition>> {
    font.glyph(GlyphId::from_raw("H"))
        .unwrap()
        .layers()
        .values()
        .map(|layer| {
            layer
                .components_iter()
                .map(|c| c.condition().clone())
                .collect()
        })
        .collect()
}

/// `H`'s Regular drawing and the id of its component at `index`.
fn h_regular_component(font: &Font, index: usize) -> (LayerId, crate::ComponentId) {
    let regular = font.default_source_id().unwrap();
    let layer = font
        .glyph(GlyphId::from_raw("H"))
        .unwrap()
        .layer_for_source(regular)
        .unwrap();
    (layer.id(), layer.components_iter().nth(index).unwrap().id())
}

#[test]
fn a_component_condition_is_set_in_every_drawing_of_its_glyph() {
    let mut font = glyph_axis_font();
    let (layer_id, component_id) = h_regular_component(&font, 1);
    let condition = from(&font, "BLED", 50.0);

    let font = apply_undo_redo(
        &mut font,
        SetComponentCondition {
            layer_id,
            component_id,
            condition: condition.clone(),
        },
    );

    let drawings = h_conditions(&font);
    assert_eq!(drawings.len(), 3);
    for drawing in drawings {
        assert_eq!(drawing, [Condition::always(), condition.clone()]);
    }
}

#[test]
fn a_drawing_whose_components_differ_keeps_its_own_conditions() {
    let mut font = glyph_axis_font();
    let (layer_id, component_id) = h_regular_component(&font, 1);
    let bled = font
        .sources()
        .iter()
        .find(|s| s.name() == "Bled")
        .unwrap()
        .id();
    let h = font.glyph(GlyphId::from_raw("H")).unwrap();
    let bled_layer = h.layer_for_source(bled).unwrap().id();
    let one_dot = ReplaceGlyphLayerContent {
        layer_id: bled_layer,
        width: 720.0,
        contours: Vec::new(),
        anchors: Vec::new(),
        components: vec![Component::new(GlyphId::from_raw("dot"), "dot")],
    };
    font.apply_intents(&one_dot.into()).unwrap();
    let condition = from(&font, "BLED", 50.0);

    font.apply_intents(
        &SetComponentCondition {
            layer_id,
            component_id,
            condition: condition.clone(),
        }
        .into(),
    )
    .unwrap();

    let bled_layer = font.layer(bled_layer).unwrap();
    assert!(
        bled_layer
            .components_iter()
            .all(|c| c.condition().is_always())
    );
    assert_eq!(
        h_conditions(&font)
            .iter()
            .filter(|d| d.contains(&condition))
            .count(),
        2
    );
}

#[test]
fn a_component_condition_may_not_read_the_axes_of_the_glyph_it_draws() {
    let mut font = glyph_axis_font();
    let (layer_id, component_id) = h_regular_component(&font, 0);
    let spread = font
        .axis_id_in_glyph_space(Some(GlyphId::from_raw("dot")), "SPRD")
        .unwrap();
    let on_spread = Condition::all([ConditionRange::new(spread, Some(50.0), None)]);
    let reversed = Condition::all([ConditionRange::new(
        axis(&font, "BLED"),
        Some(9.0),
        Some(1.0),
    )]);
    let set = |condition| SetComponentCondition {
        layer_id,
        component_id: component_id.clone(),
        condition,
    };

    assert!(matches!(
        refused(&mut font, set(on_spread)),
        CoreError::ComponentConditionOffSpace { axis_id, .. } if axis_id == spread
    ));
    assert!(matches!(
        refused(&mut font, set(reversed)),
        CoreError::ConditionRangeReversed { .. }
    ));
}
