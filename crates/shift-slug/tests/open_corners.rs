//! The atlas draws open corners erased, as the compiled font does, so the
//! glyph grid and previews match export.

use shift_font::test_support::{open_corner_contour, sample_variable_font};
use shift_font::{DesignLocation, Font};
use shift_slug::{GlyphIndex, VariableAtlasBuilder, add_authored_projection_glyph};

/// A fixture step that fails with a reason instead of panicking.
type Fixture<T> = Result<T, Box<dyn std::error::Error>>;

/// The sample font with `A` an open corner in every master, the default
/// master at `stretch` 1 and the other wider.
fn font_with_open_a() -> Fixture<Font> {
    let mut font = sample_variable_font();
    let default_source = font.default_source_id().ok_or("no default source")?;
    let glyph_id = font.glyph_id_by_name("A").ok_or("the sample has no A")?;
    let mut glyph = font.pop_glyph(glyph_id)?;
    let layers: Vec<_> = glyph
        .layers()
        .values()
        .map(|layer| (layer.id(), layer.source_id() == default_source))
        .collect();
    for (layer_id, is_default) in layers {
        let layer = glyph
            .layer_mut(layer_id)
            .ok_or("a layer of A went missing")?;
        layer.clear_contours();
        layer.add_contour(open_corner_contour(if is_default { 1.0 } else { 1.2 }));
    }
    font.insert_glyph(glyph)?;
    Ok(font)
}

/// `A`'s curves in the atlas at the default location, as `(x, y)` ends.
fn atlas_ends_at_default(font: &Font) -> Fixture<Vec<(f32, f32)>> {
    let glyph_id = font.glyph_id_by_name("A").ok_or("no A")?;
    let projection = font
        .glyph_projection(glyph_id)?
        .ok_or("A has no projection")?;
    let interpolation = projection.interpolation().ok_or("A does not interpolate")?;
    let weight_indices = [1, 2];
    let mut builder = VariableAtlasBuilder::default();
    add_authored_projection_glyph(&mut builder, &projection, &weight_indices, 0)?;
    let atlas = builder.finish();

    let axis_id = font.axes().first().ok_or("no axis")?.id();
    let location = DesignLocation::from([(axis_id, 400.0)]);
    let mut weights = [0.0_f32; 3];
    for (index, weight) in weight_indices
        .iter()
        .zip(interpolation.basis().weights_at(&location, font.axes())?)
    {
        let slot = weights
            .get_mut(usize::try_from(*index)?)
            .ok_or("a weight index past the weights")?;
        #[expect(clippy::cast_possible_truncation, reason = "a weight between 0 and 1")]
        let weight = weight as f32;
        *slot = weight;
    }
    let curves = atlas.resolve_glyph_with_weights(GlyphIndex::new(0), &weights)?;
    Ok(curves
        .iter()
        .map(|curve| (curve.p2.x, curve.p2.y))
        .collect())
}

#[test]
fn an_open_corner_open_in_every_master_draws_erased_in_the_atlas() {
    let ends = font_with_open_a()
        .and_then(|font| atlas_ends_at_default(&font))
        .map_err(|error| error.to_string());

    // The ear and its joining line are gone: three sides, one ending at the crossing.
    let Ok(ends) = ends else {
        return assert_eq!(ends, Ok(Vec::new()));
    };
    assert_eq!(ends.len(), 3, "{ends:?}");
    assert!(
        ends.iter()
            .any(|(x, y)| (x - 114.5417).abs() < 0.01 && (y - 191.208).abs() < 0.01),
        "{ends:?}"
    );
}
