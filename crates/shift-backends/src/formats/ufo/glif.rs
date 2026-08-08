use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use norad::PointType;

use crate::font_source::geometry::{
    control_point_kind, normalize_contour, ContourPoint, SourceComponent, SourceContour,
    SourceGeometry,
};
use crate::font_source::interpolation::InterpolationAxis;
use crate::font_source::projection::{empty_projection_layer, project_layers, ProjectionLayer};
use crate::font_source::{
    malformed, AffineTransform, DirectoryGlyphInput, FontDirectory, FontReadError, GlyphAnchor,
    GlyphIndex, GlyphMetrics, GlyphPointKind, GlyphProjection, PointProvenance, SourceIndex,
};

pub(crate) struct RetainedGlif {
    path: PathBuf,
    bytes: Arc<[u8]>,
}

pub(crate) struct RetainedUfoLayer {
    glyphs: Box<[Option<RetainedGlif>]>,
}

pub(crate) fn project_glif_glyph(
    path: &Path,
    glyphs_by_name: &HashMap<String, GlyphIndex>,
    sources: &[(Vec<f64>, Box<[RetainedUfoLayer]>)],
    default_source: usize,
    interpolation_axes: &[InterpolationAxis],
    glyph: GlyphIndex,
) -> Result<GlyphProjection, FontReadError> {
    let mut layers = Vec::new();
    for (source_index, (location, source_layers)) in sources.iter().enumerate() {
        let Some(retained) = source_layers
            .iter()
            .find_map(|layer| layer.glyphs.get(glyph.to_usize()).and_then(Option::as_ref))
        else {
            continue;
        };
        let parsed = norad::Glyph::parse_raw(&retained.bytes).map_err(|error| {
            malformed(
                path,
                format!("failed to parse glyph {}: {error}", retained.path.display()),
            )
        })?;
        let layer = convert_norad_layer(path, glyphs_by_name, glyph, &parsed)?;
        layers.push((
            SourceIndex::new(source_index as u32),
            location.clone(),
            layer,
        ));
    }
    if layers.is_empty() {
        layers.push((
            SourceIndex::new(default_source as u32),
            sources[default_source].0.clone(),
            empty_projection_layer(glyph),
        ));
    }
    project_layers(
        layers,
        interpolation_axes,
        SourceIndex::new(default_source as u32),
    )
}

pub(crate) fn retained_layer(
    directory: &FontDirectory,
    paths: BTreeMap<String, PathBuf>,
) -> Result<RetainedUfoLayer, FontReadError> {
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
    Ok(RetainedUfoLayer {
        glyphs: glyphs.into_boxed_slice(),
    })
}

pub(crate) fn glyph_directory(
    layers: &[BTreeMap<String, PathBuf>],
) -> Result<Vec<DirectoryGlyphInput>, FontReadError> {
    let names = layers
        .iter()
        .flat_map(|layer| layer.keys().cloned())
        .collect::<std::collections::BTreeSet<_>>();
    names
        .into_iter()
        .map(|name| {
            let path = layers
                .iter()
                .find_map(|layer| layer.get(&name))
                .ok_or_else(|| malformed(Path::new(&name), "glyph path is unavailable".into()))?;
            let glyph = norad::Glyph::load(path)
                .map_err(|error| malformed(path, format!("failed to read glyph: {error}")))?;
            Ok((
                name,
                glyph
                    .codepoints
                    .iter()
                    .map(u32::from)
                    .collect::<Vec<_>>()
                    .into_boxed_slice(),
            ))
        })
        .collect()
}

fn convert_norad_layer(
    path: &Path,
    glyphs_by_name: &HashMap<String, GlyphIndex>,
    glyph: GlyphIndex,
    source: &norad::Glyph,
) -> Result<ProjectionLayer, FontReadError> {
    let mut components = Vec::with_capacity(source.components.len());
    for component in &source.components {
        let name = component.base.to_string();
        let base = glyphs_by_name.get(&name).copied().ok_or_else(|| {
            malformed(
                path,
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
    Ok(ProjectionLayer {
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
    control_point_kind(
        points,
        index,
        closed,
        |point| match point.typ {
            PointType::OffCurve => Ok(None),
            PointType::QCurve => Ok(Some(GlyphPointKind::QuadraticControl)),
            PointType::Curve => Ok(Some(GlyphPointKind::CubicControl)),
            PointType::Move | PointType::Line => Err(FontReadError::InvalidProjection {
                details: "off-curve GLIF point is followed by a line endpoint".into(),
            }),
        },
        "open GLIF contour ends with an off-curve point",
    )
}
