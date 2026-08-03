use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::Arc,
};

use norad::designspace::DesignSpaceDocument;
use rayon::prelude::*;
use shift_font::{
    Axis, AxisId, Font, GlyphId, LayerId, Location, MetricDefinition, Source, SourceId,
};

use crate::{
    errors::{FormatBackendError, FormatBackendResult},
    import::{GlifGlyph, GlifGlyphStream, GlifLayer},
    metrics::copy_source_metrics,
    ufo::{load_header, read_glyph_paths},
};

use super::{
    axis_labels,
    error::{DesignspaceError, DesignspaceResult},
    reader::{
        axis_mappings_from_designspace, axisless_source_name, derive_axis_range,
        find_default_source_index, location_from_dimensions, named_instances_from_designspace,
        parse_axisless_sources, source_name,
    },
};

struct SourceDirectory {
    source_id: SourceId,
    glyphs: BTreeMap<String, PathBuf>,
}

struct DesignspaceSourceMaterial {
    index: usize,
    style_name: Option<String>,
    metric_definitions: Vec<MetricDefinition>,
    metrics: Source,
    glyphs: BTreeMap<String, PathBuf>,
}

pub(crate) fn stream_font(path: &str) -> FormatBackendResult<(Font, GlifGlyphStream)> {
    stream_designspace(Path::new(path), None).map_err(FormatBackendError::from)
}

pub(crate) fn stream_retained(
    path: &Path,
    glyph_paths: Arc<[BTreeMap<String, PathBuf>]>,
) -> FormatBackendResult<(Font, GlifGlyphStream)> {
    stream_designspace(path, Some(&glyph_paths)).map_err(FormatBackendError::from)
}

fn stream_designspace(
    designspace_path: &Path,
    retained_glyph_paths: Option<&[BTreeMap<String, PathBuf>]>,
) -> DesignspaceResult<(Font, GlifGlyphStream)> {
    let designspace_dir =
        designspace_path
            .parent()
            .ok_or_else(|| DesignspaceError::MissingParent {
                path: designspace_path.to_path_buf(),
            })?;
    let xml =
        fs::read_to_string(designspace_path).map_err(|source| DesignspaceError::ReadFile {
            path: designspace_path.to_path_buf(),
            source,
        })?;
    let mut labels = axis_labels::parse(&xml)?;
    let document = match DesignSpaceDocument::load(designspace_path) {
        Ok(document) => document,
        Err(error) => {
            return stream_axisless_designspace(
                designspace_path,
                designspace_dir,
                &xml,
                &error.to_string(),
            );
        }
    };
    if document.sources.is_empty() {
        return Err(DesignspaceError::NoSources);
    }
    if retained_glyph_paths.is_some_and(|paths| paths.len() != document.sources.len()) {
        return Err(DesignspaceError::LoadDesignspace {
            path: designspace_path.to_path_buf(),
            details: "retained source path count does not match Designspace sources".into(),
        });
    }
    let default_index =
        find_default_source_index(&document).ok_or(DesignspaceError::MissingDefaultSource)?;
    let default_descriptor = &document.sources[default_index];
    let default_path = designspace_dir.join(&default_descriptor.filename);
    let mut header = load_header(&default_path).map_err(|error| DesignspaceError::LoadUfo {
        path: default_path.clone(),
        source: Box::new(error),
    })?;
    let default_metrics = header
        .default_source()
        .cloned()
        .ok_or(DesignspaceError::NoSources)?;
    let default_metric_definitions = header.metric_definitions().to_vec();
    header.clear_sources();

    if let Some(family_name) = &default_descriptor.familyname {
        header.metadata_mut().family_name = Some(family_name.clone());
    }
    add_axes(&mut header, &document, &mut labels)?;
    header.set_axis_mappings(axis_mappings_from_designspace(&document, header.axes())?)?;
    header.set_named_instances(named_instances_from_designspace(&document, header.axes())?)?;

    let source_order = std::iter::once(default_index)
        .chain((0..document.sources.len()).filter(|index| *index != default_index))
        .collect::<Vec<_>>();
    let default_style_name = header.metadata().style_name.clone();
    let source_materials = source_order
        .into_par_iter()
        .map(|index| {
            let descriptor = &document.sources[index];
            let ufo_path = designspace_dir.join(&descriptor.filename);
            let (style_name, metric_definitions, metrics) = if index == default_index {
                (
                    default_style_name.clone(),
                    default_metric_definitions.clone(),
                    default_metrics.clone(),
                )
            } else {
                let ufo_header =
                    load_header(&ufo_path).map_err(|error| DesignspaceError::LoadUfo {
                        path: ufo_path.clone(),
                        source: Box::new(error),
                    })?;
                let metrics = ufo_header
                    .default_source()
                    .cloned()
                    .ok_or(DesignspaceError::NoSources)?;
                (
                    ufo_header.metadata().style_name.clone(),
                    ufo_header.metric_definitions().to_vec(),
                    metrics,
                )
            };
            let glyphs =
                match retained_glyph_paths {
                    Some(paths) => paths[index].clone(),
                    None => read_glyph_paths(&ufo_path, descriptor.layer.as_deref()).map_err(
                        |error| DesignspaceError::LoadUfo {
                            path: ufo_path,
                            source: Box::new(error),
                        },
                    )?,
                };
            Ok(DesignspaceSourceMaterial {
                index,
                style_name,
                metric_definitions,
                metrics,
                glyphs,
            })
        })
        .collect::<DesignspaceResult<Vec<_>>>()?;

    let axes = header.axes().to_vec();
    let directories = register_designspace_sources(
        &mut header,
        source_materials,
        default_index,
        |index, style_name, source_names| {
            let descriptor = &document.sources[index];
            let name = source_name(descriptor, style_name, source_names, index);
            let location = location_from_dimensions(&descriptor.location, &document, &axes);
            let mut source = Source::with_filename(name, location, descriptor.filename.clone());
            source.set_layer_name(descriptor.layer.clone());
            source
        },
    );

    let (glyph_ids, glyphs) = build_glyph_directory(&directories);
    Ok((header, GlifGlyphStream::new(glyph_ids, glyphs)))
}

fn stream_axisless_designspace(
    designspace_path: &Path,
    designspace_dir: &Path,
    xml: &str,
    original_error: &str,
) -> DesignspaceResult<(Font, GlifGlyphStream)> {
    let sources = parse_axisless_sources(xml).map_err(|fallback_error| {
        DesignspaceError::LoadDesignspace {
            path: designspace_path.to_path_buf(),
            details: format!(
                "{fallback_error}; axisless fallback was used after parser error: {original_error}"
            ),
        }
    })?;
    if sources.is_empty() {
        return Err(DesignspaceError::NoSources);
    }

    let default_path = designspace_dir.join(&sources[0].filename);
    let mut header = load_header(&default_path).map_err(|error| DesignspaceError::LoadUfo {
        path: default_path,
        source: Box::new(error),
    })?;
    if let Some(family_name) = &sources[0].familyname {
        header.metadata_mut().family_name = Some(family_name.clone());
    }
    let default_style_name = header.metadata().style_name.clone();
    let default_metrics = header
        .default_source()
        .cloned()
        .ok_or(DesignspaceError::NoSources)?;
    let default_metric_definitions = header.metric_definitions().to_vec();
    header.clear_sources();

    let source_materials = sources
        .par_iter()
        .enumerate()
        .map(|(index, descriptor)| {
            let ufo_path = designspace_dir.join(&descriptor.filename);
            let (style_name, metric_definitions, imported_metrics) = if index == 0 {
                (
                    default_style_name.clone(),
                    default_metric_definitions.clone(),
                    default_metrics.clone(),
                )
            } else {
                let ufo_header =
                    load_header(&ufo_path).map_err(|error| DesignspaceError::LoadUfo {
                        path: ufo_path.clone(),
                        source: Box::new(error),
                    })?;
                let metrics = ufo_header
                    .default_source()
                    .cloned()
                    .ok_or(DesignspaceError::NoSources)?;
                (
                    ufo_header.metadata().style_name.clone(),
                    ufo_header.metric_definitions().to_vec(),
                    metrics,
                )
            };
            let glyphs =
                read_glyph_paths(&ufo_path, descriptor.layer.as_deref()).map_err(|error| {
                    DesignspaceError::LoadUfo {
                        path: ufo_path,
                        source: Box::new(error),
                    }
                })?;
            Ok(DesignspaceSourceMaterial {
                index,
                style_name,
                metric_definitions,
                metrics: imported_metrics,
                glyphs,
            })
        })
        .collect::<DesignspaceResult<Vec<_>>>()?;

    let directories = register_designspace_sources(
        &mut header,
        source_materials,
        0,
        |index, style_name, source_names| {
            let descriptor = &sources[index];
            let name = axisless_source_name(descriptor, style_name, source_names, index);
            let mut source =
                Source::with_filename(name, Location::new(), descriptor.filename.clone());
            source.set_layer_name(descriptor.layer.clone());
            source
        },
    );

    let (glyph_ids, glyphs) = build_glyph_directory(&directories);
    Ok((header, GlifGlyphStream::new(glyph_ids, glyphs)))
}

fn register_designspace_sources(
    header: &mut Font,
    source_materials: Vec<DesignspaceSourceMaterial>,
    default_index: usize,
    mut create_source: impl FnMut(usize, Option<&str>, &HashSet<String>) -> Source,
) -> Vec<SourceDirectory> {
    let metric_definitions = header.metric_definitions().to_vec();
    let mut source_names = HashSet::new();
    let mut directories = Vec::with_capacity(source_materials.len());
    for material in source_materials {
        let mut source = create_source(
            material.index,
            material.style_name.as_deref(),
            &source_names,
        );
        source_names.insert(source.name().to_string());
        copy_source_metrics(
            &material.metric_definitions,
            &material.metrics,
            &metric_definitions,
            &mut source,
        );
        let source_id = header.add_source(source);
        if material.index == default_index {
            header.set_default_source_id(source_id.clone());
        }
        directories.push(SourceDirectory {
            source_id,
            glyphs: material.glyphs,
        });
    }
    directories
}

fn add_axes(
    header: &mut Font,
    document: &DesignSpaceDocument,
    labels: &mut HashMap<String, Vec<shift_font::AxisLabel>>,
) -> DesignspaceResult<()> {
    for axis in &document.axes {
        let mut imported = if let Some(values) = &axis.values {
            let mut values = values
                .iter()
                .map(|value| f64::from(*value))
                .collect::<Vec<_>>();
            values.sort_by(f64::total_cmp);
            values.dedup();
            Axis::discrete_with_id(
                AxisId::new(),
                axis.tag.clone(),
                axis.name.clone(),
                values,
                f64::from(axis.default),
            )
        } else {
            let (minimum, maximum) = derive_axis_range(axis);
            Axis::new(
                axis.tag.clone(),
                axis.name.clone(),
                minimum,
                f64::from(axis.default),
                maximum,
            )
        };
        imported.set_hidden(axis.hidden);
        imported.set_labels(labels.remove(axis.name.as_str()).unwrap_or_default());
        imported.validate()?;
        header.add_axis(imported)?;
    }
    Ok(())
}

fn build_glyph_directory(
    directories: &[SourceDirectory],
) -> (HashMap<String, GlyphId>, Vec<GlifGlyph>) {
    let names = directories[0].glyphs.keys().cloned().collect::<Vec<_>>();
    let glyph_ids = names
        .iter()
        .map(|name| (name.clone(), GlyphId::new()))
        .collect::<HashMap<_, _>>();
    let glyphs = names
        .into_iter()
        .map(|name| {
            let mut layers = Vec::new();
            if let Some(path) = directories[0].glyphs.get(&name) {
                layers.push(GlifLayer {
                    source_id: directories[0].source_id.clone(),
                    layer_id: LayerId::new(),
                    path: path.clone(),
                });
            }
            for directory in directories.iter().skip(1) {
                if let Some(path) = directory.glyphs.get(&name) {
                    layers.push(GlifLayer {
                        source_id: directory.source_id.clone(),
                        layer_id: LayerId::new(),
                        path: path.clone(),
                    });
                }
            }
            GlifGlyph {
                id: glyph_ids[&name].clone(),
                name,
                layers,
            }
        })
        .collect();
    (glyph_ids, glyphs)
}
