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
            let minimum = ds_axis.minimum.unwrap_or(ds_axis.default) as f64;
            let maximum = ds_axis.maximum.unwrap_or(ds_axis.default) as f64;
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
        font.add_source(Source::with_filename(
            default_name,
            default_location,
            default_layer_id,
            default_ds_source.filename.clone(),
        ));

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
