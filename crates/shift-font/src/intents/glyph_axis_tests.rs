//! Glyph axes and located drawings edited through intents, on the
//! Solenoid-like fixture: `dot` with Spread and Strike (0 to 100) drawn on
//! Regular, Bled, Spread 100 and Strike 100, and `H` of two `dot`
//! components whose first sets Spread 60 (80 in its Bleed 50 brace layer).

use crate::test_support::glyph_axis_font;
use crate::{
    AxisId, AxisRange, AxisValueUse, Component, CoreError, CreateGlyphAxis,
    CreateLocatedGlyphLayer, DeleteGlyphLayer, DesignLocation, EditGlyphAxis, Font, FontIntentSet,
    GlyphAxisEdit, GlyphId, LayerId, MaterializeLocatedGlyphLayer, ReplaceGlyphLayerContent,
    SetComponentLocations, SetGlyphLayerLocation, SourceId,
};

fn dot() -> GlyphId {
    GlyphId::from_raw("dot")
}

fn h() -> GlyphId {
    GlyphId::from_raw("H")
}

fn dot_space_axis(font: &Font, tag: &str) -> AxisId {
    font.axis_id_in_glyph_space(Some(dot()), tag).unwrap()
}

fn source_called(font: &Font, name: &str) -> SourceId {
    font.sources()
        .iter()
        .find(|source| source.name() == name)
        .unwrap()
        .id()
}

/// The `dot` drawing whose own coordinates set `tag` to `value`.
fn dot_layer_at(font: &Font, tag: &str, value: f64) -> LayerId {
    let axis_id = dot_space_axis(font, tag);
    font.glyph(dot())
        .unwrap()
        .layers()
        .values()
        .find(|layer| layer.location().coordinates().get(&axis_id) == Some(value))
        .unwrap()
        .id()
}

/// Every Spread value `H`'s components set, in layer order.
fn h_component_spreads(font: &Font) -> Vec<f64> {
    let spread = dot_space_axis(font, "SPRD");
    font.glyph(h())
        .unwrap()
        .layers()
        .values()
        .flat_map(|layer| layer.components_iter())
        .filter_map(|component| component.location().get(&spread))
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

fn axis_edit(font: &Font, tag: &str, edit: GlyphAxisEdit) -> EditGlyphAxis {
    EditGlyphAxis {
        axis_id: dot_space_axis(font, tag),
        edit,
    }
}

fn axis_range(minimum: f64, default: f64, maximum: f64) -> AxisRange {
    AxisRange {
        minimum,
        default,
        maximum,
    }
}

#[test]
fn a_glyph_axis_is_added_with_a_tag_from_its_name_and_undone() {
    let mut font = glyph_axis_font();
    let axis_id = AxisId::new();

    let after = apply_undo_redo(
        &mut font,
        CreateGlyphAxis {
            glyph_id: dot(),
            axis_id,
            name: "Weight Of Ink".into(),
            tag: None,
            range: axis_range(0.0, 10.0, 40.0),
        },
    );

    let axis = after.glyph_axis(axis_id).unwrap();
    assert_eq!((axis.tag(), axis.name()), ("WGHT", "Weight Of Ink"));
    assert_eq!(after.glyph_axis_owner(axis_id), Some(dot()));
}

#[test]
fn a_glyph_axis_with_a_tag_already_in_use_is_refused() {
    let mut font = glyph_axis_font();

    let error = refused(
        &mut font,
        CreateGlyphAxis {
            glyph_id: h(),
            axis_id: AxisId::new(),
            name: "Bloat".into(),
            tag: Some("BLED".into()),
            range: axis_range(0.0, 0.0, 1.0),
        },
    );

    assert!(matches!(error, CoreError::DuplicateAxisTag(tag) if tag == "BLED"));
}

#[test]
fn a_glyph_axis_is_renamed_and_retagged() {
    let mut font = glyph_axis_font();
    let spread = dot_space_axis(&font, "SPRD");

    let set = FontIntentSet {
        intents: vec![
            axis_edit(&font, "SPRD", GlyphAxisEdit::Name("Splay".into())).into(),
            axis_edit(&font, "SPRD", GlyphAxisEdit::Tag("SPLY".into())).into(),
        ],
    };

    let after = apply_undo_redo(&mut font, set);

    let axis = after.glyph_axis(spread).unwrap();
    assert_eq!((axis.tag(), axis.name()), ("SPLY", "Splay"));
}

#[test]
fn a_range_that_strands_values_is_refused_naming_each_one() {
    let mut font = glyph_axis_font();
    let spread_layer = dot_layer_at(&font, "SPRD", 100.0);

    let narrower = axis_edit(
        &font,
        "SPRD",
        GlyphAxisEdit::Range(axis_range(0.0, 0.0, 70.0)),
    );

    let error = refused(&mut font, narrower);

    let CoreError::AxisValuesOutsideRange { uses, .. } = error else {
        panic!("expected stranded values, got {error:?}");
    };
    // The Spread 100 drawing, and the brace layer's component at 80; the
    // masters' components at 60 stay inside.
    assert_eq!(uses.len(), 2, "{uses:?}");
    assert!(uses.iter().any(|value_use| matches!(
        value_use,
        AxisValueUse::Layer { layer_id, value, .. } if *layer_id == spread_layer && *value == 100.0
    )));
    assert!(uses.iter().any(|value_use| matches!(
        value_use,
        AxisValueUse::Component { glyph_id, value, .. } if *glyph_id == h() && *value == 80.0
    )));
}

#[test]
fn a_range_that_keeps_every_value_inside_moves_nothing() {
    let mut font = glyph_axis_font();
    let spread_layer = dot_layer_at(&font, "SPRD", 100.0);
    let components_before = h_component_spreads(&font);
    let wider = axis_edit(
        &font,
        "SPRD",
        GlyphAxisEdit::Range(axis_range(-50.0, 0.0, 200.0)),
    );

    let after = apply_undo_redo(&mut font, wider);

    assert_eq!(dot_layer_at(&after, "SPRD", 100.0), spread_layer);
    assert_eq!(h_component_spreads(&after), components_before);
}

#[test]
fn rescaling_moves_drawings_and_components_with_the_range_and_undoes() {
    let mut font = glyph_axis_font();
    let spread_layer = dot_layer_at(&font, "SPRD", 100.0);
    let mut before = h_component_spreads(&font);
    before.sort_by(f64::total_cmp);
    assert_eq!(before, vec![60.0, 60.0, 80.0]);

    let rescale = axis_edit(
        &font,
        "SPRD",
        GlyphAxisEdit::Rescale(axis_range(0.0, 0.0, 1000.0)),
    );

    let after = apply_undo_redo(&mut font, rescale);

    assert_eq!(dot_layer_at(&after, "SPRD", 1000.0), spread_layer);
    let mut values = h_component_spreads(&after);
    values.sort_by(f64::total_cmp);
    assert_eq!(values, vec![600.0, 600.0, 800.0]);
}

#[test]
fn rescaling_records_every_layer_it_moves() {
    let mut font = glyph_axis_font();

    let applied = font
        .apply_intents(
            &axis_edit(
                &font,
                "SPRD",
                GlyphAxisEdit::Rescale(axis_range(0.0, 0.0, 10.0)),
            )
            .into(),
        )
        .unwrap();

    // `dot` is replaced whole; each of H's three layers moves a component.
    let replaced: Vec<GlyphId> = applied.changes.replaced_glyph_ids().collect();
    assert_eq!(replaced, vec![dot()]);
    let changed = applied.changes.changed_layer_ids();
    let h_layers = font.layer_ids_of_glyphs([&h()]);
    assert_eq!(h_layers.len(), 3);
    assert!(
        h_layers.iter().all(|layer_id| changed.contains(layer_id)),
        "{changed:?}"
    );
}

#[test]
fn an_axis_in_use_is_not_removed() {
    let mut font = glyph_axis_font();

    let remove = axis_edit(&font, "SPRD", GlyphAxisEdit::Remove);

    let error = refused(&mut font, remove);

    assert!(matches!(error, CoreError::GlyphAxisInUse { uses, .. } if uses.len() == 4));
}

#[test]
fn an_axis_nothing_uses_is_removed_and_undone() {
    let mut font = glyph_axis_font();
    let strike_layer = dot_layer_at(&font, "STRK", 100.0);
    font.apply_intents(
        &DeleteGlyphLayer {
            layer_id: strike_layer,
        }
        .into(),
    )
    .unwrap();
    let strike = dot_space_axis(&font, "STRK");

    let remove = axis_edit(&font, "STRK", GlyphAxisEdit::Remove);

    let after = apply_undo_redo(&mut font, remove);

    assert!(after.glyph_axis(strike).is_none());
    assert!(!after.is_axis_tag_taken("STRK"));
}

#[test]
fn an_edit_to_an_unknown_axis_is_refused() {
    let mut font = glyph_axis_font();
    let axis_id = AxisId::new();

    let error = refused(
        &mut font,
        EditGlyphAxis {
            axis_id,
            edit: GlyphAxisEdit::Remove,
        },
    );

    assert!(matches!(error, CoreError::AxisNotFound(id) if id == axis_id));
}

#[test]
fn a_drawing_is_added_at_a_glyph_axis_location_and_undone() {
    let mut font = glyph_axis_font();
    let layer_id = LayerId::new();
    let regular = source_called(&font, "Regular");
    let spread = dot_space_axis(&font, "SPRD");

    let after = apply_undo_redo(
        &mut font,
        CreateLocatedGlyphLayer {
            layer_id,
            glyph_id: dot(),
            base_source_id: Some(regular),
            coordinates: DesignLocation::from([(spread, 50.0)]),
        },
    );

    let layer = after.layer(layer_id).unwrap();
    assert_eq!(layer.source_id(), Some(regular));
    assert_eq!(layer.location().coordinates().get(&spread), Some(50.0));
    assert_eq!(after.glyph_id_by_layer(layer_id), Some(dot()));
}

#[test]
fn a_brace_drawing_is_added_with_no_base_source() {
    let mut font = glyph_axis_font();
    let layer_id = LayerId::new();
    let bleed = dot_space_axis(&font, "BLED");

    let after = apply_undo_redo(
        &mut font,
        CreateLocatedGlyphLayer {
            layer_id,
            glyph_id: dot(),
            base_source_id: None,
            coordinates: DesignLocation::from([(bleed, 25.0)]),
        },
    );

    assert_eq!(after.layer(layer_id).unwrap().source_id(), None);
}

#[test]
fn a_drawing_added_where_none_is_starts_from_what_the_glyph_draws_there() {
    let mut font = glyph_axis_font();
    let layer_id = LayerId::new();
    let regular = source_called(&font, "Regular");
    let spread = dot_space_axis(&font, "SPRD");
    let mut location = font.require_source(regular).unwrap().location().clone();
    location.set(spread, 60.0);
    let axes = font.glyph_space_axes(font.glyph(dot()).unwrap());
    let drawn = font
        .glyph_interpolation(dot())
        .unwrap()
        .unwrap()
        .resolve(&location, &axes)
        .unwrap()
        .interpolation_values();
    let from_layer_id = font.layer_id_for_source(dot(), regular).unwrap();

    let after = apply_undo_redo(
        &mut font,
        MaterializeLocatedGlyphLayer {
            layer: CreateLocatedGlyphLayer {
                layer_id,
                glyph_id: dot(),
                base_source_id: Some(regular),
                coordinates: DesignLocation::from([(spread, 60.0)]),
            },
            from_layer_id,
            values: drawn.clone(),
        },
    );

    let layer = after.layer(layer_id).unwrap();
    assert_eq!(layer.location().coordinates().get(&spread), Some(60.0));
    assert_eq!(layer.interpolation_values(), drawn);
}

/// Why a drawing may not be created at a place.
#[derive(Debug)]
enum Refusal {
    DuplicateLocation,
    OffSpace,
    OutsideRange,
}

impl Refusal {
    fn matches(&self, error: &CoreError) -> bool {
        match self {
            Self::DuplicateLocation => matches!(error, CoreError::DuplicateLayerLocation { .. }),
            Self::OffSpace => matches!(error, CoreError::LayerLocationOffSpace { .. }),
            Self::OutsideRange => matches!(error, CoreError::AxisValuesOutsideRange { .. }),
        }
    }
}

#[test]
fn a_drawing_is_refused_where_it_cannot_sit() {
    let font = glyph_axis_font();
    let regular = source_called(&font, "Regular");
    let spread = dot_space_axis(&font, "SPRD");
    // Where another drawing sits, on another glyph's axis, and outside the
    // axis range.
    let cases = [
        (dot(), Some(regular), 100.0, Refusal::DuplicateLocation),
        (h(), None, 10.0, Refusal::OffSpace),
        (dot(), None, 120.0, Refusal::OutsideRange),
    ];

    for (glyph_id, base_source_id, value, expected) in cases {
        let mut font = font.clone();
        let intent = CreateLocatedGlyphLayer {
            layer_id: LayerId::new(),
            glyph_id,
            base_source_id,
            coordinates: DesignLocation::from([(spread, value)]),
        };

        let error = refused(&mut font, intent);

        assert!(expected.matches(&error), "{expected:?}: {error:?}");
    }
}

#[test]
fn a_drawing_moves_with_its_content_and_undoes() {
    let mut font = glyph_axis_font();
    let layer_id = dot_layer_at(&font, "SPRD", 100.0);
    let spread = dot_space_axis(&font, "SPRD");
    let contours = font.layer(layer_id).unwrap().contours().clone();

    let after = apply_undo_redo(
        &mut font,
        SetGlyphLayerLocation {
            layer_id,
            base_source_id: None,
            coordinates: DesignLocation::from([(spread, 80.0)]),
        },
    );

    let layer = after.layer(layer_id).unwrap();
    assert_eq!(layer.source_id(), None);
    assert_eq!(layer.location().coordinates().get(&spread), Some(80.0));
    assert_eq!(*layer.contours(), contours);
}

#[test]
fn a_drawing_moved_onto_another_is_refused() {
    let mut font = glyph_axis_font();
    let layer_id = dot_layer_at(&font, "STRK", 100.0);
    let regular = source_called(&font, "Regular");
    let spread = dot_space_axis(&font, "SPRD");

    let error = refused(
        &mut font,
        SetGlyphLayerLocation {
            layer_id,
            base_source_id: Some(regular),
            coordinates: DesignLocation::from([(spread, 100.0)]),
        },
    );

    assert!(matches!(error, CoreError::DuplicateLayerLocation { .. }));
}

#[test]
fn a_drawing_is_removed_and_undoing_brings_its_content_back() {
    let mut font = glyph_axis_font();
    let layer_id = dot_layer_at(&font, "SPRD", 100.0);

    let after = apply_undo_redo(&mut font, DeleteGlyphLayer { layer_id });

    assert!(after.layer(layer_id).is_none());
    assert!(after.glyph_id_by_layer(layer_id).is_none());
}

/// `H`'s first Regular layer and its Spread-60 component.
fn h_spread_component(font: &Font) -> (LayerId, Component) {
    let regular = source_called(font, "Regular");
    let layer = font.glyph(h()).unwrap().layer_for_source(regular).unwrap();
    let component = layer.components_iter().next().unwrap().clone();
    (layer.id(), component)
}

fn set_location(
    layer_id: LayerId,
    component: &Component,
    location: DesignLocation,
) -> SetComponentLocations {
    SetComponentLocations {
        layer_id,
        component_ids: vec![component.id()],
        locations: vec![location],
        inheritances: vec![component.inheritance()],
    }
}

#[test]
fn a_component_sets_its_base_glyphs_own_axis() {
    let mut font = glyph_axis_font();
    let (layer_id, component) = h_spread_component(&font);
    let strike = dot_space_axis(&font, "STRK");

    let after = apply_undo_redo(
        &mut font,
        set_location(layer_id, &component, DesignLocation::from([(strike, 40.0)])),
    );

    let component = after
        .layer(layer_id)
        .unwrap()
        .component(&component.id())
        .unwrap();
    assert_eq!(component.location().get(&strike), Some(40.0));
}

#[test]
fn a_component_location_on_another_glyphs_axis_is_refused() {
    let mut font = glyph_axis_font();
    let mut other = font.clone();
    let mark = GlyphId::from_raw("mark");
    other
        .insert_glyph(crate::Glyph::with_id(mark, "mark"))
        .unwrap();
    let foreign = other
        .add_glyph_axis(mark, crate::GlyphAxis::new("Tilt", 0.0, 0.0, 10.0))
        .unwrap();
    font = other;
    let (layer_id, component) = h_spread_component(&font);

    let error = refused(
        &mut font,
        set_location(layer_id, &component, DesignLocation::from([(foreign, 5.0)])),
    );

    assert!(matches!(
        error,
        CoreError::ComponentLocationOffSpace { axis_id, .. } if axis_id == foreign
    ));
}

#[test]
fn a_component_location_outside_a_glyph_axis_range_is_refused() {
    let mut font = glyph_axis_font();
    let (layer_id, component) = h_spread_component(&font);
    let spread = dot_space_axis(&font, "SPRD");

    let error = refused(
        &mut font,
        set_location(
            layer_id,
            &component,
            DesignLocation::from([(spread, 150.0)]),
        ),
    );

    assert!(matches!(error, CoreError::AxisValuesOutsideRange { .. }));
}

#[test]
fn replacing_layer_content_checks_component_locations() {
    let mut font = glyph_axis_font();
    let (layer_id, mut component) = h_spread_component(&font);
    component.set_location(DesignLocation::from([(AxisId::new(), 1.0)]));

    let error = refused(
        &mut font,
        ReplaceGlyphLayerContent {
            layer_id,
            width: 720.0,
            contours: Vec::new(),
            anchors: Vec::new(),
            components: vec![component],
        },
    );

    assert!(matches!(error, CoreError::AxisNotFound(_)));
}
