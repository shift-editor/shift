use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use glyphs_reader::{Font as ParsedGlyphsFont, Glyph as ParsedGlyph, Layer, Node, NodeType, Shape};

use super::{
    anchor_parts, component_transform, default_design_value, font_header, master_design_values,
    master_location_values, missing_component_details,
};
use crate::font_source::geometry::{
    control_point_kind, normalize_contour, ContourPoint, SourceComponent, SourceContour,
    SourceGeometry,
};
use crate::font_source::interpolation::InterpolationAxis;
use crate::font_source::projection::{
    empty_projection_layer, project_layers, resolve_projection_closure, ProjectionLayer,
};
use crate::font_source::{
    malformed, AffineTransform, FontDirectory, FontImporter, FontReadError, FontSource,
    GlyphAnchor, GlyphIndex, GlyphMetrics, GlyphPointKind, PointProvenance, ProjectedGlyph,
    SourceIndex,
};
use crate::{BackendError, BackendResult, FontFormat, FontImport};

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
        let interpolation_axes = source
            .axes
            .iter()
            .enumerate()
            .map(|(index, axis)| {
                let design_values = master_design_values(&source, index);
                let design_default = default_design_value(&source, index, &design_values);
                InterpolationAxis {
                    tag: axis.tag.clone(),
                    minimum: design_values.iter().copied().fold(design_default, f64::min),
                    default: design_default,
                    maximum: design_values.iter().copied().fold(design_default, f64::max),
                }
            })
            .collect::<Vec<_>>();
        let glyphs = source
            .glyphs
            .values()
            .map(|glyph| {
                (
                    glyph.name.to_string(),
                    glyph
                        .unicode
                        .iter()
                        .copied()
                        .collect::<Vec<_>>()
                        .into_boxed_slice(),
                )
            })
            .collect::<Vec<_>>();
        let (header, _) =
            font_header(&source).map_err(|error| malformed(path, error.to_string()))?;
        let (directory, glyphs_by_name) =
            FontDirectory::from_font(FontFormat::Glyphs, &header, glyphs)?;
        let master_locations = source
            .masters
            .iter()
            .map(|master| {
                master_location_values(master, source.axes.len())
                    .into_iter()
                    .enumerate()
                    .map(|(index, value)| value.unwrap_or(interpolation_axes[index].default))
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>();
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
        resolve_projection_closure(
            &self.directory,
            glyph,
            "Glyphs projection root is unavailable",
            |glyph| project_glyphs_glyph(self, glyph),
        )
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
            converted,
        ));
    }
    if layers.is_empty() {
        layers.push((
            SourceIndex::new(font.source.default_master_idx as u32),
            font.master_locations
                .get(font.source.default_master_idx)
                .cloned()
                .unwrap_or_else(|| vec![0.0; font.interpolation_axes.len()]),
            empty_projection_layer(glyph),
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
        let (header, stream) = super::stream_retained(self.source.clone())
            .map_err(|source| BackendError::load(FontFormat::Glyphs, self.path.clone(), source))?;
        Ok(FontImport::new(
            header,
            Box::new(stream),
            FontFormat::Glyphs,
            self.path.clone(),
        ))
    }
}

fn convert_glyphs_layer(
    font: &GlyphsFont,
    glyph: GlyphIndex,
    layer: &Layer,
) -> Result<ProjectionLayer, FontReadError> {
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
                            missing_component_details(component.name.as_str()),
                        )
                    })?;
                let coefficients = component_transform(component);
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
    Ok(ProjectionLayer {
        geometry: SourceGeometry {
            glyph,
            contours,
            components,
            anchors: layer
                .anchors
                .iter()
                .map(|anchor| {
                    let (name, x, y) = anchor_parts(anchor);
                    GlyphAnchor { name, x, y }
                })
                .collect(),
        },
        metrics: GlyphMetrics {
            x_advance: layer.width.into_inner(),
            y_advance: layer.vert_width.map(|value| value.into_inner()),
        },
    })
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
    control_point_kind(
        nodes,
        index,
        closed,
        |node| match node.node_type {
            NodeType::OffCurve => Ok(None),
            NodeType::QCurve | NodeType::QCurveSmooth => Ok(Some(GlyphPointKind::QuadraticControl)),
            NodeType::Curve | NodeType::CurveSmooth => Ok(Some(GlyphPointKind::CubicControl)),
            NodeType::Line | NodeType::LineSmooth => Err(FontReadError::InvalidProjection {
                details: "off-curve Glyphs node is followed by a line endpoint".into(),
            }),
        },
        "open Glyphs path ends with an off-curve node",
    )
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
    fn directory_sources_keep_retained_master_order() {
        let font = GlyphsFont::open(&fixture("MutatorSansVariable.glyphs")).unwrap();
        let expected_names = font
            .source
            .masters
            .iter()
            .map(|master| master.name.as_str())
            .collect::<Vec<_>>();
        let directory_names = font
            .directory
            .sources
            .iter()
            .map(|source| source.name.as_str())
            .collect::<Vec<_>>();

        assert_eq!(directory_names, expected_names);
        for (index, (source, location)) in font
            .directory
            .sources
            .iter()
            .zip(&font.master_locations)
            .enumerate()
        {
            assert_eq!(source.index, SourceIndex::new(index as u32));
            assert_eq!(source.location.as_ref(), location);
        }
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
