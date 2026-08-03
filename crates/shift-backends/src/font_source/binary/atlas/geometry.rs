use std::collections::{BTreeMap, HashMap};
use std::path::Path;

use shift_slug::{Curve, Point};
use skrifa::raw::tables::glyf::{
    Anchor as GlyfAnchor, CompositeGlyphFlags, Glyf, Glyph as GlyfGlyph, PointFlags,
};
use skrifa::raw::tables::gvar::Gvar;
use skrifa::raw::tables::loca::Loca;
use skrifa::raw::types::{GlyphId, Point as RawPoint};

use crate::font_source::atlas::{RegionRegistry, SourceAtlasError};
use crate::font_source::{AffineTransform, FontReadError, GlyphIndex, GlyphPointKind};

use super::super::{approximate_hypot, component_transform, infer_tuple_deltas, malformed};
use super::tuple_region;

mod curves;
use curves::{curves_from_geometry, normalize_contour};

pub(super) struct VariableCurves {
    pub(super) base: Vec<Curve>,
    pub(super) line_flags: Vec<bool>,
    pub(super) sources: BTreeMap<u32, Vec<Curve>>,
}

pub(super) fn resolve_variable_curves(
    path: &Path,
    loca: Loca<'_>,
    glyf: Glyf<'_>,
    gvar: Option<Gvar<'_>>,
    registry: &mut RegionRegistry,
    root: GlyphIndex,
) -> Result<VariableCurves, SourceAtlasError> {
    let geometry = ExpressionResolver::new(path, loca, glyf, gvar, registry).resolve(root)?;
    curves_from_geometry(&geometry)
}

#[derive(Clone, Debug, Default)]
struct VariablePosition {
    x: f64,
    y: f64,
    deltas: BTreeMap<u32, (f64, f64)>,
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

    fn at(&self, weight: Option<u32>) -> Point {
        let delta = weight
            .and_then(|weight| self.deltas.get(&weight))
            .copied()
            .unwrap_or_default();
        Point::new((self.x + delta.0) as f32, (self.y + delta.1) as f32)
    }

    fn transformed(&self, transform: AffineTransform) -> Self {
        let mut transformed = Self::new(
            transform.xx * self.x + transform.xy * self.y,
            transform.yx * self.x + transform.yy * self.y,
        );
        for (weight, (x, y)) in &self.deltas {
            transformed.add_delta(
                *weight,
                (
                    transform.xx * x + transform.xy * y,
                    transform.yx * x + transform.yy * y,
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
struct VariablePoint {
    position: VariablePosition,
    kind: GlyphPointKind,
}

impl VariablePoint {
    fn midpoint(first: &Self, second: &Self) -> Self {
        Self {
            position: VariablePosition::midpoint(&first.position, &second.position),
            kind: GlyphPointKind::OnCurve,
        }
    }
}

#[derive(Clone, Debug)]
struct VariableContour {
    points: Vec<VariablePoint>,
}

#[derive(Clone, Debug, Default)]
struct VariableGeometry {
    contours: Vec<VariableContour>,
    attachment_points: Vec<VariablePosition>,
}

struct ExpressionResolver<'a, 'registry> {
    path: &'a Path,
    loca: Loca<'a>,
    glyf: Glyf<'a>,
    gvar: Option<Gvar<'a>>,
    registry: &'registry mut RegionRegistry,
    indices: HashMap<GlyphIndex, usize>,
    states: Vec<u8>,
    geometries: Vec<Option<VariableGeometry>>,
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

    fn resolve(mut self, root: GlyphIndex) -> Result<VariableGeometry, SourceAtlasError> {
        let index = self.resolve_geometry(root)?;
        self.geometries[index]
            .take()
            .ok_or_else(|| invalid_geometry("binary atlas root geometry is unavailable"))
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
        let geometry = match raw {
            None => VariableGeometry::default(),
            Some(GlyfGlyph::Simple(simple)) => self.resolve_simple(raw_id, &simple)?,
            Some(GlyfGlyph::Composite(composite)) => {
                let components = composite.components().collect::<Vec<_>>();
                let component_deltas = self.composite_deltas(raw_id, components.len())?;
                let mut geometry = VariableGeometry::default();

                for (component_index, component) in components.into_iter().enumerate() {
                    let child_glyph = GlyphIndex::new(component.glyph.to_u32());
                    let child_index = self.resolve_geometry(child_glyph)?;
                    let child = self.geometries[child_index]
                        .as_ref()
                        .ok_or_else(|| invalid_geometry("resolved component is unavailable"))?
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
                                x *= approximate_hypot(transform.xx, transform.yx);
                                y *= approximate_hypot(transform.yy, transform.xy);
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
                                    })
                                    .collect(),
                            }
                        }));
                }
                geometry
            }
        };
        self.geometries[index] = Some(geometry);
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
            .map(|(point, flags)| VariablePoint {
                position: VariablePosition::new(f64::from(point.x), f64::from(point.y)),
                kind: if flags.is_on_curve() {
                    GlyphPointKind::OnCurve
                } else {
                    GlyphPointKind::QuadraticControl
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

fn invalid_geometry(details: &str) -> SourceAtlasError {
    FontReadError::InvalidDisplayGlyph {
        details: details.into(),
    }
    .into()
}
