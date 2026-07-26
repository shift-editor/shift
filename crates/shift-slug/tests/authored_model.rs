use shift_backends::font_loader::FontLoader;
use shift_font::{
    test_support::{sample_font, sample_variable_font},
    Component, Contour, DecomposedTransform, Glyph, GlyphId, GlyphLayer, InterpolationBasis,
    LayerId, Location, PointType, SourceId,
};
use shift_slug::{
    add_authored_component_projection_glyph, add_authored_glyph, add_authored_projection_glyph,
    authored_glyph_requirements, curves_from_resolved_contours, AuthoredCurveRecipe,
    AuthoredSlugError, Curve, VariableAtlasBuilder,
};

#[test]
fn authored_recipe_preserves_curve_correspondence_through_degeneracy() {
    let mut layer = triangle_layer();
    let recipe = AuthoredCurveRecipe::from_layer(&layer);
    let base = recipe.curves_from_layer(&layer).unwrap();

    let contour = layer.contours_iter_mut().next().unwrap();
    let first_x = contour.points()[0].x();
    let first_y = contour.points()[0].y();
    contour.points_mut()[1].set_position(first_x, first_y);
    let degenerate = recipe.curves_from_layer(&layer).unwrap();

    assert_eq!(recipe.curve_count(), 3);
    assert_eq!(base.len(), degenerate.len());
    assert_eq!(degenerate[0].p0, degenerate[0].p1);
    assert_eq!(degenerate[0].p1, degenerate[0].p2);
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
    let recipe = AuthoredCurveRecipe::from_layer(interpolation.reference_layer());
    let expected = recipe.curves_from_layer(&expected_layer).unwrap();
    assert_curves_close(&actual, &expected, 0.001);
    assert_eq!(atlas.sources()[0].weight_index, 2);
    assert_eq!(atlas.sources()[1].weight_index, 5);
}

#[test]
fn mutatorsans_designspace_matches_authored_projection_at_random_locations() {
    let path = format!(
        "{}/../../fixtures/fonts/mutatorsans-variable/MutatorSans.designspace",
        env!("CARGO_MANIFEST_DIR")
    );
    let font = FontLoader::new().read_font(&path).unwrap();
    let mut builder = VariableAtlasBuilder::default();
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
        let atlas_index = if component_glyph {
            add_authored_component_projection_glyph(
                &mut builder,
                &font,
                &projection,
                &weight_indices,
            )
            .unwrap()
        } else {
            add_authored_projection_glyph(&mut builder, &projection, &weight_indices, 0).unwrap()
        };
        records.push((glyph.id(), atlas_index, weight_indices, component_glyph));
    }
    let atlas = builder.finish();

    assert_eq!(records.len(), 49);
    assert_eq!(component_glyphs, 10);
    assert_eq!(component_occurrences, 20);
    assert_eq!(bases.len(), 4);
    assert_eq!(atlas.statistics().curve_count, 702);
    assert_eq!(atlas.statistics().delta_curve_count, 2_211);
    assert_eq!(atlas.statistics().delta_index_count, 7);
    assert_eq!(atlas.statistics().dense_delta_source_count, 148);
    assert_eq!(atlas.statistics().sparse_delta_source_count, 6);

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
    for (glyph_id, atlas_index, weight_indices, component_glyph) in records {
        let projection = font.glyph_projection(&glyph_id).unwrap().unwrap();
        let interpolation = projection.interpolation().unwrap();
        let recipe = AuthoredCurveRecipe::from_layer(interpolation.reference_layer());
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
            let expected = if component_glyph {
                let mut font_projection = font.projection(location);
                let resolved = font_projection.glyph(&glyph_id).unwrap().unwrap();
                curves_from_resolved_contours(resolved.contours()).unwrap()
            } else {
                let expected_layer = interpolation.resolve(location, font.axes()).unwrap();
                recipe.curves_from_layer(&expected_layer).unwrap()
            };
            maximum_error = maximum_error.max(maximum_curve_error(&actual, &expected));
        }
    }
    assert!(
        maximum_error <= 0.001,
        "maximum authored curve error was {maximum_error}"
    );
}

#[test]
fn component_fast_path_rejects_varying_scale() {
    let mut font = sample_variable_font();
    let glyph_id = font.glyphs_by_unicode(0x41).next().unwrap().id();
    let layers = font
        .glyph(glyph_id.clone())
        .unwrap()
        .layers()
        .values()
        .map(|layer| (layer.id(), layer.source_id()))
        .collect::<Vec<_>>();
    let child_id = GlyphId::from_raw("component-child");
    let mut child = Glyph::with_id(child_id.clone(), "component-child");
    for (_, source_id) in &layers {
        child.set_layer(triangle_layer_for_source(source_id.clone()));
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
                    scale_x: 1.0 + index as f64,
                    ..DecomposedTransform::identity()
                },
            ));
    }

    let projection = font.glyph_projection(&glyph_id).unwrap().unwrap();
    let weight_indices =
        (0..projection.interpolation().unwrap().sources().len() as u32).collect::<Vec<_>>();
    let mut builder = VariableAtlasBuilder::default();
    let error =
        add_authored_component_projection_glyph(&mut builder, &font, &projection, &weight_indices)
            .unwrap_err();

    assert!(matches!(
        error,
        AuthoredSlugError::VariableComponentLinearTransform { .. }
    ));
    assert!(builder.finish().glyphs().is_empty());
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

fn triangle_layer() -> GlyphLayer {
    triangle_layer_for_source(SourceId::new())
}

fn triangle_layer_for_source(source_id: SourceId) -> GlyphLayer {
    let mut layer = GlyphLayer::new(LayerId::new(), source_id);
    let mut contour = Contour::new();
    contour.add_point(0.0, 0.0, PointType::OnCurve, false);
    contour.add_point(50.0, 100.0, PointType::OnCurve, false);
    contour.add_point(100.0, 0.0, PointType::OnCurve, false);
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
