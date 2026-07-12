use super::axis_labels;
use super::error::{DesignspaceError, DesignspaceResult};
use crate::errors::{FormatBackendError, FormatBackendResult};
use crate::traits::FontReader;
use crate::ufo::UfoReader;
use norad::designspace::DesignSpaceDocument;
use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;
use shift_font::{
    Axis, AxisId, AxisMapping, AxisMappingId, AxisMappingPoint, Component, Font, GlyphLayer,
    LayerId, Location, Source, SourceId,
};
use std::collections::{HashMap, HashSet};
use std::fs;
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
    fn load(&self, path: &str) -> FormatBackendResult<Font> {
        self.load_designspace(path)
            .map_err(FormatBackendError::from)
    }
}

impl DesignspaceReader {
    fn load_designspace(&self, path: &str) -> DesignspaceResult<Font> {
        let ds_path = Path::new(path);
        let ds_dir = ds_path
            .parent()
            .ok_or_else(|| DesignspaceError::MissingParent {
                path: ds_path.to_path_buf(),
            })?;
        let xml = fs::read_to_string(ds_path).map_err(|source| DesignspaceError::ReadFile {
            path: ds_path.to_path_buf(),
            source,
        })?;
        let mut axis_labels = axis_labels::parse(&xml)?;

        let doc = match DesignSpaceDocument::load(ds_path) {
            Ok(doc) => doc,
            Err(error) => {
                let original_error = error.to_string();
                return load_axisless_designspace(ds_path, ds_dir, &original_error).map_err(
                    |fallback_error| DesignspaceError::LoadDesignspace {
                        path: ds_path.to_path_buf(),
                        details: format!("{original_error}; {fallback_error}"),
                    },
                );
            }
        };

        if doc.sources.is_empty() {
            return Err(DesignspaceError::NoSources);
        }

        let default_idx = find_default_source_index(&doc);

        // Load the default source first to establish the base font.
        let default_ds_source = &doc.sources[default_idx];
        let default_ufo_path = ds_dir.join(&default_ds_source.filename);
        let default_ufo_str =
            default_ufo_path
                .to_str()
                .ok_or_else(|| DesignspaceError::InvalidPathUtf8 {
                    path: default_ufo_path.clone(),
                })?;

        let ufo_reader = UfoReader::new();
        let mut font =
            ufo_reader
                .load(default_ufo_str)
                .map_err(|source| DesignspaceError::LoadUfo {
                    path: default_ufo_path.clone(),
                    details: source.to_string(),
                })?;
        let default_ufo_source_id = font
            .default_source_id()
            .ok_or(DesignspaceError::NoSources)?;
        font.clear_sources();

        if let Some(ref family) = default_ds_source.familyname {
            font.metadata_mut().family_name = Some(family.clone());
        }

        // Add axes.
        for ds_axis in &doc.axes {
            let mut axis = if let Some(values) = &ds_axis.values {
                let mut values = values.iter().map(|value| *value as f64).collect::<Vec<_>>();
                values.sort_by(f64::total_cmp);
                values.dedup();
                Axis::discrete_with_id(
                    AxisId::new(),
                    ds_axis.tag.clone(),
                    ds_axis.name.clone(),
                    values,
                    ds_axis.default as f64,
                )
            } else {
                let (minimum, maximum) = derive_axis_range(ds_axis);
                Axis::new(
                    ds_axis.tag.clone(),
                    ds_axis.name.clone(),
                    minimum,
                    ds_axis.default as f64,
                    maximum,
                )
            };
            axis.set_hidden(ds_axis.hidden);
            axis.set_labels(
                axis_labels
                    .remove(ds_axis.name.as_str())
                    .unwrap_or_default(),
            );
            axis.validate()?;
            font.add_axis(axis);
        }
        font.set_axis_mappings(axis_mappings_from_designspace(&doc, font.axes())?)?;

        // Register the default source.
        let default_location =
            location_from_dimensions(&default_ds_source.location, &doc, font.axes());
        let default_name = source_name(default_ds_source, default_idx);
        let default_source_id = font.add_source(Source::with_filename(
            default_name,
            default_location,
            default_ds_source.filename.clone(),
        ));
        font.set_default_source_id(default_source_id.clone());
        move_glyph_layers_to_source(&mut font, default_ufo_source_id, default_source_id)?;

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
                .ok_or_else(|| DesignspaceError::InvalidPathUtf8 {
                    path: ufo_path.clone(),
                })?
                .to_string();

            let source_font = match ufo_cache.get(&ufo_str) {
                Some(f) => f,
                None => {
                    let loaded =
                        ufo_reader
                            .load(&ufo_str)
                            .map_err(|source| DesignspaceError::LoadUfo {
                                path: ufo_path.clone(),
                                details: source.to_string(),
                            })?;
                    ufo_cache.insert(ufo_str.clone(), loaded);
                    ufo_cache.get(&ufo_str).unwrap()
                }
            };

            // Determine which layer from the source UFO to read.
            let source_source_id = match &ds_source.layer {
                Some(layer_name) => find_source_by_external_layer_name(source_font, layer_name)
                    .ok_or_else(|| DesignspaceError::MissingLayer {
                        layer: layer_name.clone(),
                        filename: ds_source.filename.clone(),
                    })?,
                None => source_font
                    .default_source_id()
                    .ok_or(DesignspaceError::NoSources)?,
            };

            let name = source_name(ds_source, idx);
            let location = location_from_dimensions(&ds_source.location, &doc, font.axes());
            let mut source = Source::with_filename(name, location, ds_source.filename.clone());
            source.set_layer_name(ds_source.layer.clone());
            let source_id = font.add_source(source);

            // Copy glyphs from the resolved layer into the new layer.
            for source_glyph in source_font.glyphs() {
                if let Some(source_layer) = source_glyph.layer_for_source(source_source_id.clone())
                {
                    if let Some(glyph_id) = font.glyph_id_by_name(source_glyph.name()) {
                        font.insert_glyph_layer(
                            glyph_id,
                            clone_layer_with_remapped_components(
                                source_layer,
                                &font,
                                LayerId::new(),
                                source_id.clone(),
                            )?,
                        )?;
                    }
                }
            }
        }

        remove_glyph_layers_without_source(&mut font)?;
        Ok(font)
    }
}

fn axis_mappings_from_designspace(
    doc: &DesignSpaceDocument,
    axes: &[Axis],
) -> DesignspaceResult<Vec<AxisMapping>> {
    let axes_by_name = axes
        .iter()
        .map(|axis| (axis.name(), axis.id()))
        .collect::<HashMap<_, _>>();
    let mut mappings = Vec::new();

    for ds_axis in &doc.axes {
        let Some(ds_points) = &ds_axis.map else {
            continue;
        };
        let Some(axis_id) = axes_by_name.get(ds_axis.name.as_str()).cloned() else {
            continue;
        };
        let points = ds_points
            .iter()
            .map(|point| AxisMappingPoint {
                description: None,
                input: singleton_location(axis_id.clone(), point.input as f64),
                output: singleton_location(axis_id.clone(), point.output as f64),
            })
            .collect();
        mappings.push(AxisMapping::with_id(
            AxisMappingId::new(),
            format!("{} mapping", ds_axis.name),
            vec![axis_id.clone()],
            vec![axis_id],
            points,
        ));
    }

    if let Some(group) = &doc.axis_mappings {
        let mut inputs = Vec::new();
        let mut outputs = Vec::new();
        let mut points = Vec::new();
        for entry in &group.mappings {
            let input = mapping_location_from_dimensions(&entry.input, &axes_by_name)?;
            let output = mapping_location_from_dimensions(&entry.output, &axes_by_name)?;
            extend_axis_ids(&mut inputs, &input);
            extend_axis_ids(&mut outputs, &output);
            points.push(AxisMappingPoint {
                description: entry.description.clone(),
                input,
                output,
            });
        }

        if !points.is_empty() {
            let name = group
                .description
                .clone()
                .unwrap_or_else(|| "Cross-axis mapping".to_string());
            let mut mapping =
                AxisMapping::with_id(AxisMappingId::new(), name, inputs, outputs, points);
            mapping.set_description(group.description.clone());
            mappings.push(mapping);
        }
    }

    Ok(mappings)
}

fn mapping_location_from_dimensions(
    dimensions: &[norad::designspace::Dimension],
    axes_by_name: &HashMap<&str, AxisId>,
) -> DesignspaceResult<Location> {
    let mut location = Location::new();
    for dimension in dimensions {
        let Some(axis_id) = axes_by_name.get(dimension.name.as_str()) else {
            return Err(DesignspaceError::LoadDesignspace {
                path: std::path::PathBuf::new(),
                details: format!("mapping references unknown axis {:?}", dimension.name),
            });
        };
        let Some(value) = dimension.xvalue.or(dimension.uservalue) else {
            continue;
        };
        location.set(axis_id.clone(), value as f64);
    }
    Ok(location)
}

fn singleton_location(axis_id: AxisId, value: f64) -> Location {
    let mut location = Location::new();
    location.set(axis_id, value);
    location
}

fn extend_axis_ids(target: &mut Vec<AxisId>, location: &Location) {
    let existing = target.iter().cloned().collect::<HashSet<_>>();
    target.extend(
        location
            .iter()
            .map(|(axis_id, _)| axis_id.clone())
            .filter(|axis_id| !existing.contains(axis_id)),
    );
}

#[derive(Clone, Debug)]
struct AxislessSource {
    filename: String,
    familyname: Option<String>,
    stylename: Option<String>,
    name: Option<String>,
    layer: Option<String>,
}

fn load_axisless_designspace(
    ds_path: &Path,
    ds_dir: &Path,
    original_error: &str,
) -> DesignspaceResult<Font> {
    let xml = fs::read_to_string(ds_path).map_err(|source| DesignspaceError::ReadFile {
        path: ds_path.to_path_buf(),
        source,
    })?;
    let sources = parse_axisless_sources(&xml).map_err(|fallback_error| {
        DesignspaceError::LoadDesignspace {
            path: ds_path.to_path_buf(),
            details: format!(
                "{fallback_error}; axisless fallback was used after parser error: {original_error}"
            ),
        }
    })?;
    if sources.is_empty() {
        return Err(DesignspaceError::NoSources);
    }

    let default_source = &sources[0];
    let default_ufo_path = ds_dir.join(&default_source.filename);
    let default_ufo_str =
        default_ufo_path
            .to_str()
            .ok_or_else(|| DesignspaceError::InvalidPathUtf8 {
                path: default_ufo_path.clone(),
            })?;

    let ufo_reader = UfoReader::new();
    let mut font =
        ufo_reader
            .load(default_ufo_str)
            .map_err(|source| DesignspaceError::LoadUfo {
                path: default_ufo_path.clone(),
                details: source.to_string(),
            })?;
    let default_ufo_source_id = font
        .default_source_id()
        .ok_or(DesignspaceError::NoSources)?;
    font.clear_sources();

    if let Some(family) = &default_source.familyname {
        font.metadata_mut().family_name = Some(family.clone());
    }

    let default_source_id = font.add_source(Source::with_filename(
        axisless_source_name(default_source, 0),
        Location::new(),
        default_source.filename.clone(),
    ));
    font.set_default_source_id(default_source_id.clone());
    move_glyph_layers_to_source(&mut font, default_ufo_source_id, default_source_id)?;

    let mut ufo_cache: HashMap<String, Font> = HashMap::new();
    for (idx, ds_source) in sources.iter().enumerate().skip(1) {
        let ufo_path = ds_dir.join(&ds_source.filename);
        let ufo_str = ufo_path
            .to_str()
            .ok_or_else(|| DesignspaceError::InvalidPathUtf8 {
                path: ufo_path.clone(),
            })?
            .to_string();

        let source_font = match ufo_cache.get(&ufo_str) {
            Some(f) => f,
            None => {
                let loaded =
                    ufo_reader
                        .load(&ufo_str)
                        .map_err(|source| DesignspaceError::LoadUfo {
                            path: ufo_path.clone(),
                            details: source.to_string(),
                        })?;
                ufo_cache.insert(ufo_str.clone(), loaded);
                ufo_cache.get(&ufo_str).unwrap()
            }
        };

        let source_source_id = match &ds_source.layer {
            Some(layer_name) => find_source_by_external_layer_name(source_font, layer_name)
                .ok_or_else(|| DesignspaceError::MissingLayer {
                    layer: layer_name.clone(),
                    filename: ds_source.filename.clone(),
                })?,
            None => source_font
                .default_source_id()
                .ok_or(DesignspaceError::NoSources)?,
        };

        let name = axisless_source_name(ds_source, idx);
        let mut source = Source::with_filename(name, Location::new(), ds_source.filename.clone());
        source.set_layer_name(ds_source.layer.clone());
        let source_id = font.add_source(source);

        for source_glyph in source_font.glyphs() {
            if let Some(source_layer) = source_glyph.layer_for_source(source_source_id.clone()) {
                if let Some(glyph_id) = font.glyph_id_by_name(source_glyph.name()) {
                    font.insert_glyph_layer(
                        glyph_id,
                        clone_layer_with_remapped_components(
                            source_layer,
                            &font,
                            LayerId::new(),
                            source_id.clone(),
                        )?,
                    )?;
                }
            }
        }
    }

    remove_glyph_layers_without_source(&mut font)?;
    Ok(font)
}

fn axisless_source_name(source: &AxislessSource, index: usize) -> String {
    source
        .name
        .clone()
        .or_else(|| source.stylename.clone())
        .unwrap_or_else(|| format!("Source {index}"))
}

fn parse_axisless_sources(xml: &str) -> DesignspaceResult<Vec<AxislessSource>> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut sources = Vec::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(event)) | Ok(Event::Empty(event)) => match event.name().as_ref() {
                b"axis" => {
                    return Err(DesignspaceError::AxislessNotApplicable {
                        reason: "axes are present".to_string(),
                    })
                }
                b"source" => {
                    if let Some(filename) = xml_attr(&reader, &event, b"filename")? {
                        sources.push(AxislessSource {
                            filename,
                            familyname: xml_attr(&reader, &event, b"familyname")?,
                            stylename: xml_attr(&reader, &event, b"stylename")?,
                            name: xml_attr(&reader, &event, b"name")?,
                            layer: xml_attr(&reader, &event, b"layer")?,
                        });
                    }
                }
                _ => {}
            },
            Ok(Event::Eof) => break,
            Err(error) => {
                return Err(DesignspaceError::ParseAxislessXml {
                    details: error.to_string(),
                })
            }
            _ => {}
        }
    }

    Ok(sources)
}

fn xml_attr(
    reader: &Reader<&[u8]>,
    event: &BytesStart,
    name: &[u8],
) -> DesignspaceResult<Option<String>> {
    for attribute in event.attributes() {
        let attribute = attribute.map_err(|error| DesignspaceError::ParseAxislessXml {
            details: error.to_string(),
        })?;
        if attribute.key.as_ref() == name {
            return attribute
                .decode_and_unescape_value(reader.decoder())
                .map(|value| Some(value.into_owned()))
                .map_err(|error| DesignspaceError::ParseAxislessXml {
                    details: error.to_string(),
                });
        }
    }

    Ok(None)
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
    axes: &[Axis],
) -> Location {
    let mut location = Location::new();
    for dim in dimensions {
        let value = dim.xvalue.unwrap_or(0.0) as f64;
        if let Some(axis) = doc.axes.iter().find(|a| a.name == dim.name) {
            if let Some(axis) = axes.iter().find(|candidate| candidate.tag() == axis.tag) {
                location.set(axis.id(), value);
            }
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

fn find_source_by_external_layer_name(font: &Font, name: &str) -> Option<SourceId> {
    font.sources()
        .iter()
        .find(|source| source.name() == name)
        .map(Source::id)
}

fn move_glyph_layers_to_source(
    font: &mut Font,
    from_source_id: SourceId,
    to_source_id: SourceId,
) -> DesignspaceResult<()> {
    let layer_moves: Vec<_> = font
        .glyphs()
        .filter_map(|glyph| {
            glyph.layer_for_source(from_source_id.clone()).map(|layer| {
                (
                    glyph.id(),
                    layer.id(),
                    layer.clone_with_identity(LayerId::new(), to_source_id.clone()),
                )
            })
        })
        .collect();

    for (glyph_id, old_layer_id, layer) in layer_moves {
        font.remove_glyph_layer(old_layer_id)?;
        font.insert_glyph_layer(glyph_id, layer)?;
    }

    Ok(())
}

fn clone_layer_with_remapped_components(
    layer: &GlyphLayer,
    font: &Font,
    layer_id: LayerId,
    source_id: SourceId,
) -> DesignspaceResult<GlyphLayer> {
    let mut cloned = layer.clone_with_identity(layer_id, source_id);
    cloned.clear_components();

    for component in layer.components_iter() {
        let base_glyph_id = font
            .glyph_id_by_name(component.base_glyph_name().as_str())
            .ok_or_else(|| DesignspaceError::LoadUfo {
                path: std::path::PathBuf::from(component.base_glyph_name().as_str()),
                details: format!(
                    "component base glyph {:?} does not exist in default font",
                    component.base_glyph_name()
                ),
            })?;
        cloned.add_component(Component::with_id(
            component.id(),
            base_glyph_id,
            component.base_glyph_name().clone(),
            *component.transform(),
        ));
    }

    Ok(cloned)
}

fn remove_glyph_layers_without_source(font: &mut Font) -> DesignspaceResult<()> {
    let source_ids: Vec<_> = font.sources().iter().map(Source::id).collect();
    let orphan_layer_ids: Vec<_> = font
        .glyphs()
        .flat_map(|glyph| {
            glyph
                .layers()
                .values()
                .filter(|layer| !source_ids.contains(&layer.source_id()))
                .map(|layer| layer.id())
                .collect::<Vec<_>>()
        })
        .collect();

    for layer_id in orphan_layer_ids {
        font.remove_glyph_layer(layer_id)?;
    }

    Ok(())
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
