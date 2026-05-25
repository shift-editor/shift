use std::str::FromStr;

pub use fontdrasil::{
    coords::{NormalizedCoord, NormalizedLocation},
    types::Tag,
    variations::{ModelDeltas, RoundingBehaviour, VariationModel},
};
use std::collections::{HashMap, HashSet};
use std::fmt;

use crate::{Axis, Location};

pub fn to_fd_location(loc: &Location, axes: &[Axis]) -> NormalizedLocation {
    let mut result = NormalizedLocation::new();

    for axis in axes {
        let value = loc.get(axis.tag()).unwrap_or(axis.default());
        let n = axis.normalize(value);
        let Ok(tag) = Tag::from_str(axis.tag()) else {
            continue;
        };

        result.insert(tag, NormalizedCoord::new(n));
    }

    result
}

pub fn normalized_location_from_values<'a>(
    axis_tags: impl IntoIterator<Item = &'a str>,
    values: impl Fn(&str) -> f64,
) -> NormalizedLocation {
    let mut result = NormalizedLocation::new();

    for axis_tag in axis_tags {
        let Ok(tag) = Tag::from_str(axis_tag) else {
            continue;
        };
        result.insert(tag, NormalizedCoord::new(values(axis_tag)));
    }

    result
}

pub fn variation_axis_order<'a>(axis_tags: impl IntoIterator<Item = &'a str>) -> Vec<Tag> {
    axis_tags
        .into_iter()
        .filter_map(|axis_tag| Tag::from_str(axis_tag).ok())
        .collect()
}

#[derive(Clone, PartialEq)]
pub struct NormalizedF64VariationModel {
    model: VariationModel,
    deltas: ModelDeltas<f64>,
}

#[derive(Clone, PartialEq)]
pub struct NormalizedF64VariationSpace {
    model: VariationModel,
}

impl fmt::Debug for NormalizedF64VariationSpace {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("NormalizedF64VariationSpace")
            .field("axis_order", &self.model.axis_order())
            .field("location_count", &self.model.num_locations())
            .finish()
    }
}

impl fmt::Debug for NormalizedF64VariationModel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("NormalizedF64VariationModel")
            .field("axis_order", &self.model.axis_order())
            .field("location_count", &self.model.num_locations())
            .field("delta_count", &self.deltas.len())
            .finish()
    }
}

impl NormalizedF64VariationSpace {
    pub fn new(
        locations: impl IntoIterator<Item = NormalizedLocation>,
        axis_order: Vec<Tag>,
    ) -> Self {
        Self {
            model: VariationModel::new(locations.into_iter().collect::<HashSet<_>>(), axis_order),
        }
    }

    pub fn from_points(
        points: &HashMap<NormalizedLocation, Vec<f64>>,
        axis_order: Vec<Tag>,
    ) -> Self {
        Self::new(points.keys().cloned(), axis_order)
    }

    pub fn build_deltas(
        &self,
        points: &HashMap<NormalizedLocation, Vec<f64>>,
        rounding: RoundingBehaviour,
    ) -> Result<ModelDeltas<f64>, String> {
        self.model
            .deltas_with_rounding::<f64, f64>(points, rounding)
            .map_err(|error| error.to_string())
    }

    pub fn interpolate(
        &self,
        points: &HashMap<NormalizedLocation, Vec<f64>>,
        rounding: RoundingBehaviour,
        location: &NormalizedLocation,
    ) -> Result<Vec<f64>, String> {
        let deltas = self.build_deltas(points, rounding)?;
        Ok(self.interpolate_from_deltas(location, &deltas))
    }

    pub fn interpolate_from_deltas(
        &self,
        location: &NormalizedLocation,
        deltas: &ModelDeltas<f64>,
    ) -> Vec<f64> {
        self.model.interpolate_from_deltas(location, deltas)
    }

    pub fn num_locations(&self) -> usize {
        self.model.num_locations()
    }
}

impl NormalizedF64VariationModel {
    pub fn new(
        points: &HashMap<NormalizedLocation, Vec<f64>>,
        axis_order: Vec<Tag>,
        rounding: RoundingBehaviour,
    ) -> Result<Self, String> {
        let space = NormalizedF64VariationSpace::from_points(points, axis_order);
        let deltas = space.build_deltas(points, rounding)?;

        Ok(Self {
            model: space.model,
            deltas,
        })
    }

    pub fn interpolate(&self, location: &NormalizedLocation) -> Vec<f64> {
        self.model.interpolate_from_deltas(location, &self.deltas)
    }

    pub fn deltas(&self) -> &ModelDeltas<f64> {
        &self.deltas
    }

    pub fn into_deltas(self) -> ModelDeltas<f64> {
        self.deltas
    }
}

pub fn interpolate_normalized_f64_values(
    points: &HashMap<NormalizedLocation, Vec<f64>>,
    axis_order: Vec<Tag>,
    location: &NormalizedLocation,
) -> Result<Vec<f64>, String> {
    let model = NormalizedF64VariationModel::new(points, axis_order, RoundingBehaviour::None)?;
    Ok(model.interpolate(location))
}

pub fn build_normalized_f64_deltas(
    points: &HashMap<NormalizedLocation, Vec<f64>>,
    axis_order: Vec<Tag>,
    rounding: RoundingBehaviour,
) -> Result<ModelDeltas<f64>, String> {
    Ok(NormalizedF64VariationModel::new(points, axis_order, rounding)?.into_deltas())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interpolates_normalized_f64_values_with_fontdrasil_model() {
        let axis_order = variation_axis_order(["wght"]);
        let default_location = normalized_location_from_values(["wght"], |_| 0.0);
        let bold_location = normalized_location_from_values(["wght"], |_| 1.0);
        let mid_location = normalized_location_from_values(["wght"], |_| 0.5);
        let mut points = HashMap::new();
        points.insert(default_location, vec![10.0, 20.0]);
        points.insert(bold_location, vec![30.0, 60.0]);

        let values = interpolate_normalized_f64_values(&points, axis_order, &mid_location).unwrap();

        assert_eq!(values, vec![20.0, 40.0]);
    }

    #[test]
    fn normalized_f64_variation_model_can_be_reused_for_multiple_locations() {
        let axis_order = variation_axis_order(["wght"]);
        let default_location = normalized_location_from_values(["wght"], |_| 0.0);
        let bold_location = normalized_location_from_values(["wght"], |_| 1.0);
        let quarter_location = normalized_location_from_values(["wght"], |_| 0.25);
        let three_quarter_location = normalized_location_from_values(["wght"], |_| 0.75);
        let mut points = HashMap::new();
        points.insert(default_location, vec![0.0, 100.0]);
        points.insert(bold_location, vec![40.0, 20.0]);

        let model =
            NormalizedF64VariationModel::new(&points, axis_order, RoundingBehaviour::None).unwrap();

        assert_eq!(model.interpolate(&quarter_location), vec![10.0, 80.0]);
        assert_eq!(model.interpolate(&three_quarter_location), vec![30.0, 40.0]);
    }

    #[test]
    fn normalized_f64_variation_space_can_reuse_regions_with_new_values() {
        let axis_order = variation_axis_order(["wght"]);
        let default_location = normalized_location_from_values(["wght"], |_| 0.0);
        let bold_location = normalized_location_from_values(["wght"], |_| 1.0);
        let mid_location = normalized_location_from_values(["wght"], |_| 0.5);
        let space = NormalizedF64VariationSpace::new(
            [default_location.clone(), bold_location.clone()],
            axis_order,
        );
        let mut first_points = HashMap::new();
        first_points.insert(default_location.clone(), vec![0.0, 100.0]);
        first_points.insert(bold_location.clone(), vec![40.0, 20.0]);
        let mut second_points = HashMap::new();
        second_points.insert(default_location, vec![10.0, 200.0]);
        second_points.insert(bold_location, vec![30.0, 100.0]);

        assert_eq!(
            space
                .interpolate(&first_points, RoundingBehaviour::None, &mid_location)
                .unwrap(),
            vec![20.0, 60.0]
        );
        assert_eq!(
            space
                .interpolate(&second_points, RoundingBehaviour::None, &mid_location)
                .unwrap(),
            vec![20.0, 150.0]
        );
    }
}
