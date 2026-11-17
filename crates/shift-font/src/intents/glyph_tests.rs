use crate::linked_metrics::MetricsKeyEvaluator;
use crate::{
    Anchor, Component, DecomposeGlyphs, DecomposedTransform, DuplicateGlyphs, Font, FontIntentSet,
    Glyph, GlyphCopy, GlyphId, GlyphLayer, LayerId, LayerScope, MarkColor, MetricsKey,
    MetricsKeySide, NamedMarkColor, SetSidebearings, SidebearingEdit, SourceId, contour,
};

/// A font whose default source draws `box` (a 400-unit square at x 100 in a
/// 600 advance, with a `top` anchor), `shifted` (`box` moved 50 right, in a
/// 700 advance), `twice` (`shifted` again, nesting `box`) and `empty`.
fn boxes_font() -> (Font, SourceId) {
    let mut font = Font::new();
    let source_id = font.default_source_id().unwrap();
    let mut add = |name: &str, width: f64, fill: &dyn Fn(&mut GlyphLayer)| {
        let mut glyph = Glyph::with_id(GlyphId::from_raw(name), name);
        let mut layer = GlyphLayer::with_width(LayerId::from_raw(name), source_id, width);
        fill(&mut layer);
        glyph.set_layer(layer);
        font.insert_glyph(glyph).unwrap();
    };
    let component = |base: &str, x: f64| {
        Component::with_transform(
            GlyphId::from_raw(base),
            base,
            DecomposedTransform {
                translate_x: x,
                ..DecomposedTransform::identity()
            },
        )
    };
    add("box", 600.0, &|layer| {
        layer.add_contour(contour![(100, 0), (500, 0), (500, 400), (100, 400)]);
        layer.add_anchor(Anchor::new(Some("top".to_string()), 300.0, 400.0));
    });
    add("shifted", 700.0, &|layer| {
        layer.add_component(component("box", 50.0));
        layer.add_anchor(Anchor::new(Some("own".to_string()), 10.0, 20.0));
    });
    add("twice", 800.0, &|layer| {
        layer.add_component(component("shifted", 0.0));
    });
    add("empty", 300.0, &|_| {});
    (font, source_id)
}

fn glyph_called(name: &str) -> GlyphId {
    GlyphId::from_raw(name)
}

/// The left and right sidebearings of each of `names` as `source_id` draws
/// them, `None` for a glyph that draws nothing.
fn side_values(font: &Font, source_id: SourceId, names: &[&str]) -> Vec<Option<(f64, f64)>> {
    let mut evaluator = MetricsKeyEvaluator::new(font, source_id).unwrap();
    names
        .iter()
        .map(|name| {
            let glyph_id = font.glyph_by_name(name)?.id();
            let left = evaluator.current(glyph_id, MetricsKeySide::Left).ok()?;
            let right = evaluator.current(glyph_id, MetricsKeySide::Right).ok()?;
            Some((left, right))
        })
        .collect()
}

fn set_sidebearings(
    font: &mut Font,
    names: &[&str],
    scope: LayerScope,
    left: SidebearingEdit,
    right: SidebearingEdit,
) {
    font.apply_intents(&FontIntentSet::from(SetSidebearings {
        glyph_ids: names.iter().map(|name| glyph_called(name)).collect(),
        scope,
        left,
        right,
    }))
    .unwrap();
}

/// Copies `box` once per id in `copy_ids`.
fn duplicate_box(font: &mut Font, copy_ids: &[&str]) -> crate::AppliedIntents {
    let copies = copy_ids
        .iter()
        .map(|copy_id| GlyphCopy {
            glyph_id: glyph_called("box"),
            copy_id: glyph_called(copy_id),
        })
        .collect();
    font.apply_intents(&FontIntentSet::from(DuplicateGlyphs { copies }))
        .unwrap()
}

#[test]
fn a_copy_takes_a_numbered_name_and_everything_but_the_code_points() {
    let (mut font, source_id) = boxes_font();
    let purple = Some(MarkColor::Named(NamedMarkColor::Purple));
    font.set_mark_color(&[glyph_called("box")], purple).unwrap();
    font.set_glyph_unicodes(glyph_called("box"), vec![0x25A1])
        .unwrap();
    let link = SidebearingEdit::Link("=|".to_string());
    set_sidebearings(
        &mut font,
        &["box"],
        LayerScope::Source(source_id),
        SidebearingEdit::Keep,
        link,
    );

    let applied = duplicate_box(&mut font, &["first", "second"]);

    let copy = font.glyph(glyph_called("first")).unwrap();
    let names = ["first", "second"].map(|copy| font.glyph(glyph_called(copy)).unwrap().name());
    assert_eq!(names, ["box.001", "box.002"]);
    assert!(copy.unicodes().is_empty());
    assert_eq!(copy.mark_color(), purple);
    assert_eq!(
        copy.metrics_keys().get(MetricsKeySide::Right),
        MetricsKey::new("=|").as_ref()
    );
    assert_eq!(
        side_values(&font, source_id, &["box.001"]),
        vec![Some((100.0, 100.0))]
    );

    font.apply_change_set(&applied.changes.inverted()).unwrap();
    assert!(
        font.glyph(glyph_called("first")).is_none() && font.glyph(glyph_called("second")).is_none()
    );
}

#[test]
fn a_copys_layers_share_no_ids_with_the_originals() {
    let (mut font, source_id) = boxes_font();

    duplicate_box(&mut font, &["copy"]);

    let layer = font
        .glyph(glyph_called("box"))
        .unwrap()
        .layer_for_source(source_id)
        .unwrap();
    let copied = font
        .glyph(glyph_called("copy"))
        .unwrap()
        .layer_for_source(source_id)
        .unwrap();
    assert_ne!(copied.id(), layer.id());
    assert_eq!(copied.width(), layer.width());
    assert_eq!(copied.anchor_names().collect::<Vec<_>>(), [Some("top")]);
    let original_ids: Vec<_> = layer.points().map(crate::Point::id).collect();
    assert_eq!(copied.points().count(), original_ids.len());
    assert!(
        copied
            .points()
            .all(|point| !original_ids.contains(&point.id()))
    );
}

#[test]
fn decomposing_glyphs_flattens_nested_components_and_keeps_their_own_anchors() {
    let (mut font, source_id) = boxes_font();
    let before = side_values(&font, source_id, &["shifted", "twice"]);

    let applied = font
        .apply_intents(&FontIntentSet::from(DecomposeGlyphs {
            glyph_ids: vec![
                glyph_called("shifted"),
                glyph_called("twice"),
                glyph_called("box"),
            ],
        }))
        .unwrap();

    for name in ["shifted", "twice"] {
        let layer = font.layer(LayerId::from_raw(name)).unwrap();
        assert!(layer.components().is_empty(), "{name}");
        assert_eq!(layer.contours().len(), 1, "{name}");
    }
    assert_eq!(side_values(&font, source_id, &["shifted", "twice"]), before);
    let shifted = font.layer(LayerId::from_raw("shifted")).unwrap();
    assert_eq!(shifted.anchor_names().collect::<Vec<_>>(), [Some("own")]);
    // `box` has no components, so the edit leaves it out.
    assert_eq!(applied.layers.len(), 2);

    font.apply_change_set(&applied.changes.inverted()).unwrap();
    assert_eq!(
        font.layer(LayerId::from_raw("twice"))
            .unwrap()
            .components()
            .len(),
        1
    );
}

#[test]
fn setting_sidebearings_gives_bases_and_the_composites_built_from_them_the_same_values() {
    let (mut font, source_id) = boxes_font();

    set_sidebearings(
        &mut font,
        &["twice", "box", "shifted", "empty"],
        LayerScope::Source(source_id),
        SidebearingEdit::Set(40.0),
        SidebearingEdit::Set(60.0),
    );

    assert_eq!(
        side_values(&font, source_id, &["box", "shifted", "twice", "empty"]),
        vec![
            Some((40.0, 60.0)),
            Some((40.0, 60.0)),
            Some((40.0, 60.0)),
            None
        ]
    );
    // A glyph that draws nothing has no sidebearings to set.
    assert_eq!(
        font.layer(LayerId::from_raw("empty")).unwrap().width(),
        300.0
    );
}

#[test]
fn adjusting_skips_a_linked_side_and_setting_breaks_the_link() {
    use SidebearingEdit::{Adjust, Keep, Link, Set};
    let (mut font, source_id) = boxes_font();
    let scope = LayerScope::Source(source_id);
    let box_sides = |font: &Font| side_values(font, source_id, &["box"])[0];
    set_sidebearings(&mut font, &["box"], scope, Keep, Link("=|".to_string()));
    assert_eq!(box_sides(&font), Some((100.0, 100.0)));

    // The left side moves and the linked right side follows it instead of taking +500.
    set_sidebearings(&mut font, &["box"], scope, Adjust(-30.0), Adjust(500.0));
    assert_eq!(box_sides(&font), Some((70.0, 70.0)));

    set_sidebearings(&mut font, &["box"], scope, Keep, Set(10.0));
    assert_eq!(box_sides(&font), Some((70.0, 10.0)));
    assert!(
        font.glyph(glyph_called("box"))
            .unwrap()
            .metrics_keys()
            .is_empty()
    );
}

#[test]
fn every_master_edits_each_masters_layer_and_one_source_only_its_own() {
    let mut font = crate::test_support::sample_font();
    let [regular, bold] = ["regular", "bold"].map(SourceId::from_raw);
    let widths = |font: &Font| {
        ["A_regular", "A_bold"].map(|layer| font.layer(LayerId::from_raw(layer)).unwrap().width())
    };
    assert_eq!(widths(&font), [600.0, 650.0]);

    set_sidebearings(
        &mut font,
        &["A"],
        LayerScope::Source(bold),
        SidebearingEdit::Keep,
        SidebearingEdit::Adjust(10.0),
    );
    assert_eq!(widths(&font), [600.0, 660.0]);

    set_sidebearings(
        &mut font,
        &["A"],
        LayerScope::EveryMaster,
        SidebearingEdit::Keep,
        SidebearingEdit::Adjust(5.0),
    );
    assert_eq!(widths(&font), [605.0, 665.0]);
    assert!(font.source(regular).is_some());
}
