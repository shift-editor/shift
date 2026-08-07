use std::collections::{BTreeMap, BTreeSet, HashSet};

use rayon::prelude::*;
use shift_slug::retained::{
    ExactVariant, GlyphInput, GlyphSegment, GlyphShape as RetainedGlyphShape, PageInput,
};
use skrifa::raw::types::F2Dot14;

use super::atlas::{
    validate_roots, AtlasAxis, AtlasRegion, RegionAxis, RegionRegistry, SourceAtlasError,
};
use super::interpolation::piecewise_map;
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

#[derive(Clone, Copy)]
enum ProjectionEvaluation<'a> {
    Base,
    Region(u32),
    Source(SourceIndex, &'a [i16]),
}

/// Builds source-neutral retained compiler inputs from projected glyphs.
pub fn variable_glyph_inputs<S: FontSource + ?Sized>(
    source: &S,
    roots: &[GlyphIndex],
) -> Result<PageInput, SourceAtlasError> {
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

    let mut glyphs = Vec::with_capacity(roots.len());
    for (root, closure) in roots.iter().zip(&closures) {
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
        let base = flatten_projection(
            *root,
            &projections,
            &delta_weights,
            registry.regions(),
            ProjectionEvaluation::Base,
        )?;
        let (shape, base_values) = outline_input(&base);
        let samples = source_weights
            .iter()
            .map(|weight| {
                let outline = flatten_projection(
                    *root,
                    &projections,
                    &delta_weights,
                    registry.regions(),
                    ProjectionEvaluation::Region(*weight),
                )?;
                let (sample_shape, values) = outline_input(&outline);
                if sample_shape != shape {
                    return Err(invalid(
                        "source atlas compatible variation changed curve topology",
                    )
                    .into());
                }
                Ok((*weight, values))
            })
            .collect::<Result<Vec<_>, SourceAtlasError>>()?;

        let exact_sources = closure
            .iter()
            .filter_map(|glyph| projections.get(glyph))
            .flat_map(|projection| projection.exact_shapes.iter().map(|shape| shape.source))
            .collect::<BTreeSet<_>>();
        let exact_variants = exact_sources
            .into_iter()
            .map(|exact_source| {
                let source_record = source
                    .directory()
                    .sources
                    .get(exact_source.to_usize())
                    .ok_or_else(|| invalid("exact atlas source is out of range"))?;
                let normalized = source_record
                    .location
                    .iter()
                    .zip(&axes)
                    .enumerate()
                    .map(|(axis_index, (value, axis))| axis.normalize_design(*value, axis_index))
                    .collect::<Result<Vec<_>, _>>()?;
                let outline = flatten_projection(
                    *root,
                    &projections,
                    &delta_weights,
                    registry.regions(),
                    ProjectionEvaluation::Source(exact_source, &normalized),
                )?;
                let (shape, values) = outline_input(&outline);
                Ok(ExactVariant {
                    source_index: exact_source.to_u32(),
                    shape,
                    values,
                })
            })
            .collect::<Result<Vec<_>, SourceAtlasError>>()?;

        glyphs.push((
            root.to_u32(),
            GlyphInput {
                shape,
                base_values,
                samples,
                exact_variants,
            },
        ));
    }

    Ok(PageInput {
        glyphs,
        axes,
        regions: registry.into_regions(),
    })
}

fn outline_input(outline: &ProjectedOutline) -> (RetainedGlyphShape, Box<[f64]>) {
    let mut values = vec![outline.advance];
    let segments = outline
        .segments
        .iter()
        .map(|segment| match segment {
            ProjectedSegment::Line(points) => {
                for point in points {
                    values.extend([point.x, point.y]);
                }
                GlyphSegment::Line
            }
            ProjectedSegment::Quadratic(points) => {
                for point in points {
                    values.extend([point.x, point.y]);
                }
                GlyphSegment::Quadratic
            }
            ProjectedSegment::Cubic(points) => {
                for point in points {
                    values.extend([point.x, point.y]);
                }
                GlyphSegment::Cubic
            }
        })
        .collect();
    (RetainedGlyphShape::new(segments), values.into_boxed_slice())
}

fn atlas_axes(directory: &FontDirectory) -> Result<Vec<AtlasAxis>, SourceAtlasError> {
    directory
        .axes
        .iter()
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
                .unwrap_or_else(|| piecewise_map(axis.kind.default_value(), &mapping));
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
                    piecewise_map(*minimum, &mapping),
                    piecewise_map(*default, &mapping),
                    piecewise_map(*maximum, &mapping),
                ]),
                VariationAxisKind::Discrete { values, default } => {
                    design_values
                        .extend(values.iter().map(|value| piecewise_map(*value, &mapping)));
                    design_values.push(piecewise_map(*default, &mapping));
                }
            }
            let minimum = design_values.iter().copied().fold(mapped_default, f64::min);
            let maximum = design_values.iter().copied().fold(mapped_default, f64::max);
            if !minimum.is_finite() || !mapped_default.is_finite() || !maximum.is_finite() {
                return Err(invalid("source atlas axis has non-finite design bounds").into());
            }
            Ok(AtlasAxis::new(
                mapping,
                minimum,
                mapped_default,
                maximum,
                Vec::new(),
            ))
        })
        .collect()
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

fn invalid(details: impl Into<String>) -> FontReadError {
    FontReadError::InvalidProjection {
        details: details.into(),
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;
    use crate::font_source::{
        GlyphsFont, ProjectedGlyph, SourceAtlasPage, UfoFont, VariationCoordinate,
    };

    fn fixture(path: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join("fixtures/fonts")
            .join(path)
    }

    fn compile_page(
        font: &dyn FontSource,
        roots: &[GlyphIndex],
    ) -> Result<SourceAtlasPage, SourceAtlasError> {
        let input = variable_glyph_inputs(font, roots)?;
        Ok(shift_slug::retained::compile_page(
            &input,
            shift_slug::DEFAULT_BAND_COUNT,
        )?)
    }

    #[test]
    fn ufo_page_contains_resolvable_outline_geometry() {
        let font = UfoFont::open(&fixture("mutatorsans/MutatorSansLightCondensed.ufo")).unwrap();
        let glyph = font
            .directory()
            .glyphs
            .iter()
            .find(|glyph| glyph.name == "S")
            .unwrap()
            .index;

        let page = compile_page(&font, &[glyph]).unwrap();
        let weights = page
            .weights(font.directory().default_location().coordinates())
            .unwrap();
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

        let page = compile_page(&font, &[glyph]).unwrap();
        let weights = page
            .weights(font.directory().default_location().coordinates())
            .unwrap();
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
        let font = UfoFont::open(&fixture("mutatorsans/MutatorSansLightCondensed.ufo")).unwrap();
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
        let page = compile_page(font, &roots).unwrap();
        let weights = page
            .weights(font.directory().default_location().coordinates())
            .unwrap();

        for (((glyph, atlas_glyph), projection), directory) in page
            .glyphs()
            .iter()
            .zip(&projected)
            .zip(font.directory().glyphs.iter())
        {
            assert_eq!(*glyph, directory.index.to_u32());
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
            let weights = page.weights(location.coordinates()).unwrap();
            for (((glyph, default_glyph), projection), directory) in page
                .glyphs()
                .iter()
                .zip(&projected)
                .zip(font.directory().glyphs.iter())
            {
                let atlas_glyph = page
                    .exact_glyphs()
                    .iter()
                    .find(|(root, exact_source, _)| {
                        root == glyph && *exact_source == source.index.to_u32()
                    })
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
                    value: piecewise_map(*design_value, &mapping),
                }
            })
            .collect::<Vec<_>>();
        directory.location(&coordinates).unwrap()
    }
}
