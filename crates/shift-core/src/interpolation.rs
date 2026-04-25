use std::collections::{HashMap, HashSet};
use std::str::FromStr;

use fontdrasil::coords::NormalizedLocation;
use fontdrasil::types::Tag;
use fontdrasil::variations::VariationModel;
use serde::{Deserialize, Serialize};
use shift_ir::variation::to_fd_location;
use shift_ir::{Axis, Location};

use crate::snapshot::{GlyphGeometry, MasterSnapshot};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InterpolationResult {
    pub geometry: GlyphGeometry,
    pub errors: Vec<SourceError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceError {
    pub source_index: usize,
    pub source_name: String,
    pub message: String,
}

fn flatten(geom: &GlyphGeometry) -> Vec<f64> {
    let mut values = vec![geom.x_advance];
    for contour in &geom.contours {
        for point in &contour.points {
            values.push(point.x);
            values.push(point.y);
        }
    }
    for anchor in &geom.anchors {
        values.push(anchor.x);
        values.push(anchor.y);
    }
    values
}

fn reconstruct(template: &GlyphGeometry, values: &[f64]) -> GlyphGeometry {
    let mut result = template.clone();
    let mut idx = 0;

    result.x_advance = values[idx];
    idx += 1;

    for contour in &mut result.contours {
        for point in &mut contour.points {
            point.x = values[idx];
            idx += 1;
            point.y = values[idx];
            idx += 1;
        }
    }

    for anchor in &mut result.anchors {
        anchor.x = values[idx];
        idx += 1;
        anchor.y = values[idx];
        idx += 1;
    }

    result
}

fn check_compatibility(a: &GlyphGeometry, b: &GlyphGeometry) -> Result<(), String> {
    if a.contours.len() != b.contours.len() {
        return Err(format!(
            "contour count mismatch: {} vs {}",
            a.contours.len(),
            b.contours.len()
        ));
    }
    for (i, (ca, cb)) in a.contours.iter().zip(b.contours.iter()).enumerate() {
        if ca.points.len() != cb.points.len() {
            return Err(format!(
                "contour {} point count mismatch: {} vs {}",
                i,
                ca.points.len(),
                cb.points.len()
            ));
        }
    }
    if a.anchors.len() != b.anchors.len() {
        return Err(format!(
            "anchor count mismatch: {} vs {}",
            a.anchors.len(),
            b.anchors.len()
        ));
    }
    Ok(())
}

pub fn interpolate_glyph(
    masters: &[MasterSnapshot],
    axes: &[Axis],
    target: &Location,
) -> Option<InterpolationResult> {
    if masters.len() < 2 {
        return None;
    }

    let ordered_axes: Vec<Tag> = axes
        .iter()
        .filter_map(|a| Tag::from_str(a.tag()).ok())
        .collect();

    let default_master = masters
        .iter()
        .find(|master| master.location.is_default_axis(axes))?;

    let mut errors = Vec::new();
    let mut points: HashMap<NormalizedLocation, Vec<f64>> = HashMap::new();
    for (source_index, master) in masters.iter().enumerate() {
        match check_compatibility(&master.geometry, &default_master.geometry) {
            Ok(()) => {
                let loc = to_fd_location(&master.location, axes);
                points.insert(loc, flatten(&master.geometry));
            }
            Err(message) => {
                errors.push(SourceError {
                    source_index,
                    source_name: master.source_name.clone(),
                    message,
                });
            }
        }
    }

    let locations_set: HashSet<NormalizedLocation> = points.keys().cloned().collect();
    let model = VariationModel::new(locations_set, ordered_axes);
    let deltas = model.deltas::<f64, f64>(&points).ok()?;

    let target_fd = to_fd_location(target, axes);
    let result_values: Vec<f64> = model.interpolate_from_deltas(&target_fd, &deltas);
    let geometry = reconstruct(&default_master.geometry, &result_values);

    Some(InterpolationResult { geometry, errors })
}
