//! Native glyph interpolation over Shift sources and internal locations.

use crate::Require;
use std::collections::{HashMap, HashSet, hash_map::Entry};
use std::str::FromStr;
use std::sync::Arc;

use fontdrasil::coords::{NormalizedCoord, NormalizedLocation};
use fontdrasil::types::Tag;
use fontdrasil::variations::{
    RoundingBehaviour, VariationModel, VariationRegion as FontdrasilVariationRegion,
};

use crate::{
    Axis, AxisId, AxisList, CoreResult, DesignLocation, DesignNormalization, Font, GlyphId,
    GlyphLayer, Location, SourceId,
};

mod kerning;
mod layer_match;
mod metrics;
mod values;

pub use kerning::KerningBlend;
pub use layer_match::{LayerDifference, LayerMatch};
pub use metrics::{
    ResolvedSourceMetrics, SOURCE_METRIC_OVERSHOOT_OFFSET, SOURCE_METRIC_POSITION_OFFSET,
    SOURCE_METRIC_VALUE_COUNT, SOURCE_TECHNICAL_FIELD_VALUE_COUNT, SourceMetricField,
    SourceMetricInterpolation, SourceMetricValues,
};
pub use values::{
    GLYPH_ADVANCE_VALUE_COUNT, GLYPH_ADVANCE_VALUE_OFFSET, GLYPH_ANCHOR_VALUE_COUNT,
    GLYPH_POINT_VALUE_COUNT, GLYPH_POSITION_VALUE_FIELDS, GlyphInterpolationValues,
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
        self.axis_id
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

    /// Returns how much this region contributes at `location`: the product of
    /// each valid support's scalar, after normalizing the location with
    /// `design_normalization` when given, or with `axes` otherwise.
    ///
    /// # Errors
    ///
    /// Returns [`crate::CoreError::AxisNotFound`] when a support names an axis that
    /// `axes` or `design_normalization` does not have.
    pub fn scalar_at(
        &self,
        location: &Location,
        axes: &[Axis],
        design_normalization: Option<&[DesignNormalization]>,
    ) -> CoreResult<f64> {
        let mut scalar = 1.0;

        for support in self.supports() {
            if support.minimum > support.peak
                || support.peak > support.maximum
                || (support.minimum < 0.0 && support.maximum > 0.0)
            {
                continue;
            }

            let axis = axes.axis(support.axis_id).require(&support.axis_id)?;
            let normalized = if let Some(design_normalization) = design_normalization {
                let normalization = design_normalization
                    .iter()
                    .find(|normalization| normalization.axis_id == axis.id())
                    .require(&support.axis_id)?;
                normalization.normalize(location.get(axis.id()).unwrap_or(normalization.default))
            } else {
                axis.normalize(location.value_on(axis))
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
                                    axis_id: *axis_id,
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
        let value_count = self.deltas.first().map_or(0, |delta| delta.values.len());
        let mut values = vec![0.0; value_count];

        for delta in &self.deltas {
            let scalar = delta
                .region
                .scalar_at(location, axes, design_normalization)?;
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
                    *source_id,
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
        self.source_id
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
        let weights = self.basis.weights_at(location, axes)?;
        let sources: Vec<&[f64]> = self
            .sources
            .iter()
            .map(|source| source.values.as_slice())
            .collect();

        if sources.is_empty() {
            return Ok(GlyphInterpolationValues::new(Vec::new()));
        }
        let values = blend_values(&weights, &sources)
            .ok_or(crate::CoreError::InterpolationSourcesMismatch)?;
        Ok(GlyphInterpolationValues::new(values))
    }
}

/// The weighted sum of `sources`, value by value: each source's values times
/// its weight in `weights`, in source order, a zero weight skipped. `None`
/// when there is no source, a source has no values, or two sources differ in
/// length.
pub fn blend_values(weights: &[f64], sources: &[&[f64]]) -> Option<Vec<f64>> {
    let count = sources.first()?.len();
    if count == 0 || sources.iter().any(|source| source.len() != count) {
        return None;
    }

    let mut values = vec![0.0; count];
    for (source, &weight) in sources.iter().zip(weights) {
        if weight == 0.0 {
            continue;
        }
        for (value, source_value) in values.iter_mut().zip(*source) {
            *value += weight * source_value;
        }
    }
    Some(values)
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
    pub fn glyph_interpolation(&self, glyph_id: GlyphId) -> CoreResult<Option<GlyphInterpolation>> {
        self.glyph_interpolation_with_bases(glyph_id, &mut HashMap::new())
    }

    pub(crate) fn glyph_interpolation_with_bases(
        &self,
        glyph_id: GlyphId,
        bases: &mut HashMap<Vec<SourceId>, Arc<InterpolationBasis>>,
    ) -> CoreResult<Option<GlyphInterpolation>> {
        let glyph = self.require_glyph(glyph_id)?;
        if !self.is_variable() {
            return Ok(None);
        }

        let Some(reference_layer) = self.fallback_layer(glyph).cloned() else {
            return Ok(None);
        };

        let mut compatible_sources = Vec::new();

        for (source, layer) in self.masters_with_layers(glyph) {
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
            .map(|(source_id, location, _)| (*source_id, location.clone()))
            .collect::<Vec<_>>();
        let basis_key = source_locations
            .iter()
            .map(|(source_id, _)| *source_id)
            .collect::<Vec<_>>();
        let basis = if let Some(basis) = bases.get(&basis_key) {
            Arc::clone(basis)
        } else {
            let Some(basis) = InterpolationBasis::from_source_locations(
                &source_locations,
                self.axes(),
                self.design_normalization()?,
            ) else {
                return Ok(None);
            };
            let basis = Arc::new(basis);
            bases.insert(basis_key, Arc::clone(&basis));
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

fn interpolation_basis(
    sources: &[(SourceId, NormalizedLocation)],
    axes: &[Axis],
    design_normalization: Vec<DesignNormalization>,
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
    Some(InterpolationBasis {
        source_ids: sources.iter().map(|(source_id, _)| *source_id).collect(),
        design_normalization,
        basis: VariationBasis::from_fontdrasil(model_coefficients, &axis_ids_by_tag),
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

#[cfg(test)]
mod tests {
    use super::blend_values;
    use crate::test_support::sample_variable_font;
    use crate::{DesignLocation, GlyphInterpolationValues};

    #[test]
    fn values_blend_by_weight_and_need_matching_sources() {
        let regular = [10.0, 20.0, 30.0];
        let bold = [30.0, 40.0, 50.0];

        assert_eq!(
            blend_values(&[0.25, 0.75], &[&regular, &bold]),
            Some(vec![25.0, 35.0, 45.0])
        );
        assert_eq!(blend_values(&[1.0, 0.0], &[&regular, &[1.0]]), None);
        assert_eq!(blend_values(&[1.0], &[&[]]), None);
        assert_eq!(blend_values(&[], &[]), None);
    }

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
        let location = DesignLocation::from([(axis_id, 600.0)]);

        let layer = font
            .glyph_interpolation(glyph.id())
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
        let interpolation = font.glyph_interpolation(glyph.id()).unwrap().unwrap();

        for (expected_index, source_id) in interpolation.basis().source_ids().iter().enumerate() {
            let source = font.source(*source_id).unwrap();
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
        let interpolation = font.glyph_interpolation(glyph.id()).unwrap().unwrap();

        let error = interpolation
            .resolve(&DesignLocation::new(), &[])
            .unwrap_err();

        assert!(matches!(error, crate::CoreError::AxisNotFound(_)));
    }
}
