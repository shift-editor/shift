//! Native glyph interpolation over Shift sources and internal locations.

use crate::Require;
use std::collections::{hash_map::Entry, HashMap, HashSet};
use std::str::FromStr;
use std::sync::Arc;

use fontdrasil::coords::{NormalizedCoord, NormalizedLocation};
use fontdrasil::types::Tag;
use fontdrasil::variations::{
    RoundingBehaviour, VariationModel, VariationRegion as FontdrasilVariationRegion,
};

use crate::{
    Axis, AxisId, CoreResult, DesignLocation, DesignNormalization, Font, Glyph, GlyphId,
    GlyphLayer, LayerId, Location, SourceId,
};

mod kerning;
mod layer_match;
mod metrics;
mod values;

pub use layer_match::{LayerDifference, LayerMatch};
pub use metrics::{
    ResolvedSourceMetrics, SourceMetricField, SourceMetricInterpolation, SourceMetricValues,
    SOURCE_METRIC_OVERSHOOT_OFFSET, SOURCE_METRIC_POSITION_OFFSET, SOURCE_METRIC_VALUE_COUNT,
    SOURCE_TECHNICAL_FIELD_VALUE_COUNT,
};
pub use values::{
    GlyphInterpolationValues, GLYPH_ADVANCE_VALUE_COUNT, GLYPH_ADVANCE_VALUE_OFFSET,
    GLYPH_ANCHOR_VALUE_COUNT, GLYPH_POINT_VALUE_COUNT, GLYPH_POSITION_VALUE_FIELDS,
};

/// Normalized support for one authoring axis within an interpolation region.
#[derive(Clone, Debug, PartialEq)]
pub struct AxisSupport {
    axis_id: AxisId,
    minimum: f64,
    peak: f64,
    maximum: f64,
}

impl AxisSupport {
    /// Rebuilds a support compiled elsewhere, such as one the editor received.
    pub fn new(axis_id: AxisId, minimum: f64, peak: f64, maximum: f64) -> Self {
        Self {
            axis_id,
            minimum,
            peak,
            maximum,
        }
    }

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
    pub fn new(supports: Vec<AxisSupport>) -> Self {
        Self { supports }
    }

    /// Returns the axis supports whose scalars are multiplied for this region.
    pub fn supports(&self) -> &[AxisSupport] {
        &self.supports
    }
}

/// One coordinate-independent contribution produced by Fontdrasil.
#[derive(Clone, Debug, PartialEq)]
pub struct VariationDelta {
    region: InterpolationRegion,
    values: Vec<f64>,
}

impl VariationDelta {
    pub fn new(region: InterpolationRegion, values: Vec<f64>) -> Self {
        Self { region, values }
    }

    /// Returns the normalized support region for this contribution.
    pub fn region(&self) -> &InterpolationRegion {
        &self.region
    }

    /// Returns the numeric contribution vector evaluated within the region.
    pub fn values(&self) -> &[f64] {
        &self.values
    }
}

/// Coordinate-independent variation supports and numeric contributions.
///
/// Fontdrasil constructs this basis. Consumers may evaluate it at a
/// normalized location, and rebuild one received from Rust with [`Self::new`],
/// but never derive its sample ordering or regions themselves.
#[derive(Clone, Debug, PartialEq)]
pub struct VariationBasis {
    deltas: Vec<VariationDelta>,
}

impl VariationBasis {
    pub(crate) fn from_fontdrasil(
        deltas: Vec<(FontdrasilVariationRegion, Vec<f64>)>,
        axis_ids_by_tag: &HashMap<Tag, AxisId>,
    ) -> Self {
        Self {
            deltas: deltas
                .into_iter()
                .map(|(region, values)| VariationDelta {
                    region: InterpolationRegion {
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
                    },
                    values,
                })
                .collect(),
        }
    }

    /// Rebuilds a basis Fontdrasil compiled, from its deltas in order.
    pub fn new(deltas: Vec<VariationDelta>) -> Self {
        Self { deltas }
    }

    /// Returns the ordered support contributions produced by Fontdrasil.
    pub fn deltas(&self) -> &[VariationDelta] {
        &self.deltas
    }

    /// Sums each delta scaled by its region's scalar at `location`.
    ///
    /// Locations are normalized with `design_normalization` when given, else
    /// by each axis's own range; a missing coordinate is that axis's default.
    ///
    /// # Errors
    ///
    /// Returns [`crate::CoreError::AxisNotFound`] when a region names an axis
    /// missing from `axes` or from `design_normalization`.
    pub fn evaluate(
        &self,
        location: &Location,
        axes: &[Axis],
        design_normalization: Option<&[DesignNormalization]>,
    ) -> CoreResult<Vec<f64>> {
        let value_count = self
            .deltas
            .first()
            .map(|delta| delta.values.len())
            .unwrap_or(0);
        let mut values = vec![0.0; value_count];

        for delta in &self.deltas {
            let scalar = region_scalar(&delta.region, location, axes, design_normalization)?;
            if scalar == 0.0 {
                continue;
            }

            for (value, contribution) in values.iter_mut().zip(&delta.values) {
                *value += scalar * contribution;
            }
        }

        Ok(values)
    }
}

/// Coordinate-independent interpolation weights for an ordered source set.
///
/// The basis depends only on source locations and authoring axes. Its numeric
/// contributions contain no glyph coordinates or metric values, so renderers
/// can combine it with live source-value signals without rebuilding native
/// variation data after ordinary numeric edits.
#[derive(Clone, Debug, PartialEq)]
pub struct InterpolationBasis {
    source_ids: Vec<SourceId>,
    basis: VariationBasis,
    design_normalization: Vec<DesignNormalization>,
}

impl InterpolationBasis {
    /// Rebuilds a basis compiled elsewhere, such as one the editor received.
    pub fn new(
        source_ids: Vec<SourceId>,
        basis: VariationBasis,
        design_normalization: Vec<DesignNormalization>,
    ) -> Self {
        Self {
            source_ids,
            basis,
            design_normalization,
        }
    }

    /// Builds a basis from ordered authored source locations.
    ///
    /// This constructor is value-agnostic: glyph coordinates, metrics, and
    /// other interpolated domains remain separate source vectors.
    pub(crate) fn from_source_locations(
        sources: &[(SourceId, DesignLocation)],
        axes: &[Axis],
        design_normalization: Vec<DesignNormalization>,
    ) -> Option<Self> {
        let normalized_sources = sources
            .iter()
            .map(|(source_id, location)| {
                (
                    source_id.clone(),
                    normalized_location(location, axes, &design_normalization),
                )
            })
            .collect::<Vec<_>>();

        interpolation_basis(&normalized_sources, axes, design_normalization)
    }

    /// Returns source identities in the order used by coefficient rows and weights.
    pub fn source_ids(&self) -> &[SourceId] {
        &self.source_ids
    }

    /// Returns the Fontdrasil-compiled source-weight basis.
    pub fn variation_basis(&self) -> &VariationBasis {
        &self.basis
    }

    /// Returns the design-space bounds used to compile and evaluate this basis.
    pub fn design_normalization(&self) -> &[DesignNormalization] {
        &self.design_normalization
    }

    /// Evaluates one scalar weight per source at an internal location.
    ///
    /// The returned weights are ordered like [`Self::source_ids`]. Missing
    /// axis coordinates use mapped design defaults. `axes` supplies axis identity;
    /// normalization always uses the design-space bounds retained by this basis.
    ///
    /// # Errors
    ///
    /// Returns [`crate::CoreError::AxisNotFound`] when `axes` omits an axis referenced
    /// by an interpolation region.
    pub fn weights_at(&self, location: &DesignLocation, axes: &[Axis]) -> CoreResult<Vec<f64>> {
        self.basis.evaluate(
            location.as_untyped(),
            axes,
            Some(&self.design_normalization),
        )
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
    reference_layer: Arc<GlyphLayer>,
    basis: Arc<InterpolationBasis>,
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
    /// Returns [`crate::CoreError::AxisNotFound`] if `axes` does not contain every
    /// support axis, or a glyph-value shape error if the interpolation model
    /// and its structural reference layer are inconsistent.
    pub fn resolve(&self, location: &DesignLocation, axes: &[Axis]) -> CoreResult<GlyphLayer> {
        let mut layer = self.reference_layer.as_ref().clone();
        let values = self.values_at(location, axes)?;
        layer.apply_interpolation_values(&values)?;
        Ok(layer)
    }

    fn values_at(
        &self,
        location: &DesignLocation,
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
    /// Returns [`crate::CoreError::GlyphNotFound`] when `glyph_id` is not in the font.
    pub fn glyph_interpolation(
        &self,
        glyph_id: &GlyphId,
    ) -> CoreResult<Option<GlyphInterpolation>> {
        self.glyph_interpolation_with_bases(glyph_id, &mut HashMap::new())
    }

    pub(crate) fn glyph_interpolation_with_bases(
        &self,
        glyph_id: &GlyphId,
        bases: &mut HashMap<Vec<SourceId>, Arc<InterpolationBasis>>,
    ) -> CoreResult<Option<GlyphInterpolation>> {
        let glyph = self.require_glyph(glyph_id)?;
        if !self.is_variable() {
            return Ok(None);
        }

        let Some(reference_layer) = interpolation_reference_layer(self, glyph) else {
            return Ok(None);
        };

        let mut compatible_sources = Vec::new();

        for source in self.masters() {
            let Some(layer) = glyph.layer_for_source(source.id()) else {
                continue;
            };
            if !reference_layer.match_with(layer).is_complete() {
                continue;
            }

            compatible_sources.push((
                source.id(),
                source.location().clone(),
                layer.interpolation_values(),
            ));
        }

        let source_locations = compatible_sources
            .iter()
            .map(|(source_id, location, _)| (source_id.clone(), location.clone()))
            .collect::<Vec<_>>();
        let basis_key = source_locations
            .iter()
            .map(|(source_id, _)| source_id.clone())
            .collect::<Vec<_>>();
        let basis = if let Some(basis) = bases.get(&basis_key) {
            basis.clone()
        } else {
            let Some(basis) = InterpolationBasis::from_source_locations(
                &source_locations,
                self.axes(),
                self.design_normalization()?,
            ) else {
                return Ok(None);
            };
            let basis = Arc::new(basis);
            bases.insert(basis_key, basis.clone());
            basis
        };
        let sources = compatible_sources
            .into_iter()
            .map(|(source_id, _, values)| GlyphInterpolationSource { source_id, values })
            .collect();

        Ok(Some(GlyphInterpolation {
            reference_layer,
            basis,
            sources,
        }))
    }
}

fn interpolation_reference_layer(font: &Font, glyph: &crate::Glyph) -> Option<Arc<GlyphLayer>> {
    if let Some(default_source_id) = font.default_source_id() {
        let default_is_master = font
            .source(&default_source_id)
            .is_some_and(crate::Source::is_master);
        if default_is_master {
            if let Some(layer) = glyph
                .layers()
                .values()
                .find(|layer| layer.is_at_source(&default_source_id))
            {
                return Some(layer.clone());
            }
        }
    }

    font.master_layers(glyph)
        .cloned()
        .reduce(|preferred, candidate| {
            if layer_complexity(&candidate) > layer_complexity(&preferred) {
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
    design_normalization: Vec<DesignNormalization>,
) -> Option<InterpolationBasis> {
    let basis = keyed_variation_basis(sources, axes)?;
    Some(InterpolationBasis {
        source_ids: sources.iter().map(|(source_id, _)| source_id.clone()).collect(),
        design_normalization,
        basis,
    })
}

/// The fontdrasil basis for any ordered set of locations. Rows follow
/// `sources`' order; the keys only label them, so the same model serves font
/// sources, a glyph's layers, or export samples.
fn keyed_variation_basis<K>(sources: &[(K, NormalizedLocation)], axes: &[Axis]) -> Option<VariationBasis> {
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
    let default_location = axes
        .iter()
        .filter_map(|axis| {
            Tag::from_str(axis.tag())
                .ok()
                .map(|tag| (tag, NormalizedCoord::new(0.0)))
        })
        .collect();
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
    Some(VariationBasis::from_fontdrasil(model_coefficients, &axis_ids_by_tag))
}

/// Derives a virtual default only when two masters bracket it on one axis.
///
/// OpenType's variation model requires a value at the normalized origin. A
/// sparse glyph may omit the font's default master while still providing a
/// well-defined one-axis interpolation on opposite sides of it. More complex
/// sparse layouts remain nonviable and use the caller's static master fallback.
fn virtual_default_coefficients<K>(sources: &[(K, NormalizedLocation)]) -> Option<Vec<f64>> {
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

fn normalized_location(
    location: &DesignLocation,
    axes: &[Axis],
    design_normalization: &[DesignNormalization],
) -> NormalizedLocation {
    axes.iter()
        .zip(design_normalization)
        .filter_map(|(axis, normalization)| {
            let tag = Tag::from_str(axis.tag()).ok()?;
            let value = location.get(&axis.id()).unwrap_or(normalization.default);
            Some((tag, NormalizedCoord::new(normalization.normalize(value))))
        })
        .collect()
}

fn region_scalar(
    region: &InterpolationRegion,
    location: &Location,
    axes: &[Axis],
    design_normalization: Option<&[DesignNormalization]>,
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
            .require(&support.axis_id)?;
        let normalized = if let Some(design_normalization) = design_normalization {
            let normalization = design_normalization
                .iter()
                .find(|normalization| normalization.axis_id == axis.id())
                .require(&support.axis_id)?;
            normalization.normalize(location.get(&axis.id()).unwrap_or(normalization.default))
        } else {
            axis.normalize(location.get(&axis.id()).unwrap_or(axis.default()))
        }
        .clamp(-1.0, 1.0);

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
    use crate::{DesignLocation, GlyphInterpolationValues};

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

        assert!(reference_layer.match_with(&candidate).is_complete());
    }

    #[test]
    fn glyph_interpolation_resolves_intermediate_outline_and_advance() {
        let font = sample_variable_font();
        let glyph = font.glyph_by_name("A").unwrap();
        let axis_id = font.axes()[0].id();
        let mut location = DesignLocation::new();
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
            let source = font.source(source_id).unwrap();
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

        let error = interpolation
            .resolve(&DesignLocation::new(), &[])
            .unwrap_err();

        assert!(matches!(error, crate::CoreError::AxisNotFound(_)));
    }
}

// ---------------------------------------------------------------------------
// Spike: glyph-local axes and sources (boring expansion).
//
// A glyph's designspace is the font's axes plus its own glyph axes. Every
// layer sits at its base font source plus its extra coordinates; interpolation
// over that space reuses the same fontdrasil basis as font-wide interpolation.

/// Interpolation over one glyph's own space (font axes plus its glyph axes),
/// with one member per compatible layer. Keyed by layer: glyph-local sources
/// are layers, not font sources.
#[derive(Clone, Debug, PartialEq)]
pub struct GlyphSpaceInterpolation {
    reference_layer: Arc<GlyphLayer>,
    layer_ids: Vec<LayerId>,
    values: Vec<GlyphInterpolationValues>,
    basis: VariationBasis,
    design_normalization: Vec<DesignNormalization>,
}

impl GlyphSpaceInterpolation {
    /// The layers whose values the basis combines, in its row order.
    pub fn layer_ids(&self) -> &[LayerId] {
        &self.layer_ids
    }

    /// Resolves a derived layer at `location`; glyph axes it doesn't name sit
    /// at their defaults.
    pub fn resolve(&self, location: &DesignLocation, axes: &[Axis]) -> CoreResult<GlyphLayer> {
        let weights = self.basis.evaluate(location.as_untyped(), axes, Some(&self.design_normalization))?;
        let count = self.values.first().map_or(0, |v| v.as_slice().len());
        let mut values = vec![0.0; count];
        for (member, weight) in self.values.iter().zip(weights) {
            if weight == 0.0 {
                continue;
            }
            for (value, member_value) in values.iter_mut().zip(member.as_slice()) {
                *value += weight * member_value;
            }
        }
        let mut layer = self.reference_layer.as_ref().clone();
        layer.apply_interpolation_values(&GlyphInterpolationValues::new(values))?;
        Ok(layer)
    }
}

/// A glyph resolved at a location, components flattened into contours. The
/// contours keep their point types; their ids are not unique and must be
/// re-minted before the contours go into a font.
#[derive(Clone, Debug, PartialEq)]
pub struct FlattenedGlyph {
    pub advance: f64,
    pub contours: Vec<crate::Contour>,
}

impl FlattenedGlyph {
    /// Every point in order, as coordinates.
    pub fn points(&self) -> Vec<(f64, f64)> {
        self.contours.iter().flat_map(|c| c.points().iter().map(|p| (p.x(), p.y()))).collect()
    }
}

const MAX_RESOLVE_DEPTH: usize = 32;

impl Font {
    /// The glyph's design axes: the font's axes, then its own.
    pub fn glyph_space_axes(&self, glyph: &Glyph) -> Vec<Axis> {
        let mut axes = self.axes().to_vec();
        axes.extend(glyph.axes().iter().map(|axis| {
            Axis::continuous_with_id(axis.id.clone(), axis.tag.clone(), axis.name.clone(), axis.minimum, axis.default, axis.maximum)
        }));
        axes
    }

    fn glyph_space_normalization(&self, glyph: &Glyph) -> CoreResult<Vec<DesignNormalization>> {
        let mut normalization = self.design_normalization()?;
        normalization.extend(glyph.axes().iter().map(|axis| DesignNormalization {
            axis_id: axis.id.clone(),
            minimum: axis.minimum,
            default: axis.default,
            maximum: axis.maximum,
        }));
        Ok(normalization)
    }

    /// A layer's full location in its glyph's space: its source's font
    /// coordinates, the glyph's axes at their defaults, then its extra coordinates.
    pub fn layer_full_location(&self, glyph: &Glyph, layer: &GlyphLayer) -> CoreResult<DesignLocation> {
        let mut location = self.require_source(&layer.source_id())?.location().clone();
        for axis in glyph.axes() {
            location.set(axis.id.clone(), axis.default);
        }
        for (axis_id, value) in &layer.location().0 {
            location.set(axis_id.clone(), *value);
        }
        Ok(location)
    }

    /// Interpolation over the glyph's whole space from every compatible master
    /// layer, including layers with extra coordinates, keyed by layer.
    pub fn glyph_space_interpolation(&self, glyph_id: &GlyphId) -> CoreResult<Option<GlyphSpaceInterpolation>> {
        let glyph = self.require_glyph(glyph_id)?;
        let Some(reference_layer) = interpolation_reference_layer(self, glyph) else {
            return Ok(None);
        };
        let axes = self.glyph_space_axes(glyph);
        let normalization = self.glyph_space_normalization(glyph)?;
        let mut members = Vec::new();
        for layer in glyph.layers().values() {
            let is_master = self.source(&layer.source_id()).is_some_and(crate::Source::is_master);
            if !is_master || !reference_layer.match_with(layer).is_complete() {
                continue;
            }
            let location = normalized_location(&self.layer_full_location(glyph, layer)?, &axes, &normalization);
            members.push((layer.id(), location, layer.interpolation_values()));
        }
        let keyed: Vec<(LayerId, NormalizedLocation)> = members.iter().map(|(id, loc, _)| (id.clone(), loc.clone())).collect();
        let Some(basis) = keyed_variation_basis(&keyed, &axes) else {
            return Ok(None);
        };
        Ok(Some(GlyphSpaceInterpolation {
            reference_layer,
            layer_ids: keyed.into_iter().map(|(id, _)| id).collect(),
            values: members.into_iter().map(|(_, _, values)| values).collect(),
            basis,
            design_normalization: normalization,
        }))
    }

    /// Resolves a glyph at a font location: interpolates it over its own space
    /// (its axes at their defaults unless `at` names them) and flattens its
    /// components, each sampling its base glyph at the component's location.
    pub fn resolve_glyph(&self, glyph_id: &GlyphId, at: &DesignLocation) -> CoreResult<FlattenedGlyph> {
        self.resolve_glyph_at_depth(glyph_id, at, 0)
    }

    fn resolve_glyph_at_depth(&self, glyph_id: &GlyphId, at: &DesignLocation, depth: usize) -> CoreResult<FlattenedGlyph> {
        if depth > MAX_RESOLVE_DEPTH {
            return Err(crate::CoreError::InvalidEntityOrder { kind: "component", message: "components nest too deeply".into() });
        }
        let glyph = self.require_glyph(glyph_id)?;
        let axes = self.glyph_space_axes(glyph);
        let font_wide = glyph.axes().is_empty() && glyph.layers().values().all(|layer| layer.location().is_empty());
        let resolved = if font_wide {
            self.glyph_interpolation(glyph_id)?.map(|i| i.resolve(at, &axes)).transpose()?
        } else {
            self.glyph_space_interpolation(glyph_id)?.map(|i| i.resolve(at, &axes)).transpose()?
        };
        let layer = match resolved {
            Some(layer) => layer,
            None => interpolation_reference_layer(self, glyph).map(|l| l.as_ref().clone()).ok_or_else(|| crate::CoreError::GlyphNotFound(glyph_id.clone()))?,
        };
        let mut contours: Vec<crate::Contour> = layer.contours_iter().cloned().collect();
        let font_axes: HashSet<AxisId> = self.axes().iter().map(Axis::id).collect();
        for component in layer.components_iter() {
            // Font axes the location doesn't name follow the parent, or reset.
            let mut base_at = DesignLocation::new();
            if component.inheritance() == crate::AxisInheritance::Parent {
                for (axis_id, value) in at.iter() {
                    if font_axes.contains(axis_id) {
                        base_at.set(axis_id.clone(), *value);
                    }
                }
            }
            for (axis_id, value) in &component.location().0 {
                base_at.set(axis_id.clone(), *value);
            }
            let base = self.resolve_glyph_at_depth(&component.base_glyph_id(), &base_at, depth + 1)?;
            let matrix = component.transform().to_matrix();
            for mut contour in base.contours {
                for point in contour.points_mut() {
                    let (x, y) = matrix.transform_point(point.x(), point.y());
                    point.set_position(x, y);
                }
                contours.push(contour);
            }
        }
        Ok(FlattenedGlyph { advance: layer.width(), contours })
    }
}

/// What decomposing one glyph's parts for export did.
#[derive(Clone, Debug, PartialEq)]
pub struct PartDecomposition {
    pub glyph_name: String,
    pub masters: usize,
    /// The worst distance, in font units, between the preview and a font that
    /// interpolates the flattened masters linearly, before any intermediates.
    pub worst_gap_before: f64,
    pub intermediates: usize,
    pub worst_gap_after: f64,
}

const MAX_INTERMEDIATES: usize = 24;

impl Font {
    /// Whether a glyph's outline depends on parts: it, or a component in its
    /// closure, samples a glyph with its own axes or at a location.
    fn uses_parts(&self, glyph: &Glyph, depth: usize) -> bool {
        if depth > MAX_RESOLVE_DEPTH {
            return false;
        }
        glyph.layers().values().any(|layer| {
            layer.components_iter().any(|component| {
                !component.location().is_empty()
                    || self.glyph(&component.base_glyph_id()).is_some_and(|base| {
                        !base.axes().is_empty() || self.uses_parts(base, depth + 1)
                    })
            })
        })
    }

    /// An export copy of the font in which every glyph that uses parts is plain
    /// outlines: flattened at each master, plus glyph-specific intermediate
    /// masters (layers located on font axes) wherever a font interpolating the
    /// flattened masters would drift from the preview by more than `tolerance`
    /// units. Parts keep only their font-axis layers and lose their own axes.
    ///
    /// The prediction uses the same fontdrasil model a compiler builds for a
    /// glyph with its own set of locations.
    pub fn decompose_parts(&self, tolerance: f64) -> CoreResult<(Font, Vec<PartDecomposition>)> {
        let axes = self.axes().to_vec();
        let normalization = self.design_normalization()?;
        let default_source = self.default_source_id().ok_or_else(|| crate::CoreError::InvalidEntityOrder { kind: "source", message: "no default source".into() })?;
        let mut changes = Vec::new();
        let mut reports = Vec::new();
        for glyph in self.glyphs() {
            if !glyph.axes().is_empty() {
                let mut part = glyph.clone();
                part.set_axes(Vec::new());
                for (layer_id, layer) in glyph.layers() {
                    if !layer.location().is_empty() {
                        part.remove_layer(layer_id.clone());
                    }
                }
                changes.push(crate::FontChange::Glyph(Box::new(crate::Replacement { before: Some(glyph.clone()), after: Some(part) })));
                continue;
            }
            if !self.uses_parts(glyph, 0) {
                continue;
            }

            // Flatten at each master the glyph has a plain layer for.
            let mut flattened = glyph.clone();
            let mut samples: Vec<(DesignLocation, Vec<(f64, f64)>)> = Vec::new();
            for (layer_id, layer) in glyph.layers() {
                flattened.remove_layer(layer_id.clone());
                let Some(source) = self.source(&layer.source_id()).filter(|s| s.is_master()) else { continue };
                if !layer.location().is_empty() {
                    continue;
                }
                let location = source.location().clone();
                let flat = self.resolve_glyph(&glyph.id(), &location)?;
                samples.push((location, flat.points()));
                flattened.set_layer(flattened_layer(layer.id(), layer.source_id(), &flat, layer, None));
            }
            let masters = samples.len();

            // Add intermediates where the linear font drifts from the preview.
            let mut worst_before = None;
            let mut worst_after = 0.0;
            let mut intermediates = 0;
            loop {
                let model: Vec<(usize, NormalizedLocation)> = samples.iter().enumerate().map(|(i, (loc, _))| (i, normalized_location(loc, &axes, &normalization))).collect();
                let Some(basis) = keyed_variation_basis(&model, &axes) else { break };
                let mut worst: Option<(f64, DesignLocation, crate::FlattenedGlyph)> = None;
                for candidate in midpoints(&samples) {
                    let weights = basis.evaluate(candidate.as_untyped(), &axes, Some(&normalization))?;
                    let preview = self.resolve_glyph(&glyph.id(), &candidate)?;
                    let expected = preview.points();
                    let mut predicted = vec![(0.0, 0.0); expected.len()];
                    for ((_, points), weight) in samples.iter().zip(weights) {
                        for (p, q) in predicted.iter_mut().zip(points) {
                            p.0 += weight * q.0;
                            p.1 += weight * q.1;
                        }
                    }
                    let gap = predicted.iter().zip(&expected).map(|(p, q)| ((p.0 - q.0).powi(2) + (p.1 - q.1).powi(2)).sqrt()).fold(0.0, f64::max);
                    if worst.as_ref().is_none_or(|(g, _, _)| gap > *g) {
                        worst = Some((gap, candidate, preview));
                    }
                }
                let Some((gap, location, preview)) = worst else { break };
                worst_before.get_or_insert(gap);
                worst_after = gap;
                if gap <= tolerance || intermediates >= MAX_INTERMEDIATES {
                    break;
                }
                // A glyph-specific intermediate: every font axis pinned.
                let reference = glyph.layer_for_source(default_source.clone()).cloned();
                let mut layer_location = crate::LayerLocation::default();
                for axis in self.axes() {
                    let value = location.get(&axis.id()).unwrap_or(axis.default());
                    layer_location.0.insert(axis.id(), value);
                }
                let layer = flattened_layer(LayerId::new(), default_source.clone(), &preview, reference.as_ref().unwrap_or(&GlyphLayer::new(LayerId::new(), default_source.clone())), Some(layer_location));
                flattened.set_layer(layer);
                samples.push((location, preview.points()));
                intermediates += 1;
            }
            reports.push(PartDecomposition { glyph_name: glyph.name().to_string(), masters, worst_gap_before: worst_before.unwrap_or(0.0), intermediates, worst_gap_after: worst_after });
            changes.push(crate::FontChange::Glyph(Box::new(crate::Replacement { before: Some(glyph.clone()), after: Some(flattened) })));
        }
        let mut export = self.clone();
        export.apply_change_set(&crate::FontChangeSet::new(changes))?;
        Ok((export, reports))
    }
}

/// A layer holding a flattened outline with freshly minted ids, keeping the
/// original layer's anchors.
fn flattened_layer(id: LayerId, source_id: SourceId, flat: &crate::FlattenedGlyph, original: &GlyphLayer, location: Option<crate::LayerLocation>) -> GlyphLayer {
    let mut layer = GlyphLayer::with_width(id, source_id, flat.advance);
    for contour in &flat.contours {
        let mut fresh = crate::Contour::new();
        for point in contour.points() {
            fresh.add_point(point.x(), point.y(), point.point_type(), point.is_smooth());
        }
        if contour.is_closed() {
            fresh.close();
        }
        layer.add_contour(fresh);
    }
    if location.is_none() {
        for anchor in original.anchors_iter() {
            layer.add_anchor(anchor.clone());
        }
    }
    if let Some(location) = location {
        layer.set_location(location);
    }
    layer
}

/// Midpoints between every pair of sample locations: where a linear font
/// drifts most from a curved preview.
fn midpoints(samples: &[(DesignLocation, Vec<(f64, f64)>)]) -> Vec<DesignLocation> {
    let mut out = Vec::new();
    for i in 0..samples.len() {
        for j in i + 1..samples.len() {
            let (a, b) = (&samples[i].0, &samples[j].0);
            let mut mid = DesignLocation::new();
            let ids: HashSet<&AxisId> = a.iter().map(|(id, _)| id).chain(b.iter().map(|(id, _)| id)).collect();
            for id in ids {
                let (x, y) = (a.get(id).unwrap_or(0.0), b.get(id).unwrap_or(0.0));
                mid.set(id.clone(), (x + y) / 2.0);
            }
            out.push(mid);
        }
    }
    out
}

