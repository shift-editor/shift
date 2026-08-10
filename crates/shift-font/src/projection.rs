//! Location-independent glyph backing and location-bound read-only resolution.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use crate::composite::{resolved_contours_from_layers, GlyphComponents, ResolvedContour};
use crate::{
    Axis, AxisInheritance, Component, Condition, CoreError, CoreResult, DesignLocation, Font,
    Glyph, GlyphId, GlyphInterpolation, GlyphInterpolationValues, GlyphLayer, GlyphSource,
    InterpolationBasis, Source, SourceId,
};

/// One exact-source shape that cannot be represented by compatible variation.
///
/// This shape is selected only when a projection lands exactly on its authored
/// source. Between sources, interpolation continues to use the compatible
/// interpolation basis or the projection fallback.
#[derive(Clone, Debug, PartialEq)]
pub struct GlyphSourceShape {
    source_id: SourceId,
    layer: Arc<GlyphLayer>,
}

impl GlyphSourceShape {
    /// Returns the exact authored source that selects this shape.
    pub fn source_id(&self) -> SourceId {
        self.source_id.clone()
    }

    /// Returns the owned shape retained for that exact source.
    pub fn layer(&self) -> &GlyphLayer {
        &self.layer
    }
}

/// Compact, location-independent projection for one glyph.
///
/// The projection contains a structural fallback, optional compatible interpolation,
/// and exact-source exceptions for authored topology the variation cannot
/// reproduce. It shares immutable authored layers, owns derived interpolation
/// values, and never mutates the font.
#[derive(Clone, Debug, PartialEq)]
pub struct GlyphProjection {
    glyph_id: GlyphId,
    layers: Arc<GlyphLayerProjection>,
    components: GlyphComponents,
    exact_source_components: Vec<GlyphSourceComponents>,
    component_glyph_ids: Vec<GlyphId>,
}

/// Immutable projections prepared for requested roots and their component closure.
///
/// The set owns derived interpolation values but shares authored layers. It is
/// valid only for the font revision from which it was built; callers should
/// discard it after their read or compilation instead of retaining it across edits.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct GlyphProjectionSet {
    projections: HashMap<GlyphId, Option<GlyphProjection>>,
    interpolation_basis_count: usize,
}

#[derive(Clone, Debug, PartialEq)]
struct GlyphLayerProjection {
    fallback_source_id: SourceId,
    fallback: Arc<GlyphLayer>,
    interpolation: Option<GlyphInterpolation>,
    exact_source_shapes: Vec<GlyphSourceShape>,
}

impl GlyphLayerProjection {
    fn resolve(
        &self,
        location: &DesignLocation,
        axes: &[Axis],
        sources: &[Source],
    ) -> CoreResult<GlyphLayer> {
        let exact_source_id = exact_source_id(location, axes, sources);
        if let Some(source_id) = exact_source_id {
            if source_id == self.fallback_source_id {
                return Ok(self.fallback.as_ref().clone());
            }

            if let Some(source_shape) = self
                .exact_source_shapes
                .iter()
                .find(|source_shape| source_shape.source_id == source_id)
            {
                return Ok(source_shape.layer.as_ref().clone());
            }
        }

        let Some(interpolation) = &self.interpolation else {
            return Ok(self.fallback.as_ref().clone());
        };

        interpolation.resolve(location, axes)
    }
}

/// Exact-source component relationships that differ from the default shape.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GlyphSourceComponents {
    source_id: SourceId,
    components: GlyphComponents,
}

impl GlyphSourceComponents {
    /// Returns the exact authored source that selects these relationships.
    pub fn source_id(&self) -> SourceId {
        self.source_id.clone()
    }

    /// Returns the component relationships selected at this source location.
    pub fn components(&self) -> &GlyphComponents {
        &self.components
    }
}

impl GlyphProjection {
    /// Returns the projected glyph's stable identity.
    pub fn glyph_id(&self) -> GlyphId {
        self.glyph_id.clone()
    }

    /// Returns the preferred structural and numeric fallback shape.
    pub fn fallback(&self) -> &GlyphLayer {
        &self.layers.fallback
    }

    /// Returns compatible source interpolation when a viable basis exists.
    pub fn interpolation(&self) -> Option<&GlyphInterpolation> {
        self.layers.interpolation.as_ref()
    }

    /// Returns exact-source shapes excluded from compatible interpolation.
    pub fn exact_source_shapes(&self) -> &[GlyphSourceShape] {
        &self.layers.exact_source_shapes
    }

    /// Returns component relationships for interpolated and fallback shapes.
    pub fn components(&self) -> &GlyphComponents {
        &self.components
    }

    /// Returns exact-source relationship exceptions in font source order.
    pub fn exact_source_components(&self) -> &[GlyphSourceComponents] {
        &self.exact_source_components
    }

    /// Returns every component glyph needed by any shape in this projection.
    pub fn component_glyph_ids(&self) -> &[GlyphId] {
        &self.component_glyph_ids
    }

    /// Resolves a derived layer at one internal authoring location.
    ///
    /// Exact incompatible source shapes win. Otherwise compatible variation
    /// is evaluated, falling back to the projection shape when no viable interpolation
    /// exists. Missing axis coordinates use authoring defaults.
    ///
    /// # Errors
    ///
    /// Returns an interpolation error when the projection and its structural
    /// reference layer disagree, or when an interpolation support axis is absent.
    pub fn resolve(
        &self,
        location: &DesignLocation,
        axes: &[Axis],
        sources: &[Source],
    ) -> CoreResult<GlyphLayer> {
        self.layers.resolve(location, axes, sources)
    }
}

/// Read-only font projection fixed to one internal authoring location.
///
/// The projection snapshots its location and memoizes derived layers for its
/// own lifetime. It does not mutate authored font data or retain renderer,
/// persistence, or compiler state.
pub struct FontProjection<'a> {
    font: &'a Font,
    location: DesignLocation,
    layers: HashMap<GlyphId, GlyphLayer>,
    interpolation_bases: HashMap<Vec<SourceId>, Arc<InterpolationBasis>>,
}

/// Fully resolved glyph geometry at one internal authoring location.
///
/// Components are flattened into `contours`. An existing blank glyph has an
/// empty contour collection and remains distinguishable from a missing glyph,
/// which resolves to `None`.
#[derive(Clone, Debug)]
pub struct ResolvedGlyph {
    glyph_id: GlyphId,
    contours: Vec<ResolvedContour>,
    x_advance: f64,
}

impl ResolvedGlyph {
    /// Returns the stable identity of the resolved glyph.
    pub fn glyph_id(&self) -> GlyphId {
        self.glyph_id.clone()
    }

    /// Returns flattened contours with component transforms applied.
    pub fn contours(&self) -> &[ResolvedContour] {
        &self.contours
    }

    /// Returns the resolved horizontal advance in font units.
    pub fn x_advance(&self) -> f64 {
        self.x_advance
    }
}

impl Font {
    fn glyph_layer_projection_with_bases(
        &self,
        glyph_id: &GlyphId,
        interpolation_bases: &mut HashMap<Vec<SourceId>, Arc<InterpolationBasis>>,
    ) -> CoreResult<Option<Arc<GlyphLayerProjection>>> {
        let Some(glyph) = self.glyph(glyph_id.clone()) else {
            return Ok(None);
        };
        let interpolation = self.glyph_interpolation_with_bases(glyph_id, interpolation_bases)?;
        let fallback = interpolation
            .as_ref()
            .and_then(|interpolation| {
                let layer = glyph.layers().get(&interpolation.reference_layer().id())?;
                let source_id = source_id_for_layer(self, glyph, layer.id())?;
                Some((source_id, layer.clone()))
            })
            .or_else(|| fallback_layer(self, glyph));
        let Some((fallback_source_id, fallback)) = fallback else {
            return Ok(None);
        };
        let exact_source_shapes = self
            .sources()
            .iter()
            .filter(|source| source.is_master())
            .filter_map(|source| {
                let layer = glyph
                    .layer_for_source(source.id())
                    .and_then(|layer| glyph.layers().get(&layer.id()))?
                    .clone();
                if layer.id() == fallback.id() {
                    return None;
                }

                let represented_by_interpolation =
                    interpolation.as_ref().is_some_and(|interpolation| {
                        interpolation.basis().source_ids().contains(&source.id())
                    });
                if represented_by_interpolation {
                    return None;
                }

                Some(GlyphSourceShape {
                    source_id: source.id(),
                    layer,
                })
            })
            .collect();

        Ok(Some(Arc::new(GlyphLayerProjection {
            fallback_source_id,
            fallback,
            interpolation,
            exact_source_shapes,
        })))
    }

    fn resolved_layer_at_with_bases(
        &self,
        glyph_id: &GlyphId,
        location: &DesignLocation,
        interpolation_bases: &mut HashMap<Vec<SourceId>, Arc<InterpolationBasis>>,
    ) -> CoreResult<Option<GlyphLayer>> {
        let Some(projection) =
            self.glyph_layer_projection_with_bases(glyph_id, interpolation_bases)?
        else {
            return Ok(None);
        };

        projection
            .resolve(location, self.axes(), self.sources())
            .map(Some)
    }

    fn collect_glyph_layer_projections(
        &self,
        glyph_ids: &[GlyphId],
        projections: &mut HashMap<GlyphId, Option<Arc<GlyphLayerProjection>>>,
        projection_order: &mut Vec<GlyphId>,
        interpolation_bases: &mut HashMap<Vec<SourceId>, Arc<InterpolationBasis>>,
    ) -> CoreResult<()> {
        let mut pending = glyph_ids.iter().rev().cloned().collect::<Vec<_>>();

        while let Some(glyph_id) = pending.pop() {
            if projections.contains_key(&glyph_id) {
                continue;
            }

            let projection =
                self.glyph_layer_projection_with_bases(&glyph_id, interpolation_bases)?;
            let component_glyph_ids = projection
                .as_ref()
                .map(|projection| component_base_glyph_ids(projection).collect::<Vec<_>>())
                .unwrap_or_default();
            projections.insert(glyph_id.clone(), projection);
            projection_order.push(glyph_id);
            pending.extend(component_glyph_ids.into_iter().rev());
        }

        Ok(())
    }

    /// Component relationships for the root's shape selected at one master.
    ///
    /// Every glyph contributes the layer `resolve` would select structurally at
    /// that master: its exact-source shape when one exists, else its fallback —
    /// never a compatible authored layer, whose per-layer component identities
    /// interpolation does not carry. No geometry is evaluated.
    fn structural_components(
        &self,
        root_glyph_id: &GlyphId,
        root_projection: &GlyphLayerProjection,
        projections: &HashMap<GlyphId, Option<Arc<GlyphLayerProjection>>>,
        source_id: &SourceId,
    ) -> CoreResult<GlyphComponents> {
        let root_layer = structural_layer(root_projection, source_id);
        let mut layers = HashMap::from([(root_glyph_id.clone(), root_layer)]);
        let mut pending: Vec<GlyphId> = vec![root_glyph_id.clone()];

        while let Some(parent_glyph_id) = pending.pop() {
            let components = layers
                .get(&parent_glyph_id)
                .expect("parent layer was inserted before traversing its components")
                .components_iter()
                .map(|component| (component.id(), component.base_glyph_id()))
                .collect::<Vec<_>>();

            for (component_id, base_glyph_id) in components {
                if layers.contains_key(&base_glyph_id) {
                    continue;
                }

                let Some(Some(projection)) = projections.get(&base_glyph_id) else {
                    return Err(CoreError::UnresolvableComponentGlyph {
                        component_id,
                        base_glyph_id,
                    });
                };
                layers.insert(
                    base_glyph_id.clone(),
                    structural_layer(projection, source_id),
                );
                pending.push(base_glyph_id);
            }
        }

        GlyphComponents::from_layers(root_glyph_id, &layers)
    }

    fn glyph_projection_from_layers(
        &self,
        glyph_id: &GlyphId,
        layers: Arc<GlyphLayerProjection>,
        projections: &HashMap<GlyphId, Option<Arc<GlyphLayerProjection>>>,
    ) -> CoreResult<GlyphProjection> {
        let fallback_source_id = layers.fallback_source_id.clone();
        let components =
            self.structural_components(glyph_id, &layers, projections, &fallback_source_id)?;

        let mut exact_source_components = Vec::new();
        for source in self.sources().iter().filter(|source| source.is_master()) {
            let source_id = source.id();
            let source_components =
                self.structural_components(glyph_id, &layers, projections, &source_id)?;
            if source_components != components {
                exact_source_components.push(GlyphSourceComponents {
                    source_id,
                    components: source_components,
                });
            }
        }

        let mut component_glyph_ids = components
            .components()
            .iter()
            .chain(
                exact_source_components
                    .iter()
                    .flat_map(|source| source.components.components()),
            )
            .map(|component| component.base_glyph_id())
            .collect::<Vec<_>>();
        component_glyph_ids.sort();
        component_glyph_ids.dedup();

        Ok(GlyphProjection {
            glyph_id: glyph_id.clone(),
            layers,
            components,
            exact_source_components,
            component_glyph_ids,
        })
    }

    /// Prepares each requested glyph projection and its transitive component closure once.
    ///
    /// Interpolation bases are shared when the ordered compatible source identities match.
    /// The result owns no mutable font state and must be discarded after the current read or
    /// compilation so projections cannot outlive authored edits.
    pub fn glyph_projection_set(&self, glyph_ids: &[GlyphId]) -> CoreResult<GlyphProjectionSet> {
        for glyph_id in glyph_ids {
            if self.glyph(glyph_id.clone()).is_none() {
                return Err(CoreError::GlyphNotFound(glyph_id.clone()));
            }
        }

        let mut layer_projections = HashMap::new();
        let mut projection_order = Vec::new();
        let mut interpolation_bases = HashMap::new();
        self.collect_glyph_layer_projections(
            glyph_ids,
            &mut layer_projections,
            &mut projection_order,
            &mut interpolation_bases,
        )?;

        let mut projections = HashMap::with_capacity(layer_projections.len());
        for glyph_id in projection_order {
            let projection = layer_projections
                .get(&glyph_id)
                .cloned()
                .flatten()
                .map(|layers| {
                    self.glyph_projection_from_layers(&glyph_id, layers, &layer_projections)
                })
                .transpose()?;
            projections.insert(glyph_id, projection);
        }

        Ok(GlyphProjectionSet {
            projections,
            interpolation_basis_count: interpolation_bases.len(),
        })
    }

    /// Builds a compact, location-independent projection for one glyph.
    ///
    /// Compatible master layers become one interpolation. Exact authored
    /// layers with incompatible topology are retained as exact source shapes so
    /// their shapes remain visible at their own source locations. A static or
    /// otherwise nonviable glyph retains its non-fallback source layers as
    /// exact-source shapes.
    ///
    /// # Errors
    ///
    /// Returns [`crate::CoreError::GlyphNotFound`] when `glyph_id` is absent,
    /// [`crate::CoreError::UnresolvableComponentGlyph`] when a component
    /// references a glyph without a master-backed projection, or an
    /// interpolation construction error from the glyph's variation data.
    pub fn glyph_projection(&self, glyph_id: &GlyphId) -> CoreResult<Option<GlyphProjection>> {
        let mut projections = self.glyph_projection_set(std::slice::from_ref(glyph_id))?;
        Ok(projections.projections.remove(glyph_id).flatten())
    }

    /// Creates a read-only projection at an internal authoring location.
    ///
    /// Missing axis coordinates use axis defaults. External axis mappings must
    /// be evaluated before constructing the projection.
    pub fn projection(&self, location: &DesignLocation) -> FontProjection<'_> {
        FontProjection {
            font: self,
            location: location.clone(),
            layers: HashMap::new(),
            interpolation_bases: HashMap::new(),
        }
    }
}

impl GlyphProjectionSet {
    /// Returns the prepared projection for a glyph, or `None` for a layerless glyph.
    pub fn projection(&self, glyph_id: &GlyphId) -> Option<&GlyphProjection> {
        self.projections.get(glyph_id).and_then(Option::as_ref)
    }

    /// Number of requested and transitively referenced glyph identities represented.
    pub fn glyph_count(&self) -> usize {
        self.projections.len()
    }

    /// Number of distinct compatible source-location sets built for these glyphs.
    pub fn interpolation_basis_count(&self) -> usize {
        self.interpolation_basis_count
    }

    /// Resolves one prepared glyph without rebuilding its projection or component closure.
    pub fn resolve_glyph(
        &self,
        glyph_id: &GlyphId,
        location: &DesignLocation,
        axes: &[Axis],
        sources: &[Source],
    ) -> CoreResult<Option<ResolvedGlyph>> {
        let mut layers = HashMap::new();
        if !self.prepare_layer_tree(glyph_id, location, axes, sources, &mut layers)? {
            return Ok(None);
        }
        let layer = layers
            .get(glyph_id)
            .expect("prepared glyph layers contain the requested root");

        Ok(Some(ResolvedGlyph {
            glyph_id: glyph_id.clone(),
            contours: resolved_contours_from_layers(glyph_id, &layers)?,
            x_advance: layer.width(),
        }))
    }

    fn prepare_layer_tree(
        &self,
        glyph_id: &GlyphId,
        location: &DesignLocation,
        axes: &[Axis],
        sources: &[Source],
        layers: &mut HashMap<GlyphId, GlyphLayer>,
    ) -> CoreResult<bool> {
        if layers.contains_key(glyph_id) {
            return Ok(true);
        }

        let projection = self
            .projections
            .get(glyph_id)
            .ok_or_else(|| CoreError::GlyphNotFound(glyph_id.clone()))?;
        let Some(projection) = projection else {
            return Ok(false);
        };
        let layer = projection.resolve(location, axes, sources)?;
        let components = layer
            .components_iter()
            .map(|component| (component.id(), component.base_glyph_id()))
            .collect::<Vec<_>>();
        layers.insert(glyph_id.clone(), layer);

        for (component_id, base_glyph_id) in components {
            if self.prepare_layer_tree(&base_glyph_id, location, axes, sources, layers)? {
                continue;
            }

            return Err(CoreError::UnresolvableComponentGlyph {
                component_id,
                base_glyph_id,
            });
        }

        Ok(true)
    }
}

fn glyph_requires_advanced_resolution(
    font: &Font,
    glyph_id: &GlyphId,
    visited: &mut HashSet<GlyphId>,
) -> bool {
    if !visited.insert(glyph_id.clone()) {
        return false;
    }
    let Some(glyph) = font.glyph(glyph_id.clone()) else {
        return false;
    };
    if !glyph.axes().is_empty()
        || !glyph.variants().is_empty()
        || glyph
            .default_sources()
            .values()
            .any(|source| source.base_source_id().is_none() || !source.location().is_empty())
        || glyph.layers().values().any(|layer| {
            layer.components_iter().any(|component| {
                !component.location().is_empty()
                    || component.axis_inheritance() != AxisInheritance::Parent
                    || component.condition().is_some()
            })
        })
    {
        return true;
    }
    glyph
        .layers()
        .values()
        .flat_map(|layer| layer.components_iter())
        .any(|component| {
            glyph_requires_advanced_resolution(font, &component.base_glyph_id(), visited)
        })
}

fn resolved_occurrence_layers(
    font: &Font,
    glyph_id: &GlyphId,
    location: &DesignLocation,
) -> CoreResult<Option<(GlyphLayer, HashMap<GlyphId, GlyphLayer>)>> {
    let root_font_location = complete_root_font_location(font, location);
    let mut layers = HashMap::new();
    let Some(layer) = append_resolved_occurrence(
        font,
        glyph_id,
        glyph_id.clone(),
        location,
        &root_font_location,
        &mut layers,
        &mut HashSet::new(),
    )?
    else {
        return Ok(None);
    };
    Ok(Some((layer, layers)))
}

fn append_resolved_occurrence(
    font: &Font,
    authored_glyph_id: &GlyphId,
    output_glyph_id: GlyphId,
    location: &DesignLocation,
    root_font_location: &DesignLocation,
    layers: &mut HashMap<GlyphId, GlyphLayer>,
    visiting: &mut HashSet<GlyphId>,
) -> CoreResult<Option<GlyphLayer>> {
    if !visiting.insert(authored_glyph_id.clone()) {
        return Ok(None);
    }
    let Some(mut layer) =
        resolved_glyph_source_layer(font, authored_glyph_id, location, root_font_location)?
    else {
        visiting.remove(authored_glyph_id);
        return Ok(None);
    };
    let components = layer.components_iter().cloned().collect::<Vec<_>>();
    for component in components {
        if component
            .condition()
            .is_some_and(|condition| !condition_matches(condition, font, root_font_location))
        {
            layer.remove_component(component.id());
            continue;
        }

        let mut child_location = match component.axis_inheritance() {
            AxisInheritance::Parent => location.clone(),
            AxisInheritance::Font => root_font_location.clone(),
        };
        for (axis_id, value) in component.location().iter() {
            child_location.set(axis_id.clone(), *value);
        }
        let child_output_id = (0_u32..)
            .map(|suffix| {
                GlyphId::from_raw(format!(
                    "resolved-component-{}-{suffix}",
                    component.id().as_str()
                ))
            })
            .find(|candidate| {
                font.glyph(candidate.clone()).is_none() && !layers.contains_key(candidate)
            })
            .expect("component occurrence identity space is not exhausted");
        let base_glyph_id = component.base_glyph_id();
        if append_resolved_occurrence(
            font,
            &base_glyph_id,
            child_output_id.clone(),
            &child_location,
            root_font_location,
            layers,
            visiting,
        )?
        .is_none()
        {
            visiting.remove(authored_glyph_id);
            return Err(CoreError::UnresolvableComponentGlyph {
                component_id: component.id(),
                base_glyph_id,
            });
        }

        let mut replacement = Component::with_id(
            component.id(),
            child_output_id,
            component.base_glyph_name().clone(),
            *component.transform(),
        );
        replacement.set_location(component.location().clone());
        replacement.set_axis_inheritance(component.axis_inheritance());
        replacement.set_condition(component.condition().cloned());
        layer.add_component(replacement);
    }
    visiting.remove(authored_glyph_id);
    layers.insert(output_glyph_id, layer.clone());
    Ok(Some(layer))
}

fn resolved_glyph_source_layer(
    font: &Font,
    glyph_id: &GlyphId,
    location: &DesignLocation,
    root_font_location: &DesignLocation,
) -> CoreResult<Option<GlyphLayer>> {
    let Some(glyph) = font.glyph(glyph_id.clone()) else {
        return Ok(None);
    };
    let selected_variant = glyph
        .variants()
        .values()
        .find(|variant| condition_matches(variant.condition(), font, root_font_location));
    let sources = selected_variant
        .map(|variant| variant.sources().values().collect::<Vec<_>>())
        .unwrap_or_else(|| glyph.default_sources().values().collect());
    if sources.is_empty() {
        if selected_variant.is_some() {
            return Ok(None);
        }
        return Ok(glyph
            .layers()
            .values()
            .max_by_key(|layer| layer.contours().len() + layer.components().len())
            .map(|layer| layer.as_ref().clone()));
    }

    let is_interpolating_source = |source: &GlyphSource| {
        source.base_source_id().is_none_or(|source_id| {
            font.sources()
                .iter()
                .find(|global| global.id() == source_id)
                .is_none_or(Source::is_master)
        })
    };
    let axes = glyph_interpolation_axes(font, glyph);
    let located_sources = sources
        .iter()
        .filter(|source| is_interpolating_source(source))
        .filter_map(|source| {
            let layer = glyph.layer(source.layer_id())?;
            Some((
                *source,
                effective_glyph_source_location(font, source),
                layer,
            ))
        })
        .collect::<Vec<_>>();
    if let Some((_, _, layer)) = located_sources
        .iter()
        .find(|(_, source_location, _)| locations_match(source_location, location, &axes))
    {
        return Ok(Some((*layer).clone()));
    }

    let mut candidates = located_sources;
    if candidates.is_empty() {
        return Ok(None);
    }
    let reference = candidates[0].2;
    candidates.retain(|(_, _, layer)| {
        reference
            .interpolation_compatibility_with(layer)
            .is_compatible()
    });
    if candidates.len() == 1 {
        return Ok(Some(candidates[0].2.clone()));
    }

    let source_locations = candidates
        .iter()
        .map(|(_, source_location, _)| source_location.clone())
        .collect::<Vec<_>>();
    let Some(weights) =
        crate::interpolation::interpolation_weights(&source_locations, location, &axes)?
    else {
        return Ok(Some(reference.clone()));
    };
    let source_values = candidates
        .iter()
        .map(|(_, _, layer)| layer.interpolation_values())
        .collect::<Vec<_>>();
    let value_count = source_values[0].as_slice().len();
    let mut values = vec![0.0; value_count];
    for (weight, source) in weights.into_iter().zip(&source_values) {
        if source.as_slice().len() != value_count {
            return Ok(Some(reference.clone()));
        }
        for (value, source_value) in values.iter_mut().zip(source.as_slice()) {
            *value += weight * source_value;
        }
    }
    let mut resolved = reference.clone();
    resolved.apply_interpolation_values(&GlyphInterpolationValues::new(values))?;
    Ok(Some(resolved))
}

fn effective_glyph_source_location(font: &Font, source: &GlyphSource) -> DesignLocation {
    let mut location = source
        .base_source_id()
        .and_then(|source_id| {
            font.sources()
                .iter()
                .find(|global| global.id() == source_id)
                .map(|global| global.location().clone())
        })
        .unwrap_or_default();
    for (axis_id, value) in source.location().iter() {
        location.set(axis_id.clone(), *value);
    }
    location
}

fn glyph_interpolation_axes(font: &Font, glyph: &Glyph) -> Vec<Axis> {
    let mut axes = font.axes().to_vec();
    let mut used_tags = axes
        .iter()
        .map(|axis| axis.tag().to_string())
        .collect::<HashSet<_>>();
    let mut tag_index = 0_u32;
    for local in glyph.axes().values() {
        let tag = loop {
            let candidate = format!("L{tag_index:03X}");
            tag_index += 1;
            if used_tags.insert(candidate.clone()) {
                break candidate;
            }
        };
        axes.push(Axis::continuous_with_id(
            local.id(),
            tag,
            local.name().to_string(),
            local.minimum(),
            local.default(),
            local.maximum(),
        ));
    }
    axes
}

fn locations_match(left: &DesignLocation, right: &DesignLocation, axes: &[Axis]) -> bool {
    axes.iter().all(|axis| {
        let left = left.get(&axis.id()).unwrap_or(axis.default());
        let right = right.get(&axis.id()).unwrap_or(axis.default());
        (left - right).abs() <= 1e-9
    })
}

fn complete_root_font_location(font: &Font, location: &DesignLocation) -> DesignLocation {
    let mut complete = DesignLocation::new();
    for axis in font.axes() {
        complete.set(
            axis.id(),
            location.get(&axis.id()).unwrap_or(axis.default()),
        );
    }
    complete
}

fn condition_matches(condition: &Condition, font: &Font, location: &DesignLocation) -> bool {
    match condition {
        Condition::AxisRange {
            axis_id,
            minimum,
            maximum,
        } => {
            let value = location.get(axis_id).or_else(|| {
                font.axes()
                    .iter()
                    .find(|axis| axis.id() == *axis_id)
                    .map(Axis::default)
            });
            value.is_some_and(|value| {
                minimum.is_none_or(|minimum| value >= minimum)
                    && maximum.is_none_or(|maximum| value <= maximum)
            })
        }
        Condition::And { conditions } => conditions
            .iter()
            .all(|condition| condition_matches(condition, font, location)),
        Condition::Or { conditions } => conditions
            .iter()
            .any(|condition| condition_matches(condition, font, location)),
        Condition::Not { condition } => !condition_matches(condition, font, location),
    }
}

impl FontProjection<'_> {
    /// Returns the internal authoring location fixed for this projection.
    pub fn location(&self) -> &DesignLocation {
        &self.location
    }

    /// Resolves one glyph without exposing editable layer identities.
    ///
    /// Exact authored layers win, followed by compatible interpolation and the
    /// preferred fallback. Components resolve recursively at this
    /// projection's location and cyclic branches are skipped locally.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::UnresolvableComponentGlyph`] when a component
    /// reference has no master-backed projection, or an interpolation error
    /// when derived values do not match their compatible structural reference layer.
    pub fn glyph(&mut self, glyph_id: &GlyphId) -> CoreResult<Option<ResolvedGlyph>> {
        if glyph_requires_advanced_resolution(self.font, glyph_id, &mut HashSet::new()) {
            let Some((layer, layers)) =
                resolved_occurrence_layers(self.font, glyph_id, &self.location)?
            else {
                return Ok(None);
            };
            return Ok(Some(ResolvedGlyph {
                glyph_id: glyph_id.clone(),
                contours: resolved_contours_from_layers(glyph_id, &layers)?,
                x_advance: layer.width(),
            }));
        }
        if !self.prepare_layer_tree(glyph_id)? {
            return Ok(None);
        }
        let layer = self
            .layers
            .get(glyph_id)
            .expect("prepared glyph layers contain the requested root");

        Ok(Some(ResolvedGlyph {
            glyph_id: glyph_id.clone(),
            contours: resolved_contours_from_layers(glyph_id, &self.layers)?,
            x_advance: layer.width(),
        }))
    }

    /// Resolves existing glyphs in request order with shared component work.
    ///
    /// Missing glyph IDs are omitted. Duplicate existing IDs produce duplicate
    /// ordered results while reusing this projection's resolved layers.
    ///
    /// # Errors
    ///
    /// Returns the first interpolation error encountered while resolving a
    /// requested glyph or one of its component branches.
    pub fn glyphs(&mut self, glyph_ids: &[GlyphId]) -> CoreResult<Vec<ResolvedGlyph>> {
        let mut glyphs = Vec::new();
        for glyph_id in glyph_ids {
            if let Some(glyph) = self.glyph(glyph_id)? {
                glyphs.push(glyph);
            }
        }
        Ok(glyphs)
    }

    fn prepare_layer_tree(&mut self, glyph_id: &GlyphId) -> CoreResult<bool> {
        if self.layers.contains_key(glyph_id) {
            return Ok(true);
        }

        let Some(layer) = self.font.resolved_layer_at_with_bases(
            glyph_id,
            &self.location,
            &mut self.interpolation_bases,
        )?
        else {
            return Ok(false);
        };
        let components = layer
            .components_iter()
            .map(|component| (component.id(), component.base_glyph_id()))
            .collect::<Vec<_>>();
        self.layers.insert(glyph_id.clone(), layer);

        for (component_id, base_glyph_id) in components {
            if self.prepare_layer_tree(&base_glyph_id)? {
                continue;
            }

            return Err(CoreError::UnresolvableComponentGlyph {
                component_id,
                base_glyph_id,
            });
        }

        Ok(true)
    }
}

/// Layer whose structure `resolve` selects at one master: the exact-source
/// shape when the master has one, else the fallback/reference layer whose
/// component identities interpolation output carries.
fn structural_layer<'a>(
    projection: &'a GlyphLayerProjection,
    source_id: &SourceId,
) -> &'a GlyphLayer {
    projection
        .exact_source_shapes
        .iter()
        .find(|shape| shape.source_id == *source_id)
        .map(|shape| &shape.layer)
        .unwrap_or(&projection.fallback)
}

/// Component base ids across the fallback and every exact-source shape.
fn component_base_glyph_ids(
    projection: &GlyphLayerProjection,
) -> impl Iterator<Item = GlyphId> + '_ {
    std::iter::once(&projection.fallback)
        .chain(
            projection
                .exact_source_shapes
                .iter()
                .map(|shape| &shape.layer),
        )
        .flat_map(|layer| {
            layer
                .components_iter()
                .map(|component| component.base_glyph_id())
        })
}

fn fallback_layer(font: &Font, glyph: &Glyph) -> Option<(SourceId, Arc<GlyphLayer>)> {
    if let Some(default_source_id) = font.default_source_id() {
        let is_master = source_for_id(font, &default_source_id).is_some_and(Source::is_master);
        if is_master {
            if let Some(layer) = glyph.layer_for_source(default_source_id.clone()) {
                return glyph
                    .layers()
                    .get(&layer.id())
                    .cloned()
                    .map(|layer| (default_source_id, layer));
            }
        }
    }

    glyph
        .default_sources()
        .values()
        .filter_map(|glyph_source| {
            let source_id = glyph_source.base_source_id()?;
            if !source_for_id(font, &source_id).is_some_and(Source::is_master) {
                return None;
            }
            let layer = glyph.layers().get(&glyph_source.layer_id())?.clone();
            Some((source_id, layer))
        })
        .max_by_key(|(_, layer)| layer.contours().len() + layer.components().len())
}

fn source_id_for_layer(font: &Font, glyph: &Glyph, layer_id: crate::LayerId) -> Option<SourceId> {
    glyph
        .default_sources()
        .values()
        .find(|glyph_source| {
            glyph_source.layer_id() == layer_id
                && glyph_source.base_source_id().is_some_and(|source_id| {
                    source_for_id(font, &source_id).is_some_and(Source::is_master)
                })
        })
        .and_then(|glyph_source| glyph_source.base_source_id())
}

fn source_for_id<'a>(font: &'a Font, source_id: &SourceId) -> Option<&'a Source> {
    font.sources()
        .iter()
        .find(|source| source.id() == *source_id)
}

fn exact_source_id(
    location: &DesignLocation,
    axes: &[Axis],
    sources: &[Source],
) -> Option<SourceId> {
    sources
        .iter()
        .filter(|source| source.is_master())
        .find(|source| source.location().is_equivalent_to(location, axes))
        .map(|source| source.id())
}

#[cfg(test)]
mod tests {
    use crate::test_support::sample_variable_font;
    use crate::{
        Anchor, Axis, AxisId, AxisInheritance, Component, Condition, Contour, CoreError,
        DesignLocation, Font, Glyph, GlyphAxis, GlyphId, GlyphLayer, GlyphSource, GlyphVariant,
        LayerId, Location, PointType, Source, SourceId, Transform,
    };

    fn variable_font() -> (Font, AxisId, SourceId, SourceId, SourceId) {
        let mut font = Font::new();
        font.clear_sources();
        let axis = Axis::new(
            "wght".to_string(),
            "Weight".to_string(),
            100.0,
            400.0,
            900.0,
        );
        let axis_id = axis.id();
        font.add_axis(axis).unwrap();

        let light_id = font.add_source(Source::new("Light".to_string(), location(&axis_id, 100.0)));
        let regular_id = font.add_source(Source::new(
            "Regular".to_string(),
            location(&axis_id, 400.0),
        ));
        let bold_id = font.add_source(Source::new("Bold".to_string(), location(&axis_id, 900.0)));
        font.set_default_source_id(regular_id.clone());

        (font, axis_id, light_id, regular_id, bold_id)
    }

    fn location(axis_id: &AxisId, value: f64) -> DesignLocation {
        let mut location = DesignLocation::new();
        location.set(axis_id.clone(), value);
        location
    }

    fn line_layer(_source_id: SourceId, x: f64) -> GlyphLayer {
        let mut layer = GlyphLayer::with_width(LayerId::new(), 200.0);
        let mut contour = Contour::new();
        contour.add_point(x, 0.0, PointType::OnCurve, false);
        contour.add_point(x + 10.0, 0.0, PointType::OnCurve, false);
        layer.add_contour(contour);
        layer
    }

    fn set_test_layer(glyph: &mut Glyph, source_id: SourceId, layer: GlyphLayer) {
        let layer_id = layer.id();
        glyph.set_layer(layer);
        glyph.insert_default_source(GlyphSource::new(
            source_id.to_string(),
            layer_id,
            Some(source_id),
            Location::new(),
        ));
    }

    #[test]
    fn projection_set_reuses_shared_components_and_interpolation_bases() {
        let mut font = sample_variable_font();
        let child_id = font.glyph_by_name("A").unwrap().id();
        let source_id = font.default_source_id().unwrap();
        let root_ids = [
            GlyphId::from_raw("shared-root-a"),
            GlyphId::from_raw("shared-root-b"),
        ];

        for root_id in &root_ids {
            let mut root = Glyph::with_id(root_id.clone(), root_id.to_string());
            let mut layer = GlyphLayer::with_width(LayerId::new(), 700.0);
            layer.add_component(Component::new(child_id.clone(), "A"));
            set_test_layer(&mut root, source_id.clone(), layer);
            font.insert_glyph(root).unwrap();
        }

        let projection_set = font
            .glyph_projection_set(&[
                root_ids[0].clone(),
                root_ids[1].clone(),
                root_ids[0].clone(),
            ])
            .unwrap();

        let child_projection_set = font
            .glyph_projection_set(std::slice::from_ref(&child_id))
            .unwrap();
        assert_eq!(child_projection_set.interpolation_basis_count(), 1);
        assert_eq!(projection_set.glyph_count(), 3);
        assert_eq!(projection_set.interpolation_basis_count(), 2);
        assert!(std::ptr::eq(
            projection_set
                .projection(&root_ids[0])
                .unwrap()
                .interpolation()
                .unwrap()
                .basis(),
            projection_set
                .projection(&root_ids[1])
                .unwrap()
                .interpolation()
                .unwrap()
                .basis(),
        ));

        let mut location = DesignLocation::new();
        location.set(font.axes()[0].id(), 600.0);
        let expected = font
            .projection(&location)
            .glyph(&root_ids[0])
            .unwrap()
            .unwrap();
        let actual = projection_set
            .resolve_glyph(&root_ids[0], &location, font.axes(), font.sources())
            .unwrap()
            .unwrap();

        assert_eq!(actual.x_advance(), expected.x_advance());
        assert_eq!(actual.contours().len(), expected.contours().len());
        assert_eq!(
            actual.contours()[0].points[1].x(),
            expected.contours()[0].points[1].x()
        );
    }

    #[test]
    fn projection_interpolates_when_an_exact_source_has_no_glyph_layer() {
        let font = sample_variable_font();
        let glyph_id = font.glyph_by_name("A").unwrap().id();
        let mut location = DesignLocation::new();
        location.set(font.axes()[0].id(), 600.0);

        let glyph = font
            .projection(&location)
            .glyph(&glyph_id)
            .unwrap()
            .unwrap();

        assert_eq!(glyph.x_advance(), 700.0);
        assert_eq!(glyph.contours()[0].points[1].x(), 340.0);
    }

    #[test]
    fn component_without_matching_source_uses_its_static_master() {
        let (mut font, axis_id, _light_id, regular_id, bold_id) = variable_font();
        let child_id = GlyphId::from_raw("diaeresis");
        let mut child = Glyph::with_id(child_id.clone(), "diaeresis");
        let child_layer = line_layer(regular_id.clone(), 20.0);
        set_test_layer(&mut child, regular_id.clone(), child_layer);
        font.insert_glyph(child).unwrap();

        let root_id = GlyphId::from_raw("Adieresis");
        let mut root = Glyph::with_id(root_id.clone(), "Adieresis");
        for source_id in [regular_id, bold_id] {
            let mut layer = GlyphLayer::with_width(LayerId::new(), 500.0);
            layer.add_component(Component::new(child_id.clone(), "diaeresis"));
            set_test_layer(&mut root, source_id, layer);
        }
        font.insert_glyph(root).unwrap();

        let glyph = font
            .projection(&location(&axis_id, 900.0))
            .glyph(&root_id)
            .unwrap()
            .unwrap();

        assert_eq!(glyph.contours().len(), 1);
        assert_eq!(glyph.contours()[0].points[0].x(), 20.0);
    }

    #[test]
    fn component_without_matching_source_interpolates_at_the_root_location() {
        let (mut font, axis_id, light_id, regular_id, bold_id) = variable_font();
        let child_id = GlyphId::from_raw("diaeresis");
        let mut child = Glyph::with_id(child_id.clone(), "diaeresis");
        let light_layer = line_layer(light_id.clone(), 0.0);
        set_test_layer(&mut child, light_id, light_layer);
        let bold_layer = line_layer(bold_id.clone(), 80.0);
        set_test_layer(&mut child, bold_id, bold_layer);
        font.insert_glyph(child).unwrap();

        let weights = font
            .glyph_interpolation(&child_id)
            .unwrap()
            .unwrap()
            .basis()
            .weights_at(&location(&axis_id, 400.0), font.axes())
            .unwrap();
        assert_eq!(weights, vec![0.5, 0.5]);

        let root_id = GlyphId::from_raw("Adieresis");
        let mut root = Glyph::with_id(root_id.clone(), "Adieresis");
        let mut root_layer = GlyphLayer::with_width(LayerId::new(), 500.0);
        root_layer.add_component(Component::new(child_id, "diaeresis"));
        set_test_layer(&mut root, regular_id, root_layer);
        font.insert_glyph(root).unwrap();

        let glyph = font
            .projection(&location(&axis_id, 400.0))
            .glyph(&root_id)
            .unwrap()
            .unwrap();

        assert_eq!(glyph.contours().len(), 1);
        assert_eq!(glyph.contours()[0].points[0].x(), 40.0);
    }

    #[test]
    fn projection_rejects_a_component_glyph_without_a_master_layer() {
        let mut font = Font::new();
        let source_id = font.default_source_id().unwrap();
        let missing_id = GlyphId::from_raw("missing");
        let root_id = GlyphId::from_raw("root");
        let mut root = Glyph::with_id(root_id.clone(), "root");
        let mut root_layer = GlyphLayer::with_width(LayerId::new(), 500.0);
        root_layer.add_component(Component::new(missing_id.clone(), "missing"));
        set_test_layer(&mut root, source_id, root_layer);
        font.insert_glyph(root).unwrap();

        let error = font.glyph_projection(&root_id).unwrap_err();

        assert!(matches!(
            error,
            CoreError::UnresolvableComponentGlyph { base_glyph_id, .. }
                if base_glyph_id == missing_id
        ));
    }

    #[test]
    fn layer_only_sources_do_not_supply_component_geometry() {
        let mut font = Font::new();
        let master_id = font.default_source_id().unwrap();
        let layer_source_id = font.add_source(Source::layer("background".to_string()));
        let child_id = GlyphId::from_raw("child");
        let mut child = Glyph::with_id(child_id.clone(), "child");
        let child_layer = line_layer(layer_source_id.clone(), 20.0);
        set_test_layer(&mut child, layer_source_id, child_layer);
        font.insert_glyph(child).unwrap();

        let root_id = GlyphId::from_raw("root");
        let mut root = Glyph::with_id(root_id.clone(), "root");
        let mut root_layer = GlyphLayer::with_width(LayerId::new(), 500.0);
        root_layer.add_component(Component::new(child_id.clone(), "child"));
        set_test_layer(&mut root, master_id, root_layer);
        font.insert_glyph(root).unwrap();

        let error = font.glyph_projection(&root_id).unwrap_err();

        assert!(matches!(
            error,
            CoreError::UnresolvableComponentGlyph { base_glyph_id, .. }
                if base_glyph_id == child_id
        ));
    }

    #[test]
    fn glyph_projection_preserves_reordered_components_as_an_exact_source_shape() {
        let mut font = sample_variable_font();
        let glyph_id = font.glyph_by_name("A").unwrap().id();
        let reference_source_id = font.default_source_id().unwrap();
        let bold_source = font
            .sources()
            .iter()
            .find(|source| source.name() == "Bold")
            .unwrap()
            .clone();
        let reference_layer_id = font
            .layer_id_for_source(glyph_id.clone(), reference_source_id.clone())
            .unwrap();
        let bold_layer_id = font
            .layer_id_for_source(glyph_id.clone(), bold_source.id())
            .unwrap();
        let c_id = GlyphId::from_raw("C");
        let caron_id = GlyphId::from_raw("caron.cap");
        for (component_glyph_id, name) in [(c_id.clone(), "C"), (caron_id.clone(), "caron.cap")] {
            let mut component_glyph = Glyph::with_id(component_glyph_id, name);
            component_glyph
                .ensure_layer_for_source(reference_source_id.clone())
                .set_width(500.0);
            font.insert_glyph(component_glyph).unwrap();
        }
        let reference_layer = font.layer_mut(reference_layer_id).unwrap();
        reference_layer.add_component(Component::new(c_id.clone(), "C"));
        reference_layer.add_component(Component::new(caron_id.clone(), "caron.cap"));
        let bold_layer = font.layer_mut(bold_layer_id).unwrap();
        bold_layer.add_component(Component::new(caron_id.clone(), "caron.cap"));
        bold_layer.add_component(Component::new(c_id.clone(), "C"));

        let projection = font.glyph_projection(&glyph_id).unwrap().unwrap();
        let bold = projection
            .resolve(bold_source.location(), font.axes(), font.sources())
            .unwrap();
        let mut midpoint = DesignLocation::new();
        midpoint.set(font.axes()[0].id(), 600.0);
        let interpolated = projection
            .resolve(&midpoint, font.axes(), font.sources())
            .unwrap();

        assert_eq!(projection.exact_source_shapes().len(), 1);
        assert_eq!(projection.exact_source_components().len(), 1);
        assert_eq!(
            bold.components_iter()
                .map(|component| component.base_glyph_id())
                .collect::<Vec<_>>(),
            vec![caron_id.clone(), c_id.clone()]
        );
        assert_eq!(
            interpolated
                .components_iter()
                .map(|component| component.base_glyph_id())
                .collect::<Vec<_>>(),
            vec![c_id, caron_id]
        );
    }

    #[test]
    fn glyph_projection_records_no_component_exceptions_for_compatible_masters() {
        let (mut font, _axis_id, light_id, regular_id, bold_id) = variable_font();
        let base_id = GlyphId::from_raw("A");
        let mut base = Glyph::with_id(base_id.clone(), "A");
        for (source_id, x) in [
            (light_id.clone(), 0.0),
            (regular_id.clone(), 40.0),
            (bold_id.clone(), 80.0),
        ] {
            let layer = line_layer(source_id.clone(), x);
            set_test_layer(&mut base, source_id, layer);
        }
        font.insert_glyph(base).unwrap();

        let root_id = GlyphId::from_raw("Aacute");
        let mut root = Glyph::with_id(root_id.clone(), "Aacute");
        for (source_id, x) in [(light_id, 0.0), (regular_id, 40.0), (bold_id, 80.0)] {
            let mut layer = line_layer(source_id.clone(), x);
            layer.add_component(Component::new(base_id.clone(), "A"));
            set_test_layer(&mut root, source_id, layer);
        }
        font.insert_glyph(root).unwrap();

        let projection = font.glyph_projection(&root_id).unwrap().unwrap();

        assert!(projection.exact_source_components().is_empty());
        assert_eq!(
            projection
                .components()
                .components()
                .iter()
                .map(|component| component.base_glyph_id())
                .collect::<Vec<_>>(),
            vec![base_id.clone()]
        );
        assert_eq!(projection.component_glyph_ids(), [base_id]);
    }

    #[test]
    fn glyph_projection_records_a_decomposed_master_as_a_component_exception() {
        let (mut font, _axis_id, _light_id, regular_id, bold_id) = variable_font();
        let base_id = GlyphId::from_raw("A");
        let mut base = Glyph::with_id(base_id.clone(), "A");
        let regular_layer = line_layer(regular_id.clone(), 0.0);
        set_test_layer(&mut base, regular_id.clone(), regular_layer);
        let bold_layer = line_layer(bold_id.clone(), 80.0);
        set_test_layer(&mut base, bold_id.clone(), bold_layer);
        font.insert_glyph(base).unwrap();

        let root_id = GlyphId::from_raw("Aacute");
        let mut root = Glyph::with_id(root_id.clone(), "Aacute");
        let mut composed = GlyphLayer::with_width(LayerId::new(), 500.0);
        composed.add_component(Component::new(base_id.clone(), "A"));
        set_test_layer(&mut root, regular_id, composed);
        let bold_layer = line_layer(bold_id.clone(), 80.0);
        set_test_layer(&mut root, bold_id.clone(), bold_layer);
        font.insert_glyph(root).unwrap();

        let projection = font.glyph_projection(&root_id).unwrap().unwrap();

        assert_eq!(
            projection
                .components()
                .components()
                .iter()
                .map(|component| component.base_glyph_id())
                .collect::<Vec<_>>(),
            vec![base_id]
        );
        assert_eq!(projection.exact_source_components().len(), 1);
        let exception = &projection.exact_source_components()[0];
        assert_eq!(exception.source_id(), bold_id);
        assert!(exception.components().components().is_empty());
    }

    #[test]
    fn glyph_projection_keeps_default_structure_for_sparse_component_masters() {
        let (mut font, _axis_id, light_id, regular_id, bold_id) = variable_font();
        let base_id = GlyphId::from_raw("diaeresis");
        let mut base = Glyph::with_id(base_id.clone(), "diaeresis");
        let light_layer = line_layer(light_id.clone(), 0.0);
        set_test_layer(&mut base, light_id, light_layer);
        let bold_layer = line_layer(bold_id.clone(), 80.0);
        set_test_layer(&mut base, bold_id, bold_layer);
        font.insert_glyph(base).unwrap();

        let root_id = GlyphId::from_raw("Adieresis");
        let mut root = Glyph::with_id(root_id.clone(), "Adieresis");
        let mut layer = GlyphLayer::with_width(LayerId::new(), 500.0);
        layer.add_component(Component::new(base_id.clone(), "diaeresis"));
        set_test_layer(&mut root, regular_id, layer);
        font.insert_glyph(root).unwrap();

        let projection = font.glyph_projection(&root_id).unwrap().unwrap();

        assert!(projection.exact_source_components().is_empty());
        assert_eq!(projection.component_glyph_ids(), [base_id]);
    }

    #[test]
    fn glyph_projection_collects_the_nested_component_closure() {
        let (mut font, _axis_id, _light_id, regular_id, _bold_id) = variable_font();
        let acute_id = GlyphId::from_raw("acute");
        let mut acute = Glyph::with_id(acute_id.clone(), "acute");
        let acute_layer = line_layer(regular_id.clone(), 0.0);
        set_test_layer(&mut acute, regular_id.clone(), acute_layer);
        font.insert_glyph(acute).unwrap();

        let acutecomb_id = GlyphId::from_raw("acutecomb");
        let mut acutecomb = Glyph::with_id(acutecomb_id.clone(), "acutecomb");
        let mut acutecomb_layer = GlyphLayer::with_width(LayerId::new(), 0.0);
        acutecomb_layer.add_component(Component::new(acute_id.clone(), "acute"));
        set_test_layer(&mut acutecomb, regular_id.clone(), acutecomb_layer);
        font.insert_glyph(acutecomb).unwrap();

        let root_id = GlyphId::from_raw("Aacute");
        let mut root = Glyph::with_id(root_id.clone(), "Aacute");
        let mut root_layer = line_layer(regular_id.clone(), 40.0);
        root_layer.add_component(Component::new(acutecomb_id.clone(), "acutecomb"));
        set_test_layer(&mut root, regular_id, root_layer);
        font.insert_glyph(root).unwrap();

        let projection = font.glyph_projection(&root_id).unwrap().unwrap();

        assert_eq!(
            projection
                .components()
                .components()
                .iter()
                .map(|component| component.base_glyph_id())
                .collect::<Vec<_>>(),
            vec![acutecomb_id.clone(), acute_id.clone()]
        );
        let mut expected_ids = vec![acutecomb_id, acute_id];
        expected_ids.sort();
        assert_eq!(projection.component_glyph_ids(), expected_ids);
    }

    #[test]
    fn glyph_projection_fixes_anchor_attachment_choice() {
        let (mut font, _axis_id, _light_id, regular_id, _bold_id) = variable_font();
        let base_id = GlyphId::from_raw("A");
        let mut base = Glyph::with_id(base_id.clone(), "A");
        let mut base_layer = line_layer(regular_id.clone(), 0.0);
        base_layer.add_anchor(Anchor::new(Some("top".to_string()), 100.0, 200.0));
        set_test_layer(&mut base, regular_id.clone(), base_layer);
        font.insert_glyph(base).unwrap();

        let mark_id = GlyphId::from_raw("acutecomb");
        let mut mark = Glyph::with_id(mark_id.clone(), "acutecomb");
        let mut mark_layer = line_layer(regular_id.clone(), 0.0);
        mark_layer.add_anchor(Anchor::new(Some("_top".to_string()), 5.0, 0.0));
        set_test_layer(&mut mark, regular_id.clone(), mark_layer);
        font.insert_glyph(mark).unwrap();

        let root_id = GlyphId::from_raw("Aacute");
        let mut root = Glyph::with_id(root_id.clone(), "Aacute");
        let mut root_layer = GlyphLayer::with_width(LayerId::new(), 500.0);
        root_layer.add_component(Component::new(base_id, "A"));
        root_layer.add_component(Component::new(mark_id, "acutecomb"));
        set_test_layer(&mut root, regular_id, root_layer);
        font.insert_glyph(root).unwrap();

        let projection = font.glyph_projection(&root_id).unwrap().unwrap();

        let components = projection.components().components();
        assert_eq!(components.len(), 2);
        let attachment = components[1].attachment().unwrap();
        assert_eq!(
            attachment.source().component_path(),
            components[1].component_path()
        );
        assert_eq!(
            attachment.target().component_path(),
            components[0].component_path()
        );
    }

    #[test]
    fn glyph_local_sources_interpolate_on_local_axes() {
        let (mut font, _weight_id, _, regular_id, _) = variable_font();
        let local_axis_id = AxisId::from_raw("local-width");
        let mut glyph = Glyph::new("local");
        glyph.insert_axis(GlyphAxis::with_id(
            local_axis_id.clone(),
            "Local Width".to_string(),
            0.0,
            0.0,
            100.0,
        ));
        let narrow = GlyphLayer::with_width(LayerId::from_raw("narrow"), 200.0);
        let wide = GlyphLayer::with_width(LayerId::from_raw("wide"), 400.0);
        glyph.set_layer(narrow.clone());
        glyph.set_layer(wide.clone());
        let mut narrow_location = Location::new();
        narrow_location.set(local_axis_id.clone(), 0.0);
        glyph.insert_default_source(GlyphSource::new(
            "Narrow".to_string(),
            narrow.id(),
            Some(regular_id.clone()),
            narrow_location,
        ));
        let mut wide_location = Location::new();
        wide_location.set(local_axis_id.clone(), 100.0);
        glyph.insert_default_source(GlyphSource::new(
            "Wide".to_string(),
            wide.id(),
            Some(regular_id),
            wide_location,
        ));
        let glyph_id = font.insert_glyph(glyph).unwrap();
        font.validate().unwrap();
        let mut location = DesignLocation::new();
        location.set(local_axis_id, 50.0);

        let resolved = font
            .projection(&location)
            .glyph(&glyph_id)
            .unwrap()
            .unwrap();

        assert!((resolved.x_advance() - 300.0).abs() <= 1e-9);
    }

    #[test]
    fn conditional_variants_use_first_match_without_default_fallback() {
        let (mut font, weight_id, _, regular_id, _) = variable_font();
        let mut glyph = Glyph::new("variant");
        let default_layer = GlyphLayer::with_width(LayerId::from_raw("default"), 100.0);
        let first_layer = GlyphLayer::with_width(LayerId::from_raw("first"), 200.0);
        let second_layer = GlyphLayer::with_width(LayerId::from_raw("second"), 300.0);
        glyph.set_layer(default_layer.clone());
        glyph.set_layer(first_layer.clone());
        glyph.set_layer(second_layer.clone());
        glyph.insert_default_source(GlyphSource::new(
            "Default".to_string(),
            default_layer.id(),
            Some(regular_id.clone()),
            Location::new(),
        ));
        let mut first = GlyphVariant::new(
            "First".to_string(),
            Condition::AxisRange {
                axis_id: weight_id.clone(),
                minimum: Some(500.0),
                maximum: None,
            },
        );
        first.insert_source(GlyphSource::new(
            "First explicit".to_string(),
            first_layer.id(),
            Some(regular_id.clone()),
            Location::new(),
        ));
        glyph.insert_variant(first);
        let mut second = GlyphVariant::new(
            "Second".to_string(),
            Condition::AxisRange {
                axis_id: weight_id.clone(),
                minimum: Some(400.0),
                maximum: None,
            },
        );
        second.insert_source(GlyphSource::new(
            "Second explicit".to_string(),
            second_layer.id(),
            Some(regular_id),
            Location::new(),
        ));
        glyph.insert_variant(second);
        let glyph_id = font.insert_glyph(glyph).unwrap();
        font.validate().unwrap();

        let resolved = font
            .projection(&location(&weight_id, 600.0))
            .glyph(&glyph_id)
            .unwrap()
            .unwrap();

        assert_eq!(resolved.x_advance(), 200.0);
    }

    #[test]
    fn component_locations_interpolate_with_parent_glyph_sources() {
        let (mut font, weight_id, _, regular_id, bold_id) = variable_font();
        let local_axis_id = AxisId::from_raw("component-width");
        let base_id = GlyphId::from_raw("variable-component-base");
        let mut base = Glyph::with_id(base_id.clone(), "variable-component-base");
        base.insert_axis(GlyphAxis::with_id(
            local_axis_id.clone(),
            "Component Width".to_string(),
            0.0,
            0.0,
            100.0,
        ));
        let narrow = line_layer(regular_id.clone(), 0.0);
        let wide = line_layer(regular_id.clone(), 100.0);
        base.set_layer(narrow.clone());
        base.set_layer(wide.clone());
        let mut narrow_location = Location::new();
        narrow_location.set(local_axis_id.clone(), 0.0);
        base.insert_default_source(GlyphSource::new(
            "Narrow".to_string(),
            narrow.id(),
            Some(regular_id.clone()),
            narrow_location,
        ));
        let mut wide_location = Location::new();
        wide_location.set(local_axis_id.clone(), 100.0);
        base.insert_default_source(GlyphSource::new(
            "Wide".to_string(),
            wide.id(),
            Some(regular_id.clone()),
            wide_location,
        ));
        font.insert_glyph(base).unwrap();

        let mut root = Glyph::new("variable-component-root");
        let mut regular_layer = GlyphLayer::new(LayerId::from_raw("component-regular"));
        let mut regular_component = Component::new(base_id.clone(), "variable-component-base");
        let mut regular_component_location = Location::new();
        regular_component_location.set(local_axis_id.clone(), 0.0);
        regular_component.set_location(regular_component_location);
        regular_layer.add_component(regular_component);
        let mut bold_layer = GlyphLayer::new(LayerId::from_raw("component-bold"));
        let mut bold_component = Component::new(base_id, "variable-component-base");
        let mut bold_component_location = Location::new();
        bold_component_location.set(local_axis_id, 100.0);
        bold_component.set_location(bold_component_location);
        bold_layer.add_component(bold_component);
        root.set_layer(regular_layer.clone());
        root.set_layer(bold_layer.clone());
        root.insert_default_source(GlyphSource::new(
            "Regular".to_string(),
            regular_layer.id(),
            Some(regular_id),
            Location::new(),
        ));
        root.insert_default_source(GlyphSource::new(
            "Bold".to_string(),
            bold_layer.id(),
            Some(bold_id),
            Location::new(),
        ));
        let root_id = font.insert_glyph(root).unwrap();
        font.validate().unwrap();

        let resolved = font
            .projection(&location(&weight_id, 650.0))
            .glyph(&root_id)
            .unwrap()
            .unwrap();

        assert!((resolved.contours()[0].points[0].x() - 50.0).abs() <= 1e-6);
    }

    #[test]
    fn component_condition_uses_root_font_location() {
        let (mut font, weight_id, _, regular_id, _) = variable_font();
        let base_id = GlyphId::from_raw("conditional-base");
        let mut base = Glyph::with_id(base_id.clone(), "conditional-base");
        let base_layer = line_layer(regular_id.clone(), 20.0);
        base.set_layer(base_layer.clone());
        base.insert_default_source(GlyphSource::new(
            "Base".to_string(),
            base_layer.id(),
            Some(regular_id.clone()),
            Location::new(),
        ));
        font.insert_glyph(base).unwrap();

        let mut root = Glyph::new("conditional-root");
        let mut root_layer = GlyphLayer::new(LayerId::from_raw("conditional-root"));
        let mut component = Component::new(base_id, "conditional-base");
        component.set_condition(Some(Condition::AxisRange {
            axis_id: weight_id.clone(),
            minimum: Some(600.0),
            maximum: None,
        }));
        root_layer.add_component(component);
        root.set_layer(root_layer.clone());
        root.insert_default_source(GlyphSource::new(
            "Root".to_string(),
            root_layer.id(),
            Some(regular_id),
            Location::new(),
        ));
        let root_id = font.insert_glyph(root).unwrap();
        font.validate().unwrap();

        let hidden = font
            .projection(&location(&weight_id, 500.0))
            .glyph(&root_id)
            .unwrap()
            .unwrap();
        assert!(hidden.contours().is_empty());
        let visible = font
            .projection(&location(&weight_id, 700.0))
            .glyph(&root_id)
            .unwrap()
            .unwrap();
        assert_eq!(visible.contours().len(), 1);
    }

    #[test]
    fn nested_component_axis_inheritance_uses_parent_or_root_font_location() {
        let (mut font, weight_id, _, regular_id, _) = variable_font();
        let shoulder_id = GlyphId::from_raw("shoulder");
        let mut shoulder = Glyph::with_id(shoulder_id.clone(), "shoulder");
        let light = line_layer(regular_id.clone(), 0.0);
        let heavy = line_layer(regular_id.clone(), 300.0);
        shoulder.set_layer(light.clone());
        shoulder.set_layer(heavy.clone());
        let mut light_location = Location::new();
        light_location.set(weight_id.clone(), 400.0);
        shoulder.insert_default_source(GlyphSource::new(
            "Light".to_string(),
            light.id(),
            Some(regular_id.clone()),
            light_location,
        ));
        let mut heavy_location = Location::new();
        heavy_location.set(weight_id.clone(), 700.0);
        shoulder.insert_default_source(GlyphSource::new(
            "Heavy".to_string(),
            heavy.id(),
            Some(regular_id.clone()),
            heavy_location,
        ));
        font.insert_glyph(shoulder).unwrap();

        let middle_id = GlyphId::from_raw("middle");
        let mut middle = Glyph::with_id(middle_id.clone(), "middle");
        let mut middle_layer = GlyphLayer::new(LayerId::from_raw("middle"));
        let nested_component_id = crate::ComponentId::from_raw("nested-shoulder");
        middle_layer.add_component(Component::with_id(
            nested_component_id.clone(),
            shoulder_id,
            "shoulder",
            crate::DecomposedTransform::identity(),
        ));
        middle.set_layer(middle_layer.clone());
        middle.insert_default_source(GlyphSource::new(
            "Middle".to_string(),
            middle_layer.id(),
            Some(regular_id.clone()),
            Location::new(),
        ));
        font.insert_glyph(middle).unwrap();

        let mut root = Glyph::new("root");
        let mut root_layer = GlyphLayer::new(LayerId::from_raw("root"));
        let mut middle_component = Component::new(middle_id, "middle");
        let mut middle_location = Location::new();
        middle_location.set(weight_id.clone(), 500.0);
        middle_component.set_location(middle_location);
        root_layer.add_component(middle_component);
        root.set_layer(root_layer.clone());
        root.insert_default_source(GlyphSource::new(
            "Root".to_string(),
            root_layer.id(),
            Some(regular_id),
            Location::new(),
        ));
        let root_id = font.insert_glyph(root).unwrap();
        font.validate().unwrap();

        let root_location = location(&weight_id, 700.0);
        let parent = font
            .projection(&root_location)
            .glyph(&root_id)
            .unwrap()
            .unwrap();
        assert!((parent.contours()[0].points[0].x() - 100.0).abs() <= 1e-6);

        font.set_component_axis_inheritance(nested_component_id, AxisInheritance::Font)
            .unwrap();
        let reset = font
            .projection(&root_location)
            .glyph(&root_id)
            .unwrap()
            .unwrap();
        assert!((reset.contours()[0].points[0].x() - 300.0).abs() <= 1e-6);
    }

    #[test]
    fn projection_preserves_order_and_distinguishes_blank_from_missing() {
        let mut font = Font::new();
        let source_id = font.default_source_id().unwrap();
        let blank_id = GlyphId::from_raw("blank");
        let mut blank = Glyph::with_id(blank_id.clone(), "blank");
        let blank_layer = GlyphLayer::with_width(LayerId::new(), 420.0);
        set_test_layer(&mut blank, source_id, blank_layer);
        font.insert_glyph(blank).unwrap();

        let glyphs = font
            .projection(&DesignLocation::new())
            .glyphs(&[
                GlyphId::from_raw("missing"),
                blank_id.clone(),
                blank_id.clone(),
            ])
            .unwrap();

        assert_eq!(glyphs.len(), 2);
        assert_eq!(glyphs[0].glyph_id(), blank_id);
        assert!(glyphs[0].contours().is_empty());
        assert_eq!(glyphs[0].x_advance(), 420.0);
    }

    #[test]
    fn projection_flattens_transformed_components() {
        let mut font = Font::new();
        let source_id = font.default_source_id().unwrap();
        let base_id = GlyphId::from_raw("base");
        let mut base = Glyph::with_id(base_id.clone(), "base");
        let mut base_layer = GlyphLayer::with_width(LayerId::new(), 200.0);
        let mut contour = Contour::new();
        contour.add_point(0.0, 0.0, PointType::OnCurve, false);
        contour.add_point(10.0, 10.0, PointType::OnCurve, false);
        base_layer.add_contour(contour);
        set_test_layer(&mut base, source_id.clone(), base_layer);
        font.insert_glyph(base).unwrap();

        let root_id = GlyphId::from_raw("root");
        let mut root = Glyph::with_id(root_id.clone(), "root");
        let mut root_layer = GlyphLayer::with_width(LayerId::new(), 500.0);
        root_layer.add_component(Component::with_matrix(
            base_id,
            "base",
            &Transform::translate(50.0, 20.0),
        ));
        set_test_layer(&mut root, source_id, root_layer);
        font.insert_glyph(root).unwrap();

        let glyph = font
            .projection(&DesignLocation::new())
            .glyph(&root_id)
            .unwrap()
            .unwrap();

        assert_eq!(glyph.x_advance(), 500.0);
        let first = &glyph.contours()[0].points[0];
        let second = &glyph.contours()[0].points[1];
        assert_eq!((first.x(), first.y()), (50.0, 20.0));
        assert_eq!((second.x(), second.y()), (60.0, 30.0));
    }
}
