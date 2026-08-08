use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;

use shift_slug::{Curve, Point};
use skrifa::raw::tables::glyf::{
    Anchor as GlyfAnchor, CompositeGlyphFlags, Glyf, Glyph as GlyfGlyph, PointFlags,
};
use skrifa::raw::tables::gvar::Gvar;
use skrifa::raw::tables::loca::Loca;
use skrifa::raw::types::{GlyphId, Point as RawPoint};

use crate::font_source::atlas::{RegionRegistry, SourceAtlasError};
use crate::font_source::{
    inferred_smooth_point_indices, AffineTransform, FontReadError, GlyphIndex, GlyphPointKind,
    PointProvenance, TrueTypePointIndex,
};

use super::inputs::tuple_region;
use super::variable::{approximate_hypot, component_transform, infer_tuple_deltas};
use crate::font_source::malformed;

pub(super) struct VariableCurves {
    pub(super) base: Vec<Curve>,
    pub(super) line_flags: Vec<bool>,
    pub(super) sources: BTreeMap<u32, Vec<Curve>>,
}

pub(super) fn static_curves(
    contours: Vec<VariableContour>,
) -> Result<VariableCurves, SourceAtlasError> {
    curves_from_geometry(
        &VariableGeometry {
            contours,
            attachment_points: Vec::new(),
        },
        true,
    )
}

pub(super) fn resolve_variable_curves(
    path: &Path,
    loca: Loca<'_>,
    glyf: Glyf<'_>,
    gvar: Option<Gvar<'_>>,
    registry: &mut RegionRegistry,
    root: GlyphIndex,
) -> Result<VariableCurves, SourceAtlasError> {
    let glyphs = ExpressionResolver::new(path, loca, glyf, gvar, registry).resolve(root)?;
    let geometry = glyphs
        .first()
        .ok_or_else(|| invalid_geometry("binary atlas root geometry is unavailable"))?;
    curves_from_geometry(&geometry.geometry, false)
}

fn curves_from_geometry(
    geometry: &VariableGeometry,
    allow_cubic: bool,
) -> Result<VariableCurves, SourceAtlasError> {
    let weights = geometry
        .contours
        .iter()
        .flat_map(|contour| &contour.points)
        .flat_map(|point| point.position.deltas.keys().copied())
        .collect::<BTreeSet<_>>();
    let mut base = Vec::new();
    let mut line_flags = Vec::new();
    let mut sources = weights
        .iter()
        .map(|weight| (*weight, Vec::new()))
        .collect::<BTreeMap<_, _>>();

    for contour in &geometry.contours {
        let points = &contour.points;
        if points.is_empty() || points[0].kind != GlyphPointKind::OnCurve {
            return Err(invalid_geometry(
                "normalized binary atlas contour does not begin on-curve",
            ));
        }
        let mut current = &points[0].position;
        let mut cursor = 1;
        while cursor <= points.len() {
            let point = &points[cursor % points.len()];
            match point.kind {
                GlyphPointKind::OnCurve => {
                    push_line(
                        &mut base,
                        &mut line_flags,
                        &mut sources,
                        current,
                        &point.position,
                    );
                    current = &point.position;
                    cursor += 1;
                }
                GlyphPointKind::QuadraticControl => {
                    if cursor + 1 > points.len() {
                        return Err(invalid_geometry(
                            "quadratic control is missing its endpoint",
                        ));
                    }
                    let endpoint = &points[(cursor + 1) % points.len()];
                    if endpoint.kind != GlyphPointKind::OnCurve {
                        return Err(invalid_geometry(
                            "quadratic control is not followed by an endpoint",
                        ));
                    }
                    push_quadratic(
                        &mut base,
                        &mut line_flags,
                        &mut sources,
                        current,
                        &point.position,
                        &endpoint.position,
                    );
                    current = &endpoint.position;
                    cursor += 2;
                }
                GlyphPointKind::CubicControl => {
                    if !allow_cubic {
                        return Err(SourceAtlasError::UnsupportedBinary {
                            details: "cubic glyf contours are not supported",
                        });
                    }
                    if cursor + 2 > points.len() {
                        return Err(invalid_geometry(
                            "cubic controls are missing their endpoint",
                        ));
                    }
                    let second = &points[cursor + 1];
                    let endpoint = &points[(cursor + 2) % points.len()];
                    if second.kind != GlyphPointKind::CubicControl
                        || endpoint.kind != GlyphPointKind::OnCurve
                    {
                        return Err(invalid_geometry(
                            "cubic controls are not followed by an endpoint",
                        ));
                    }
                    push_cubic(
                        &mut base,
                        &mut line_flags,
                        &mut sources,
                        current,
                        &point.position,
                        &second.position,
                        &endpoint.position,
                    );
                    current = &endpoint.position;
                    cursor += 3;
                }
            }
        }
    }

    Ok(VariableCurves {
        base,
        line_flags,
        sources,
    })
}

fn push_line(
    base: &mut Vec<Curve>,
    line_flags: &mut Vec<bool>,
    sources: &mut BTreeMap<u32, Vec<Curve>>,
    start: &VariablePosition,
    end: &VariablePosition,
) {
    base.push(Curve::from_line(start.point(None), end.point(None)));
    line_flags.push(true);
    for (weight, curves) in sources {
        curves.push(Curve::from_line(
            start.point(Some(*weight)),
            end.point(Some(*weight)),
        ));
    }
}

fn push_quadratic(
    base: &mut Vec<Curve>,
    line_flags: &mut Vec<bool>,
    sources: &mut BTreeMap<u32, Vec<Curve>>,
    start: &VariablePosition,
    control: &VariablePosition,
    end: &VariablePosition,
) {
    base.push(Curve {
        p0: start.point(None),
        p1: control.point(None),
        p2: end.point(None),
    });
    line_flags.push(false);
    for (weight, curves) in sources {
        curves.push(Curve {
            p0: start.point(Some(*weight)),
            p1: control.point(Some(*weight)),
            p2: end.point(Some(*weight)),
        });
    }
}

fn push_cubic(
    base: &mut Vec<Curve>,
    line_flags: &mut Vec<bool>,
    sources: &mut BTreeMap<u32, Vec<Curve>>,
    start: &VariablePosition,
    first: &VariablePosition,
    second: &VariablePosition,
    end: &VariablePosition,
) {
    let base_points = [
        start.point(None),
        first.point(None),
        second.point(None),
        end.point(None),
    ];
    let subdivisions = sources.keys().fold(
        Curve::cubic_subdivision_count(
            base_points[0],
            base_points[1],
            base_points[2],
            base_points[3],
        ),
        |count, weight| {
            count.max(Curve::cubic_subdivision_count(
                start.point(Some(*weight)),
                first.point(Some(*weight)),
                second.point(Some(*weight)),
                end.point(Some(*weight)),
            ))
        },
    );
    let base_cubics = Curve::from_cubic_with_subdivisions(
        base_points[0],
        base_points[1],
        base_points[2],
        base_points[3],
        subdivisions,
    );
    line_flags.extend(std::iter::repeat_n(false, base_cubics.len()));
    base.extend(base_cubics);
    for (weight, curves) in sources {
        curves.extend(Curve::from_cubic_with_subdivisions(
            start.point(Some(*weight)),
            first.point(Some(*weight)),
            second.point(Some(*weight)),
            end.point(Some(*weight)),
            subdivisions,
        ));
    }
}

fn normalize_contour(points: Vec<VariablePoint>) -> Result<VariableContour, SourceAtlasError> {
    if points.is_empty() {
        return Err(invalid_geometry("binary atlas contour has no points"));
    }
    let first_on = points
        .iter()
        .position(|point| point.kind == GlyphPointKind::OnCurve);
    let (start, indexes, all_off_curve) = match first_on {
        Some(start) => (
            points[start].clone(),
            (1..points.len())
                .map(|offset| (start + offset) % points.len())
                .collect::<Vec<_>>(),
            false,
        ),
        None => (
            VariablePoint::midpoint(points.last().expect("contour is non-empty"), &points[0]),
            (0..points.len()).collect(),
            true,
        ),
    };
    let mut normalized = Vec::with_capacity(points.len() * 2);
    normalized.push(start);
    for (position, index) in indexes.iter().copied().enumerate() {
        let point = &points[index];
        normalized.push(point.clone());
        let next = (index + 1) % points.len();
        let closes_all_off_curve = all_off_curve && position + 1 == indexes.len();
        if point.kind == GlyphPointKind::QuadraticControl
            && !closes_all_off_curve
            && points[next].kind == GlyphPointKind::QuadraticControl
        {
            normalized.push(VariablePoint::midpoint(point, &points[next]));
        }
    }
    for index in inferred_smooth_point_indices(
        &normalized,
        true,
        |point| (point.position.x, point.position.y),
        |point| point.kind == GlyphPointKind::OnCurve,
    ) {
        normalized[index].smooth = true;
    }
    Ok(VariableContour { points: normalized })
}

pub(super) fn resolve_variable_glyphs(
    path: &Path,
    loca: Loca<'_>,
    glyf: Glyf<'_>,
    gvar: Option<Gvar<'_>>,
    registry: &mut RegionRegistry,
    root: GlyphIndex,
) -> Result<Vec<VariableGlyph>, SourceAtlasError> {
    ExpressionResolver::new(path, loca, glyf, gvar, registry).resolve(root)
}

#[derive(Clone, Debug, Default)]
pub(super) struct VariablePosition {
    pub(super) x: f64,
    pub(super) y: f64,
    pub(super) deltas: BTreeMap<u32, (f64, f64)>,
}

impl VariablePosition {
    fn new(x: f64, y: f64) -> Self {
        Self {
            x,
            y,
            deltas: BTreeMap::new(),
        }
    }

    fn add_delta(&mut self, weight: u32, delta: (f64, f64)) {
        let value = self.deltas.entry(weight).or_default();
        value.0 += delta.0;
        value.1 += delta.1;
    }

    fn point(&self, weight: Option<u32>) -> Point {
        let delta = weight
            .and_then(|weight| self.deltas.get(&weight))
            .copied()
            .unwrap_or_default();
        Point::new((self.x + delta.0) as f32, (self.y + delta.1) as f32)
    }

    fn transformed(&self, transform: AffineTransform) -> Self {
        let mut transformed = Self::new(
            transform.xx * self.x + transform.yx * self.y,
            transform.xy * self.x + transform.yy * self.y,
        );
        for (weight, (x, y)) in &self.deltas {
            transformed.add_delta(
                *weight,
                (
                    transform.xx * x + transform.yx * y,
                    transform.xy * x + transform.yy * y,
                ),
            );
        }
        transformed
    }

    fn add_assign(&mut self, other: &Self) {
        self.x += other.x;
        self.y += other.y;
        for (weight, delta) in &other.deltas {
            self.add_delta(*weight, *delta);
        }
    }

    fn subtract(first: &Self, second: &Self) -> Self {
        let mut result = Self::new(first.x - second.x, first.y - second.y);
        for (weight, delta) in &first.deltas {
            result.add_delta(*weight, *delta);
        }
        for (weight, (x, y)) in &second.deltas {
            result.add_delta(*weight, (-x, -y));
        }
        result
    }

    fn midpoint(first: &Self, second: &Self) -> Self {
        let mut result = Self::new((first.x + second.x) * 0.5, (first.y + second.y) * 0.5);
        for (weight, (x, y)) in &first.deltas {
            result.add_delta(*weight, (x * 0.5, y * 0.5));
        }
        for (weight, (x, y)) in &second.deltas {
            result.add_delta(*weight, (x * 0.5, y * 0.5));
        }
        result
    }
}

#[derive(Clone, Debug)]
pub(super) struct VariablePoint {
    pub(super) position: VariablePosition,
    pub(super) kind: GlyphPointKind,
    pub(super) smooth: bool,
    pub(super) provenance: PointProvenance,
}

impl VariablePoint {
    pub(super) fn midpoint(first: &Self, second: &Self) -> Self {
        Self {
            position: VariablePosition::midpoint(&first.position, &second.position),
            kind: GlyphPointKind::OnCurve,
            smooth: false,
            provenance: PointProvenance::Implied,
        }
    }
}

#[derive(Clone, Debug)]
pub(super) struct VariableContour {
    pub(super) points: Vec<VariablePoint>,
}

#[derive(Clone, Debug, Default)]
pub(super) struct VariableGeometry {
    pub(super) contours: Vec<VariableContour>,
    pub(super) attachment_points: Vec<VariablePosition>,
}

#[derive(Clone, Debug)]
pub(super) struct VariableComponent {
    pub(super) glyph: GlyphIndex,
    pub(super) transform: AffineTransform,
    pub(super) translation: VariablePosition,
}

#[derive(Clone, Debug)]
pub(super) struct VariableGlyph {
    pub(super) glyph: GlyphIndex,
    pub(super) contours: Vec<VariableContour>,
    pub(super) components: Vec<VariableComponent>,
    pub(super) geometry: VariableGeometry,
}

struct ExpressionResolver<'a, 'registry> {
    path: &'a Path,
    loca: Loca<'a>,
    glyf: Glyf<'a>,
    gvar: Option<Gvar<'a>>,
    registry: &'registry mut RegionRegistry,
    indices: HashMap<GlyphIndex, usize>,
    states: Vec<u8>,
    geometries: Vec<Option<VariableGlyph>>,
}

impl<'a, 'registry> ExpressionResolver<'a, 'registry> {
    fn new(
        path: &'a Path,
        loca: Loca<'a>,
        glyf: Glyf<'a>,
        gvar: Option<Gvar<'a>>,
        registry: &'registry mut RegionRegistry,
    ) -> Self {
        Self {
            path,
            loca,
            glyf,
            gvar,
            registry,
            indices: HashMap::new(),
            states: Vec::new(),
            geometries: Vec::new(),
        }
    }

    fn resolve(mut self, root: GlyphIndex) -> Result<Vec<VariableGlyph>, SourceAtlasError> {
        let root_index = self.resolve_geometry(root)?;
        let root_glyph = self.geometries[root_index]
            .take()
            .ok_or_else(|| invalid_geometry("binary atlas root geometry is unavailable"))?;
        let mut glyphs = vec![root_glyph];
        glyphs.extend(self.geometries.into_iter().flatten());
        Ok(glyphs)
    }

    fn resolve_geometry(&mut self, glyph: GlyphIndex) -> Result<usize, SourceAtlasError> {
        if let Some(index) = self.indices.get(&glyph).copied() {
            return match self.states[index] {
                1 => Err(FontReadError::ComponentCycle { glyph }.into()),
                2 => Ok(index),
                _ => Err(invalid_geometry(
                    "binary atlas geometry has an invalid resolution state",
                )),
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
        let glyph_record = match raw {
            None => VariableGlyph {
                glyph,
                contours: Vec::new(),
                components: Vec::new(),
                geometry: VariableGeometry::default(),
            },
            Some(GlyfGlyph::Simple(simple)) => {
                let geometry = self.resolve_simple(raw_id, &simple)?;
                VariableGlyph {
                    glyph,
                    contours: geometry.contours.clone(),
                    components: Vec::new(),
                    geometry,
                }
            }
            Some(GlyfGlyph::Composite(composite)) => {
                let components = composite.components().collect::<Vec<_>>();
                let component_deltas = self.composite_deltas(raw_id, components.len())?;
                let mut geometry = VariableGeometry::default();
                let mut projected_components = Vec::with_capacity(components.len());

                for (component_index, component) in components.into_iter().enumerate() {
                    let child_glyph = GlyphIndex::new(component.glyph.to_u32());
                    let child_index = self.resolve_geometry(child_glyph)?;
                    let child = self.geometries[child_index]
                        .as_ref()
                        .ok_or_else(|| invalid_geometry("resolved component is unavailable"))?
                        .geometry
                        .clone();
                    let transform = component_transform(&component);
                    let translation = match component.anchor {
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
                                x *= approximate_hypot(transform.xx, transform.xy);
                                y *= approximate_hypot(transform.yy, transform.yx);
                            }
                            let mut translation = VariablePosition::new(x, y);
                            if let Some(deltas) = component_deltas.get(component_index) {
                                translation.add_assign(deltas);
                            }
                            translation
                        }
                        GlyfAnchor::Point { base, component } => {
                            let base =
                                geometry
                                    .attachment_points
                                    .get(base as usize)
                                    .ok_or_else(|| {
                                        malformed(
                                            self.path,
                                            format!(
                                            "invalid base anchor point {base} in glyph {raw_id}"
                                        ),
                                        )
                                    })?;
                            let component = child
                                .attachment_points
                                .get(component as usize)
                                .ok_or_else(|| {
                                    malformed(
                                        self.path,
                                        format!(
                                            "invalid component anchor point {component} in glyph {raw_id}"
                                        ),
                                    )
                                })?
                                .transformed(transform);
                            VariablePosition::subtract(base, &component)
                        }
                    };

                    projected_components.push(VariableComponent {
                        glyph: child_glyph,
                        transform,
                        translation: translation.clone(),
                    });
                    geometry.attachment_points.extend(
                        child
                            .attachment_points
                            .iter()
                            .map(|point| transform_and_translate(point, transform, &translation)),
                    );
                    geometry
                        .contours
                        .extend(child.contours.iter().map(|contour| {
                            VariableContour {
                                points: contour
                                    .points
                                    .iter()
                                    .map(|point| VariablePoint {
                                        position: transform_and_translate(
                                            &point.position,
                                            transform,
                                            &translation,
                                        ),
                                        kind: point.kind,
                                        smooth: point.smooth,
                                        provenance: point.provenance,
                                    })
                                    .collect(),
                            }
                        }));
                }
                VariableGlyph {
                    glyph,
                    contours: Vec::new(),
                    components: projected_components,
                    geometry,
                }
            }
        };
        self.geometries[index] = Some(glyph_record);
        self.states[index] = 2;
        Ok(index)
    }

    fn resolve_simple(
        &mut self,
        glyph: GlyphId,
        simple: &skrifa::raw::tables::glyf::SimpleGlyph<'_>,
    ) -> Result<VariableGeometry, SourceAtlasError> {
        let point_count = simple.num_points();
        let mut raw_points = vec![RawPoint::<i32>::default(); point_count];
        let mut flags = vec![PointFlags::default(); point_count];
        simple
            .read_points_fast(&mut raw_points, &mut flags)
            .map_err(|error| {
                malformed(
                    self.path,
                    format!("failed to read points for glyph {glyph}: {error}"),
                )
            })?;
        if flags.iter().any(|flags| flags.is_off_curve_cubic()) {
            return Err(SourceAtlasError::UnsupportedBinary {
                details: "cubic glyf contours are not supported by the first direct atlas slice",
            });
        }
        let contour_ends = simple
            .end_pts_of_contours()
            .iter()
            .map(|end| end.get())
            .collect::<Vec<_>>();
        let mut points = raw_points
            .iter()
            .zip(&flags)
            .enumerate()
            .map(|(index, (point, flags))| VariablePoint {
                position: VariablePosition::new(f64::from(point.x), f64::from(point.y)),
                kind: if flags.is_on_curve() {
                    GlyphPointKind::OnCurve
                } else {
                    GlyphPointKind::QuadraticControl
                },
                smooth: false,
                provenance: PointProvenance::Native {
                    ttf_point_index: Some(TrueTypePointIndex::new(index as u32)),
                },
            })
            .collect::<Vec<_>>();

        if let Some(gvar) = &self.gvar {
            let variation = gvar.glyph_variation_data(glyph).map_err(|error| {
                malformed(
                    self.path,
                    format!("failed to read variation data for glyph {glyph}: {error}"),
                )
            })?;
            if let Some(variation) = variation {
                for tuple in variation.tuples() {
                    let mut deltas = vec![None; points.len()];
                    for delta in tuple.deltas() {
                        let position = delta.position as usize;
                        if position < deltas.len() {
                            deltas[position] =
                                Some((f64::from(delta.x_delta), f64::from(delta.y_delta)));
                        }
                    }
                    infer_tuple_deltas(&raw_points, &contour_ends, &mut deltas)?;
                    if !deltas
                        .iter()
                        .flatten()
                        .any(|delta| delta.0 != 0.0 || delta.1 != 0.0)
                    {
                        continue;
                    }
                    let weight = self.registry.weight_index(tuple_region(&tuple))?;
                    for (point, delta) in points.iter_mut().zip(deltas) {
                        if let Some(delta) = delta {
                            point.position.add_delta(weight, delta);
                        }
                    }
                }
            }
        }

        let mut contours = Vec::with_capacity(contour_ends.len());
        let mut start = 0;
        for end in contour_ends {
            let end = end as usize;
            if end < start || end >= points.len() {
                return Err(malformed(
                    self.path,
                    format!("invalid contour endpoint {end} in glyph {glyph}"),
                )
                .into());
            }
            contours.push(normalize_contour(points[start..=end].to_vec())?);
            start = end + 1;
        }

        Ok(VariableGeometry {
            contours,
            attachment_points: points.into_iter().map(|point| point.position).collect(),
        })
    }

    fn composite_deltas(
        &mut self,
        glyph: GlyphId,
        component_count: usize,
    ) -> Result<Vec<VariablePosition>, SourceAtlasError> {
        let mut deltas = vec![VariablePosition::default(); component_count];
        let Some(gvar) = &self.gvar else {
            return Ok(deltas);
        };
        let Some(variation) = gvar.glyph_variation_data(glyph).map_err(|error| {
            malformed(
                self.path,
                format!("failed to read variation data for glyph {glyph}: {error}"),
            )
        })?
        else {
            return Ok(deltas);
        };
        for tuple in variation.tuples() {
            let tuple_deltas = tuple
                .deltas()
                .filter(|delta| (delta.position as usize) < component_count)
                .collect::<Vec<_>>();
            if !tuple_deltas
                .iter()
                .any(|delta| delta.x_delta != 0 || delta.y_delta != 0)
            {
                continue;
            }
            let weight = self.registry.weight_index(tuple_region(&tuple))?;
            for delta in tuple_deltas {
                deltas[delta.position as usize]
                    .add_delta(weight, (f64::from(delta.x_delta), f64::from(delta.y_delta)));
            }
        }
        Ok(deltas)
    }
}

fn transform_and_translate(
    point: &VariablePosition,
    transform: AffineTransform,
    translation: &VariablePosition,
) -> VariablePosition {
    let mut point = point.transformed(transform);
    point.add_assign(translation);
    point
}

pub(super) fn invalid_geometry(details: &str) -> SourceAtlasError {
    FontReadError::InvalidProjection {
        details: details.into(),
    }
    .into()
}
