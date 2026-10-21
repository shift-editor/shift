use crate::length::OrOverflow;
use crate::numeric::lossy_f32;
use shift_font::Require;
use std::collections::{HashMap, hash_map::Entry};
use std::time::Instant;

use shift_font::{
    ComponentId, Font, GlyphId, GlyphLayer, GlyphProjection, GlyphProjectionSet,
    InterpolationBasis, ResolvedGlyph, SourceId,
};

use crate::variable::ROOT_COMPONENT;
use crate::{
    AuthoredAtlasProfile, Bounds, GlyphIndex, VariableAtlasBuilder, VariableComponent,
    VariableComponentPart, VariableComponentSource,
};

use super::{
    AuthoredDefaultGlyphs, AuthoredDefaultKey, AuthoredGlyph, AuthoredGlyphCompilation,
    AuthoredSlugError, AuthoredSourceGlyph, CurveTopology, add_default_projection_glyph,
    add_resolved_sources_glyph, authored_advance, curves_from_resolved_contours, source_location,
};

/// One deduplicated interpolation basis and its per-frame weight-buffer indexes.
#[derive(Clone, Debug, PartialEq)]
pub struct AuthoredWeightSet {
    basis: InterpolationBasis,
    source_weight_indices: Vec<u32>,
}

impl AuthoredWeightSet {
    /// Pairs an interpolation basis with the atlas weight slot of each of its sources.
    ///
    /// # Errors
    ///
    /// Returns [`AuthoredSlugError::WeightCountMismatch`] when `source_weight_indices` does not
    /// have one entry per basis source.
    pub fn new(
        basis: InterpolationBasis,
        source_weight_indices: Vec<u32>,
    ) -> Result<Self, AuthoredSlugError> {
        let expected = basis.source_ids().len();
        let actual = source_weight_indices.len();
        if expected != actual {
            return Err(AuthoredSlugError::WeightCountMismatch { expected, actual });
        }
        Ok(Self {
            basis,
            source_weight_indices,
        })
    }

    pub fn basis(&self) -> &InterpolationBasis {
        &self.basis
    }

    pub fn source_weight_indices(&self) -> &[u32] {
        &self.source_weight_indices
    }
}

/// Adds a complete authored glyph using independently deduplicated root and component bases.
///
/// Rust owns topology, occurrence order, cycle pruning, and anchor matching. This adapter only
/// turns those relationships and their canonical source samples into the resident GPU program.
///
/// # Errors
///
/// Returns [`AuthoredSlugError::Core`] when the glyph or a component cannot be projected,
/// [`AuthoredSlugError::MissingWeightBasis`] when no weight set matches a glyph's basis, a topology
/// or finiteness error when a source does not match its default, and [`AuthoredSlugError::Slug`]
/// when the atlas outgrows its limits. The builder is rolled back on failure.
pub fn add_authored_glyph_with_weight_sets(
    builder: &mut VariableAtlasBuilder,
    font: &Font,
    projection: &GlyphProjection,
    weight_sets: &[AuthoredWeightSet],
    constant_weight_index: u32,
) -> Result<AuthoredGlyph, AuthoredSlugError> {
    let glyph_id = projection.glyph_id();
    let projection_set = font.glyph_projection_set(std::slice::from_ref(&glyph_id))?;
    let projection = projection_set.projection(&glyph_id).require(&glyph_id)?;
    let checkpoint = builder.checkpoint();
    let mut defaults = AuthoredDefaultGlyphs::new();
    let mut inserted_defaults = Vec::new();
    let mut profile = AuthoredAtlasProfile::default();
    let mut compilation = AuthoredGlyphCompilation {
        font,
        projection_set: &projection_set,
        weight_sets,
        constant_weight_index,
        profile: &mut profile,
    };
    match add_authored_glyph_with_weight_sets_cached(
        builder,
        &mut defaults,
        &mut inserted_defaults,
        &mut compilation,
        projection,
    ) {
        Ok(glyph) => Ok(glyph),
        Err(error) => {
            builder.rollback(checkpoint);
            Err(error)
        }
    }
}

pub(super) fn add_authored_glyph_with_weight_sets_cached(
    builder: &mut VariableAtlasBuilder,
    defaults: &mut AuthoredDefaultGlyphs,
    inserted_defaults: &mut Vec<AuthoredDefaultKey>,
    compilation: &mut AuthoredGlyphCompilation<'_, '_>,
    projection: &GlyphProjection,
) -> Result<AuthoredGlyph, AuthoredSlugError> {
    let mut resolved_sources = HashMap::new();
    let default_glyph = if projection.components().components().is_empty() {
        let source_weight_indices = projection_weight_indices(projection, compilation.weight_sets)?;
        add_default_projection_glyph(
            builder,
            defaults,
            inserted_defaults,
            projection,
            source_weight_indices,
            compilation.constant_weight_index,
        )?
    } else {
        add_default_component_projection_glyph(
            builder,
            defaults,
            inserted_defaults,
            compilation,
            projection,
            &mut resolved_sources,
        )?
    };

    let exact_started = Instant::now();
    let exact_source_ids =
        exact_source_ids(compilation.font, compilation.projection_set, projection)?;
    let mut exact_sources = Vec::with_capacity(exact_source_ids.len());
    for source_id in exact_source_ids {
        let resolved = resolved_source_glyph(
            &mut resolved_sources,
            compilation.font,
            compilation.projection_set,
            projection,
            &source_id,
        )?;
        let topology = CurveTopology::from_contours(resolved.contours());
        let advance = authored_advance(resolved.x_advance(), 0)?;
        let glyph_index = builder.add_outline_glyph(
            topology.outline_from_contours(resolved.contours())?,
            compilation.constant_weight_index,
            [],
        )?;
        builder.set_glyph_source_advances(glyph_index, [advance])?;
        exact_sources.push(AuthoredSourceGlyph {
            source_id,
            glyph_index,
        });
    }
    compilation.profile.exact_source_preparation += exact_started.elapsed();

    Ok(AuthoredGlyph {
        default_glyph,
        exact_sources,
    })
}

pub(super) fn add_default_component_projection_glyph(
    builder: &mut VariableAtlasBuilder,
    defaults: &mut AuthoredDefaultGlyphs,
    inserted_defaults: &mut Vec<AuthoredDefaultKey>,
    compilation: &mut AuthoredGlyphCompilation<'_, '_>,
    projection: &GlyphProjection,
    resolved_sources: &mut HashMap<SourceId, ResolvedGlyph>,
) -> Result<GlyphIndex, AuthoredSlugError> {
    let component_started = Instant::now();
    if let Some(glyph_index) =
        add_decomposed_component_glyph(builder, compilation, projection, resolved_sources)?
    {
        compilation.profile.component_preparation += component_started.elapsed();
        return Ok(glyph_index);
    }
    let mut direct_glyphs = HashMap::<GlyphId, GlyphIndex>::new();
    for glyph_id in std::iter::once(projection.glyph_id()).chain(
        projection
            .components()
            .components()
            .iter()
            .map(shift_font::composite::ComponentGlyph::base_glyph_id),
    ) {
        if direct_glyphs.contains_key(&glyph_id) {
            continue;
        }
        let direct_projection = projection_for(compilation.projection_set, &glyph_id)?;
        let weight_indices = projection_weight_indices(direct_projection, compilation.weight_sets)?;
        let glyph_index = add_default_projection_glyph(
            builder,
            defaults,
            inserted_defaults,
            direct_projection,
            weight_indices,
            compilation.constant_weight_index,
        )?;
        direct_glyphs.insert(glyph_id, glyph_index);
    }

    let mut component_indexes = HashMap::<Vec<ComponentId>, u32>::new();
    for (component_index, component) in projection.components().components().iter().enumerate() {
        component_indexes.insert(
            component.component_path().as_slice().to_vec(),
            u32::try_from(component_index).or_overflow()?,
        );
    }

    let mut component_sources = Vec::new();
    let mut components = Vec::with_capacity(projection.components().components().len());
    for (component_index, occurrence) in projection.components().components().iter().enumerate() {
        let parent_projection =
            projection_for(compilation.projection_set, &occurrence.parent_glyph_id())?;
        let source_start = u32::try_from(component_sources.len()).or_overflow()?;
        let source_context = AuthoredComponentSourceContext {
            weight_sets: compilation.weight_sets,
            constant_weight_index: compilation.constant_weight_index,
            component_index,
        };
        append_component_sources(
            &mut component_sources,
            parent_projection,
            &occurrence.component_id(),
            &occurrence.base_glyph_id(),
            &source_context,
        )?;
        let source_count = u32::try_from(component_sources.len())
            .or_overflow()?
            .checked_sub(source_start)
            .or_overflow()?;

        let parent_component =
            component_index_for_path(&component_indexes, occurrence.parent_path().as_slice())?;
        components.push(VariableComponent {
            parent_component,
            source_start,
            source_count,
        });
    }

    let root_glyph_index = direct_glyphs[&projection.glyph_id()];
    let mut output_curve_start = 0_u32;
    let mut parts = Vec::with_capacity(components.len() + 1);
    append_part(
        builder,
        &mut parts,
        root_glyph_index,
        ROOT_COMPONENT,
        &mut output_curve_start,
    )?;
    for (component_index, occurrence) in projection.components().components().iter().enumerate() {
        append_part(
            builder,
            &mut parts,
            direct_glyphs[&occurrence.base_glyph_id()],
            u32::try_from(component_index).or_overflow()?,
            &mut output_curve_start,
        )?;
    }

    compilation.profile.component_preparation += component_started.elapsed();
    let fallback_started = Instant::now();
    let bounds = fallback_bounds(
        compilation.font,
        compilation.projection_set,
        projection,
        resolved_sources,
    )?;
    compilation.profile.fallback_bounds += fallback_started.elapsed();
    builder
        .add_component_glyph(
            bounds,
            root_glyph_index,
            parts,
            components,
            component_sources,
        )
        .map_err(Into::into)
}

/// Adds a glyph that compiled fonts interpolate decomposed, keeping one part
/// per component occurrence.
///
/// Each part's curves are that occurrence's outline as each decomposition
/// master places it, weighted by the decomposition basis, and every occurrence
/// keeps an identity transform. Returns `None` for any other glyph.
fn add_decomposed_component_glyph(
    builder: &mut VariableAtlasBuilder,
    compilation: &mut AuthoredGlyphCompilation<'_, '_>,
    projection: &GlyphProjection,
    resolved_sources: &mut HashMap<SourceId, ResolvedGlyph>,
) -> Result<Option<GlyphIndex>, AuthoredSlugError> {
    let glyph_id = projection.glyph_id();
    if projection.decomposition().is_none() {
        return Ok(None);
    }
    let Some(decomposition) = compilation.font.decomposition(&glyph_id)? else {
        return Ok(None);
    };
    let outlines = decomposition.outlines();
    let occurrences = projection.components().components();
    let part_count = occurrences.len().checked_add(1).or_overflow()?;
    if outlines.iter().any(|parts| parts.len() != part_count) {
        return Ok(None);
    }
    let weight_indices = compilation
        .weight_sets
        .iter()
        .find(|set| set.basis() == decomposition.basis())
        .map(AuthoredWeightSet::source_weight_indices)
        .ok_or_else(|| AuthoredSlugError::MissingWeightBasis(glyph_id.clone()))?;
    if weight_indices.len() != outlines.len() {
        return Err(AuthoredSlugError::WeightCountMismatch {
            expected: outlines.len(),
            actual: weight_indices.len(),
        });
    }

    let mut parts = Vec::with_capacity(part_count);
    let mut output_curve_start = 0_u32;
    let mut root_glyph_index = None;
    for part_index in 0..part_count {
        let part_sources = outlines
            .iter()
            .zip(weight_indices)
            .map(|(parts, weight_index)| (*weight_index, parts[part_index].as_slice()))
            .collect::<Vec<_>>();
        let glyph_index = add_resolved_sources_glyph(builder, &part_sources)?;
        if part_index == 0 {
            builder.set_glyph_source_advances(
                glyph_index,
                decomposition_advances(compilation.font, &glyph_id, decomposition.basis())?,
            )?;
            root_glyph_index = Some(glyph_index);
        }
        let component_index = match part_index {
            0 => ROOT_COMPONENT,
            _ => u32::try_from(part_index - 1).or_overflow()?,
        };
        append_part(
            builder,
            &mut parts,
            glyph_index,
            component_index,
            &mut output_curve_start,
        )?;
    }

    // Parts are already placed, so every occurrence gets an identity
    // transform: one identity sample per source, whose weights sum to one.
    let source_count = u32::try_from(weight_indices.len()).or_overflow()?;
    let mut component_sources = Vec::new();
    let mut components = Vec::with_capacity(occurrences.len());
    for _ in occurrences {
        components.push(VariableComponent {
            parent_component: ROOT_COMPONENT,
            source_start: u32::try_from(component_sources.len()).or_overflow()?,
            source_count,
        });
        component_sources.extend(weight_indices.iter().map(|weight_index| {
            VariableComponentSource {
                weight_index: *weight_index,
                scale_x: 1.0,
                scale_y: 1.0,
                ..VariableComponentSource::default()
            }
        }));
    }

    let bounds = fallback_bounds(
        compilation.font,
        compilation.projection_set,
        projection,
        resolved_sources,
    )?;
    let root_glyph_index = root_glyph_index.expect("a decomposed glyph has a root part");
    let glyph_index = builder.add_component_glyph(
        bounds,
        root_glyph_index,
        parts,
        components,
        component_sources,
    )?;
    Ok(Some(glyph_index))
}

/// The glyph's advance at each master of `basis`, in its source order.
fn decomposition_advances(
    font: &Font,
    glyph_id: &GlyphId,
    basis: &InterpolationBasis,
) -> Result<Vec<f32>, AuthoredSlugError> {
    basis
        .source_ids()
        .iter()
        .enumerate()
        .map(|(source_index, source_id)| {
            let location = font.require_source(source_id)?.location();
            let glyph = font
                .projection(location)
                .glyph(glyph_id)?
                .require(glyph_id)?;
            authored_advance(glyph.x_advance(), source_index)
        })
        .collect()
}

fn projection_for<'a>(
    projection_set: &'a GlyphProjectionSet,
    glyph_id: &GlyphId,
) -> Result<&'a GlyphProjection, AuthoredSlugError> {
    projection_set
        .projection(glyph_id)
        .require(glyph_id)
        .map_err(Into::into)
}

fn projection_weight_indices<'a>(
    projection: &GlyphProjection,
    weight_sets: &'a [AuthoredWeightSet],
) -> Result<&'a [u32], AuthoredSlugError> {
    let Some(interpolation) = projection.interpolation() else {
        return Ok(&[]);
    };
    weight_sets
        .iter()
        .find(|set| set.basis() == interpolation.basis())
        .map(AuthoredWeightSet::source_weight_indices)
        .ok_or_else(|| AuthoredSlugError::MissingWeightBasis(projection.glyph_id()))
}

struct AuthoredComponentSourceContext<'a> {
    weight_sets: &'a [AuthoredWeightSet],
    constant_weight_index: u32,
    component_index: usize,
}

impl AuthoredComponentSourceContext<'_> {
    fn weighted_layers(
        &self,
        projection: &GlyphProjection,
    ) -> Result<Vec<(u32, GlyphLayer)>, AuthoredSlugError> {
        let Some(interpolation) = projection.interpolation() else {
            return Ok(vec![(
                self.constant_weight_index,
                projection.fallback().clone(),
            )]);
        };
        let weight_indices = projection_weight_indices(projection, self.weight_sets)?;
        interpolation
            .sources()
            .iter()
            .zip(weight_indices)
            .map(|(source, weight_index)| {
                let mut layer = interpolation.reference_layer().clone();
                layer.apply_interpolation_values(source.values())?;
                Ok((*weight_index, layer))
            })
            .collect()
    }
}

fn append_component_sources(
    output: &mut Vec<VariableComponentSource>,
    parent_projection: &GlyphProjection,
    component_id: &ComponentId,
    base_glyph_id: &GlyphId,
    context: &AuthoredComponentSourceContext<'_>,
) -> Result<(), AuthoredSlugError> {
    for (source_index, (weight_index, layer)) in context
        .weighted_layers(parent_projection)?
        .into_iter()
        .enumerate()
    {
        let component = layer
            .component(component_id)
            .filter(|component| component.base_glyph_id() == *base_glyph_id)
            .ok_or_else(|| shift_font::CoreError::InvalidComponentId(component_id.to_string()))?;
        let transform = component.transform();
        let values = [
            transform.translate_x,
            transform.translate_y,
            transform.rotation,
            transform.scale_x,
            transform.scale_y,
            transform.skew_x,
            transform.skew_y,
            transform.t_center_x,
            transform.t_center_y,
        ];
        if values
            .iter()
            .any(|value| !value.is_finite() || !lossy_f32(*value).is_finite())
        {
            return Err(AuthoredSlugError::NonFiniteComponentValue {
                component_index: context.component_index,
                source_index,
                kind: "transform",
            });
        }
        output.push(VariableComponentSource {
            weight_index,
            translate_x: lossy_f32(values[0]),
            translate_y: lossy_f32(values[1]),
            rotation: lossy_f32(values[2]),
            scale_x: lossy_f32(values[3]),
            scale_y: lossy_f32(values[4]),
            skew_x: lossy_f32(values[5]),
            skew_y: lossy_f32(values[6]),
            center_x: lossy_f32(values[7]),
            center_y: lossy_f32(values[8]),
        });
    }
    Ok(())
}

fn component_index_for_path(
    indexes: &HashMap<Vec<ComponentId>, u32>,
    path: &[ComponentId],
) -> Result<u32, AuthoredSlugError> {
    if path.is_empty() {
        return Ok(ROOT_COMPONENT);
    }
    indexes.get(path).copied().or_overflow().map_err(Into::into)
}

fn append_part(
    builder: &VariableAtlasBuilder,
    parts: &mut Vec<VariableComponentPart>,
    glyph_index: GlyphIndex,
    component_index: u32,
    output_curve_start: &mut u32,
) -> Result<(), AuthoredSlugError> {
    let glyph = builder.glyph(glyph_index)?;
    parts.push(VariableComponentPart {
        glyph_index,
        component_index,
        output_curve_start: *output_curve_start,
        _padding: 0,
    });
    *output_curve_start = output_curve_start
        .checked_add(glyph.curve_count)
        .or_overflow()?;
    Ok(())
}

fn fallback_bounds(
    font: &Font,
    projection_set: &GlyphProjectionSet,
    projection: &GlyphProjection,
    resolved_sources: &mut HashMap<SourceId, ResolvedGlyph>,
) -> Result<Bounds, AuthoredSlugError> {
    let resolved = resolved_source_glyph(
        resolved_sources,
        font,
        projection_set,
        projection,
        &projection.fallback().source_id(),
    )?;
    let curves = curves_from_resolved_contours(resolved.contours())?;
    Ok(Bounds::of_curves(&curves))
}

fn exact_source_ids(
    font: &Font,
    projection_set: &GlyphProjectionSet,
    root: &GlyphProjection,
) -> Result<Vec<SourceId>, AuthoredSlugError> {
    let projections = std::iter::once(root)
        .chain(
            root.component_glyph_ids()
                .iter()
                .map(|glyph_id| projection_for(projection_set, glyph_id))
                .collect::<Result<Vec<_>, _>>()?,
        )
        .collect::<Vec<_>>();
    Ok(font
        .sources()
        .iter()
        .map(shift_font::Source::id)
        .filter(|source_id| {
            projections.iter().any(|projection| {
                projection
                    .exact_source_shapes()
                    .iter()
                    .any(|shape| shape.source_id() == *source_id)
                    || projection
                        .exact_source_components()
                        .iter()
                        .any(|components| components.source_id() == *source_id)
            })
        })
        .collect())
}

fn resolved_source_glyph<'a>(
    resolved_sources: &'a mut HashMap<SourceId, ResolvedGlyph>,
    font: &Font,
    projection_set: &GlyphProjectionSet,
    projection: &GlyphProjection,
    source_id: &SourceId,
) -> Result<&'a ResolvedGlyph, AuthoredSlugError> {
    match resolved_sources.entry(source_id.clone()) {
        Entry::Occupied(entry) => Ok(entry.into_mut()),
        Entry::Vacant(entry) => {
            let location = source_location(font, source_id)?;
            let resolved = projection_set
                .resolve_glyph(
                    &projection.glyph_id(),
                    location,
                    font.axes(),
                    font.sources(),
                )?
                .require(&projection.glyph_id())?;
            Ok(entry.insert(resolved))
        }
    }
}
