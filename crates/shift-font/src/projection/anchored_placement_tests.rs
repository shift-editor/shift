//! Anchored components placed from anchors read where each glyph is drawn.

use crate::{
    Anchor, Axis, AxisId, Component, ComponentAlignment, Contour, DesignLocation, Font, Glyph,
    GlyphId, GlyphLayer, LayerId, OpenTypeCategory, PointType, Source,
};

/// A Bleed axis (0 to 100), a Regular master at 0 and a Bled one at 100,
/// and `eacute` = `e` + `acutecomb` + `dotcomb`, the marks anchored and stored
/// where following anchors at each master put them.
///
/// | glyph       | contour starts at (Regular, Bled) | anchors (Regular, Bled)          |
/// |-------------|-----------------------------------|----------------------------------|
/// | `e`         | 0, 0                              | `top` 50, 80                     |
/// | `acutecomb` | 10, 40                            | `_top` 20, 60; `top` 20, 100     |
/// | `dotcomb`   | 0, 0                              | `_top` 0, 0                      |
///
/// So the stored offsets are `acutecomb` 30, 20 and `dotcomb` 50, 120.
/// `acute_bleed` sets `acutecomb`'s Bleed on both masters.
struct Eacute {
    font: Font,
    axis: AxisId,
    eacute: GlyphId,
}

fn eacute(acute_bleed: Option<f64>) -> Eacute {
    let mut font = Font::new();
    font.clear_sources();
    let axis = Axis::new("BLED".into(), "Bleed".into(), 0.0, 0.0, 100.0);
    let axis_id = axis.id();
    font.add_axis(axis).unwrap();
    let sources = [
        font.add_source(Source::new(
            "Regular".into(),
            DesignLocation::from([(axis_id, 0.0)]),
        )),
        font.add_source(Source::new(
            "Bled".into(),
            DesignLocation::from([(axis_id, 100.0)]),
        )),
    ];
    font.set_default_source_id(sources[0]);

    let simple = |font: &mut Font, name: &str, starts: [f64; 2], anchors: &[(&str, [f64; 2])]| {
        let id = GlyphId::from_raw(name);
        let mut glyph = Glyph::with_id(id, name);
        for (master, source) in sources.into_iter().enumerate() {
            let mut layer = GlyphLayer::with_width(LayerId::new(), source, 0.0);
            let mut contour = Contour::new();
            contour.add_point(starts[master], 0.0, PointType::OnCurve, false);
            contour.add_point(starts[master] + 10.0, 0.0, PointType::OnCurve, false);
            layer.add_contour(contour);
            for (anchor, xs) in anchors {
                layer.add_anchor(Anchor::new(anchor.to_string(), xs[master], 0.0));
            }
            glyph.set_layer(layer);
        }
        font.insert_glyph(glyph).unwrap();
        id
    };
    let e = simple(&mut font, "e", [0.0, 0.0], &[("top", [50.0, 80.0])]);
    let acute = simple(
        &mut font,
        "acutecomb",
        [10.0, 40.0],
        &[("_top", [20.0, 60.0]), ("top", [20.0, 100.0])],
    );
    let dot = simple(&mut font, "dotcomb", [0.0, 0.0], &[("_top", [0.0, 0.0])]);

    let eacute = GlyphId::from_raw("eacute");
    let mut glyph = Glyph::with_id(eacute, "eacute");
    for (master, source) in sources.into_iter().enumerate() {
        let mut layer = GlyphLayer::with_width(LayerId::new(), source, 500.0);
        layer.add_component(Component::new(e, "e"));
        for (base, name, offset) in [
            (acute, "acutecomb", [30.0, 20.0]),
            (dot, "dotcomb", [50.0, 120.0]),
        ] {
            let mut component = Component::new(base, name);
            component.set_alignment(ComponentAlignment::Anchored);
            component.translate(offset[master], 0.0);
            if base == acute
                && let Some(bleed) = acute_bleed
            {
                component.set_location(DesignLocation::from([(axis_id, bleed)]));
            }
            layer.add_component(component);
        }
        glyph.set_layer(layer);
    }
    font.insert_glyph(glyph).unwrap();

    Eacute {
        font,
        axis: axis_id,
        eacute,
    }
}

impl Eacute {
    /// Where `acutecomb` and `dotcomb` start in `eacute` drawn at `bleed`.
    fn marks_at(&self, bleed: f64) -> [f64; 2] {
        let glyph = self
            .font
            .projection(&self.location(bleed))
            .glyph(self.eacute)
            .unwrap()
            .unwrap();
        let starts: Vec<f64> = glyph
            .contours()
            .iter()
            .map(|contour| contour.points[0].x())
            .collect();
        [starts[1], starts[2]]
    }

    /// `eacute`'s compiled `top` anchor at `bleed`: the stacked mark's.
    fn compiled_top_at(&self, bleed: f64) -> f64 {
        let anchors = self
            .font
            .projection(&self.location(bleed))
            .compiled_anchors(self.eacute, &|glyph| {
                (glyph != self.eacute && glyph.as_str() != "e").then_some(OpenTypeCategory::Mark)
            })
            .unwrap()
            .unwrap();
        anchors
            .anchors
            .iter()
            .find(|anchor| anchor.name == "top")
            .unwrap()
            .x
    }

    fn location(&self, bleed: f64) -> DesignLocation {
        DesignLocation::from([(self.axis, bleed)])
    }
}

/// One placement case: where the accent is set, where `eacute` is drawn, and
/// where its marks start.
struct Case {
    name: &'static str,
    acute_bleed: Option<f64>,
    bleed: f64,
    marks: [f64; 2],
}
const CASES: [Case; 5] = [
    Case {
        name: "no location set: as stored",
        acute_bleed: None,
        bleed: 0.0,
        marks: [40.0, 50.0],
    },
    Case {
        name: "no location set, between masters: as stored, blended",
        acute_bleed: None,
        bleed: 50.0,
        marks: [50.0, 85.0],
    },
    // The accent is drawn at Bled: its `_top` is 60 there, `e`'s `top`
    // 50, so it starts at 40 - 10; its `top` lands at 100 - 10.
    Case {
        name: "accent at Bled, glyph at Regular",
        acute_bleed: Some(100.0),
        bleed: 0.0,
        marks: [30.0, 90.0],
    },
    // `e`'s `top` blends to 65, so the accent moves by 5.
    Case {
        name: "accent at Bled, glyph between masters",
        acute_bleed: Some(100.0),
        bleed: 50.0,
        marks: [45.0, 105.0],
    },
    Case {
        name: "accent at Bled, glyph at Bled: as stored",
        acute_bleed: Some(100.0),
        bleed: 100.0,
        marks: [60.0, 120.0],
    },
];

#[test]
fn anchored_marks_sit_on_anchors_read_where_each_glyph_is_drawn() {
    for case in CASES {
        let eacute = eacute(case.acute_bleed);
        assert_eq!(eacute.marks_at(case.bleed), case.marks, "{}", case.name);
        // Propagation reads the stacked mark where it is drawn.
        assert_eq!(
            eacute.compiled_top_at(case.bleed),
            case.marks[1],
            "{}",
            case.name
        );
    }
}
