//! Swaps and component conditions edited through intents.
//!
//! Swaps are tried on `conditions_font`: `dollar` has `compact-heavy`
//! (Weight ≥ 700, Width ≤ 80) then `heavy` (Weight ≥ 700). Component
//! conditions are set on `glyph_axis_font`'s `H`: two `dot` components in
//! its Regular, Bled and Bleed 50 drawings.

use crate::test_support::{apply_undo_redo, conditions_font, glyph_axis_font, refused_edit};
use crate::{
    AddGlyphSwap, AxisId, Component, Condition, ConditionRange, CoreError, DesignLocation,
    EditGlyphSwap, Font, FontIntentSet, GlyphId, GlyphSwap, GlyphSwapEdit, LayerId,
    ReplaceGlyphLayerContent, SetComponentCondition, SetGlyphSwaps, SwapId,
};

fn id_of_glyph(font: &Font, name: &str) -> GlyphId {
    font.glyph_by_name(name).unwrap().id()
}

fn font_axis(font: &Font, tag: &str) -> AxisId {
    font.axis_id_by_tag(tag).unwrap()
}

fn from(font: &Font, tag: &str, min: f64) -> Condition {
    Condition::all([ConditionRange::new(font_axis(font, tag), Some(min), None)])
}

/// The name of the glyph drawn for `dollar` at Weight `weight`, Width `width`.
fn drawn_dollar(font: &Font, weight: f64, width: f64) -> String {
    let location = DesignLocation::from([
        (font_axis(font, "wght"), weight),
        (font_axis(font, "wdth"), width),
    ]);
    let drawn = font.drawn_glyph_at(id_of_glyph(font, "dollar"), &location);
    font.glyph(drawn).unwrap().name().to_string()
}

/// `dollar`'s swaps, as the raw ids they were made with.
fn dollar_swaps(font: &Font) -> Vec<String> {
    font.glyph_by_name("dollar")
        .unwrap()
        .swaps()
        .iter()
        .map(|swap| {
            let id = swap.id().as_str();
            id.strip_prefix("swap_").unwrap_or(id).to_string()
        })
        .collect()
}

fn swap_edit(swap: &str, edit: GlyphSwapEdit) -> EditGlyphSwap {
    EditGlyphSwap {
        swap_id: SwapId::from_raw(swap),
        edit,
    }
}

/// A swap of `dollar` drawing `glyph_name` where `condition` holds.
fn add_to_dollar(
    font: &Font,
    id: &str,
    condition: Condition,
    glyph_name: &str,
    position: Option<usize>,
) -> AddGlyphSwap {
    AddGlyphSwap {
        glyph_id: id_of_glyph(font, "dollar"),
        swap: GlyphSwap::new(
            SwapId::from_raw(id),
            condition,
            id_of_glyph(font, glyph_name),
        ),
        position,
    }
}

#[test]
fn an_added_swap_is_tried_at_its_position() {
    let mut font = conditions_font();
    let light = font
        .insert_glyph(crate::Glyph::new("dollar.light"))
        .unwrap();
    let below_300 = Condition::all([ConditionRange::new(
        font_axis(&font, "wght"),
        None,
        Some(300.0),
    )]);
    let first = add_to_dollar(&font, "light", below_300, "dollar.light", Some(0));
    let last_heavier = add_to_dollar(&font, "x", from(&font, "wght", 800.0), "bar", None);

    let font = apply_undo_redo(
        &mut font,
        FontIntentSet::from_iter([first.into(), last_heavier.into()]),
    );

    assert_eq!(
        dollar_swaps(&font),
        ["light", "compact-heavy", "heavy", "x"]
    );
    assert_eq!(drawn_dollar(&font, 200.0, 100.0), "dollar.light");
    // `heavy` covers Weight ≥ 800, so `x` never wins.
    assert_eq!(drawn_dollar(&font, 850.0, 100.0), "dollar.heavy");
    assert_eq!(font.glyph(light).unwrap().name(), "dollar.light");
}

#[test]
fn moving_a_swap_changes_which_one_wins() {
    let mut font = conditions_font();

    let font = apply_undo_redo(&mut font, swap_edit("heavy", GlyphSwapEdit::Move(0)));

    assert_eq!(dollar_swaps(&font), ["heavy", "compact-heavy"]);
    assert_eq!(drawn_dollar(&font, 800.0, 60.0), "dollar.heavy");
}

#[test]
fn a_swaps_condition_and_glyph_can_be_replaced() {
    let mut font = conditions_font();
    let narrow = Condition::all([ConditionRange::new(
        font_axis(&font, "wdth"),
        None,
        Some(80.0),
    )]);
    let set = FontIntentSet::from_iter([
        swap_edit("compact-heavy", GlyphSwapEdit::Condition(narrow)).into(),
        swap_edit("heavy", GlyphSwapEdit::Glyph(id_of_glyph(&font, "bar"))).into(),
    ]);

    let font = apply_undo_redo(&mut font, set);

    assert_eq!(drawn_dollar(&font, 400.0, 60.0), "dollar.compact-heavy");
    assert_eq!(drawn_dollar(&font, 800.0, 100.0), "bar");
}

#[test]
fn a_removed_swap_no_longer_applies_and_its_glyph_stays() {
    let mut font = conditions_font();

    let font = apply_undo_redo(&mut font, swap_edit("compact-heavy", GlyphSwapEdit::Remove));

    assert_eq!(dollar_swaps(&font), ["heavy"]);
    assert_eq!(drawn_dollar(&font, 800.0, 60.0), "dollar.heavy");
    assert!(font.glyph_by_name("dollar.compact-heavy").is_some());
}

#[test]
fn setting_the_whole_list_replaces_every_swap() {
    let mut font = conditions_font();
    let only = GlyphSwap::new(
        SwapId::from_raw("only"),
        from(&font, "wght", 500.0),
        id_of_glyph(&font, "bar"),
    );
    let set = SetGlyphSwaps {
        glyph_id: id_of_glyph(&font, "dollar"),
        swaps: vec![only],
    };

    let font = apply_undo_redo(&mut font, set);

    assert_eq!(dollar_swaps(&font), ["only"]);
    assert_eq!(drawn_dollar(&font, 800.0, 60.0), "bar");
}

#[test]
fn a_swap_must_draw_another_glyph_the_font_has() {
    let mut font = conditions_font();
    let dollar = id_of_glyph(&font, "dollar");
    let itself = add_to_dollar(&font, "r", Condition::always(), "dollar", None);
    let mut missing = add_to_dollar(&font, "r", Condition::always(), "bar", None);
    missing.swap = GlyphSwap::new(
        SwapId::from_raw("r"),
        Condition::always(),
        GlyphId::from_raw("missing"),
    );

    assert!(matches!(
        refused_edit(&mut font, itself),
        CoreError::SwapIsItself { glyph_id, .. } if glyph_id == dollar
    ));
    assert!(matches!(
        refused_edit(&mut font, missing),
        CoreError::GlyphNotFound(id) if id == GlyphId::from_raw("missing")
    ));
}

/// A condition of one range on `axis_id`.
fn one_range(axis_id: AxisId, min: Option<f64>, max: Option<f64>) -> Condition {
    Condition::all([ConditionRange::new(axis_id, min, max)])
}

#[test]
fn a_swap_condition_must_not_run_downwards() {
    let mut font = conditions_font();
    let weight = font_axis(&font, "wght");
    let added = one_range(weight, Some(800.0), Some(700.0));
    let reversed = add_to_dollar(&font, "r", added, "bar", None);
    let edited = one_range(weight, Some(900.0), Some(100.0));
    let reversed_edit = swap_edit("heavy", GlyphSwapEdit::Condition(edited));

    assert!(matches!(
        refused_edit(&mut font, reversed),
        CoreError::ConditionRangeReversed {
            min: 800.0,
            max: 700.0,
            ..
        }
    ));
    assert!(matches!(
        refused_edit(&mut font, reversed_edit),
        CoreError::ConditionRangeReversed {
            min: 900.0,
            max: 100.0,
            ..
        }
    ));
}

#[test]
fn a_swap_condition_reads_only_axes_the_font_has() {
    let mut font = conditions_font();
    let dot = Some(id_of_glyph(&font, "dot"));
    let spread = font.axis_id_in_glyph_space(dot, "SPRD").unwrap();
    let unknown = AxisId::from_raw("opsz");
    let glyph_axis = add_to_dollar(&font, "r", one_range(spread, Some(1.0), None), "bar", None);
    let nowhere = add_to_dollar(&font, "r", one_range(unknown, Some(1.0), None), "bar", None);

    assert!(matches!(
        refused_edit(&mut font, glyph_axis),
        CoreError::SwapConditionOffFontAxes { axis_id, .. } if axis_id == spread
    ));
    assert!(matches!(
        refused_edit(&mut font, nowhere),
        CoreError::AxisNotFound(axis_id) if axis_id == unknown
    ));
}

#[test]
fn a_swap_must_exist_and_stay_within_the_list() {
    let mut font = conditions_font();
    let past_end = add_to_dollar(&font, "r", Condition::always(), "bar", Some(3));

    assert!(matches!(
        refused_edit(&mut font, past_end),
        CoreError::SwapPositionOutOfRange {
            position: 3,
            count: 2,
            ..
        }
    ));
    assert!(matches!(
        refused_edit(&mut font, swap_edit("heavy", GlyphSwapEdit::Move(2))),
        CoreError::SwapPositionOutOfRange {
            position: 2,
            count: 2,
            ..
        }
    ));
    assert!(matches!(
        refused_edit(&mut font, swap_edit("nope", GlyphSwapEdit::Remove)),
        CoreError::SwapNotFound(id) if id == SwapId::from_raw("nope")
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

/// Replaces `H`'s Bled drawing with one `dot`, so its components no longer
/// match the other drawings'. Returns that drawing.
fn h_bled_with_one_dot(font: &mut Font) -> LayerId {
    let bled = font
        .sources()
        .iter()
        .find(|s| s.name() == "Bled")
        .unwrap()
        .id();
    let h = font.glyph(GlyphId::from_raw("H")).unwrap();
    let layer_id = h.layer_for_source(bled).unwrap().id();
    let one_dot = ReplaceGlyphLayerContent {
        layer_id,
        width: 720.0,
        contours: Vec::new(),
        anchors: Vec::new(),
        components: vec![Component::new(GlyphId::from_raw("dot"), "dot")],
    };
    font.apply_intents(&one_dot.into()).unwrap();
    layer_id
}

#[test]
fn a_drawing_whose_components_differ_keeps_its_own_conditions() {
    let mut font = glyph_axis_font();
    let bled_layer = h_bled_with_one_dot(&mut font);
    let (layer_id, component_id) = h_regular_component(&font, 0);
    let condition = from(&font, "BLED", 50.0);
    let set = SetComponentCondition {
        layer_id,
        component_id,
        condition: condition.clone(),
    };

    let font = apply_undo_redo(&mut font, set);

    let bled_layer = font.layer(bled_layer).unwrap();
    assert!(
        bled_layer
            .components_iter()
            .all(|c| c.condition().is_always())
    );
    let conditioned = h_conditions(&font)
        .into_iter()
        .filter(|d| d.contains(&condition));
    assert_eq!(conditioned.count(), 2);
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
        font_axis(&font, "BLED"),
        Some(9.0),
        Some(1.0),
    )]);
    let set = |condition| SetComponentCondition {
        layer_id,
        component_id: component_id.clone(),
        condition,
    };

    assert!(matches!(
        refused_edit(&mut font, set(on_spread)),
        CoreError::ComponentConditionOffSpace { axis_id, .. } if axis_id == spread
    ));
    assert!(matches!(
        refused_edit(&mut font, set(reversed)),
        CoreError::ConditionRangeReversed { .. }
    ));
}
