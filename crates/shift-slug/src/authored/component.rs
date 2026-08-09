use std::collections::{hash_map::Entry, HashMap};
use std::time::Instant;

use shift_font::{
    composite::ComponentAnchorReference, ComponentId, Font, GlyphId, GlyphLayer, GlyphProjection,
    GlyphProjectionSet, InterpolationBasis, ResolvedGlyph, SourceId,
};

use crate::variable::ROOT_COMPONENT;
use crate::{
    AuthoredAtlasProfile, Bounds, VariableAnchorSource, VariableAtlasBuilder, VariableComponent,
    VariableComponentPart, VariableComponentSource,
};

use super::{
    add_default_projection_glyph, authored_advance, curves_from_resolved_contours, source_location,
    AuthoredDefaultGlyphs, AuthoredDefaultKey, AuthoredGlyph, AuthoredGlyphCompilation,
    AuthoredSlugError, AuthoredSourceGlyph, ResolvedCurveTopology,
};

/// One deduplicated interpolation basis and its per-frame weight-buffer indexes.
#[derive(Clone, Debug, PartialEq)]
pub struct AuthoredWeightSet {
    basis: InterpolationBasis,
    source_weight_indices: Vec<u32>,
}

impl AuthoredWeightSet {
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
pub fn add_authored_glyph_with_weight_sets(
    builder: &mut VariableAtlasBuilder,
    font: &Font,
    projection: &GlyphProjection,
    weight_sets: &[AuthoredWeightSet],
    constant_weight_index: u32,
) -> Result<AuthoredGlyph, AuthoredSlugError> {
    let glyph_id = projection.glyph_id();
    let projection_set = font.glyph_projection_set(std::slice::from_ref(&glyph_id))?;
    let projection = projection_set
        .projection(&glyph_id)
        .ok_or_else(|| shift_font::CoreError::GlyphNotFound(glyph_id.clone()))?;
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
        let topology = ResolvedCurveTopology::from_contours(resolved.contours());
        let advance = authored_advance(resolved.x_advance(), 0)?;
        let glyph_index = builder.add_curve_glyph_with_sources_and_lines(
            topology.curves_from_contours(resolved.contours())?,
            topology.line_flags(),
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
) -> Result<u32, AuthoredSlugError> {
    let component_started = Instant::now();
    let mut direct_glyphs = HashMap::<GlyphId, u32>::new();
    for glyph_id in std::iter::once(projection.glyph_id()).chain(
        projection
            .components()
            .components()
            .iter()
            .map(|component| component.base_glyph_id()),
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
            u32::try_from(component_index).map_err(|_| crate::SlugError::LengthOverflow)?,
        );
    }

    let mut component_sources = Vec::new();
    let mut anchor_sources = Vec::new();
    let mut components = Vec::with_capacity(projection.components().components().len());
    for (component_index, occurrence) in projection.components().components().iter().enumerate() {
        let parent_projection =
            projection_for(compilation.projection_set, &occurrence.parent_glyph_id())?;
        let source_start =
            u32::try_from(component_sources.len()).map_err(|_| crate::SlugError::LengthOverflow)?;
        let source_context = AuthoredComponentSourceContext {
            weight_sets: compilation.weight_sets,
            constant_weight_index: compilation.constant_weight_index,
            component_index,
        };
        append_component_sources(
            &mut component_sources,
            parent_projection,
            occurrence.component_id(),
            occurrence.base_glyph_id(),
            &source_context,
        )?;
        let source_count = u32::try_from(component_sources.len())
            .map_err(|_| crate::SlugError::LengthOverflow)?
            .checked_sub(source_start)
            .ok_or(crate::SlugError::LengthOverflow)?;

        let parent_component =
            component_index_for_path(&component_indexes, occurrence.parent_path().as_slice())?;
        let mut component = VariableComponent {
            parent_component,
            source_start,
            source_count,
            source_anchor_start: 0,
            source_anchor_count: 0,
            target_anchor_start: 0,
            target_anchor_count: 0,
            target_component: ROOT_COMPONENT,
        };
        if let Some(attachment) = occurrence.attachment() {
            let source_range = append_anchor_sources(
                &mut anchor_sources,
                projection_for(compilation.projection_set, &attachment.source().glyph_id())?,
                attachment.source(),
                &source_context,
                "source anchor",
            )?;
            let target_range = append_anchor_sources(
                &mut anchor_sources,
                projection_for(compilation.projection_set, &attachment.target().glyph_id())?,
                attachment.target(),
                &source_context,
                "target anchor",
            )?;
            component.source_anchor_start = source_range.0;
            component.source_anchor_count = source_range.1;
            component.target_anchor_start = target_range.0;
            component.target_anchor_count = target_range.1;
            component.target_component = component_index_for_path(
                &component_indexes,
                attachment.target().component_path().as_slice(),
            )?;
            if component.target_component == ROOT_COMPONENT {
                return Err(crate::SlugError::LengthOverflow.into());
            }
        }
        components.push(component);
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
            u32::try_from(component_index).map_err(|_| crate::SlugError::LengthOverflow)?,
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
            anchor_sources,
        )
        .map_err(Into::into)
}

fn projection_for<'a>(
    projection_set: &'a GlyphProjectionSet,
    glyph_id: &GlyphId,
) -> Result<&'a GlyphProjection, AuthoredSlugError> {
    projection_set
        .projection(glyph_id)
        .ok_or_else(|| shift_font::CoreError::GlyphNotFound(glyph_id.clone()).into())
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
        let mut layers = Vec::with_capacity(interpolation.sources().len());
        for (source, weight_index) in interpolation.sources().iter().zip(weight_indices) {
            let mut layer = interpolation.reference_layer().clone();
            layer.apply_interpolation_values(source.values())?;
            layers.push((*weight_index, layer));
        }
        Ok(layers)
    }
}

fn append_component_sources(
    output: &mut Vec<VariableComponentSource>,
    parent_projection: &GlyphProjection,
    component_id: ComponentId,
    base_glyph_id: GlyphId,
    context: &AuthoredComponentSourceContext<'_>,
) -> Result<(), AuthoredSlugError> {
    for (source_index, (weight_index, layer)) in context
        .weighted_layers(parent_projection)?
        .into_iter()
        .enumerate()
    {
        let component = layer
            .components_iter()
            .find(|component| component.id() == component_id)
            .filter(|component| component.base_glyph_id() == base_glyph_id)
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
            .any(|value| !value.is_finite() || !(*value as f32).is_finite())
        {
            return Err(AuthoredSlugError::NonFiniteComponentValue {
                component_index: context.component_index,
                source_index,
                kind: "transform",
            });
        }
        output.push(VariableComponentSource {
            weight_index,
            translate_x: values[0] as f32,
            translate_y: values[1] as f32,
            rotation: values[2] as f32,
            scale_x: values[3] as f32,
            scale_y: values[4] as f32,
            skew_x: values[5] as f32,
            skew_y: values[6] as f32,
            center_x: values[7] as f32,
            center_y: values[8] as f32,
        });
    }
    Ok(())
}

fn append_anchor_sources(
    output: &mut Vec<VariableAnchorSource>,
    projection: &GlyphProjection,
    reference: &ComponentAnchorReference,
    context: &AuthoredComponentSourceContext<'_>,
    kind: &'static str,
) -> Result<(u32, u32), AuthoredSlugError> {
    let start = u32::try_from(output.len()).map_err(|_| crate::SlugError::LengthOverflow)?;
    for (source_index, (weight_index, layer)) in
        context.weighted_layers(projection)?.into_iter().enumerate()
    {
        let anchor = layer
            .anchors_iter()
            .find(|anchor| anchor.id() == reference.anchor_id())
            .ok_or_else(|| shift_font::CoreError::AnchorNotFound(reference.anchor_id()))?;
        let x = anchor.x() as f32;
        let y = anchor.y() as f32;
        if !anchor.x().is_finite() || !anchor.y().is_finite() || !x.is_finite() || !y.is_finite() {
            return Err(AuthoredSlugError::NonFiniteComponentValue {
                component_index: context.component_index,
                source_index,
                kind,
            });
        }
        output.push(VariableAnchorSource { weight_index, x, y });
    }
    let count = u32::try_from(output.len())
        .map_err(|_| crate::SlugError::LengthOverflow)?
        .checked_sub(start)
        .ok_or(crate::SlugError::LengthOverflow)?;
    Ok((start, count))
}

fn component_index_for_path(
    indexes: &HashMap<Vec<ComponentId>, u32>,
    path: &[ComponentId],
) -> Result<u32, AuthoredSlugError> {
    if path.is_empty() {
        return Ok(ROOT_COMPONENT);
    }
    indexes
        .get(path)
        .copied()
        .ok_or_else(|| crate::SlugError::LengthOverflow.into())
}

fn append_part(
    builder: &VariableAtlasBuilder,
    parts: &mut Vec<VariableComponentPart>,
    glyph_index: u32,
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
        .ok_or(crate::SlugError::LengthOverflow)?;
    Ok(())
}

fn fallback_bounds(
    font: &Font,
    projection_set: &GlyphProjectionSet,
    projection: &GlyphProjection,
    resolved_sources: &mut HashMap<SourceId, ResolvedGlyph>,
) -> Result<Bounds, AuthoredSlugError> {
    let fallback_source_id = font
        .glyph(projection.glyph_id())
        .and_then(|glyph| {
            glyph
                .default_sources()
                .values()
                .find(|source| source.layer_id() == projection.fallback().id())
        })
        .and_then(|source| source.base_source_id())
        .ok_or(AuthoredSlugError::MissingInterpolationSources)?;
    let resolved = resolved_source_glyph(
        resolved_sources,
        font,
        projection_set,
        projection,
        &fallback_source_id,
    )?;
    let curves = curves_from_resolved_contours(resolved.contours())?;
    let mut curves = curves.into_iter();
    let Some(first) = curves.next() else {
        return Ok(Bounds::default());
    };
    let mut bounds = first.bounds();
    for curve in curves {
        let curve_bounds = curve.bounds();
        bounds.min_x = bounds.min_x.min(curve_bounds.min_x);
        bounds.min_y = bounds.min_y.min(curve_bounds.min_y);
        bounds.max_x = bounds.max_x.max(curve_bounds.max_x);
        bounds.max_y = bounds.max_y.max(curve_bounds.max_y);
    }
    Ok(bounds)
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
                .ok_or_else(|| shift_font::CoreError::GlyphNotFound(projection.glyph_id()))?;
            Ok(entry.insert(resolved))
        }
    }
}
