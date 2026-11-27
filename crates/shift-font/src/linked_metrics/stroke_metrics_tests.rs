//! Linked metrics and sidebearings under ink measure (M4/M5).

use super::*;
use crate::linked_metrics::ReapplyLinkedMetricsScope;
use crate::stroke::style::OutlineStrokeStyle;
use crate::test_support::sample_font;
use crate::{
    Contour, ContourId, CreateGlyph, CreateGlyphLayer, Font, FontIntentSet, GlyphId, LayerId,
    LayerScope, MetricsKey, MetricsKeySide, PointType, ReapplyLinkedMetrics, SetIgnoreStroke,
    SetLiveStroke, SetSidebearings, SidebearingEdit, SourceId,
};

const LEFT: MetricsKeySide = MetricsKeySide::Left;
const RIGHT: MetricsKeySide = MetricsKeySide::Right;
fn add_stroked_glyph(
    font: &mut Font,
    name: &str,
    stem_x: f64,
    vertical: bool,
    style: OutlineStrokeStyle,
) -> (LayerId, ContourId) {
    let source_id = font.default_source_id().unwrap();
    let glyph_id = GlyphId::from_raw(name);
    let layer_id = LayerId::from_raw(format!("{name}_layer"));
    if font.glyph(glyph_id).is_none() {
        font.apply_intents(&FontIntentSet::from(CreateGlyph {
            glyph_id: Some(glyph_id),
            name: name.to_string(),
            unicodes: vec![],
        }))
        .unwrap();
        font.apply_intents(&FontIntentSet::from(CreateGlyphLayer {
            layer_id,
            glyph_id,
            source_id,
        }))
        .unwrap();
    }
    let mut contour = Contour::new();
    if vertical {
        contour.add_point(stem_x, 0.0, PointType::OnCurve, false);
        contour.add_point(stem_x, 200.0, PointType::OnCurve, false);
    } else {
        contour.add_point(50.0, stem_x, PointType::OnCurve, false);
        contour.add_point(250.0, stem_x, PointType::OnCurve, false);
    }
    let mut layer = font.layer(layer_id).unwrap().clone();
    layer.set_x_advance(500.0);
    layer.add_contour(contour);
    font.replace_glyph_layers(vec![layer]).unwrap();
    let contour_id = font
        .layer(layer_id)
        .unwrap()
        .contours_iter()
        .next()
        .unwrap()
        .id();
    font.apply_intents(&FontIntentSet::from(SetLiveStroke {
        layer_id,
        contour_ids: vec![contour_id.clone()],
        style,
        preset_id: None,
    }))
    .unwrap();
    (layer_id, contour_id)
}

fn set_key(font: &mut Font, glyph: &str, side: MetricsKeySide, text: &str) {
    let glyph_id = font.glyph_id_by_name(glyph).unwrap();
    let mut keys = font.glyph(glyph_id).unwrap().metrics_keys().clone();
    keys.set(side, MetricsKey::new(text));
    font.set_glyph_metrics_keys(glyph_id, keys).unwrap();
}

fn current_lsb(font: &Font, source_id: SourceId, glyph: &str) -> f64 {
    let glyph_id = font.glyph_id_by_name(glyph).unwrap();
    MetricsKeyEvaluator::new(font, source_id)
        .unwrap()
        .current(glyph_id, LEFT)
        .unwrap()
}

fn eval_key(
    font: &Font,
    source_id: SourceId,
    glyph: &str,
    side: MetricsKeySide,
    text: &str,
) -> f64 {
    let glyph_id = font.glyph_id_by_name(glyph).unwrap();
    let key = parse(text, &|name| font.glyph_id_by_name(name).is_some()).unwrap();
    MetricsKeyEvaluator::new(font, source_id)
        .unwrap()
        .evaluate(glyph_id, side, &key)
        .unwrap()
}

#[test]
fn key_equal_base_follows_ink_after_stroke_width_changes() {
    let (mut font, source_id, base_layer, contour_id) = stroked_n_with_follower_keyed_to_base();
    assert!(
        (eval_key(&font, source_id, "o", RIGHT, "=n")
            - MetricsKeyEvaluator::new(&font, source_id)
                .unwrap()
                .current(font.glyph_id_by_name("n").unwrap(), RIGHT)
                .unwrap())
        .abs()
            < 1.0
    );

    let before = eval_key(&font, source_id, "o", RIGHT, "=n");
    font.apply_intents(&FontIntentSet::from(SetLiveStroke {
        layer_id: base_layer,
        contour_ids: vec![contour_id],
        style: OutlineStrokeStyle::round(80.0),
        preset_id: None,
    }))
    .unwrap();
    let after = eval_key(&font, source_id, "o", RIGHT, "=n");
    assert_ne!(before, after);
    assert!(
        (after
            - MetricsKeyEvaluator::new(&font, source_id)
                .unwrap()
                .current(font.glyph_id_by_name("n").unwrap(), RIGHT)
                .unwrap())
        .abs()
            < 1.0
    );
}

#[test]
fn height_key_reads_ink_crossing_not_skeleton() {
    let mut font = sample_font();
    let source_id = font.default_source_id().unwrap();
    add_stroked_glyph(
        &mut font,
        "stroke_h",
        100.0,
        true,
        OutlineStrokeStyle::round(40.0),
    );
    let ink = eval_key(&font, source_id, "stroke_h", LEFT, "=stroke_h@50");
    font.apply_set_ignore_stroke(true);
    let skeleton = eval_key(&font, source_id, "stroke_h", LEFT, "=stroke_h@50");
    assert!(ink < skeleton - 5.0);
}

#[test]
fn set_sidebearings_on_stroked_glyph_lands_ink_edge_on_typed_lsb() {
    let mut font = sample_font();
    let source_id = font.default_source_id().unwrap();
    let (layer_id, _) = add_stroked_glyph(
        &mut font,
        "stroke_sb",
        100.0,
        true,
        OutlineStrokeStyle::round(40.0),
    );
    let glyph_id = font.require_layer_owner(layer_id).unwrap();
    let target = 50.0;
    font.apply_intents(&FontIntentSet::from(SetSidebearings {
        glyph_ids: vec![glyph_id],
        scope: LayerScope::Source(source_id),
        left: SidebearingEdit::Set(target),
        right: SidebearingEdit::Keep,
    }))
    .unwrap();
    let extent = font.layer_extent(layer_id).unwrap();
    assert!((extent.left_sidebearing() - target).abs() < 2.0);
}

#[test]
fn set_sidebearings_rsb_moves_advance_to_land_ink_edge() {
    let mut font = sample_font();
    let source_id = font.default_source_id().unwrap();
    let (layer_id, _) = add_stroked_glyph(
        &mut font,
        "stroke_rs",
        100.0,
        true,
        OutlineStrokeStyle::round(40.0),
    );
    let glyph_id = font.require_layer_owner(layer_id).unwrap();
    let target_rsb = 30.0;
    font.apply_intents(&FontIntentSet::from(SetSidebearings {
        glyph_ids: vec![glyph_id],
        scope: LayerScope::Source(source_id),
        left: SidebearingEdit::Keep,
        right: SidebearingEdit::Set(target_rsb),
    }))
    .unwrap();
    let extent = font.layer_extent(layer_id).unwrap();
    let width = font.layer(layer_id).unwrap().width();
    assert!((width - extent.max_x - target_rsb).abs() < 2.0);
}

#[test]
fn flipping_ignore_stroke_touches_no_layer_and_next_key_uses_new_measure() {
    let mut font = sample_font();
    let source_id = font.default_source_id().unwrap();
    let (layer_id, _) = add_stroked_glyph(
        &mut font,
        "stroke_sw",
        100.0,
        true,
        OutlineStrokeStyle::round(40.0),
    );
    let layer_before = font.layer(layer_id).unwrap().clone();
    let ink_lsb = current_lsb(&font, source_id, "stroke_sw");

    let applied = font
        .apply_intents(&FontIntentSet::from(SetIgnoreStroke { ignore: true }))
        .unwrap();
    assert!(applied.layers.is_empty());
    assert_eq!(font.layer(layer_id).unwrap(), &layer_before);

    let skeleton_lsb = current_lsb(&font, source_id, "stroke_sw");
    assert!((skeleton_lsb - 100.0).abs() < 1.0);
    assert!((ink_lsb - skeleton_lsb).abs() > 10.0);

    font.apply_set_ignore_stroke(false);
    assert!((current_lsb(&font, source_id, "stroke_sw") - ink_lsb).abs() < 2.0);
}

#[test]
fn reapply_linked_metrics_glyph_scope_is_one_undo_step_with_redo() {
    let (mut font, source_id, _, _) = stroked_n_with_follower_keyed_to_base();
    let o_id = font.glyph_id_by_name("o").unwrap();
    let n_id = font.glyph_id_by_name("n").unwrap();
    let mut ev = MetricsKeyEvaluator::new(&font, source_id).unwrap();
    let key = parse("=n", &|name| font.glyph_id_by_name(name).is_some()).unwrap();
    let target = ev.evaluate(o_id, LEFT, &key).unwrap();
    let current = ev.current(o_id, LEFT).unwrap();
    assert!(
        (target - current).abs() > 1.0,
        "o needs a correction before reapply (current {current}, target {target})"
    );

    let applied = font
        .apply_intents(&FontIntentSet::from(ReapplyLinkedMetrics {
            scope: ReapplyLinkedMetricsScope::Glyph {
                glyph: n_id,
                source: source_id,
            },
        }))
        .unwrap();
    assert_eq!(applied.changes.changes.len(), 1);
    assert!(!applied.layers.is_empty());

    font.apply_change_set(&applied.changes.inverted()).unwrap();
    font.apply_change_set(&applied.changes).unwrap();
}

#[test]
fn reapply_linked_metrics_font_scope_is_one_undo_step_with_redo() {
    let (mut font, source_id, _, _) = stroked_n_with_follower_keyed_to_base();
    let o_id = font.glyph_id_by_name("o").unwrap();
    let mut ev = MetricsKeyEvaluator::new(&font, source_id).unwrap();
    let key = parse("=n", &|name| font.glyph_id_by_name(name).is_some()).unwrap();
    let target = ev.evaluate(o_id, LEFT, &key).unwrap();
    let current = ev.current(o_id, LEFT).unwrap();
    assert!((target - current).abs() > 1.0);

    let applied = font
        .apply_intents(&FontIntentSet::from(ReapplyLinkedMetrics {
            scope: ReapplyLinkedMetricsScope::Font,
        }))
        .unwrap();
    assert_eq!(applied.changes.changes.len(), 1);

    font.apply_change_set(&applied.changes.inverted()).unwrap();
    font.apply_change_set(&applied.changes).unwrap();
}

/// `n` with a live stroke and `o` linked to `n`'s left via `=n`, from [`super::tests::font`].
fn stroked_n_with_follower_keyed_to_base() -> (Font, SourceId, LayerId, ContourId) {
    let (mut font, source_id) = tests::font();
    let n_id = font.glyph_id_by_name("n").unwrap();
    let layer_id = font
        .glyph(n_id)
        .unwrap()
        .layer_for_source(source_id)
        .unwrap()
        .id();
    let contour_id = font
        .layer(layer_id)
        .unwrap()
        .contours_iter()
        .next()
        .unwrap()
        .id();
    font.apply_intents(&FontIntentSet::from(SetLiveStroke {
        layer_id,
        contour_ids: vec![contour_id.clone()],
        style: OutlineStrokeStyle::round(40.0),
        preset_id: None,
    }))
    .unwrap();
    set_key(&mut font, "o", LEFT, "=n");
    (font, source_id, layer_id, contour_id)
}

#[test]
fn reapply_linked_metrics_disabled_reason_when_glyph_has_no_keys() {
    let mut font = sample_font();
    let source_id = font.default_source_id().unwrap();
    add_stroked_glyph(
        &mut font,
        "stroke_empty",
        100.0,
        true,
        OutlineStrokeStyle::round(40.0),
    );
    add_stroked_glyph(
        &mut font,
        "stroke_keyed",
        200.0,
        true,
        OutlineStrokeStyle::round(20.0),
    );
    set_key(&mut font, "stroke_keyed", LEFT, "=A");
    let glyph_id = font.glyph_id_by_name("stroke_empty").unwrap();
    let reason = font.reapply_linked_metrics_disabled_reason(ReapplyLinkedMetricsScope::Glyph {
        glyph: glyph_id,
        source: source_id,
    });
    assert_eq!(reason, Some("this glyph has no linked metrics"));
}

#[test]
fn stroke_metrics_mutation_check_follows_ink_not_skeleton() {
    let mut font = sample_font();
    let source_id = font.default_source_id().unwrap();
    add_stroked_glyph(
        &mut font,
        "stroke_mut",
        100.0,
        true,
        OutlineStrokeStyle::round(40.0),
    );
    let ink = current_lsb(&font, source_id, "stroke_mut");
    font.apply_set_ignore_stroke(true);
    let skeleton = current_lsb(&font, source_id, "stroke_mut");
    assert_ne!(ink, skeleton);
}
