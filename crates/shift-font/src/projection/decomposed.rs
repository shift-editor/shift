//! Component geometry at in-between locations, interpolated the way compiled
//! fonts interpolate it.
//!
//! A compiled variable font can vary a component's offset but not its scale,
//! rotation, or skew, so compilers decompose a glyph whose own components
//! change those between its masters and interpolate the resulting outlines.
//! Shift draws such a glyph the same way: each master places its components
//! with its own transform, and the placed outlines blend with the glyph's
//! source weights. Blending the transform values instead and applying the
//! result to the blended base gives a different shape, the product of two
//! interpolations.
//!
//! Only geometry changes. Component occurrences keep their identity, and a
//! glyph whose components differ only in offset resolves exactly as before,
//! because then both ways agree.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use crate::composite::ResolvedContour;
use crate::{
    CoreError, CoreResult, DesignLocation, Font, Glyph, GlyphId, GlyphInterpolation, GlyphLayer,
    InterpolationBasis, Point, SourceId, Transform,
};

use super::FontProjection;
use crate::placed_blend::{ContourShape, mirrors, placed_point_index};

/// A glyph's flattened outline split by where each contour comes from: the
/// glyph's own contours first, then one part per component occurrence in
/// depth-first order, each placed in the glyph's coordinates.
///
/// Parts line up with the occurrences of [`crate::composite::GlyphComponents`], so a
/// renderer can draw each occurrence as its own piece.
pub type OutlineParts = Vec<Vec<ResolvedContour>>;

/// Each master's [`OutlineParts`] of a glyph that compiled fonts interpolate
/// decomposed, with the basis that blends them.
#[derive(Clone, Debug)]
pub struct Decomposition {
    basis: Arc<InterpolationBasis>,
    outlines: Vec<OutlineParts>,
}

impl Decomposition {
    /// Returns the basis over the glyph's and its components' masters.
    pub fn basis(&self) -> &InterpolationBasis {
        &self.basis
    }

    /// Returns each basis source's outline parts, in the basis's source order.
    pub fn outlines(&self) -> &[OutlineParts] {
        &self.outlines
    }
}

impl FontProjection<'_> {
    /// Returns `glyph_id`'s outline parts at this projection's location, with
    /// decomposed interpolation where compilers decompose.
    ///
    /// Branches that would revisit a glyph in `visiting` are skipped and add
    /// no part, as in every other composite read.
    pub(super) fn outline_parts(
        &mut self,
        glyph_id: &GlyphId,
        visiting: &mut HashSet<GlyphId>,
        placement: Placement,
    ) -> CoreResult<Option<OutlineParts>> {
        if !self.prepare_layer_tree(glyph_id)? {
            return Ok(None);
        }
        if let Some(parts) = self.decomposed(glyph_id)? {
            return Ok(Some(parts));
        }

        self.composed_parts(glyph_id, visiting, placement)
    }

    /// Places each component's base by this location's component transforms.
    fn composed_parts(
        &mut self,
        glyph_id: &GlyphId,
        visiting: &mut HashSet<GlyphId>,
        placement: Placement,
    ) -> CoreResult<Option<OutlineParts>> {
        if !self.prepare_layer_tree(glyph_id)? {
            return Ok(None);
        }
        let layer = self
            .layers
            .get(glyph_id)
            .expect("prepared glyph layers contain the requested root")
            .clone();
        let own = layer
            .contours_iter()
            .map(|contour| ResolvedContour {
                points: contour.points().iter().map(Point::with_fresh_id).collect(),
                closed: contour.is_closed(),
            })
            .collect::<Vec<_>>();
        let mut parts = vec![own];

        visiting.insert(glyph_id.clone());
        for component in layer.components_iter() {
            let base_glyph_id = component.base_glyph_id();
            if visiting.contains(&base_glyph_id) {
                continue;
            }
            let base = self
                .outline_parts(&base_glyph_id, visiting, placement)?
                .ok_or_else(|| CoreError::UnresolvableComponentGlyph {
                    component_id: component.id(),
                    base_glyph_id: base_glyph_id.clone(),
                })?;
            let transform = component.matrix();
            parts.extend(base.iter().map(|part| {
                part.iter()
                    .map(|contour| placed(contour, transform, placement))
                    .collect()
            }));
        }
        visiting.remove(glyph_id);

        Ok(Some(parts))
    }

    /// Blends the glyph's outline parts at its decomposition masters when this
    /// location lies between them; `None` for a composite glyph or at one of
    /// those masters, where placing components directly is exact.
    fn decomposed(&mut self, glyph_id: &GlyphId) -> CoreResult<Option<OutlineParts>> {
        let font = self.font;
        let Some(basis) = self.decomposition_basis(glyph_id)? else {
            return Ok(None);
        };
        if at_a_source(font, &basis, &self.location) {
            return Ok(None);
        }
        let Some(outlines) = font.decomposition_outlines(glyph_id, &basis)? else {
            return Ok(None);
        };

        let weights = basis.weights_at(&self.location, font.axes())?;
        Ok(blend(&outlines, &weights))
    }
}

impl FontProjection<'_> {
    /// Returns the glyph's decomposition basis, read once per glyph.
    fn decomposition_basis(
        &mut self,
        glyph_id: &GlyphId,
    ) -> CoreResult<Option<Arc<InterpolationBasis>>> {
        if let Some(basis) = self.decompositions.get(glyph_id) {
            return Ok(basis.clone());
        }
        let has_components = self
            .layers
            .get(glyph_id)
            .is_some_and(|layer| layer.components_iter().next().is_some());
        let basis = match has_components {
            true => self
                .font
                .glyph_layer_projection_with_bases(glyph_id, &mut self.interpolation_bases)?
                .and_then(|projection| projection.decomposition.clone()),
            false => None,
        };
        self.decompositions.insert(glyph_id.clone(), basis.clone());
        Ok(basis)
    }
}

fn at_a_source(font: &Font, basis: &InterpolationBasis, location: &DesignLocation) -> bool {
    basis.source_ids().iter().any(|source_id| {
        font.source(source_id)
            .is_some_and(|source| source.location().is_equivalent_to(location, font.axes()))
    })
}

impl Font {
    /// Returns each master's outline parts of `glyph_id` when compiled fonts
    /// interpolate it decomposed; see [`crate::GlyphProjection::decomposition`].
    ///
    /// Between those masters, the glyph's outline is the basis's weighted sum
    /// of these outlines.
    ///
    /// `None` for a glyph compilers keep composite, or when the masters'
    /// outlines don't line up point for point.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::GlyphNotFound`] for an unknown glyph, or a
    /// resolution error from a component.
    pub fn decomposition(&self, glyph_id: &GlyphId) -> CoreResult<Option<Decomposition>> {
        self.require_glyph(glyph_id)?;
        let Some(projection) =
            self.glyph_layer_projection_with_bases(glyph_id, &mut HashMap::new())?
        else {
            return Ok(None);
        };
        let Some(basis) = projection.decomposition.clone() else {
            return Ok(None);
        };
        let Some(outlines) = self.decomposition_outlines(glyph_id, &basis)? else {
            return Ok(None);
        };
        Ok(Some(Decomposition { basis, outlines }))
    }

    /// Places the glyph's components at each basis master, as compilers
    /// sample a decomposed glyph.
    fn decomposition_outlines(
        &self,
        glyph_id: &GlyphId,
        basis: &InterpolationBasis,
    ) -> CoreResult<Option<Vec<OutlineParts>>> {
        let mut outlines = Vec::with_capacity(basis.source_ids().len());
        for source_id in basis.source_ids() {
            let location = self.require_source(source_id)?.location();
            let Some(parts) = self.projection(location).composed_parts(
                glyph_id,
                &mut HashSet::new(),
                Placement::Decomposed,
            )?
            else {
                return Ok(None);
            };
            outlines.push(parts);
        }
        let Some((first, rest)) = outlines.split_first() else {
            return Ok(None);
        };
        let lines_up = rest.iter().all(|parts| same_structure(parts, first));
        Ok(lines_up.then_some(outlines))
    }

    /// Returns the decomposition basis for `glyph`, or `None` when its
    /// components keep their scale, rotation, and skew across its masters.
    pub(super) fn decomposition_basis(
        &self,
        glyph: &Glyph,
        interpolation: &GlyphInterpolation,
        interpolation_bases: &mut HashMap<Vec<SourceId>, Arc<InterpolationBasis>>,
    ) -> CoreResult<Option<Arc<InterpolationBasis>>> {
        let source_ids = interpolation.basis().source_ids();
        if source_ids.len() < 2 {
            return Ok(None);
        }
        let mut layers = Vec::with_capacity(source_ids.len());
        for source_id in source_ids {
            let Some(layer) = glyph.layer_for_source(source_id) else {
                return Ok(None);
            };
            layers.push(layer);
        }
        if !linear_parts_vary(layers.into_iter()) {
            return Ok(None);
        }

        let mut masters = source_ids.iter().cloned().collect::<HashSet<_>>();
        let mut visited = HashSet::from([glyph.id()]);
        let mut pending = glyph.component_glyph_ids().collect::<Vec<_>>();
        while let Some(component_id) = pending.pop() {
            if !visited.insert(component_id.clone()) {
                continue;
            }
            let Some(component) = self.glyph(&component_id) else {
                continue;
            };
            if let Some(component_interpolation) =
                self.glyph_interpolation_with_bases(&component_id, interpolation_bases)?
            {
                masters.extend(component_interpolation.basis().source_ids().iter().cloned());
            }
            pending.extend(component.component_glyph_ids());
        }

        let locations = self
            .masters()
            .filter(|source| masters.contains(&source.id()))
            .map(|source| (source.id(), source.location().clone()))
            .collect::<Vec<_>>();
        let key = locations
            .iter()
            .map(|(source_id, _)| source_id.clone())
            .collect::<Vec<_>>();
        if let Some(basis) = interpolation_bases.get(&key) {
            return Ok(Some(basis.clone()));
        }
        let Some(basis) = InterpolationBasis::from_source_locations(
            &locations,
            self.axes(),
            self.design_normalization()?,
        ) else {
            return Ok(None);
        };
        let basis = Arc::new(basis);
        interpolation_bases.insert(key, basis.clone());
        Ok(Some(basis))
    }
}

fn same_structure(a: &OutlineParts, b: &OutlineParts) -> bool {
    a.len() == b.len()
        && a.iter()
            .zip(b)
            .all(|(a, b)| contour_shapes(a) == contour_shapes(b))
}

fn contour_shapes(contours: &[ResolvedContour]) -> Vec<ContourShape> {
    contours
        .iter()
        .map(|contour| ContourShape {
            point_count: contour.points.len(),
            closed: contour.closed,
        })
        .collect()
}

/// Whether any direct component's scale, rotation, or skew differs between
/// the layers, compared by component position.
fn linear_parts_vary<'a>(mut layers: impl Iterator<Item = &'a GlyphLayer>) -> bool {
    let Some(first) = layers.next() else {
        return false;
    };
    let linear = |layer: &GlyphLayer| {
        layer
            .components_iter()
            .map(|component| {
                let m = component.matrix();
                [m.xx, m.xy, m.yx, m.yy]
            })
            .collect::<Vec<_>>()
    };
    let reference = linear(first);
    if reference.is_empty() {
        return false;
    }
    layers.any(|layer| {
        let other = linear(layer);
        other.len() == reference.len()
            && other
                .iter()
                .zip(&reference)
                .any(|(a, b)| a.iter().zip(b).any(|(x, y)| (x - y).abs() > 1e-9))
    })
}

/// Weighted sum of outline parts with the same structure, or `None` when
/// their part, contour, or point counts differ.
fn blend(outlines: &[OutlineParts], weights: &[f64]) -> Option<OutlineParts> {
    let (first, rest) = outlines.split_first()?;
    let lines_up = rest.iter().all(|outline| same_structure(outline, first));
    if !lines_up || weights.len() != outlines.len() {
        return None;
    }

    let blended_point = |part: usize, contour: usize, index: usize, point: &Point| {
        let blended =
            outlines
                .iter()
                .zip(weights)
                .fold(kurbo::Vec2::ZERO, |sum, (outline, weight)| {
                    let source = &outline[part][contour].points[index];
                    sum + *weight * source.position().to_vec2()
                });
        point.copied_to(blended.to_point())
    };
    let blended_contour = |part: usize, contour: usize, first: &ResolvedContour| ResolvedContour {
        points: first
            .points
            .iter()
            .enumerate()
            .map(|(index, point)| blended_point(part, contour, index, point))
            .collect(),
        closed: first.closed,
    };

    Some(
        first
            .iter()
            .enumerate()
            .map(|(part, contours)| {
                contours
                    .iter()
                    .enumerate()
                    .map(|(contour, first)| blended_contour(part, contour, first))
                    .collect()
            })
            .collect(),
    )
}

/// How component contours are placed in a glyph's outline.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum Placement {
    /// As a composite glyph draws them.
    Composed,
    /// As a compiler decomposes them: a mirrored placement reverses each
    /// closed contour, keeping its start point, so the contour keeps its
    /// direction. The reversal decides which points blend between masters.
    Decomposed,
}

fn placed(
    contour: &ResolvedContour,
    transform: Transform,
    placement: Placement,
) -> ResolvedContour {
    let shape = ContourShape {
        point_count: contour.points.len(),
        closed: contour.closed,
    };
    let reversing = placement == Placement::Decomposed && mirrors(&transform);
    let points = (0..shape.point_count)
        .filter_map(|index| {
            contour
                .points
                .get(placed_point_index(index, shape, reversing))
        })
        .map(|point| point.copied_to(transform.transform_point(point.position())))
        .collect();
    ResolvedContour {
        points,
        closed: contour.closed,
    }
}
