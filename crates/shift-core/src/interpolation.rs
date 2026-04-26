use std::collections::{HashMap, HashSet};
use std::str::FromStr;

use fontdrasil::coords::NormalizedLocation;
use fontdrasil::types::Tag;
use fontdrasil::variations::VariationModel;
use serde::{Deserialize, Serialize};
use shift_ir::variation::to_fd_location;
use shift_ir::Axis;
use ts_rs::TS;

use crate::snapshot::{AnchorSnapshot, ContourSnapshot, GlyphGeometry, MasterSnapshot};
use crate::{Font, Glyph};

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../packages/types/src/generated/")]
pub struct AxisTent {
    pub axis_tag: String,
    pub lower: f64,
    pub peak: f64,
    pub upper: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../packages/types/src/generated/")]
pub struct GlyphVariationData {
    /// One entry per region. Inner = tents on the axes the region depends on.
    pub regions: Vec<Vec<AxisTent>>,
    /// Same length as `regions`. Each entry = flat values matching `flatten()` order:
    /// [xAdvance, p0.x, p0.y, ..., a0.x, a0.y, ...].
    pub deltas: Vec<Vec<f64>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../packages/types/src/generated/")]
pub struct SourceError {
    #[ts(type = "number")]
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

/// Build per-master snapshots of a single glyph.
///
/// Pure: no editing-session knowledge. Caller passes the `Glyph` it wants the
/// snapshots from (could be the disk copy or an in-progress editing copy with
/// the live session layer patched in — `shift-node` handles that detour).
///
/// Returns `None` if the font isn't variable or no source has a non-empty layer
/// for this glyph.
pub fn build_master_snapshots(font: &Font, glyph: &Glyph) -> Option<Vec<MasterSnapshot>> {
    if !font.is_variable() {
        return None;
    }

    let default_source_id = font.default_source_id();
    let mut masters: Vec<MasterSnapshot> = Vec::new();

    for source in font.sources() {
        let layer = match glyph.layer(source.layer_id()) {
            Some(l) if !l.contours().is_empty() => l,
            _ => continue,
        };

        let contours: Vec<ContourSnapshot> = layer
            .contours()
            .values()
            .filter(|c| !c.points().is_empty())
            .map(ContourSnapshot::from)
            .collect();

        let anchors: Vec<AnchorSnapshot> = layer.anchors_iter().map(AnchorSnapshot::from).collect();

        masters.push(MasterSnapshot {
            source_id: source.id().raw().to_string(),
            source_name: source.name().to_string(),
            is_default_source: default_source_id == Some(source.id()),
            location: source.location().clone(),
            geometry: GlyphGeometry {
                x_advance: layer.width(),
                contours,
                anchors,
            },
        });
    }

    if masters.is_empty() {
        None
    } else {
        Some(masters)
    }
}

pub fn get_glyph_variation_data(
    masters: &[MasterSnapshot],
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
