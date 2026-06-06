use std::collections::{HashMap, HashSet};
use std::str::FromStr;

use fontdrasil::coords::{NormalizedCoord, NormalizedLocation};
use fontdrasil::types::Tag;
use fontdrasil::variations::VariationModel;
use shift_font::{Axis, Font, Glyph};

use crate::{
    values_from_layer, AxisTent, GlyphMaster, GlyphStructure, GlyphVariationData, Location,
};

#[derive(Debug, Clone)]
pub struct SourceError {
    pub source_index: usize,
    pub source_id: String,
    pub source_name: String,
    pub message: String,
}

#[derive(Debug, Clone)]
pub struct GlyphVariationBuild {
    pub variation_data: Option<GlyphVariationData>,
    pub source_errors: Vec<SourceError>,
    pub missing_default_source: bool,
    pub model_error: Option<String>,
}

impl GlyphVariationBuild {
    fn data(variation_data: GlyphVariationData, source_errors: Vec<SourceError>) -> Self {
        Self {
            variation_data: Some(variation_data),
            source_errors,
            missing_default_source: false,
            model_error: None,
        }
    }

    fn missing_default() -> Self {
        Self {
            variation_data: None,
            source_errors: Vec::new(),
            missing_default_source: true,
            model_error: None,
        }
    }

    fn model_failed(source_errors: Vec<SourceError>, message: String) -> Self {
        Self {
            variation_data: None,
            source_errors,
            missing_default_source: false,
            model_error: Some(message),
        }
    }
}

fn check_compatibility(a: &GlyphStructure, b: &GlyphStructure) -> Result<(), String> {
    // Contour topology must match so point values line up by index.
    if a.contours.len() != b.contours.len() {
        return Err(format!(
            "contour count mismatch: {} vs {}",
            a.contours.len(),
            b.contours.len()
        ));
    }

    for (i, (ca, cb)) in a.contours.iter().zip(b.contours.iter()).enumerate() {
        if ca.closed != cb.closed {
            return Err(format!(
                "contour {i} closed mismatch: {} vs {}",
                ca.closed, cb.closed
            ));
        }

        if ca.points.len() != cb.points.len() {
            return Err(format!(
                "contour {} point count mismatch: {} vs {}",
                i,
                ca.points.len(),
                cb.points.len()
            ));
        }

        for (j, (pa, pb)) in ca.points.iter().zip(cb.points.iter()).enumerate() {
            if pa.point_type != pb.point_type {
                return Err(format!("contour {i} point {j} type mismatch"));
            }
        }
    }

    // Anchors contribute x/y values, so names and order must agree.
    if a.anchors.len() != b.anchors.len() {
        return Err(format!(
            "anchor count mismatch: {} vs {}",
            a.anchors.len(),
            b.anchors.len()
        ));
    }

    for (i, (aa, ab)) in a.anchors.iter().zip(b.anchors.iter()).enumerate() {
        if aa.name != ab.name {
            return Err(format!("anchor {i} name mismatch"));
        }
    }

    // Components contribute transform values, keyed structurally by base glyph.
    if a.components.len() != b.components.len() {
        return Err(format!(
            "component count mismatch: {} vs {}",
            a.components.len(),
            b.components.len()
        ));
    }

    for (i, (ca, cb)) in a.components.iter().zip(b.components.iter()).enumerate() {
        if ca.base_glyph_name != cb.base_glyph_name {
            return Err(format!(
                "component {i} base glyph mismatch: {} vs {}",
                ca.base_glyph_name, cb.base_glyph_name
            ));
        }
    }

    Ok(())
}

fn to_fd_wire_location(location: &Location, axes: &[Axis]) -> NormalizedLocation {
    let mut result = NormalizedLocation::new();

    for axis in axes {
        let value = location
            .values
            .get(axis.tag())
            .copied()
            .unwrap_or(axis.default());
        let normalized = axis.normalize(value);
        let Ok(tag) = Tag::from_str(axis.tag()) else {
            continue;
        };

        result.insert(tag, NormalizedCoord::new(normalized));
    }

    result
}

/// Build per-source masters for a single glyph.
///
/// Pure: no editing-session knowledge. Caller passes the `Glyph` it wants the
/// masters from (could be the committed copy or an in-progress editing copy
/// with the live session layer patched in by the bridge).
///
/// Returns `None` if the font isn't variable or no source has a non-empty layer
/// for this glyph.
pub fn build_masters(font: &Font, glyph: &Glyph) -> Option<Vec<GlyphMaster>> {
    if !font.is_variable() {
        return None;
    }

    let default_source_id = font.default_source_id();
    let mut masters: Vec<GlyphMaster> = Vec::new();

    for source in font.sources() {
        let layer = match glyph.layer_for_source(source.id()) {
            Some(layer)
                if !layer.contours().is_empty()
                    || !layer.anchors().is_empty()
                    || !layer.components().is_empty() =>
            {
                layer
            }
            _ => continue,
        };

        let structure = GlyphStructure::from(layer);
        let values = values_from_layer(layer);

        masters.push(GlyphMaster {
            source_id: source.id().to_string(),
            source_name: source.name().to_string(),
            is_default_source: default_source_id == Some(source.id()),
            location: source.location().into(),
            structure,
            values,
        });
    }

    if masters.is_empty() {
        None
    } else {
        Some(masters)
    }
}

pub fn build_glyph_variation_data(masters: &[GlyphMaster], axes: &[Axis]) -> GlyphVariationBuild {
    let ordered_axes: Vec<Tag> = axes
        .iter()
        .filter_map(|a| Tag::from_str(a.tag()).ok())
        .collect();

    let Some(default_master) = masters.iter().find(|master| master.is_default_source) else {
        return GlyphVariationBuild::missing_default();
    };

    let mut errors = Vec::new();
    let mut points: HashMap<NormalizedLocation, Vec<f64>> = HashMap::new();
    for (source_index, master) in masters.iter().enumerate() {
        match check_compatibility(&master.structure, &default_master.structure) {
            Ok(()) => {
                let loc = to_fd_wire_location(&master.location, axes);
                points.insert(loc, master.values.clone());
            }
            Err(message) => {
                errors.push(SourceError {
                    source_index,
                    source_id: master.source_id.clone(),
                    source_name: master.source_name.clone(),
                    message,
                });
            }
        }
    }

    let locations_set: HashSet<NormalizedLocation> = points.keys().cloned().collect();
    let model = VariationModel::new(locations_set, ordered_axes);
    let model_deltas = match model.deltas::<f64, f64>(&points) {
        Ok(model_deltas) => model_deltas,
        Err(err) => return GlyphVariationBuild::model_failed(errors, err.to_string()),
    };

    let regions: Vec<Vec<AxisTent>> = model_deltas
        .iter()
        .map(|(region, _)| {
            region
                .iter()
                .map(|(tag, tent)| AxisTent {
                    axis_tag: tag.to_string(),
                    lower: tent.min.into_inner().into_inner(),
                    peak: tent.peak.into_inner().into_inner(),
                    upper: tent.max.into_inner().into_inner(),
                })
                .collect()
        })
        .collect();

    let deltas: Vec<Vec<f64>> = model_deltas.into_iter().map(|(_, d)| d).collect();

    GlyphVariationBuild::data(GlyphVariationData { regions, deltas }, errors)
}

pub fn get_glyph_variation_data(
    masters: &[GlyphMaster],
    axes: &[Axis],
) -> Option<GlyphVariationData> {
    build_glyph_variation_data(masters, axes).variation_data
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use crate::{ContourData, GlyphMaster, GlyphStructure, Location, PointData, PointType};

    use super::build_glyph_variation_data;
    use shift_font::Axis;

    fn structure_with_smooth(smooth: bool) -> GlyphStructure {
        GlyphStructure {
            contours: vec![ContourData {
                id: "contour-1".to_string(),
                closed: false,
                points: vec![
                    PointData {
                        id: "point-1".to_string(),
                        point_type: PointType::OnCurve,
                        smooth,
                    },
                    PointData {
                        id: "point-2".to_string(),
                        point_type: PointType::OnCurve,
                        smooth: false,
                    },
                ],
            }],
            anchors: Vec::new(),
            components: Vec::new(),
        }
    }

    fn master(
        source_name: &str,
        is_default_source: bool,
        location_value: f64,
        smooth: bool,
        x_offset: f64,
    ) -> GlyphMaster {
        GlyphMaster {
            source_id: source_name.to_string(),
            source_name: source_name.to_string(),
            is_default_source,
            location: Location {
                values: HashMap::from([("wght".to_string(), location_value)]),
            },
            structure: structure_with_smooth(smooth),
            values: vec![500.0, x_offset, 0.0, 100.0 + x_offset, 0.0],
        }
    }

    #[test]
    fn smooth_point_mismatch_does_not_make_masters_incompatible() {
        let axes = vec![Axis::new(
            "wght".to_string(),
            "Weight".to_string(),
            0.0,
            0.0,
            100.0,
        )];
        let masters = vec![
            master("Regular", true, 0.0, false, 0.0),
            master("Bold", false, 100.0, true, 20.0),
        ];

        let build = build_glyph_variation_data(&masters, &axes);

        assert!(
            build.source_errors.is_empty(),
            "smooth-only mismatch should not skip sources: {:?}",
            build.source_errors
        );
        assert!(build.variation_data.is_some());
    }
}
