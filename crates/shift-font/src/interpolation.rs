//! Native glyph interpolation over Shift sources and internal locations.

use std::collections::{hash_map::Entry, HashMap, HashSet};
use std::str::FromStr;

use fontdrasil::coords::{NormalizedCoord, NormalizedLocation};
use fontdrasil::types::Tag;
use fontdrasil::variations::{RoundingBehaviour, VariationModel};

use crate::{Axis, AxisId, CoreError, CoreResult, Font, GlyphId, GlyphLayer, Location, SourceId};

mod compatibility;
mod metrics;
mod values;

pub use compatibility::{LayerCompatibility, LayerDifference};
pub use metrics::{
    ResolvedSourceMetrics, SourceMetricField, SourceMetricInterpolation, SourceMetricValues,
};
pub use values::GlyphInterpolationValues;

/// Normalized support for one authoring axis within an interpolation region.
#[derive(Clone, Debug, PartialEq)]
pub struct AxisSupport {
    axis_id: AxisId,
    minimum: f64,
    peak: f64,
    maximum: f64,
}

impl AxisSupport {
    /// Returns the stable authoring-axis identity for this support.
    pub fn axis_id(&self) -> AxisId {
        self.axis_id.clone()
    }

    /// Returns the normalized lower support boundary.
    pub fn minimum(&self) -> f64 {
        self.minimum
    }

    /// Returns the normalized peak at which this support contributes fully.
    pub fn peak(&self) -> f64 {
        self.peak
    }

    /// Returns the normalized upper support boundary.
    pub fn maximum(&self) -> f64 {
        self.maximum
    }
}

/// Multi-axis support associated with one interpolation coefficient row.
#[derive(Clone, Debug, PartialEq)]
pub struct InterpolationRegion {
    supports: Vec<AxisSupport>,
}

impl InterpolationRegion {
    /// Returns the axis supports whose scalars are multiplied for this region.
    pub fn supports(&self) -> &[AxisSupport] {
        &self.supports
    }
}

/// Coordinate-independent interpolation weights for an ordered source set.
///
/// The basis depends only on source locations and authoring axes. Its
/// coefficients contain no glyph coordinates or metric values, so renderers
/// can combine it with live source-value signals without rebuilding native
/// variation data after ordinary numeric edits.
#[derive(Clone, Debug, PartialEq)]
pub struct InterpolationBasis {
    source_ids: Vec<SourceId>,
    regions: Vec<InterpolationRegion>,
    coefficients: Vec<Vec<f64>>,
}

impl InterpolationBasis {
    /// Builds a basis from ordered authored source locations.
    ///
    /// This constructor is value-agnostic: glyph coordinates, metrics, and
    /// other interpolated domains remain separate source vectors.
    pub(crate) fn from_source_locations(
        sources: &[(SourceId, Location)],
        axes: &[Axis],
    ) -> Option<Self> {
        let normalized_sources = sources
            .iter()
            .map(|(source_id, location)| (source_id.clone(), normalized_location(location, axes)))
            .collect::<Vec<_>>();

        interpolation_basis(&normalized_sources, axes)
    }

    /// Returns source identities in the order used by coefficient rows and weights.
    pub fn source_ids(&self) -> &[SourceId] {
        &self.source_ids
    }

    /// Returns the normalized support regions evaluated at each location.
    pub fn regions(&self) -> &[InterpolationRegion] {
        &self.regions
    }

    /// Returns one source-coefficient row for each interpolation region.
    pub fn coefficients(&self) -> &[Vec<f64>] {
        &self.coefficients
    }

    /// Evaluates one scalar weight per source at an internal location.
    ///
    /// The returned weights are ordered like [`Self::source_ids`]. Missing
    /// axis coordinates use authoring defaults.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::AxisNotFound`] when `axes` omits an axis referenced
    /// by an interpolation region.
    pub fn weights_at(&self, location: &Location, axes: &[Axis]) -> CoreResult<Vec<f64>> {
        let mut weights = vec![0.0; self.source_ids.len()];
        for (region, coefficients) in self.regions.iter().zip(&self.coefficients) {
            let scalar = region_scalar(region, location, axes)?;
            if scalar == 0.0 {
                continue;
            }

            for (weight, coefficient) in weights.iter_mut().zip(coefficients) {
                *weight += scalar * coefficient;
            }
        }

        Ok(weights)
    }
}

/// Initial numeric glyph values associated with one compatible source.
#[derive(Clone, Debug, PartialEq)]
pub struct GlyphInterpolationSource {
    source_id: SourceId,
    values: GlyphInterpolationValues,
}

impl GlyphInterpolationSource {
    /// Returns the stable identity of the compatible authored source.
    pub fn source_id(&self) -> SourceId {
        self.source_id.clone()
    }

    /// Returns the source's initial structure-ordered numeric values.
    pub fn values(&self) -> &GlyphInterpolationValues {
        &self.values
    }
}

/// Reusable interpolation for one glyph's compatible authored source layers.
#[derive(Clone, Debug, PartialEq)]
pub struct GlyphInterpolation {
    reference_layer: GlyphLayer,
    basis: InterpolationBasis,
    sources: Vec<GlyphInterpolationSource>,
}

impl GlyphInterpolation {
    /// Returns the master-backed layer that defines compatible topology.
    pub fn reference_layer(&self) -> &GlyphLayer {
        &self.reference_layer
    }

    /// Returns the coordinate-independent source contribution basis.
    pub fn basis(&self) -> &InterpolationBasis {
        &self.basis
    }

    /// Returns initial values aligned with [`InterpolationBasis::source_ids`].
    pub fn sources(&self) -> &[GlyphInterpolationSource] {
        &self.sources
    }

    /// Resolves an owned glyph layer at an internal authoring location.
    ///
    /// Missing axis coordinates use authoring defaults. The returned layer
    /// preserves the reference layer's topology and identities but is a derived
    /// value; mutating it does not change the font.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::AxisNotFound`] if `axes` does not contain every
    /// support axis, or a glyph-value shape error if the interpolation model
    /// and its structural reference layer are inconsistent.
    pub fn resolve(&self, location: &Location, axes: &[Axis]) -> CoreResult<GlyphLayer> {
        let mut layer = self.reference_layer.clone();
        let values = self.values_at(location, axes)?;
        layer.apply_interpolation_values(&values)?;
        Ok(layer)
    }

    fn values_at(
        &self,
        location: &Location,
        axes: &[Axis],
    ) -> CoreResult<GlyphInterpolationValues> {
        let value_count = self
            .sources
            .first()
            .map_or(0, |source| source.values.as_slice().len());
        let mut values = vec![0.0; value_count];
        let weights = self.basis.weights_at(location, axes)?;

        for (source, weight) in self.sources.iter().zip(weights) {
            if weight == 0.0 {
                continue;
            }

            for (value, source_value) in values.iter_mut().zip(source.values.as_slice()) {
                *value += weight * source_value;
            }
        }

        Ok(GlyphInterpolationValues::new(values))
    }
}

impl Font {
    /// Builds interpolation for one glyph from compatible authored sources.
    ///
    /// The font default source defines topology when that glyph has a layer
    /// there. Otherwise the most structurally complete master-backed layer is
    /// the reference, allowing sparse glyphs to interpolate without inventing
    /// a default-source layer. Incompatible master layers are ignored. `None`
    /// means the font is static or no viable model can be formed; callers may
    /// then use their documented source fallback.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::GlyphNotFound`] when `glyph_id` is not in the font.
    pub fn glyph_interpolation(
        &self,
        glyph_id: &GlyphId,
    ) -> CoreResult<Option<GlyphInterpolation>> {
        let glyph = self
            .glyph(glyph_id.clone())
            .ok_or_else(|| CoreError::GlyphNotFound(glyph_id.clone()))?;
        if !self.is_variable() {
            return Ok(None);
        }

        let Some(reference_layer) = interpolation_reference_layer(self, glyph) else {
            return Ok(None);
        };

        let mut compatible_sources = Vec::new();

        for source in self.sources().iter().filter(|source| source.is_master()) {
            let Some(layer) = glyph.layer_for_source(source.id()) else {
                continue;
            };
            if !reference_layer
                .interpolation_compatibility_with(layer)
                .is_compatible()
            {
                continue;
            }

            compatible_sources.push((
                source.id(),
                source.location().clone(),
                layer.interpolation_values(),
            ));
        }

        let Some(basis) = InterpolationBasis::from_source_locations(
            &compatible_sources
                .iter()
                .map(|(source_id, location, _)| (source_id.clone(), location.clone()))
                .collect::<Vec<_>>(),
            self.axes(),
        ) else {
            return Ok(None);
        };
        let sources = compatible_sources
            .into_iter()
            .map(|(source_id, _, values)| GlyphInterpolationSource { source_id, values })
            .collect();

        Ok(Some(GlyphInterpolation {
            reference_layer: reference_layer.clone(),
            basis,
            sources,
        }))
    }
}

fn interpolation_reference_layer<'a>(
    font: &Font,
    glyph: &'a crate::Glyph,
) -> Option<&'a GlyphLayer> {
    if let Some(default_source_id) = font.default_source_id() {
        let default_is_master = font
            .sources()
            .iter()
            .find(|source| source.id() == default_source_id)
            .is_some_and(crate::Source::is_master);
        if default_is_master {
            if let Some(layer) = glyph.layer_for_source(default_source_id) {
                return Some(layer);
            }
        }
    }

    font.sources()
        .iter()
        .filter(|source| source.is_master())
        .filter_map(|source| glyph.layer_for_source(source.id()))
        .reduce(|preferred, candidate| {
            if layer_complexity(candidate) > layer_complexity(preferred) {
                candidate
            } else {
                preferred
            }
        })
}

fn layer_complexity(layer: &GlyphLayer) -> usize {
    layer.contours().len() + layer.components().len()
}

fn interpolation_basis(
    sources: &[(SourceId, NormalizedLocation)],
    axes: &[Axis],
) -> Option<InterpolationBasis> {
    if sources.is_empty() {
        return None;
    }

    let tagged_axes = axes
        .iter()
        .filter_map(|axis| Tag::from_str(axis.tag()).ok().map(|tag| (tag, axis.id())))
        .collect::<Vec<_>>();
    let ordered_axes = tagged_axes.iter().map(|(tag, _)| *tag).collect();
    let axis_ids_by_tag = tagged_axes.into_iter().collect::<HashMap<_, _>>();
    let mut points = HashMap::new();
    for (index, (_, location)) in sources.iter().enumerate() {
        let mut unit = vec![0.0; sources.len()];
        unit[index] = 1.0;
        if points.insert(location.clone(), unit).is_some() {
            return None;
        }
    }
    let default_location = normalized_location(&Location::new(), axes);
    if let Entry::Vacant(entry) = points.entry(default_location) {
        entry.insert(virtual_default_coefficients(sources)?);
    }
    let model = VariationModel::new(
        points
            .keys()
            .cloned()
            .collect::<HashSet<NormalizedLocation>>(),
        ordered_axes,
    );
    let model_coefficients = model
        .deltas_with_rounding::<f64, f64>(&points, RoundingBehaviour::None)
        .ok()?;
    let regions = model_coefficients
        .iter()
        .map(|(region, _)| InterpolationRegion {
            supports: region
                .iter()
                .filter_map(|(tag, support)| {
                    let axis_id = axis_ids_by_tag.get(tag)?;
                    Some(AxisSupport {
                        axis_id: axis_id.clone(),
                        minimum: support.min.into_inner().into_inner(),
                        peak: support.peak.into_inner().into_inner(),
                        maximum: support.max.into_inner().into_inner(),
                    })
                })
                .collect(),
        })
        .collect();
    let coefficients = model_coefficients
        .into_iter()
        .map(|(_, coefficients)| coefficients)
        .collect();

    Some(InterpolationBasis {
        source_ids: sources
            .iter()
            .map(|(source_id, _)| source_id.clone())
            .collect(),
        regions,
        coefficients,
    })
}

/// Derives a virtual default only when two masters bracket it on one axis.
///
/// OpenType's variation model requires a value at the normalized origin. A
/// sparse glyph may omit the font's default master while still providing a
/// well-defined one-axis interpolation on opposite sides of it. More complex
/// sparse layouts remain nonviable and use the caller's static master fallback.
fn virtual_default_coefficients(sources: &[(SourceId, NormalizedLocation)]) -> Option<Vec<f64>> {
    let mut negative: Option<(usize, Tag, f64)> = None;
    let mut positive: Option<(usize, Tag, f64)> = None;

    for (index, (_, location)) in sources.iter().enumerate() {
        let nonzero = location
            .iter()
            .filter_map(|(tag, coordinate)| {
                let value = coordinate.to_f64();
                (value != 0.0).then_some((*tag, value))
            })
            .collect::<Vec<_>>();
        let [(tag, value)] = nonzero.as_slice() else {
            continue;
        };

        if *value < 0.0
            && negative
                .as_ref()
                .is_none_or(|(_, _, current)| *value > *current)
        {
            negative = Some((index, *tag, *value));
        }
        if *value > 0.0
            && positive
                .as_ref()
                .is_none_or(|(_, _, current)| *value < *current)
        {
            positive = Some((index, *tag, *value));
        }
    }

    let (negative_index, negative_axis, negative_value) = negative?;
    let (positive_index, positive_axis, positive_value) = positive?;
    if negative_axis != positive_axis {
        return None;
    }

    let span = positive_value - negative_value;
    let mut coefficients = vec![0.0; sources.len()];
    coefficients[negative_index] = positive_value / span;
    coefficients[positive_index] = -negative_value / span;
    Some(coefficients)
}

fn normalized_location(location: &Location, axes: &[Axis]) -> NormalizedLocation {
    axes.iter()
        .filter_map(|axis| {
            let tag = Tag::from_str(axis.tag()).ok()?;
            let value = location.get(&axis.id()).unwrap_or(axis.default());
            Some((tag, NormalizedCoord::new(axis.normalize(value))))
        })
        .collect()
}

fn region_scalar(
    region: &InterpolationRegion,
    location: &Location,
    axes: &[Axis],
) -> CoreResult<f64> {
    let mut scalar = 1.0;

    for support in region.supports() {
        if support.minimum > support.peak
            || support.peak > support.maximum
            || (support.minimum < 0.0 && support.maximum > 0.0)
        {
            continue;
        }

        let axis = axes
            .iter()
            .find(|axis| axis.id() == support.axis_id)
            .ok_or_else(|| CoreError::AxisNotFound(support.axis_id.clone()))?;
        let value = location.get(&axis.id()).unwrap_or(axis.default());
        let normalized = axis.normalize(value);

        if normalized == support.peak
            || (support.minimum == 0.0 && support.peak == 0.0 && support.maximum == 0.0)
        {
            continue;
        }

        if normalized <= support.minimum || support.maximum <= normalized {
            return Ok(0.0);
        }

        let edge = if normalized < support.peak {
            support.minimum
        } else {
            support.maximum
        };
        scalar *= (normalized - edge) / (support.peak - edge);
    }

    Ok(scalar)
}

#[cfg(test)]
mod tests {
    use crate::test_support::sample_variable_font;
    use crate::{GlyphInterpolationValues, Location};

    #[test]
    fn layer_values_roundtrip_without_changing_topology() {
        let font = sample_variable_font();
        let glyph = font.glyph_by_name("A").unwrap();
        let layer = glyph
            .layer_for_source(font.default_source_id().unwrap())
            .unwrap();
        let mut restored = layer.clone();

        restored
            .apply_interpolation_values(&GlyphInterpolationValues::from_layer(layer))
            .unwrap();

        assert_eq!(restored, *layer);
    }

    #[test]
    fn applying_invalid_values_does_not_partially_mutate_a_layer() {
        let font = sample_variable_font();
        let layer = font
            .glyph_by_name("A")
            .unwrap()
            .layer_for_source(font.default_source_id().unwrap())
            .unwrap();
        let mut restored = layer.clone();

        let error = restored
            .apply_interpolation_values(&GlyphInterpolationValues::new(vec![123.0]))
            .unwrap_err();

        assert!(matches!(error, crate::CoreError::MissingGlyphValue { .. }));
        assert_eq!(restored, *layer);
    }

    #[test]
    fn applying_non_finite_values_does_not_partially_mutate_a_layer() {
        let font = sample_variable_font();
        let layer = font
            .glyph_by_name("A")
            .unwrap()
            .layer_for_source(font.default_source_id().unwrap())
            .unwrap();
        let mut restored = layer.clone();
        let mut values = GlyphInterpolationValues::from_layer(layer).into_vec();
        values[0] = f64::NAN;

        let error = restored
            .apply_interpolation_values(&GlyphInterpolationValues::new(values))
            .unwrap_err();

        assert!(matches!(
            error,
            crate::CoreError::InvalidPositionUpdateInput { .. }
        ));
        assert_eq!(restored, *layer);
    }

    #[test]
    fn smooth_metadata_does_not_make_layers_incompatible() {
        let font = sample_variable_font();
        let glyph = font.glyph_by_name("A").unwrap();
        let reference_layer = glyph
            .layer_for_source(font.default_source_id().unwrap())
            .unwrap();
        let mut candidate = reference_layer.clone();
        let point = candidate
            .contours_iter_mut()
            .next()
            .unwrap()
            .points_mut()
            .first_mut()
            .unwrap();
        point.set_smooth(!point.is_smooth());

        assert!(reference_layer
            .interpolation_compatibility_with(&candidate)
            .is_compatible());
    }

    #[test]
    fn glyph_interpolation_resolves_intermediate_outline_and_advance() {
        let font = sample_variable_font();
        let glyph = font.glyph_by_name("A").unwrap();
        let axis_id = font.axes()[0].id();
        let mut location = Location::new();
        location.set(axis_id, 600.0);

        let layer = font
            .glyph_interpolation(&glyph.id())
            .unwrap()
            .unwrap()
            .resolve(&location, font.axes())
            .unwrap();

        assert_eq!(layer.width(), 700.0);
        assert_eq!(layer.contours_iter().next().unwrap().points()[1].x(), 340.0);
    }

    #[test]
    fn interpolation_basis_recovers_each_authored_source() {
        let font = sample_variable_font();
        let glyph = font.glyph_by_name("A").unwrap();
        let interpolation = font.glyph_interpolation(&glyph.id()).unwrap().unwrap();

        for (expected_index, source_id) in interpolation.basis().source_ids().iter().enumerate() {
            let source = font
                .sources()
                .iter()
                .find(|source| source.id() == *source_id)
                .unwrap();
            let weights = interpolation
                .basis()
                .weights_at(source.location(), font.axes())
                .unwrap();

            for (source_index, weight) in weights.into_iter().enumerate() {
                let expected = if source_index == expected_index {
                    1.0
                } else {
                    0.0
                };
                assert!((weight - expected).abs() < 1e-9);
            }
        }
    }

    #[test]
    fn glyph_interpolation_rejects_missing_axis_definitions() {
        let font = sample_variable_font();
        let glyph = font.glyph_by_name("A").unwrap();
        let interpolation = font.glyph_interpolation(&glyph.id()).unwrap().unwrap();

        let error = interpolation.resolve(&Location::new(), &[]).unwrap_err();

        assert!(matches!(error, crate::CoreError::AxisNotFound(_)));
    }
}
