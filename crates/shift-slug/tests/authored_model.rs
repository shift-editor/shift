use shift_backends::font_loader::FontLoader;
use shift_font::{
    test_support::{sample_font, sample_variable_font},
    Anchor, Component, Contour, DecomposedTransform, Glyph, GlyphId, GlyphLayer,
    InterpolationBasis, LayerId, Location, PointType, SourceId,
};
use shift_slug::{
    add_authored_component_projection_glyph, add_authored_glyph,
    add_authored_glyph_with_weight_sets, add_authored_projection_glyph,
    authored_glyph_requirements, build_authored_atlas, build_authored_atlas_page,
    curves_from_resolved_contours, AuthoredAtlasBuilder, AuthoredCurveTopology, AuthoredSlugError,
    AuthoredWeightSet, Curve, VariableAtlasBuilder,
};

#[test]
fn authored_topology_preserves_curve_correspondence_through_degeneracy() {
    let mut layer = triangle_layer();
    let topology = AuthoredCurveTopology::from_layer(&layer);
    let base = topology.curves_from_layer(&layer).unwrap();

    let contour = layer.contours_iter_mut().next().unwrap();
    let first_x = contour.points()[0].x();
    let first_y = contour.points()[0].y();
    contour.points_mut()[1].set_position(first_x, first_y);
    let degenerate = topology.curves_from_layer(&layer).unwrap();

    assert_eq!(topology.curve_count(), 3);
    assert_eq!(base.len(), degenerate.len());
    assert_eq!(degenerate[0].p0, degenerate[0].p1);
    assert_eq!(degenerate[0].p1, degenerate[0].p2);
}

#[test]
fn authored_topology_freezes_the_largest_compatible_cubic_subdivision_count() {
    let reference = cubic_layer();
    let mut curved = reference.clone();
    let contour = curved.contours_iter_mut().next().unwrap();
    contour.points_mut()[1].set_position(0.0, 200.0);
    contour.points_mut()[2].set_position(100.0, -200.0);

    let reference_topology = AuthoredCurveTopology::from_layer(&reference);
    let topology = AuthoredCurveTopology::from_compatible_layers(&reference, [&curved]).unwrap();
    let reference_curves = topology.curves_from_layer(&reference).unwrap();
    let curved_curves = topology.curves_from_layer(&curved).unwrap();

    assert!(topology.curve_count() > reference_topology.curve_count());
    assert_eq!(reference_curves.len(), curved_curves.len());
}

#[test]
fn authored_projection_uses_reference_topology_for_all_sources() {
    let font = sample_variable_font();
    let glyph_id = font.glyphs_by_unicode(0x41).next().unwrap().id();
    let projection = font.glyph_projection(&glyph_id).unwrap().unwrap();
    let interpolation = projection.interpolation().unwrap();
    let weight_indices = [2, 5];
    let mut builder = VariableAtlasBuilder::default();

    add_authored_projection_glyph(&mut builder, &projection, &weight_indices, 0).unwrap();
    let atlas = builder.finish();

    let axis_id = font.axes()[0].id();
    let mut location = Location::new();
    location.set(axis_id, 600.0);
    let source_weights = interpolation
        .basis()
        .weights_at(&location, font.axes())
        .unwrap();
    let mut weights = [0.0_f32; 6];
    for (weight_index, source_weight) in weight_indices.iter().zip(source_weights) {
        weights[*weight_index as usize] = source_weight as f32;
    }
    let actual = atlas.resolve_glyph_with_weights(0, &weights).unwrap();

    let expected_layer = interpolation.resolve(&location, font.axes()).unwrap();
    let source_layers = interpolation
        .sources()
        .iter()
        .map(|source| {
            let mut layer = interpolation.reference_layer().clone();
            layer.apply_interpolation_values(source.values()).unwrap();
            layer
        })
        .collect::<Vec<_>>();
    let topology = AuthoredCurveTopology::from_compatible_layers(
        interpolation.reference_layer(),
        &source_layers,
    )
    .unwrap();
    let expected = topology.curves_from_layer(&expected_layer).unwrap();
    assert_curves_close(&actual, &expected, 0.001);
    let actual_advance = atlas.resolve_advance_with_weights(0, &weights).unwrap();
    assert!((actual_advance - expected_layer.width() as f32).abs() <= 0.001);
    assert_eq!(atlas.sources()[0].weight_index, 2);
    assert_eq!(atlas.sources()[1].weight_index, 5);
}

#[test]
fn authored_atlas_keeps_layerless_glyphs_as_resident_blanks() {
    let mut builder = AuthoredAtlasBuilder::default();
    let glyph = builder.add_empty_glyph(0).unwrap();
    let atlas = builder.finish();

    assert!(atlas
        .resolve_glyph_with_weights(glyph.default_glyph, &[1.0])
        .unwrap()
        .is_empty());
    assert_eq!(
        atlas.resolve_advance_with_weights(glyph.default_glyph, &[1.0]),
        Ok(0.0)
    );
}

#[test]
fn complete_authored_atlas_keeps_font_identity_and_independent_bases() {
    let path = format!(
        "{}/../../fixtures/fonts/mutatorsans-variable/MutatorSans.designspace",
        env!("CARGO_MANIFEST_DIR")
    );
    let font = FontLoader::new().read_font(&path).unwrap();

    let resident = build_authored_atlas(&font, 8).unwrap();

    assert_eq!(resident.glyphs().len(), font.glyphs().count());
    assert_eq!(resident.weight_sets().len(), 4);
    assert_eq!(resident.weight_count(), 21);
    assert_eq!(resident.atlas().statistics().component_glyph_count, 10);
    assert_eq!(
        resident
            .glyphs()
            .iter()
            .map(|glyph| glyph.glyph_id.clone())
            .collect::<Vec<_>>(),
        font.glyphs().map(Glyph::id).collect::<Vec<_>>()
    );
}

#[test]
fn authored_atlas_page_compiles_only_ordered_unique_roots_and_component_closures() {
    let path = format!(
        "{}/../../fixtures/fonts/mutatorsans-variable/MutatorSans.designspace",
        env!("CARGO_MANIFEST_DIR")
    );
    let font = FontLoader::new().read_font(&path).unwrap();
    let roots = font.glyphs().take(3).map(Glyph::id).collect::<Vec<_>>();
    let requested = [roots[1].clone(), roots[0].clone(), roots[1].clone()];

    let page = build_authored_atlas_page(&font, &requested, 8).unwrap();

    assert_eq!(
        page.glyphs()
            .iter()
            .map(|glyph| glyph.glyph_id.clone())
            .collect::<Vec<_>>(),
        vec![roots[1].clone(), roots[0].clone()]
    );
    assert!(page.atlas().statistics().glyph_count < font.glyphs().count());

    let component_root = font
        .glyphs()
        .map(|glyph| glyph.id())
        .find(|glyph_id| {
            font.glyph_projection(glyph_id)
                .unwrap()
                .is_some_and(|projection| !projection.components().components().is_empty())
        })
        .unwrap();
    let component_page =
        build_authored_atlas_page(&font, std::slice::from_ref(&component_root), 8).unwrap();

    assert_eq!(component_page.glyphs()[0].glyph_id, component_root);
    assert!(component_page.atlas().statistics().component_glyph_count > 0);
}

#[test]
fn mutatorsans_designspace_matches_authored_projection_at_random_locations() {
    let path = format!(
        "{}/../../fixtures/fonts/mutatorsans-variable/MutatorSans.designspace",
        env!("CARGO_MANIFEST_DIR")
    );
    let font = FontLoader::new().read_font(&path).unwrap();
    let mut builder = AuthoredAtlasBuilder::default();
    let mut bases: Vec<(InterpolationBasis, Vec<u32>)> = Vec::new();
    let mut next_weight_index = 1_u32;
    let mut records: Vec<(GlyphId, u32, Vec<u32>, bool)> = Vec::new();
    let mut component_glyphs = 0;
    let mut component_occurrences = 0;

    for glyph in font.glyphs() {
        let projection = font.glyph_projection(&glyph.id()).unwrap().unwrap();
        let requirements = authored_glyph_requirements(&projection);
        component_occurrences += requirements.component_occurrences;
        let component_glyph = requirements.component_occurrences != 0;
        component_glyphs += usize::from(component_glyph);
        let interpolation = projection.interpolation().unwrap();
        let weight_indices = if let Some((_, indexes)) = bases
            .iter()
            .find(|(basis, _)| basis == interpolation.basis())
        {
            indexes.clone()
        } else {
            let end = next_weight_index + interpolation.basis().source_ids().len() as u32;
            let indexes = (next_weight_index..end).collect::<Vec<_>>();
            next_weight_index = end;
            bases.push((interpolation.basis().clone(), indexes.clone()));
            indexes
        };
        let weight_set =
            AuthoredWeightSet::new(interpolation.basis().clone(), weight_indices.clone()).unwrap();
        let atlas_index = builder
            .add_glyph(&font, &projection, &[weight_set], 0)
            .unwrap()
            .default_glyph;
        records.push((glyph.id(), atlas_index, weight_indices, component_glyph));
    }
    let atlas = builder.finish();

    assert_eq!(records.len(), 49);
    assert_eq!(component_glyphs, 10);
    assert_eq!(component_occurrences, 20);
    assert_eq!(bases.len(), 4);
    assert_eq!(atlas.statistics().glyph_count, 59);
    assert_eq!(atlas.statistics().curve_count, 564);
    assert_eq!(atlas.statistics().delta_curve_count, 1_813);
    assert_eq!(atlas.statistics().delta_index_count, 3);
    assert_eq!(atlas.statistics().dense_delta_source_count, 149);
    assert_eq!(atlas.statistics().sparse_delta_source_count, 5);
    assert_eq!(atlas.statistics().component_glyph_count, 10);
    assert_eq!(atlas.statistics().component_count, 20);

    let mut locations = font
        .sources()
        .iter()
        .filter(|source| source.is_master())
        .map(|source| source.location().clone())
        .collect::<Vec<_>>();
    for step in 0..17 {
        let mut location = Location::new();
        for (axis_index, axis) in font.axes().iter().enumerate() {
            let fraction = ((step * 7 + axis_index * 11) % 17) as f64 / 16.0;
            location.set(
                axis.id(),
                axis.minimum() + (axis.maximum() - axis.minimum()) * fraction,
            );
        }
        locations.push(location);
    }

    let mut maximum_error = 0.0_f32;
    let mut maximum_advance_error = 0.0_f32;
    for (glyph_id, atlas_index, weight_indices, component_glyph) in records {
        let projection = font.glyph_projection(&glyph_id).unwrap().unwrap();
        let interpolation = projection.interpolation().unwrap();
        let source_layers = interpolation
            .sources()
            .iter()
            .map(|source| {
                let mut layer = interpolation.reference_layer().clone();
                layer.apply_interpolation_values(source.values()).unwrap();
                layer
            })
            .collect::<Vec<_>>();
        let topology = AuthoredCurveTopology::from_compatible_layers(
            interpolation.reference_layer(),
            &source_layers,
        )
        .unwrap();
        for location in &locations {
            let mut weights = vec![0.0_f32; next_weight_index as usize];
            weights[0] = 1.0;
            for (weight_index, weight) in weight_indices.iter().zip(
                interpolation
                    .basis()
                    .weights_at(location, font.axes())
                    .unwrap(),
            ) {
                weights[*weight_index as usize] = weight as f32;
            }
            let actual = atlas
                .resolve_glyph_with_weights(atlas_index, &weights)
                .unwrap();
            let expected_advance = if component_glyph {
                // Component curve order is validated by the dedicated component CPU/GPU tests.
                // This broad sweep still verifies every component glyph's variable advance.
                let mut font_projection = font.projection(location);
                let resolved = font_projection.glyph(&glyph_id).unwrap().unwrap();
                resolved.x_advance() as f32
            } else {
                let expected_layer = interpolation.resolve(location, font.axes()).unwrap();
                let expected = topology.curves_from_layer(&expected_layer).unwrap();
                maximum_error = maximum_error.max(maximum_curve_error(&actual, &expected));
                expected_layer.width() as f32
            };
            let actual_advance = atlas
                .resolve_advance_with_weights(atlas_index, &weights)
                .unwrap();
            maximum_advance_error =
                maximum_advance_error.max((actual_advance - expected_advance).abs());
        }
    }
    assert!(
        maximum_error <= 0.001,
        "maximum authored curve error was {maximum_error}"
    );
    assert!(
        maximum_advance_error <= 0.001,
        "maximum authored advance error was {maximum_advance_error}"
    );
}

#[test]
fn component_model_resolves_varying_decomposed_transform() {
    let mut font = sample_variable_font();
    let glyph_id = font.glyphs_by_unicode(0x41).next().unwrap().id();
    let layers = font
        .glyph(glyph_id.clone())
        .unwrap()
        .layers()
        .values()
        .map(|layer| (layer.id(), layer.source_id()))
        .collect::<Vec<_>>();
    let grandchild_id = GlyphId::from_raw("component-grandchild");
    let mut grandchild = Glyph::with_id(grandchild_id.clone(), "component-grandchild");
    for (_, source_id) in &layers {
        grandchild.set_layer(triangle_layer_for_source_shifted(source_id.clone(), 25.0));
    }
    font.insert_glyph(grandchild).unwrap();

    let child_id = GlyphId::from_raw("component-child");
    let mut child = Glyph::with_id(child_id.clone(), "component-child");
    for (index, (_, source_id)) in layers.iter().enumerate() {
        let mut layer = triangle_layer_for_source(source_id.clone());
        layer.add_component(Component::with_transform(
            grandchild_id.clone(),
            "component-grandchild",
            DecomposedTransform {
                translate_x: -5.0 * index as f64,
                rotation: -10.0 * index as f64,
                scale_y: 1.0 + 0.25 * index as f64,
                skew_y: 2.0 * index as f64,
                t_center_x: 10.0 * index as f64,
                ..DecomposedTransform::identity()
            },
        ));
        child.set_layer(layer);
    }
    font.insert_glyph(child).unwrap();

    let layer_ids = layers
        .into_iter()
        .map(|(layer_id, _)| layer_id)
        .collect::<Vec<_>>();
    for (index, layer_id) in layer_ids.into_iter().enumerate() {
        font.layer_mut(layer_id)
            .unwrap()
            .add_component(Component::with_transform(
                child_id.clone(),
                "component-child",
                DecomposedTransform {
                    translate_x: 20.0 * index as f64,
                    translate_y: -10.0 * index as f64,
                    rotation: 15.0 * index as f64,
                    scale_x: 1.0 + index as f64,
                    scale_y: 1.0 + 0.5 * index as f64,
                    skew_x: 4.0 * index as f64,
                    skew_y: -3.0 * index as f64,
                    t_center_x: 25.0 * index as f64,
                    t_center_y: 10.0 * index as f64,
                },
            ));
    }

    let projection = font.glyph_projection(&glyph_id).unwrap().unwrap();
    let weight_indices =
        (0..projection.interpolation().unwrap().sources().len() as u32).collect::<Vec<_>>();
    let mut builder = VariableAtlasBuilder::default();
    let glyph_index =
        add_authored_component_projection_glyph(&mut builder, &font, &projection, &weight_indices)
            .unwrap();
    let atlas = builder.finish();
    let axis_id = font.axes()[0].id();
    let mut location = Location::new();
    location.set(axis_id, 600.0);
    let source_weights = projection
        .interpolation()
        .unwrap()
        .basis()
        .weights_at(&location, font.axes())
        .unwrap();
    let mut weights = vec![0.0_f32; weight_indices.len()];
    for (weight_index, weight) in weight_indices.iter().zip(source_weights) {
        weights[*weight_index as usize] = weight as f32;
    }
    let actual = atlas
        .resolve_glyph_with_weights(glyph_index, &weights)
        .unwrap();
    let mut font_projection = font.projection(&location);
    let expected = curves_from_resolved_contours(
        font_projection
            .glyph(&glyph_id)
            .unwrap()
            .unwrap()
            .contours(),
    )
    .unwrap();

    assert_curves_close(&actual, &expected, 0.001);
    assert_eq!(atlas.statistics().component_count, 2);
}

#[test]
fn component_model_resolves_variable_anchor_attachment() {
    let mut font = sample_variable_font();
    let source_ids = font
        .glyphs_by_unicode(0x41)
        .next()
        .unwrap()
        .layers()
        .values()
        .map(|layer| layer.source_id())
        .collect::<Vec<_>>();

    let base_id = GlyphId::from_raw("attachment-base");
    let mut base = Glyph::with_id(base_id.clone(), "attachment-base");
    for (source_index, source_id) in source_ids.iter().enumerate() {
        let mut layer = triangle_layer_for_source(source_id.clone());
        layer.add_anchor(Anchor::new(
            Some("top".to_string()),
            100.0 + 80.0 * source_index as f64,
            200.0 + 40.0 * source_index as f64,
        ));
        base.set_layer(layer);
    }
    font.insert_glyph(base).unwrap();

    let mark_id = GlyphId::from_raw("attachment-mark");
    let mut mark = Glyph::with_id(mark_id.clone(), "attachment-mark");
    for (source_index, source_id) in source_ids.iter().enumerate() {
        let mut layer = triangle_layer_for_source(source_id.clone());
        layer.add_anchor(Anchor::new(
            Some("_top".to_string()),
            5.0 + 10.0 * source_index as f64,
            10.0 + 5.0 * source_index as f64,
        ));
        mark.set_layer(layer);
    }
    font.insert_glyph(mark).unwrap();

    let root_id = GlyphId::from_raw("attachment-root");
    let mut root = Glyph::with_id(root_id.clone(), "attachment-root");
    for source_id in &source_ids {
        let mut layer = GlyphLayer::with_width(LayerId::new(), source_id.clone(), 500.0);
        layer.add_component(Component::new(base_id.clone(), "attachment-base"));
        layer.add_component(Component::new(mark_id.clone(), "attachment-mark"));
        root.set_layer(layer);
    }
    font.insert_glyph(root).unwrap();

    let projection = font.glyph_projection(&root_id).unwrap().unwrap();
    assert_eq!(authored_glyph_requirements(&projection).attachment_count, 1);
    let interpolation = projection.interpolation().unwrap();
    let weight_indices = (1..=interpolation.sources().len() as u32).collect::<Vec<_>>();
    let weight_set =
        AuthoredWeightSet::new(interpolation.basis().clone(), weight_indices.clone()).unwrap();
    let mut builder = VariableAtlasBuilder::default();
    let authored =
        add_authored_glyph_with_weight_sets(&mut builder, &font, &projection, &[weight_set], 0)
            .unwrap();
    let atlas = builder.finish();

    let mut location = Location::new();
    location.set(font.axes()[0].id(), 600.0);
    let source_weights = interpolation
        .basis()
        .weights_at(&location, font.axes())
        .unwrap();
    let mut weights = vec![0.0_f32; weight_indices.len() + 1];
    weights[0] = 1.0;
    for (weight_index, weight) in weight_indices.iter().zip(source_weights) {
        weights[*weight_index as usize] = weight as f32;
    }
    let actual = atlas
        .resolve_glyph_with_weights(authored.default_glyph, &weights)
        .unwrap();
    let mut font_projection = font.projection(&location);
    let expected =
        curves_from_resolved_contours(font_projection.glyph(&root_id).unwrap().unwrap().contours())
            .unwrap();

    assert_curves_close(&actual, &expected, 0.001);
}

#[test]
fn component_model_accepts_a_component_specific_interpolation_basis() {
    let mut font = sample_variable_font();
    let root_id = font.glyphs_by_unicode(0x41).next().unwrap().id();
    let root_source_ids = font
        .glyph(root_id.clone())
        .unwrap()
        .layers()
        .values()
        .map(|layer| layer.source_id())
        .collect::<Vec<_>>();
    let medium_source_id = font
        .sources()
        .iter()
        .find(|source| source.name() == "Medium")
        .unwrap()
        .id();

    let child_id = GlyphId::from_raw("different-basis-child");
    let mut child = Glyph::with_id(child_id.clone(), "different-basis-child");
    for (source_index, source_id) in [
        root_source_ids[0].clone(),
        medium_source_id,
        root_source_ids[1].clone(),
    ]
    .into_iter()
    .enumerate()
    {
        child.set_layer(triangle_layer_for_source_shifted(
            source_id,
            source_index as f64 * 30.0,
        ));
    }
    font.insert_glyph(child).unwrap();

    let root_layer_ids = font
        .glyph(root_id.clone())
        .unwrap()
        .layers()
        .values()
        .map(|layer| layer.id())
        .collect::<Vec<_>>();
    for (source_index, layer_id) in root_layer_ids.into_iter().enumerate() {
        font.layer_mut(layer_id)
            .unwrap()
            .add_component(Component::with_transform(
                child_id.clone(),
                "different-basis-child",
                DecomposedTransform {
                    rotation: source_index as f64 * 20.0,
                    scale_x: 1.0 + source_index as f64 * 0.5,
                    ..DecomposedTransform::identity()
                },
            ));
    }

    let projection = font.glyph_projection(&root_id).unwrap().unwrap();
    let child_projection = font.glyph_projection(&child_id).unwrap().unwrap();
    assert_ne!(
        projection.interpolation().unwrap().basis(),
        child_projection.interpolation().unwrap().basis()
    );
    let root_only = AuthoredWeightSet::new(
        projection.interpolation().unwrap().basis().clone(),
        (1..=projection.interpolation().unwrap().sources().len() as u32).collect(),
    )
    .unwrap();
    let mut invalid_builder = AuthoredAtlasBuilder::default();
    assert!(matches!(
        invalid_builder.add_glyph(&font, &projection, &[root_only], 0),
        Err(AuthoredSlugError::MissingWeightBasis(glyph_id)) if glyph_id == child_id
    ));
    let invalid_atlas = invalid_builder.finish();
    assert!(invalid_atlas.glyphs().is_empty());
    assert!(invalid_atlas.base_curves().is_empty());

    let mut next_weight_index = 1_u32;
    let weight_sets = [
        projection.interpolation().unwrap().basis(),
        child_projection.interpolation().unwrap().basis(),
    ]
    .into_iter()
    .map(|basis| {
        let end = next_weight_index + basis.source_ids().len() as u32;
        let indexes = (next_weight_index..end).collect::<Vec<_>>();
        next_weight_index = end;
        AuthoredWeightSet::new(basis.clone(), indexes).unwrap()
    })
    .collect::<Vec<_>>();
    let mut builder = VariableAtlasBuilder::default();
    let authored =
        add_authored_glyph_with_weight_sets(&mut builder, &font, &projection, &weight_sets, 0)
            .unwrap();
    let atlas = builder.finish();

    let mut location = Location::new();
    location.set(font.axes()[0].id(), 650.0);
    let mut weights = vec![0.0_f32; next_weight_index as usize];
    weights[0] = 1.0;
    for set in &weight_sets {
        for (weight_index, weight) in set
            .source_weight_indices()
            .iter()
            .zip(set.basis().weights_at(&location, font.axes()).unwrap())
        {
            weights[*weight_index as usize] = weight as f32;
        }
    }
    let actual = atlas
        .resolve_glyph_with_weights(authored.default_glyph, &weights)
        .unwrap();
    let mut font_projection = font.projection(&location);
    let expected =
        curves_from_resolved_contours(font_projection.glyph(&root_id).unwrap().unwrap().contours())
            .unwrap();

    assert_curves_close(&actual, &expected, 0.001);
}

#[test]
fn authored_glyph_keeps_exact_source_topology_resident() {
    let font = sample_font();
    let glyph_id = font.glyphs_by_unicode(0x41).next().unwrap().id();
    let projection = font.glyph_projection(&glyph_id).unwrap().unwrap();
    let interpolation = projection.interpolation().unwrap();
    let weight_indices = (1..=interpolation.sources().len() as u32).collect::<Vec<_>>();
    let mut invalid_builder = VariableAtlasBuilder::default();
    assert!(add_authored_glyph(&mut invalid_builder, &font, &projection, &[], 0).is_err());
    assert!(invalid_builder.finish().glyphs().is_empty());

    let mut builder = VariableAtlasBuilder::default();
    let authored =
        add_authored_glyph(&mut builder, &font, &projection, &weight_indices, 0).unwrap();
    let atlas = builder.finish();

    assert_eq!(authored.exact_sources.len(), 1);
    let exact = &authored.exact_sources[0];
    assert_eq!(authored.glyph_for_source(None), authored.default_glyph);
    assert_eq!(
        authored.glyph_for_source(Some(&exact.source_id)),
        exact.glyph_index
    );

    let regular = font
        .sources()
        .iter()
        .find(|source| source.id() == font.default_source_id().unwrap())
        .unwrap();
    let mut weights = vec![0.0_f32; weight_indices.len() + 1];
    weights[0] = 1.0;
    for (weight_index, weight) in weight_indices.iter().zip(
        interpolation
            .basis()
            .weights_at(regular.location(), font.axes())
            .unwrap(),
    ) {
        weights[*weight_index as usize] = weight as f32;
    }
    let default_actual = atlas
        .resolve_glyph_with_weights(authored.default_glyph, &weights)
        .unwrap();
    let mut regular_projection = font.projection(regular.location());
    let regular_resolved = regular_projection.glyph(&glyph_id).unwrap().unwrap();
    let default_expected = curves_from_resolved_contours(regular_resolved.contours()).unwrap();
    assert_curves_close(&default_actual, &default_expected, 0.001);
    let default_advance = atlas
        .resolve_advance_with_weights(authored.default_glyph, &weights)
        .unwrap();
    assert!((default_advance - regular_resolved.x_advance() as f32).abs() <= 0.001);

    let exact_source = font
        .sources()
        .iter()
        .find(|source| source.id() == exact.source_id)
        .unwrap();
    let exact_actual = atlas
        .resolve_glyph_with_weights(exact.glyph_index, &weights)
        .unwrap();
    let mut exact_projection = font.projection(exact_source.location());
    let exact_resolved = exact_projection.glyph(&glyph_id).unwrap().unwrap();
    let exact_expected = curves_from_resolved_contours(exact_resolved.contours()).unwrap();
    assert_curves_close(&exact_actual, &exact_expected, 0.001);
    let exact_advance = atlas
        .resolve_advance_with_weights(exact.glyph_index, &weights)
        .unwrap();
    assert!((exact_advance - exact_resolved.x_advance() as f32).abs() <= 0.001);
    assert_ne!(default_actual, exact_actual);
}

#[test]
fn authored_projection_reports_unimplemented_product_semantics() {
    let font = sample_font();
    let glyph_id = font.glyphs_by_unicode(0x41).next().unwrap().id();
    let projection = font.glyph_projection(&glyph_id).unwrap().unwrap();
    let requirements = authored_glyph_requirements(&projection);

    assert!(requirements.component_occurrences > 0);
    assert!(requirements.exact_source_shapes > 0);

    let mut builder = VariableAtlasBuilder::default();
    let error = add_authored_projection_glyph(&mut builder, &projection, &[], 0).unwrap_err();
    assert!(matches!(
        error,
        AuthoredSlugError::UnsupportedGlyph(actual) if actual == requirements
    ));
    assert!(builder.finish().glyphs().is_empty());
}

fn cubic_layer() -> GlyphLayer {
    let mut layer = GlyphLayer::new(LayerId::new(), SourceId::new());
    let mut contour = Contour::new();
    contour.add_point(0.0, 0.0, PointType::OnCurve, false);
    contour.add_point(33.0, 0.0, PointType::OffCurve, false);
    contour.add_point(66.0, 0.0, PointType::OffCurve, false);
    contour.add_point(100.0, 0.0, PointType::OnCurve, false);
    layer.add_contour(contour);
    layer
}

fn triangle_layer() -> GlyphLayer {
    triangle_layer_for_source(SourceId::new())
}

fn triangle_layer_for_source(source_id: SourceId) -> GlyphLayer {
    triangle_layer_for_source_shifted(source_id, 0.0)
}

fn triangle_layer_for_source_shifted(source_id: SourceId, shift: f64) -> GlyphLayer {
    let mut layer = GlyphLayer::new(LayerId::new(), source_id);
    let mut contour = Contour::new();
    contour.add_point(shift, 0.0, PointType::OnCurve, false);
    contour.add_point(50.0 + shift, 100.0, PointType::OnCurve, false);
    contour.add_point(100.0 + shift, 0.0, PointType::OnCurve, false);
    contour.close();
    layer.add_contour(contour);
    layer
}

fn assert_curves_close(actual: &[Curve], expected: &[Curve], tolerance: f32) {
    let maximum_error = maximum_curve_error(actual, expected);
    assert!(
        maximum_error <= tolerance,
        "maximum error {maximum_error} exceeds {tolerance}"
    );
}

fn maximum_curve_error(actual: &[Curve], expected: &[Curve]) -> f32 {
    assert_eq!(actual.len(), expected.len());
    actual
        .iter()
        .zip(expected)
        .flat_map(|(actual, expected)| {
            [
                (actual.p0.x - expected.p0.x).abs(),
                (actual.p0.y - expected.p0.y).abs(),
                (actual.p1.x - expected.p1.x).abs(),
                (actual.p1.y - expected.p1.y).abs(),
                (actual.p2.x - expected.p2.x).abs(),
                (actual.p2.y - expected.p2.y).abs(),
            ]
        })
        .fold(0.0, f32::max)
}
