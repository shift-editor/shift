use crate::traits::FontReader;
use crate::ufo::UfoReader;
use norad::designspace::DesignSpaceDocument;
use shift_ir::{Axis, Font, Layer, LayerId, Location, Source};
use std::collections::HashMap;
use std::path::Path;

pub struct DesignspaceReader;

impl DesignspaceReader {
    pub fn new() -> Self {
        Self
    }
}

impl Default for DesignspaceReader {
    fn default() -> Self {
        Self::new()
    }
}

impl FontReader for DesignspaceReader {
    fn load(&self, path: &str) -> Result<Font, String> {
        let ds_path = Path::new(path);
        let ds_dir = ds_path
            .parent()
            .ok_or_else(|| format!("Cannot determine directory of '{path}'"))?;

        let doc = DesignSpaceDocument::load(ds_path)
            .map_err(|e| format!("Failed to load designspace '{path}': {e}"))?;

        if doc.sources.is_empty() {
            return Err("Designspace has no sources".to_string());
        }

        let default_idx = find_default_source_index(&doc);

        // Load the default source first to establish the base font.
        let default_ds_source = &doc.sources[default_idx];
        let default_ufo_path = ds_dir.join(&default_ds_source.filename);
        let default_ufo_str = default_ufo_path
            .to_str()
            .ok_or_else(|| "Invalid UTF-8 in default UFO path".to_string())?;

        let ufo_reader = UfoReader::new();
        let mut font = ufo_reader.load(default_ufo_str)?;

        if let Some(ref family) = default_ds_source.familyname {
            font.metadata_mut().family_name = Some(family.clone());
        }

        // Add axes.
        for ds_axis in &doc.axes {
            let (minimum, maximum) = derive_axis_range(ds_axis);
            let mut axis = Axis::new(
                ds_axis.tag.clone(),
                ds_axis.name.clone(),
                minimum,
                ds_axis.default as f64,
                maximum,
            );
            axis.set_hidden(ds_axis.hidden);
            font.add_axis(axis);
        }

        // Register the default source.
        let default_layer_id = font.default_layer_id();
        let default_location = location_from_dimensions(&default_ds_source.location, &doc);
        let default_name = source_name(default_ds_source, default_idx);
        let default_source_id = font.add_source(Source::with_filename(
            default_name,
            default_location,
            default_layer_id,
            default_ds_source.filename.clone(),
        ));
        font.set_default_source_id(default_source_id);

        // Cache loaded UFO fonts so we don't re-read the same file for support layers.
        let mut ufo_cache: HashMap<String, Font> = HashMap::new();

        // Load each non-default source.
        for (idx, ds_source) in doc.sources.iter().enumerate() {
            if idx == default_idx {
                continue;
            }

            let ufo_path = ds_dir.join(&ds_source.filename);
            let ufo_str = ufo_path
                .to_str()
                .ok_or_else(|| format!("Invalid UTF-8 in UFO path: {ufo_path:?}"))?
                .to_string();

            let source_font = match ufo_cache.get(&ufo_str) {
                Some(f) => f,
                None => {
                    let loaded = ufo_reader.load(&ufo_str)?;
                    ufo_cache.insert(ufo_str.clone(), loaded);
                    ufo_cache.get(&ufo_str).unwrap()
                }
            };

            // Determine which layer from the source UFO to read.
            let source_layer_id = match &ds_source.layer {
                Some(layer_name) => {
                    find_layer_by_name(source_font, layer_name).ok_or_else(|| {
                        format!(
                            "Layer '{}' not found in '{}'",
                            layer_name, ds_source.filename
                        )
                    })?
                }
                None => source_font.default_layer_id(),
            };

            let name = source_name(ds_source, idx);
            let layer = Layer::new(name.clone());
            let layer_id = font.add_layer(layer);

            // Copy glyphs from the resolved layer into the new layer.
            for (glyph_name, source_glyph) in source_font.glyphs() {
                if let Some(source_layer) = source_glyph.layer(source_layer_id) {
                    if let Some(existing_glyph) = font.glyph_mut(glyph_name) {
                        existing_glyph.set_layer(layer_id, source_layer.clone());
                    }
                }
            }

            let location = location_from_dimensions(&ds_source.location, &doc);
            font.add_source(Source::with_filename(
                name,
                location,
                layer_id,
                ds_source.filename.clone(),
            ));
        }

        Ok(font)
    }
}

fn source_name(source: &norad::designspace::Source, index: usize) -> String {
    source
        .name
        .clone()
        .or_else(|| source.stylename.clone())
        .unwrap_or_else(|| format!("Source {index}"))
}

fn location_from_dimensions(
    dimensions: &[norad::designspace::Dimension],
    doc: &DesignSpaceDocument,
) -> Location {
    let mut location = Location::new();
    for dim in dimensions {
        let value = dim.xvalue.unwrap_or(0.0) as f64;
        if let Some(axis) = doc.axes.iter().find(|a| a.name == dim.name) {
            location.set(axis.tag.clone(), value);
        }
    }
    location
}

fn find_default_source_index(doc: &DesignSpaceDocument) -> usize {
    for (idx, source) in doc.sources.iter().enumerate() {
        // Skip support layer sources.
        if source.layer.is_some() {
            continue;
        }

        let is_default = doc.axes.iter().all(|axis| {
            source
                .location
                .iter()
                .find(|d| d.name == axis.name)
                .map(|d| {
                    let val = d.xvalue.unwrap_or(0.0);
                    (val - axis.default).abs() < 0.001
                })
                .unwrap_or(false)
        });
        if is_default {
            return idx;
        }
    }
    0
}

fn find_layer_by_name(font: &Font, name: &str) -> Option<LayerId> {
    font.layers()
        .iter()
        .find(|(_, layer)| layer.name() == name)
        .map(|(&id, _)| id)
}

/// Derive (minimum, maximum) for an axis from norad's parsed designspace.
///
/// Designspace axis edge cases handled:
/// - **Continuous** (both min/max present): use as-is.
/// - **Discrete** (`values="0 1"` with no min/max attrs): min/max are the
///   smallest/largest values in the list. e.g. `ital`, our `SLAB`.
/// - **One-sided** (only min OR max specified): the missing side falls back
///   to `default`. Common with slant axes (`min=-15, default=0, max=0`).
/// - **Degenerate** (no min/max/values): all three collapse to default.
fn derive_axis_range(ds_axis: &norad::designspace::Axis) -> (f64, f64) {
    let values_range = || {
        ds_axis
            .values
            .as_ref()
            .filter(|v| !v.is_empty())
            .map(|values| {
                let min = values.iter().cloned().fold(f32::INFINITY, f32::min) as f64;
                let max = values.iter().cloned().fold(f32::NEG_INFINITY, f32::max) as f64;
                (min, max)
            })
    };

    match (ds_axis.minimum, ds_axis.maximum) {
        (Some(min), Some(max)) => (min as f64, max as f64),
        (None, None) => values_range().unwrap_or((ds_axis.default as f64, ds_axis.default as f64)),
        (Some(min), None) => (min as f64, ds_axis.default as f64),
        (None, Some(max)) => (ds_axis.default as f64, max as f64),
    }
}

#[cfg(test)]
mod axis_range_tests {
    use super::*;
    use norad::designspace::Axis as DsAxis;

    fn axis(min: Option<f32>, max: Option<f32>, default: f32, values: Option<Vec<f32>>) -> DsAxis {
        DsAxis {
            name: "test".into(),
            tag: "TEST".into(),
            minimum: min,
            maximum: max,
            default,
            hidden: false,
            values,
            ..Default::default()
        }
    }

    #[test]
    fn continuous_uses_explicit_min_max() {
        let a = axis(Some(100.0), Some(900.0), 400.0, None);
        assert_eq!(derive_axis_range(&a), (100.0, 900.0));
    }

    #[test]
    fn discrete_two_values_derives_range() {
        // SLAB axis pattern: <axis values="0 1" default="0"/>
        let a = axis(None, None, 0.0, Some(vec![0.0, 1.0]));
        assert_eq!(derive_axis_range(&a), (0.0, 1.0));
    }

    #[test]
    fn discrete_three_values_derives_range_from_extremes() {
        let a = axis(None, None, 1.0, Some(vec![0.5, 1.0, 1.5]));
        assert_eq!(derive_axis_range(&a), (0.5, 1.5));
    }

    #[test]
    fn discrete_unsorted_values_still_finds_extremes() {
        let a = axis(None, None, 1.0, Some(vec![1.5, 0.5, 1.0]));
        assert_eq!(derive_axis_range(&a), (0.5, 1.5));
    }

    #[test]
    fn explicit_min_max_takes_precedence_over_values() {
        let a = axis(Some(0.0), Some(2.0), 1.0, Some(vec![0.5, 1.5]));
        assert_eq!(derive_axis_range(&a), (0.0, 2.0));
    }

    #[test]
    fn one_sided_min_only_falls_back_to_default_for_max() {
        // slant-like, half-spec'd: min=-15, default=0, no max attr
        let a = axis(Some(-15.0), None, 0.0, None);
        assert_eq!(derive_axis_range(&a), (-15.0, 0.0));
    }

    #[test]
    fn one_sided_max_only_falls_back_to_default_for_min() {
        let a = axis(None, Some(900.0), 400.0, None);
        assert_eq!(derive_axis_range(&a), (400.0, 900.0));
    }

    #[test]
    fn no_min_max_no_values_collapses_to_default() {
        let a = axis(None, None, 400.0, None);
        assert_eq!(derive_axis_range(&a), (400.0, 400.0));
    }

    #[test]
    fn empty_values_list_collapses_to_default() {
        let a = axis(None, None, 0.0, Some(vec![]));
        assert_eq!(derive_axis_range(&a), (0.0, 0.0));
    }

    #[test]
    fn asymmetric_default_at_minimum() {
        // Older fonts where the Light is the default
        let a = axis(Some(400.0), Some(900.0), 400.0, None);
        assert_eq!(derive_axis_range(&a), (400.0, 900.0));
        // The Axis itself should still normalise sensibly:
        let axis = Axis::new("wght".into(), "Weight".into(), 400.0, 400.0, 900.0);
        assert_eq!(axis.normalize(400.0), 0.0);
        assert_eq!(axis.normalize(900.0), 1.0);
        // Below default: range is zero, must return 0 (no negative ramp).
        assert_eq!(axis.normalize(100.0), 0.0);
    }

    #[test]
    fn asymmetric_one_sided_negative_axis() {
        // slnt-like: min=-15, default=0, max=0
        let axis = Axis::new("slnt".into(), "Slant".into(), -15.0, 0.0, 0.0);
        assert_eq!(axis.normalize(0.0), 0.0);
        assert_eq!(axis.normalize(-15.0), -1.0);
        // Above default: range is zero, returns 0 (no positive ramp).
        assert_eq!(axis.normalize(5.0), 0.0);
    }
}
