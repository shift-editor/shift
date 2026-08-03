use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::SystemTime;

use glyphs_reader::{Font as ParsedGlyphsFont, Glyph as ParsedGlyph, Layer, Node, NodeType, Shape};

use crate::font_source::geometry::{
    build_display_glyph, normalize_contour, ContourPoint, SourceComponent, SourceContour,
    SourceGeometry,
};
use crate::font_source::interpolation::{interpolation_weights, InterpolationAxis};
use crate::font_source::{
    AffineTransform, AxisIndex, DirectoryGlyph, DisplayGlyph, FontDirectory, FontImporter,
    FontReadError, GlyphAnchor, GlyphIndex, GlyphMetrics, GlyphPointKind, PointProvenance,
    RandomAccessFont, VariationAxis, VariationAxisKind, VariationLocation,
};
use crate::{BackendError, BackendResult, FontFormat, FontImport};

#[derive(Clone, Copy)]
struct SourceStamp {
    length: u64,
    modified: Option<SystemTime>,
}

impl SourceStamp {
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

#[derive(Clone)]
struct GlyphsAxisMapping {
    user_to_design: Box<[(f64, f64)]>,
}

impl GlyphsAxisMapping {
    fn map(&self, user: f64) -> f64 {
        piecewise_map(&self.user_to_design, user)
    }

    fn unmap(&self, design: f64) -> f64 {
        let mut design_to_user = self
            .user_to_design
            .iter()
            .map(|(user, design)| (*design, *user))
            .collect::<Vec<_>>();
        design_to_user.sort_by(|left, right| left.0.total_cmp(&right.0));
        design_to_user.dedup_by(|left, right| left.0 == right.0);
        piecewise_map(&design_to_user, design)
    }

    fn user_values(&self) -> impl Iterator<Item = f64> + '_ {
        self.user_to_design.iter().map(|(user, _)| *user)
    }
}

/// One retained parsed Glyphs or Glyphspackage source.
pub struct GlyphsFont {
    path: PathBuf,
    stamp: SourceStamp,
    changed: AtomicBool,
    source: Arc<ParsedGlyphsFont>,
    directory: FontDirectory,
    glyphs_by_name: HashMap<String, GlyphIndex>,
    master_locations: Vec<Vec<f64>>,
    axis_mappings: Vec<GlyphsAxisMapping>,
    interpolation_axes: Vec<InterpolationAxis>,
}

impl GlyphsFont {
    pub fn open(path: &Path) -> Result<Self, FontReadError> {
        let stamp = SourceStamp::read(path)?;
        let source = Arc::new(
            ParsedGlyphsFont::load(path)
                .map_err(|error| malformed(path, format!("failed to parse source: {error}")))?,
        );
        let default_master = source.masters.get(source.default_master_idx);
        let mut axes = Vec::with_capacity(source.axes.len());
        let mut axis_mappings = Vec::with_capacity(source.axes.len());
        let mut interpolation_axes = Vec::with_capacity(source.axes.len());
        for (index, axis) in source.axes.iter().enumerate() {
            let design_values = source
                .masters
                .iter()
                .filter_map(|master| master.axes_values.get(index))
                .map(|value| value.into_inner())
                .collect::<Vec<_>>();
            let design_default = default_master
                .and_then(|master| master.axes_values.get(index))
                .map(|value| value.into_inner())
                .or_else(|| design_values.first().copied())
                .unwrap_or(0.0);
            let design_minimum = design_values.iter().copied().fold(design_default, f64::min);
            let design_maximum = design_values.iter().copied().fold(design_default, f64::max);
            let mut mapping = source
                .axis_mappings
                .get(&axis.name)
                .map(|mapping| {
                    mapping
                        .iter()
                        .map(|(user, design)| (user.into_inner(), design.into_inner()))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_else(|| {
                    design_values
                        .iter()
                        .copied()
                        .map(|value| (value, value))
                        .collect()
                });
            if mapping.is_empty() {
                mapping.push((design_default, design_default));
            }
            mapping.sort_by(|left, right| left.0.total_cmp(&right.0));
            mapping.dedup_by(|left, right| left.0 == right.0);
            let mapping = GlyphsAxisMapping {
                user_to_design: mapping.into_boxed_slice(),
            };
            let user_default = mapping.unmap(design_default);
            let user_minimum = mapping.user_values().fold(user_default, f64::min);
            let user_maximum = mapping.user_values().fold(user_default, f64::max);
            axes.push(VariationAxis {
                index: AxisIndex::new(index as u32),
                tag: axis.tag.clone(),
                name: axis.name.clone(),
                hidden: axis.hidden.unwrap_or(false),
                kind: VariationAxisKind::Continuous {
                    minimum: user_minimum,
                    default: user_default,
                    maximum: user_maximum,
                },
            });
            axis_mappings.push(mapping);
            interpolation_axes.push(InterpolationAxis {
                tag: axis.tag.clone(),
                minimum: design_minimum,
                default: design_default,
                maximum: design_maximum,
            });
        }
        let glyphs = source
            .glyphs
            .values()
            .enumerate()
            .map(|(index, glyph)| DirectoryGlyph {
                index: GlyphIndex::new(index as u32),
                name: glyph.name.to_string(),
                unicodes: glyph
                    .unicode
                    .iter()
                    .copied()
                    .collect::<Vec<_>>()
                    .into_boxed_slice(),
            })
            .collect::<Vec<_>>();
        let directory = FontDirectory::new(
            FontFormat::Glyphs,
            source
                .get_default_name("familyNames")
                .map(ToString::to_string),
            default_master.map(|master| master.name.clone()),
            f64::from(source.units_per_em),
            glyphs,
            axes,
        )?;
        let glyphs_by_name = directory
            .glyphs
            .iter()
            .map(|glyph| (glyph.name.clone(), glyph.index))
            .collect();
        let master_locations = source
            .masters
            .iter()
            .map(|master| {
                (0..source.axes.len())
                    .map(|index| {
                        master
                            .axes_values
                            .get(index)
                            .map(|value| value.into_inner())
                            .unwrap_or(interpolation_axes[index].default)
                    })
                    .collect()
            })
            .collect();
        Ok(Self {
            path: path.to_path_buf(),
            stamp,
            changed: AtomicBool::new(false),
            source,
            directory,
            glyphs_by_name,
            master_locations,
            axis_mappings,
            interpolation_axes,
        })
    }

    fn verify_source(&self) -> Result<(), FontReadError> {
        if self.changed.load(Ordering::Acquire) || !self.stamp.matches(&self.path) {
            self.changed.store(true, Ordering::Release);
            return Err(FontReadError::SourceChanged {
                path: self.path.clone(),
            });
        }
        Ok(())
    }

    fn parsed_glyph(&self, glyph: GlyphIndex) -> Result<&ParsedGlyph, FontReadError> {
        let entry =
            self.directory
                .glyphs
                .get(glyph.to_usize())
                .ok_or(FontReadError::GlyphOutOfRange {
                    glyph,
                    glyph_count: self.directory.glyphs.len() as u32,
                })?;
        self.source.glyphs.get(entry.name.as_str()).ok_or_else(|| {
            FontReadError::InvalidDisplayGlyph {
                details: format!("Glyphs directory lost glyph {:?}", entry.name),
            }
        })
    }
}

impl RandomAccessFont for GlyphsFont {
    fn directory(&self) -> &FontDirectory {
        &self.directory
    }

    fn read_glyph(
        &self,
        glyph: GlyphIndex,
        location: &VariationLocation,
    ) -> Result<DisplayGlyph, FontReadError> {
        self.verify_source()?;
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
        let design_location = self
            .axis_mappings
            .iter()
            .zip(location.coordinates())
            .map(|(mapping, value)| mapping.map(*value))
            .collect::<Vec<_>>();
        let mut resolver = GlyphsResolver {
            font: self,
            location: &design_location,
            indices: HashMap::new(),
            states: Vec::new(),
            geometries: Vec::new(),
            root_metrics: None,
        };
        resolver.resolve_geometry(glyph)?;
        let metrics = resolver
            .root_metrics
            .ok_or_else(|| FontReadError::InvalidDisplayGlyph {
                details: "resolved Glyphs glyph has no metrics".into(),
            })?;
        build_display_glyph(glyph, location.clone(), resolver.geometries, metrics)
    }
}

impl FontImporter for GlyphsFont {
    fn begin_import(&self) -> BackendResult<FontImport> {
        self.verify_source().map_err(|error| {
            BackendError::load(
                FontFormat::Glyphs,
                self.path.clone(),
                crate::FormatBackendError::Glyphs(error.to_string()),
            )
        })?;
        let (header, stream) = crate::glyphs::stream_retained(self.source.clone())
            .map_err(|source| BackendError::load(FontFormat::Glyphs, self.path.clone(), source))?;
        Ok(FontImport::new(
            header,
            Box::new(stream),
            FontFormat::Glyphs,
            self.path.clone(),
        ))
    }
}

#[derive(Clone)]
struct ResolvedLayer {
    geometry: SourceGeometry,
    metrics: GlyphMetrics,
}

struct GlyphsResolver<'a> {
    font: &'a GlyphsFont,
    location: &'a [f64],
    indices: HashMap<GlyphIndex, usize>,
    states: Vec<u8>,
    geometries: Vec<SourceGeometry>,
    root_metrics: Option<GlyphMetrics>,
}

impl GlyphsResolver<'_> {
    fn resolve_geometry(&mut self, glyph: GlyphIndex) -> Result<usize, FontReadError> {
        if let Some(index) = self.indices.get(&glyph).copied() {
            return match self.states[index] {
                1 => Err(FontReadError::ComponentCycle { glyph }),
                2 => Ok(index),
                _ => Err(FontReadError::InvalidDisplayGlyph {
                    details: "Glyphs geometry has an invalid resolution state".into(),
                }),
            };
        }
        let parsed = self.font.parsed_glyph(glyph)?;
        let layer = resolve_glyphs_layer(self.font, parsed, glyph, self.location)?;
        let index = self.geometries.len();
        self.indices.insert(glyph, index);
        self.states.push(1);
        self.geometries.push(SourceGeometry {
            glyph,
            contours: Vec::new(),
            components: Vec::new(),
            anchors: Vec::new(),
            guides: Vec::new(),
        });
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

fn resolve_glyphs_layer(
    font: &GlyphsFont,
    glyph: &ParsedGlyph,
    glyph_index: GlyphIndex,
    location: &[f64],
) -> Result<ResolvedLayer, FontReadError> {
    if glyph.layers.iter().any(|layer| {
        layer.is_intermediate()
            || !layer.attributes.axis_rules.is_empty()
            || !layer.smart_component_positions.is_empty()
    }) {
        return Err(malformed(
            &font.path,
            format!(
                "glyph {:?} uses intermediate, bracket, or smart-component layers",
                glyph.name
            ),
        ));
    }
    let layers = font
        .source
        .masters
        .iter()
        .enumerate()
        .filter_map(|(master_index, master)| {
            glyph
                .layers
                .iter()
                .find(|layer| layer.master_id() == master.id)
                .map(|layer| (master_index, layer))
        })
        .collect::<Vec<_>>();
    if layers.is_empty() {
        return Ok(ResolvedLayer {
            geometry: SourceGeometry {
                glyph: glyph_index,
                contours: Vec::new(),
                components: Vec::new(),
                anchors: Vec::new(),
                guides: Vec::new(),
            },
            metrics: GlyphMetrics {
                x_advance: 0.0,
                y_advance: None,
            },
        });
    }

    if let Some((_, layer)) = layers
        .iter()
        .find(|(master, _)| font.master_locations[*master] == location)
    {
        return convert_glyphs_layer(font, glyph_index, layer);
    }
    let reference_position = layers
        .iter()
        .position(|(master, _)| *master == font.source.default_master_idx)
        .unwrap_or(0);
    let reference = convert_glyphs_layer(font, glyph_index, layers[reference_position].1)?;
    let mut compatible = Vec::new();
    for (master, layer) in layers {
        let converted = convert_glyphs_layer(font, glyph_index, layer)?;
        if layer_compatible(&reference, &converted) {
            compatible.push((master, converted));
        }
    }
    let source_locations = compatible
        .iter()
        .map(|(master, _)| font.master_locations[*master].clone())
        .collect::<Vec<_>>();
    let Some(weights) =
        interpolation_weights(&source_locations, &font.interpolation_axes, location)
    else {
        return Ok(reference);
    };
    interpolate_layers(&reference, &compatible, &weights)
}

fn convert_glyphs_layer(
    font: &GlyphsFont,
    glyph: GlyphIndex,
    layer: &Layer,
) -> Result<ResolvedLayer, FontReadError> {
    let mut contours = Vec::new();
    let mut components = Vec::new();
    for shape in &layer.shapes {
        match shape {
            Shape::Path(path) => contours.push(normalize_glyphs_contour(&path.nodes, path.closed)?),
            Shape::Component(component) => {
                if !component.smart_component_values.is_empty() {
                    return Err(malformed(
                        &font.path,
                        format!(
                            "smart component {:?} requires an instance-specific geometry location",
                            component.name
                        ),
                    ));
                }
                let base = font
                    .glyphs_by_name
                    .get(component.name.as_str())
                    .copied()
                    .ok_or_else(|| {
                        malformed(
                            &font.path,
                            format!("component base glyph {:?} does not exist", component.name),
                        )
                    })?;
                let coefficients = component.transform.as_coeffs();
                components.push(SourceComponent {
                    glyph: base,
                    transform: AffineTransform {
                        xx: coefficients[0],
                        xy: coefficients[1],
                        yx: coefficients[2],
                        yy: coefficients[3],
                        dx: coefficients[4],
                        dy: coefficients[5],
                    },
                });
            }
        }
    }
    Ok(ResolvedLayer {
        geometry: SourceGeometry {
            glyph,
            contours,
            components,
            anchors: layer
                .anchors
                .iter()
                .map(|anchor| GlyphAnchor {
                    name: (!anchor.name.is_empty()).then(|| anchor.name.to_string()),
                    x: anchor.pos.x,
                    y: anchor.pos.y,
                })
                .collect(),
            guides: Vec::new(),
        },
        metrics: GlyphMetrics {
            x_advance: layer.width.into_inner(),
            y_advance: layer.vert_width.map(|value| value.into_inner()),
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

fn piecewise_map(points: &[(f64, f64)], value: f64) -> f64 {
    match points {
        [] => value,
        [point] => point.1,
        _ => {
            let segment = if value <= points[0].0 {
                [points[0], points[1]]
            } else if value >= points[points.len() - 1].0 {
                [points[points.len() - 2], points[points.len() - 1]]
            } else {
                let upper = points.partition_point(|point| point.0 < value);
                [points[upper - 1], points[upper]]
            };
            if segment[0].0 == segment[1].0 {
                return segment[0].1;
            }
            segment[0].1
                + (segment[1].1 - segment[0].1) * (value - segment[0].0)
                    / (segment[1].0 - segment[0].0)
        }
    }
}

fn normalize_glyphs_contour(nodes: &[Node], closed: bool) -> Result<SourceContour, FontReadError> {
    let points = nodes
        .iter()
        .enumerate()
        .map(|(index, node)| {
            Ok(ContourPoint {
                x: node.pt.x,
                y: node.pt.y,
                kind: glyphs_point_kind(nodes, index, closed)?,
                smooth: matches!(
                    node.node_type,
                    NodeType::LineSmooth | NodeType::CurveSmooth | NodeType::QCurveSmooth
                ),
                provenance: PointProvenance::Native {
                    ttf_point_index: None,
                },
            })
        })
        .collect::<Result<Vec<_>, FontReadError>>()?;
    normalize_contour(points, closed)
}

fn glyphs_point_kind(
    nodes: &[Node],
    index: usize,
    closed: bool,
) -> Result<GlyphPointKind, FontReadError> {
    if nodes[index].node_type != NodeType::OffCurve {
        return Ok(GlyphPointKind::OnCurve);
    }
    let mut next = next_index(index, nodes.len(), closed);
    for _ in 0..nodes.len() {
        let Some(next_position) = next else {
            break;
        };
        match nodes[next_position].node_type {
            NodeType::OffCurve => next = next_index(next_position, nodes.len(), closed),
            NodeType::QCurve | NodeType::QCurveSmooth => {
                return Ok(GlyphPointKind::QuadraticControl)
            }
            NodeType::Curve | NodeType::CurveSmooth => return Ok(GlyphPointKind::CubicControl),
            NodeType::Line | NodeType::LineSmooth => {
                return Err(FontReadError::InvalidDisplayGlyph {
                    details: "off-curve Glyphs node is followed by a line endpoint".into(),
                })
            }
        }
    }
    if closed {
        return Ok(GlyphPointKind::QuadraticControl);
    }
    Err(FontReadError::InvalidDisplayGlyph {
        details: "open Glyphs path ends with an off-curve node".into(),
    })
}

fn next_index(index: usize, count: usize, closed: bool) -> Option<usize> {
    if index + 1 < count {
        Some(index + 1)
    } else if closed {
        Some(0)
    } else {
        None
    }
}

fn malformed(path: &Path, details: String) -> FontReadError {
    FontReadError::MalformedSource {
        format: FontFormat::Glyphs,
        path: path.to_path_buf(),
        details,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join("fixtures/fonts")
            .join(name)
    }

    #[test]
    fn glyphs_selected_glyph_resolves_without_shift_identity() {
        let font = GlyphsFont::open(&fixture("Homenaje.glyphs")).unwrap();
        let glyph = font
            .directory()
            .glyphs
            .iter()
            .find(|glyph| glyph.name == "Aacute")
            .expect("fixture should contain Aacute");
        let display = font
            .read_glyph(glyph.index, font.directory().default_location())
            .unwrap();

        assert_eq!(display.glyph, glyph.index);
        assert!(!display.geometries.is_empty());
        assert!(!display.components.is_empty());
    }

    #[test]
    fn glyphs_selected_glyph_changes_at_a_non_default_location() {
        let font = GlyphsFont::open(&fixture("MutatorSansVariable.glyphs")).unwrap();
        let glyph = font
            .directory()
            .glyphs
            .iter()
            .find(|glyph| glyph.name == "A")
            .expect("fixture should contain A");
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
            .location(&[crate::font_source::VariationCoordinate {
                axis: axis.index,
                value: maximum,
            }])
            .unwrap();
        let changed = font.read_glyph(glyph.index, &location).unwrap();

        assert_ne!(default.points, changed.points);
    }
}
