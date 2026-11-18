//! Glyphs drawn along axes of their own, and drawings located off the
//! font's masters.

use crate::{
    Axis, AxisId, AxisRange, AxisValueUse, Component, Contour, CoreError, DesignLocation, Font,
    Glyph, GlyphAxis, GlyphAxisEdit, GlyphId, GlyphLayer, LayerId, LayerLocation, PointType,
    Source, SourceId,
};

/// A Solenoid-like font: a Bleed axis (0 to 100) with a Regular master at 0
/// and a Bled one at 100.
///
/// `dot` has two axes of its own, Spread and Strike (0 to 100), and is a
/// two-point line drawn four times: (0, 0)–(10, 0) on Regular; shifted 20
/// right on Bled; 100 wider at Spread 100 and 50 higher at Strike 100, both
/// located on Regular. So at Bleed `b`, Spread `s` and Strike `k` its points
/// are (0.2b, 0.5k) and (10 + 0.2b + s, 0.5k).
///
/// `H` holds two `dot` components on both masters: the first sets Spread 60,
/// the second, moved 500 right, sets nothing.
struct Solenoid {
    font: Font,
    bleed: AxisId,
    spread: AxisId,
    strike: AxisId,
    regular: SourceId,
    dot: GlyphId,
    h: GlyphId,
    spread_layer: LayerId,
}

fn line(source: SourceId, from: (f64, f64), to: (f64, f64)) -> GlyphLayer {
    let mut layer = GlyphLayer::with_width(LayerId::new(), source, 0.0);
    layer.add_contour(line_contour(from, to));
    layer
}

fn line_contour(from: (f64, f64), to: (f64, f64)) -> Contour {
    let mut contour = Contour::new();
    contour.add_point(from.0, from.1, PointType::OnCurve, false);
    contour.add_point(to.0, to.1, PointType::OnCurve, false);
    contour
}

fn located_line(location: LayerLocation, from: (f64, f64), to: (f64, f64)) -> GlyphLayer {
    let mut layer = GlyphLayer::located(LayerId::new(), location);
    layer.add_contour(line_contour(from, to));
    layer
}

fn solenoid_masters() -> (Font, AxisId, SourceId, SourceId) {
    let mut font = Font::new();
    font.clear_sources();
    let axis = Axis::new("BLED".into(), "Bleed".into(), 0.0, 0.0, 100.0);
    let bleed = axis.id();
    font.add_axis(axis).unwrap();
    let regular = font.add_source(Source::new(
        "Regular".into(),
        DesignLocation::from([(bleed, 0.0)]),
    ));
    let bled = font.add_source(Source::new(
        "Bled".into(),
        DesignLocation::from([(bleed, 100.0)]),
    ));
    font.set_default_source_id(regular);
    (font, bleed, regular, bled)
}

fn solenoid() -> Solenoid {
    let (mut font, bleed, regular, bled) = solenoid_masters();

    let dot = GlyphId::from_raw("dot");
    let mut glyph = Glyph::with_id(dot, "dot");
    glyph.set_layer(line(regular, (0.0, 0.0), (10.0, 0.0)));
    glyph.set_layer(line(bled, (20.0, 0.0), (30.0, 0.0)));
    font.insert_glyph(glyph).unwrap();
    let spread = font
        .add_glyph_axis(dot, GlyphAxis::new("Spread", 0.0, 0.0, 100.0))
        .unwrap();
    let strike = font
        .add_glyph_axis(dot, GlyphAxis::new("Strike", 0.0, 0.0, 100.0))
        .unwrap();

    let at_regular =
        |axis: AxisId| LayerLocation::new(Some(regular), DesignLocation::from([(axis, 100.0)]));
    let spread_drawing = located_line(at_regular(spread), (0.0, 0.0), (110.0, 0.0));
    let spread_layer = spread_drawing.id();
    font.insert_glyph_layer(dot, spread_drawing).unwrap();
    font.insert_glyph_layer(
        dot,
        located_line(at_regular(strike), (0.0, 50.0), (10.0, 50.0)),
    )
    .unwrap();

    let h = GlyphId::from_raw("H");
    let mut glyph = Glyph::with_id(h, "H");
    for source in [regular, bled] {
        let mut layer = GlyphLayer::with_width(LayerId::new(), source, 720.0);
        let mut spread_dot = Component::new(dot, "dot");
        spread_dot.set_location(DesignLocation::from([(spread, 60.0)]));
        layer.add_component(spread_dot);
        let mut plain_dot = Component::new(dot, "dot");
        plain_dot.translate(500.0, 0.0);
        layer.add_component(plain_dot);
        glyph.set_layer(layer);
    }
    font.insert_glyph(glyph).unwrap();

    Solenoid {
        font,
        bleed,
        spread,
        strike,
        regular,
        dot,
        h,
        spread_layer,
    }
}

/// Each contour of `glyph` drawn at `location`, as its points.
fn outline_at(font: &Font, glyph: GlyphId, location: &DesignLocation) -> Vec<Vec<(f64, f64)>> {
    font.projection(location)
        .glyph(glyph)
        .unwrap()
        .unwrap()
        .contours()
        .iter()
        .map(|contour| {
            contour
                .points
                .iter()
                .map(|point| (point.x(), point.y()))
                .collect()
        })
        .collect()
}

fn location_of(coordinates: &[(AxisId, f64)]) -> DesignLocation {
    coordinates.iter().copied().collect()
}

#[test]
fn a_glyph_interpolates_along_its_own_axis() {
    let s = solenoid();

    let dot = outline_at(&s.font, s.dot, &location_of(&[(s.spread, 50.0)]));

    assert_eq!(dot, vec![vec![(0.0, 0.0), (60.0, 0.0)]]);
}

#[test]
fn a_drawing_on_a_glyph_axis_is_drawn_exactly_there() {
    let s = solenoid();

    let spread = outline_at(
        &s.font,
        s.dot,
        &location_of(&[(s.bleed, 0.0), (s.spread, 100.0)]),
    );
    let strike = outline_at(&s.font, s.dot, &location_of(&[(s.strike, 100.0)]));

    assert_eq!(spread, vec![vec![(0.0, 0.0), (110.0, 0.0)]]);
    assert_eq!(strike, vec![vec![(0.0, 50.0), (10.0, 50.0)]]);
}

#[test]
fn a_component_that_sets_a_glyph_axis_draws_its_base_there() {
    let s = solenoid();

    let h = outline_at(&s.font, s.h, &location_of(&[(s.bleed, 0.0)]));

    // Spread 60 lies between the default drawing and the Spread 100 one.
    assert_eq!(h[0], vec![(0.0, 0.0), (70.0, 0.0)]);
}

#[test]
fn a_glyph_axis_a_component_leaves_unset_is_at_its_default() {
    let s = solenoid();

    // Even where the location being drawn sets the axis: a glyph axis is
    // never inherited from the glyph a component sits in.
    let h = outline_at(
        &s.font,
        s.h,
        &location_of(&[(s.bleed, 0.0), (s.spread, 30.0)]),
    );

    assert_eq!(h[1], vec![(500.0, 0.0), (510.0, 0.0)]);
    assert_eq!(h[0], vec![(0.0, 0.0), (70.0, 0.0)]);
}

#[test]
fn a_font_axis_and_a_glyph_axis_vary_together() {
    let s = solenoid();

    let dot = outline_at(
        &s.font,
        s.dot,
        &location_of(&[(s.bleed, 50.0), (s.spread, 50.0)]),
    );
    let h = outline_at(&s.font, s.h, &location_of(&[(s.bleed, 50.0)]));

    assert_eq!(dot, vec![vec![(10.0, 0.0), (70.0, 0.0)]]);
    assert_eq!(h[0], vec![(10.0, 0.0), (80.0, 0.0)]);
    assert_eq!(h[1], vec![(510.0, 0.0), (520.0, 0.0)]);
}

#[test]
fn a_drawing_located_off_the_masters_is_not_the_layer_on_its_base() {
    let s = solenoid();
    let dot = s.font.glyph(s.dot).unwrap();

    let on_regular = dot.layer_for_source(s.regular).unwrap();

    assert_ne!(on_regular.id(), s.spread_layer);
    assert!(!on_regular.is_located());
    assert_eq!(s.font.masters_with_layers(dot).count(), 2);
    assert_eq!(dot.located_layers(&s.font).count(), 4);
}

#[test]
fn a_range_edit_that_would_strand_a_value_is_refused_and_lists_it() {
    let mut s = solenoid();
    let before = s.font.clone();
    let narrower = AxisRange {
        minimum: 0.0,
        default: 0.0,
        maximum: 50.0,
    };

    let error = s
        .font
        .edit_glyph_axis(s.spread, GlyphAxisEdit::Range(narrower))
        .unwrap_err();

    let CoreError::AxisValuesOutsideRange { axis_id, uses } = error else {
        panic!("expected stranded values, got {error:?}");
    };
    assert_eq!(axis_id, s.spread);
    assert_eq!(
        uses.len(),
        3,
        "the drawing and both masters' components: {uses:?}"
    );
    assert!(uses.contains(&AxisValueUse::Layer {
        glyph_id: s.dot,
        layer_id: s.spread_layer,
        value: 100.0,
    }));
    assert_eq!(
        uses.iter()
            .filter(|value_use| matches!(value_use, AxisValueUse::Component { value, .. } if *value == 60.0))
            .count(),
        2
    );
    assert_eq!(s.font, before);
}

#[test]
fn a_range_edit_that_keeps_every_value_inside_moves_none() {
    let mut s = solenoid();
    let wider = AxisRange {
        minimum: 0.0,
        default: 0.0,
        maximum: 200.0,
    };

    s.font
        .edit_glyph_axis(s.spread, GlyphAxisEdit::Range(wider))
        .unwrap();

    assert_eq!(s.font.glyph_axis(s.spread).unwrap().maximum(), 200.0);
    let spread = outline_at(&s.font, s.dot, &location_of(&[(s.spread, 100.0)]));
    assert_eq!(spread, vec![vec![(0.0, 0.0), (110.0, 0.0)]]);
    let h = outline_at(&s.font, s.h, &location_of(&[(s.bleed, 0.0)]));
    assert_eq!(h[0], vec![(0.0, 0.0), (70.0, 0.0)]);
}

#[test]
fn rescaling_an_axis_moves_every_stored_value_with_it() {
    let mut s = solenoid();
    let h_before = outline_at(&s.font, s.h, &location_of(&[(s.bleed, 50.0)]));
    let rescaled = AxisRange {
        minimum: 0.0,
        default: 0.0,
        maximum: 1000.0,
    };

    s.font
        .edit_glyph_axis(s.spread, GlyphAxisEdit::Rescale(rescaled))
        .unwrap();

    let layer = s.font.layer(s.spread_layer).unwrap();
    assert_eq!(layer.location().coordinates().get(&s.spread), Some(1000.0));
    let values: Vec<f64> = s
        .font
        .glyph_axis_uses(s.spread)
        .unwrap()
        .iter()
        .map(AxisValueUse::value)
        .collect();
    assert_eq!(values, vec![1000.0, 600.0, 600.0]);
    assert_eq!(
        outline_at(&s.font, s.h, &location_of(&[(s.bleed, 50.0)])),
        h_before
    );
    let dot = outline_at(&s.font, s.dot, &location_of(&[(s.spread, 500.0)]));
    assert_eq!(dot, vec![vec![(0.0, 0.0), (60.0, 0.0)]]);
}

#[test]
fn glyph_axis_tags_are_unique_across_the_font() {
    let mut s = solenoid();
    let ring = GlyphId::from_raw("ring");
    s.font.insert_glyph(Glyph::with_id(ring, "ring")).unwrap();

    assert_eq!(s.font.glyph_axis(s.spread).unwrap().tag(), "SPRD");
    assert_eq!(s.font.glyph_axis(s.strike).unwrap().tag(), "STRK");
    let second_spread = s
        .font
        .add_glyph_axis(ring, GlyphAxis::new("Spread", 0.0, 0.0, 1.0))
        .unwrap();
    assert_eq!(s.font.glyph_axis(second_spread).unwrap().tag(), "SPR0");

    for taken in ["SPRD", "BLED"] {
        let axis = GlyphAxis::with_id(AxisId::new(), taken, "Taken", 0.0, 0.0, 1.0);
        let error = s.font.add_glyph_axis(ring, axis).unwrap_err();
        assert!(matches!(error, CoreError::DuplicateAxisTag(tag) if tag == taken));
    }
    let error = s
        .font
        .edit_glyph_axis(second_spread, GlyphAxisEdit::Tag("STRK".into()))
        .unwrap_err();
    assert!(matches!(error, CoreError::DuplicateAxisTag(_)));
    let error = s
        .font
        .add_axis(Axis::new("STRK".into(), "Strike".into(), 0.0, 0.0, 1.0))
        .unwrap_err();
    assert!(matches!(error, CoreError::DuplicateAxisTag(_)));

    s.font
        .edit_glyph_axis(second_spread, GlyphAxisEdit::Tag("RNGS".into()))
        .unwrap();
    assert_eq!(s.font.glyph_axis(second_spread).unwrap().tag(), "RNGS");
    assert!(s.font.is_axis_tag_taken("RNGS"));
    assert!(!s.font.is_axis_tag_taken("SPR0"));
}

#[test]
fn glyph_axis_ids_are_unique_across_the_font() {
    let mut s = solenoid();
    let ring = GlyphId::from_raw("ring");
    s.font.insert_glyph(Glyph::with_id(ring, "ring")).unwrap();

    for id in [s.spread, s.bleed] {
        let axis = GlyphAxis::with_id(id, "RNGS", "Ring", 0.0, 0.0, 1.0);
        let error = s.font.add_glyph_axis(ring, axis).unwrap_err();
        assert!(matches!(error, CoreError::DuplicateAxisId(taken) if taken == id));
    }
}

#[test]
fn a_glyph_axis_must_order_its_range_around_its_default() {
    let mut s = solenoid();

    let error = s
        .font
        .add_glyph_axis(s.dot, GlyphAxis::new("Swell", 0.0, 200.0, 100.0))
        .unwrap_err();

    assert!(matches!(error, CoreError::InvalidAxis { .. }));
}

#[test]
fn a_glyph_axis_with_stored_values_cannot_be_removed() {
    let mut s = solenoid();
    let swell = s
        .font
        .add_glyph_axis(s.dot, GlyphAxis::new("Swell", 0.0, 0.0, 1.0))
        .unwrap();

    let error = s
        .font
        .edit_glyph_axis(s.spread, GlyphAxisEdit::Remove)
        .unwrap_err();
    s.font
        .edit_glyph_axis(swell, GlyphAxisEdit::Remove)
        .unwrap();

    assert!(matches!(error, CoreError::GlyphAxisInUse { uses, .. } if uses.len() == 3));
    assert!(s.font.glyph_axis(swell).is_none());
    assert!(!s.font.is_axis_tag_taken("SWLL"));
}

#[test]
fn a_drawing_must_sit_in_its_glyphs_design_space() {
    let mut s = solenoid();
    let ring = GlyphId::from_raw("ring");
    s.font.insert_glyph(Glyph::with_id(ring, "ring")).unwrap();
    let on = |axis: AxisId, value: f64| {
        LayerLocation::new(Some(s.regular), DesignLocation::from([(axis, value)]))
    };

    let foreign = located_line(on(s.spread, 50.0), (0.0, 0.0), (1.0, 0.0));
    let outside = located_line(on(s.spread, 150.0), (0.0, 0.0), (1.0, 0.0));
    let repeated = located_line(on(s.spread, 100.0), (0.0, 0.0), (1.0, 0.0));

    assert!(matches!(
        s.font.insert_glyph_layer(ring, foreign).unwrap_err(),
        CoreError::LayerLocationOffSpace { axis_id, .. } if axis_id == s.spread
    ));
    assert!(matches!(
        s.font.insert_glyph_layer(s.dot, outside).unwrap_err(),
        CoreError::AxisValuesOutsideRange { .. }
    ));
    assert!(matches!(
        s.font.insert_glyph_layer(s.dot, repeated).unwrap_err(),
        CoreError::DuplicateLayerLocation { first, .. } if first == s.spread_layer
    ));
}

/// `H` drawn on Regular (Bleed 0) and Bled (Bleed 100) as a line 100 and 200
/// long, and at Bleed 50 as one 300 long: a glyph-specific intermediate, a
/// Glyphs "brace layer", located on the font axis with no base source.
fn braced() -> (Font, AxisId, GlyphId) {
    let (mut font, bleed, regular, bled) = solenoid_masters();
    let h = GlyphId::from_raw("H");
    let mut glyph = Glyph::with_id(h, "H");
    glyph.set_layer(line(regular, (0.0, 0.0), (100.0, 0.0)));
    glyph.set_layer(line(bled, (0.0, 0.0), (200.0, 0.0)));
    font.insert_glyph(glyph).unwrap();
    let brace = LayerLocation::at(DesignLocation::from([(bleed, 50.0)]));
    font.insert_glyph_layer(h, located_line(brace, (0.0, 0.0), (300.0, 0.0)))
        .unwrap();
    (font, bleed, h)
}

#[test]
fn a_drawing_between_the_masters_is_drawn_exactly_where_it_sits() {
    let (font, bleed, h) = braced();

    let drawing = outline_at(&font, h, &location_of(&[(bleed, 50.0)]));

    assert_eq!(drawing, vec![vec![(0.0, 0.0), (300.0, 0.0)]]);
}

#[test]
fn a_drawing_between_the_masters_bounds_the_blend_on_each_side() {
    let (font, bleed, h) = braced();

    let quarter = outline_at(&font, h, &location_of(&[(bleed, 25.0)]));
    let three_quarters = outline_at(&font, h, &location_of(&[(bleed, 75.0)]));

    // Regular and the Bleed 50 drawing, then it and Bled.
    assert_eq!(quarter, vec![vec![(0.0, 0.0), (200.0, 0.0)]]);
    assert_eq!(three_quarters, vec![vec![(0.0, 0.0), (250.0, 0.0)]]);
}

#[test]
fn a_master_whose_component_leaves_a_glyph_axis_unset_blends_from_its_default() {
    let mut s = solenoid();
    let bled = s.font.sources()[1].id();
    let colon = GlyphId::from_raw("colon");
    let mut glyph = Glyph::with_id(colon, "colon");
    for (source, spread) in [(s.regular, Some(60.0)), (bled, None)] {
        let mut layer = GlyphLayer::with_width(LayerId::new(), source, 300.0);
        let mut component = Component::new(s.dot, "dot");
        if let Some(value) = spread {
            component.set_location(DesignLocation::from([(s.spread, value)]));
        }
        layer.add_component(component);
        glyph.set_layer(layer);
    }
    s.font.insert_glyph(glyph).unwrap();

    let colon = outline_at(&s.font, colon, &location_of(&[(s.bleed, 50.0)]));

    // Halfway between Spread 60 on Regular and Spread's default on Bled.
    assert_eq!(colon, vec![vec![(10.0, 0.0), (50.0, 0.0)]]);
}
