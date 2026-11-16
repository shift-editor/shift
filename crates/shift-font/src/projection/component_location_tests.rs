//! Components that draw their base glyph somewhere other than where the
//! glyph they sit in is drawn.

use crate::{
    Axis, AxisId, Component, ComponentInheritance, Contour, DesignLocation, Font, Glyph, GlyphId,
    GlyphLayer, LayerId, PointType, Source, SourceId,
};

/// A Bleed axis (0 to 100), a Regular master at 0 and a Bled one at 100.
/// `dot` is a two-point line from `x` to `x + width`: (0, 10) on Regular and
/// (20, 20) on Bled, so its first point's x reads where it was drawn.
/// `H` holds two `dot` components at the origin; `locate` sets each one,
/// given the axis, the master (0 Regular, 1 Bled) and the component index.
struct Bleed {
    font: Font,
    axis: AxisId,
    regular: SourceId,
    bled: SourceId,
    h: GlyphId,
}

fn bleed(locate: impl Fn(AxisId, usize, &mut Component, usize)) -> Bleed {
    let mut font = Font::new();
    font.clear_sources();
    let axis = Axis::new("BLED".into(), "Bleed".into(), 0.0, 0.0, 100.0);
    let axis_id = axis.id();
    font.add_axis(axis).unwrap();
    let regular = font.add_source(Source::new(
        "Regular".into(),
        DesignLocation::from([(axis_id, 0.0)]),
    ));
    let bled = font.add_source(Source::new(
        "Bled".into(),
        DesignLocation::from([(axis_id, 100.0)]),
    ));
    font.set_default_source_id(regular);

    let dot_id = GlyphId::from_raw("dot");
    let mut dot = Glyph::with_id(dot_id, "dot");
    for (source, x, width) in [(regular, 0.0, 10.0), (bled, 20.0, 20.0)] {
        let mut layer = GlyphLayer::with_width(LayerId::new(), source, 0.0);
        let mut contour = Contour::new();
        contour.add_point(x, 0.0, PointType::OnCurve, false);
        contour.add_point(x + width, 0.0, PointType::OnCurve, false);
        layer.add_contour(contour);
        dot.set_layer(layer);
    }
    font.insert_glyph(dot).unwrap();

    let h_id = GlyphId::from_raw("H");
    let mut h = Glyph::with_id(h_id, "H");
    for (master, source) in [regular, bled].into_iter().enumerate() {
        let mut layer = GlyphLayer::with_width(LayerId::new(), source, 720.0);
        for index in 0..2 {
            let mut component = Component::new(dot_id, "dot");
            locate(axis_id, master, &mut component, index);
            layer.add_component(component);
        }
        h.set_layer(layer);
    }
    font.insert_glyph(h).unwrap();

    Bleed {
        font,
        axis: axis_id,
        regular,
        bled,
        h: h_id,
    }
}

impl Bleed {
    /// The first point's x of each `dot` in `H` drawn at `bleed`.
    fn dots_at(&self, bleed: f64) -> Vec<f64> {
        let glyph = self
            .font
            .projection(&DesignLocation::from([(self.axis, bleed)]))
            .glyph(self.h)
            .unwrap()
            .unwrap();
        glyph
            .contours()
            .iter()
            .map(|contour| contour.points[0].x())
            .collect()
    }

    fn layer(&self, source: SourceId) -> LayerId {
        self.font
            .glyph(self.h)
            .unwrap()
            .layer_for_source(source)
            .unwrap()
            .id()
    }
}

#[test]
fn a_component_that_sets_an_axis_draws_its_base_there() {
    let bleed = bleed(|axis, _, component, index| {
        if index == 1 {
            component.set_location(DesignLocation::from([(axis, 100.0)]));
        }
    });

    // The first dot follows H; the second stays at Bleed 100.
    assert_eq!(bleed.dots_at(0.0), vec![0.0, 20.0]);
    assert_eq!(bleed.dots_at(50.0), vec![10.0, 20.0]);
}

#[test]
fn a_component_location_blends_between_masters() {
    // The second dot asks for Bleed 100 on Regular and Bleed 0 on Bled, so
    // halfway it asks for Bleed 50 while the first dot follows H.
    let bleed = bleed(|axis, master, component, index| {
        if index == 1 {
            let value = if master == 0 { 100.0 } else { 0.0 };
            component.set_location(DesignLocation::from([(axis, value)]));
        }
    });

    assert_eq!(bleed.dots_at(0.0), vec![0.0, 20.0]);
    assert_eq!(bleed.dots_at(25.0), vec![5.0, 15.0]);
    assert_eq!(bleed.dots_at(100.0), vec![20.0, 0.0]);
}

#[test]
fn a_component_that_inherits_from_the_font_ignores_its_glyphs_location() {
    let bleed = bleed(|_, _, component, index| {
        if index == 1 {
            component.set_inheritance(ComponentInheritance::Font);
        }
    });

    assert_eq!(bleed.dots_at(100.0), vec![20.0, 0.0]);
}

#[test]
fn an_exact_layer_resolves_its_components_where_they_draw() {
    let bleed = bleed(|_, _, component, index| {
        if index == 1 {
            component.set_inheritance(ComponentInheritance::Font);
        }
    });

    let resolved = bleed.font.resolve_layer(bleed.layer(bleed.bled)).unwrap();
    let firsts: Vec<f64> = resolved
        .outline()
        .iter()
        .map(|contour| contour.points[0].x())
        .collect();

    assert_eq!(firsts, vec![20.0, 0.0]);
    assert_eq!(resolved.components()[1].outline()[0].points[0].x(), 0.0);
}

#[test]
fn masters_that_set_different_axes_do_not_interpolate_together() {
    // Only Regular overrides the second dot.
    let bleed = bleed(|axis, master, component, index| {
        if index == 1 && master == 0 {
            component.set_location(DesignLocation::from([(axis, 100.0)]));
        }
    });
    let glyph = bleed.font.glyph(bleed.h).unwrap();
    let regular = glyph.layer_for_source(bleed.regular).unwrap();
    let bled = glyph.layer_for_source(bleed.bled).unwrap();

    let matched = regular.match_with(bled);

    assert!(!matched.is_complete());
    assert_eq!(
        matched.differences(),
        &[crate::LayerDifference::ComponentLocation { component: 1 }]
    );
    let interpolation = bleed.font.glyph_interpolation(bleed.h).unwrap().unwrap();
    assert_eq!(interpolation.sources().len(), 1);
}
