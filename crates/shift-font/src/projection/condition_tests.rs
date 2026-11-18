//! Glyph alternates, which swap a glyph for another where text is drawn, and
//! component conditions, which say where a component draws at all.

use crate::test_support::conditions_font;
use crate::{
    AlternateId, AxisId, Component, Condition, ConditionRange, CoreError, DesignLocation, Font,
    Glyph, GlyphAlternate, GlyphAxis, GlyphId, GlyphLayer, LayerId,
};

fn glyph_id_of(font: &Font, name: &str) -> GlyphId {
    font.glyph_by_name(name).unwrap().id()
}

fn axis_tagged(font: &Font, tag: &str) -> AxisId {
    font.axis_id_in_glyph_space(font.glyph_by_name("dot").map(Glyph::id), tag)
        .unwrap()
}

fn weight_width(font: &Font, weight: f64, width: f64) -> DesignLocation {
    DesignLocation::from([
        (axis_tagged(font, "wght"), weight),
        (axis_tagged(font, "wdth"), width),
    ])
}

/// The name of the glyph drawn for `name` at Weight `weight`, Width `width`.
fn drawn_glyph_name(font: &Font, name: &str, weight: f64, width: f64) -> String {
    let drawn = font.drawn_glyph_at(glyph_id_of(font, name), &weight_width(font, weight, width));
    font.glyph(drawn).unwrap().name().to_string()
}

/// Each contour's first x, which tells the fixture's glyphs apart, with the
/// advance, at Weight `weight` and Width `width`.
fn drawn_starts(font: &Font, name: &str, weight: f64, width: f64) -> (Vec<f64>, f64) {
    drawn_starts_at(font, name, &weight_width(font, weight, width))
}

/// [`drawn_starts`] at `location`.
fn drawn_starts_at(font: &Font, name: &str, location: &DesignLocation) -> (Vec<f64>, f64) {
    let glyph = font
        .projection(location)
        .glyph(glyph_id_of(font, name))
        .unwrap()
        .unwrap();
    let starts = glyph
        .contours()
        .iter()
        .map(|contour| contour.points.first().map_or(f64::NAN, crate::Point::x))
        .collect();
    (starts, glyph.x_advance())
}

#[test]
fn the_first_alternate_that_holds_is_the_glyph_text_draws() {
    let font = conditions_font();

    let cases = [
        ((400.0, 100.0), "dollar"),
        ((699.0, 60.0), "dollar"),
        ((700.0, 100.0), "dollar.heavy"),
        ((900.0, 81.0), "dollar.heavy"),
        ((700.0, 80.0), "dollar.compact-heavy"),
        ((800.0, 50.0), "dollar.compact-heavy"),
    ];

    for ((weight, width), expected) in cases {
        assert_eq!(
            drawn_glyph_name(&font, "dollar", weight, width),
            expected,
            "Weight {weight}, Width {width}"
        );
    }
}

#[test]
fn alternates_are_tried_in_order() {
    let mut font = conditions_font();
    let dollar = glyph_id_of(&font, "dollar");
    let mut alternates = font.glyph(dollar).unwrap().alternates().to_vec();
    alternates.reverse();
    font.set_glyph_alternates(dollar, alternates).unwrap();

    assert_eq!(
        drawn_glyph_name(&font, "dollar", 800.0, 50.0),
        "dollar.heavy"
    );
}

#[test]
fn text_draws_the_alternates_outline_and_advance_under_the_glyphs_name() {
    let font = conditions_font();
    let dollar = glyph_id_of(&font, "dollar");
    let mut projection = font.projection(&weight_width(&font, 800.0, 100.0));

    let text = projection.drawn_glyph(dollar).unwrap().unwrap();
    let itself = projection.glyph(dollar).unwrap().unwrap();

    assert_eq!(
        (
            text.glyph_id(),
            text.contours()[0].points[0].x(),
            text.x_advance()
        ),
        (dollar, 2.0, 600.0)
    );
    assert_eq!(
        (itself.contours()[0].points[0].x(), itself.x_advance()),
        (1.0, 500.0)
    );
}

#[test]
fn an_alternate_glyphs_own_alternates_are_not_applied() {
    let mut font = conditions_font();
    let heavy = glyph_id_of(&font, "dollar.heavy");
    let alternate = GlyphAlternate::new(
        AlternateId::new(),
        Condition::always(),
        glyph_id_of(&font, "dollar.compact-heavy"),
    );
    font.set_glyph_alternates(heavy, vec![alternate]).unwrap();

    assert_eq!(
        drawn_glyph_name(&font, "dollar", 800.0, 100.0),
        "dollar.heavy"
    );
}

#[test]
fn a_component_of_the_glyph_is_not_swapped() {
    let font = conditions_font();

    assert_eq!(drawn_starts(&font, "dollarcomp", 800.0, 100.0).0, vec![1.0]);
}

/// Why the font refuses a glyph `cent` with one alternate, `alternate_id`, that draws
/// `alternate_glyph` where `condition` holds.
fn refusal_of_alternate(
    alternate_id: &str,
    condition: Condition,
    alternate_glyph: &str,
) -> CoreError {
    let mut font = conditions_font();
    let mut cent = Glyph::with_id(GlyphId::from_raw("cent"), "cent");
    cent.set_alternates(vec![GlyphAlternate::new(
        AlternateId::from_raw(alternate_id),
        condition,
        GlyphId::from_raw(alternate_glyph),
    )]);
    font.insert_glyph(cent).unwrap_err()
}

#[test]
fn an_alternate_must_be_another_glyph_the_font_has() {
    let itself = refusal_of_alternate("r", Condition::always(), "cent");
    let missing = refusal_of_alternate("r", Condition::always(), "missing");

    assert!(matches!(itself, CoreError::AlternateIsItself { .. }));
    assert!(matches!(missing, CoreError::GlyphNotFound(id) if id == GlyphId::from_raw("missing")));
}

#[test]
fn an_alternate_condition_reads_font_axes_only() {
    let font = conditions_font();
    let spread = axis_tagged(&font, "SPRD");
    let on_glyph_axis = Condition::all([ConditionRange::new(spread, Some(1.0), None)]);

    let refused = refusal_of_alternate("r", on_glyph_axis, "dollar");

    assert!(matches!(
        refused,
        CoreError::AlternateConditionOffFontAxes { alternate_id, axis_id }
            if alternate_id == AlternateId::from_raw("r") && axis_id == spread
    ));
}

#[test]
fn an_alternate_must_have_a_well_formed_condition_and_an_unused_id() {
    let font = conditions_font();
    let weight = axis_tagged(&font, "wght");
    let reversed = Condition::all([ConditionRange::new(weight, Some(800.0), Some(700.0))]);

    let reversed = refusal_of_alternate("r", reversed, "dollar");
    let duplicate = refusal_of_alternate("heavy", Condition::always(), "dollar");

    assert!(matches!(reversed, CoreError::ConditionRangeReversed { .. }));
    assert!(
        matches!(duplicate, CoreError::DuplicateAlternateId(id) if id == AlternateId::from_raw("heavy"))
    );
}

#[test]
fn a_glyph_that_is_an_alternate_cannot_be_removed() {
    let mut font = conditions_font();
    let alternate_glyph = font.insert_glyph(Glyph::new("dollar.light")).unwrap();
    let dollar = glyph_id_of(&font, "dollar");
    let alternate = GlyphAlternate::new(AlternateId::new(), Condition::always(), alternate_glyph);
    font.set_glyph_alternates(dollar, vec![alternate]).unwrap();

    let refused = font.pop_glyph(alternate_glyph).unwrap_err();

    assert!(matches!(
        refused,
        CoreError::GlyphIsAlternate { glyph_id, alternate_of }
            if glyph_id == alternate_glyph && alternate_of == dollar
    ));
    assert!(font.glyph(alternate_glyph).is_some());
}

/// Each contour's first x of `name` drawn at Weight `weight` with `H`'s
/// own Crossbar axis at `crossbar`.
fn drawn_with_crossbar(font: &Font, name: &str, weight: f64, crossbar: f64) -> Vec<f64> {
    let mut location = weight_width(font, weight, 100.0);
    location.set(axis_tagged_on(font, "H", "CRSB"), crossbar);
    drawn_starts_at(font, name, &location).0
}

fn axis_tagged_on(font: &Font, glyph: &str, tag: &str) -> AxisId {
    font.axis_id_in_glyph_space(Some(glyph_id_of(font, glyph)), tag)
        .unwrap()
}

#[test]
fn a_component_draws_only_where_its_condition_holds_on_a_font_axis() {
    let font = conditions_font();

    // H's bar (x 4) and its Weight-800 bar (x 204) draw from Weight 700 up.
    assert_eq!(drawn_starts(&font, "H", 699.0, 100.0).0, Vec::<f64>::new());
    assert_eq!(drawn_starts(&font, "H", 700.0, 100.0).0, vec![4.0, 204.0]);
    assert_eq!(drawn_starts(&font, "H", 900.0, 100.0).0, vec![4.0, 204.0]);
}

#[test]
fn a_component_condition_reads_its_parents_value_not_the_one_it_sets() {
    let font = conditions_font();

    // The bar at x 204 sets Weight 800, but its condition (Weight ≥ 700)
    // reads where H is drawn, as skrifa's VARC reader does.
    assert_eq!(drawn_starts(&font, "H", 600.0, 100.0).0, Vec::<f64>::new());
    assert_eq!(drawn_starts(&font, "H", 750.0, 100.0).0, vec![4.0, 204.0]);
}

#[test]
fn a_component_condition_reads_its_parent_glyphs_own_axis() {
    let font = conditions_font();

    // H's dot (x 105) draws where H's Crossbar is 70–100.
    assert_eq!(
        drawn_with_crossbar(&font, "H", 400.0, 69.0),
        Vec::<f64>::new()
    );
    assert_eq!(drawn_with_crossbar(&font, "H", 400.0, 80.0), vec![105.0]);
}

#[test]
fn a_component_condition_sees_the_location_its_parent_glyph_draws_at() {
    let font = conditions_font();

    // HX draws H at Crossbar 80, so H's dot draws though HX sets nothing
    // else; T draws mid at Weight 800, so mid's bar draws though T is at
    // 400; U draws mid where U is.
    assert_eq!(drawn_starts(&font, "HX", 400.0, 100.0).0, vec![105.0]);
    assert_eq!(drawn_starts(&font, "T", 400.0, 100.0).0, vec![4.0]);
    assert_eq!(drawn_starts(&font, "U", 400.0, 100.0).0, Vec::<f64>::new());
    assert_eq!(drawn_starts(&font, "U", 800.0, 100.0).0, vec![4.0]);
}

#[test]
fn a_component_condition_leaves_the_advance_alone() {
    let font = conditions_font();

    assert_eq!(drawn_starts(&font, "H", 400.0, 100.0).1, 500.0);
}

#[test]
fn component_conditions_off_the_parent_glyphs_space_are_refused() {
    let font = conditions_font();
    let source = font.default_source_id().unwrap();
    let dot = glyph_id_of(&font, "dot");
    let spread = axis_tagged(&font, "SPRD");
    let probe_axis = AxisId::from_raw("probe");
    let probe_with = |condition: Condition| {
        let mut component = Component::new(dot, "dot");
        component.set_condition(condition);
        let mut layer = GlyphLayer::new(LayerId::new(), source);
        layer.add_component(component);
        let mut glyph = Glyph::new("probe");
        glyph.set_layer(layer);
        glyph.set_axes(vec![GlyphAxis::with_id(
            probe_axis, "PRBE", "Probe", 0.0, 0.0, 100.0,
        )]);
        glyph
    };
    let on = |axis_id: AxisId| Condition::all([ConditionRange::new(axis_id, Some(1.0), None)]);

    // The base glyph's own axis is not the parent's.
    let off_space = font
        .clone()
        .insert_glyph(probe_with(on(spread)))
        .unwrap_err();
    let unknown = font
        .clone()
        .insert_glyph(probe_with(on(AxisId::new())))
        .unwrap_err();

    assert!(matches!(
        off_space,
        CoreError::ComponentConditionOffSpace { axis_id, .. } if axis_id == spread
    ));
    assert!(matches!(unknown, CoreError::AxisNotFound(_)));
    let mut font = font;
    font.insert_glyph(probe_with(on(probe_axis))).unwrap();
}
