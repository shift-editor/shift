use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use glyphs_reader::{Font as ParsedGlyphsFont, Glyph as ParsedGlyph, Layer, Node, NodeType, Shape};

use crate::font_source::geometry::{
    normalize_contour, ContourPoint, SourceComponent, SourceContour, SourceGeometry,
};
use crate::font_source::interpolation::InterpolationAxis;
use crate::font_source::projection::{project_layers, ProjectionLayer};
use crate::font_source::{
    AffineTransform, AxisIndex, DirectoryAxisMapping, DirectoryGlyph, DirectoryInstance,
    DirectorySource, FontDirectory, FontImporter, FontReadError, FontSource, GlyphAnchor,
    GlyphIndex, GlyphMetrics, GlyphPointKind, PointProvenance, ProjectedGlyph, SourceIndex,
    VariationAxis, VariationAxisKind,
};
use crate::{BackendError, BackendResult, FontFormat, FontImport};

#[derive(Clone)]
struct GlyphsAxisMapping {
    user_to_design: Box<[(f64, f64)]>,
}

impl GlyphsAxisMapping {
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
    source: Arc<ParsedGlyphsFont>,
    directory: FontDirectory,
    glyphs_by_name: HashMap<String, GlyphIndex>,
    master_locations: Vec<Vec<f64>>,
    interpolation_axes: Vec<InterpolationAxis>,
}

impl GlyphsFont {
    pub fn open(path: &Path) -> Result<Self, FontReadError> {
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
        let mut directory = FontDirectory::new(
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
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>();
        directory.set_sources(
            source
                .masters
                .iter()
                .zip(&master_locations)
                .enumerate()
                .map(|(index, (master, location))| DirectorySource {
                    index: SourceIndex::new(index as u32),
                    name: master.name.clone(),
                    location: location.clone().into_boxed_slice(),
                    filename: None,
                })
                .collect(),
            SourceIndex::new(source.default_master_idx as u32),
        )?;
        directory.set_axis_mappings(
            axis_mappings
                .iter()
                .enumerate()
                .map(|(index, mapping)| DirectoryAxisMapping {
                    axis: AxisIndex::new(index as u32),
                    points: mapping.user_to_design.clone(),
                })
                .collect(),
        );
        directory.set_instances(
            source
                .instances
                .iter()
                .filter(|instance| instance.active)
                .map(|instance| DirectoryInstance {
                    name: instance.name.clone(),
                    location: (0..source.axes.len())
                        .map(|index| {
                            instance
                                .axes_values
                                .get(index)
                                .map(|value| value.into_inner())
                                .unwrap_or_else(|| directory.axes[index].kind.default_value())
                        })
                        .collect::<Vec<_>>()
                        .into_boxed_slice(),
                    postscript_name: None,
                })
                .collect(),
        );
        Ok(Self {
            path: path.to_path_buf(),
            source,
            directory,
            glyphs_by_name,
            master_locations,
            interpolation_axes,
        })
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
            FontReadError::InvalidProjection {
                details: format!("Glyphs directory lost glyph {:?}", entry.name),
            }
        })
    }
}

impl FontSource for GlyphsFont {
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
        let mut resolver = GlyphsProjectionResolver {
            font: self,
            states: HashMap::new(),
            projections: HashMap::new(),
        };
        resolver.resolve(glyph)?;
        let root = resolver.projections.remove(&glyph).ok_or_else(|| {
            FontReadError::InvalidProjection {
                details: "Glyphs projection root is unavailable".into(),
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

struct GlyphsProjectionResolver<'a> {
    font: &'a GlyphsFont,
    states: HashMap<GlyphIndex, u8>,
    projections: HashMap<GlyphIndex, crate::font_source::GlyphProjection>,
}

impl GlyphsProjectionResolver<'_> {
    fn resolve(&mut self, glyph: GlyphIndex) -> Result<(), FontReadError> {
        match self.states.get(&glyph).copied() {
            Some(1) => return Err(FontReadError::ComponentCycle { glyph }),
            Some(2) => return Ok(()),
            _ => {}
        }
        self.states.insert(glyph, 1);
        let projection = project_glyphs_glyph(self.font, glyph)?;
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
            .collect::<std::collections::HashSet<_>>();
        for dependency in dependencies {
            self.resolve(dependency)?;
        }
        self.projections.insert(glyph, projection);
        self.states.insert(glyph, 2);
        Ok(())
    }
}

fn project_glyphs_glyph(
    font: &GlyphsFont,
    glyph: GlyphIndex,
) -> Result<crate::font_source::GlyphProjection, FontReadError> {
    let parsed = font.parsed_glyph(glyph)?;
    if parsed.layers.iter().any(|layer| {
        layer.is_intermediate()
            || !layer.attributes.axis_rules.is_empty()
            || !layer.smart_component_positions.is_empty()
    }) {
        return Err(malformed(
            &font.path,
            format!(
                "glyph {:?} uses intermediate, bracket, or smart-component layers",
                parsed.name
            ),
        ));
    }
    let mut layers = Vec::new();
    for (master_index, master) in font.source.masters.iter().enumerate() {
        let Some(layer) = parsed
            .layers
            .iter()
            .find(|layer| layer.master_id() == master.id)
        else {
            continue;
        };
        let converted = convert_glyphs_layer(font, glyph, layer)?;
        layers.push((
            SourceIndex::new(master_index as u32),
            font.master_locations[master_index].clone(),
            ProjectionLayer {
                geometry: converted.geometry,
                metrics: converted.metrics,
            },
        ));
    }
    if layers.is_empty() {
        layers.push((
            SourceIndex::new(font.source.default_master_idx as u32),
            font.master_locations
                .get(font.source.default_master_idx)
                .cloned()
                .unwrap_or_else(|| vec![0.0; font.interpolation_axes.len()]),
            ProjectionLayer {
                geometry: SourceGeometry {
                    glyph,
                    contours: Vec::new(),
                    components: Vec::new(),
                    anchors: Vec::new(),
                },
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
        SourceIndex::new(font.source.default_master_idx as u32),
    )
}

impl FontImporter for GlyphsFont {
    fn begin_import(&self) -> BackendResult<FontImport> {
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
        },
        metrics: GlyphMetrics {
            x_advance: layer.width.into_inner(),
            y_advance: layer.vert_width.map(|value| value.into_inner()),
        },
    })
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
                return Err(FontReadError::InvalidProjection {
                    details: "off-curve Glyphs node is followed by a line endpoint".into(),
                })
            }
        }
    }
    if closed {
        return Ok(GlyphPointKind::QuadraticControl);
    }
    Err(FontReadError::InvalidProjection {
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
    use std::fs;

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
    fn glyphs_projection_resolves_component_closure_without_shift_identity() {
        let font = GlyphsFont::open(&fixture("Homenaje.glyphs")).unwrap();
        let glyph = font
            .directory()
            .glyphs
            .iter()
            .find(|glyph| glyph.name == "Aacute")
            .expect("fixture should contain Aacute");
        let projected = font.glyph(glyph.index).unwrap();

        assert_eq!(projected.root.glyph, glyph.index);
        assert!(!projected.root.fallback.components.is_empty());
        assert!(!projected.components.is_empty());
    }

    #[test]
    fn glyphs_projection_uses_retained_source_after_removal() {
        let temporary = tempfile::tempdir().unwrap();
        let copied = temporary.path().join("Removed.glyphs");
        fs::copy(fixture("Homenaje.glyphs"), &copied).unwrap();
        let font = GlyphsFont::open(&copied).unwrap();
        let glyph = font.directory().glyphs[0].index;
        let expected = font.glyph(glyph).unwrap();
        fs::remove_file(copied).unwrap();

        assert_eq!(font.glyph(glyph).unwrap(), expected);
    }

    #[test]
    fn glyphs_projection_retains_non_default_variation() {
        let font = GlyphsFont::open(&fixture("MutatorSansVariable.glyphs")).unwrap();
        let glyph = font
            .directory()
            .glyphs
            .iter()
            .find(|glyph| glyph.name == "A")
            .expect("fixture should contain A");
        let projection = font.glyph(glyph.index).unwrap().root;
        let variation = projection
            .variation
            .expect("variable Glyphs source should retain deltas");

        assert!(variation
            .deltas
            .iter()
            .flat_map(|delta| delta.values.iter())
            .any(|value| *value != 0.0));
    }
}
