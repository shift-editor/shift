use crate::test_support::sample_font;
use crate::{Anchor, Component, Contour, CoreError, FontIntent, FontIntentSet, GlyphId, PointType};

#[test]
fn replacement_preserves_auxiliary_data_and_refreshes_structure_identity() {
    let mut font = sample_font();
    let layer = font
        .glyph_by_name("A")
        .unwrap()
        .layer_for_source(font.default_source_id().unwrap())
        .unwrap()
        .clone();
    let mut contour = Contour::new();
    let point_id = contour.add_point(20.0, 30.0, PointType::OnCurve, false);
    let contour_id = contour.id();
    let anchor = Anchor::new(Some("top".to_string()), 25.0, 40.0);
    let anchor_id = anchor.id();
    font.apply_intents(FontIntentSet {
        intents: vec![FontIntent::ReplaceGlyphLayerContent {
            layer_id: layer.id(),
            width: 720.0,
            contours: vec![contour],
            anchors: vec![anchor],
            components: Vec::new(),
        }],
    })
    .unwrap();
    let replacement = font.layer(&layer.id()).unwrap();
    assert_eq!(replacement.source_id(), layer.source_id());
    assert_eq!(replacement.height(), layer.height());
    assert_eq!(replacement.guidelines(), layer.guidelines());
    assert_eq!(replacement.lib(), layer.lib());
    assert_eq!(replacement.width(), 720.0);
    assert!(replacement.components().is_empty());
    assert!(font.has_point_id(&point_id));
    assert!(font.has_contour_id(&contour_id));
    assert!(font.has_anchor_id(&anchor_id));
    for contour in layer.contours_iter() {
        assert!(!font.has_contour_id(&contour.id()));
        for point in contour.points() {
            assert!(!font.has_point_id(&point.id()));
        }
    }
    for component in layer.components_iter() {
        assert!(!font.has_component_id(&component.id()));
    }
}

#[test]
fn replacement_rejects_cross_layer_identity_collisions_without_mutation() {
    let mut font = sample_font();
    let source_id = font.default_source_id().unwrap();
    let layer_id = font
        .glyph_by_name("acute")
        .unwrap()
        .layer_for_source(source_id.clone())
        .unwrap()
        .id();
    let contour = font
        .glyph_by_name("A")
        .unwrap()
        .layer_for_source(source_id)
        .unwrap()
        .contours_iter()
        .next()
        .unwrap()
        .clone();
    let before = font.clone();
    let result = font.apply_intents(FontIntentSet {
        intents: vec![FontIntent::ReplaceGlyphLayerContent {
            layer_id,
            width: 500.0,
            contours: vec![contour],
            anchors: Vec::new(),
            components: Vec::new(),
        }],
    });
    assert!(matches!(result, Err(CoreError::DuplicateContourId(_))));
    assert_eq!(font, before);
}

#[test]
fn replacement_rejects_duplicate_and_nonfinite_payloads_before_mutation() {
    let mut font = sample_font();
    let layer_id = font
        .glyph_by_name("A")
        .unwrap()
        .layer_for_source(font.default_source_id().unwrap())
        .unwrap()
        .id();
    let mut contour = Contour::new();
    contour.add_point(10.0, 20.0, PointType::OnCurve, false);
    let before = font.clone();
    for (width, contours) in [
        (500.0, vec![contour.clone(), contour]),
        (f64::NAN, Vec::new()),
    ] {
        assert!(font
            .apply_intents(FontIntentSet {
                intents: vec![FontIntent::ReplaceGlyphLayerContent {
                    layer_id: layer_id.clone(),
                    width,
                    contours,
                    anchors: Vec::new(),
                    components: Vec::new(),
                }],
            })
            .is_err());
        assert_eq!(font, before);
    }
}

#[test]
fn replacement_rejects_missing_and_cyclic_component_bases() {
    let mut font = sample_font();
    let glyph_id = font.glyph_id_by_name("A").unwrap();
    let layer_id = font
        .glyph_by_name("A")
        .unwrap()
        .layer_for_source(font.default_source_id().unwrap())
        .unwrap()
        .id();
    let before = font.clone();
    for base_glyph_id in [GlyphId::new(), glyph_id] {
        assert!(font
            .apply_intents(FontIntentSet {
                intents: vec![FontIntent::ReplaceGlyphLayerContent {
                    layer_id: layer_id.clone(),
                    width: 500.0,
                    contours: Vec::new(),
                    anchors: Vec::new(),
                    components: vec![Component::new(base_glyph_id, "A")],
                }],
            })
            .is_err());
        assert_eq!(font, before);
    }
}
