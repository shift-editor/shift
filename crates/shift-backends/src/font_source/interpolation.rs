use std::collections::{hash_map::Entry, HashMap, HashSet};
use std::str::FromStr;

use fontdrasil::coords::{NormalizedCoord, NormalizedLocation};
use fontdrasil::types::Tag;
use fontdrasil::variations::{RoundingBehaviour, VariationModel};

#[derive(Clone, Debug)]
pub(crate) struct InterpolationAxis {
    pub(crate) tag: String,
    pub(crate) minimum: f64,
    pub(crate) default: f64,
    pub(crate) maximum: f64,
}

pub(crate) fn interpolation_weights(
    source_locations: &[Vec<f64>],
    axes: &[InterpolationAxis],
    location: &[f64],
) -> Option<Vec<f64>> {
    if source_locations.is_empty()
        || axes.len() != location.len()
        || source_locations
            .iter()
            .any(|source| source.len() != axes.len())
    {
        return None;
    }
    if source_locations.len() == 1 {
        return Some(vec![1.0]);
    }

    let tags = axes
        .iter()
        .map(|axis| Tag::from_str(&axis.tag).ok())
        .collect::<Option<Vec<_>>>()?;
    let normalized_sources = source_locations
        .iter()
        .map(|source| normalized_location(source, axes, &tags))
        .collect::<Vec<_>>();
    let mut samples = HashMap::new();
    for (index, source) in normalized_sources.iter().enumerate() {
        let mut unit = vec![0.0; source_locations.len()];
        unit[index] = 1.0;
        if samples.insert(source.clone(), unit).is_some() {
            return None;
        }
    }

    let default_location = normalized_location(
        &axes.iter().map(|axis| axis.default).collect::<Vec<_>>(),
        axes,
        &tags,
    );
    if let Entry::Vacant(entry) = samples.entry(default_location) {
        entry.insert(virtual_default_coefficients(&normalized_sources)?);
    }
    let model = VariationModel::new(
        samples
            .keys()
            .cloned()
            .collect::<HashSet<NormalizedLocation>>(),
        tags.clone(),
    );
    let deltas = model
        .deltas_with_rounding::<f64, f64>(&samples, RoundingBehaviour::None)
        .ok()?;
    let target = normalized_location(location, axes, &tags);
    Some(model.interpolate_from_deltas(&target, &deltas))
}

fn normalized_location(
    location: &[f64],
    axes: &[InterpolationAxis],
    tags: &[Tag],
) -> NormalizedLocation {
    axes.iter()
        .zip(location)
        .zip(tags)
        .map(|((axis, value), tag)| (*tag, NormalizedCoord::new(normalize(axis, *value))))
        .collect()
}

fn normalize(axis: &InterpolationAxis, value: f64) -> f64 {
    if value == axis.default {
        return 0.0;
    }
    if value < axis.default {
        let span = axis.default - axis.minimum;
        return if span == 0.0 {
            0.0
        } else {
            ((value - axis.default) / span).max(-1.0)
        };
    }

    let span = axis.maximum - axis.default;
    if span == 0.0 {
        0.0
    } else {
        ((value - axis.default) / span).min(1.0)
    }
}

fn virtual_default_coefficients(sources: &[NormalizedLocation]) -> Option<Vec<f64>> {
    let mut negative: Option<(usize, Tag, f64)> = None;
    let mut positive: Option<(usize, Tag, f64)> = None;

    for (index, location) in sources.iter().enumerate() {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interpolates_two_source_values_in_source_order() {
        let axes = [InterpolationAxis {
            tag: "wght".into(),
            minimum: 100.0,
            default: 400.0,
            maximum: 900.0,
        }];
        let weights = interpolation_weights(&[vec![400.0], vec![900.0]], &axes, &[650.0]).unwrap();

        assert!((weights[0] - 0.5).abs() < 1e-9);
        assert!((weights[1] - 0.5).abs() < 1e-9);
    }
}
