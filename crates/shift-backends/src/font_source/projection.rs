use std::collections::{hash_map::Entry, HashMap, HashSet};
use std::str::FromStr;

use fontdrasil::coords::{NormalizedCoord, NormalizedLocation};
use fontdrasil::types::Tag;
use fontdrasil::variations::{RoundingBehaviour, VariationModel};
use shift_font::{AxisId, AxisKind, Font, Location, MetricKind, Source as FontSource, SourceRole};

use super::geometry::SourceGeometry;
use super::interpolation::InterpolationAxis;
use super::{
    AxisIndex, DirectoryGlyph, DirectoryGlyphInput, DirectoryInstance, DirectoryMapping,
    DirectoryMappingPoint, DirectorySource, FontDirectory, FontMetrics, FontReadError,
    GlyphComponent, GlyphDelta, GlyphIndex, GlyphMetrics, GlyphProjection, GlyphShape,
    GlyphShapeContour, GlyphShapePoint, GlyphSourceShape, GlyphVariation, ProjectedGlyph,
    SourceIndex, VariationAxis, VariationAxisKind, VariationRegion, VariationSupport,
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

impl FontDirectory {
    pub(crate) fn from_font(
        format: FontFormat,
        font: &Font,
        glyphs: Vec<DirectoryGlyphInput>,
    ) -> Result<(Self, HashMap<String, GlyphIndex>), FontReadError> {
        let glyphs = glyphs
            .into_iter()
            .enumerate()
            .map(|(index, (name, unicodes))| DirectoryGlyph {
                index: GlyphIndex::new(index as u32),
                name,
                unicodes,
            })
            .collect();
        let axes = font
            .axes()
            .iter()
            .enumerate()
            .map(|(index, axis)| VariationAxis {
                index: AxisIndex::new(index as u32),
                tag: axis.tag().to_string(),
                name: axis.name().to_string(),
                hidden: axis.is_hidden(),
                kind: match axis.kind() {
                    AxisKind::Continuous {
                        minimum,
                        default,
                        maximum,
                    } => VariationAxisKind::Continuous {
                        minimum: *minimum,
                        default: *default,
                        maximum: *maximum,
                    },
                    AxisKind::Discrete { values, default } => VariationAxisKind::Discrete {
                        values: values.clone().into_boxed_slice(),
                        default: *default,
                    },
                },
            })
            .collect::<Vec<_>>();
        let mut directory = FontDirectory::new(
            format,
            font.metadata().family_name.clone(),
            font.metadata().style_name.clone(),
            font.metrics().units_per_em,
            glyphs,
            axes,
        )?;
        let font_sources = font
            .sources()
            .iter()
            .filter(|source| source.role() == SourceRole::Master)
            .collect::<Vec<_>>();
        let default_source_id = font.default_source_id();
        let default_source = font_sources
            .iter()
            .position(|source| Some(source.id()) == default_source_id)
            .unwrap_or(0);
        directory.set_sources(
            font_sources
                .iter()
                .enumerate()
                .map(|(index, source)| DirectorySource {
                    index: SourceIndex::new(index as u32),
                    name: source.name().to_string(),
                    location: font
                        .axes()
                        .iter()
                        .map(|axis| source.location().get(&axis.id()).unwrap_or(axis.default()))
                        .collect::<Vec<_>>()
                        .into_boxed_slice(),
                    filename: source.filename().map(str::to_string),
                    metrics: directory_metrics(font, source),
                })
                .collect(),
            SourceIndex::new(default_source as u32),
        )?;
        directory.set_mappings(directory_mappings(font)?);
        directory.set_instances(
            font.named_instances()
                .iter()
                .map(|instance| DirectoryInstance {
                    name: instance.name().to_string(),
                    location: font
                        .axes()
                        .iter()
                        .map(|axis| {
                            instance
                                .location()
                                .get(&axis.id())
                                .unwrap_or(axis.default())
                        })
                        .collect::<Vec<_>>()
                        .into_boxed_slice(),
                    postscript_name: instance.postscript_name().map(str::to_string),
                })
                .collect(),
        );
        let glyphs_by_name = directory
            .glyphs
            .iter()
            .map(|glyph| (glyph.name.clone(), glyph.index))
            .collect();
        Ok((directory, glyphs_by_name))
    }
}

fn directory_mappings(font: &Font) -> Result<Vec<DirectoryMapping>, FontReadError> {
    let axis_indices = font
        .axes()
        .iter()
        .enumerate()
        .map(|(index, axis)| (axis.id(), AxisIndex::new(index as u32)))
        .collect::<HashMap<_, _>>();
    let axis_index = |axis_id: &AxisId| {
        axis_indices
            .get(axis_id)
            .copied()
            .ok_or_else(|| invalid(&format!("mapping references unknown axis {axis_id}")))
    };
    let coordinate = |location: &Location, axis_id: &AxisId| {
        font.axis(axis_id.clone())
            .map(|axis| location.get(axis_id).unwrap_or(axis.default()))
            .ok_or_else(|| invalid(&format!("mapping references unknown axis {axis_id}")))
    };

    font.axis_mappings()
        .iter()
        .map(|mapping| {
            let points = mapping
                .points()
                .iter()
                .map(|point| {
                    let input = mapping
                        .inputs()
                        .iter()
                        .map(|axis_id| coordinate(&point.input, axis_id))
                        .collect::<Result<Vec<_>, _>>()?;
                    let output = mapping
                        .outputs()
                        .iter()
                        .map(|axis_id| {
                            point
                                .output
                                .get(axis_id)
                                .map(Ok)
                                .unwrap_or_else(|| coordinate(&point.input, axis_id))
                        })
                        .collect::<Result<Vec<_>, _>>()?;
                    Ok(DirectoryMappingPoint {
                        description: point.description.clone(),
                        input: input.into_boxed_slice(),
                        output: output.into_boxed_slice(),
                    })
                })
                .collect::<Result<Vec<_>, FontReadError>>()?;

            Ok(DirectoryMapping {
                name: mapping.name().to_string(),
                description: mapping.description().map(str::to_string),
                input_axes: mapping
                    .inputs()
                    .iter()
                    .map(axis_index)
                    .collect::<Result<Vec<_>, _>>()?
                    .into_boxed_slice(),
                output_axes: mapping
                    .outputs()
                    .iter()
                    .map(axis_index)
                    .collect::<Result<Vec<_>, _>>()?
                    .into_boxed_slice(),
                points: points.into_boxed_slice(),
            })
        })
        .collect()
}

fn directory_metrics(font: &Font, source: &FontSource) -> FontMetrics {
    let metric = |kind| {
        font.metric_definitions()
            .iter()
            .find(|definition| definition.kind() == kind)
            .and_then(|definition| source.metric_value(&definition.id()))
            .map(|value| value.position)
    };
    let units_per_em = font.metrics().units_per_em;
    FontMetrics {
        units_per_em,
        ascender: metric(MetricKind::Ascender).unwrap_or(units_per_em * 0.8),
        descender: metric(MetricKind::Descender).unwrap_or(units_per_em * -0.2),
        line_gap: source.line_gap().unwrap_or(0.0),
        cap_height: metric(MetricKind::CapHeight),
        x_height: metric(MetricKind::XHeight),
        italic_angle: source.italic_angle(),
        underline_position: source.underline_position(),
        underline_thickness: source.underline_thickness(),
    }
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
        GlyphIndex, GlyphPoint, GlyphPointKind, PointProvenance, SourceIndex, VariationLocation,
    };
    use shift_font::{
        Axis, AxisId, AxisMapping, AxisMappingPoint, DesignLocation, ExternalLocation, Location,
        MetricKind, MetricValue, NamedInstance, Source,
    };

    #[test]
    fn canonical_directory_preserves_the_complete_font_header() {
        let mut font = Font::empty();
        font.metadata_mut().family_name = Some("Dogfood Sans".to_string());
        font.metadata_mut().style_name = Some("Regular".to_string());
        font.metrics_mut().units_per_em = 2048.0;

        let mut weight = Axis::weight();
        weight.set_hidden(true);
        let weight_id = weight.id();
        font.add_axis(weight).unwrap();
        let italic = Axis::discrete_with_id(
            AxisId::new(),
            "ital".to_string(),
            "Italic".to_string(),
            vec![0.0, 1.0],
            0.0,
        );
        let italic_id = italic.id();
        font.add_axis(italic).unwrap();

        let mut regular_location = DesignLocation::new();
        regular_location.set(weight_id.clone(), 400.0);
        regular_location.set(italic_id.clone(), 0.0);
        let mut regular = Source::with_filename(
            "Regular".to_string(),
            regular_location,
            "Regular.ufo".to_string(),
        );
        set_metrics(&font, &mut regular, [1500.0, -500.0, 1400.0, 1000.0]);
        regular.set_line_gap(Some(40.0));
        regular.set_italic_angle(Some(-2.0));
        regular.set_underline_position(Some(-120.0));
        regular.set_underline_thickness(Some(60.0));
        let regular_id = font.add_source(regular);

        let mut bold_location = DesignLocation::new();
        bold_location.set(weight_id.clone(), 800.0);
        bold_location.set(italic_id.clone(), 1.0);
        let mut bold =
            Source::with_filename("Bold".to_string(), bold_location, "Bold.ufo".to_string());
        set_metrics(&font, &mut bold, [1600.0, -550.0, 1450.0, 1050.0]);
        bold.set_line_gap(Some(55.0));
        bold.set_italic_angle(Some(-12.0));
        bold.set_underline_position(Some(-140.0));
        bold.set_underline_thickness(Some(70.0));
        font.add_source(bold);
        font.set_default_source_id(regular_id);

        let independent = AxisMapping::new(
            "Weight curve".to_string(),
            vec![weight_id.clone()],
            vec![weight_id.clone()],
            vec![
                mapping_point(&[(weight_id.clone(), 100.0)], &[(weight_id.clone(), 100.0)]),
                mapping_point(&[(weight_id.clone(), 400.0)], &[(weight_id.clone(), 400.0)]),
                mapping_point(&[(weight_id.clone(), 900.0)], &[(weight_id.clone(), 800.0)]),
            ],
        );
        let mut cross = AxisMapping::new(
            "Italic compensation".to_string(),
            vec![weight_id.clone(), italic_id.clone()],
            vec![weight_id.clone()],
            vec![mapping_point(
                &[(weight_id.clone(), 800.0), (italic_id.clone(), 1.0)],
                &[(weight_id.clone(), 750.0)],
            )],
        );
        cross.set_description(Some("Reduce italic weight".to_string()));
        font.set_axis_mappings(vec![independent, cross]).unwrap();

        let mut instance_location = ExternalLocation::new();
        instance_location.set(weight_id, 900.0);
        instance_location.set(italic_id, 1.0);
        font.set_named_instances(vec![NamedInstance::new(
            "Black Italic".to_string(),
            instance_location,
            Some("DogfoodSans-BlackItalic".to_string()),
        )])
        .unwrap();

        let (actual, _) = FontDirectory::from_font(
            FontFormat::Designspace,
            &font,
            vec![
                ("A".to_string(), vec![0x41, 0x391].into_boxed_slice()),
                ("B".to_string(), vec![0x42].into_boxed_slice()),
            ],
        )
        .unwrap();
        let regular_metrics = FontMetrics {
            units_per_em: 2048.0,
            ascender: 1500.0,
            descender: -500.0,
            line_gap: 40.0,
            cap_height: Some(1400.0),
            x_height: Some(1000.0),
            italic_angle: Some(-2.0),
            underline_position: Some(-120.0),
            underline_thickness: Some(60.0),
        };
        let expected = FontDirectory {
            format: FontFormat::Designspace,
            family_name: Some("Dogfood Sans".to_string()),
            style_name: Some("Regular".to_string()),
            units_per_em: 2048.0,
            metrics: regular_metrics,
            glyphs: vec![
                DirectoryGlyph {
                    index: GlyphIndex::new(0),
                    name: "A".to_string(),
                    unicodes: vec![0x41, 0x391].into_boxed_slice(),
                },
                DirectoryGlyph {
                    index: GlyphIndex::new(1),
                    name: "B".to_string(),
                    unicodes: vec![0x42].into_boxed_slice(),
                },
            ]
            .into_boxed_slice(),
            axes: vec![
                VariationAxis {
                    index: AxisIndex::new(0),
                    tag: "wght".to_string(),
                    name: "Weight".to_string(),
                    hidden: true,
                    kind: VariationAxisKind::Continuous {
                        minimum: 100.0,
                        default: 400.0,
                        maximum: 900.0,
                    },
                },
                VariationAxis {
                    index: AxisIndex::new(1),
                    tag: "ital".to_string(),
                    name: "Italic".to_string(),
                    hidden: false,
                    kind: VariationAxisKind::Discrete {
                        values: vec![0.0, 1.0].into_boxed_slice(),
                        default: 0.0,
                    },
                },
            ]
            .into_boxed_slice(),
            sources: vec![
                DirectorySource {
                    index: SourceIndex::new(0),
                    name: "Regular".to_string(),
                    location: vec![400.0, 0.0].into_boxed_slice(),
                    filename: Some("Regular.ufo".to_string()),
                    metrics: regular_metrics,
                },
                DirectorySource {
                    index: SourceIndex::new(1),
                    name: "Bold".to_string(),
                    location: vec![800.0, 1.0].into_boxed_slice(),
                    filename: Some("Bold.ufo".to_string()),
                    metrics: FontMetrics {
                        units_per_em: 2048.0,
                        ascender: 1600.0,
                        descender: -550.0,
                        line_gap: 55.0,
                        cap_height: Some(1450.0),
                        x_height: Some(1050.0),
                        italic_angle: Some(-12.0),
                        underline_position: Some(-140.0),
                        underline_thickness: Some(70.0),
                    },
                },
            ]
            .into_boxed_slice(),
            default_source: SourceIndex::new(0),
            mappings: vec![
                DirectoryMapping {
                    name: "Weight curve".to_string(),
                    description: None,
                    input_axes: vec![AxisIndex::new(0)].into_boxed_slice(),
                    output_axes: vec![AxisIndex::new(0)].into_boxed_slice(),
                    points: vec![
                        directory_mapping_point(&[100.0], &[100.0]),
                        directory_mapping_point(&[400.0], &[400.0]),
                        directory_mapping_point(&[900.0], &[800.0]),
                    ]
                    .into_boxed_slice(),
                },
                DirectoryMapping {
                    name: "Italic compensation".to_string(),
                    description: Some("Reduce italic weight".to_string()),
                    input_axes: vec![AxisIndex::new(0), AxisIndex::new(1)].into_boxed_slice(),
                    output_axes: vec![AxisIndex::new(0)].into_boxed_slice(),
                    points: vec![directory_mapping_point(&[800.0, 1.0], &[750.0])]
                        .into_boxed_slice(),
                },
            ]
            .into_boxed_slice(),
            instances: vec![DirectoryInstance {
                name: "Black Italic".to_string(),
                location: vec![900.0, 1.0].into_boxed_slice(),
                postscript_name: Some("DogfoodSans-BlackItalic".to_string()),
            }]
            .into_boxed_slice(),
            default_location: VariationLocation::from_coordinates(vec![400.0, 0.0]),
        };

        assert_eq!(actual, expected);
    }

    #[test]
    fn canonical_directory_completes_sparse_mapping_coordinates() {
        let mut font = Font::empty();
        let weight = Axis::weight();
        let weight_id = weight.id();
        font.add_axis(weight).unwrap();
        let italic = Axis::discrete_with_id(
            AxisId::new(),
            "ital".to_string(),
            "Italic".to_string(),
            vec![0.0, 1.0],
            0.0,
        );
        let italic_id = italic.id();
        font.add_axis(italic).unwrap();
        let source_id = font.add_source(Source::new("Regular".to_string(), DesignLocation::new()));
        font.set_default_source_id(source_id);
        font.set_axis_mappings(vec![AxisMapping::new(
            "Sparse mapping".to_string(),
            vec![weight_id.clone(), italic_id.clone()],
            vec![weight_id.clone(), italic_id.clone()],
            vec![
                mapping_point(&[(italic_id.clone(), 1.0)], &[(weight_id.clone(), 450.0)]),
                mapping_point(&[(weight_id, 700.0)], &[(italic_id, 1.0)]),
            ],
        )])
        .unwrap();

        let (directory, _) =
            FontDirectory::from_font(FontFormat::Designspace, &font, Vec::new()).unwrap();

        assert_eq!(
            directory.mappings[0].points.as_ref(),
            [
                directory_mapping_point(&[400.0, 1.0], &[450.0, 1.0]),
                directory_mapping_point(&[700.0, 0.0], &[700.0, 1.0]),
            ]
        );
    }

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

    fn set_metrics(font: &Font, source: &mut Source, values: [f64; 4]) {
        for (kind, position) in [
            MetricKind::Ascender,
            MetricKind::Descender,
            MetricKind::CapHeight,
            MetricKind::XHeight,
        ]
        .into_iter()
        .zip(values)
        {
            let definition = font
                .metric_definitions()
                .iter()
                .find(|definition| definition.kind() == kind)
                .unwrap();
            source.set_metric_value(definition.id(), MetricValue::new(position, 0.0));
        }
    }

    fn mapping_point(input: &[(AxisId, f64)], output: &[(AxisId, f64)]) -> AxisMappingPoint {
        AxisMappingPoint {
            description: None,
            input: Location::from_map(input.iter().cloned().collect()),
            output: Location::from_map(output.iter().cloned().collect()),
        }
    }

    fn directory_mapping_point(input: &[f64], output: &[f64]) -> DirectoryMappingPoint {
        DirectoryMappingPoint {
            description: None,
            input: input.to_vec().into_boxed_slice(),
            output: output.to_vec().into_boxed_slice(),
        }
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
