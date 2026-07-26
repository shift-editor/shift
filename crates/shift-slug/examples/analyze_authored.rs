use std::{env, error::Error};

use shift_backends::font_loader::FontLoader;
use shift_font::{GlyphId, InterpolationBasis, Location};
use shift_slug::{
    add_authored_component_projection_glyph, add_authored_projection_glyph,
    authored_glyph_requirements, curves_from_resolved_contours, AuthoredSlugError,
    VariableAtlasBuilder,
};

fn main() -> Result<(), Box<dyn Error>> {
    let path = env::args()
        .nth(1)
        .ok_or("usage: analyze_authored <font.shift|font.glyphs|font.designspace|font.ufo>")?;
    let font = FontLoader::new().read_font(&path)?;
    let mut builder = VariableAtlasBuilder::default();
    let mut bases: Vec<(InterpolationBasis, Vec<u32>)> = Vec::new();
    let mut next_weight_index = 1_u32;
    let mut report = Report::default();
    let mut validation_glyphs = Vec::new();

    for glyph in font.glyphs() {
        report.glyphs += 1;
        let Some(projection) = font.glyph_projection(&glyph.id())? else {
            report.missing_projection += 1;
            continue;
        };
        let requirements = authored_glyph_requirements(&projection);
        report.component_occurrences += requirements.component_occurrences;
        report.attachments += requirements.attachment_count;
        report.exact_source_shapes += requirements.exact_source_shapes;
        report.exact_component_variants += requirements.exact_component_variants;
        if requirements.attachment_count != 0
            || requirements.exact_source_shapes != 0
            || requirements.exact_component_variants != 0
        {
            report.unsupported_glyphs += 1;
            continue;
        }

        let weight_indices = if let Some(interpolation) = projection.interpolation() {
            report.variable_glyphs += 1;
            if let Some((_, indexes)) = bases
                .iter()
                .find(|(basis, _)| basis == interpolation.basis())
            {
                indexes.clone()
            } else {
                let count = u32::try_from(interpolation.basis().source_ids().len())?;
                let end = next_weight_index
                    .checked_add(count)
                    .ok_or("weight index overflow")?;
                let indexes = (next_weight_index..end).collect::<Vec<_>>();
                next_weight_index = end;
                bases.push((interpolation.basis().clone(), indexes.clone()));
                indexes
            }
        } else {
            report.static_glyphs += 1;
            Vec::new()
        };

        let component_glyph = requirements.component_occurrences != 0;
        let result = if component_glyph {
            add_authored_component_projection_glyph(
                &mut builder,
                &font,
                &projection,
                &weight_indices,
            )
        } else {
            add_authored_projection_glyph(&mut builder, &projection, &weight_indices, 0)
        };
        match result {
            Ok(atlas_index) => {
                report.supported_glyphs += 1;
                report.supported_component_glyphs += usize::from(component_glyph);
                validation_glyphs.push(ValidationGlyph {
                    glyph_id: glyph.id(),
                    atlas_index,
                    weight_indices,
                    component_glyph,
                });
            }
            Err(AuthoredSlugError::UnsupportedGlyph(_)) => {
                unreachable!("requirements were checked before atlas mutation")
            }
            Err(error) => return Err(error.into()),
        }
    }

    let atlas = builder.finish();
    let statistics = atlas.statistics();
    let packed = atlas.pack(256)?;
    let locations = validation_locations(&font);
    let maximum_error = validate_locations(
        &font,
        &atlas,
        &validation_glyphs,
        &locations,
        usize::try_from(next_weight_index)?,
    )?;
    println!(
        "source={} glyphs={} supported={} unsupported={} missing_projection={}",
        path,
        report.glyphs,
        report.supported_glyphs,
        report.unsupported_glyphs,
        report.missing_projection,
    );
    println!(
        "variable={} static={} unique_bases={} weight_count={}",
        report.variable_glyphs,
        report.static_glyphs,
        bases.len(),
        next_weight_index,
    );
    println!(
        "component_glyphs_supported={} component_occurrences={} attachments={} exact_source_shapes={} exact_component_variants={}",
        report.supported_component_glyphs,
        report.component_occurrences,
        report.attachments,
        report.exact_source_shapes,
        report.exact_component_variants,
    );
    println!(
        "atlas_glyphs={} curves={} delta_curves={} sources={} packed_bytes={}",
        statistics.glyph_count,
        statistics.curve_count,
        statistics.delta_curve_count,
        statistics.source_count,
        packed.as_bytes().len(),
    );
    println!(
        "validation_locations={} maximum_curve_error={maximum_error}",
        locations.len(),
    );
    Ok(())
}

struct ValidationGlyph {
    glyph_id: GlyphId,
    atlas_index: u32,
    weight_indices: Vec<u32>,
    component_glyph: bool,
}

fn validation_locations(font: &shift_font::Font) -> Vec<Location> {
    let mut locations = font
        .sources()
        .iter()
        .filter(|source| source.is_master())
        .map(|source| source.location().clone())
        .collect::<Vec<_>>();
    for step in 0..17 {
        let mut location = Location::new();
        for (axis_index, axis) in font.axes().iter().enumerate() {
            let numerator = (step * 7 + axis_index * 11) % 17;
            let fraction = numerator as f64 / 16.0;
            location.set(
                axis.id(),
                axis.minimum() + (axis.maximum() - axis.minimum()) * fraction,
            );
        }
        locations.push(location);
    }
    locations
}

fn validate_locations(
    font: &shift_font::Font,
    atlas: &shift_slug::VariableAtlas,
    glyphs: &[ValidationGlyph],
    locations: &[Location],
    weight_count: usize,
) -> Result<f32, Box<dyn Error>> {
    let mut maximum_error = 0.0_f32;
    for glyph in glyphs {
        let projection = font
            .glyph_projection(&glyph.glyph_id)?
            .ok_or("missing projection")?;
        let Some(interpolation) = projection.interpolation() else {
            continue;
        };
        let recipe = shift_slug::AuthoredCurveRecipe::from_layer(interpolation.reference_layer());
        for location in locations {
            let mut weights = vec![0.0_f32; weight_count];
            weights[0] = 1.0;
            for (weight_index, weight) in glyph
                .weight_indices
                .iter()
                .zip(interpolation.basis().weights_at(location, font.axes())?)
            {
                weights[*weight_index as usize] = weight as f32;
            }
            let actual = atlas.resolve_glyph_with_weights(glyph.atlas_index, &weights)?;
            let expected = if glyph.component_glyph {
                let mut font_projection = font.projection(location);
                let resolved = font_projection
                    .glyph(&glyph.glyph_id)?
                    .ok_or("missing resolved glyph")?;
                curves_from_resolved_contours(resolved.contours())?
            } else {
                let expected_layer = interpolation.resolve(location, font.axes())?;
                recipe.curves_from_layer(&expected_layer)?
            };
            for (actual, expected) in actual.iter().zip(&expected) {
                for (actual, expected) in curve_values(*actual).zip(curve_values(*expected)) {
                    maximum_error = maximum_error.max((actual - expected).abs());
                }
            }
        }
    }
    Ok(maximum_error)
}

fn curve_values(curve: shift_slug::Curve) -> impl Iterator<Item = f32> {
    [
        curve.p0.x, curve.p0.y, curve.p1.x, curve.p1.y, curve.p2.x, curve.p2.y,
    ]
    .into_iter()
}

#[derive(Default)]
struct Report {
    glyphs: usize,
    supported_glyphs: usize,
    unsupported_glyphs: usize,
    missing_projection: usize,
    variable_glyphs: usize,
    static_glyphs: usize,
    supported_component_glyphs: usize,
    component_occurrences: usize,
    attachments: usize,
    exact_source_shapes: usize,
    exact_component_variants: usize,
}
