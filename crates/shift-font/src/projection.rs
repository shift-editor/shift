//! Location-independent glyph backing and location-bound read-only resolution.

use std::collections::HashMap;

use crate::composite::{
    preferred_layer_for_glyph, resolved_contours_for_layer, GlyphLayerProvider, ResolvedContour,
};
use crate::{
    Axis, CoreResult, Font, Glyph, GlyphId, GlyphInterpolation, GlyphLayer, Location, Source,
    SourceId,
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
    fallback: GlyphLayer,
    interpolation: Option<GlyphInterpolation>,
    exact_source_shapes: Vec<GlyphSourceShape>,
    component_glyph_ids: Vec<GlyphId>,
}

impl GlyphProjection {
    /// Returns the projected glyph's stable identity.
    pub fn glyph_id(&self) -> GlyphId {
        self.glyph_id.clone()
    }

    /// Returns the preferred structural and numeric fallback shape.
    pub fn fallback(&self) -> &GlyphLayer {
        &self.fallback
    }

    /// Returns compatible source interpolation when a viable basis exists.
    pub fn interpolation(&self) -> Option<&GlyphInterpolation> {
        self.interpolation.as_ref()
    }

    /// Returns exact-source shapes excluded from compatible interpolation.
    pub fn exact_source_shapes(&self) -> &[GlyphSourceShape] {
        &self.exact_source_shapes
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
    /// template disagree, or when an interpolation support axis is absent.
    pub fn resolve(
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

/// Read-only font projection fixed to one internal authoring location.
///
/// The projection snapshots its location and memoizes derived layers for its
/// own lifetime. It does not mutate authored font data or retain renderer,
/// persistence, or compiler state.
pub struct FontProjection<'a> {
    font: &'a Font,
    location: Location,
    layers: HashMap<GlyphId, Option<GlyphLayer>>,
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
    /// or an interpolation construction error from the glyph's variation data.
    pub fn glyph_projection(&self, glyph_id: &GlyphId) -> CoreResult<Option<GlyphProjection>> {
        let glyph = self
            .glyph(glyph_id.clone())
            .ok_or_else(|| crate::CoreError::GlyphNotFound(glyph_id.clone()))?;
        let Some(fallback) = fallback_layer(self, glyph).cloned() else {
            return Ok(None);
        };

        let interpolation = self.glyph_interpolation(glyph_id)?;
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
            .collect::<Vec<_>>();
        let mut component_glyph_ids = fallback
            .components_iter()
            .map(|component| component.base_glyph_id())
            .chain(exact_source_shapes.iter().flat_map(|source_shape| {
                source_shape
                    .layer
                    .components_iter()
                    .map(|component| component.base_glyph_id())
            }))
            .collect::<Vec<_>>();
        component_glyph_ids.sort();
        component_glyph_ids.dedup();

        Ok(Some(GlyphProjection {
            glyph_id: glyph_id.clone(),
            fallback,
            interpolation,
            exact_source_shapes,
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
    /// Returns a glyph interpolation error when derived values do not match
    /// their compatible structural template.
    pub fn glyph(&mut self, glyph_id: &GlyphId) -> CoreResult<Option<ResolvedGlyph>> {
        self.prepare_layer_tree(glyph_id)?;

        let provider = ProjectionLayerProvider {
            font: self.font,
            layers: &self.layers,
        };
        let Some(layer) = provider.glyph_layer(glyph_id) else {
            return Ok(None);
        };

        Ok(Some(ResolvedGlyph {
            glyph_id: glyph_id.clone(),
            contours: resolved_contours_for_layer(&provider, layer, glyph_id),
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

    fn prepare_layer_tree(&mut self, glyph_id: &GlyphId) -> CoreResult<()> {
        self.resolve_layer(glyph_id)?;

        let component_ids = match self.layers.get(glyph_id) {
            Some(Some(layer)) => layer
                .components_iter()
                .map(|component| component.base_glyph_id())
                .collect::<Vec<_>>(),
            Some(None) | None => return Ok(()),
        };

        for component_id in component_ids {
            if !self.layers.contains_key(&component_id) {
                self.prepare_layer_tree(&component_id)?;
            }
        }

        Ok(())
    }

    fn resolve_layer(&mut self, glyph_id: &GlyphId) -> CoreResult<()> {
        if self.layers.contains_key(glyph_id) {
            return Ok(());
        }

        if self.font.glyph(glyph_id.clone()).is_none() {
            self.layers.insert(glyph_id.clone(), None);
            return Ok(());
        }

        let layer = self
            .font
            .glyph_projection(glyph_id)?
            .map(|projection| {
                projection.resolve(&self.location, self.font.axes(), self.font.sources())
            })
            .transpose()?;
        self.layers.insert(glyph_id.clone(), layer);
        Ok(())
    }
}

struct ProjectionLayerProvider<'a> {
    font: &'a Font,
    layers: &'a HashMap<GlyphId, Option<GlyphLayer>>,
}

impl GlyphLayerProvider for ProjectionLayerProvider<'_> {
    fn glyph_layer(&self, glyph_id: &GlyphId) -> Option<&GlyphLayer> {
        match self.layers.get(glyph_id) {
            Some(Some(layer)) => Some(layer),
            Some(None) | None => None,
        }
    }

    fn glyph_name(&self, glyph_id: &GlyphId) -> Option<&str> {
        self.font.glyph(glyph_id.clone()).map(Glyph::name)
    }
}

fn fallback_layer<'a>(font: &Font, glyph: &'a Glyph) -> Option<&'a GlyphLayer> {
    if let Some(layer) = font
        .default_source_id()
        .and_then(|source_id| glyph.layer_for_source(source_id))
    {
        return Some(layer);
    }

    preferred_layer_for_glyph(glyph)
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
        Component, Contour, Font, Glyph, GlyphId, GlyphLayer, LayerId, Location, PointType,
        Transform,
    };

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
            .layer_id_for_glyph_source(glyph_id.clone(), reference_source_id)
            .unwrap();
        let bold_layer_id = font
            .layer_id_for_glyph_source(glyph_id.clone(), bold_source.id())
            .unwrap();
        let c_id = GlyphId::from_raw("C");
        let caron_id = GlyphId::from_raw("caron.cap");
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
