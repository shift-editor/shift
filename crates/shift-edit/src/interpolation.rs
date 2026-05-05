use std::collections::{HashMap, HashSet};
use std::str::FromStr;

use fontdrasil::coords::{NormalizedCoord, NormalizedLocation};
use fontdrasil::types::Tag;
use fontdrasil::variations::VariationModel;
use shift_ir::Axis;
use shift_wire::{
    values_from_layer, AxisTent, GlyphMaster, GlyphStructure, GlyphVariationData, Location,
};

use crate::{Font, Glyph};

#[derive(Debug, Clone)]
pub struct SourceError {
    pub source_index: usize,
    pub source_name: String,
    pub message: String,
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
            if pa.smooth != pb.smooth {
                return Err(format!(
                    "contour {i} point {j} smooth mismatch: {} vs {}",
                    pa.smooth, pb.smooth
                ));
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
        let layer = match glyph.layer(source.layer_id()) {
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

pub fn get_glyph_variation_data(
    masters: &[GlyphMaster],
    axes: &[Axis],
) -> Option<GlyphVariationData> {
    let ordered_axes: Vec<Tag> = axes
        .iter()
        .filter_map(|a| Tag::from_str(a.tag()).ok())
        .collect();

    let default_master = masters.iter().find(|master| master.is_default_source)?;

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
                    source_name: master.source_name.clone(),
                    message,
                });
            }
        }
    }

    let locations_set: HashSet<NormalizedLocation> = points.keys().cloned().collect();
    let model = VariationModel::new(locations_set, ordered_axes);
    let model_deltas = model.deltas::<f64, f64>(&points).ok()?;

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

    Some(GlyphVariationData { regions, deltas })
}
