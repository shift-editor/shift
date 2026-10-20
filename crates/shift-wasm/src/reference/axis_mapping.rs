//! Axis mappings compiled and applied from their authored points.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use shift_font::ir::variation::map_location;
use shift_font::{
    Axis, AxisId, AxisMapping, AxisMappingBasis, AxisMappingId, AxisMappingPoint, ExternalLocation,
    Location,
};
use tsify::{Ts, Tsify};
use wasm_bindgen::prelude::*;

use crate::variation::{VariationAxes, axis};

/// Authored axis mappings; the editor's `AxisMapping[]` satisfies this.
#[derive(Deserialize, Tsify)]
#[serde(transparent)]
pub struct ReferenceAxisMappings(Vec<ReferenceAxisMapping>);

#[derive(Deserialize, Tsify)]
pub struct ReferenceAxisMapping {
    id: String,
    name: String,
    inputs: Vec<String>,
    outputs: Vec<String>,
    points: Vec<ReferenceAxisMappingPoint>,
}

#[derive(Deserialize, Tsify)]
pub struct ReferenceAxisMappingPoint {
    input: ReferenceLocation,
    output: ReferenceLocation,
}

#[derive(Deserialize, Tsify)]
pub struct ReferenceLocation {
    #[tsify(type = "Readonly<Record<string, number>>")]
    values: HashMap<String, f64>,
}

/// A location as one value per axis id.
#[derive(Deserialize, Tsify)]
#[serde(transparent)]
pub struct ReferenceAxisValues(
    #[tsify(type = "Readonly<Record<string, number>>")] HashMap<String, f64>,
);

/// A design location, one entry per axis it sets.
#[derive(Serialize, Tsify)]
#[serde(transparent)]
pub struct ReferenceAxisLocation(Vec<ReferenceAxisValue>);

#[derive(Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceAxisValue {
    axis_id: String,
    value: f64,
}

/// Compiled mappings, in the order given.
#[derive(Serialize, Tsify)]
#[serde(transparent)]
pub struct ReferenceAxisMappingBases(Vec<ReferenceAxisMappingBasis>);

/// A compiled mapping, shaped as the editor's `AxisMappingBasis`.
#[derive(Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceAxisMappingBasis {
    mapping_id: String,
    input_axis_ids: Vec<String>,
    output_axis_ids: Vec<String>,
    basis: ReferenceVariationBasis,
}

#[derive(Serialize, Tsify)]
pub struct ReferenceVariationBasis {
    deltas: Vec<ReferenceVariationDelta>,
}

#[derive(Serialize, Tsify)]
pub struct ReferenceVariationDelta {
    region: Vec<ReferenceSupport>,
    values: Vec<f64>,
}

#[derive(Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceSupport {
    axis_id: String,
    lower: f64,
    peak: f64,
    upper: f64,
}

/// `AxisMappingBasis::try_from` for each mapping, as the bridge sends them.
#[wasm_bindgen(js_name = compileAxisMappings)]
pub fn compile_axis_mappings(
    axes: Ts<VariationAxes>,
    mappings: Ts<ReferenceAxisMappings>,
) -> Result<Ts<ReferenceAxisMappingBases>, JsError> {
    let axes = axes_from(axes)?;
    let bases = mappings
        .to_rust()?
        .0
        .into_iter()
        .map(|data| {
            let basis = AxisMappingBasis::try_from((&mapping(data), axes.as_slice()))?;
            Ok(ReferenceAxisMappingBasis::from(&basis))
        })
        .collect::<Result<Vec<_>, JsError>>()?;
    Ok(ReferenceAxisMappingBases(bases).into_ts()?)
}

/// `map_location`: an external location through the authored mappings to a
/// design location, one value per axis it sets.
#[wasm_bindgen(js_name = mapLocation)]
pub fn map_location_in(
    axes: Ts<VariationAxes>,
    mappings: Ts<ReferenceAxisMappings>,
    location: Ts<ReferenceAxisValues>,
) -> Result<Ts<ReferenceAxisLocation>, JsError> {
    let axes = axes_from(axes)?;
    let mappings: Vec<_> = mappings.to_rust()?.0.into_iter().map(mapping).collect();
    let external = ExternalLocation::from_untyped(location_from(location.to_rust()?.0));
    let design = map_location(&external, &axes, &mappings)?;
    let values: Vec<_> = design
        .as_untyped()
        .iter()
        .map(|(axis_id, value)| ReferenceAxisValue {
            axis_id: axis_id.to_string(),
            value: *value,
        })
        .collect();
    Ok(ReferenceAxisLocation(values).into_ts()?)
}

fn axes_from(axes: Ts<VariationAxes>) -> Result<Vec<Axis>, JsError> {
    Ok(axes.to_rust()?.0.into_iter().map(axis).collect())
}

fn mapping(data: ReferenceAxisMapping) -> AxisMapping {
    let ids = |ids: Vec<String>| ids.into_iter().map(AxisId::from_raw).collect();
    AxisMapping::with_id(
        AxisMappingId::from_raw(data.id),
        data.name,
        ids(data.inputs),
        ids(data.outputs),
        data.points
            .into_iter()
            .map(|point| AxisMappingPoint {
                description: None,
                input: location_from(point.input.values),
                output: location_from(point.output.values),
            })
            .collect(),
    )
}

fn location_from(values: HashMap<String, f64>) -> Location {
    let location: Location = values
        .into_iter()
        .map(|(axis_id, value)| (AxisId::from_raw(axis_id), value))
        .collect();
    location
}

impl From<&AxisMappingBasis> for ReferenceAxisMappingBasis {
    fn from(basis: &AxisMappingBasis) -> Self {
        let ids = |ids: &[AxisId]| ids.iter().map(ToString::to_string).collect();
        Self {
            mapping_id: basis.mapping_id().to_string(),
            input_axis_ids: ids(basis.input_axis_ids()),
            output_axis_ids: ids(basis.output_axis_ids()),
            basis: ReferenceVariationBasis {
                deltas: basis
                    .basis()
                    .deltas()
                    .iter()
                    .map(|delta| ReferenceVariationDelta {
                        region: delta
                            .region()
                            .supports()
                            .iter()
                            .map(|support| ReferenceSupport {
                                axis_id: support.axis_id().to_string(),
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
    }
}
