use std::collections::{BTreeMap, BTreeSet, HashSet};

use rayon::prelude::*;
use shift_slug::{Curve, Point, VariableAtlasBuilder};
use skrifa::raw::types::F2Dot14;

use super::atlas::{
    AtlasAxis, AtlasRegion, RegionAxis, RegionRegistry, SourceAtlasError, SourceAtlasPage,
};
use super::{
    AffineTransform, FontDirectory, FontReadError, FontSource, GlyphIndex, GlyphPointKind,
    GlyphProjection, GlyphShape, SourceIndex, VariationAxisKind, VariationRegion,
};

#[derive(Clone, Copy, Debug)]
struct ProjectedPoint {
    x: f64,
    y: f64,
}

#[derive(Clone, Debug)]
enum ProjectedSegment {
    Line([ProjectedPoint; 2]),
    Quadratic([ProjectedPoint; 3]),
    Cubic([ProjectedPoint; 4]),
}

#[derive(Clone, Debug)]
struct ProjectedOutline {
    advance: f64,
    segments: Vec<ProjectedSegment>,
}

struct CompatibleCurves {
    base: Vec<Curve>,
    line_flags: Vec<bool>,
    sources: Vec<(u32, Vec<Curve>)>,
}

#[derive(Clone, Copy)]
enum ProjectionEvaluation<'a> {
    Base,
    Region(u32),
    Source(SourceIndex, &'a [i16]),
}

/// Compiles one source-neutral atlas page from retained glyph projections.
pub fn build_projected_atlas_page<S: FontSource + ?Sized>(
    source: &S,
    roots: &[GlyphIndex],
    band_count: u32,
) -> Result<SourceAtlasPage, SourceAtlasError> {
    validate_roots(source.directory(), roots)?;
    let projected = roots
        .par_iter()
        .map(|root| source.glyph(*root))
        .collect::<Result<Vec<_>, _>>()?;

    let mut projections = BTreeMap::new();
    let mut closures = Vec::with_capacity(projected.len());
    for projected_glyph in projected {
        let mut closure = Vec::with_capacity(projected_glyph.components.len() + 1);
        for projection in
            std::iter::once(projected_glyph.root).chain(projected_glyph.components.into_vec())
        {
            closure.push(projection.glyph);
            if let Some(existing) = projections.get(&projection.glyph) {
                if existing != &projection {
                    return Err(invalid(format!(
                        "glyph {:?} has inconsistent projections across atlas roots",
                        projection.glyph
                    ))
                    .into());
                }
            } else {
                projections.insert(projection.glyph, projection);
            }
        }
        closure.sort_unstable();
        closure.dedup();
        closures.push(closure);
    }

    let axes = atlas_axes(source.directory())?;
    let mut registry = RegionRegistry::default();
    let mut delta_weights = BTreeMap::new();
    for projection in projections.values() {
        let Some(variation) = &projection.variation else {
            continue;
        };
        for (delta_index, delta) in variation.deltas.iter().enumerate() {
            let region = atlas_region(&delta.region, axes.len())?;
            let weight = registry.weight_index(region)?;
            delta_weights.insert((projection.glyph, delta_index), weight);
        }
    }

    let complement_start = u32::try_from(registry.len())
        .map_err(|_| shift_slug::SlugError::LengthOverflow)?
        .checked_add(1)
        .ok_or(shift_slug::SlugError::LengthOverflow)?;
    let mut complement_indices = BTreeMap::<Vec<u32>, u32>::new();
    let mut complements = Vec::<Box<[u32]>>::new();
    let mut builder = VariableAtlasBuilder::new(band_count)?;
    let mut glyphs = Vec::with_capacity(roots.len());
    let mut exact_glyphs = Vec::new();

    for ((root, closure), root_position) in roots.iter().zip(&closures).zip(0..) {
        let source_weights = closure
            .iter()
            .flat_map(|glyph| {
                projections
                    .get(glyph)
                    .and_then(|projection| projection.variation.as_ref())
                    .into_iter()
                    .flat_map(|variation| {
                        variation
                            .deltas
                            .iter()
                            .enumerate()
                            .filter_map(|(index, _)| delta_weights.get(&(*glyph, index)).copied())
                    })
            })
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        let base_weight = complement_weight(
            &source_weights,
            complement_start,
            &mut complement_indices,
            &mut complements,
        )?;
        let base = flatten_projection(
            *root,
            &projections,
            &delta_weights,
            registry.regions(),
            ProjectionEvaluation::Base,
        )?;
        let sources = source_weights
            .iter()
            .map(|weight| {
                Ok((
                    *weight,
                    flatten_projection(
                        *root,
                        &projections,
                        &delta_weights,
                        registry.regions(),
                        ProjectionEvaluation::Region(*weight),
                    )?,
                ))
            })
            .collect::<Result<Vec<_>, SourceAtlasError>>()?;
        let curves = compatible_curves(&base, &sources)?;
        let atlas_glyph = builder.add_curve_glyph_with_sources_and_lines(
            curves.base,
            curves.line_flags,
            base_weight,
            curves.sources,
        )?;
        builder.set_glyph_source_advances(
            atlas_glyph,
            std::iter::once(advance(base.advance, root_position)?).chain(
                sources
                    .iter()
                    .enumerate()
                    .map(|(index, (_, outline))| advance(outline.advance, index + 1))
                    .collect::<Result<Vec<_>, _>>()?,
            ),
        )?;
        glyphs.push((*root, atlas_glyph));

        let exact_sources = closure
            .iter()
            .filter_map(|glyph| projections.get(glyph))
            .flat_map(|projection| projection.exact_shapes.iter().map(|shape| shape.source))
            .collect::<BTreeSet<_>>();
        for exact_source in exact_sources {
            let source_record = source
                .directory()
                .sources
                .get(exact_source.to_usize())
                .ok_or_else(|| invalid("exact atlas source is out of range"))?;
            let normalized = source_record
                .location
                .iter()
                .zip(&axes)
                .map(|(value, axis)| axis.normalize_internal(*value))
                .collect::<Result<Vec<_>, _>>()?;
            let outline = flatten_projection(
                *root,
                &projections,
                &delta_weights,
                registry.regions(),
                ProjectionEvaluation::Source(exact_source, &normalized),
            )?;
            let (curves, line_flags) = outline_curves(&outline)?;
            let exact_glyph = builder.add_curve_glyph_with_sources_and_lines(
                curves,
                line_flags,
                0,
                std::iter::empty(),
            )?;
            builder.set_glyph_source_advances(
                exact_glyph,
                std::iter::once(advance(outline.advance, exact_source.to_usize())?),
            )?;
            exact_glyphs.push((*root, exact_source, exact_glyph));
        }
    }

    Ok(SourceAtlasPage::new(
        builder.finish(),
        glyphs,
        exact_glyphs,
        axes,
        registry.into_regions(),
        complements,
    ))
}

fn validate_roots(directory: &FontDirectory, roots: &[GlyphIndex]) -> Result<(), SourceAtlasError> {
    let mut unique = HashSet::with_capacity(roots.len());
    for root in roots {
        if directory.glyphs.get(root.to_usize()).is_none() {
            return Err(FontReadError::GlyphOutOfRange {
                glyph: *root,
                glyph_count: directory.glyphs.len() as u32,
            }
            .into());
        }
        if !unique.insert(*root) {
            return Err(invalid(format!("source atlas page repeats glyph {root:?}")).into());
        }
    }
    Ok(())
}

fn atlas_axes(directory: &FontDirectory) -> Result<Vec<AtlasAxis>, SourceAtlasError> {
    directory
        .axes
        .iter()
        .cloned()
        .map(|axis| {
            let mut mapping = directory
                .axis_mappings
                .iter()
                .find(|mapping| mapping.axis == axis.index)
                .map(|mapping| mapping.points.to_vec())
                .unwrap_or_default();
            mapping.sort_by(|left, right| left.0.total_cmp(&right.0));
            mapping.dedup_by(|left, right| left.0 == right.0);
            let mapped_default = directory
                .sources
                .get(directory.default_source.to_usize())
                .and_then(|source| source.location.get(axis.index.to_usize()))
                .copied()
                .unwrap_or_else(|| map_axis_value(axis.kind.default_value(), &mapping));
            let mut design_values = directory
                .sources
                .iter()
                .filter_map(|source| source.location.get(axis.index.to_usize()).copied())
                .chain(mapping.iter().map(|point| point.1))
                .collect::<Vec<_>>();
            match &axis.kind {
                VariationAxisKind::Continuous {
                    minimum,
                    default,
                    maximum,
                } => design_values.extend([
                    map_axis_value(*minimum, &mapping),
                    map_axis_value(*default, &mapping),
                    map_axis_value(*maximum, &mapping),
                ]),
                VariationAxisKind::Discrete { values, default } => {
                    design_values
                        .extend(values.iter().map(|value| map_axis_value(*value, &mapping)));
                    design_values.push(map_axis_value(*default, &mapping));
                }
            }
            let minimum = design_values.iter().copied().fold(mapped_default, f64::min);
            let maximum = design_values.iter().copied().fold(mapped_default, f64::max);
            if !minimum.is_finite() || !mapped_default.is_finite() || !maximum.is_finite() {
                return Err(invalid("source atlas axis has non-finite design bounds").into());
            }
            Ok(AtlasAxis::new(
                axis,
                mapping,
                minimum,
                mapped_default,
                maximum,
                Vec::new(),
            ))
        })
        .collect()
}

fn map_axis_value(value: f64, points: &[(f64, f64)]) -> f64 {
    match points {
        [] => value,
        [point] => point.1,
        _ => {
            let upper = points.partition_point(|point| point.0 < value);
            let [left, right] = if upper == 0 {
                [points[0], points[1]]
            } else if upper == points.len() {
                [points[points.len() - 2], points[points.len() - 1]]
            } else {
                [points[upper - 1], points[upper]]
            };
            if left.0 == right.0 {
                return left.1;
            }
            left.1 + (right.1 - left.1) * (value - left.0) / (right.0 - left.0)
        }
    }
}

fn atlas_region(
    region: &VariationRegion,
    axis_count: usize,
) -> Result<AtlasRegion, SourceAtlasError> {
    let mut axes = vec![
        RegionAxis {
            start: 0,
            peak: 0,
            end: 0,
        };
        axis_count
    ];
    let mut seen = HashSet::with_capacity(region.supports.len());
    for support in &region.supports {
        let Some(axis) = axes.get_mut(support.axis.to_usize()) else {
            return Err(invalid("source atlas region axis is out of range").into());
        };
        if !seen.insert(support.axis) {
            return Err(invalid("source atlas region repeats an axis").into());
        }
        *axis = RegionAxis {
            start: F2Dot14::from_f32(support.lower as f32).to_bits(),
            peak: F2Dot14::from_f32(support.peak as f32).to_bits(),
            end: F2Dot14::from_f32(support.upper as f32).to_bits(),
        };
    }
    Ok(AtlasRegion::new(axes))
}

fn complement_weight(
    source_weights: &[u32],
    complement_start: u32,
    complement_indices: &mut BTreeMap<Vec<u32>, u32>,
    complements: &mut Vec<Box<[u32]>>,
) -> Result<u32, SourceAtlasError> {
    if source_weights.is_empty() {
        return Ok(0);
    }
    if let Some(weight) = complement_indices.get(source_weights) {
        return Ok(*weight);
    }
    let weight = complement_start
        .checked_add(
            u32::try_from(complements.len()).map_err(|_| shift_slug::SlugError::LengthOverflow)?,
        )
        .ok_or(shift_slug::SlugError::LengthOverflow)?;
    complements.push(source_weights.to_vec().into_boxed_slice());
    complement_indices.insert(source_weights.to_vec(), weight);
    Ok(weight)
}

fn flatten_projection(
    root: GlyphIndex,
    projections: &BTreeMap<GlyphIndex, GlyphProjection>,
    delta_weights: &BTreeMap<(GlyphIndex, usize), u32>,
    regions: &[AtlasRegion],
    evaluation: ProjectionEvaluation<'_>,
) -> Result<ProjectedOutline, SourceAtlasError> {
    let projection = projections
        .get(&root)
        .ok_or_else(|| invalid("source atlas projection root is missing"))?;
    let values = projection_values(projection, delta_weights, regions, evaluation)?;
    let advance = values[0];
    let mut segments = Vec::new();
    flatten_shape(
        projection,
        &values,
        projections,
        delta_weights,
        regions,
        evaluation,
        AffineTransform::identity(),
        &mut HashSet::new(),
        &mut segments,
    )?;
    Ok(ProjectedOutline { advance, segments })
}

#[allow(clippy::too_many_arguments)]
fn flatten_shape(
    projection: &GlyphProjection,
    values: &[f64],
    projections: &BTreeMap<GlyphIndex, GlyphProjection>,
    delta_weights: &BTreeMap<(GlyphIndex, usize), u32>,
    regions: &[AtlasRegion],
    evaluation: ProjectionEvaluation<'_>,
    transform: AffineTransform,
    visiting: &mut HashSet<GlyphIndex>,
    segments: &mut Vec<ProjectedSegment>,
) -> Result<(), SourceAtlasError> {
    if !visiting.insert(projection.glyph) {
        return Err(FontReadError::ComponentCycle {
            glyph: projection.glyph,
        }
        .into());
    }
    let shape = selected_shape(projection, evaluation);
    let mut cursor = 1_usize;
    for contour in &shape.contours {
        let end = cursor
            .checked_add(contour.points.len() * 2)
            .ok_or(shift_slug::SlugError::LengthOverflow)?;
        let coordinates = values
            .get(cursor..end)
            .ok_or_else(|| invalid("source atlas contour values are missing"))?;
        let points = contour
            .points
            .iter()
            .zip(coordinates.chunks_exact(2))
            .map(|(point, values)| {
                let (x, y) = transform.transform_point(values[0], values[1]);
                (point.kind, ProjectedPoint { x, y })
            })
            .collect::<Vec<_>>();
        append_contour(&points, contour.closed, segments)?;
        cursor = end;
    }
    cursor = cursor
        .checked_add(shape.anchors.len() * 2)
        .ok_or(shift_slug::SlugError::LengthOverflow)?;
    for component in &shape.components {
        let transform_values = values
            .get(cursor..cursor + 6)
            .ok_or_else(|| invalid("source atlas component transform is missing"))?;
        let local = AffineTransform {
            xx: transform_values[0],
            xy: transform_values[1],
            yx: transform_values[2],
            yy: transform_values[3],
            dx: transform_values[4],
            dy: transform_values[5],
        };
        let child = projections
            .get(&component.glyph)
            .ok_or_else(|| invalid("source atlas component projection is missing"))?;
        let child_values = projection_values(child, delta_weights, regions, evaluation)?;
        flatten_shape(
            child,
            &child_values,
            projections,
            delta_weights,
            regions,
            evaluation,
            transform.compose(local),
            visiting,
            segments,
        )?;
        cursor += 6;
    }
    if cursor != values.len() {
        return Err(invalid("source atlas shape values have trailing entries").into());
    }
    visiting.remove(&projection.glyph);
    Ok(())
}

fn selected_shape<'a>(
    projection: &'a GlyphProjection,
    evaluation: ProjectionEvaluation<'_>,
) -> &'a GlyphShape {
    let ProjectionEvaluation::Source(source, _) = evaluation else {
        return &projection.fallback;
    };
    projection
        .exact_shapes
        .iter()
        .find(|shape| shape.source == source)
        .map(|shape| &shape.shape)
        .unwrap_or(&projection.fallback)
}

fn projection_values(
    projection: &GlyphProjection,
    delta_weights: &BTreeMap<(GlyphIndex, usize), u32>,
    regions: &[AtlasRegion],
    evaluation: ProjectionEvaluation<'_>,
) -> Result<Vec<f64>, SourceAtlasError> {
    let shape = selected_shape(projection, evaluation);
    if !std::ptr::eq(shape, &projection.fallback) {
        return Ok(shape.values.to_vec());
    }
    let mut values = projection.fallback.values.to_vec();
    let Some(variation) = &projection.variation else {
        return Ok(values);
    };
    for (delta_index, delta) in variation.deltas.iter().enumerate() {
        let weight = *delta_weights
            .get(&(projection.glyph, delta_index))
            .ok_or_else(|| invalid("source atlas delta weight is missing"))?;
        let scalar = match evaluation {
            ProjectionEvaluation::Base => 0.0,
            ProjectionEvaluation::Region(selected) => f64::from((selected == weight) as u8),
            ProjectionEvaluation::Source(_, coordinates) => {
                let region = regions
                    .get((weight - 1) as usize)
                    .ok_or_else(|| invalid("source atlas delta region is missing"))?;
                f64::from(region.scalar(coordinates)?)
            }
        };
        if scalar == 0.0 {
            continue;
        }
        for (value, delta) in values.iter_mut().zip(&delta.values) {
            *value += scalar * delta;
        }
    }
    Ok(values)
}

fn append_contour(
    points: &[(GlyphPointKind, ProjectedPoint)],
    closed: bool,
    segments: &mut Vec<ProjectedSegment>,
) -> Result<(), SourceAtlasError> {
    if points.is_empty() || points[0].0 != GlyphPointKind::OnCurve {
        return Err(invalid("source atlas contour does not begin on-curve").into());
    }
    let start = points[0].1;
    let mut current = start;
    let limit = if closed {
        points.len() + 1
    } else {
        points.len()
    };
    let mut cursor = 1;
    while cursor < limit {
        match points[cursor % points.len()].0 {
            GlyphPointKind::OnCurve => {
                let end = points[cursor % points.len()].1;
                segments.push(ProjectedSegment::Line([current, end]));
                current = end;
                cursor += 1;
            }
            GlyphPointKind::QuadraticControl => {
                if cursor + 1 >= limit
                    || points[(cursor + 1) % points.len()].0 != GlyphPointKind::OnCurve
                {
                    return Err(invalid("source atlas quadratic control has no endpoint").into());
                }
                let control = points[cursor % points.len()].1;
                let end = points[(cursor + 1) % points.len()].1;
                segments.push(ProjectedSegment::Quadratic([current, control, end]));
                current = end;
                cursor += 2;
            }
            GlyphPointKind::CubicControl => {
                if cursor + 2 >= limit
                    || points[(cursor + 1) % points.len()].0 != GlyphPointKind::CubicControl
                    || points[(cursor + 2) % points.len()].0 != GlyphPointKind::OnCurve
                {
                    return Err(invalid("source atlas cubic controls have no endpoint").into());
                }
                let first = points[cursor % points.len()].1;
                let second = points[(cursor + 1) % points.len()].1;
                let end = points[(cursor + 2) % points.len()].1;
                segments.push(ProjectedSegment::Cubic([current, first, second, end]));
                current = end;
                cursor += 3;
            }
        }
    }
    if !closed && points.len() > 1 {
        segments.push(ProjectedSegment::Line([current, start]));
    }
    Ok(())
}

fn compatible_curves(
    base: &ProjectedOutline,
    sources: &[(u32, ProjectedOutline)],
) -> Result<CompatibleCurves, SourceAtlasError> {
    for (_, source) in sources {
        if source.segments.len() != base.segments.len()
            || source
                .segments
                .iter()
                .zip(&base.segments)
                .any(|(left, right)| !same_segment_kind(left, right))
        {
            return Err(invalid("source atlas compatible variation changed curve topology").into());
        }
    }
    let subdivisions = (0..base.segments.len())
        .map(|index| {
            std::iter::once(&base.segments[index])
                .chain(sources.iter().map(|(_, source)| &source.segments[index]))
                .map(cubic_subdivision_count)
                .max()
                .unwrap_or(1)
        })
        .collect::<Vec<_>>();
    let (base_curves, line_flags) = segments_to_curves(&base.segments, &subdivisions)?;
    let source_curves = sources
        .iter()
        .map(|(weight, source)| {
            Ok((
                *weight,
                segments_to_curves(&source.segments, &subdivisions)?.0,
            ))
        })
        .collect::<Result<Vec<_>, SourceAtlasError>>()?;
    Ok(CompatibleCurves {
        base: base_curves,
        line_flags,
        sources: source_curves,
    })
}

fn outline_curves(outline: &ProjectedOutline) -> Result<(Vec<Curve>, Vec<bool>), SourceAtlasError> {
    let subdivisions = outline
        .segments
        .iter()
        .map(cubic_subdivision_count)
        .collect::<Vec<_>>();
    segments_to_curves(&outline.segments, &subdivisions)
}

fn segments_to_curves(
    segments: &[ProjectedSegment],
    subdivisions: &[usize],
) -> Result<(Vec<Curve>, Vec<bool>), SourceAtlasError> {
    let mut curves = Vec::new();
    let mut line_flags = Vec::new();
    for (segment, subdivision_count) in segments.iter().zip(subdivisions) {
        match segment {
            ProjectedSegment::Line(points) => {
                curves.push(Curve::from_line(point(points[0])?, point(points[1])?));
                line_flags.push(true);
            }
            ProjectedSegment::Quadratic(points) => {
                curves.push(Curve {
                    p0: point(points[0])?,
                    p1: point(points[1])?,
                    p2: point(points[2])?,
                });
                line_flags.push(false);
            }
            ProjectedSegment::Cubic(points) => {
                let approximated = Curve::from_cubic_with_subdivisions(
                    point(points[0])?,
                    point(points[1])?,
                    point(points[2])?,
                    point(points[3])?,
                    *subdivision_count,
                );
                line_flags.extend(std::iter::repeat_n(false, approximated.len()));
                curves.extend(approximated);
            }
        }
    }
    Ok((curves, line_flags))
}

fn same_segment_kind(left: &ProjectedSegment, right: &ProjectedSegment) -> bool {
    matches!(
        (left, right),
        (ProjectedSegment::Line(_), ProjectedSegment::Line(_))
            | (
                ProjectedSegment::Quadratic(_),
                ProjectedSegment::Quadratic(_)
            )
            | (ProjectedSegment::Cubic(_), ProjectedSegment::Cubic(_))
    )
}

fn cubic_subdivision_count(segment: &ProjectedSegment) -> usize {
    let ProjectedSegment::Cubic(points) = segment else {
        return 1;
    };
    let converted = points.map(|point| Point::new(point.x as f32, point.y as f32));
    Curve::cubic_subdivision_count(converted[0], converted[1], converted[2], converted[3])
}

fn point(value: ProjectedPoint) -> Result<Point, SourceAtlasError> {
    let x = value.x as f32;
    let y = value.y as f32;
    if !value.x.is_finite() || !value.y.is_finite() || !x.is_finite() || !y.is_finite() {
        return Err(invalid("source atlas point is not a finite f32 coordinate").into());
    }
    Ok(Point::new(x, y))
}

fn advance(value: f64, source_index: usize) -> Result<f32, SourceAtlasError> {
    let advance = value as f32;
    if value.is_finite() && advance.is_finite() {
        Ok(advance)
    } else {
        Err(invalid(format!(
            "source atlas advance at source {source_index} is not finite"
        ))
        .into())
    }
}

fn invalid(details: impl Into<String>) -> FontReadError {
    FontReadError::InvalidProjection {
        details: details.into(),
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;
    use crate::font_source::{GlifFont, GlyphsFont, ProjectedGlyph, VariationCoordinate};

    fn fixture(path: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join("fixtures/fonts")
            .join(path)
    }

    #[test]
    fn ufo_page_contains_resolvable_outline_geometry() {
        let font = GlifFont::open(&fixture("mutatorsans/MutatorSansLightCondensed.ufo")).unwrap();
        let glyph = font
            .directory()
            .glyphs
            .iter()
            .find(|glyph| glyph.name == "S")
            .unwrap()
            .index;

        let page = font
            .atlas_page(&[glyph], shift_slug::DEFAULT_BAND_COUNT)
            .unwrap();
        let weights = page.weights(font.directory().default_location()).unwrap();
        let atlas_glyph = page.glyphs()[0].1;

        assert!(!page
            .atlas()
            .resolve_glyph_with_weights(atlas_glyph, &weights)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn glyphs_page_flattens_component_closures() {
        let font = GlyphsFont::open(&fixture("Homenaje.glyphs")).unwrap();
        let glyph = font
            .directory()
            .glyphs
            .iter()
            .find(|glyph| glyph.name == "Aacute")
            .unwrap()
            .index;

        let page = font
            .atlas_page(&[glyph], shift_slug::DEFAULT_BAND_COUNT)
            .unwrap();
        let weights = page.weights(font.directory().default_location()).unwrap();
        let atlas_glyph = page.glyphs()[0].1;

        assert!(!page
            .atlas()
            .resolve_glyph_with_weights(atlas_glyph, &weights)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn every_drawable_glyphs_projection_has_default_atlas_curves() {
        let font = GlyphsFont::open(&fixture("MutatorSansVariable.glyphs")).unwrap();
        assert_default_atlas_coverage(&font);
    }

    #[test]
    fn every_drawable_ufo_projection_has_default_atlas_curves() {
        let font = GlifFont::open(&fixture("mutatorsans/MutatorSansLightCondensed.ufo")).unwrap();
        assert_default_atlas_coverage(&font);
    }

    fn assert_default_atlas_coverage(font: &dyn FontSource) {
        let roots = font
            .directory()
            .glyphs
            .iter()
            .map(|glyph| glyph.index)
            .collect::<Vec<_>>();
        let projected = roots
            .iter()
            .map(|glyph| font.glyph(*glyph).unwrap())
            .collect::<Vec<_>>();
        let page = font
            .atlas_page(&roots, shift_slug::DEFAULT_BAND_COUNT)
            .unwrap();
        let weights = page.weights(font.directory().default_location()).unwrap();

        for (((glyph, atlas_glyph), projection), directory) in page
            .glyphs()
            .iter()
            .zip(&projected)
            .zip(font.directory().glyphs.iter())
        {
            assert_eq!(*glyph, directory.index);
            let curves = page
                .atlas()
                .resolve_glyph_with_weights(*atlas_glyph, &weights)
                .unwrap();
            assert_eq!(
                curves.is_empty(),
                !projection_has_outline(projection, None),
                "glyph {:?} ({}) default projection/atlas coverage differs",
                glyph,
                directory.name,
            );
        }

        for source in &font.directory().sources {
            let location = external_source_location(font.directory(), source.index);
            let weights = page.weights(&location).unwrap();
            for (((glyph, default_glyph), projection), directory) in page
                .glyphs()
                .iter()
                .zip(&projected)
                .zip(font.directory().glyphs.iter())
            {
                let atlas_glyph = page
                    .exact_glyphs()
                    .iter()
                    .find(|(root, exact_source, _)| root == glyph && *exact_source == source.index)
                    .map(|(_, _, glyph)| *glyph)
                    .unwrap_or(*default_glyph);
                let curves = page
                    .atlas()
                    .resolve_glyph_with_weights(atlas_glyph, &weights)
                    .unwrap();
                assert_eq!(
                    curves.is_empty(),
                    !projection_has_outline(projection, Some(source.index)),
                    "glyph {:?} ({}) source {:?} projection/atlas coverage differs",
                    glyph,
                    directory.name,
                    source.index,
                );
            }
        }
    }

    fn projection_has_outline(projected: &ProjectedGlyph, source: Option<SourceIndex>) -> bool {
        let projections = std::iter::once(&projected.root)
            .chain(projected.components.iter())
            .map(|projection| (projection.glyph, projection))
            .collect::<BTreeMap<_, _>>();
        shape_has_outline(
            selected_source_shape(&projected.root, source),
            source,
            &projections,
            &mut HashSet::new(),
        )
    }

    fn selected_source_shape(
        projection: &GlyphProjection,
        source: Option<SourceIndex>,
    ) -> &GlyphShape {
        source
            .and_then(|source| {
                projection
                    .exact_shapes
                    .iter()
                    .find(|shape| shape.source == source)
            })
            .map(|shape| &shape.shape)
            .unwrap_or(&projection.fallback)
    }

    fn shape_has_outline(
        shape: &GlyphShape,
        source: Option<SourceIndex>,
        projections: &BTreeMap<GlyphIndex, &GlyphProjection>,
        visiting: &mut HashSet<GlyphIndex>,
    ) -> bool {
        if shape
            .contours
            .iter()
            .any(|contour| contour.closed || contour.points.len() > 1)
        {
            return true;
        }
        shape.components.iter().any(|component| {
            if !visiting.insert(component.glyph) {
                return false;
            }
            let has_outline = projections.get(&component.glyph).is_some_and(|projection| {
                shape_has_outline(
                    selected_source_shape(projection, source),
                    source,
                    projections,
                    visiting,
                )
            });
            visiting.remove(&component.glyph);
            has_outline
        })
    }

    fn external_source_location(
        directory: &FontDirectory,
        source: SourceIndex,
    ) -> super::super::VariationLocation {
        let source = &directory.sources[source.to_usize()];
        let coordinates = source
            .location
            .iter()
            .enumerate()
            .map(|(axis_index, design_value)| {
                let mut mapping = directory
                    .axis_mappings
                    .iter()
                    .find(|mapping| mapping.axis.to_usize() == axis_index)
                    .map(|mapping| {
                        mapping
                            .points
                            .iter()
                            .map(|(user, design)| (*design, *user))
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                mapping.sort_by(|left, right| left.0.total_cmp(&right.0));
                VariationCoordinate {
                    axis: super::super::AxisIndex::new(axis_index as u32),
                    value: map_axis_value(*design_value, &mapping),
                }
            })
            .collect::<Vec<_>>();
        directory.location(&coordinates).unwrap()
    }
}
