//! Location-independent glyph backing and location-bound read-only resolution.

use std::collections::HashMap;

use crate::composite::{resolved_contours_from_layers, GlyphComponents, ResolvedContour};
use crate::{
    Axis, CoreError, CoreResult, Font, Glyph, GlyphId, GlyphInterpolation, GlyphLayer, Location,
    Source, SourceId,
};

/// One exact-source shape that cannot be represented by compatible variation.
///
/// This shape is selected only when a projection lands exactly on its authored
/// source. Between sources, interpolation continues to use the compatible
/// interpolation basis or the projection fallback.
#[derive(Clone, Debug, PartialEq)]
pub struct GlyphSourceShape {
    source_id: SourceId,
    layer: GlyphLayer,
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
/// reproduce. It owns derived layer clones and never mutates the font.
#[derive(Clone, Debug, PartialEq)]
pub struct GlyphProjection {
    glyph_id: GlyphId,
    layers: GlyphLayerProjection,
    components: GlyphComponents,
    exact_source_components: Vec<GlyphSourceComponents>,
    component_glyph_ids: Vec<GlyphId>,
}

#[derive(Clone, Debug, PartialEq)]
struct GlyphLayerProjection {
    fallback: GlyphLayer,
    interpolation: Option<GlyphInterpolation>,
    exact_source_shapes: Vec<GlyphSourceShape>,
}

impl GlyphLayerProjection {
    fn resolve(
        &self,
        location: &Location,
        axes: &[Axis],
        sources: &[Source],
    ) -> CoreResult<GlyphLayer> {
        let exact_source_id = exact_source_id(location, axes, sources);
        if let Some(source_id) = exact_source_id {
            if source_id == self.fallback.source_id() {
                return Ok(self.fallback.clone());
            }

            if let Some(source_shape) = self
                .exact_source_shapes
                .iter()
                .find(|source_shape| source_shape.source_id == source_id)
            {
                return Ok(source_shape.layer.clone());
            }
        }

        let Some(interpolation) = &self.interpolation else {
            return Ok(self.fallback.clone());
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
        location: &Location,
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
    location: Location,
    layers: HashMap<GlyphId, GlyphLayer>,
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
    fn glyph_layer_projection(
        &self,
        glyph_id: &GlyphId,
    ) -> CoreResult<Option<GlyphLayerProjection>> {
        let Some(glyph) = self.glyph(glyph_id.clone()) else {
            return Ok(None);
        };
        let interpolation = self.glyph_interpolation(glyph_id)?;
        let fallback = interpolation
            .as_ref()
            .map(GlyphInterpolation::reference_layer)
            .or_else(|| fallback_layer(self, glyph))
            .cloned();
        let Some(fallback) = fallback else {
            return Ok(None);
        };
        let exact_source_shapes = self
            .sources()
            .iter()
            .filter(|source| source.is_master())
            .filter_map(|source| {
                let layer = glyph.layer_for_source(source.id())?;
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
                    layer: layer.clone(),
                })
            })
            .collect();

        Ok(Some(GlyphLayerProjection {
            fallback,
            interpolation,
            exact_source_shapes,
        }))
    }

    fn resolved_layer_at(
        &self,
        glyph_id: &GlyphId,
        location: &Location,
    ) -> CoreResult<Option<GlyphLayer>> {
        let Some(projection) = self.glyph_layer_projection(glyph_id)? else {
            return Ok(None);
        };

        projection
            .resolve(location, self.axes(), self.sources())
            .map(Some)
    }

    fn resolve_component_layers_at(
        &self,
        root_glyph_id: &GlyphId,
        location: &Location,
    ) -> CoreResult<Option<HashMap<GlyphId, GlyphLayer>>> {
        let Some(root_layer) = self.resolved_layer_at(root_glyph_id, location)? else {
            return Ok(None);
        };
        let mut layers = HashMap::from([(root_glyph_id.clone(), root_layer)]);
        self.append_component_layers_at(root_glyph_id, location, &mut layers)?;
        Ok(Some(layers))
    }

    fn append_component_layers_at(
        &self,
        parent_glyph_id: &GlyphId,
        location: &Location,
        layers: &mut HashMap<GlyphId, GlyphLayer>,
    ) -> CoreResult<()> {
        let components = layers
            .get(parent_glyph_id)
            .expect("parent layer was inserted before traversing its components")
            .components_iter()
            .map(|component| (component.id(), component.base_glyph_id()))
            .collect::<Vec<_>>();

        for (component_id, base_glyph_id) in components {
            if layers.contains_key(&base_glyph_id) {
                continue;
            }

            let Some(layer) = self.resolved_layer_at(&base_glyph_id, location)? else {
                return Err(CoreError::UnresolvableComponentGlyph {
                    component_id,
                    base_glyph_id,
                });
            };
            layers.insert(base_glyph_id.clone(), layer);
            self.append_component_layers_at(&base_glyph_id, location, layers)?;
        }

        Ok(())
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
        if self.glyph(glyph_id.clone()).is_none() {
            return Err(CoreError::GlyphNotFound(glyph_id.clone()));
        }
        let Some(layers) = self.glyph_layer_projection(glyph_id)? else {
            return Ok(None);
        };

        let fallback_source = source_for_id(self, &layers.fallback.source_id())
            .ok_or_else(|| CoreError::SourceNotFound(layers.fallback.source_id()))?;
        let default_layers = self
            .resolve_component_layers_at(glyph_id, fallback_source.location())?
            .expect("a glyph layer projection resolves at its fallback source");
        let components = GlyphComponents::from_layers(glyph_id, &default_layers)?;

        let mut exact_source_components = Vec::new();
        for source in self.sources().iter().filter(|source| source.is_master()) {
            let resolved_layers = self
                .resolve_component_layers_at(glyph_id, source.location())?
                .expect("a glyph layer projection resolves at every master location");
            let source_components = GlyphComponents::from_layers(glyph_id, &resolved_layers)?;
            if source_components != components {
                exact_source_components.push(GlyphSourceComponents {
                    source_id: source.id(),
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

        Ok(Some(GlyphProjection {
            glyph_id: glyph_id.clone(),
            layers,
            components,
            exact_source_components,
            component_glyph_ids,
        }))
    }

    /// Creates a read-only projection at an internal authoring location.
    ///
    /// Missing axis coordinates use axis defaults. External axis mappings must
    /// be evaluated before constructing the projection.
    pub fn projection(&self, location: &Location) -> FontProjection<'_> {
        FontProjection {
            font: self,
            location: location.clone(),
            layers: HashMap::new(),
        }
    }
}

impl FontProjection<'_> {
    /// Returns the internal authoring location fixed for this projection.
    pub fn location(&self) -> &Location {
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

        let Some(layer) = self.font.resolved_layer_at(glyph_id, &self.location)? else {
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

fn fallback_layer<'a>(font: &Font, glyph: &'a Glyph) -> Option<&'a GlyphLayer> {
    if let Some(default_source_id) = font.default_source_id() {
        let is_master = source_for_id(font, &default_source_id).is_some_and(Source::is_master);
        if is_master {
            if let Some(layer) = glyph.layer_for_source(default_source_id) {
                return Some(layer);
            }
        }
    }

    glyph
        .layers()
        .values()
        .filter(|layer| source_for_id(font, &layer.source_id()).is_some_and(Source::is_master))
        .max_by_key(|layer| layer.contours().len() + layer.components().len())
        .map(|layer| layer.as_ref())
}

fn source_for_id<'a>(font: &'a Font, source_id: &SourceId) -> Option<&'a Source> {
    font.sources()
        .iter()
        .find(|source| source.id() == *source_id)
}

fn exact_source_id(location: &Location, axes: &[Axis], sources: &[Source]) -> Option<SourceId> {
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
        Axis, AxisId, Component, Contour, CoreError, Font, Glyph, GlyphId, GlyphLayer, LayerId,
        Location, PointType, Source, SourceId, Transform,
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

    fn location(axis_id: &AxisId, value: f64) -> Location {
        let mut location = Location::new();
        location.set(axis_id.clone(), value);
        location
    }

    fn line_layer(source_id: SourceId, x: f64) -> GlyphLayer {
        let mut layer = GlyphLayer::with_width(LayerId::new(), source_id, 200.0);
        let mut contour = Contour::new();
        contour.add_point(x, 0.0, PointType::OnCurve, false);
        contour.add_point(x + 10.0, 0.0, PointType::OnCurve, false);
        layer.add_contour(contour);
        layer
    }

    #[test]
    fn projection_interpolates_when_an_exact_source_has_no_glyph_layer() {
        let font = sample_variable_font();
        let glyph_id = font.glyph_by_name("A").unwrap().id();
        let mut location = Location::new();
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
        child.set_layer(line_layer(regular_id.clone(), 20.0));
        font.insert_glyph(child).unwrap();

        let root_id = GlyphId::from_raw("Adieresis");
        let mut root = Glyph::with_id(root_id.clone(), "Adieresis");
        for source_id in [regular_id, bold_id] {
            let mut layer = GlyphLayer::with_width(LayerId::new(), source_id, 500.0);
            layer.add_component(Component::new(child_id.clone(), "diaeresis"));
            root.set_layer(layer);
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
        child.set_layer(line_layer(light_id, 0.0));
        child.set_layer(line_layer(bold_id, 80.0));
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
        let mut root_layer = GlyphLayer::with_width(LayerId::new(), regular_id, 500.0);
        root_layer.add_component(Component::new(child_id, "diaeresis"));
        root.set_layer(root_layer);
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
        let mut root_layer = GlyphLayer::with_width(LayerId::new(), source_id, 500.0);
        root_layer.add_component(Component::new(missing_id.clone(), "missing"));
        root.set_layer(root_layer);
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
        child.set_layer(line_layer(layer_source_id, 20.0));
        font.insert_glyph(child).unwrap();

        let root_id = GlyphId::from_raw("root");
        let mut root = Glyph::with_id(root_id.clone(), "root");
        let mut root_layer = GlyphLayer::with_width(LayerId::new(), master_id, 500.0);
        root_layer.add_component(Component::new(child_id.clone(), "child"));
        root.set_layer(root_layer);
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
            .layer_id_for_glyph_source(glyph_id.clone(), reference_source_id.clone())
            .unwrap();
        let bold_layer_id = font
            .layer_id_for_glyph_source(glyph_id.clone(), bold_source.id())
            .unwrap();
        let c_id = GlyphId::from_raw("C");
        let caron_id = GlyphId::from_raw("caron.cap");
        for (component_glyph_id, name) in [(c_id.clone(), "C"), (caron_id.clone(), "caron.cap")] {
            let mut component_glyph = Glyph::with_id(component_glyph_id, name);
            component_glyph.set_layer(GlyphLayer::with_width(
                LayerId::new(),
                reference_source_id.clone(),
                500.0,
            ));
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
        let mut midpoint = Location::new();
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
    fn projection_preserves_order_and_distinguishes_blank_from_missing() {
        let mut font = Font::new();
        let source_id = font.default_source_id().unwrap();
        let blank_id = GlyphId::from_raw("blank");
        let mut blank = Glyph::with_id(blank_id.clone(), "blank");
        blank.set_layer(GlyphLayer::with_width(LayerId::new(), source_id, 420.0));
        font.insert_glyph(blank).unwrap();

        let glyphs = font
            .projection(&Location::new())
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
        let mut base_layer = GlyphLayer::with_width(LayerId::new(), source_id.clone(), 200.0);
        let mut contour = Contour::new();
        contour.add_point(0.0, 0.0, PointType::OnCurve, false);
        contour.add_point(10.0, 10.0, PointType::OnCurve, false);
        base_layer.add_contour(contour);
        base.set_layer(base_layer);
        font.insert_glyph(base).unwrap();

        let root_id = GlyphId::from_raw("root");
        let mut root = Glyph::with_id(root_id.clone(), "root");
        let mut root_layer = GlyphLayer::with_width(LayerId::new(), source_id, 500.0);
        root_layer.add_component(Component::with_matrix(
            base_id,
            "base",
            &Transform::translate(50.0, 20.0),
        ));
        root.set_layer(root_layer);
        font.insert_glyph(root).unwrap();

        let glyph = font
            .projection(&Location::new())
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
