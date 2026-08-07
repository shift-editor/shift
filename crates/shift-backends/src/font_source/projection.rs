use std::collections::{hash_map::Entry, HashMap, HashSet};
use std::str::FromStr;

use fontdrasil::coords::{NormalizedCoord, NormalizedLocation};
use fontdrasil::types::Tag;
use fontdrasil::variations::{RoundingBehaviour, VariationModel};

use super::geometry::SourceGeometry;
use super::interpolation::InterpolationAxis;
use super::{
    DirectoryGlyph, FontDirectory, FontReadError, GlyphComponent, GlyphDelta, GlyphIndex,
    GlyphMetrics, GlyphProjection, GlyphShape, GlyphShapeContour, GlyphShapePoint,
    GlyphSourceShape, GlyphVariation, ProjectedGlyph, SourceIndex, VariationAxis, VariationRegion,
    VariationSupport,
};
use crate::FontFormat;

#[derive(Clone, Debug)]
pub(crate) struct ProjectionLayer {
    pub(crate) geometry: SourceGeometry,
    pub(crate) metrics: GlyphMetrics,
}

pub(crate) fn empty_projection_layer(glyph: GlyphIndex) -> ProjectionLayer {
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
    }
}

pub(crate) fn build_directory(
    format: FontFormat,
    family_name: Option<String>,
    style_name: Option<String>,
    units_per_em: f64,
    glyphs: Vec<(String, Box<[u32]>)>,
    axes: Vec<VariationAxis>,
) -> Result<(FontDirectory, HashMap<String, GlyphIndex>), FontReadError> {
    let glyphs = glyphs
        .into_iter()
        .enumerate()
        .map(|(index, (name, unicodes))| DirectoryGlyph {
            index: GlyphIndex::new(index as u32),
            name,
            unicodes,
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

pub(crate) fn resolve_projection_closure(
    directory: &FontDirectory,
    root: GlyphIndex,
    missing_root_details: &'static str,
    project: impl FnMut(GlyphIndex) -> Result<GlyphProjection, FontReadError>,
) -> Result<ProjectedGlyph, FontReadError> {
    if directory.glyphs.get(root.to_usize()).is_none() {
        return Err(FontReadError::GlyphOutOfRange {
            glyph: root,
            glyph_count: directory.glyphs.len() as u32,
        });
    }

    let mut resolver = ProjectionResolver {
        states: HashMap::new(),
        projections: HashMap::new(),
        project,
    };
    resolver.resolve(root)?;
    let root = resolver
        .projections
        .remove(&root)
        .ok_or_else(|| invalid(missing_root_details))?;
    let mut components = resolver.projections.into_values().collect::<Vec<_>>();
    components.sort_by_key(|projection| projection.glyph);
    Ok(ProjectedGlyph {
        root,
        components: components.into_boxed_slice(),
    })
}

struct ProjectionResolver<F> {
    states: HashMap<GlyphIndex, u8>,
    projections: HashMap<GlyphIndex, GlyphProjection>,
    project: F,
}

impl<F> ProjectionResolver<F>
where
    F: FnMut(GlyphIndex) -> Result<GlyphProjection, FontReadError>,
{
    fn resolve(&mut self, glyph: GlyphIndex) -> Result<(), FontReadError> {
        match self.states.get(&glyph).copied() {
            Some(1) => return Err(FontReadError::ComponentCycle { glyph }),
            Some(2) => return Ok(()),
            _ => {}
        }
        self.states.insert(glyph, 1);
        let projection = (self.project)(glyph)?;
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

pub(crate) fn project_layers(
    layers: Vec<(SourceIndex, Vec<f64>, ProjectionLayer)>,
    axes: &[InterpolationAxis],
    default_source: SourceIndex,
) -> Result<GlyphProjection, FontReadError> {
    let Some((_, _, first)) = layers.first() else {
        return Err(invalid("glyph projection has no source layers"));
    };
    let glyph = first.geometry.glyph;
    if layers
        .iter()
        .any(|(_, _, layer)| layer.geometry.glyph != glyph)
    {
        return Err(invalid(
            "glyph projection source layers disagree on glyph identity",
        ));
    }

    let reference_index = layers
        .iter()
        .position(|(source, _, _)| *source == default_source)
        .unwrap_or(0);
    let reference = layers[reference_index].2.clone();
    let mut compatible = Vec::new();
    let mut exact_shapes = Vec::new();
    for (source, location, layer) in layers {
        if layer_compatible(&reference, &layer) {
            compatible.push((source, location, layer));
        } else {
            exact_shapes.push(GlyphSourceShape {
                source,
                shape: shape_from_layer(&layer),
            });
        }
    }

    let reference_shape = shape_from_layer(&reference);
    let (fallback, variation) = variation_from_layers(&reference_shape, &compatible, axes)
        .unwrap_or((reference_shape, None));
    let projection = GlyphProjection {
        glyph,
        fallback,
        variation,
        exact_shapes: exact_shapes.into_boxed_slice(),
    };
    projection.validate(axes.len(), source_count(&projection, default_source))?;
    Ok(projection)
}

fn source_count(projection: &GlyphProjection, default_source: SourceIndex) -> usize {
    projection
        .exact_shapes
        .iter()
        .map(|shape| shape.source.to_usize() + 1)
        .chain(std::iter::once(default_source.to_usize() + 1))
        .max()
        .unwrap_or(1)
}

fn variation_from_layers(
    reference: &GlyphShape,
    layers: &[(SourceIndex, Vec<f64>, ProjectionLayer)],
    axes: &[InterpolationAxis],
) -> Option<(GlyphShape, Option<GlyphVariation>)> {
    if layers.is_empty() {
        return None;
    }
    if layers.len() == 1 || axes.is_empty() {
        return Some((
            shape_with_values(reference, values_from_layer(&layers[0].2)),
            None,
        ));
    }
    if layers
        .iter()
        .any(|(_, location, _)| location.len() != axes.len())
    {
        return None;
    }

    let tags = axes
        .iter()
        .map(|axis| Tag::from_str(&axis.tag).ok())
        .collect::<Option<Vec<_>>>()?;
    let mut samples = HashMap::new();
    let normalized_sources = layers
        .iter()
        .map(|(_, location, _)| normalized_location(location, axes, &tags))
        .collect::<Vec<_>>();
    for ((_, _, layer), location) in layers.iter().zip(&normalized_sources) {
        if samples
            .insert(location.clone(), values_from_layer(layer))
            .is_some()
        {
            return None;
        }
    }

    let defaults = axes.iter().map(|axis| axis.default).collect::<Vec<_>>();
    let default_location = normalized_location(&defaults, axes, &tags);
    if let Entry::Vacant(entry) = samples.entry(default_location) {
        let coefficients = virtual_default_coefficients(&normalized_sources)?;
        let value_count = reference.values.len();
        let mut values = vec![0.0; value_count];
        for ((_, _, layer), coefficient) in layers.iter().zip(coefficients) {
            for (value, source) in values.iter_mut().zip(values_from_layer(layer)) {
                *value += coefficient * source;
            }
        }
        entry.insert(values);
    }

    let model = VariationModel::new(
        samples.keys().cloned().collect::<HashSet<_>>(),
        tags.clone(),
    );
    let mut model_deltas = model
        .deltas_with_rounding::<f64, f64>(&samples, RoundingBehaviour::None)
        .ok()?;
    let base_index = model_deltas
        .iter()
        .position(|(region, _)| region.is_default())?;
    let (_, base_values) = model_deltas.remove(base_index);
    let fallback = shape_with_values(reference, base_values);
    let deltas = model_deltas
        .into_iter()
        .filter(|(_, values)| values.iter().any(|value| *value != 0.0))
        .map(|(region, values)| {
            let supports = region
                .iter()
                .filter_map(|(tag, support)| {
                    let axis = tags.iter().position(|candidate| candidate == tag)?;
                    Some(VariationSupport {
                        axis: super::AxisIndex::new(axis as u32),
                        lower: support.min.into_inner().into_inner(),
                        peak: support.peak.into_inner().into_inner(),
                        upper: support.max.into_inner().into_inner(),
                    })
                })
                .collect::<Vec<_>>();
            GlyphDelta {
                region: VariationRegion {
                    supports: supports.into_boxed_slice(),
                },
                values: values.into_boxed_slice(),
            }
        })
        .collect::<Vec<_>>();
    let variation = (!deltas.is_empty()).then_some(GlyphVariation {
        deltas: deltas.into_boxed_slice(),
    });
    Some((fallback, variation))
}

pub(crate) fn shape_from_layer(layer: &ProjectionLayer) -> GlyphShape {
    let mut values = Vec::new();
    values.push(layer.metrics.x_advance);
    for contour in &layer.geometry.contours {
        for point in &contour.points {
            values.push(point.x);
            values.push(point.y);
        }
    }
    for anchor in &layer.geometry.anchors {
        values.push(anchor.x);
        values.push(anchor.y);
    }
    for component in &layer.geometry.components {
        values.extend([
            component.transform.xx,
            component.transform.xy,
            component.transform.yx,
            component.transform.yy,
            component.transform.dx,
            component.transform.dy,
        ]);
    }
    GlyphShape {
        contours: layer
            .geometry
            .contours
            .iter()
            .map(|contour| GlyphShapeContour {
                points: contour
                    .points
                    .iter()
                    .map(|point| GlyphShapePoint {
                        kind: point.kind,
                        smooth: point.smooth,
                        provenance: point.provenance,
                    })
                    .collect::<Vec<_>>()
                    .into_boxed_slice(),
                closed: contour.closed,
            })
            .collect::<Vec<_>>()
            .into_boxed_slice(),
        anchors: layer
            .geometry
            .anchors
            .iter()
            .map(|anchor| anchor.name.clone())
            .collect::<Vec<_>>()
            .into_boxed_slice(),
        components: layer
            .geometry
            .components
            .iter()
            .map(|component| GlyphComponent {
                glyph: component.glyph,
            })
            .collect::<Vec<_>>()
            .into_boxed_slice(),
        values: values.into_boxed_slice(),
    }
}

fn values_from_layer(layer: &ProjectionLayer) -> Vec<f64> {
    shape_from_layer(layer).values.into_vec()
}

fn shape_with_values(reference: &GlyphShape, values: Vec<f64>) -> GlyphShape {
    GlyphShape {
        contours: reference.contours.clone(),
        anchors: reference.anchors.clone(),
        components: reference.components.clone(),
        values: values.into_boxed_slice(),
    }
}

fn layer_compatible(reference: &ProjectionLayer, candidate: &ProjectionLayer) -> bool {
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

fn normalized_location(
    location: &[f64],
    axes: &[InterpolationAxis],
    tags: &[Tag],
) -> NormalizedLocation {
    axes.iter()
        .zip(location)
        .zip(tags)
        .map(|((axis, value), tag)| (*tag, NormalizedCoord::new(normalize(axis, *value))))
        .collect()
}

fn normalize(axis: &InterpolationAxis, value: f64) -> f64 {
    if value == axis.default {
        return 0.0;
    }
    if value < axis.default {
        let range = axis.default - axis.minimum;
        return if range == 0.0 {
            0.0
        } else {
            ((value - axis.default) / range).max(-1.0)
        };
    }
    let range = axis.maximum - axis.default;
    if range == 0.0 {
        0.0
    } else {
        ((value - axis.default) / range).min(1.0)
    }
}

fn virtual_default_coefficients(sources: &[NormalizedLocation]) -> Option<Vec<f64>> {
    let mut negative: Option<(usize, Tag, f64)> = None;
    let mut positive: Option<(usize, Tag, f64)> = None;
    for (index, location) in sources.iter().enumerate() {
        let nonzero = location
            .iter()
            .filter_map(|(tag, coordinate)| {
                let value = coordinate.to_f64();
                (value != 0.0).then_some((*tag, value))
            })
            .collect::<Vec<_>>();
        let [(tag, value)] = nonzero.as_slice() else {
            continue;
        };
        if *value < 0.0
            && negative
                .as_ref()
                .is_none_or(|(_, _, current)| *value > *current)
        {
            negative = Some((index, *tag, *value));
        }
        if *value > 0.0
            && positive
                .as_ref()
                .is_none_or(|(_, _, current)| *value < *current)
        {
            positive = Some((index, *tag, *value));
        }
    }
    let (negative_index, negative_axis, negative_value) = negative?;
    let (positive_index, positive_axis, positive_value) = positive?;
    if negative_axis != positive_axis {
        return None;
    }
    let span = positive_value - negative_value;
    let mut coefficients = vec![0.0; sources.len()];
    coefficients[negative_index] = positive_value / span;
    coefficients[positive_index] = -negative_value / span;
    Some(coefficients)
}

fn invalid(details: &str) -> FontReadError {
    FontReadError::InvalidProjection {
        details: details.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::font_source::geometry::{SourceContour, SourceGeometry};
    use crate::font_source::{
        GlyphIndex, GlyphPoint, GlyphPointKind, PointProvenance, SourceIndex,
    };

    #[test]
    fn incompatible_topology_is_retained_as_an_exact_source_shape() {
        let glyph = GlyphIndex::new(0);
        let projection = project_layers(
            vec![
                (
                    SourceIndex::new(0),
                    vec![0.0],
                    layer(glyph, vec![contour()], 500.0),
                ),
                (
                    SourceIndex::new(1),
                    vec![1.0],
                    layer(glyph, Vec::new(), 600.0),
                ),
            ],
            &[axis()],
            SourceIndex::new(0),
        )
        .unwrap();

        assert_eq!(projection.fallback.contours.len(), 1);
        assert_eq!(projection.exact_shapes.len(), 1);
        assert_eq!(projection.exact_shapes[0].source, SourceIndex::new(1));
        assert!(projection.exact_shapes[0].shape.contours.is_empty());
        assert_eq!(projection.exact_shapes[0].shape.values.as_ref(), &[600.0]);
    }

    #[test]
    fn inconsistent_glyph_identity_fails_without_a_projection() {
        let result = project_layers(
            vec![
                (
                    SourceIndex::new(0),
                    vec![0.0],
                    layer(GlyphIndex::new(0), vec![contour()], 500.0),
                ),
                (
                    SourceIndex::new(1),
                    vec![1.0],
                    layer(GlyphIndex::new(1), vec![contour()], 600.0),
                ),
            ],
            &[axis()],
            SourceIndex::new(0),
        );

        assert!(result.is_err());
    }

    fn axis() -> InterpolationAxis {
        InterpolationAxis {
            tag: "wght".into(),
            minimum: 0.0,
            default: 0.0,
            maximum: 1.0,
        }
    }

    fn layer(glyph: GlyphIndex, contours: Vec<SourceContour>, advance: f64) -> ProjectionLayer {
        ProjectionLayer {
            geometry: SourceGeometry {
                glyph,
                contours,
                components: Vec::new(),
                anchors: Vec::new(),
            },
            metrics: GlyphMetrics {
                x_advance: advance,
                y_advance: None,
            },
        }
    }

    fn contour() -> SourceContour {
        SourceContour {
            points: vec![GlyphPoint {
                x: 0.0,
                y: 0.0,
                kind: GlyphPointKind::OnCurve,
                smooth: false,
                provenance: PointProvenance::Native {
                    ttf_point_index: None,
                },
            }],
            closed: true,
        }
    }
}
