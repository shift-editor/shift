use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::designspace::{
    derive_axis_range, find_default_source_index, map_axis_value, source_axis_design_value,
};
use crate::font_source::geometry::{
    normalize_contour, ContourPoint, SourceComponent, SourceContour, SourceGeometry,
};
use crate::font_source::interpolation::InterpolationAxis;
use crate::font_source::projection::{project_layers, ProjectionLayer};
use crate::font_source::{
    AffineTransform, AxisIndex, DirectoryAxisMapping, DirectoryGlyph, DirectorySource,
    FontDirectory, FontImporter, FontReadError, FontSource, GlyphAnchor, GlyphIndex, GlyphMetrics,
    GlyphPointKind, PointProvenance, ProjectedGlyph, SourceIndex, VariationAxis, VariationAxisKind,
};
use crate::{BackendError, BackendResult, FontFormat, FontImport};
use norad::designspace::DesignSpaceDocument;
use norad::{DataRequest, Font as NoradFont, PointType};

struct RetainedGlif {
    path: PathBuf,
    bytes: Arc<[u8]>,
}

struct GlifSource {
    location: Vec<f64>,
    glyphs: Box<[Option<RetainedGlif>]>,
}

enum GlifImport {
    Ufo(Arc<[crate::ufo::UfoLayerDirectory]>),
    Designspace(Arc<[BTreeMap<String, PathBuf>]>),
}

/// Retained UFO or Designspace GLIF paths and source-location indexes.
pub struct GlifFont {
    path: PathBuf,
    format: FontFormat,
    directory: FontDirectory,
    glyphs_by_name: HashMap<String, GlyphIndex>,
    sources: Vec<GlifSource>,
    default_source: usize,
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
        let source = retained_source(&directory, Vec::new(), paths)?;
        Ok(Self {
            path: path.to_path_buf(),
            format: FontFormat::Ufo,
            directory,
            glyphs_by_name,
            sources: vec![source],
            default_source: 0,
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
        let (mut directory, glyphs_by_name) = directory(
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
            .map(|(descriptor, paths)| {
                let location = document
                    .axes
                    .iter()
                    .map(|axis| source_axis_design_value(&descriptor.location, axis))
                    .collect();
                retained_source(&directory, location, &paths)
            })
            .collect::<Result<Vec<_>, _>>()?;
        let directory_sources = document
            .sources
            .iter()
            .enumerate()
            .map(|(index, descriptor)| DirectorySource {
                index: SourceIndex::new(index as u32),
                name: descriptor
                    .name
                    .clone()
                    .or_else(|| descriptor.stylename.clone())
                    .unwrap_or_else(|| format!("Source {}", index + 1)),
                location: document
                    .axes
                    .iter()
                    .map(|axis| source_axis_design_value(&descriptor.location, axis))
                    .collect::<Vec<_>>()
                    .into_boxed_slice(),
                filename: Some(descriptor.filename.clone()),
            })
            .collect();
        directory.set_sources(directory_sources, SourceIndex::new(default_source as u32))?;
        directory.set_axis_mappings(
            document
                .axes
                .iter()
                .enumerate()
                .filter_map(|(index, axis)| {
                    let points = axis.map.as_ref()?;
                    Some(DirectoryAxisMapping {
                        axis: AxisIndex::new(index as u32),
                        points: points
                            .iter()
                            .map(|point| (f64::from(point.input), f64::from(point.output)))
                            .collect::<Vec<_>>()
                            .into_boxed_slice(),
                    })
                })
                .collect(),
        );
        Ok(Self {
            path: path.to_path_buf(),
            format: FontFormat::Designspace,
            directory,
            glyphs_by_name,
            sources,
            default_source,
            interpolation_axes,
            import: GlifImport::Designspace(import_paths),
        })
    }
}

impl FontSource for GlifFont {
    fn directory(&self) -> &FontDirectory {
        &self.directory
    }

    fn glyph(&self, glyph: GlyphIndex) -> Result<ProjectedGlyph, FontReadError> {
        if glyph.to_usize() >= self.directory.glyphs.len() {
            return Err(FontReadError::GlyphOutOfRange {
                glyph,
                glyph_count: self.directory.glyphs.len() as u32,
            });
        }

        let mut resolver = GlifProjectionResolver {
            font: self,
            states: HashMap::new(),
            projections: HashMap::new(),
        };
        resolver.resolve(glyph)?;
        let root = resolver.projections.remove(&glyph).ok_or_else(|| {
            FontReadError::InvalidProjection {
                details: "GLIF projection root is unavailable".into(),
            }
        })?;
        let mut components = resolver.projections.into_values().collect::<Vec<_>>();
        components.sort_by_key(|projection| projection.glyph);
        Ok(ProjectedGlyph {
            root,
            components: components.into_boxed_slice(),
        })
    }
}

struct GlifProjectionResolver<'a> {
    font: &'a GlifFont,
    states: HashMap<GlyphIndex, u8>,
    projections: HashMap<GlyphIndex, crate::font_source::GlyphProjection>,
}

impl GlifProjectionResolver<'_> {
    fn resolve(&mut self, glyph: GlyphIndex) -> Result<(), FontReadError> {
        match self.states.get(&glyph).copied() {
            Some(1) => return Err(FontReadError::ComponentCycle { glyph }),
            Some(2) => return Ok(()),
            _ => {}
        }
        self.states.insert(glyph, 1);
        let projection = project_glif_glyph(self.font, glyph)?;
        let dependencies = projection
            .fallback
            .components
            .iter()
            .map(|component| component.glyph)
            .chain(projection.exact_shapes.iter().flat_map(|shape| {
                shape
                    .shape
                    .components
                    .iter()
                    .map(|component| component.glyph)
            }))
            .collect::<HashSet<_>>();
        for dependency in dependencies {
            self.resolve(dependency)?;
        }
        self.projections.insert(glyph, projection);
        self.states.insert(glyph, 2);
        Ok(())
    }
}

fn project_glif_glyph(
    font: &GlifFont,
    glyph: GlyphIndex,
) -> Result<crate::font_source::GlyphProjection, FontReadError> {
    let mut layers = Vec::new();
    for (source_index, source) in font.sources.iter().enumerate() {
        let Some(retained) = source.glyphs.get(glyph.to_usize()).and_then(Option::as_ref) else {
            continue;
        };
        let parsed = norad::Glyph::parse_raw(&retained.bytes).map_err(|error| {
            malformed(
                font.format,
                &font.path,
                format!("failed to parse glyph {}: {error}", retained.path.display()),
            )
        })?;
        let layer = convert_norad_layer(font, glyph, &parsed)?;
        layers.push((
            SourceIndex::new(source_index as u32),
            source.location.clone(),
            ProjectionLayer {
                geometry: layer.geometry,
                metrics: layer.metrics,
            },
        ));
    }
    if layers.is_empty() {
        layers.push((
            SourceIndex::new(font.default_source as u32),
            font.sources[font.default_source].location.clone(),
            ProjectionLayer {
                geometry: empty_geometry(glyph),
                metrics: GlyphMetrics {
                    x_advance: 0.0,
                    y_advance: None,
                },
            },
        ));
    }
    project_layers(
        layers,
        &font.interpolation_axes,
        SourceIndex::new(font.default_source as u32),
    )
}

impl FontImporter for GlifFont {
    fn begin_import(&self) -> BackendResult<FontImport> {
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
        },
        metrics: GlyphMetrics {
            x_advance: source.width,
            y_advance: Some(source.height),
        },
    })
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
                return Err(FontReadError::InvalidProjection {
                    details: "off-curve GLIF point is followed by a line endpoint".into(),
                })
            }
        }
    }
    if closed {
        return Ok(GlyphPointKind::QuadraticControl);
    }
    Err(FontReadError::InvalidProjection {
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

fn empty_geometry(glyph: GlyphIndex) -> SourceGeometry {
    SourceGeometry {
        glyph,
        contours: Vec::new(),
        components: Vec::new(),
        anchors: Vec::new(),
    }
}

fn retained_source(
    directory: &FontDirectory,
    location: Vec<f64>,
    paths: &BTreeMap<String, PathBuf>,
) -> Result<GlifSource, FontReadError> {
    let glyphs = directory
        .glyphs
        .iter()
        .map(|glyph| {
            let Some(path) = paths.get(&glyph.name) else {
                return Ok(None);
            };
            let bytes = std::fs::read(path).map_err(|source| FontReadError::Io {
                path: path.clone(),
                source,
            })?;
            Ok(Some(RetainedGlif {
                path: path.clone(),
                bytes: bytes.into(),
            }))
        })
        .collect::<Result<Vec<_>, FontReadError>>()?;
    Ok(GlifSource {
        location,
        glyphs: glyphs.into_boxed_slice(),
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
    fn ufo_directory_and_projection_need_no_shift_identity() {
        let font = GlifFont::open(&fixture("mutatorsans/MutatorSansLightCondensed.ufo")).unwrap();
        let glyph = font
            .directory()
            .glyphs
            .iter()
            .find(|glyph| glyph.name == "S")
            .expect("fixture should contain S");
        let projected = font.glyph(glyph.index).unwrap();

        assert_eq!(projected.root.glyph, glyph.index);
        assert!(!projected.root.fallback.contours.is_empty());
        assert!(projected
            .root
            .fallback
            .contours
            .iter()
            .flat_map(|contour| contour.points.iter())
            .all(|point| matches!(
                point.provenance,
                PointProvenance::Native {
                    ttf_point_index: None
                } | PointProvenance::Implied
            )));
    }

    #[test]
    fn ufo_projection_uses_retained_bytes_after_source_removal() {
        let temporary = tempfile::tempdir().unwrap();
        let copied = temporary.path().join("Removed.ufo");
        copy_directory(
            &fixture("mutatorsans/MutatorSansLightCondensed.ufo"),
            &copied,
        );
        let font = GlifFont::open(&copied).unwrap();
        let glyph = font
            .directory()
            .glyphs
            .iter()
            .find(|glyph| glyph.name == "S")
            .unwrap()
            .index;
        let expected = font.glyph(glyph).unwrap();
        fs::remove_dir_all(&copied).unwrap();

        assert_eq!(font.glyph(glyph).unwrap(), expected);
    }

    #[test]
    fn designspace_projection_retains_variation_after_source_removal() {
        let temporary = tempfile::tempdir().unwrap();
        let copied = temporary.path().join("Removed");
        copy_directory(&fixture("mutatorsans-variable"), &copied);
        let font = GlifFont::open(&copied.join("MutatorSans.designspace")).unwrap();
        let glyph = font
            .directory()
            .glyphs
            .iter()
            .find(|glyph| glyph.name == "S")
            .expect("fixture should contain S");
        let glyph = glyph.index;
        fs::remove_dir_all(&copied).unwrap();
        let projection = font.glyph(glyph).unwrap().root;
        let variation = projection
            .variation
            .expect("variable designspace glyph should retain deltas");

        assert!(variation
            .deltas
            .iter()
            .flat_map(|delta| delta.values.iter())
            .any(|value| *value != 0.0));
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
