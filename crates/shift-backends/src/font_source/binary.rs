use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::SystemTime;

use skrifa::outline::{DrawSettings, OutlinePen};
use skrifa::prelude::{LocationRef, Size};
use skrifa::raw::tables::glyf::Glyf;
use skrifa::raw::tables::glyf::{
    Anchor as GlyfAnchor, CompositeGlyphFlags, Glyph as GlyfGlyph, PointFlags,
};
use skrifa::raw::tables::gvar::Gvar;
use skrifa::raw::tables::loca::Loca;
use skrifa::raw::types::{GlyphId, Point as RawPoint};
use skrifa::raw::{ReadError, TableProvider};
use skrifa::string::StringId;
use skrifa::{FontRef, MetadataProvider};

use crate::font_source::geometry::{
    build_display_glyph, normalize_contour, ContourPoint, SourceComponent, SourceContour,
    SourceGeometry,
};
use crate::font_source::{
    AffineTransform, AxisIndex, DirectoryGlyph, DisplayGlyph, FontDirectory, FontMetrics,
    FontReadError, GlyphIndex, GlyphMetrics, GlyphPoint, GlyphPointKind, PointProvenance,
    RandomAccessFont, TrueTypePointIndex, VariationAxis, VariationAxisKind, VariationLocation,
};
use crate::FontFormat;

mod atlas;
pub use atlas::build_binary_atlas_page;

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

/// Retained bytes and indexes for one binary TTF, OTF, or variable font.
pub struct BinaryFont {
    path: PathBuf,
    stamp: SourceStamp,
    changed: AtomicBool,
    bytes: Arc<[u8]>,
    directory: FontDirectory,
}

impl BinaryFont {
    pub fn open(path: &Path) -> Result<Self, FontReadError> {
        let stamp = SourceStamp::read(path)?;
        let bytes: Arc<[u8]> = std::fs::read(path)
            .map_err(|source| FontReadError::Io {
                path: path.to_path_buf(),
                source,
            })?
            .into();
        let font = FontRef::new(bytes.as_ref())
            .map_err(|error| malformed(path, format!("failed to parse font: {error}")))?;
        let directory = binary_directory(path, &font)?;
        Ok(Self {
            path: path.to_path_buf(),
            stamp,
            changed: AtomicBool::new(false),
            bytes,
            directory,
        })
    }

    pub(crate) fn bytes(&self) -> &Arc<[u8]> {
        &self.bytes
    }

    pub fn metrics(&self, location: &VariationLocation) -> Result<FontMetrics, FontReadError> {
        self.verify_source()?;
        let font = FontRef::new(self.bytes.as_ref()).map_err(|error| {
            malformed(
                &self.path,
                format!("failed to reopen retained font: {error}"),
            )
        })?;
        let skrifa_location = self.skrifa_location(&font, location)?;
        let metrics = font.metrics(Size::unscaled(), LocationRef::from(&skrifa_location));
        Ok(FontMetrics {
            units_per_em: f64::from(metrics.units_per_em),
            ascender: f64::from(metrics.ascent),
            descender: f64::from(metrics.descent),
            line_gap: f64::from(metrics.leading),
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

    fn skrifa_location(
        &self,
        font: &FontRef<'_>,
        location: &VariationLocation,
    ) -> Result<skrifa::instance::Location, FontReadError> {
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
        Ok(font.axes().location(
            self.directory
                .axes
                .iter()
                .zip(location.coordinates())
                .map(|(axis, value)| (axis.tag.as_str(), *value as f32)),
        ))
    }
}

impl RandomAccessFont for BinaryFont {
    fn directory(&self) -> &FontDirectory {
        &self.directory
    }

    fn read_glyph(
        &self,
        glyph: GlyphIndex,
        location: &VariationLocation,
    ) -> Result<DisplayGlyph, FontReadError> {
        self.verify_source()?;
        let Some(_) = self.directory.glyphs.get(glyph.to_usize()) else {
            return Err(FontReadError::GlyphOutOfRange {
                glyph,
                glyph_count: self.directory.glyphs.len() as u32,
            });
        };
        let font = FontRef::new(self.bytes.as_ref()).map_err(|error| {
            malformed(
                &self.path,
                format!("failed to reopen retained font: {error}"),
            )
        })?;
        let skrifa_location = self.skrifa_location(&font, location)?;
        let raw_glyph = GlyphId::new(glyph.to_u32());
        let glyph_metrics =
            font.glyph_metrics(Size::unscaled(), LocationRef::from(&skrifa_location));
        let x_advance = glyph_metrics.advance_width(raw_glyph).ok_or_else(|| {
            malformed(
                &self.path,
                format!("missing advance width for glyph {raw_glyph}"),
            )
        })? as f64;

        let geometries = match (font.loca(None), font.glyf()) {
            (Ok(loca), Ok(glyf)) => {
                let gvar = match font.gvar() {
                    Ok(gvar) => Some(gvar),
                    Err(ReadError::TableIsMissing(_)) => None,
                    Err(error) => {
                        return Err(malformed(
                            &self.path,
                            format!("failed to read gvar table: {error}"),
                        ))
                    }
                };
                GlyfResolver::new(&self.path, loca, glyf, gvar, skrifa_location.coords())
                    .resolve(glyph)?
            }
            _ => vec![cff_geometry(
                &self.path,
                &font,
                raw_glyph,
                &skrifa_location,
                glyph,
            )?],
        };

        build_display_glyph(
            glyph,
            location.clone(),
            geometries,
            GlyphMetrics {
                x_advance,
                y_advance: None,
            },
        )
    }
}

fn binary_directory(path: &Path, font: &FontRef<'_>) -> Result<FontDirectory, FontReadError> {
    font.hmtx()
        .map_err(|error| malformed(path, format!("failed to read hmtx table: {error}")))?;
    let glyph_count = font
        .maxp()
        .map_err(|error| malformed(path, format!("failed to read maxp table: {error}")))?
        .num_glyphs() as usize;
    let mut unicodes = vec![Vec::new(); glyph_count];
    for (unicode, glyph_id) in font.charmap().mappings() {
        if let Some(values) = unicodes.get_mut(glyph_id.to_u32() as usize) {
            values.push(unicode);
        }
    }
    let names = font.glyph_names();
    let glyphs = unicodes
        .into_iter()
        .enumerate()
        .map(|(index, unicodes)| {
            let raw_id = GlyphId::new(index as u32);
            DirectoryGlyph {
                index: GlyphIndex::new(index as u32),
                name: names
                    .get(raw_id)
                    .map(|name| name.to_string())
                    .unwrap_or_else(|| format!("gid{index}")),
                unicodes: unicodes.into_boxed_slice(),
            }
        })
        .collect();
    let axes = font
        .axes()
        .iter()
        .enumerate()
        .map(|(index, axis)| VariationAxis {
            index: AxisIndex::new(index as u32),
            tag: axis.tag().to_string(),
            name: localized_string(font, axis.name_id()).unwrap_or_else(|| axis.tag().to_string()),
            hidden: axis.is_hidden(),
            kind: VariationAxisKind::Continuous {
                minimum: axis.min_value() as f64,
                default: axis.default_value() as f64,
                maximum: axis.max_value() as f64,
            },
        })
        .collect();
    let metrics = font.metrics(Size::unscaled(), LocationRef::default());
    FontDirectory::new(
        format_for_path(path)?,
        localized_string(font, StringId::FAMILY_NAME),
        localized_string(font, StringId::SUBFAMILY_NAME),
        metrics.units_per_em as f64,
        glyphs,
        axes,
    )
}

struct ResolvedGlyfGeometry {
    source: SourceGeometry,
    attachment_points: Vec<(f64, f64)>,
}

struct GlyfResolver<'a> {
    path: &'a Path,
    loca: Loca<'a>,
    glyf: Glyf<'a>,
    gvar: Option<Gvar<'a>>,
    coordinates: &'a [skrifa::instance::NormalizedCoord],
    indices: HashMap<GlyphIndex, usize>,
    states: Vec<u8>,
    geometries: Vec<Option<ResolvedGlyfGeometry>>,
}

impl<'a> GlyfResolver<'a> {
    fn new(
        path: &'a Path,
        loca: Loca<'a>,
        glyf: Glyf<'a>,
        gvar: Option<Gvar<'a>>,
        coordinates: &'a [skrifa::instance::NormalizedCoord],
    ) -> Self {
        Self {
            path,
            loca,
            glyf,
            gvar,
            coordinates,
            indices: HashMap::new(),
            states: Vec::new(),
            geometries: Vec::new(),
        }
    }

    fn resolve(mut self, root: GlyphIndex) -> Result<Vec<SourceGeometry>, FontReadError> {
        self.resolve_geometry(root)?;
        self.geometries
            .into_iter()
            .map(|geometry| {
                geometry.map(|geometry| geometry.source).ok_or_else(|| {
                    FontReadError::InvalidDisplayGlyph {
                        details: "binary geometry resolution left an empty slot".into(),
                    }
                })
            })
            .collect()
    }

    fn resolve_geometry(&mut self, glyph: GlyphIndex) -> Result<usize, FontReadError> {
        if let Some(index) = self.indices.get(&glyph).copied() {
            return match self.states[index] {
                1 => Err(FontReadError::ComponentCycle { glyph }),
                2 => Ok(index),
                _ => Err(FontReadError::InvalidDisplayGlyph {
                    details: "binary geometry has an invalid resolution state".into(),
                }),
            };
        }

        let index = self.geometries.len();
        self.indices.insert(glyph, index);
        self.states.push(1);
        self.geometries.push(None);
        let raw_id = GlyphId::new(glyph.to_u32());
        let raw = self.loca.get_glyf(raw_id, &self.glyf).map_err(|error| {
            malformed(self.path, format!("failed to read glyph {raw_id}: {error}"))
        })?;
        let geometry = match raw {
            None => ResolvedGlyfGeometry {
                source: empty_geometry(glyph),
                attachment_points: Vec::new(),
            },
            Some(GlyfGlyph::Simple(simple)) => self.resolve_simple(glyph, raw_id, &simple)?,
            Some(GlyfGlyph::Composite(composite)) => {
                let components = composite.components().collect::<Vec<_>>();
                let deltas = self.composite_deltas(raw_id, components.len())?;
                let mut source = empty_geometry(glyph);
                let mut attachment_points: Vec<(f64, f64)> = Vec::new();

                for (component_index, component) in components.into_iter().enumerate() {
                    let child_glyph = GlyphIndex::new(component.glyph.to_u32());
                    let child_index = self.resolve_geometry(child_glyph)?;
                    let child = self.geometries[child_index].as_ref().ok_or_else(|| {
                        FontReadError::InvalidDisplayGlyph {
                            details: "resolved component geometry is unavailable".into(),
                        }
                    })?;
                    let mut transform = component_transform(&component);
                    match component.anchor {
                        GlyfAnchor::Offset { x, y } => {
                            let mut x = f64::from(x);
                            let mut y = f64::from(y);
                            if component
                                .flags
                                .contains(CompositeGlyphFlags::SCALED_COMPONENT_OFFSET)
                                && !component
                                    .flags
                                    .contains(CompositeGlyphFlags::UNSCALED_COMPONENT_OFFSET)
                            {
                                x *= approximate_hypot(transform.xx, transform.yx);
                                y *= approximate_hypot(transform.yy, transform.xy);
                            }
                            let delta = deltas.get(component_index).copied().unwrap_or_default();
                            transform.dx = x + delta.0;
                            transform.dy = y + delta.1;
                        }
                        GlyfAnchor::Point { base, component } => {
                            let base =
                                attachment_points
                                    .get(base as usize)
                                    .copied()
                                    .ok_or_else(|| {
                                        malformed(
                                    self.path,
                                    format!("invalid base anchor point {base} in glyph {raw_id}"),
                                )
                                    })?;
                            let component_point = child
                                .attachment_points
                                .get(component as usize)
                                .copied()
                                .ok_or_else(|| {
                                    malformed(
                                        self.path,
                                        format!(
                                            "invalid component anchor point {component} in glyph {raw_id}"
                                        ),
                                    )
                                })?;
                            let component_point =
                                transform.transform_point(component_point.0, component_point.1);
                            transform.dx = base.0 - component_point.0;
                            transform.dy = base.1 - component_point.1;
                        }
                    }
                    attachment_points.extend(
                        child
                            .attachment_points
                            .iter()
                            .map(|point| transform.transform_point(point.0, point.1)),
                    );
                    source.components.push(SourceComponent {
                        glyph: child_glyph,
                        transform,
                    });
                }
                ResolvedGlyfGeometry {
                    source,
                    attachment_points,
                }
            }
        };
        self.geometries[index] = Some(geometry);
        self.states[index] = 2;
        Ok(index)
    }

    fn resolve_simple(
        &self,
        glyph: GlyphIndex,
        raw_id: GlyphId,
        simple: &skrifa::raw::tables::glyf::SimpleGlyph<'_>,
    ) -> Result<ResolvedGlyfGeometry, FontReadError> {
        let point_count = simple.num_points();
        let mut raw_points = vec![RawPoint::<i32>::default(); point_count];
        let mut flags = vec![PointFlags::default(); point_count];
        simple
            .read_points_fast(&mut raw_points, &mut flags)
            .map_err(|error| {
                malformed(
                    self.path,
                    format!("failed to read points for glyph {raw_id}: {error}"),
                )
            })?;
        let contour_ends = simple
            .end_pts_of_contours()
            .iter()
            .map(|end| end.get())
            .collect::<Vec<_>>();
        let deltas = self.simple_deltas(raw_id, &raw_points, &contour_ends)?;
        let resolved_points = raw_points
            .iter()
            .zip(deltas)
            .map(|(point, delta)| (f64::from(point.x) + delta.0, f64::from(point.y) + delta.1))
            .collect::<Vec<_>>();
        let mut contours = Vec::with_capacity(contour_ends.len());
        let mut start = 0;
        for end in contour_ends {
            let end = end as usize;
            if end < start || end >= resolved_points.len() {
                return Err(malformed(
                    self.path,
                    format!("invalid contour endpoint {end} in glyph {raw_id}"),
                ));
            }
            contours.push(normalize_glyf_contour(
                &resolved_points[start..=end],
                &flags[start..=end],
                start,
            )?);
            start = end + 1;
        }
        Ok(ResolvedGlyfGeometry {
            source: SourceGeometry {
                glyph,
                contours,
                components: Vec::new(),
                anchors: Vec::new(),
                guides: Vec::new(),
            },
            attachment_points: resolved_points,
        })
    }

    fn simple_deltas(
        &self,
        glyph: GlyphId,
        points: &[RawPoint<i32>],
        contours: &[u16],
    ) -> Result<Vec<(f64, f64)>, FontReadError> {
        let mut total = vec![(0.0, 0.0); points.len()];
        let Some(gvar) = &self.gvar else {
            return Ok(total);
        };
        let Some(variation) = gvar.glyph_variation_data(glyph).map_err(|error| {
            malformed(
                self.path,
                format!("failed to read variation data for glyph {glyph}: {error}"),
            )
        })?
        else {
            return Ok(total);
        };

        for (tuple, scalar) in variation.active_tuples_at(self.coordinates) {
            let scalar = scalar.to_f64();
            let mut tuple_deltas = vec![None; points.len()];
            for delta in tuple.deltas() {
                let index = delta.position as usize;
                if index < tuple_deltas.len() {
                    tuple_deltas[index] = Some((
                        f64::from(delta.x_delta) * scalar,
                        f64::from(delta.y_delta) * scalar,
                    ));
                }
            }
            infer_tuple_deltas(points, contours, &mut tuple_deltas)?;
            for (total, delta) in total.iter_mut().zip(tuple_deltas) {
                let delta = delta.unwrap_or_default();
                total.0 += delta.0;
                total.1 += delta.1;
            }
        }
        Ok(total)
    }

    fn composite_deltas(
        &self,
        glyph: GlyphId,
        component_count: usize,
    ) -> Result<Vec<(f64, f64)>, FontReadError> {
        let mut total = vec![(0.0, 0.0); component_count];
        let Some(gvar) = &self.gvar else {
            return Ok(total);
        };
        let Some(variation) = gvar.glyph_variation_data(glyph).map_err(|error| {
            malformed(
                self.path,
                format!("failed to read variation data for glyph {glyph}: {error}"),
            )
        })?
        else {
            return Ok(total);
        };
        for (tuple, scalar) in variation.active_tuples_at(self.coordinates) {
            let scalar = scalar.to_f64();
            for delta in tuple.deltas() {
                if let Some(total) = total.get_mut(delta.position as usize) {
                    total.0 += f64::from(delta.x_delta) * scalar;
                    total.1 += f64::from(delta.y_delta) * scalar;
                }
            }
        }
        Ok(total)
    }
}

fn infer_tuple_deltas(
    points: &[RawPoint<i32>],
    contour_ends: &[u16],
    deltas: &mut [Option<(f64, f64)>],
) -> Result<(), FontReadError> {
    let mut start = 0;
    for end in contour_ends {
        let end = *end as usize;
        if end < start || end >= points.len() || end >= deltas.len() {
            return Err(FontReadError::InvalidDisplayGlyph {
                details: "variation contour endpoints are invalid".into(),
            });
        }
        let references = (start..=end)
            .filter(|index| deltas[*index].is_some())
            .collect::<Vec<_>>();
        match references.as_slice() {
            [] => {}
            [reference] => {
                let delta = deltas[*reference].expect("reference has a delta");
                for value in &mut deltas[start..=end] {
                    *value = Some(delta);
                }
            }
            _ => {
                for position in 0..references.len() {
                    let first = references[position];
                    let second = references[(position + 1) % references.len()];
                    let mut index = if first == end { start } else { first + 1 };
                    while index != second {
                        let x = interpolate_delta_coordinate(
                            points[index].x,
                            points[first].x,
                            points[second].x,
                            deltas[first].expect("reference has a delta").0,
                            deltas[second].expect("reference has a delta").0,
                        );
                        let y = interpolate_delta_coordinate(
                            points[index].y,
                            points[first].y,
                            points[second].y,
                            deltas[first].expect("reference has a delta").1,
                            deltas[second].expect("reference has a delta").1,
                        );
                        deltas[index] = Some((x, y));
                        index = if index == end { start } else { index + 1 };
                    }
                }
            }
        }
        start = end + 1;
    }
    Ok(())
}

fn interpolate_delta_coordinate(
    point: i32,
    first: i32,
    second: i32,
    first_delta: f64,
    second_delta: f64,
) -> f64 {
    let (first, first_delta, second, second_delta) = if first <= second {
        (first, first_delta, second, second_delta)
    } else {
        (second, second_delta, first, first_delta)
    };
    if first == second {
        return if first_delta == second_delta {
            first_delta
        } else {
            0.0
        };
    }
    if point <= first {
        return first_delta;
    }
    if point >= second {
        return second_delta;
    }
    first_delta
        + (second_delta - first_delta) * f64::from(point - first) / f64::from(second - first)
}

fn normalize_glyf_contour(
    points: &[(f64, f64)],
    flags: &[PointFlags],
    source_start: usize,
) -> Result<SourceContour, FontReadError> {
    if points.is_empty() || points.len() != flags.len() {
        return Err(FontReadError::InvalidDisplayGlyph {
            details: "TrueType contour points and flags disagree".into(),
        });
    }
    let points = points
        .iter()
        .zip(flags)
        .enumerate()
        .map(|(index, (point, flags))| {
            let kind = if flags.is_on_curve() {
                GlyphPointKind::OnCurve
            } else if flags.is_off_curve_cubic() {
                GlyphPointKind::CubicControl
            } else {
                GlyphPointKind::QuadraticControl
            };
            native_glyf_point(*point, kind, source_start + index)
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut contour = normalize_contour(points, true)?;
    detect_smooth_points(&mut contour);
    Ok(contour)
}

fn native_glyf_point(
    point: (f64, f64),
    kind: GlyphPointKind,
    index: usize,
) -> Result<ContourPoint, FontReadError> {
    let index = u32::try_from(index).map_err(|_| FontReadError::InvalidDisplayGlyph {
        details: "TrueType point index exceeds u32".into(),
    })?;
    Ok(ContourPoint {
        x: point.0,
        y: point.1,
        kind,
        smooth: false,
        provenance: PointProvenance::Native {
            ttf_point_index: Some(TrueTypePointIndex::new(index)),
        },
    })
}

/// Maximum tangent-angle difference used by the authored binary importer.
const SMOOTH_ANGLE_TOLERANCE: f64 = 0.05;

fn detect_smooth_points(contour: &mut SourceContour) {
    let point_count = contour.points.len();
    if point_count < 3 {
        return;
    }

    for index in 0..point_count {
        let point = &contour.points[index];
        if point.kind != GlyphPointKind::OnCurve || point.provenance == PointProvenance::Implied {
            continue;
        }

        let (previous_index, next_index) = if contour.closed {
            (
                (index + point_count - 1) % point_count,
                (index + 1) % point_count,
            )
        } else {
            if index == 0 || index + 1 == point_count {
                continue;
            }
            (index - 1, index + 1)
        };
        let previous = &contour.points[previous_index];
        let next = &contour.points[next_index];
        if previous.kind == GlyphPointKind::OnCurve && next.kind == GlyphPointKind::OnCurve {
            continue;
        }

        let incoming_x = point.x - previous.x;
        let incoming_y = point.y - previous.y;
        let outgoing_x = next.x - point.x;
        let outgoing_y = next.y - point.y;
        let length_product = incoming_x.hypot(incoming_y) * outgoing_x.hypot(outgoing_y);
        if length_product == 0.0 {
            continue;
        }

        let dot = incoming_x * outgoing_x + incoming_y * outgoing_y;
        let cross = incoming_x * outgoing_y - incoming_y * outgoing_x;
        if dot > 0.0 && cross.abs() <= length_product * SMOOTH_ANGLE_TOLERANCE.sin() {
            contour.points[index].smooth = true;
        }
    }
}

fn component_transform(component: &skrifa::raw::tables::glyf::Component) -> AffineTransform {
    AffineTransform {
        xx: f64::from(component.transform.xx.to_f32()),
        xy: f64::from(component.transform.yx.to_f32()),
        yx: f64::from(component.transform.xy.to_f32()),
        yy: f64::from(component.transform.yy.to_f32()),
        dx: 0.0,
        dy: 0.0,
    }
}

fn approximate_hypot(a: f64, b: f64) -> f64 {
    let a = a.abs();
    let b = b.abs();
    if a > b {
        a + 0.375 * b
    } else {
        b + 0.375 * a
    }
}

#[derive(Default)]
struct CffPen {
    contours: Vec<SourceContour>,
    current: Vec<GlyphPoint>,
}

impl CffPen {
    fn finish_contour(&mut self, closed: bool) {
        if self.current.is_empty() {
            return;
        }
        if closed && self.current.len() > 1 {
            let first = &self.current[0];
            let last = self.current.last().expect("current contour is non-empty");
            if last.kind == GlyphPointKind::OnCurve && last.x == first.x && last.y == first.y {
                self.current.pop();
            }
        }
        let mut contour = SourceContour {
            points: std::mem::take(&mut self.current),
            closed,
        };
        detect_smooth_points(&mut contour);
        self.contours.push(contour);
    }

    fn push(&mut self, x: f32, y: f32, kind: GlyphPointKind) {
        self.current.push(GlyphPoint {
            x: f64::from(x),
            y: f64::from(y),
            kind,
            smooth: false,
            provenance: PointProvenance::Native {
                ttf_point_index: None,
            },
        });
    }
}

impl OutlinePen for CffPen {
    fn move_to(&mut self, x: f32, y: f32) {
        self.finish_contour(false);
        self.push(x, y, GlyphPointKind::OnCurve);
    }

    fn line_to(&mut self, x: f32, y: f32) {
        self.push(x, y, GlyphPointKind::OnCurve);
    }

    fn quad_to(&mut self, cx0: f32, cy0: f32, x: f32, y: f32) {
        self.push(cx0, cy0, GlyphPointKind::QuadraticControl);
        self.push(x, y, GlyphPointKind::OnCurve);
    }

    fn curve_to(&mut self, cx0: f32, cy0: f32, cx1: f32, cy1: f32, x: f32, y: f32) {
        self.push(cx0, cy0, GlyphPointKind::CubicControl);
        self.push(cx1, cy1, GlyphPointKind::CubicControl);
        self.push(x, y, GlyphPointKind::OnCurve);
    }

    fn close(&mut self) {
        self.finish_contour(true);
    }
}

fn cff_geometry(
    path: &Path,
    font: &FontRef<'_>,
    raw_glyph: GlyphId,
    location: &skrifa::instance::Location,
    glyph: GlyphIndex,
) -> Result<SourceGeometry, FontReadError> {
    let mut pen = CffPen::default();
    if let Some(outline) = font.outline_glyphs().get(raw_glyph) {
        outline
            .draw(
                DrawSettings::unhinted(Size::unscaled(), LocationRef::from(location)),
                &mut pen,
            )
            .map_err(|error| {
                malformed(
                    path,
                    format!("failed to draw CFF glyph {raw_glyph}: {error}"),
                )
            })?;
    }
    pen.finish_contour(false);
    Ok(SourceGeometry {
        glyph,
        contours: pen.contours,
        components: Vec::new(),
        anchors: Vec::new(),
        guides: Vec::new(),
    })
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

fn localized_string(font: &FontRef<'_>, id: StringId) -> Option<String> {
    font.localized_strings(id)
        .english_or_first()
        .map(|string| string.to_string())
        .filter(|string| !string.is_empty())
}

fn format_for_path(path: &Path) -> Result<FontFormat, FontReadError> {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("ttf") => Ok(FontFormat::Ttf),
        Some("otf") => Ok(FontFormat::Otf),
        _ => Err(FontReadError::UnsupportedFormat {
            path: path.to_path_buf(),
        }),
    }
}

fn malformed(path: &Path, details: String) -> FontReadError {
    FontReadError::MalformedSource {
        format: format_for_path(path).unwrap_or(FontFormat::Ttf),
        path: path.to_path_buf(),
        details,
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    fn repository_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .to_path_buf()
    }

    fn fixture(name: &str) -> PathBuf {
        repository_root()
            .join("fixtures/fonts/mutatorsans")
            .join(name)
    }

    #[test]
    fn retained_binary_contours_detect_smooth_native_points() {
        let native = |x, y, kind| ContourPoint {
            x,
            y,
            kind,
            smooth: false,
            provenance: PointProvenance::Native {
                ttf_point_index: None,
            },
        };
        let mut contour = normalize_contour(
            vec![
                native(0.0, 0.0, GlyphPointKind::QuadraticControl),
                native(100.0, 0.0, GlyphPointKind::OnCurve),
                native(200.0, 0.0, GlyphPointKind::QuadraticControl),
                native(300.0, 100.0, GlyphPointKind::OnCurve),
            ],
            true,
        )
        .unwrap();

        detect_smooth_points(&mut contour);

        assert!(contour.points[0].smooth);
        assert!(!contour.points[2].smooth);
    }

    #[test]
    fn binary_directory_uses_gid_indexes_without_shift_identity() {
        let font = BinaryFont::open(&fixture("MutatorSans.ttf")).unwrap();
        assert!(!font.directory().glyphs.is_empty());
        assert_eq!(font.directory().glyphs[0].index, GlyphIndex::new(0));
        assert!(font.directory().units_per_em > 0.0);
    }

    #[test]
    fn binary_glyph_preserves_native_true_type_point_indexes() {
        let font = BinaryFont::open(&fixture("MutatorSans.ttf")).unwrap();
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
                ttf_point_index: Some(_)
            } | PointProvenance::Implied
        )));
        assert!(display.points.iter().any(|point| point.smooth));
        assert!(display.bounds.is_some());
    }

    #[test]
    fn binary_variable_glyph_changes_at_a_non_default_location() {
        let font =
            BinaryFont::open(&repository_root().join(
                "apps/desktop/src/renderer/src/assets/fonts/HostGrotesk-VariableFont_wght.ttf",
            ))
            .unwrap();
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
        let font_ref = FontRef::new(font.bytes()).unwrap();
        let skrifa_location = font.skrifa_location(&font_ref, &location).unwrap();
        let flattened = cff_geometry(
            Path::new("HostGrotesk-VariableFont_wght.ttf"),
            &font_ref,
            GlyphId::new(glyph.index.to_u32()),
            &skrifa_location,
            glyph.index,
        )
        .unwrap();
        let trusted =
            build_display_glyph(glyph.index, location, vec![flattened], changed.metrics).unwrap();

        assert_ne!(default.points, changed.points);
        assert_eq!(changed.bounds, trusted.bounds);
    }

    #[test]
    fn binary_composite_retains_a_shared_indexed_geometry_graph() {
        let font = BinaryFont::open(&fixture("MutatorSans.ttf")).unwrap();
        let glyph = font
            .directory()
            .glyphs
            .iter()
            .find(|glyph| glyph.name == "Aacute")
            .expect("fixture should contain Aacute");
        let display = font
            .read_glyph(glyph.index, font.directory().default_location())
            .unwrap();

        assert!(display.geometries.len() > 1);
        assert!(!display.components.is_empty());
        assert!(display
            .components
            .iter()
            .all(|component| component.geometry.to_usize() < display.geometries.len()));
    }

    #[test]
    fn binary_composite_bounds_match_skrifa_flattened_resolution() {
        let path = fixture("MutatorSans.ttf");
        let font = BinaryFont::open(&path).unwrap();
        let glyph = font
            .directory()
            .glyphs
            .iter()
            .find(|glyph| glyph.name == "Aacute")
            .expect("fixture should contain Aacute");
        let location = font.directory().default_location();
        let display = font.read_glyph(glyph.index, location).unwrap();
        let font_ref = FontRef::new(font.bytes()).unwrap();
        let skrifa_location = font.skrifa_location(&font_ref, location).unwrap();
        let flattened = cff_geometry(
            &path,
            &font_ref,
            GlyphId::new(glyph.index.to_u32()),
            &skrifa_location,
            glyph.index,
        )
        .unwrap();
        let trusted = build_display_glyph(
            glyph.index,
            location.clone(),
            vec![flattened],
            display.metrics,
        )
        .unwrap();

        assert_eq!(display.bounds, trusted.bounds);
    }

    #[test]
    fn binary_empty_glyph_is_explicit_geometry_without_bounds() {
        let font = BinaryFont::open(&fixture("MutatorSans.ttf")).unwrap();
        let glyph = font
            .directory()
            .glyphs
            .iter()
            .find(|glyph| glyph.name == "space")
            .expect("fixture should contain space");
        let display = font
            .read_glyph(glyph.index, font.directory().default_location())
            .unwrap();

        assert_eq!(display.geometries.len(), 1);
        assert!(display.contours.is_empty());
        assert!(display.components.is_empty());
        assert!(display.bounds.is_none());
        assert!(display.metrics.x_advance > 0.0);
    }

    #[test]
    fn binary_cff_glyph_uses_unindexed_native_points() {
        let font = BinaryFont::open(&fixture("MutatorSans.otf")).unwrap();
        let glyph = font
            .directory()
            .glyphs
            .iter()
            .find(|glyph| glyph.name == "S")
            .expect("fixture should contain S");
        let display = font
            .read_glyph(glyph.index, font.directory().default_location())
            .unwrap();

        assert!(!display.points.is_empty());
        assert!(display.points.iter().all(|point| matches!(
            point.provenance,
            PointProvenance::Native {
                ttf_point_index: None
            }
        )));
    }
}
