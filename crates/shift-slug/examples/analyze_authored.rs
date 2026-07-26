use std::{env, error::Error};

use shift_backends::font_loader::FontLoader;
use shift_font::{GlyphId, Location};
use shift_slug::{
    authored_glyph_requirements, curves_from_resolved_contours, AuthoredAtlasBuilder,
    AuthoredGlyph, AuthoredSlugError, AuthoredWeightSet,
};

fn main() -> Result<(), Box<dyn Error>> {
    let path = env::args()
        .nth(1)
        .ok_or("usage: analyze_authored <font.shift|font.glyphs|font.designspace|font.ufo>")?;
    let font = FontLoader::new().read_font(&path)?;
    let mut builder = AuthoredAtlasBuilder::default();
    let (weight_sets, next_weight_index) = collect_weight_sets(&font)?;
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
        if projection.interpolation().is_some() {
            report.variable_glyphs += 1;
        } else {
            report.static_glyphs += 1;
        }

        let component_glyph = requirements.component_occurrences != 0;
        match builder.add_glyph(&font, &projection, &weight_sets, 0) {
            Ok(authored) => {
                report.supported_glyphs += 1;
                report.supported_component_glyphs += usize::from(component_glyph);
                validation_glyphs.push(ValidationGlyph {
                    glyph_id: glyph.id(),
                    authored,
                });
            }
            Err(AuthoredSlugError::UnsupportedGlyph(_)) => {
                report.unsupported_glyphs += 1;
            }
            Err(error) => return Err(error.into()),
        }
    }

    let atlas = builder.finish();
    let statistics = atlas.statistics();
    let packed = atlas.pack(256)?;
    let locations = validation_locations(&font);
    let (maximum_error, maximum_advance_error) = validate_locations(
        &font,
        &atlas,
        &validation_glyphs,
        &locations,
        &weight_sets,
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
        weight_sets.len(),
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
        "atlas_glyphs={} curves={} delta_curves={} sparse_indices={} sources={} dense_sources={} sparse_sources={} component_glyphs={} component_parts={} components={} component_sources={} anchor_sources={} packed_bytes={}",
        statistics.glyph_count,
        statistics.curve_count,
        statistics.delta_curve_count,
        statistics.delta_index_count,
        statistics.source_count,
        statistics.dense_delta_source_count,
        statistics.sparse_delta_source_count,
        statistics.component_glyph_count,
        statistics.component_part_count,
        statistics.component_count,
        statistics.component_source_count,
        statistics.anchor_source_count,
        packed.as_bytes().len(),
    );
    println!(
        "validation_locations={} maximum_curve_error={maximum_error} maximum_advance_error={maximum_advance_error}",
        locations.len(),
    );
    Ok(())
}

struct ValidationGlyph {
    glyph_id: GlyphId,
    authored: AuthoredGlyph,
}

fn collect_weight_sets(
    font: &shift_font::Font,
) -> Result<(Vec<AuthoredWeightSet>, u32), Box<dyn Error>> {
    let mut sets = Vec::new();
    let mut next_weight_index = 1_u32;
    for glyph in font.glyphs() {
        let Some(projection) = font.glyph_projection(&glyph.id())? else {
            continue;
        };
        let Some(interpolation) = projection.interpolation() else {
            continue;
        };
        if sets
            .iter()
            .any(|set: &AuthoredWeightSet| set.basis() == interpolation.basis())
        {
            continue;
        }
        let count = u32::try_from(interpolation.basis().source_ids().len())?;
        let end = next_weight_index
            .checked_add(count)
            .ok_or("weight index overflow")?;
        sets.push(AuthoredWeightSet::new(
            interpolation.basis().clone(),
            (next_weight_index..end).collect(),
        )?);
        next_weight_index = end;
    }
    Ok((sets, next_weight_index))
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
    weight_sets: &[AuthoredWeightSet],
    weight_count: usize,
) -> Result<(f32, f32), Box<dyn Error>> {
    let mut maximum_error = 0.0_f32;
    let mut maximum_advance_error = 0.0_f32;
    for glyph in glyphs {
        for location in locations {
            let mut weights = vec![0.0_f32; weight_count];
            weights[0] = 1.0;
            for weight_set in weight_sets {
                for (weight_index, weight) in weight_set
                    .source_weight_indices()
                    .iter()
                    .zip(weight_set.basis().weights_at(location, font.axes())?)
                {
                    weights[*weight_index as usize] = weight as f32;
                }
            }
            let exact_source_id = font
                .sources()
                .iter()
                .filter(|source| source.is_master())
                .find(|source| source.location().is_equivalent_to(location, font.axes()))
                .map(shift_font::Source::id);
            let atlas_index = glyph.authored.glyph_for_source(exact_source_id.as_ref());
            let actual = atlas.resolve_glyph_with_weights(atlas_index, &weights)?;
            let mut font_projection = font.projection(location);
            let resolved = font_projection
                .glyph(&glyph.glyph_id)?
                .ok_or("missing resolved glyph")?;
            let expected = curves_from_resolved_contours(resolved.contours())?;
            let expected_advance = resolved.x_advance() as f32;
            if actual.len() != expected.len() {
                return Err(format!(
                    "glyph {} resolved {} curves, expected {}",
                    glyph.glyph_id,
                    actual.len(),
                    expected.len()
                )
                .into());
            }
            for (actual, expected) in actual.iter().zip(&expected) {
                for (actual, expected) in curve_values(*actual).zip(curve_values(*expected)) {
                    maximum_error = maximum_error.max((actual - expected).abs());
                }
            }
            let actual_advance = atlas.resolve_advance_with_weights(atlas_index, &weights)?;
            maximum_advance_error =
                maximum_advance_error.max((actual_advance - expected_advance).abs());
        }
    }
    Ok((maximum_error, maximum_advance_error))
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
