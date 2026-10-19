use crate::test_support::sample_font;
use crate::{
    AnchorId, AnchorSeed, ComponentAlignment, ComponentId, ContourId, CoreError, Font,
    FontChangeImpact, FontIntent, FontIntentSet, GlyphId, LayerId, PointId, PointSeed, PointType,
    SourceId, Transform,
};

fn apply(font: &mut Font, intents: Vec<FontIntent>) -> crate::AppliedIntents {
    font.apply_intents(FontIntentSet { intents }).unwrap()
}

/// Loads `font` again through serde, as a second engine would: its hash maps get fresh seeds.
fn loaded_independently(font: &Font) -> Font {
    serde_json::from_str(&serde_json::to_string(font).unwrap()).unwrap()
}

fn layer_at(font: &Font, glyph: &str, source_id: &SourceId) -> LayerId {
    font.glyph_by_name(glyph)
        .unwrap()
        .layer_for_source(source_id.clone())
        .unwrap()
        .id()
}

/// The sample font plus twelve composites per source, each stacking `acute`
/// on `A`'s `top` anchor, so moving that anchor realigns many layers.
fn font_with_stacked_composites() -> (Font, Vec<SourceId>) {
    let mut font = sample_font();
    let sources: Vec<SourceId> = font.sources().iter().map(|source| source.id()).collect();
    let acute = GlyphId::from_raw("acute");
    let base = GlyphId::from_raw("A");

    for (index, source_id) in sources.iter().enumerate() {
        let acute_layer = match font
            .glyph(&acute)
            .unwrap()
            .layer_for_source(source_id.clone())
        {
            Some(layer) => layer.id(),
            None => {
                let layer_id = LayerId::from_raw(format!("acute_{index}"));
                apply(
                    &mut font,
                    vec![FontIntent::CreateGlyphLayer {
                        layer_id: layer_id.clone(),
                        glyph_id: acute.clone(),
                        source_id: source_id.clone(),
                    }],
                );
                layer_id
            }
        };
        let base_layer = layer_at(&font, "A", source_id);
        let mut anchors = vec![FontIntent::AddAnchors {
            layer_id: acute_layer,
            anchors: vec![AnchorSeed {
                id: AnchorId::from_raw(format!("acute_mark_{index}")),
                name: Some("_top".to_string()),
                x: 100.0,
                y: 0.0,
            }],
        }];
        if !font
            .layer(&base_layer)
            .unwrap()
            .anchors_iter()
            .any(|anchor| anchor.name() == Some("top"))
        {
            anchors.push(FontIntent::AddAnchors {
                layer_id: base_layer,
                anchors: vec![AnchorSeed {
                    id: AnchorId::from_raw(format!("A_top_{index}")),
                    name: Some("top".to_string()),
                    x: 300.0,
                    y: 700.0,
                }],
            });
        }
        apply(&mut font, anchors);
    }

    for composite in 0..12 {
        let glyph_id = GlyphId::from_raw(format!("stacked{composite}"));
        apply(
            &mut font,
            vec![FontIntent::CreateGlyph {
                glyph_id: Some(glyph_id.clone()),
                name: format!("stacked{composite}"),
                unicodes: Vec::new(),
            }],
        );
        for (index, source_id) in sources.iter().enumerate() {
            let layer_id = LayerId::from_raw(format!("stacked{composite}_{index}"));
            let mark = ComponentId::from_raw(format!("stacked{composite}_{index}_mark"));
            apply(
                &mut font,
                vec![
                    FontIntent::CreateGlyphLayer {
                        layer_id: layer_id.clone(),
                        glyph_id: glyph_id.clone(),
                        source_id: source_id.clone(),
                    },
                    FontIntent::AddComponent {
                        layer_id: layer_id.clone(),
                        component_id: ComponentId::from_raw(format!(
                            "stacked{composite}_{index}_base"
                        )),
                        base_glyph_id: base.clone(),
                    },
                    FontIntent::AddComponent {
                        layer_id: layer_id.clone(),
                        component_id: mark.clone(),
                        base_glyph_id: acute.clone(),
                    },
                    FontIntent::SetComponentAlignment {
                        layer_id,
                        component_ids: vec![mark],
                        alignment: ComponentAlignment::Anchored,
                    },
                ],
            );
        }
    }

    (font, sources)
}

#[test]
fn independently_loaded_fonts_produce_identical_changesets() {
    let (font, sources) = font_with_stacked_composites();
    let mut first = loaded_independently(&font);
    let mut second = loaded_independently(&font);

    for (step, source_id) in sources.iter().cycle().take(8).enumerate() {
        let layer_id = layer_at(&first, "A", source_id);
        let top = first
            .layer(&layer_id)
            .unwrap()
            .anchors_iter()
            .find(|anchor| anchor.name() == Some("top"))
            .unwrap()
            .id();
        let intents = vec![FontIntent::MoveAnchors {
            layer_id,
            anchor_ids: vec![top],
            coords: vec![300.0 + step as f64 * 7.0, 720.0],
        }];

        let from_first = apply(&mut first, intents.clone());
        let from_second = apply(&mut second, intents);

        assert!(
            from_first.changes.changes.len() > 2,
            "the anchor move realigns composites"
        );
        assert_eq!(
            format!("{:?}", from_first.changes),
            format!("{:?}", from_second.changes)
        );
        let touched = |applied: &crate::AppliedIntents| {
            applied
                .layers
                .iter()
                .map(|touched| touched.layer.id())
                .collect::<Vec<_>>()
        };
        assert_eq!(touched(&from_first), touched(&from_second));
    }
    assert!(first == second);
}

#[test]
fn layer_edits_resend_glyph_records_only_when_records_change() {
    let mut font = sample_font();
    let layer_id = LayerId::from_raw("A_regular");

    let reversed = apply(
        &mut font,
        vec![FontIntent::ReverseContour {
            layer_id: layer_id.clone(),
            contour_id: ContourId::from_raw("A_outer"),
        }],
    );
    assert!(reversed.layers[0].structural);
    assert!(!reversed.changes.impact().contains(FontChangeImpact::GLYPHS));

    let drawn = apply(
        &mut font,
        vec![FontIntent::AddPoints {
            layer_id: layer_id.clone(),
            contour_id: Some(ContourId::from_raw("A_outer")),
            before: None,
            points: vec![PointSeed {
                id: PointId::from_raw("drawn"),
                x: 1.0,
                y: 2.0,
                point_type: PointType::OnCurve,
                smooth: false,
            }],
        }],
    );
    assert!(!drawn.changes.impact().contains(FontChangeImpact::GLYPHS));

    // A new component base changes the record's componentBaseGlyphIds.
    let composed = apply(
        &mut font,
        vec![FontIntent::AddComponent {
            layer_id: layer_id.clone(),
            component_id: ComponentId::from_raw("added"),
            base_glyph_id: GlyphId::from_raw("acute"),
        }],
    );
    assert!(composed.changes.impact().contains(FontChangeImpact::GLYPHS));

    let removed = apply(
        &mut font,
        vec![FontIntent::RemoveComponents {
            layer_id,
            component_ids: vec![ComponentId::from_raw("added")],
        }],
    );
    assert!(removed.changes.impact().contains(FontChangeImpact::GLYPHS));
}

#[test]
fn non_finite_coordinates_are_rejected_without_changing_the_font() {
    let original = sample_font();
    let layer_id = LayerId::from_raw("A_regular");
    let point = PointId::from_raw("A_0");
    let anchor = AnchorId::from_raw("A_top");

    for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let intents = [
            FontIntent::MovePoints {
                layer_id: layer_id.clone(),
                point_ids: vec![point.clone()],
                coords: vec![bad, 0.0],
            },
            FontIntent::TranslatePoints {
                layer_id: layer_id.clone(),
                point_ids: vec![point.clone()],
                dx: 0.0,
                dy: bad,
            },
            FontIntent::AddPoints {
                layer_id: layer_id.clone(),
                contour_id: Some(ContourId::from_raw("A_outer")),
                before: None,
                points: vec![PointSeed {
                    id: PointId::from_raw("bad"),
                    x: bad,
                    y: 0.0,
                    point_type: PointType::OnCurve,
                    smooth: false,
                }],
            },
            FontIntent::AddAnchors {
                layer_id: layer_id.clone(),
                anchors: vec![AnchorSeed {
                    id: AnchorId::from_raw("bad"),
                    name: Some("bottom".to_string()),
                    x: 0.0,
                    y: bad,
                }],
            },
            FontIntent::MoveAnchors {
                layer_id: layer_id.clone(),
                anchor_ids: vec![anchor.clone()],
                coords: vec![bad, 0.0],
            },
            FontIntent::SetXAdvance {
                layer_id: layer_id.clone(),
                width: bad,
            },
            FontIntent::TransformLayer {
                layer_id: layer_id.clone(),
                transform: Transform {
                    xx: bad,
                    xy: 0.0,
                    yx: 0.0,
                    yy: 1.0,
                    dx: 0.0,
                    dy: 0.0,
                },
            },
        ];

        for intent in intents {
            let mut font = original.clone();
            let result = font.apply_intents(FontIntentSet {
                intents: vec![intent.clone()],
            });
            assert!(
                matches!(result, Err(CoreError::InvalidPositionUpdateInput { .. })),
                "{intent:?} should be rejected, got {:?}",
                result.map(|applied| applied.changes)
            );
            assert!(font == original, "{intent:?} changed the font");
        }
    }
}

#[test]
fn negative_zero_is_stored_as_zero() {
    let mut font = sample_font();
    let layer_id = LayerId::from_raw("A_regular");
    let positive = |value: f64| value.to_bits() == 0.0_f64.to_bits();
    apply(
        &mut font,
        vec![
            FontIntent::MovePoints {
                layer_id: layer_id.clone(),
                point_ids: vec![PointId::from_raw("A_0")],
                coords: vec![-0.0, -0.0],
            },
            FontIntent::AddAnchors {
                layer_id: layer_id.clone(),
                anchors: vec![AnchorSeed {
                    id: AnchorId::from_raw("zero"),
                    name: Some("bottom".to_string()),
                    x: -0.0,
                    y: -0.0,
                }],
            },
            FontIntent::SetXAdvance {
                layer_id: layer_id.clone(),
                width: -0.0,
            },
            FontIntent::SetComponentTransforms {
                layer_id: layer_id.clone(),
                component_ids: vec![ComponentId::from_raw("a_second")],
                transforms: vec![-0.0, -0.0, -0.0, 1.0, 1.0, -0.0, -0.0, -0.0, -0.0],
            },
        ],
    );

    let layer = font.layer(&layer_id).unwrap();
    let point = layer
        .contours_iter()
        .flat_map(|c| c.points())
        .find(|p| p.id() == PointId::from_raw("A_0"))
        .unwrap();
    assert!(positive(point.x()) && positive(point.y()));
    let anchor = layer.anchor(&AnchorId::from_raw("zero")).unwrap();
    assert!(positive(anchor.x()) && positive(anchor.y()));
    assert!(positive(layer.width()));
    let transform = layer
        .component(&ComponentId::from_raw("a_second"))
        .unwrap()
        .transform();
    for value in [
        transform.translate_x,
        transform.translate_y,
        transform.rotation,
        transform.skew_x,
        transform.skew_y,
    ] {
        assert!(positive(value), "{transform:?}");
    }

    // Values installed in bulk (a load, an echo) are stored the same way.
    let mut values = shift_wire_like_values(layer);
    values
        .iter_mut()
        .filter(|value| **value == 0.0)
        .for_each(|value| *value = -0.0);
    let mut reloaded = layer.clone();
    reloaded
        .apply_interpolation_values(&crate::GlyphInterpolationValues::new(values))
        .unwrap();
    assert_eq!(reloaded, *layer);
}

/// The layer's values in interpolation order, as a transport would carry them.
fn shift_wire_like_values(layer: &crate::GlyphLayer) -> Vec<f64> {
    crate::GlyphInterpolationValues::from_layer(layer).into_vec()
}
