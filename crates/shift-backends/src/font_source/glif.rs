use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::SystemTime;

use norad::designspace::DesignSpaceDocument;
use norad::{DataRequest, Font as NoradFont, Line, PointType};
use shift_font::{
    Axis as ShiftAxis, AxisId, AxisMapping as ShiftAxisMapping, Location as ShiftLocation,
};

use crate::designspace::{
    axis_mappings_from_designspace, derive_axis_range, find_default_source_index, map_axis_value,
    source_axis_design_value,
};
use crate::font_source::geometry::{
    build_display_glyph, normalize_contour, ContourPoint, SourceComponent, SourceContour,
    SourceGeometry,
};
use crate::font_source::interpolation::{interpolation_weights, InterpolationAxis};
use crate::font_source::{
    AffineTransform, AxisIndex, DirectoryGlyph, DisplayGlyph, FontDirectory, FontImporter,
    FontReadError, GlyphAnchor, GlyphGuide, GlyphIndex, GlyphMetrics, GlyphPointKind,
    PointProvenance, RandomAccessFont, VariationAxis, VariationAxisKind, VariationLocation,
};
use crate::{BackendError, BackendResult, FontFormat, FontImport};

#[derive(Clone, Copy)]
struct FileStamp {
    length: u64,
    modified: Option<SystemTime>,
}

impl FileStamp {
    fn read(path: &Path) -> Result<Self, FontReadError> {
        let metadata = std::fs::metadata(path).map_err(|source| FontReadError::Io {
            path: path.to_path_buf(),
            source,
        })?;
        Ok(Self {
            length: metadata.len(),
            modified: metadata.modified().ok(),
        })
    }

    fn matches(self, path: &Path) -> bool {
        let Ok(metadata) = std::fs::metadata(path) else {
            return false;
        };
        metadata.len() == self.length && metadata.modified().ok() == self.modified
    }
}

struct GlifSource {
    location: Vec<f64>,
    glyph_paths: Box<[Option<PathBuf>]>,
    glyph_stamps: HashMap<PathBuf, FileStamp>,
    manifest_stamps: HashMap<PathBuf, FileStamp>,
}

enum GlifImport {
    Ufo(Arc<[crate::ufo::UfoLayerDirectory]>),
    Designspace(Arc<[BTreeMap<String, PathBuf>]>),
}

/// Retained UFO or Designspace GLIF paths and source-location indexes.
pub struct GlifFont {
    path: PathBuf,
    format: FontFormat,
    changed: AtomicBool,
    directory: FontDirectory,
    glyphs_by_name: HashMap<String, GlyphIndex>,
    sources: Vec<GlifSource>,
    default_source: usize,
    mapped_axes: Vec<ShiftAxis>,
    axis_mappings: Vec<ShiftAxisMapping>,
    interpolation_axes: Vec<InterpolationAxis>,
    import: GlifImport,
}

impl GlifFont {
    pub fn open(path: &Path) -> Result<Self, FontReadError> {
        match path
            .extension()
            .and_then(|extension| extension.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref()
        {
            Some("ufo") => Self::open_ufo(path),
            Some("designspace") => Self::open_designspace(path),
            _ => Err(FontReadError::UnsupportedFormat {
                path: path.to_path_buf(),
            }),
        }
    }

    fn open_ufo(path: &Path) -> Result<Self, FontReadError> {
        let header = load_norad_header(path)?;
        let layers: Arc<[crate::ufo::UfoLayerDirectory]> = Arc::from(
            crate::ufo::read_ufo_layer_directories(path)
                .map_err(|error| malformed(FontFormat::Ufo, path, error.to_string()))?,
        );
        let paths = &layers[0].glyphs;
        let mut names = Vec::new();
        let mut seen_names = HashSet::new();
        for name in layers.iter().flat_map(|layer| layer.glyphs.keys()) {
            if seen_names.insert(name.clone()) {
                names.push(name.clone());
            }
        }
        let (directory, glyphs_by_name) = directory(
            FontFormat::Ufo,
            header.font_info.family_name.clone(),
            header.font_info.style_name.clone(),
            header
                .font_info
                .units_per_em
                .map(|value| *value)
                .unwrap_or(1_000.0),
            names,
            Vec::new(),
        )?;
        let manifests = layers
            .iter()
            .flat_map(|layer| ufo_manifest_paths(path, &layer.glyphs))
            .collect::<HashSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        let mut source = indexed_source(&directory, Vec::new(), paths, &manifests)?;
        for glyph_path in layers.iter().flat_map(|layer| layer.glyphs.values()) {
            source
                .glyph_stamps
                .insert(glyph_path.clone(), FileStamp::read(glyph_path)?);
        }
        Ok(Self {
            path: path.to_path_buf(),
            format: FontFormat::Ufo,
            changed: AtomicBool::new(false),
            directory,
            glyphs_by_name,
            sources: vec![source],
            default_source: 0,
            mapped_axes: Vec::new(),
            axis_mappings: Vec::new(),
            interpolation_axes: Vec::new(),
            import: GlifImport::Ufo(layers),
        })
    }

    fn open_designspace(path: &Path) -> Result<Self, FontReadError> {
        let document = DesignSpaceDocument::load(path).map_err(|error| {
            malformed(
                FontFormat::Designspace,
                path,
                format!("failed to parse Designspace: {error}"),
            )
        })?;
        if document.sources.is_empty() {
            return Err(malformed(
                FontFormat::Designspace,
                path,
                "Designspace has no sources".into(),
            ));
        }
        let default_source = find_default_source_index(&document).ok_or_else(|| {
            malformed(
                FontFormat::Designspace,
                path,
                "Designspace has no source at the mapped default location".into(),
            )
        })?;
        let directory_path = path.parent().ok_or_else(|| {
            malformed(
                FontFormat::Designspace,
                path,
                "Designspace path has no parent directory".into(),
            )
        })?;
        let default_descriptor = &document.sources[default_source];
        let default_ufo = directory_path.join(&default_descriptor.filename);
        let header = load_norad_header(&default_ufo)?;
        let mut source_paths = Vec::with_capacity(document.sources.len());
        let mut names = Vec::new();
        let mut seen_names = HashSet::new();
        for descriptor in &document.sources {
            let ufo = directory_path.join(&descriptor.filename);
            let paths = crate::ufo::read_glyph_paths(&ufo, descriptor.layer.as_deref())
                .map_err(|error| malformed(FontFormat::Designspace, path, error.to_string()))?;
            for name in paths.keys() {
                if seen_names.insert(name.clone()) {
                    names.push(name.clone());
                }
            }
            source_paths.push(paths);
        }
        names.sort();

        let axes = document
            .axes
            .iter()
            .enumerate()
            .map(|(index, axis)| {
                let kind = if let Some(values) = &axis.values {
                    let mut values = values
                        .iter()
                        .map(|value| f64::from(*value))
                        .collect::<Vec<_>>();
                    values.sort_by(f64::total_cmp);
                    values.dedup();
                    VariationAxisKind::Discrete {
                        values: values.into_boxed_slice(),
                        default: f64::from(axis.default),
                    }
                } else {
                    let (minimum, maximum) = derive_axis_range(axis);
                    VariationAxisKind::Continuous {
                        minimum,
                        default: f64::from(axis.default),
                        maximum,
                    }
                };
                VariationAxis {
                    index: AxisIndex::new(index as u32),
                    tag: axis.tag.clone(),
                    name: axis.name.clone(),
                    hidden: axis.hidden,
                    kind,
                }
            })
            .collect::<Vec<_>>();
        let mapped_axes = document
            .axes
            .iter()
            .map(|axis| {
                let mut mapped = if let Some(values) = &axis.values {
                    let mut values = values
                        .iter()
                        .map(|value| f64::from(*value))
                        .collect::<Vec<_>>();
                    values.sort_by(f64::total_cmp);
                    values.dedup();
                    ShiftAxis::discrete_with_id(
                        AxisId::new(),
                        axis.tag.clone(),
                        axis.name.clone(),
                        values,
                        f64::from(axis.default),
                    )
                } else {
                    let (minimum, maximum) = derive_axis_range(axis);
                    ShiftAxis::new(
                        axis.tag.clone(),
                        axis.name.clone(),
                        minimum,
                        f64::from(axis.default),
                        maximum,
                    )
                };
                mapped.set_hidden(axis.hidden);
                mapped
                    .validate()
                    .map_err(|error| malformed(FontFormat::Designspace, path, error.to_string()))?;
                Ok(mapped)
            })
            .collect::<Result<Vec<_>, FontReadError>>()?;
        let axis_mappings = axis_mappings_from_designspace(&document, &mapped_axes)
            .map_err(|error| malformed(FontFormat::Designspace, path, error.to_string()))?;
        let interpolation_axes = document
            .axes
            .iter()
            .map(|axis| {
                let (user_minimum, user_maximum) = derive_axis_range(axis);
                let default = map_axis_value(axis, f64::from(axis.default));
                let mut design_values = vec![
                    map_axis_value(axis, user_minimum),
                    default,
                    map_axis_value(axis, user_maximum),
                ];
                if let Some(mapping) = &axis.map {
                    design_values.extend(mapping.iter().map(|point| f64::from(point.output)));
                }
                InterpolationAxis {
                    tag: axis.tag.clone(),
                    minimum: design_values.iter().copied().fold(default, f64::min),
                    default,
                    maximum: design_values.iter().copied().fold(default, f64::max),
                }
            })
            .collect::<Vec<_>>();
        let family_name = default_descriptor
            .familyname
            .clone()
            .or_else(|| header.font_info.family_name.clone());
        let (directory, glyphs_by_name) = directory(
            FontFormat::Designspace,
            family_name,
            header.font_info.style_name.clone(),
            header
                .font_info
                .units_per_em
                .map(|value| *value)
                .unwrap_or(1_000.0),
            names,
            axes,
        )?;
        let import_paths = Arc::from(source_paths.clone());
        let sources = document
            .sources
            .iter()
            .zip(source_paths)
            .enumerate()
            .map(|(source_index, (descriptor, paths))| {
                let location = document
                    .axes
                    .iter()
                    .map(|axis| source_axis_design_value(&descriptor.location, axis))
                    .collect();
                let ufo = directory_path.join(&descriptor.filename);
                let mut manifests = ufo_manifest_paths(&ufo, &paths);
                if source_index == 0 {
                    manifests.push(path.to_path_buf());
                }
                indexed_source(&directory, location, &paths, &manifests)
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self {
            path: path.to_path_buf(),
            format: FontFormat::Designspace,
            changed: AtomicBool::new(false),
            directory,
            glyphs_by_name,
            sources,
            default_source,
            mapped_axes,
            axis_mappings,
            interpolation_axes,
            import: GlifImport::Designspace(import_paths),
        })
    }

    fn verify_path(&self, source: usize, path: &Path) -> Result<(), FontReadError> {
        let unchanged = self.sources[source]
            .glyph_stamps
            .get(path)
            .is_some_and(|stamp| stamp.matches(path));
        if self.changed.load(Ordering::Acquire) || !unchanged {
            self.changed.store(true, Ordering::Release);
            return Err(FontReadError::SourceChanged {
                path: path.to_path_buf(),
            });
        }
        Ok(())
    }

    fn verify_manifests(&self) -> Result<(), FontReadError> {
        for source in &self.sources {
            for (path, stamp) in &source.manifest_stamps {
                if self.changed.load(Ordering::Acquire) || !stamp.matches(path) {
                    self.changed.store(true, Ordering::Release);
                    return Err(FontReadError::SourceChanged { path: path.clone() });
                }
            }
        }
        Ok(())
    }

    fn verify_all(&self) -> Result<(), FontReadError> {
        self.verify_manifests()?;
        for (source_index, source) in self.sources.iter().enumerate() {
            for path in source.glyph_stamps.keys() {
                self.verify_path(source_index, path)?;
            }
        }
        Ok(())
    }

    fn design_location(&self, location: &VariationLocation) -> Result<Vec<f64>, FontReadError> {
        if location.coordinates().len() != self.directory.axes.len() {
            return Err(FontReadError::InvalidDisplayGlyph {
                details: format!(
                    "location has {} coordinates for {} axes",
                    location.coordinates().len(),
                    self.directory.axes.len()
                ),
            });
        }
        for (axis, value) in self.directory.axes.iter().zip(location.coordinates()) {
            axis.kind.validate_for_read(axis.index, *value)?;
        }
        let mut external = ShiftLocation::new();
        for (axis, value) in self.mapped_axes.iter().zip(location.coordinates()) {
            external.set(axis.id(), *value);
        }
        let mapped =
            shift_font::variation::map_location(&external, &self.mapped_axes, &self.axis_mappings)
                .map_err(|error| malformed(self.format, &self.path, error.to_string()))?;
        Ok(self
            .mapped_axes
            .iter()
            .map(|axis| mapped.get(&axis.id()).unwrap_or(axis.default()))
            .collect())
    }
}

impl RandomAccessFont for GlifFont {
    fn directory(&self) -> &FontDirectory {
        &self.directory
    }

    fn read_glyph(
        &self,
        glyph: GlyphIndex,
        location: &VariationLocation,
    ) -> Result<DisplayGlyph, FontReadError> {
        self.verify_manifests()?;
        if glyph.to_usize() >= self.directory.glyphs.len() {
            return Err(FontReadError::GlyphOutOfRange {
                glyph,
                glyph_count: self.directory.glyphs.len() as u32,
            });
        }
        let design_location = self.design_location(location)?;
        let mut resolver = GlifResolver {
            font: self,
            location: &design_location,
            indices: HashMap::new(),
            states: Vec::new(),
            geometries: Vec::new(),
            root_metrics: None,
        };
        resolver.resolve_geometry(glyph)?;
        self.verify_manifests()?;
        let metrics = resolver
            .root_metrics
            .ok_or_else(|| FontReadError::InvalidDisplayGlyph {
                details: "resolved GLIF glyph has no metrics".into(),
            })?;
        build_display_glyph(glyph, location.clone(), resolver.geometries, metrics)
    }
}

impl FontImporter for GlifFont {
    fn begin_import(&self) -> BackendResult<FontImport> {
        self.verify_all().map_err(|error| {
            BackendError::load(
                self.format,
                self.path.clone(),
                format_error(self.format, error.to_string()),
            )
        })?;
        let (header, stream): (_, Box<dyn crate::import::GlyphStream>) = match &self.import {
            GlifImport::Ufo(layers) => {
                let (header, stream) = crate::ufo::stream_retained(&self.path, layers.clone())
                    .map_err(|source| BackendError::load(self.format, self.path.clone(), source))?;
                (header, Box::new(stream))
            }
            GlifImport::Designspace(glyph_paths) => {
                let (header, stream) =
                    crate::designspace::stream_retained(&self.path, glyph_paths.clone()).map_err(
                        |source| BackendError::load(self.format, self.path.clone(), source),
                    )?;
                (header, Box::new(stream))
            }
        };
        Ok(FontImport::new(
            header,
            stream,
            self.format,
            self.path.clone(),
        ))
    }
}

#[derive(Clone)]
struct ResolvedLayer {
    geometry: SourceGeometry,
    metrics: GlyphMetrics,
}

struct GlifResolver<'a> {
    font: &'a GlifFont,
    location: &'a [f64],
    indices: HashMap<GlyphIndex, usize>,
    states: Vec<u8>,
    geometries: Vec<SourceGeometry>,
    root_metrics: Option<GlyphMetrics>,
}

impl GlifResolver<'_> {
    fn resolve_geometry(&mut self, glyph: GlyphIndex) -> Result<usize, FontReadError> {
        if let Some(index) = self.indices.get(&glyph).copied() {
            return match self.states[index] {
                1 => Err(FontReadError::ComponentCycle { glyph }),
                2 => Ok(index),
                _ => Err(FontReadError::InvalidDisplayGlyph {
                    details: "GLIF geometry has an invalid resolution state".into(),
                }),
            };
        }
        let layer = resolve_glif_layer(self.font, glyph, self.location)?;
        let index = self.geometries.len();
        self.indices.insert(glyph, index);
        self.states.push(1);
        self.geometries.push(empty_geometry(glyph));
        if index == 0 {
            self.root_metrics = Some(layer.metrics);
        }
        for component in &layer.geometry.components {
            self.resolve_geometry(component.glyph)?;
        }
        self.geometries[index] = layer.geometry;
        self.states[index] = 2;
        Ok(index)
    }
}

fn resolve_glif_layer(
    font: &GlifFont,
    glyph: GlyphIndex,
    location: &[f64],
) -> Result<ResolvedLayer, FontReadError> {
    let mut layers = Vec::new();
    for (source_index, source) in font.sources.iter().enumerate() {
        let Some(path) = source
            .glyph_paths
            .get(glyph.to_usize())
            .and_then(Option::as_ref)
        else {
            continue;
        };
        font.verify_path(source_index, path)?;
        let parsed = norad::Glyph::load(path).map_err(|error| {
            malformed(
                font.format,
                &font.path,
                format!("failed to read glyph {}: {error}", path.display()),
            )
        })?;
        font.verify_path(source_index, path)?;
        layers.push((source_index, convert_norad_layer(font, glyph, &parsed)?));
    }
    if layers.is_empty() {
        return Ok(ResolvedLayer {
            geometry: empty_geometry(glyph),
            metrics: GlyphMetrics {
                x_advance: 0.0,
                y_advance: None,
            },
        });
    }
    if let Some((_, layer)) = layers
        .iter()
        .find(|(source, _)| font.sources[*source].location == location)
    {
        return Ok(layer.clone());
    }
    let reference_position = layers
        .iter()
        .position(|(source, _)| *source == font.default_source)
        .unwrap_or(0);
    let reference = layers[reference_position].1.clone();
    let compatible = layers
        .into_iter()
        .filter(|(_, layer)| layer_compatible(&reference, layer))
        .collect::<Vec<_>>();
    let source_locations = compatible
        .iter()
        .map(|(source, _)| font.sources[*source].location.clone())
        .collect::<Vec<_>>();
    let Some(weights) =
        interpolation_weights(&source_locations, &font.interpolation_axes, location)
    else {
        return Ok(reference);
    };
    interpolate_layers(&reference, &compatible, &weights)
}

fn convert_norad_layer(
    font: &GlifFont,
    glyph: GlyphIndex,
    source: &norad::Glyph,
) -> Result<ResolvedLayer, FontReadError> {
    let mut components = Vec::with_capacity(source.components.len());
    for component in &source.components {
        let name = component.base.to_string();
        let base = font.glyphs_by_name.get(&name).copied().ok_or_else(|| {
            malformed(
                font.format,
                &font.path,
                format!("component base glyph {name:?} does not exist"),
            )
        })?;
        components.push(SourceComponent {
            glyph: base,
            transform: AffineTransform {
                xx: component.transform.x_scale,
                xy: component.transform.xy_scale,
                yx: component.transform.yx_scale,
                yy: component.transform.y_scale,
                dx: component.transform.x_offset,
                dy: component.transform.y_offset,
            },
        });
    }
    Ok(ResolvedLayer {
        geometry: SourceGeometry {
            glyph,
            contours: source
                .contours
                .iter()
                .filter(|contour| !contour.points.is_empty())
                .map(normalize_glif_contour)
                .collect::<Result<Vec<_>, _>>()?,
            components,
            anchors: source
                .anchors
                .iter()
                .map(|anchor| GlyphAnchor {
                    name: anchor.name.as_ref().map(ToString::to_string),
                    x: anchor.x,
                    y: anchor.y,
                })
                .collect(),
            guides: source.guidelines.iter().map(convert_guide).collect(),
        },
        metrics: GlyphMetrics {
            x_advance: source.width,
            y_advance: Some(source.height),
        },
    })
}

fn layer_compatible(reference: &ResolvedLayer, candidate: &ResolvedLayer) -> bool {
    reference.geometry.contours.len() == candidate.geometry.contours.len()
        && reference
            .geometry
            .contours
            .iter()
            .zip(&candidate.geometry.contours)
            .all(|(left, right)| {
                left.closed == right.closed
                    && left.points.len() == right.points.len()
                    && left
                        .points
                        .iter()
                        .zip(&right.points)
                        .all(|(left, right)| left.kind == right.kind)
            })
        && reference.geometry.components.len() == candidate.geometry.components.len()
        && reference
            .geometry
            .components
            .iter()
            .zip(&candidate.geometry.components)
            .all(|(left, right)| left.glyph == right.glyph)
        && reference.geometry.anchors.len() == candidate.geometry.anchors.len()
        && reference
            .geometry
            .anchors
            .iter()
            .zip(&candidate.geometry.anchors)
            .all(|(left, right)| left.name == right.name)
        && reference.geometry.guides.len() == candidate.geometry.guides.len()
        && reference
            .geometry
            .guides
            .iter()
            .zip(&candidate.geometry.guides)
            .all(guides_compatible)
}

fn interpolate_layers(
    reference: &ResolvedLayer,
    sources: &[(usize, ResolvedLayer)],
    weights: &[f64],
) -> Result<ResolvedLayer, FontReadError> {
    if sources.len() != weights.len() {
        return Err(FontReadError::InvalidDisplayGlyph {
            details: "interpolation source and weight counts disagree".into(),
        });
    }
    let mut result = reference.clone();
    for (contour_index, contour) in result.geometry.contours.iter_mut().enumerate() {
        for (point_index, point) in contour.points.iter_mut().enumerate() {
            point.x = weighted(sources, weights, |source| {
                source.geometry.contours[contour_index].points[point_index].x
            });
            point.y = weighted(sources, weights, |source| {
                source.geometry.contours[contour_index].points[point_index].y
            });
        }
    }
    for (component_index, component) in result.geometry.components.iter_mut().enumerate() {
        component.transform.xx = weighted(sources, weights, |source| {
            source.geometry.components[component_index].transform.xx
        });
        component.transform.xy = weighted(sources, weights, |source| {
            source.geometry.components[component_index].transform.xy
        });
        component.transform.yx = weighted(sources, weights, |source| {
            source.geometry.components[component_index].transform.yx
        });
        component.transform.yy = weighted(sources, weights, |source| {
            source.geometry.components[component_index].transform.yy
        });
        component.transform.dx = weighted(sources, weights, |source| {
            source.geometry.components[component_index].transform.dx
        });
        component.transform.dy = weighted(sources, weights, |source| {
            source.geometry.components[component_index].transform.dy
        });
    }
    for (anchor_index, anchor) in result.geometry.anchors.iter_mut().enumerate() {
        anchor.x = weighted(sources, weights, |source| {
            source.geometry.anchors[anchor_index].x
        });
        anchor.y = weighted(sources, weights, |source| {
            source.geometry.anchors[anchor_index].y
        });
    }
    for (guide_index, guide) in result.geometry.guides.iter_mut().enumerate() {
        match guide {
            GlyphGuide::Horizontal { y, .. } => {
                *y = weighted(sources, weights, |source| {
                    match &source.geometry.guides[guide_index] {
                        GlyphGuide::Horizontal { y, .. } => *y,
                        _ => unreachable!("compatible guide kind changed"),
                    }
                });
            }
            GlyphGuide::Vertical { x, .. } => {
                *x = weighted(sources, weights, |source| {
                    match &source.geometry.guides[guide_index] {
                        GlyphGuide::Vertical { x, .. } => *x,
                        _ => unreachable!("compatible guide kind changed"),
                    }
                });
            }
            GlyphGuide::Angled { x, y, degrees, .. } => {
                *x = weighted(sources, weights, |source| {
                    match &source.geometry.guides[guide_index] {
                        GlyphGuide::Angled { x, .. } => *x,
                        _ => unreachable!("compatible guide kind changed"),
                    }
                });
                *y = weighted(sources, weights, |source| {
                    match &source.geometry.guides[guide_index] {
                        GlyphGuide::Angled { y, .. } => *y,
                        _ => unreachable!("compatible guide kind changed"),
                    }
                });
                *degrees = weighted(sources, weights, |source| {
                    match &source.geometry.guides[guide_index] {
                        GlyphGuide::Angled { degrees, .. } => *degrees,
                        _ => unreachable!("compatible guide kind changed"),
                    }
                });
            }
        }
    }
    result.metrics.x_advance = weighted(sources, weights, |source| source.metrics.x_advance);
    result.metrics.y_advance = if sources
        .iter()
        .all(|(_, source)| source.metrics.y_advance.is_some())
    {
        Some(weighted(sources, weights, |source| {
            source.metrics.y_advance.unwrap_or_default()
        }))
    } else {
        None
    };
    Ok(result)
}

fn weighted(
    sources: &[(usize, ResolvedLayer)],
    weights: &[f64],
    value: impl Fn(&ResolvedLayer) -> f64,
) -> f64 {
    sources
        .iter()
        .zip(weights)
        .map(|((_, source), weight)| value(source) * weight)
        .sum()
}

fn normalize_glif_contour(contour: &norad::Contour) -> Result<SourceContour, FontReadError> {
    let closed = contour.is_closed();
    let points = contour
        .points
        .iter()
        .enumerate()
        .map(|(index, point)| {
            Ok(ContourPoint {
                x: point.x,
                y: point.y,
                kind: glif_point_kind(&contour.points, index, closed)?,
                smooth: point.smooth,
                provenance: PointProvenance::Native {
                    ttf_point_index: None,
                },
            })
        })
        .collect::<Result<Vec<_>, FontReadError>>()?;
    normalize_contour(points, closed)
}

fn glif_point_kind(
    points: &[norad::ContourPoint],
    index: usize,
    closed: bool,
) -> Result<GlyphPointKind, FontReadError> {
    if points[index].typ != PointType::OffCurve {
        return Ok(GlyphPointKind::OnCurve);
    }
    let mut next = next_contour_index(index, points.len(), closed);
    for _ in 0..points.len() {
        let Some(next_index) = next else {
            break;
        };
        match points[next_index].typ {
            PointType::OffCurve => next = next_contour_index(next_index, points.len(), closed),
            PointType::QCurve => return Ok(GlyphPointKind::QuadraticControl),
            PointType::Curve => return Ok(GlyphPointKind::CubicControl),
            PointType::Move | PointType::Line => {
                return Err(FontReadError::InvalidDisplayGlyph {
                    details: "off-curve GLIF point is followed by a line endpoint".into(),
                })
            }
        }
    }
    if closed {
        return Ok(GlyphPointKind::QuadraticControl);
    }
    Err(FontReadError::InvalidDisplayGlyph {
        details: "open GLIF contour ends with an off-curve point".into(),
    })
}

fn next_contour_index(index: usize, count: usize, closed: bool) -> Option<usize> {
    if index + 1 < count {
        Some(index + 1)
    } else if closed {
        Some(0)
    } else {
        None
    }
}

fn convert_guide(guide: &norad::Guideline) -> GlyphGuide {
    match guide.line {
        Line::Horizontal(y) => GlyphGuide::Horizontal {
            y,
            name: guide.name.as_ref().map(ToString::to_string),
            color: guide.color.as_ref().map(|color| color.to_rgba_string()),
        },
        Line::Vertical(x) => GlyphGuide::Vertical {
            x,
            name: guide.name.as_ref().map(ToString::to_string),
            color: guide.color.as_ref().map(|color| color.to_rgba_string()),
        },
        Line::Angle { x, y, degrees } => GlyphGuide::Angled {
            x,
            y,
            degrees,
            name: guide.name.as_ref().map(ToString::to_string),
            color: guide.color.as_ref().map(|color| color.to_rgba_string()),
        },
    }
}

fn guides_compatible((left, right): (&GlyphGuide, &GlyphGuide)) -> bool {
    match (left, right) {
        (
            GlyphGuide::Horizontal {
                name: left_name,
                color: left_color,
                ..
            },
            GlyphGuide::Horizontal {
                name: right_name,
                color: right_color,
                ..
            },
        )
        | (
            GlyphGuide::Vertical {
                name: left_name,
                color: left_color,
                ..
            },
            GlyphGuide::Vertical {
                name: right_name,
                color: right_color,
                ..
            },
        )
        | (
            GlyphGuide::Angled {
                name: left_name,
                color: left_color,
                ..
            },
            GlyphGuide::Angled {
                name: right_name,
                color: right_color,
                ..
            },
        ) => left_name == right_name && left_color == right_color,
        _ => false,
    }
}

fn empty_geometry(glyph: GlyphIndex) -> SourceGeometry {
    SourceGeometry {
        glyph,
        contours: Vec::new(),
        components: Vec::new(),
        anchors: Vec::new(),
        guides: Vec::new(),
    }
}

fn ufo_manifest_paths(ufo: &Path, glyphs: &BTreeMap<String, PathBuf>) -> Vec<PathBuf> {
    let mut paths = HashSet::new();
    paths.insert(ufo.to_path_buf());
    for name in [
        "metainfo.plist",
        "fontinfo.plist",
        "lib.plist",
        "groups.plist",
        "kerning.plist",
        "features.fea",
        "layercontents.plist",
    ] {
        let path = ufo.join(name);
        if path.exists() {
            paths.insert(path);
        }
    }
    for glyph in glyphs.values() {
        if let Some(layer) = glyph.parent() {
            paths.insert(layer.to_path_buf());
            paths.insert(layer.join("contents.plist"));
            let layer_info = layer.join("layerinfo.plist");
            if layer_info.exists() {
                paths.insert(layer_info);
            }
        }
    }
    let mut paths = paths.into_iter().collect::<Vec<_>>();
    paths.sort();
    paths
}

fn indexed_source(
    directory: &FontDirectory,
    location: Vec<f64>,
    paths: &BTreeMap<String, PathBuf>,
    manifests: &[PathBuf],
) -> Result<GlifSource, FontReadError> {
    let glyph_paths = directory
        .glyphs
        .iter()
        .map(|glyph| paths.get(&glyph.name).cloned())
        .collect::<Vec<_>>();
    let glyph_stamps = glyph_paths
        .iter()
        .flatten()
        .map(|path| Ok((path.clone(), FileStamp::read(path)?)))
        .collect::<Result<HashMap<_, _>, FontReadError>>()?;
    let manifest_stamps = manifests
        .iter()
        .map(|path| Ok((path.clone(), FileStamp::read(path)?)))
        .collect::<Result<HashMap<_, _>, FontReadError>>()?;
    Ok(GlifSource {
        location,
        glyph_paths: glyph_paths.into_boxed_slice(),
        glyph_stamps,
        manifest_stamps,
    })
}

fn directory(
    format: FontFormat,
    family_name: Option<String>,
    style_name: Option<String>,
    units_per_em: f64,
    names: Vec<String>,
    axes: Vec<VariationAxis>,
) -> Result<(FontDirectory, HashMap<String, GlyphIndex>), FontReadError> {
    let glyphs = names
        .into_iter()
        .enumerate()
        .map(|(index, name)| DirectoryGlyph {
            index: GlyphIndex::new(index as u32),
            name,
            unicodes: Box::new([]),
        })
        .collect();
    let directory =
        FontDirectory::new(format, family_name, style_name, units_per_em, glyphs, axes)?;
    let glyphs_by_name = directory
        .glyphs
        .iter()
        .map(|glyph| (glyph.name.clone(), glyph.index))
        .collect();
    Ok((directory, glyphs_by_name))
}

fn load_norad_header(path: &Path) -> Result<NoradFont, FontReadError> {
    NoradFont::load_requested_data(path, DataRequest::all().layers(false))
        .map_err(|error| malformed(FontFormat::Ufo, path, error.to_string()))
}

fn format_error(format: FontFormat, details: String) -> crate::FormatBackendError {
    match format {
        FontFormat::Ufo => crate::FormatBackendError::Ufo(details),
        FontFormat::Designspace => crate::FormatBackendError::Designspace(
            crate::designspace::DesignspaceError::LoadDesignspace {
                path: PathBuf::new(),
                details,
            },
        ),
        _ => unreachable!("GLIF format must be UFO or Designspace"),
    }
}

fn malformed(format: FontFormat, path: &Path, details: String) -> FontReadError {
    FontReadError::MalformedSource {
        format,
        path: path.to_path_buf(),
        details,
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;
    use crate::font_source::VariationCoordinate;

    fn fixture(path: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join("fixtures/fonts")
            .join(path)
    }

    #[test]
    fn ufo_directory_and_selected_glyph_need_no_shift_identity() {
        let font = GlifFont::open(&fixture("mutatorsans/MutatorSansLightCondensed.ufo")).unwrap();
        let glyph = font
            .directory()
            .glyphs
            .iter()
            .find(|glyph| glyph.name == "S")
            .expect("fixture should contain S");
        let display = font
            .read_glyph(glyph.index, font.directory().default_location())
            .unwrap();

        assert_eq!(display.glyph, glyph.index);
        assert!(!display.points.is_empty());
        assert!(display.points.iter().all(|point| matches!(
            point.provenance,
            PointProvenance::Native {
                ttf_point_index: None
            } | PointProvenance::Implied
        )));
    }

    #[test]
    fn ufo_manifest_changes_poison_the_open_generation() {
        let temporary = tempfile::tempdir().unwrap();
        let copied = temporary.path().join("Changed.ufo");
        copy_directory(
            &fixture("mutatorsans/MutatorSansLightCondensed.ufo"),
            &copied,
        );
        let font = GlifFont::open(&copied).unwrap();
        let glyph = font.directory().glyphs[0].index;
        let manifest = copied.join("glyphs/contents.plist");
        let original = fs::read(&manifest).unwrap();
        let mut changed = original.clone();
        changed.extend_from_slice(b"\n");
        fs::write(&manifest, changed).unwrap();

        assert!(matches!(
            font.read_glyph(glyph, font.directory().default_location()),
            Err(FontReadError::SourceChanged { .. })
        ));
        fs::write(&manifest, original).unwrap();
        assert!(matches!(
            font.read_glyph(glyph, font.directory().default_location()),
            Err(FontReadError::SourceChanged { .. })
        ));
    }

    #[test]
    fn designspace_selected_glyph_changes_at_a_non_default_location() {
        let font =
            GlifFont::open(&fixture("mutatorsans-variable/MutatorSans.designspace")).unwrap();
        let glyph = font
            .directory()
            .glyphs
            .iter()
            .find(|glyph| glyph.name == "S")
            .expect("fixture should contain S");
        let default = font
            .read_glyph(glyph.index, font.directory().default_location())
            .unwrap();
        let axis = &font.directory().axes[0];
        let maximum = match axis.kind {
            VariationAxisKind::Continuous { maximum, .. } => maximum,
            VariationAxisKind::Discrete { .. } => panic!("fixture axis should be continuous"),
        };
        let location = font
            .directory()
            .location(&[VariationCoordinate {
                axis: axis.index,
                value: maximum,
            }])
            .unwrap();
        let changed = font.read_glyph(glyph.index, &location).unwrap();

        assert_ne!(default.points, changed.points);
    }

    fn copy_directory(source: &Path, target: &Path) {
        fs::create_dir_all(target).unwrap();
        for entry in fs::read_dir(source).unwrap() {
            let entry = entry.unwrap();
            let destination = target.join(entry.file_name());
            if entry.file_type().unwrap().is_dir() {
                copy_directory(&entry.path(), &destination);
            } else {
                fs::copy(entry.path(), destination).unwrap();
            }
        }
    }
}
