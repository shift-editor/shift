use std::{
    collections::{BTreeMap, HashMap, HashSet},
    path::{Path, PathBuf},
};

use norad::{DataRequest, Font as NoradFont};
use shift_font::{Font, GlyphId, LayerId, Source, SourceId};

use crate::{
    errors::{FormatBackendError, FormatBackendResult},
    import::{GlifGlyph, GlifGlyphStream, GlifLayer},
};

use super::UfoReader;

struct LayerDirectory {
    source_id: SourceId,
    glyphs: BTreeMap<String, PathBuf>,
}

pub(crate) fn stream_font(path: &str) -> FormatBackendResult<(Font, GlifGlyphStream)> {
    let ufo_path = Path::new(path);
    let mut header = load_header(ufo_path)?;
    let default_source_id = header.default_source_id().ok_or_else(|| {
        FormatBackendError::Ufo("UFO header is missing its default source".into())
    })?;
    let layers = load_layer_directories(ufo_path, &mut header, default_source_id)?;
    let (glyph_ids, glyphs) = build_glyph_directory(layers);

    Ok((header, GlifGlyphStream::new(glyph_ids, glyphs)))
}

fn load_layer_directories(
    ufo_path: &Path,
    header: &mut Font,
    default_source_id: SourceId,
) -> FormatBackendResult<Vec<LayerDirectory>> {
    let mut layer_paths = read_layer_paths(ufo_path)?;
    let default_index = layer_paths
        .iter()
        .position(|(_, path)| path == Path::new("glyphs"))
        .ok_or_else(|| FormatBackendError::Ufo("UFO is missing its default glyphs layer".into()))?;
    let default_layer = layer_paths.remove(default_index);
    layer_paths.insert(0, default_layer);

    let mut layers = Vec::with_capacity(layer_paths.len());
    for (index, (name, relative_path)) in layer_paths.into_iter().enumerate() {
        let layer_path = ufo_path.join(&relative_path);
        let contents_path = layer_path.join("contents.plist");
        let glyphs: BTreeMap<String, PathBuf> = plist_file(&contents_path)?;
        let (color, lib) = read_layer_info(&layer_path)?;
        let source_id = if index == 0 {
            default_source_id.clone()
        } else {
            header.add_source(Source::layer(name))
        };
        let source = header.source_mut(source_id.clone()).ok_or_else(|| {
            FormatBackendError::Ufo("newly registered UFO source is missing".into())
        })?;
        source.set_color(color);
        if !lib.is_empty() {
            *source.lib_mut() = UfoReader::convert_lib(&lib);
        }
        layers.push(LayerDirectory {
            source_id,
            glyphs: glyphs
                .into_iter()
                .map(|(name, path)| (name, layer_path.join(path)))
                .collect(),
        });
    }
    Ok(layers)
}

pub(crate) fn load_header(ufo_path: &Path) -> FormatBackendResult<Font> {
    let request = DataRequest::all().layers(false);
    let norad_font = NoradFont::load_requested_data(ufo_path, request)
        .map_err(|error| FormatBackendError::Ufo(error.to_string()))?;
    UfoReader::convert_header(&norad_font, ufo_path)
}

pub(crate) fn read_glyph_paths(
    ufo_path: &Path,
    layer_name: Option<&str>,
) -> FormatBackendResult<BTreeMap<String, PathBuf>> {
    let layer_paths = read_layer_paths(ufo_path)?;
    let relative_path = match layer_name {
        Some(layer_name) => layer_paths
            .iter()
            .find(|(name, _)| name == layer_name)
            .map(|(_, path)| path),
        None => layer_paths
            .iter()
            .find(|(_, path)| path == Path::new("glyphs"))
            .map(|(_, path)| path),
    }
    .ok_or_else(|| {
        FormatBackendError::Ufo(format!(
            "UFO layer {:?} does not exist in {}",
            layer_name.unwrap_or("public.default"),
            ufo_path.display()
        ))
    })?;
    let layer_path = ufo_path.join(relative_path);
    let contents_path = layer_path.join("contents.plist");
    let glyphs: BTreeMap<String, PathBuf> = plist_file(&contents_path)?;
    Ok(glyphs
        .into_iter()
        .map(|(name, path)| (name, layer_path.join(path)))
        .collect())
}

fn read_layer_paths(ufo_path: &Path) -> FormatBackendResult<Vec<(String, PathBuf)>> {
    let path = ufo_path.join("layercontents.plist");
    if !path.exists() {
        // UFO 2 predates layercontents.plist and defines only glyphs/ as the
        // default layer. Avoid loading a complete norad::Font just to discover
        // this standard legacy layout.
        return Ok(vec![("public.default".into(), PathBuf::from("glyphs"))]);
    }
    plist_file(&path)
}

fn plist_file<T: serde::de::DeserializeOwned>(path: &Path) -> FormatBackendResult<T> {
    plist::from_file(path).map_err(|error| {
        FormatBackendError::Ufo(format!("failed to read {}: {error}", path.display()))
    })
}

fn read_layer_info(layer_path: &Path) -> FormatBackendResult<(Option<String>, plist::Dictionary)> {
    let path = layer_path.join("layerinfo.plist");
    if !path.exists() {
        return Ok((None, plist::Dictionary::new()));
    }
    let value = plist::Value::from_file(&path).map_err(|error| {
        FormatBackendError::Ufo(format!("failed to read {}: {error}", path.display()))
    })?;
    let Some(dictionary) = value.as_dictionary() else {
        return Err(FormatBackendError::Ufo(format!(
            "{} is not a dictionary",
            path.display()
        )));
    };
    let color = dictionary
        .get("color")
        .and_then(plist::Value::as_string)
        .map(ToOwned::to_owned);
    let lib = dictionary
        .get("lib")
        .and_then(plist::Value::as_dictionary)
        .cloned()
        .unwrap_or_default();
    Ok((color, lib))
}

fn build_glyph_directory(
    layers: Vec<LayerDirectory>,
) -> (HashMap<String, GlyphId>, Vec<GlifGlyph>) {
    let mut ordered_names = Vec::new();
    let mut seen = HashSet::new();
    for layer in &layers {
        for name in layer.glyphs.keys() {
            if seen.insert(name.clone()) {
                ordered_names.push(name.clone());
            }
        }
    }
    let glyph_ids = ordered_names
        .iter()
        .map(|name| (name.clone(), GlyphId::new()))
        .collect::<HashMap<_, _>>();
    let glyphs = ordered_names
        .into_iter()
        .map(|name| {
            let layer_records = layers
                .iter()
                .filter_map(|layer| {
                    layer.glyphs.get(&name).map(|path| GlifLayer {
                        source_id: layer.source_id.clone(),
                        layer_id: LayerId::new(),
                        path: path.clone(),
                    })
                })
                .collect();
            GlifGlyph {
                id: glyph_ids[&name].clone(),
                name,
                layers: layer_records,
            }
        })
        .collect();
    (glyph_ids, glyphs)
}
