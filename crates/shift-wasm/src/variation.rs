//! Variation: axis mapping, normalization, and interpolation weights.
//!
//! The editor registers the axes and the bases Rust compiled for it once each,
//! and gets a handle; evaluating then passes only a location, as numbers in
//! the registered axes' order, a NaN standing for an axis the location omits.
//! Evaluation runs `shift-font`'s own code, the same the workspace and export
//! use.

use std::cell::RefCell;

use serde::Deserialize;
use shift_font::{
    Axis, AxisId, AxisMappingBasis, AxisMappingId, AxisRole, AxisSupport, DesignNormalization,
    ExternalLocation, InterpolationBasis, InterpolationRegion, Location, SourceId, VariationBasis,
    VariationDelta, ir::variation::map_location_with_bases,
};
use tsify::{Ts, Tsify};
use wasm_bindgen::prelude::*;

/// An axis as variation reads it; the editor's `Axis` satisfies this.
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct VariationAxis {
    id: String,
    tag: String,
    name: String,
    role: VariationAxisRole,
    axis_type: VariationAxisType,
    #[tsify(optional)]
    minimum: Option<f64>,
    default: f64,
    #[tsify(optional)]
    maximum: Option<f64>,
    #[tsify(optional)]
    values: Option<Vec<f64>>,
}

#[derive(Deserialize, Tsify)]
#[serde(rename_all = "lowercase")]
pub enum VariationAxisRole {
    External,
    Internal,
}

#[derive(Deserialize, Tsify)]
#[serde(rename_all = "lowercase")]
pub enum VariationAxisType {
    Continuous,
    Discrete,
}

/// Axes in order.
#[derive(Deserialize, Tsify)]
#[serde(transparent)]
pub struct VariationAxes(pub(crate) Vec<VariationAxis>);

/// A font's compiled axis mappings, in order.
#[derive(Deserialize, Tsify)]
#[serde(transparent)]
pub struct AxisMappingBases(Vec<AxisMappingBasisData>);

/// One axis's support within a region, normalized.
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct VariationSupport {
    axis_id: String,
    lower: f64,
    peak: f64,
    upper: f64,
}

/// One contribution: a region and the values it adds there.
#[derive(Deserialize, Tsify)]
pub struct VariationBasisDelta {
    region: Vec<VariationSupport>,
    #[tsify(type = "Float64Array | number[]")]
    values: Vec<f64>,
}

/// A variation basis Rust compiled.
#[derive(Deserialize, Tsify)]
pub struct VariationBasisData {
    deltas: Vec<VariationBasisDelta>,
}

/// Design-space bounds that normalize one axis for interpolation.
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct VariationDesignNormalization {
    axis_id: String,
    minimum: f64,
    default: f64,
    maximum: f64,
}

/// Source weights Rust compiled for an ordered source set.
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct InterpolationBasisData {
    source_ids: Vec<String>,
    basis: VariationBasisData,
    design_normalization: Vec<VariationDesignNormalization>,
}

/// An axis mapping Rust compiled.
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct AxisMappingBasisData {
    mapping_id: String,
    input_axis_ids: Vec<String>,
    output_axis_ids: Vec<String>,
    basis: VariationBasisData,
}

/// Registered values by handle; a released handle is reused.
struct Registry<T> {
    entries: Vec<Option<T>>,
    free: Vec<u32>,
}

impl<T> Registry<T> {
    const fn new() -> Self {
        Self {
            entries: Vec::new(),
            free: Vec::new(),
        }
    }

    fn insert(&mut self, value: T) -> u32 {
        if let Some(handle) = self.free.pop() {
            self.entries[handle as usize] = Some(value);
            return handle;
        }
        self.entries.push(Some(value));
        (self.entries.len() - 1) as u32
    }

    fn get(&self, handle: u32) -> Option<&T> {
        self.entries.get(handle as usize)?.as_ref()
    }

    fn remove(&mut self, handle: u32) {
        if let Some(entry) = self.entries.get_mut(handle as usize)
            && entry.take().is_some()
        {
            self.free.push(handle);
        }
    }
}

thread_local! {
    static AXES: RefCell<Registry<Vec<Axis>>> = const { RefCell::new(Registry::new()) };
    static BASES: RefCell<Registry<VariationBasis>> = const { RefCell::new(Registry::new()) };
    static INTERPOLATIONS: RefCell<Registry<InterpolationBasis>> = const { RefCell::new(Registry::new()) };
    static MAPPINGS: RefCell<Registry<Vec<AxisMappingBasis>>> = const { RefCell::new(Registry::new()) };
}

/// Registers axes in order, for locations passed as numbers in that order.
#[wasm_bindgen(js_name = registerAxes)]
pub fn register_axes(axes: Ts<VariationAxes>) -> Result<u32, JsError> {
    let axes = axes.to_rust()?.0.into_iter().map(axis).collect();
    Ok(AXES.with_borrow_mut(|registry| registry.insert(axes)))
}

/// Registers a variation basis evaluated with each axis's own range.
#[wasm_bindgen(js_name = registerVariationBasis)]
pub fn register_variation_basis(basis: Ts<VariationBasisData>) -> Result<u32, JsError> {
    let basis = variation_basis(basis.to_rust()?);
    Ok(BASES.with_borrow_mut(|registry| registry.insert(basis)))
}

/// Registers an interpolation basis.
#[wasm_bindgen(js_name = registerInterpolationBasis)]
pub fn register_interpolation_basis(basis: Ts<InterpolationBasisData>) -> Result<u32, JsError> {
    let data = basis.to_rust()?;
    let basis = InterpolationBasis::new(
        data.source_ids
            .into_iter()
            .map(SourceId::from_raw)
            .collect(),
        variation_basis(data.basis),
        data.design_normalization
            .into_iter()
            .map(|normalization| DesignNormalization {
                axis_id: AxisId::from_raw(normalization.axis_id),
                minimum: normalization.minimum,
                default: normalization.default,
                maximum: normalization.maximum,
            })
            .collect(),
    );
    Ok(INTERPOLATIONS.with_borrow_mut(|registry| registry.insert(basis)))
}

/// Registers a font's axis mappings, in order.
#[wasm_bindgen(js_name = registerAxisMappings)]
pub fn register_axis_mappings(bases: Ts<AxisMappingBases>) -> Result<u32, JsError> {
    let bases = bases
        .to_rust()?
        .0
        .into_iter()
        .map(|data| {
            AxisMappingBasis::new(
                AxisMappingId::from_raw(data.mapping_id),
                data.input_axis_ids
                    .into_iter()
                    .map(AxisId::from_raw)
                    .collect(),
                data.output_axis_ids
                    .into_iter()
                    .map(AxisId::from_raw)
                    .collect(),
                variation_basis(data.basis),
            )
        })
        .collect();
    Ok(MAPPINGS.with_borrow_mut(|registry| registry.insert(bases)))
}

#[wasm_bindgen(js_name = releaseAxes)]
pub fn release_axes(handle: u32) {
    AXES.with_borrow_mut(|registry| registry.remove(handle));
}

#[wasm_bindgen(js_name = releaseVariationBasis)]
pub fn release_variation_basis(handle: u32) {
    BASES.with_borrow_mut(|registry| registry.remove(handle));
}

#[wasm_bindgen(js_name = releaseInterpolationBasis)]
pub fn release_interpolation_basis(handle: u32) {
    INTERPOLATIONS.with_borrow_mut(|registry| registry.remove(handle));
}

#[wasm_bindgen(js_name = releaseAxisMappings)]
pub fn release_axis_mappings(handle: u32) {
    MAPPINGS.with_borrow_mut(|registry| registry.remove(handle));
}

/// One weight per source of an interpolation basis at a design location.
///
/// A region naming an axis the basis or `axes` lack contributes nothing.
#[wasm_bindgen(js_name = interpolationWeights)]
pub fn interpolation_weights(basis: u32, axes: u32, location: &[f64]) -> Vec<f64> {
    with_axes(axes, |axes| {
        INTERPOLATIONS.with_borrow(|registry| {
            let Some(basis) = registry.get(basis) else {
                return Vec::new();
            };
            let location = shift_font::DesignLocation::from_untyped(to_location(axes, location));
            basis
                .weights_at(&location, axes)
                .unwrap_or_else(|_| vec![0.0; basis.source_ids().len()])
        })
    })
}

/// A variation basis's values at a location, normalized by each axis's range.
#[wasm_bindgen(js_name = evaluateVariationBasis)]
pub fn evaluate_variation_basis(basis: u32, axes: u32, location: &[f64]) -> Vec<f64> {
    with_axes(axes, |axes| {
        BASES.with_borrow(|registry| {
            let Some(basis) = registry.get(basis) else {
                return Vec::new();
            };
            let location = to_location(axes, location);
            let count = basis
                .deltas()
                .first()
                .map_or(0, |delta| delta.values().len());
            basis
                .evaluate(&location, axes, None)
                .unwrap_or_else(|_| vec![0.0; count])
        })
    })
}

/// Maps an external location to its design location, in `axes` order.
#[wasm_bindgen(js_name = mapAxisLocation)]
pub fn map_axis_location(mappings: u32, axes: u32, external: &[f64]) -> Vec<f64> {
    with_axes(axes, |axes| {
        MAPPINGS.with_borrow(|registry| {
            let external = ExternalLocation::from_untyped(to_location(axes, external));
            let bases = registry.get(mappings).map_or(&[][..], Vec::as_slice);
            match map_location_with_bases(&external, axes, bases) {
                Ok(design) => from_location(axes, design.as_untyped()),
                // As with an unmapped font: external axes keep their values, internal ones their defaults.
                Err(_) => axes
                    .iter()
                    .map(|axis| match axis.role() {
                        AxisRole::External => external.get(&axis.id()).unwrap_or(axis.default()),
                        AxisRole::Internal => axis.default(),
                    })
                    .collect(),
            }
        })
    })
}

/// Maps a location through one registered mapping; its output axes' values in its output order.
#[wasm_bindgen(js_name = evaluateAxisMapping)]
pub fn evaluate_axis_mapping(mappings: u32, index: u32, axes: u32, location: &[f64]) -> Vec<f64> {
    with_axes(axes, |axes| {
        MAPPINGS.with_borrow(|registry| {
            let Some(basis) = registry
                .get(mappings)
                .and_then(|bases| bases.get(index as usize))
            else {
                return Vec::new();
            };
            let location = to_location(axes, location);
            let mapped = basis.evaluate(&location, axes).unwrap_or_default();
            basis
                .output_axis_ids()
                .iter()
                .map(|axis_id| mapped.get(axis_id).unwrap_or(f64::NAN))
                .collect()
        })
    })
}

/// Converts a normalized coordinate on one registered axis back to its design value.
#[wasm_bindgen(js_name = denormalizeAxis)]
pub fn denormalize_axis(axes: u32, index: u32, value: f64) -> f64 {
    with_axes(axes, |axes| {
        axes.get(index as usize)
            .map_or(value, |axis| axis.denormalize(value))
    })
}

fn with_axes<R>(handle: u32, call: impl FnOnce(&[Axis]) -> R) -> R {
    AXES.with_borrow(|registry| call(registry.get(handle).map_or(&[][..], Vec::as_slice)))
}

pub(crate) fn axis(data: VariationAxis) -> Axis {
    let id = AxisId::from_raw(data.id);
    let mut axis = match data.axis_type {
        VariationAxisType::Discrete => Axis::discrete_with_id(
            id,
            data.tag,
            data.name,
            data.values.unwrap_or_else(|| vec![data.default]),
            data.default,
        ),
        VariationAxisType::Continuous => Axis::continuous_with_id(
            id,
            data.tag,
            data.name,
            data.minimum.unwrap_or(data.default),
            data.default,
            data.maximum.unwrap_or(data.default),
        ),
    };
    axis.set_role(match data.role {
        VariationAxisRole::External => AxisRole::External,
        VariationAxisRole::Internal => AxisRole::Internal,
    });
    axis
}

fn variation_basis(data: VariationBasisData) -> VariationBasis {
    VariationBasis::new(
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
                                    AxisId::from_raw(support.axis_id),
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

fn to_location(axes: &[Axis], values: &[f64]) -> Location {
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
        .map(|axis| location.get(&axis.id()).unwrap_or(f64::NAN))
        .collect()
}
