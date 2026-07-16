//! Location-bound, read-only glyph resolution.

use std::collections::HashMap;

use crate::composite::{
    preferred_layer_for_glyph, resolved_contours_for_layer, GlyphLayerProvider, ResolvedContour,
};
use crate::{CoreResult, Font, Glyph, GlyphId, GlyphLayer, Location, SourceId};

/// Read-only font projection fixed to one internal authoring location.
///
/// The projection snapshots its location and memoizes derived layers for its
/// own lifetime. It does not mutate authored font data or retain renderer,
/// persistence, or compiler state.
pub struct FontProjection<'a> {
    font: &'a Font,
    location: Location,
    exact_source_id: Option<SourceId>,
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
    pub fn glyph_id(&self) -> GlyphId {
        self.glyph_id.clone()
    }

    pub fn contours(&self) -> &[ResolvedContour] {
        &self.contours
    }

    pub fn x_advance(&self) -> f64 {
        self.x_advance
    }
}

impl Font {
    /// Creates a read-only projection at an internal authoring location.
    ///
    /// Missing axis coordinates use axis defaults. External axis mappings must
    /// be evaluated before constructing the projection.
    pub fn projection(&self, location: &Location) -> FontProjection<'_> {
        let exact_source_id = self
            .sources()
            .iter()
            .filter(|source| source.is_master())
            .find(|source| locations_equal(source.location(), location, self))
            .map(|source| source.id());

        FontProjection {
            font: self,
            location: location.clone(),
            exact_source_id,
            layers: HashMap::new(),
        }
    }
}

impl FontProjection<'_> {
    pub fn location(&self) -> &Location {
        &self.location
    }

    /// Resolves one glyph without exposing editable layer identities.
    ///
    /// Exact authored layers win, followed by compatible interpolation and the
    /// default-source fallback. Components resolve recursively at this
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

        let Some(glyph) = self.font.glyph(glyph_id.clone()) else {
            self.layers.insert(glyph_id.clone(), None);
            return Ok(());
        };

        let layer = if let Some(source_id) = self.exact_source_id.clone() {
            glyph.layer_for_source(source_id).cloned()
        } else {
            None
        };
        let layer = match layer {
            Some(layer) => Some(layer),
            None => match self.font.glyph_interpolation(glyph_id)? {
                Some(interpolation) => {
                    Some(interpolation.resolve(&self.location, self.font.axes())?)
                }
                None => fallback_layer(self.font, glyph).cloned(),
            },
        };
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

fn locations_equal(left: &Location, right: &Location, font: &Font) -> bool {
    font.axes().iter().all(|axis| {
        let left = left.get(&axis.id()).unwrap_or(axis.default());
        let right = right.get(&axis.id()).unwrap_or(axis.default());
        (left - right).abs() <= 1e-6
    })
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
