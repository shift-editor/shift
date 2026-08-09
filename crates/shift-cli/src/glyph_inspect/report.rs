use std::collections::HashSet;
use std::path::Path;

use miette::{IntoDiagnostic, Result, WrapErr, bail, miette};
use shift_backends::font_loader::FontLoader;
use shift_font::composite::{
    ComponentAnchorReference as FontAnchorReference, GlyphComponents,
    ResolvedContour as FontResolvedContour,
};
use shift_font::variation::map_location;
use shift_font::{
    Axis, Component as FontComponent, DesignLocation, ExternalLocation, Font, GlyphId, GlyphLayer,
    LayerDifference, Point, PointType, Source,
};

use super::types::{
    AffineTransform, AnchorInspection, AnchorReference, Bounds, ComponentAttachment,
    ComponentInspection, ContourInspection, DecomposedTransform, GlyphIdentity, GlyphInspection,
    GlyphLocation, GlyphStructure, GlyphSummary, LayerInspection, LocationValue, PointInspection,
    ResolvedContour, ResolvedGlyph, SourceInspection, SourceReference, SourceWeight,
    VariationInspection, VariationRegion, VariationSupport,
};

impl GlyphInspection {
    pub fn load(path: &Path, selector: &str, coordinates: &[String]) -> Result<Self> {
        let path_text = path
            .to_str()
            .ok_or_else(|| miette!("font path is not valid UTF-8"))?;
        let font = FontLoader::new()
            .read_font(path_text)
            .into_diagnostic()
            .wrap_err_with(|| format!("failed to load font {}", path.display()))?;
        let glyph_id = resolve_glyph_id(&font, selector)?;
        let glyph = font
            .glyph(glyph_id.clone())
            .ok_or_else(|| miette!("glyph {selector:?} disappeared while inspecting the font"))?;
        let external = parse_location(&font, coordinates)?;
        let design = map_location(&external, font.axes(), font.axis_mappings())
            .into_diagnostic()
            .wrap_err("failed to map the external location into design space")?;
        let projection = font
            .glyph_projection(&glyph_id)
            .into_diagnostic()
            .wrap_err("failed to construct the glyph projection")?
            .ok_or_else(|| miette!("glyph {selector:?} has no master-backed geometry"))?;
        let exact_source = exact_source(&font, &design);
        let layer = projection
            .resolve(&design, font.axes(), font.sources())
            .into_diagnostic()
            .wrap_err("failed to resolve the glyph at the requested location")?;
        let relationships = selected_components(&projection, exact_source);
        let components = inspect_components(&font, relationships, &design)?;
        let structure = inspect_structure(&layer);
        let sources = inspect_sources(&font, glyph, projection.fallback());
        let variation = inspect_variation(&font, &projection, glyph, exact_source, &design)?;
        let mut font_projection = font.projection(&design);
        let resolved = font_projection
            .glyph(&glyph_id)
            .into_diagnostic()
            .wrap_err("failed to flatten the resolved glyph")?
            .ok_or_else(|| {
                miette!("glyph {selector:?} did not resolve at the requested location")
            })?;
        let resolved = inspect_resolved(resolved.x_advance(), resolved.contours());
        let point_count = structure
            .contours
            .iter()
            .map(|contour| contour.points.len())
            .sum();
        let resolved_point_count = resolved
            .contours
            .iter()
            .map(|contour| contour.points.len())
            .sum();

        Ok(Self {
            path: path.display().to_string(),
            format: path
                .extension()
                .and_then(|extension| extension.to_str())
                .unwrap_or("unknown")
                .to_ascii_lowercase(),
            glyph: GlyphIdentity {
                id: glyph.id().to_string(),
                name: glyph.name().to_string(),
                unicodes: glyph
                    .unicodes()
                    .iter()
                    .map(|unicode| format!("U+{unicode:04X}"))
                    .collect(),
            },
            location: GlyphLocation {
                external: location_values(external.as_untyped(), font.axes()),
                design: location_values(design.as_untyped(), font.axes()),
            },
            summary: GlyphSummary {
                advance: resolved.advance,
                bounds: resolved.bounds,
                contour_count: structure.contours.len(),
                point_count,
                anchor_count: structure.anchors.len(),
                direct_component_count: layer.components().len(),
                component_occurrence_count: components.len(),
                resolved_contour_count: resolved.contours.len(),
                resolved_point_count,
            },
            structure,
            components,
            sources,
            variation,
            resolved,
        })
    }
}

fn resolve_glyph_id(font: &Font, selector: &str) -> Result<GlyphId> {
    if let Ok(glyph_id) = selector.parse::<GlyphId>()
        && font.glyph(glyph_id.clone()).is_some()
    {
        return Ok(glyph_id);
    }
    if let Some(glyph_id) = font.glyph_id_by_name(selector) {
        return Ok(glyph_id);
    }

    bail!("glyph {selector:?} does not exist; use its name or full glyph_ id")
}

fn parse_location(font: &Font, coordinates: &[String]) -> Result<ExternalLocation> {
    let mut location = ExternalLocation::new();
    for axis in font.axes() {
        location.set(axis.id(), axis.default());
    }

    let mut seen = HashSet::new();
    for coordinate in coordinates {
        let Some((tag, value)) = coordinate.split_once('=') else {
            bail!("invalid location {coordinate:?}; expected TAG=VALUE");
        };
        let tag = tag.trim();
        if tag.is_empty() || !seen.insert(tag.to_string()) {
            bail!("axis tag {tag:?} is blank or repeated in the location");
        }
        let axis = font
            .axes()
            .iter()
            .find(|axis| axis.tag() == tag)
            .ok_or_else(|| miette!("axis tag {tag:?} does not exist"))?;
        let value = value
            .trim()
            .parse::<f64>()
            .into_diagnostic()
            .wrap_err_with(|| format!("invalid value for axis tag {tag:?}"))?;
        if !value.is_finite() {
            bail!("location value for axis tag {tag:?} must be finite");
        }
        if value < axis.minimum() || value > axis.maximum() {
            bail!(
                "location value {value} for {tag} is outside {}..{}",
                axis.minimum(),
                axis.maximum()
            );
        }
        if let Some(values) = axis.discrete_values()
            && !values.contains(&value)
        {
            bail!("location value {value} for {tag} is not an authored discrete value");
        }

        location.set(axis.id(), value);
    }

    Ok(location)
}

fn exact_source<'a>(font: &'a Font, location: &DesignLocation) -> Option<&'a Source> {
    font.sources().iter().find(|source| {
        source.is_master()
            && font.axes().iter().all(|axis| {
                let expected = source.location().get(&axis.id()).unwrap_or(axis.default());
                let actual = location.get(&axis.id()).unwrap_or(axis.default());
                (expected - actual).abs() <= 1e-6
            })
    })
}

fn selected_components<'a>(
    projection: &'a shift_font::GlyphProjection,
    source: Option<&Source>,
) -> &'a GlyphComponents {
    let Some(source) = source else {
        return projection.components();
    };

    projection
        .exact_source_components()
        .iter()
        .find(|candidate| candidate.source_id() == source.id())
        .map(|candidate| candidate.components())
        .unwrap_or_else(|| projection.components())
}

fn inspect_structure(layer: &GlyphLayer) -> GlyphStructure {
    GlyphStructure {
        contours: layer
            .contours_iter()
            .map(|contour| ContourInspection {
                id: contour.id().to_string(),
                closed: contour.is_closed(),
                points: contour.points().iter().map(inspect_point).collect(),
            })
            .collect(),
        anchors: layer
            .anchors_iter()
            .map(|anchor| AnchorInspection {
                id: anchor.id().to_string(),
                name: anchor.name().map(str::to_string),
                x: anchor.x(),
                y: anchor.y(),
            })
            .collect(),
    }
}

fn inspect_components(
    font: &Font,
    relationships: &GlyphComponents,
    location: &DesignLocation,
) -> Result<Vec<ComponentInspection>> {
    relationships
        .components()
        .iter()
        .enumerate()
        .map(|(order, occurrence)| {
            let parent_id = occurrence.parent_glyph_id();
            let parent_projection = font
                .glyph_projection(&parent_id)
                .into_diagnostic()
                .wrap_err("failed to construct a component parent projection")?
                .ok_or_else(|| miette!("component parent glyph {parent_id} has no projection"))?;
            let parent_layer = parent_projection
                .resolve(location, font.axes(), font.sources())
                .into_diagnostic()
                .wrap_err("failed to resolve a component parent layer")?;
            let component = parent_layer
                .components_iter()
                .find(|component| component.id() == occurrence.component_id())
                .ok_or_else(|| {
                    miette!(
                        "component {} is absent from resolved parent glyph {parent_id}",
                        occurrence.component_id()
                    )
                })?;
            let base_id = occurrence.base_glyph_id();
            let parent_name = font
                .glyph(parent_id.clone())
                .map(|glyph| glyph.name().to_string())
                .unwrap_or_else(|| parent_id.to_string());
            let base_name = font
                .glyph(base_id.clone())
                .map(|glyph| glyph.name().to_string())
                .unwrap_or_else(|| component.base_glyph_name().to_string());

            Ok(ComponentInspection {
                order,
                parent_glyph_id: parent_id.to_string(),
                parent_glyph_name: parent_name,
                component_id: occurrence.component_id().to_string(),
                base_glyph_id: base_id.to_string(),
                base_glyph_name: base_name,
                parent_path: occurrence
                    .parent_path()
                    .as_slice()
                    .iter()
                    .map(ToString::to_string)
                    .collect(),
                component_path: occurrence
                    .component_path()
                    .as_slice()
                    .iter()
                    .map(ToString::to_string)
                    .collect(),
                decomposed_transform: inspect_decomposed_transform(component),
                transform: inspect_transform(component),
                attachment: occurrence
                    .attachment()
                    .map(|attachment| ComponentAttachment {
                        source: inspect_anchor_reference(attachment.source()),
                        target: inspect_anchor_reference(attachment.target()),
                    }),
            })
        })
        .collect()
}

fn inspect_decomposed_transform(component: &FontComponent) -> DecomposedTransform {
    let transform = component.transform();
    DecomposedTransform {
        translate_x: transform.translate_x,
        translate_y: transform.translate_y,
        rotation: transform.rotation,
        scale_x: transform.scale_x,
        scale_y: transform.scale_y,
        skew_x: transform.skew_x,
        skew_y: transform.skew_y,
        center_x: transform.t_center_x,
        center_y: transform.t_center_y,
    }
}

fn inspect_transform(component: &FontComponent) -> AffineTransform {
    let matrix = component.matrix();
    AffineTransform {
        xx: matrix.xx,
        xy: matrix.xy,
        yx: matrix.yx,
        yy: matrix.yy,
        dx: matrix.dx,
        dy: matrix.dy,
    }
}

fn inspect_anchor_reference(reference: &FontAnchorReference) -> AnchorReference {
    AnchorReference {
        component_path: reference
            .component_path()
            .as_slice()
            .iter()
            .map(ToString::to_string)
            .collect(),
        glyph_id: reference.glyph_id().to_string(),
        anchor_id: reference.anchor_id().to_string(),
    }
}

fn inspect_sources(
    font: &Font,
    glyph: &shift_font::Glyph,
    reference: &GlyphLayer,
) -> Vec<SourceInspection> {
    font.sources()
        .iter()
        .map(|source| {
            let layer = glyph.layer_for_source(source.id());
            let compatibility =
                layer.map(|layer| reference.interpolation_compatibility_with(layer));
            SourceInspection {
                id: source.id().to_string(),
                name: source.name().to_string(),
                master: source.is_master(),
                location: location_values(source.location().as_untyped(), font.axes()),
                layer: layer.map(inspect_layer),
                compatible_with_reference: compatibility
                    .as_ref()
                    .map(|compatibility| compatibility.is_compatible()),
                differences: compatibility
                    .map(|compatibility| {
                        compatibility
                            .differences()
                            .iter()
                            .map(format_difference)
                            .collect()
                    })
                    .unwrap_or_default(),
            }
        })
        .collect()
}

fn inspect_layer(layer: &GlyphLayer) -> LayerInspection {
    LayerInspection {
        id: layer.id().to_string(),
        advance: layer.width(),
        contour_count: layer.contours().len(),
        point_count: layer
            .contours_iter()
            .map(|contour| contour.points().len())
            .sum(),
        anchor_count: layer.anchors().len(),
        component_count: layer.components().len(),
    }
}

fn inspect_variation(
    font: &Font,
    projection: &shift_font::GlyphProjection,
    glyph: &shift_font::Glyph,
    exact_source: Option<&Source>,
    location: &DesignLocation,
) -> Result<VariationInspection> {
    let interpolation = projection.interpolation();
    let source_weights = interpolation
        .map(|interpolation| {
            let weights = interpolation
                .basis()
                .weights_at(location, font.axes())
                .into_diagnostic()
                .wrap_err("failed to evaluate interpolation source weights")?;
            Ok::<_, miette::Report>(
                interpolation
                    .basis()
                    .source_ids()
                    .iter()
                    .zip(weights)
                    .map(|(source_id, weight)| SourceWeight {
                        source_id: source_id.to_string(),
                        source_name: font
                            .sources()
                            .iter()
                            .find(|source| source.id() == *source_id)
                            .map(|source| source.name().to_string())
                            .unwrap_or_else(|| source_id.to_string()),
                        weight,
                    })
                    .collect(),
            )
        })
        .transpose()?
        .unwrap_or_default();
    let regions = interpolation
        .map(|interpolation| {
            interpolation
                .basis()
                .variation_basis()
                .deltas()
                .iter()
                .map(|delta| VariationRegion {
                    supports: delta
                        .region()
                        .supports()
                        .iter()
                        .map(|support| VariationSupport {
                            axis_tag: font
                                .axes()
                                .iter()
                                .find(|axis| axis.id() == support.axis_id())
                                .map(|axis| axis.tag().to_string())
                                .unwrap_or_else(|| support.axis_id().to_string()),
                            minimum: support.minimum(),
                            peak: support.peak(),
                            maximum: support.maximum(),
                        })
                        .collect(),
                    scalar: interpolation_region_scalar(delta.region(), location, font.axes()),
                    value_count: delta.values().len(),
                    non_zero_value_count: delta
                        .values()
                        .iter()
                        .filter(|value| **value != 0.0)
                        .count(),
                    values: delta.values().to_vec(),
                })
                .collect()
        })
        .unwrap_or_default();
    let exact_layer = exact_source.and_then(|source| glyph.layer_for_source(source.id()));
    let selection = if exact_layer.is_some() {
        "exactSource"
    } else if interpolation.is_some() {
        "interpolation"
    } else {
        "fallback"
    };

    Ok(VariationInspection {
        model: "sourceWeights".to_string(),
        selection: selection.to_string(),
        exact_source: exact_source.map(|source| SourceReference {
            id: source.id().to_string(),
            name: source.name().to_string(),
        }),
        fallback_layer_id: projection.fallback().id().to_string(),
        reference_layer_id: interpolation
            .map(|interpolation| interpolation.reference_layer().id().to_string()),
        exact_shape_source_ids: projection
            .exact_source_shapes()
            .iter()
            .map(|shape| shape.source_id().to_string())
            .collect(),
        source_weights,
        regions,
    })
}

fn interpolation_region_scalar(
    region: &shift_font::InterpolationRegion,
    location: &DesignLocation,
    axes: &[Axis],
) -> f64 {
    let mut scalar = 1.0;
    for support in region.supports() {
        let Some(axis) = axes.iter().find(|axis| axis.id() == support.axis_id()) else {
            return 0.0;
        };
        let value = location.get(&axis.id()).unwrap_or(axis.default());
        let normalized = axis.normalize(value);
        if normalized == support.peak()
            || (support.minimum() == 0.0 && support.peak() == 0.0 && support.maximum() == 0.0)
        {
            continue;
        }
        if normalized <= support.minimum() || support.maximum() <= normalized {
            return 0.0;
        }
        let edge = if normalized < support.peak() {
            support.minimum()
        } else {
            support.maximum()
        };
        scalar *= (normalized - edge) / (support.peak() - edge);
    }
    scalar
}

fn inspect_resolved(advance: f64, contours: &[FontResolvedContour]) -> ResolvedGlyph {
    let contours = contours
        .iter()
        .map(|contour| ResolvedContour {
            closed: contour.closed,
            points: contour
                .points
                .iter()
                .map(|point| PointInspection {
                    id: None,
                    x: point.x(),
                    y: point.y(),
                    point_type: point_type_name(point.point_type()).to_string(),
                    smooth: point.is_smooth(),
                })
                .collect(),
        })
        .collect::<Vec<_>>();
    let bounds = bounds_for_contours(&contours);

    ResolvedGlyph {
        advance,
        bounds,
        contours,
    }
}

fn inspect_point(point: &Point) -> PointInspection {
    PointInspection {
        id: Some(point.id().to_string()),
        x: point.x(),
        y: point.y(),
        point_type: point_type_name(point.point_type()).to_string(),
        smooth: point.is_smooth(),
    }
}

fn point_type_name(point_type: PointType) -> &'static str {
    match point_type {
        PointType::OnCurve => "onCurve",
        PointType::OffCurve => "offCurve",
        PointType::QCurve => "qCurve",
    }
}

fn location_values(location: &shift_font::Location, axes: &[Axis]) -> Vec<LocationValue> {
    axes.iter()
        .map(|axis| LocationValue {
            axis_tag: axis.tag().to_string(),
            value: location.get(&axis.id()).unwrap_or(axis.default()),
        })
        .collect()
}

fn bounds_for_contours(contours: &[ResolvedContour]) -> Option<Bounds> {
    let mut points = contours.iter().flat_map(|contour| contour.points.iter());
    let first = points.next()?;
    let mut bounds = Bounds {
        min_x: first.x,
        min_y: first.y,
        max_x: first.x,
        max_y: first.y,
    };
    for point in points {
        bounds.min_x = bounds.min_x.min(point.x);
        bounds.min_y = bounds.min_y.min(point.y);
        bounds.max_x = bounds.max_x.max(point.x);
        bounds.max_y = bounds.max_y.max(point.y);
    }
    Some(bounds)
}

fn format_difference(difference: &LayerDifference) -> String {
    match difference {
        LayerDifference::PathCount { reference, source } => {
            format!("path count: reference {reference}, source {source}")
        }
        LayerDifference::PathClosed {
            path,
            reference,
            source,
        } => format!("path {path} closed: reference {reference}, source {source}"),
        LayerDifference::NodeCount {
            path,
            reference,
            source,
        } => format!("path {path} node count: reference {reference}, source {source}"),
        LayerDifference::NodeKind {
            path,
            node,
            reference,
            source,
        } => format!(
            "path {path} node {node} kind: reference {}, source {}",
            point_type_name(*reference),
            point_type_name(*source)
        ),
        LayerDifference::AnchorCount { reference, source } => {
            format!("anchor count: reference {reference}, source {source}")
        }
        LayerDifference::AnchorSequence { .. } => "anchor sequence differs".to_string(),
        LayerDifference::ComponentSequence { .. } => "component sequence differs".to_string(),
    }
}
