use crate::test_support::sample_font;
use crate::{
    AddAnchors, AddComponent, AddPoints, Anchor, AnchorId, AnchorSeed, AppliedIntents,
    ComponentAlignment, ComponentId, ContourId, CoreError, CreateGlyph, CreateGlyphLayer, Font,
    FontChangeImpact, FontIntent, FontIntentSet, GlyphId, GlyphInterpolationValues, LayerId,
    MoveAnchors, MovePoints, Point, PointId, PointSeed, PointType, RemoveComponents,
    ReverseContour, SetComponentAlignment, SetComponentTransforms, SetPositions, SetXAdvance,
    Source, SourceId, Transform, TransformLayer, TranslatePoints,
};

fn apply(font: &mut Font, intents: impl IntoIterator<Item = FontIntent>) -> AppliedIntents {
    font.apply_intents(&intents.into_iter().collect()).unwrap()
}

/// Loads `font` again through serde, as a second engine would: its hash maps
/// get fresh seeds.
fn loaded_independently(font: &Font) -> Font {
    serde_json::from_str(&serde_json::to_string(font).unwrap()).unwrap()
}

fn layer_at(font: &Font, glyph: &str, source_id: SourceId) -> LayerId {
    font.glyph_by_name(glyph)
        .unwrap()
        .layer_for_source(source_id)
        .unwrap()
        .id()
}

/// The sample font plus twelve composites per source, each stacking `acute`
/// on `A`'s `top` anchor, so moving that anchor realigns many layers.
fn font_with_stacked_composites() -> (Font, Vec<SourceId>) {
    let mut font = sample_font();
    let sources: Vec<SourceId> = font.sources().iter().map(Source::id).collect();
    let acute = GlyphId::from_raw("acute");
    let base = GlyphId::from_raw("A");

    for (index, source_id) in sources.iter().enumerate() {
        let acute_layer = match font.glyph(acute).unwrap().layer_for_source(*source_id) {
            Some(layer) => layer.id(),
            None => {
                let layer_id = LayerId::from_raw(format!("acute_{index}"));
                apply(
                    &mut font,
                    [CreateGlyphLayer {
                        layer_id,
                        glyph_id: acute,
                        source_id: *source_id,
                    }
                    .into()],
                );
                layer_id
            }
        };
        let base_layer = layer_at(&font, "A", *source_id);
        let mut anchors: Vec<FontIntent> = vec![
            AddAnchors {
                layer_id: acute_layer,
                anchors: vec![AnchorSeed {
                    id: AnchorId::from_raw(format!("acute_mark_{index}")),
                    name: Some("_top".to_string()),
                    x: 100.0,
                    y: 0.0,
                }],
            }
            .into(),
        ];
        if !font
            .layer(base_layer)
            .unwrap()
            .anchors_iter()
            .any(|anchor| anchor.name() == Some("top"))
        {
            anchors.push(
                AddAnchors {
                    layer_id: base_layer,
                    anchors: vec![AnchorSeed {
                        id: AnchorId::from_raw(format!("A_top_{index}")),
                        name: Some("top".to_string()),
                        x: 300.0,
                        y: 700.0,
                    }],
                }
                .into(),
            );
        }
        apply(&mut font, anchors);
    }

    for composite in 0..12 {
        let glyph_id = GlyphId::from_raw(format!("stacked{composite}"));
        apply(
            &mut font,
            [CreateGlyph {
                glyph_id: Some(glyph_id),
                name: format!("stacked{composite}"),
                unicodes: Vec::new(),
            }
            .into()],
        );
        for (index, source_id) in sources.iter().enumerate() {
            let layer_id = LayerId::from_raw(format!("stacked{composite}_{index}"));
            let mark = ComponentId::from_raw(format!("stacked{composite}_{index}_mark"));
            apply(
                &mut font,
                [
                    CreateGlyphLayer {
                        layer_id,
                        glyph_id,
                        source_id: *source_id,
                    }
                    .into(),
                    AddComponent {
                        layer_id,
                        component_id: ComponentId::from_raw(format!(
                            "stacked{composite}_{index}_base"
                        )),
                        base_glyph_id: base,
                    }
                    .into(),
                    AddComponent {
                        layer_id,
                        component_id: mark.clone(),
                        base_glyph_id: acute,
                    }
                    .into(),
                    SetComponentAlignment {
                        layer_id,
                        component_ids: vec![mark],
                        alignment: ComponentAlignment::Anchored,
                    }
                    .into(),
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
        let layer_id = layer_at(&first, "A", *source_id);
        let top = first
            .layer(layer_id)
            .unwrap()
            .anchors_iter()
            .find(|anchor| anchor.name() == Some("top"))
            .unwrap()
            .id();
        let intent: FontIntent = MoveAnchors {
            layer_id,
            anchor_ids: vec![top],
            coords: vec![300.0 + f64::from(u8::try_from(step).unwrap()) * 7.0, 720.0],
        }
        .into();

        let from_first = apply(&mut first, [intent.clone()]);
        let from_second = apply(&mut second, [intent]);

        assert!(
            from_first.changes.changes.len() > 2,
            "the anchor move realigns composites"
        );
        assert_eq!(from_first.changes, from_second.changes);
        let touched = |applied: &AppliedIntents| {
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
        [ReverseContour {
            layer_id,
            contour_id: ContourId::from_raw("A_outer"),
        }
        .into()],
    );
    assert!(reversed.layers[0].structural);
    assert!(!reversed.changes.impact().contains(FontChangeImpact::GLYPHS));
    assert!(reversed.changes.record_glyph_ids().is_empty());

    let drawn = apply(
        &mut font,
        [AddPoints {
            layer_id,
            contour_id: Some(ContourId::from_raw("A_outer")),
            before: None,
            points: vec![PointSeed {
                id: PointId::from_raw("drawn"),
                x: 1.0,
                y: 2.0,
                point_type: PointType::OnCurve,
                smooth: false,
            }],
        }
        .into()],
    );
    assert!(!drawn.changes.impact().contains(FontChangeImpact::GLYPHS));
    assert!(drawn.changes.record_glyph_ids().is_empty());

    // A new component base changes the record's component base glyphs.
    let composed = apply(
        &mut font,
        [AddComponent {
            layer_id,
            component_id: ComponentId::from_raw("added"),
            base_glyph_id: GlyphId::from_raw("acute"),
        }
        .into()],
    );
    assert!(composed.changes.impact().contains(FontChangeImpact::GLYPHS));
    let glyph_a = GlyphId::from_raw("A");
    assert!(
        composed
            .changes
            .record_glyph_ids()
            .into_iter()
            .eq([glyph_a])
    );

    let removed = apply(
        &mut font,
        [RemoveComponents {
            layer_id,
            component_ids: vec![ComponentId::from_raw("added")],
        }
        .into()],
    );
    assert!(removed.changes.impact().contains(FontChangeImpact::GLYPHS));
    assert!(removed.changes.record_glyph_ids().into_iter().eq([glyph_a]));
}

#[test]
fn non_finite_coordinates_are_rejected_without_changing_the_font() {
    let original = sample_font();
    let layer_id = LayerId::from_raw("A_regular");
    let point = PointId::from_raw("A_0");
    let anchor = AnchorId::from_raw("A_top");

    for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let intents: [FontIntent; 7] = [
            MovePoints {
                layer_id,
                point_ids: vec![point.clone()],
                coords: vec![bad, 0.0],
            }
            .into(),
            TranslatePoints {
                layer_id,
                point_ids: vec![point.clone()],
                dx: 0.0,
                dy: bad,
            }
            .into(),
            AddPoints {
                layer_id,
                contour_id: Some(ContourId::from_raw("A_outer")),
                before: None,
                points: vec![PointSeed {
                    id: PointId::from_raw("bad"),
                    x: bad,
                    y: 0.0,
                    point_type: PointType::OnCurve,
                    smooth: false,
                }],
            }
            .into(),
            AddAnchors {
                layer_id,
                anchors: vec![AnchorSeed {
                    id: AnchorId::from_raw("bad"),
                    name: Some("bottom".to_string()),
                    x: 0.0,
                    y: bad,
                }],
            }
            .into(),
            MoveAnchors {
                layer_id,
                anchor_ids: vec![anchor.clone()],
                coords: vec![bad, 0.0],
            }
            .into(),
            SetXAdvance {
                layer_id,
                width: bad,
            }
            .into(),
            TransformLayer {
                layer_id,
                transform: Transform {
                    xx: bad,
                    ..Transform::translate(0.0, 0.0)
                },
            }
            .into(),
        ];

        for intent in intents {
            let mut font = original.clone();
            let result = font.apply_intents(&FontIntentSet::from(intent.clone()));
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
        [
            MovePoints {
                layer_id,
                point_ids: vec![PointId::from_raw("A_0")],
                coords: vec![-0.0, -0.0],
            }
            .into(),
            AddAnchors {
                layer_id,
                anchors: vec![AnchorSeed {
                    id: AnchorId::from_raw("zero"),
                    name: Some("bottom".to_string()),
                    x: -0.0,
                    y: -0.0,
                }],
            }
            .into(),
            SetXAdvance {
                layer_id,
                width: -0.0,
            }
            .into(),
            SetComponentTransforms {
                layer_id,
                component_ids: vec![ComponentId::from_raw("a_second")],
                transforms: vec![-0.0, -0.0, -0.0, 1.0, 1.0, -0.0, -0.0, -0.0, -0.0],
            }
            .into(),
        ],
    );

    let layer = font.layer(layer_id).unwrap();
    let point = layer
        .points()
        .find(|point| point.id() == PointId::from_raw("A_0"))
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
        transform.t_center_x,
        transform.t_center_y,
    ] {
        assert!(positive(value), "{transform:?}");
    }

    // Values installed in bulk, as a load or an echo does, are stored the same way.
    let mut values = GlyphInterpolationValues::from_layer(layer).into_vec();
    values
        .iter_mut()
        .filter(|value| **value == 0.0)
        .for_each(|value| *value = -0.0);
    let mut reloaded = layer.clone();
    reloaded
        .apply_interpolation_values(&GlyphInterpolationValues::new(values))
        .unwrap();
    assert_eq!(reloaded, *layer);
}

#[test]
fn setting_every_position_moves_points_and_anchors_like_naming_them() {
    let layer_id = LayerId::from_raw("A_regular");
    let mut named = sample_font();
    let mut by_position = sample_font();
    let layer = named.layer(layer_id).unwrap();
    let point_ids: Vec<PointId> = layer.points().map(Point::id).collect();
    let anchor_ids: Vec<AnchorId> = layer.anchors_iter().map(Anchor::id).collect();
    let moved = |index: usize| [index as f64 * 3.0, -(index as f64)];
    let point_coords: Vec<f64> = (0..point_ids.len()).flat_map(moved).collect();
    let anchor_coords: Vec<f64> = (0..anchor_ids.len()).flat_map(|i| moved(100 + i)).collect();

    let by_id = apply(
        &mut named,
        [
            MovePoints {
                layer_id,
                point_ids,
                coords: point_coords.clone(),
            }
            .into(),
            MoveAnchors {
                layer_id,
                anchor_ids,
                coords: anchor_coords.clone(),
            }
            .into(),
        ],
    );
    let set = apply(
        &mut by_position,
        [SetPositions {
            layer_id,
            positions: [point_coords, anchor_coords].concat(),
        }
        .into()],
    );

    assert_eq!(by_position.layer(layer_id), named.layer(layer_id));
    assert_eq!(set.layers.len(), by_id.layers.len());
    assert!(set.layers.iter().all(|touched| !touched.structural));
}

#[test]
fn setting_positions_needs_one_pair_per_point_and_anchor() {
    let layer_id = LayerId::from_raw("A_regular");
    let mut font = sample_font();
    let original = font.clone();
    let count = {
        let layer = font.layer(layer_id).unwrap();
        (layer.points().count() + layer.anchors().len()) * 2
    };

    for positions in [vec![0.0; count - 2], vec![0.0; count + 2]] {
        let rejected = font.apply_intents(&FontIntentSet::from(SetPositions {
            layer_id,
            positions,
        }));
        assert!(matches!(
            rejected,
            Err(CoreError::MissingGlyphValue { .. } | CoreError::TrailingGlyphValues { .. })
        ));
    }
    assert_eq!(font, original);
}
