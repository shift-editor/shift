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

impl Bleed {
    /// Sets `H`'s second `dot` on the Regular master alone, through the intent.
    fn set_on_regular(&mut self, location: DesignLocation, inheritance: ComponentInheritance) {
        let layer_id = self.layer(self.regular);
        let component_id = self
            .font
            .layer(layer_id)
            .and_then(|layer| layer.components_iter().nth(1))
            .map(Component::id)
            .unwrap();
        self.font
            .apply_intents(&crate::FontIntentSet::from(crate::SetComponentLocations {
                layer_id,
                component_ids: vec![component_id],
                locations: vec![location],
                inheritances: vec![inheritance],
            }))
            .unwrap();
    }

    /// The second `dot`'s stored location and inheritance on each master.
    fn second_dots(&self) -> Vec<(DesignLocation, ComponentInheritance)> {
        [self.regular, self.bled]
            .into_iter()
            .map(|source| {
                let layer = self.font.layer(self.layer(source)).unwrap();
                let component = layer.components_iter().nth(1).unwrap();
                (component.location().clone(), component.inheritance())
            })
            .collect()
    }

    fn interpolated_masters(&self) -> usize {
        self.font
            .glyph_interpolation(self.h)
            .unwrap()
            .map_or(0, |interpolation| interpolation.sources().len())
    }
}

#[test]
fn an_axis_set_on_one_master_is_stored_there_only_and_the_glyph_still_interpolates() {
    let mut bleed = bleed(|_, _, _, _| {});

    bleed.set_on_regular(
        DesignLocation::from([(bleed.axis, 0.0)]),
        ComponentInheritance::Parent,
    );

    assert_eq!(
        bleed.second_dots(),
        vec![
            (
                DesignLocation::from([(bleed.axis, 0.0)]),
                ComponentInheritance::Parent
            ),
            (DesignLocation::new(), ComponentInheritance::Parent),
        ]
    );
    assert_eq!(bleed.interpolated_masters(), 2);
    // Bled draws its dot where it inherits it, Bleed 100, so halfway the
    // second dot blends 0 and 100: Bleed 50.
    assert_eq!(bleed.dots_at(50.0), vec![10.0, 10.0]);
}

#[test]
fn a_master_without_the_axis_blends_from_where_it_inherits_it() {
    let mut bleed = bleed(|_, _, _, _| {});

    bleed.set_on_regular(
        DesignLocation::from([(bleed.axis, 100.0)]),
        ComponentInheritance::Parent,
    );

    assert_eq!(bleed.interpolated_masters(), 2);
    assert_eq!(bleed.dots_at(0.0), vec![0.0, 20.0]);
    assert_eq!(bleed.dots_at(50.0), vec![10.0, 20.0]);
    assert_eq!(bleed.dots_at(100.0), vec![20.0, 20.0]);
}

#[test]
fn resetting_an_axis_on_one_master_keeps_the_others_values() {
    let mut bleed = bleed(|axis, master, component, index| {
        if index == 1 {
            let value = if master == 0 { 100.0 } else { 40.0 };
            component.set_location(DesignLocation::from([(axis, value)]));
        }
    });

    bleed.set_on_regular(DesignLocation::new(), ComponentInheritance::Parent);

    assert_eq!(
        bleed.second_dots(),
        vec![
            (DesignLocation::new(), ComponentInheritance::Parent),
            (
                DesignLocation::from([(bleed.axis, 40.0)]),
                ComponentInheritance::Parent
            ),
        ]
    );
    // Regular now inherits Bleed 0; halfway the second dot blends 0 and 40.
    assert_eq!(bleed.dots_at(50.0), vec![10.0, 4.0]);
}

#[test]
fn masters_whose_components_inherit_differently_still_interpolate() {
    // Regular's second dot follows H; Bled's uses the font's location.
    let bleed = bleed(|_, master, component, index| {
        if index == 1 && master == 1 {
            component.set_inheritance(ComponentInheritance::Font);
        }
    });

    assert_eq!(bleed.interpolated_masters(), 2);
    assert_eq!(bleed.dots_at(0.0), vec![0.0, 0.0]);
    // Bled's dot draws at the font's default, Bleed 0, and Regular's at its
    // own Bleed 0, so the second dot stays at Bleed 0 all the way.
    assert_eq!(bleed.dots_at(50.0), vec![10.0, 0.0]);
    assert_eq!(bleed.dots_at(100.0), vec![20.0, 0.0]);
}

impl Bleed {
    /// Adds a Half source at Bleed 50 and gives `H` a layer there, cloned
    /// from Regular with the values interpolation draws at Bleed 50, as the
    /// editor does when a sparse source is selected. Returns each of the
    /// new layer's stored component locations.
    fn materialize_half(&mut self) -> Vec<DesignLocation> {
        let half = DesignLocation::from([(self.axis, 50.0)]);
        let source_id = SourceId::new();
        self.font
            .apply_intents(&crate::FontIntentSet::from(crate::CreateSource {
                source_id,
                name: "Half".into(),
                location: half.clone(),
            }))
            .unwrap();
        let values = self
            .font
            .glyph_interpolation(self.h)
            .unwrap()
            .unwrap()
            .resolve(&half, self.font.axes())
            .unwrap()
            .interpolation_values();

        let layer_id = LayerId::new();
        self.font
            .apply_intents(&crate::FontIntentSet::from(crate::MaterializeGlyphLayer {
                layer_id,
                glyph_id: self.h,
                source_id,
                from_layer_id: self.layer(self.regular),
                values,
            }))
            .unwrap();
        self.font
            .layer(layer_id)
            .unwrap()
            .components_iter()
            .map(|component| component.location().clone())
            .collect()
    }
}

#[test]
fn a_materialized_layer_stores_a_filled_axis_it_does_not_inherit() {
    // Only Bled's second dot sets Bleed, so interpolation reads Regular's
    // with the axis filled in: it blends Bleed 0 and 0, and draws at 0.
    let mut bleed = bleed(|axis, master, component, index| {
        if index == 1 && master == 1 {
            component.set_location(DesignLocation::from([(axis, 0.0)]));
        }
    });
    assert_eq!(bleed.dots_at(50.0), vec![10.0, 0.0]);

    let locations = bleed.materialize_half();

    // Inheriting would put the second dot at Bleed 50, so Half stores 0.
    assert_eq!(
        locations,
        vec![
            DesignLocation::new(),
            DesignLocation::from([(bleed.axis, 0.0)])
        ]
    );
    assert_eq!(bleed.dots_at(50.0), vec![10.0, 0.0]);
}

#[test]
fn a_materialized_layer_drops_a_filled_axis_it_inherits() {
    // Bled's second dot sets Bleed 100, where Bled is, so halfway it blends
    // to Bleed 50: what Half inherits.
    let mut bleed = bleed(|axis, master, component, index| {
        if index == 1 && master == 1 {
            component.set_location(DesignLocation::from([(axis, 100.0)]));
        }
    });

    let locations = bleed.materialize_half();

    assert_eq!(
        locations,
        vec![DesignLocation::new(), DesignLocation::new()]
    );
    assert_eq!(bleed.dots_at(50.0), vec![10.0, 10.0]);
}
