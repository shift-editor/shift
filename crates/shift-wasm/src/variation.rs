//! Variation: axis mapping, interpolation weights and compiled deltas,
//! evaluated statelessly for a font without an editing engine.
//!
//! A font the window does not edit (a preview, a retained source, a memory
//! session) has no engine to hold its axes and bases, so each [`Variation`]
//! call carries them whole, with a location as numbers in the axes' order, a
//! NaN standing for an axis the location omits. The open document asks its
//! engine instead, which builds the same bases from its own font
//! (`crate::engine_reads`). Both run `shift-font`'s own evaluators, the ones
//! the workspace and export use.

use pack::Pack;
use shift_font::{
    Axis, AxisId, AxisMappingBasis, AxisMappingId, AxisRole, AxisSupport, DesignLocation,
    DesignNormalization, ExternalLocation, InterpolationBasis, InterpolationRegion, Location,
    SourceId, VariationBasis, VariationDelta, ir::variation::map_location_with_bases,
    ir::variation::unmap_location_with_bases,
};
use wasm_bindgen::prelude::*;

/// Evaluates variation for a font without an engine: every call carries the
/// font's axes, in order, and the bases it evaluates.
#[pack::interface]
pub trait Variation {
    /// One weight per source of `basis` at a design location:
    /// `InterpolationBasis::weights_at`. Zeros when `axes` lack an axis a
    /// region names.
    fn interpolation_weights(
        &self,
        axes: Vec<Axis>,
        basis: InterpolationBasisData,
        location: Vec<f64>,
    ) -> Vec<f64>;
    /// A compiled variation basis's values at a design location, normalized
    /// by each axis's own range: `VariationBasis::evaluate`. Zeros when it
    /// cannot be evaluated.
    fn evaluate_variation(
        &self,
        axes: Vec<Axis>,
        basis: VariationBasisData,
        location: Vec<f64>,
    ) -> Vec<f64>;
    /// An external location's design location, through the font's compiled
    /// axis mappings, exactly once: `map_location_with_bases`.
    fn map_location(
        &self,
        axes: Vec<Axis>,
        mappings: Vec<AxisMappingBasisData>,
        external: Vec<f64>,
    ) -> Vec<f64>;
    /// The external location a design location's mapping came from, NaN on
    /// internal axes: `unmap_location_with_bases`.
    fn unmap_location(
        &self,
        axes: Vec<Axis>,
        mappings: Vec<AxisMappingBasisData>,
        design: Vec<f64>,
    ) -> Vec<f64>;
    /// A Slug atlas's weights at an external location, in one call: the
    /// location mapped once, then each weight set's basis evaluated there and
    /// its weights written at the set's indices. Weight 0 is always 1. Null
    /// when a set names an index past `weight_count`.
    fn atlas_weights(
        &self,
        axes: Vec<Axis>,
        mappings: Vec<AxisMappingBasisData>,
        sets: Vec<AtlasWeightSet>,
        weight_count: usize,
        external: Vec<f64>,
    ) -> Option<Vec<f64>>;
}

/// One axis's support within a region, normalized.
#[derive(Clone, Debug, Pack)]
pub struct VariationSupport {
    pub axis_id: AxisId,
    pub lower: f64,
    pub peak: f64,
    pub upper: f64,
}

/// One contribution: a region and the values it adds there.
#[derive(Clone, Debug, Pack)]
pub struct VariationBasisDelta {
    pub region: Vec<VariationSupport>,
    #[pack(numbers)]
    pub values: Vec<f64>,
}

/// A variation basis Rust compiled, as the editor holds it.
#[derive(Clone, Debug, Pack)]
pub struct VariationBasisData {
    pub deltas: Vec<VariationBasisDelta>,
}

/// Design-space bounds that normalize one axis for interpolation.
#[derive(Clone, Debug, Pack)]
pub struct VariationDesignNormalization {
    pub axis_id: AxisId,
    pub minimum: f64,
    pub default: f64,
    pub maximum: f64,
}

/// Source weights Rust compiled for an ordered source set, as the editor
/// holds them.
#[derive(Clone, Debug, Pack)]
pub struct InterpolationBasisData {
    pub source_ids: Vec<SourceId>,
    pub basis: VariationBasisData,
    pub design_normalization: Vec<VariationDesignNormalization>,
}

/// An axis mapping Rust compiled, as the editor holds it.
#[derive(Clone, Debug, Pack)]
pub struct AxisMappingBasisData {
    pub mapping_id: AxisMappingId,
    pub input_axis_ids: Vec<AxisId>,
    pub output_axis_ids: Vec<AxisId>,
    pub basis: VariationBasisData,
}

/// One weight set of a Slug atlas: a basis, and the atlas weight each of its
/// sources' weights goes to.
#[derive(Clone, Debug, Pack)]
pub struct AtlasWeightSet {
    pub basis: InterpolationBasisData,
    pub source_weight_indices: Vec<usize>,
}

/// The stateless evaluators [`Variation`] calls.
pub struct StatelessVariation;

impl Variation for StatelessVariation {
    fn interpolation_weights(
        &self,
        axes: Vec<Axis>,
        basis: InterpolationBasisData,
        location: Vec<f64>,
    ) -> Vec<f64> {
        weights_at(&InterpolationBasis::from(basis), &axes, &location)
    }

    fn evaluate_variation(
        &self,
        axes: Vec<Axis>,
        basis: VariationBasisData,
        location: Vec<f64>,
    ) -> Vec<f64> {
        let basis = VariationBasis::from(basis);
        let count = basis
            .deltas()
            .first()
            .map_or(0, |delta| delta.values().len());
        basis
            .evaluate(&to_location(&axes, &location), &axes, None)
            .unwrap_or_else(|_| vec![0.0; count])
    }

    fn map_location(
        &self,
        axes: Vec<Axis>,
        mappings: Vec<AxisMappingBasisData>,
        external: Vec<f64>,
    ) -> Vec<f64> {
        design_values(&axes, &mapping_bases(mappings), &external)
    }

    fn unmap_location(
        &self,
        axes: Vec<Axis>,
        mappings: Vec<AxisMappingBasisData>,
        design: Vec<f64>,
    ) -> Vec<f64> {
        external_values(&axes, &mapping_bases(mappings), &design)
    }

    fn atlas_weights(
        &self,
        axes: Vec<Axis>,
        mappings: Vec<AxisMappingBasisData>,
        sets: Vec<AtlasWeightSet>,
        weight_count: usize,
        external: Vec<f64>,
    ) -> Option<Vec<f64>> {
        let design = design_values(&axes, &mapping_bases(mappings), &external);
        let mut weights = vec![0.0; weight_count];
        if let Some(first) = weights.first_mut() {
            *first = 1.0;
        }
        for set in sets {
            let basis_weights = weights_at(&InterpolationBasis::from(set.basis), &axes, &design);
            for (index, weight) in set.source_weight_indices.into_iter().zip(basis_weights) {
                *weights.get_mut(index)? = weight;
            }
        }
        Some(weights)
    }
}

/// Runs one [`Variation`] method for the editor's generated `Variation` class.
#[wasm_bindgen(js_name = variationRequest)]
pub fn request(
    method: u32,
    input: &[f64],
    #[wasm_bindgen(unchecked_param_type = "readonly Uint8Array[] | undefined")] blobs: Option<
        js_sys::Array,
    >,
) -> Vec<f64> {
    crate::blobs::answer(blobs, |blobs, names| {
        variation_request(&StatelessVariation, method, input, blobs, names)
    })
}

/// The weighted sum of source values: `interpolation::blend_values`.
///
/// `values` holds each source's values one after another, `lengths[i]`
/// of them for source `i`; a source the editor lacks has length 0. None when
/// there is no source, one has no values, or two differ in length.
#[wasm_bindgen(js_name = blendSourceValues)]
pub fn blend_source_values(weights: &[f64], values: &[f64], lengths: &[u32]) -> Option<Vec<f64>> {
    let mut rest = values;
    let mut sources = Vec::with_capacity(lengths.len());
    for &length in lengths {
        let (source, after) = rest.split_at_checked(usize::try_from(length).ok()?)?;
        sources.push(source);
        rest = after;
    }
    shift_font::interpolation::blend_values(weights, &sources)
}

/// `basis`'s weights at a design location given as numbers in `axes` order;
/// zeros when `axes` lack an axis a region names.
pub(crate) fn weights_at(basis: &InterpolationBasis, axes: &[Axis], location: &[f64]) -> Vec<f64> {
    let location = DesignLocation::from_untyped(to_location(axes, location));
    basis
        .weights_at(&location, axes)
        .unwrap_or_else(|_| vec![0.0; basis.source_ids().len()])
}

/// An external location's design location, both as numbers in `axes` order.
/// When the mappings cannot be evaluated, external axes keep their values and
/// internal ones take their defaults, as in an unmapped font.
pub(crate) fn design_values(
    axes: &[Axis],
    mappings: &[AxisMappingBasis],
    external: &[f64],
) -> Vec<f64> {
    let external = ExternalLocation::from_untyped(to_location(axes, external));
    match map_location_with_bases(&external, axes, mappings) {
        Ok(design) => from_location(axes, design.as_untyped()),
        Err(_) => axes
            .iter()
            .map(|axis| match axis.role() {
                AxisRole::External => external.value_on(axis),
                AxisRole::Internal => axis.default(),
            })
            .collect(),
    }
}

/// The external location a design location's mapping came from, both as
/// numbers in `axes` order, NaN on internal axes.
pub(crate) fn external_values(
    axes: &[Axis],
    mappings: &[AxisMappingBasis],
    design: &[f64],
) -> Vec<f64> {
    let design = DesignLocation::from_untyped(to_location(axes, design));
    let external = unmap_location_with_bases(&design, axes, mappings);
    from_location(axes, external.as_untyped())
}

fn mapping_bases(mappings: Vec<AxisMappingBasisData>) -> Vec<AxisMappingBasis> {
    mappings.into_iter().map(AxisMappingBasis::from).collect()
}

impl From<AxisMappingBasisData> for AxisMappingBasis {
    fn from(data: AxisMappingBasisData) -> Self {
        Self::new(
            data.mapping_id,
            data.input_axis_ids,
            data.output_axis_ids,
            data.basis.into(),
        )
    }
}

impl From<InterpolationBasisData> for InterpolationBasis {
    fn from(data: InterpolationBasisData) -> Self {
        Self::new(
            data.source_ids,
            data.basis.into(),
            data.design_normalization
                .into_iter()
                .map(|normalization| DesignNormalization {
                    axis_id: normalization.axis_id,
                    minimum: normalization.minimum,
                    default: normalization.default,
                    maximum: normalization.maximum,
                })
                .collect(),
        )
    }
}

impl From<VariationBasisData> for VariationBasis {
    fn from(data: VariationBasisData) -> Self {
        Self::new(
            data.deltas
                .into_iter()
                .map(|delta| {
                    VariationDelta::new(
                        InterpolationRegion::new(
                            delta
                                .region
                                .into_iter()
                                .map(|support| {
                                    AxisSupport::new(
                                        support.axis_id,
                                        support.lower,
                                        support.peak,
                                        support.upper,
                                    )
                                })
                                .collect(),
                        ),
                        delta.values,
                    )
                })
                .collect(),
        )
    }
}

/// A location as numbers in `axes` order, NaN where it omits an axis.
pub(crate) fn to_location(axes: &[Axis], values: &[f64]) -> Location {
    let mut location = Location::new();
    for (axis, value) in axes.iter().zip(values) {
        if !value.is_nan() {
            location.set(axis.id(), *value);
        }
    }
    location
}

fn from_location(axes: &[Axis], location: &Location) -> Vec<f64> {
    axes.iter()
        .map(|axis| location.get(axis.id()).unwrap_or(f64::NAN))
        .collect()
}

#[cfg(test)]
mod tests {
    use shift_font::ir::variation::map_location;
    use shift_font::{AxisMapping, AxisMappingPoint};

    use super::*;

    fn axis(id: &str, tag: &str, [minimum, default, maximum]: [f64; 3], role: AxisRole) -> Axis {
        let mut axis = Axis::continuous_with_id(
            AxisId::from_raw(id),
            tag.to_string(),
            tag.to_string(),
            minimum,
            default,
            maximum,
        );
        axis.set_role(role);
        axis
    }

    fn axes() -> Vec<Axis> {
        vec![
            axis(
                "axis_weight",
                "wght",
                [100.0, 400.0, 900.0],
                AxisRole::External,
            ),
            axis(
                "axis_width",
                "wdth",
                [50.0, 100.0, 200.0],
                AxisRole::External,
            ),
            axis(
                "axis_optical",
                "opsz",
                [8.0, 12.0, 72.0],
                AxisRole::Internal,
            ),
        ]
    }

    fn location(values: &[(&str, f64)]) -> Location {
        values
            .iter()
            .map(|(axis_id, value)| (AxisId::from_raw(*axis_id), *value))
            .collect()
    }

    /// Axis values by axis id.
    type Values<'a> = &'a [(&'a str, f64)];

    fn mapping(
        id: &str,
        inputs: &[&str],
        outputs: &[&str],
        points: &[(Values<'_>, Values<'_>)],
    ) -> AxisMapping {
        let ids = |ids: &[&str]| ids.iter().map(|id| AxisId::from_raw(*id)).collect();
        AxisMapping::with_id(
            AxisMappingId::from_raw(id),
            id.to_string(),
            ids(inputs),
            ids(outputs),
            points
                .iter()
                .map(|(input, output)| AxisMappingPoint {
                    description: None,
                    input: location(input),
                    output: location(output),
                })
                .collect(),
        )
    }

    fn weight_curve() -> AxisMapping {
        mapping(
            "axisMapping_weight",
            &["axis_weight"],
            &["axis_weight"],
            &[
                (&[("axis_weight", 100.0)], &[("axis_weight", 100.0)]),
                (&[("axis_weight", 400.0)], &[("axis_weight", 400.0)]),
                (&[("axis_weight", 900.0)], &[("axis_weight", 800.0)]),
            ],
        )
    }

    fn reversed() -> AxisMapping {
        mapping(
            "axisMapping_reversed",
            &["axis_weight"],
            &["axis_weight"],
            &[
                (&[("axis_weight", 100.0)], &[("axis_weight", 900.0)]),
                (&[("axis_weight", 900.0)], &[("axis_weight", 100.0)]),
            ],
        )
    }

    fn optical_compensation() -> AxisMapping {
        mapping(
            "axisMapping_optical",
            &["axis_weight", "axis_width"],
            &["axis_optical"],
            &[(
                &[("axis_weight", 800.0), ("axis_width", 125.0)],
                &[("axis_optical", 72.0)],
            )],
        )
    }

    /// `mappings` compiled by shift-font and shaped as the editor sends them.
    fn compiled(axes: &[Axis], mappings: &[AxisMapping]) -> Vec<AxisMappingBasisData> {
        mappings
            .iter()
            .map(|mapping| {
                let basis = AxisMappingBasis::try_from((mapping, axes)).unwrap();
                AxisMappingBasisData {
                    mapping_id: basis.mapping_id(),
                    input_axis_ids: basis.input_axis_ids().to_vec(),
                    output_axis_ids: basis.output_axis_ids().to_vec(),
                    basis: VariationBasisData {
                        deltas: basis
                            .basis()
                            .deltas()
                            .iter()
                            .map(|delta| VariationBasisDelta {
                                region: delta
                                    .region()
                                    .supports()
                                    .iter()
                                    .map(|support| VariationSupport {
                                        axis_id: support.axis_id(),
                                        lower: support.minimum(),
                                        peak: support.peak(),
                                        upper: support.maximum(),
                                    })
                                    .collect(),
                                values: delta.values().to_vec(),
                            })
                            .collect(),
                    },
                }
            })
            .collect()
    }

    fn values(axes: &[Axis], location: &[(&str, f64)]) -> Vec<f64> {
        from_location(axes, &self::location(location))
    }

    fn assert_close(actual: &[f64], expected: &[f64]) {
        assert_eq!(
            actual.len(),
            expected.len(),
            "{actual:?} against {expected:?}"
        );
        for (actual, expected) in actual.iter().zip(expected) {
            assert!(
                (actual - expected).abs() < 1e-9,
                "{actual} against {expected}"
            );
        }
    }

    #[test]
    fn maps_external_locations_as_fontdrasil_does() {
        let axes = axes();
        let cases = [
            (
                vec![weight_curve()],
                vec![("axis_weight", 650.0)],
                600.0,
                None,
            ),
            (vec![reversed()], vec![("axis_weight", 250.0)], 650.0, None),
            (
                vec![weight_curve(), optical_compensation()],
                vec![("axis_weight", 900.0), ("axis_width", 125.0)],
                800.0,
                Some(72.0),
            ),
        ];

        for (mappings, external, weight, optical) in cases {
            let design = StatelessVariation.map_location(
                axes.clone(),
                compiled(&axes, &mappings),
                values(&axes, &external),
            );

            assert_close(&design[..1], &[weight]);
            if let Some(optical) = optical {
                assert_close(&design[2..], &[optical]);
            }
        }
    }

    #[test]
    fn maps_through_compiled_bases_as_through_authored_points() {
        let axes = axes();
        let sets = [
            vec![weight_curve()],
            vec![reversed()],
            vec![weight_curve(), optical_compensation()],
        ];
        for mappings in sets {
            for step in 0..=8 {
                let step = f64::from(step);
                let external = [
                    ("axis_weight", 100.0 + 100.0 * step),
                    ("axis_width", 50.0 + 18.75 * step),
                ];
                let authored = map_location(
                    &ExternalLocation::from_untyped(location(&external)),
                    &axes,
                    &mappings,
                )
                .unwrap();
                let expected: Vec<f64> = axes
                    .iter()
                    .map(|axis| {
                        authored
                            .as_untyped()
                            .get(axis.id())
                            .unwrap_or_else(|| axis.default())
                    })
                    .collect();

                let design = StatelessVariation.map_location(
                    axes.clone(),
                    compiled(&axes, &mappings),
                    values(&axes, &external),
                );

                let design: Vec<f64> = axes
                    .iter()
                    .zip(design)
                    .map(|(axis, value)| {
                        if value.is_nan() {
                            axis.default()
                        } else {
                            value
                        }
                    })
                    .collect();
                assert_close(&design, &expected);
            }
        }
    }

    #[test]
    fn recovers_the_external_controls_of_a_mapped_location() {
        let axes = axes();
        let bases = compiled(&axes, &[weight_curve(), optical_compensation()]);
        let external = values(&axes, &[("axis_weight", 700.0), ("axis_width", 125.0)]);

        let design = StatelessVariation.map_location(axes.clone(), bases.clone(), external.clone());
        let recovered = StatelessVariation.unmap_location(axes, bases, design);

        assert_close(&recovered[..2], &external[..2]);
    }
}
