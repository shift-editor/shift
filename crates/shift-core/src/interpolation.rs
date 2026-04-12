use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::snapshot::{GlyphSnapshot, MasterSnapshot};
use crate::{Axis, Location};

type SparseLocation = HashMap<String, f64>;
type Support = HashMap<String, (f64, f64, f64)>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InterpolationResult {
    pub instance: GlyphSnapshot,
    pub errors: Vec<SourceError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceError {
    pub source_index: usize,
    pub source_name: String,
    pub message: String,
}

struct VariationModelData {
    mapping: Vec<usize>,
    supports: Vec<Support>,
    delta_weights: Vec<Vec<(usize, f64)>>,
}

// --- Normalization ---

fn normalize_axis_value(value: f64, axis: &Axis) -> f64 {
    if value < axis.default() {
        let range = axis.default() - axis.minimum();
        if range.abs() < f64::EPSILON {
            return 0.0;
        }
        (value - axis.default()) / range
    } else if value > axis.default() {
        let range = axis.maximum() - axis.default();
        if range.abs() < f64::EPSILON {
            return 0.0;
        }
        (value - axis.default()) / range
    } else {
        0.0
    }
}

fn normalize_location(location: &Location, axes: &[Axis]) -> SparseLocation {
    let mut result = SparseLocation::new();
    for axis in axes {
        let value = location.get(axis.tag()).unwrap_or(axis.default());
        let n = normalize_axis_value(value, axis);
        if n.abs() > 1e-14 {
            result.insert(axis.tag().to_string(), n);
        }
    }
    result
}

// --- Support scalar ---

fn support_scalar(location: &SparseLocation, support: &Support) -> f64 {
    let mut scalar = 1.0;
    for (tag, &(lower, peak, upper)) in support {
        let loc_val = location.get(tag).copied().unwrap_or(0.0);
        if peak.abs() < f64::EPSILON {
            if loc_val.abs() > f64::EPSILON {
                return 0.0;
            }
            continue;
        }
        if loc_val < lower || loc_val > upper {
            return 0.0;
        }
        if (loc_val - peak).abs() < f64::EPSILON {
            continue;
        }
        if loc_val < peak {
            if (peak - lower).abs() < f64::EPSILON {
                return 0.0;
            }
            scalar *= (loc_val - lower) / (peak - lower);
        } else {
            if (upper - peak).abs() < f64::EPSILON {
                return 0.0;
            }
            scalar *= (upper - loc_val) / (upper - peak);
        }
    }
    scalar
}

// --- VariationModel construction ---
// Ported from fontTools varLib.models.VariationModel._supports()

/// Build support regions for each master location.
///
/// Each support is a sparse map of axis tag → (lower, peak, upper) tent.
/// Only axes where the master deviates from the default (peak != 0) are included.
/// The default master (at origin) has an EMPTY support, giving scalar 1.0 everywhere.
fn build_supports(sorted_locations: &[SparseLocation]) -> Vec<Support> {
    let mut supports = Vec::with_capacity(sorted_locations.len());

    for (i, loc) in sorted_locations.iter().enumerate() {
        let mut min_v: HashMap<String, f64> = HashMap::new();
        let mut max_v: HashMap<String, f64> = HashMap::new();

        // Look at previous locations that share the same set of axes
        for prev_loc in &sorted_locations[..i] {
            let loc_keys: HashSet<&String> = loc.keys().collect();
            let prev_keys: HashSet<&String> = prev_loc.keys().collect();
            if loc_keys != prev_keys {
                continue;
            }

            for (axis, &val) in prev_loc {
                let loc_val = loc.get(axis).copied().unwrap_or(0.0);
                // Only consider previous locations on the same side of origin
                if val * loc_val > 0.0 {
                    if val > loc_val {
                        let entry = min_v.entry(axis.clone()).or_insert(val);
                        if val < *entry {
                            *entry = val;
                        }
                    } else if val < loc_val {
                        let entry = max_v.entry(axis.clone()).or_insert(val);
                        if val > *entry {
                            *entry = val;
                        }
                    }
                }
            }
        }

        let mut support = Support::new();
        for (axis, &val) in loc {
            let (lower, upper) = if val > 0.0 {
                (
                    *min_v.get(axis).unwrap_or(&0.0),
                    *max_v.get(axis).unwrap_or(&val),
                )
            } else {
                (
                    *min_v.get(axis).unwrap_or(&val),
                    *max_v.get(axis).unwrap_or(&0.0),
                )
            };
            support.insert(axis.clone(), (lower, val, upper));
        }

        supports.push(support);
    }

    supports
}

fn build_variation_model(
    locations: &[SparseLocation],
    axis_order: &[String],
) -> VariationModelData {
    let n = locations.len();

    let all_axis_points: HashMap<String, HashSet<i64>> = {
        let mut map: HashMap<String, HashSet<i64>> = HashMap::new();
        for loc in locations {
            for (tag, &val) in loc {
                map.entry(tag.clone())
                    .or_default()
                    .insert((val * 1e9) as i64);
            }
        }
        map
    };

    let axis_index = |tag: &str| -> usize {
        axis_order
            .iter()
            .position(|t| t == tag)
            .unwrap_or(usize::MAX)
    };

    type SortKey = (usize, usize, usize, Vec<(usize, i64, i64)>);

    // Decorate each location for sorting
    let mut decorated: Vec<SortKey> = locations
        .iter()
        .enumerate()
        .map(|(orig_idx, loc)| {
            let rank = loc.len();
            let on_point_axes = loc
                .iter()
                .filter(|(tag, _)| all_axis_points.get(*tag).is_some_and(|pts| pts.len() == 1))
                .count();

            let mut axis_keys: Vec<(usize, i64, i64)> = loc
                .iter()
                .map(|(tag, &val)| {
                    let idx = axis_index(tag);
                    let sign = if val > 0.0 { 0 } else { 1 };
                    let magnitude = (val.abs() * 1e9) as i64;
                    (idx, sign, magnitude)
                })
                .collect();
            axis_keys.sort();

            (orig_idx, rank, on_point_axes, axis_keys)
        })
        .collect();

    decorated.sort_by(|a, b| a.1.cmp(&b.1).then(a.2.cmp(&b.2)).then(a.3.cmp(&b.3)));

    let mapping: Vec<usize> = decorated.iter().map(|(orig, _, _, _)| *orig).collect();
    let sorted_locations: Vec<SparseLocation> =
        mapping.iter().map(|&i| locations[i].clone()).collect();

    let supports = build_supports(&sorted_locations);

    // Compute delta weights
    let delta_weights: Vec<Vec<(usize, f64)>> = (0..n)
        .map(|i| {
            let mut weights = Vec::new();
            for (j, support) in supports.iter().enumerate().take(i) {
                let scalar = support_scalar(&sorted_locations[i], support);
                if scalar.abs() > f64::EPSILON {
                    weights.push((j, scalar));
                }
            }
            weights
        })
        .collect();

    VariationModelData {
        mapping,
        supports,
        delta_weights,
    }
}

// --- Snapshot flattening ---

fn flatten_snapshot(snap: &GlyphSnapshot) -> Vec<f64> {
    let mut values = vec![snap.x_advance];
    for contour in &snap.contours {
        for point in &contour.points {
            values.push(point.x);
            values.push(point.y);
        }
    }
    for anchor in &snap.anchors {
        values.push(anchor.x);
        values.push(anchor.y);
    }
    values
}

fn reconstruct_snapshot(template: &GlyphSnapshot, values: &[f64]) -> GlyphSnapshot {
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

fn check_compatibility(a: &GlyphSnapshot, b: &GlyphSnapshot) -> Result<(), String> {
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

// --- Itemwise arithmetic ---

fn sub_values(a: &[f64], b: &[f64]) -> Vec<f64> {
    a.iter().zip(b.iter()).map(|(x, y)| x - y).collect()
}

fn add_values(a: &[f64], b: &[f64]) -> Vec<f64> {
    a.iter().zip(b.iter()).map(|(x, y)| x + y).collect()
}

fn mul_scalar_values(a: &[f64], s: f64) -> Vec<f64> {
    a.iter().map(|x| x * s).collect()
}

fn zero_values(len: usize) -> Vec<f64> {
    vec![0.0; len]
}

// --- Main entry point ---

fn location_to_key(loc: &SparseLocation) -> String {
    let mut keys: Vec<_> = loc.iter().collect();
    keys.sort_by(|a, b| a.0.cmp(b.0));
    keys.iter()
        .map(|(k, v)| format!("{k}:{v:.10}"))
        .collect::<Vec<_>>()
        .join(",")
}

pub fn interpolate_glyph(
    masters: &[MasterSnapshot],
    axes: &[Axis],
    target: &Location,
) -> Option<InterpolationResult> {
    if masters.len() < 2 {
        return None;
    }

    let axis_order: Vec<String> = axes.iter().map(|a| a.tag().to_string()).collect();

    // Normalize all master locations
    let normalized_masters: Vec<(usize, SparseLocation)> = masters
        .iter()
        .enumerate()
        .map(|(i, m)| (i, normalize_location(&m.location, axes)))
        .collect();

    // Check for a default master (at origin)
    let has_default = normalized_masters.iter().any(|(_, loc)| loc.is_empty());
    if !has_default {
        return None;
    }

    // Deduplicate by normalized location
    let mut seen = HashSet::new();
    let deduped: Vec<(usize, SparseLocation)> = normalized_masters
        .into_iter()
        .filter(|(_, loc)| seen.insert(location_to_key(loc)))
        .collect();

    if deduped.len() < 2 {
        return None;
    }

    // Find the default master (first at empty location)
    let default_idx = deduped.iter().position(|(_, loc)| loc.is_empty()).unwrap();
    let default_master = &masters[deduped[default_idx].0];

    // Build the variation model from deduplicated locations
    let model_locations: Vec<SparseLocation> = deduped.iter().map(|(_, loc)| loc.clone()).collect();
    let model = build_variation_model(&model_locations, &axis_order);

    // Flatten the default master to get the value length
    let default_values = flatten_snapshot(&default_master.snapshot);
    let value_len = default_values.len();

    // Compute deltas for each sorted master
    let mut deltas: Vec<Vec<f64>> = Vec::with_capacity(model.mapping.len());
    let mut errors: Vec<SourceError> = Vec::new();

    for (sorted_idx, &orig_model_idx) in model.mapping.iter().enumerate() {
        let master_idx = deduped[orig_model_idx].0;
        let master = &masters[master_idx];

        // Check compatibility with default
        match check_compatibility(&default_master.snapshot, &master.snapshot) {
            Ok(()) => {
                let master_values = flatten_snapshot(&master.snapshot);
                // delta = master_values - sum(delta_weights[j] * deltas[j])
                let mut delta = sub_values(&master_values, &zero_values(value_len));
                for &(prev_sorted, weight) in &model.delta_weights[sorted_idx] {
                    let contribution = mul_scalar_values(&deltas[prev_sorted], weight);
                    delta = sub_values(&delta, &contribution);
                }
                deltas.push(delta);
            }
            Err(msg) => {
                errors.push(SourceError {
                    source_index: master_idx,
                    source_name: master.source_name.clone(),
                    message: msg,
                });
                deltas.push(zero_values(value_len));
            }
        }
    }

    // Interpolate at target location
    let target_normalized = normalize_location(target, axes);
    let mut result_values = zero_values(value_len);
    let mut has_contribution = false;

    for (sorted_idx, support) in model.supports.iter().enumerate() {
        let scalar = support_scalar(&target_normalized, support);
        if scalar.abs() < f64::EPSILON {
            continue;
        }
        let contribution = mul_scalar_values(&deltas[sorted_idx], scalar);
        result_values = add_values(&result_values, &contribution);
        has_contribution = true;
    }

    if !has_contribution {
        return Some(InterpolationResult {
            instance: default_master.snapshot.clone(),
            errors,
        });
    }

    let instance = reconstruct_snapshot(&default_master.snapshot, &result_values);

    Some(InterpolationResult { instance, errors })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::snapshot::{
        AnchorSnapshot, ContourSnapshot, GlyphSnapshot, MasterSnapshot, PointSnapshot, PointType,
    };
    use crate::{Axis, Location};

    fn make_axis(tag: &str, name: &str, min: f64, default: f64, max: f64) -> Axis {
        Axis::new(tag.to_string(), name.to_string(), min, default, max)
    }

    fn make_point(id: &str, x: f64, y: f64) -> PointSnapshot {
        PointSnapshot {
            id: id.to_string(),
            x,
            y,
            point_type: PointType::OnCurve,
            smooth: false,
        }
    }

    fn make_contour(id: &str, points: Vec<PointSnapshot>) -> ContourSnapshot {
        ContourSnapshot {
            id: id.to_string(),
            points,
            closed: true,
        }
    }

    fn make_snapshot(contours: Vec<ContourSnapshot>, x_advance: f64) -> GlyphSnapshot {
        GlyphSnapshot {
            unicode: 65,
            name: "A".to_string(),
            x_advance,
            contours,
            anchors: Vec::new(),
            composite_contours: Vec::new(),
            active_contour_id: None,
        }
    }

    fn make_master(name: &str, location: Location, snapshot: GlyphSnapshot) -> MasterSnapshot {
        MasterSnapshot {
            source_id: name.to_string(),
            source_name: name.to_string(),
            location,
            snapshot,
        }
    }

    // --- normalize_axis_value tests ---

    #[test]
    fn normalize_returns_zero_at_default() {
        let axis = make_axis("wght", "Weight", 100.0, 400.0, 900.0);
        assert!((normalize_axis_value(400.0, &axis)).abs() < f64::EPSILON);
    }

    #[test]
    fn normalize_returns_neg_one_at_min() {
        let axis = make_axis("wght", "Weight", 100.0, 400.0, 900.0);
        assert!((normalize_axis_value(100.0, &axis) - (-1.0)).abs() < 0.001);
    }

    #[test]
    fn normalize_returns_one_at_max() {
        let axis = make_axis("wght", "Weight", 100.0, 400.0, 900.0);
        assert!((normalize_axis_value(900.0, &axis) - 1.0).abs() < 0.001);
    }

    #[test]
    fn normalize_midpoint() {
        let axis = make_axis("wght", "Weight", 100.0, 400.0, 900.0);
        assert!((normalize_axis_value(650.0, &axis) - 0.5).abs() < 0.001);
    }

    // --- check_compatibility tests ---

    #[test]
    fn compatible_masters_pass() {
        let a = make_snapshot(
            vec![make_contour(
                "c1",
                vec![make_point("p1", 0.0, 0.0), make_point("p2", 100.0, 0.0)],
            )],
            500.0,
        );
        let b = make_snapshot(
            vec![make_contour(
                "c1",
                vec![make_point("p1", 0.0, 0.0), make_point("p2", 200.0, 0.0)],
            )],
            600.0,
        );
        assert!(check_compatibility(&a, &b).is_ok());
    }

    #[test]
    fn incompatible_contour_count() {
        let a = make_snapshot(
            vec![make_contour("c1", vec![make_point("p1", 0.0, 0.0)])],
            500.0,
        );
        let b = make_snapshot(Vec::new(), 500.0);
        assert!(check_compatibility(&a, &b).is_err());
    }

    #[test]
    fn incompatible_point_count() {
        let a = make_snapshot(
            vec![make_contour(
                "c1",
                vec![make_point("p1", 0.0, 0.0), make_point("p2", 100.0, 0.0)],
            )],
            500.0,
        );
        let b = make_snapshot(
            vec![make_contour("c1", vec![make_point("p1", 0.0, 0.0)])],
            500.0,
        );
        assert!(check_compatibility(&a, &b).is_err());
    }

    // --- interpolate_glyph tests ---

    fn two_master_setup() -> (Vec<MasterSnapshot>, Vec<Axis>) {
        let axes = vec![make_axis("wght", "Weight", 0.0, 0.0, 1000.0)];

        let light = make_master(
            "Light",
            Location::new(),
            make_snapshot(
                vec![make_contour(
                    "c1",
                    vec![
                        make_point("p1", 0.0, 0.0),
                        make_point("p2", 100.0, 0.0),
                        make_point("p3", 100.0, 100.0),
                    ],
                )],
                400.0,
            ),
        );

        let mut bold_loc = Location::new();
        bold_loc.set("wght".to_string(), 1000.0);
        let bold = make_master(
            "Bold",
            bold_loc,
            make_snapshot(
                vec![make_contour(
                    "c1",
                    vec![
                        make_point("p1", 0.0, 0.0),
                        make_point("p2", 200.0, 0.0),
                        make_point("p3", 200.0, 200.0),
                    ],
                )],
                600.0,
            ),
        );

        (vec![light, bold], axes)
    }

    #[test]
    fn interpolate_midpoint() {
        let (masters, axes) = two_master_setup();
        let mut target = Location::new();
        target.set("wght".to_string(), 500.0);

        let result = interpolate_glyph(&masters, &axes, &target).unwrap();

        assert!((result.instance.x_advance - 500.0).abs() < 0.01);
        assert!((result.instance.contours[0].points[1].x - 150.0).abs() < 0.01);
        assert!((result.instance.contours[0].points[2].y - 150.0).abs() < 0.01);
        assert!(result.errors.is_empty());
    }

    #[test]
    fn interpolate_at_default_returns_default() {
        let (masters, axes) = two_master_setup();
        let target = Location::new(); // default = wght 0

        let result = interpolate_glyph(&masters, &axes, &target).unwrap();

        assert!((result.instance.x_advance - 400.0).abs() < 0.01);
        assert!((result.instance.contours[0].points[1].x - 100.0).abs() < 0.01);
    }

    #[test]
    fn interpolate_at_master_returns_master() {
        let (masters, axes) = two_master_setup();
        let mut target = Location::new();
        target.set("wght".to_string(), 1000.0);

        let result = interpolate_glyph(&masters, &axes, &target).unwrap();

        assert!((result.instance.x_advance - 600.0).abs() < 0.01);
        assert!((result.instance.contours[0].points[1].x - 200.0).abs() < 0.01);
    }

    #[test]
    fn preserves_point_metadata() {
        let (masters, axes) = two_master_setup();
        let mut target = Location::new();
        target.set("wght".to_string(), 500.0);

        let result = interpolate_glyph(&masters, &axes, &target).unwrap();

        assert_eq!(result.instance.contours[0].points[0].id, "p1");
        assert_eq!(result.instance.contours[0].points[1].id, "p2");
        assert_eq!(result.instance.contours[0].id, "c1");
        assert!(matches!(
            result.instance.contours[0].points[0].point_type,
            PointType::OnCurve
        ));
    }

    #[test]
    fn two_axis_four_master_interpolation() {
        let axes = vec![
            make_axis("wdth", "Width", 0.0, 0.0, 1000.0),
            make_axis("wght", "Weight", 0.0, 0.0, 1000.0),
        ];

        let make_single = |x: f64, adv: f64| -> GlyphSnapshot {
            make_snapshot(
                vec![make_contour("c1", vec![make_point("p1", x, 0.0)])],
                adv,
            )
        };

        let m1 = make_master("LightCondensed", Location::new(), make_single(100.0, 400.0));

        let mut loc2 = Location::new();
        loc2.set("wght".to_string(), 1000.0);
        let m2 = make_master("BoldCondensed", loc2, make_single(200.0, 600.0));

        let mut loc3 = Location::new();
        loc3.set("wdth".to_string(), 1000.0);
        let m3 = make_master("LightWide", loc3, make_single(300.0, 800.0));

        let mut loc4 = Location::new();
        loc4.set("wdth".to_string(), 1000.0);
        loc4.set("wght".to_string(), 1000.0);
        let m4 = make_master("BoldWide", loc4, make_single(400.0, 1000.0));

        let masters = vec![m1, m2, m3, m4];
        let mut target = Location::new();
        target.set("wdth".to_string(), 500.0);
        target.set("wght".to_string(), 500.0);

        let result = interpolate_glyph(&masters, &axes, &target).unwrap();

        // Midpoint of all four: (100+200+300+400)/4 = 250
        assert!((result.instance.contours[0].points[0].x - 250.0).abs() < 0.01);
    }

    #[test]
    fn returns_none_for_single_master() {
        let axes = vec![make_axis("wght", "Weight", 0.0, 0.0, 1000.0)];
        let master = make_master("Only", Location::new(), make_snapshot(vec![], 500.0));

        let result = interpolate_glyph(&[master], &axes, &Location::new());
        assert!(result.is_none());
    }

    #[test]
    fn returns_none_without_default_master() {
        let axes = vec![make_axis("wght", "Weight", 0.0, 0.0, 1000.0)];

        let mut loc1 = Location::new();
        loc1.set("wght".to_string(), 500.0);
        let mut loc2 = Location::new();
        loc2.set("wght".to_string(), 1000.0);

        let m1 = make_master("A", loc1, make_snapshot(vec![], 500.0));
        let m2 = make_master("B", loc2, make_snapshot(vec![], 600.0));

        let result = interpolate_glyph(&[m1, m2], &axes, &Location::new());
        assert!(result.is_none());
    }

    #[test]
    fn incompatible_source_reports_error() {
        let axes = vec![make_axis("wght", "Weight", 0.0, 0.0, 1000.0)];

        let default_snap = make_snapshot(
            vec![make_contour(
                "c1",
                vec![make_point("p1", 0.0, 0.0), make_point("p2", 100.0, 0.0)],
            )],
            400.0,
        );

        // Incompatible: different point count
        let bad_snap = make_snapshot(
            vec![make_contour("c1", vec![make_point("p1", 0.0, 0.0)])],
            600.0,
        );

        let m1 = make_master("Default", Location::new(), default_snap);
        let mut loc2 = Location::new();
        loc2.set("wght".to_string(), 1000.0);
        let m2 = make_master("Bad", loc2, bad_snap);

        let mut target = Location::new();
        target.set("wght".to_string(), 500.0);

        let result = interpolate_glyph(&[m1, m2], &axes, &target).unwrap();

        assert_eq!(result.errors.len(), 1);
        assert_eq!(result.errors[0].source_name, "Bad");
        // Should return default since incompatible master is zeroed
        assert!((result.instance.x_advance - 400.0).abs() < 0.01);
    }

    #[test]
    fn deduplicates_same_location() {
        let axes = vec![make_axis("wght", "Weight", 0.0, 0.0, 1000.0)];

        let snap1 = make_snapshot(
            vec![make_contour("c1", vec![make_point("p1", 100.0, 0.0)])],
            400.0,
        );
        let snap2 = snap1.clone();

        let mut bold_loc = Location::new();
        bold_loc.set("wght".to_string(), 1000.0);
        let snap3 = make_snapshot(
            vec![make_contour("c1", vec![make_point("p1", 200.0, 0.0)])],
            600.0,
        );

        let masters = vec![
            make_master("Default1", Location::new(), snap1),
            make_master("Default2", Location::new(), snap2),
            make_master("Bold", bold_loc, snap3),
        ];

        let mut target = Location::new();
        target.set("wght".to_string(), 500.0);

        let result = interpolate_glyph(&masters, &axes, &target).unwrap();
        assert!((result.instance.contours[0].points[0].x - 150.0).abs() < 0.01);
    }

    #[test]
    fn interpolates_anchors() {
        let axes = vec![make_axis("wght", "Weight", 0.0, 0.0, 1000.0)];

        let mut snap_light = make_snapshot(
            vec![make_contour("c1", vec![make_point("p1", 100.0, 0.0)])],
            400.0,
        );
        snap_light.anchors.push(AnchorSnapshot {
            id: "a1".to_string(),
            name: Some("top".to_string()),
            x: 250.0,
            y: 700.0,
        });

        let mut snap_bold = make_snapshot(
            vec![make_contour("c1", vec![make_point("p1", 200.0, 0.0)])],
            600.0,
        );
        snap_bold.anchors.push(AnchorSnapshot {
            id: "a1".to_string(),
            name: Some("top".to_string()),
            x: 300.0,
            y: 800.0,
        });

        let mut bold_loc = Location::new();
        bold_loc.set("wght".to_string(), 1000.0);

        let masters = vec![
            make_master("Light", Location::new(), snap_light),
            make_master("Bold", bold_loc, snap_bold),
        ];

        let mut target = Location::new();
        target.set("wght".to_string(), 500.0);

        let result = interpolate_glyph(&masters, &axes, &target).unwrap();
        assert!((result.instance.anchors[0].x - 275.0).abs() < 0.01);
        assert!((result.instance.anchors[0].y - 750.0).abs() < 0.01);
    }
}
