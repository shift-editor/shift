//! Checks that a glyph's masters interpolate into the shapes between them.
//!
//! Structural compatibility is [`GlyphLayer::match_with`]'s job. These checks
//! go further: two layers can have matching structure and still interpolate
//! badly, because a contour starts at a different point, runs the other way,
//! or sits in a different position in the list.

use kurbo::{BezPath, Shape};

use crate::{
    Contour, CoreResult, Font, Glyph, GlyphId, GlyphLayer, LayerDifference, PointType, Source,
};

use super::polygon::Polygon;
use super::{Check, Finding, designspace::number};

/// Tolerances for the geometric checks.
#[derive(Clone, Debug, PartialEq)]
pub struct OutlineThresholds {
    /// A rotation or reordering is reported when it costs at most this
    /// fraction of the authored order's cost.
    pub improvement: f64,
}

impl Default for OutlineThresholds {
    fn default() -> Self {
        Self { improvement: 0.5 }
    }
}

/// Positions between two masters where shapes are sampled.
const SAMPLES: [f64; 3] = [0.25, 0.5, 0.75];

pub(super) fn check(
    font: &Font,
    glyph_id: &GlyphId,
    thresholds: &OutlineThresholds,
) -> CoreResult<Vec<Finding>> {
    let glyph = font.require_glyph(glyph_id)?;
    let mut findings = Vec::new();
    if !font.is_variable() {
        return Ok(findings);
    }

    let layers = master_layers(font, glyph);
    if layers.is_empty() {
        return Ok(findings);
    }

    let default = font
        .default_source()
        .filter(|source| source.is_master())
        .map(Source::id);
    let reference = match &default {
        Some(default) => layers.iter().find(|(source, _)| source.id() == *default),
        None => None,
    };
    let Some((reference_source, reference)) = reference.copied() else {
        if default.is_some() && layers.len() > 1 {
            findings.push(Finding::glyph(
                Check::MissingDefaultLayer,
                glyph.id(),
                format!(
                    "'{}' is drawn in {} masters but not in the default master",
                    glyph.name(),
                    layers.len()
                ),
            ));
        }
        return Ok(findings);
    };

    let mut compatible = 0;
    for (source, layer) in &layers {
        if source.id() == reference_source.id() {
            continue;
        }

        let layer_match = reference.match_with(layer);
        if let Some(difference) = layer_match.differences().first() {
            if decomposes_alike(font, glyph, reference_source, source) {
                findings.push(
                    Finding::glyph(
                        Check::MixedComponents,
                        glyph.id(),
                        format!(
                            "'{}' in '{}' uses components differently from '{}' ({}); compilers decompose it to match, but Shift's preview leaves this master out",
                            glyph.name(),
                            source.name(),
                            reference_source.name(),
                            describe(difference)
                        ),
                    )
                    .in_source(source.id()),
                );
                continue;
            }
            findings.push(
                Finding::glyph(
                    Check::IncompatibleMaster,
                    glyph.id(),
                    format!(
                        "'{}' in '{}' doesn't match '{}': {}",
                        glyph.name(),
                        source.name(),
                        reference_source.name(),
                        describe(difference)
                    ),
                )
                .in_source(source.id()),
            );
            continue;
        }

        compatible += 1;
        let pair = Pair {
            glyph,
            reference_source,
            reference,
            source,
            layer,
            thresholds,
        };
        findings.extend(pair.findings());
    }

    if compatible > 0 && font.glyph_interpolation(glyph_id)?.is_none() {
        findings.push(Finding::glyph(
            Check::NotInterpolatable,
            glyph.id(),
            format!(
                "'{}' has compatible layers in {} masters but can't be interpolated from them",
                glyph.name(),
                compatible + 1
            ),
        ));
    }

    Ok(findings)
}

/// Whether `glyph` decomposes to outlines of the same structure in two
/// masters, as a compiler sees it once components are flattened.
fn decomposes_alike(font: &Font, glyph: &Glyph, a: &Source, b: &Source) -> bool {
    let outline = |source: &Source| {
        font.projection(source.location())
            .glyph(&glyph.id())
            .ok()
            .flatten()
            .map(|resolved| {
                resolved
                    .contours()
                    .iter()
                    .map(|contour| {
                        let kinds = contour
                            .points
                            .iter()
                            .map(crate::Point::point_type)
                            .collect::<Vec<_>>();
                        (contour.closed, kinds)
                    })
                    .collect::<Vec<_>>()
            })
    };
    matches!((outline(a), outline(b)), (Some(a), Some(b)) if !a.is_empty() && a == b)
}

/// Returns one layer per master that draws `glyph`, in source order.
fn master_layers<'a>(font: &'a Font, glyph: &'a Glyph) -> Vec<(&'a Source, &'a GlyphLayer)> {
    font.masters()
        .filter_map(|source| Some((source, glyph.layer_for_source(&source.id())?)))
        .collect()
}

fn describe(difference: &LayerDifference) -> String {
    match difference {
        LayerDifference::ContourCount { reference, source } => {
            format!("{source} contours instead of {reference}")
        }
        LayerDifference::ContourClosed {
            contour, reference, ..
        } => {
            let state = if *reference { "open" } else { "closed" };
            format!("contour {} is {state}", contour + 1)
        }
        LayerDifference::PointCount {
            contour,
            reference,
            source,
        } => format!(
            "contour {} has {source} points instead of {reference}",
            contour + 1
        ),
        LayerDifference::PointType { contour, point, .. } => format!(
            "point {} of contour {} is a different kind of point",
            point + 1,
            contour + 1
        ),
        LayerDifference::AnchorCount { reference, source } => {
            format!("{source} anchors instead of {reference}")
        }
        LayerDifference::AnchorSequence { .. } => {
            "the anchors are named or ordered differently".into()
        }
        LayerDifference::ComponentSequence { .. } => {
            "the components are different or in a different order".into()
        }
    }
}

/// One master's layer compared with the reference layer, after their
/// structures matched.
struct Pair<'a> {
    glyph: &'a Glyph,
    reference_source: &'a Source,
    reference: &'a GlyphLayer,
    source: &'a Source,
    layer: &'a GlyphLayer,
    thresholds: &'a OutlineThresholds,
}

impl Pair<'_> {
    fn findings(&self) -> Vec<Finding> {
        let reference = self.reference.contours_iter().collect::<Vec<_>>();
        let target = self.layer.contours_iter().collect::<Vec<_>>();

        let swaps = self.swapped_contours(&reference, &target);
        let swapped = swaps.iter().flat_map(|&(i, j)| [i, j]).collect::<Vec<_>>();
        let order = swaps.iter().map(|&(i, j)| {
            self.finding(
                Check::WrongContourOrder,
                i,
                &format!(
                    "and contour {} are in each other's place in '{}'",
                    j + 1,
                    self.source.name()
                ),
            )
        });
        let contours = reference
            .iter()
            .zip(&target)
            .enumerate()
            .filter(|(index, (a, _))| !swapped.contains(index) && a.is_closed())
            .filter_map(|(index, (a, b))| self.contour_finding(index, a, b));
        order.chain(contours).collect()
    }

    /// The first problem with one contour pair that keeps its place: a
    /// reversed direction, a moved start point, or turning inside out.
    fn contour_finding(&self, index: usize, a: &Contour, b: &Contour) -> Option<Finding> {
        let (area_a, area_b) = (signed_area(a), signed_area(b));
        let collapsed = area_a.abs().min(area_b.abs()) < area_a.abs().max(area_b.abs()) * 0.01;
        if collapsed {
            return None;
        }
        if area_a * area_b < 0.0 {
            return Some(self.finding(
                Check::WrongContourDirection,
                index,
                &format!("runs the other way in '{}'", self.source.name()),
            ));
        }
        if let Some(shift) = self.start_point(a, b) {
            return Some(self.finding(
                Check::WrongStartPoint,
                index,
                &format!(
                    "starts {shift} point{} later in '{}' than in '{}'",
                    if shift == 1 { "" } else { "s" },
                    self.source.name(),
                    self.reference_source.name()
                ),
            ));
        }
        let t = inside_out(a, b, area_a)?;
        Some(self.finding(
            Check::ContourInsideOut,
            index,
            &format!(
                "turns inside out {}% of the way to '{}'",
                number(t * 100.0),
                self.source.name()
            ),
        ))
    }

    fn finding(&self, check: Check, contour: usize, what: &str) -> Finding {
        Finding::glyph(
            check,
            self.glyph.id(),
            format!("'{}' contour {} {what}", self.glyph.name(), contour + 1),
        )
        .in_source(self.source.id())
        .in_contour(contour)
    }

    /// Pairs of contours that sit in each other's place.
    fn swapped_contours(&self, reference: &[&Contour], target: &[&Contour]) -> Vec<(usize, usize)> {
        let mut swaps = Vec::new();
        let mut swapped = Vec::new();
        if reference.len() < 2 {
            return swaps;
        }

        let a = descriptors(reference);
        let b = descriptors(target);
        let cost = |i: usize, j: usize| a[i].distance(&b[j]);
        for i in 0..reference.len() {
            for j in i + 1..reference.len() {
                if swapped.contains(&i) || swapped.contains(&j) {
                    continue;
                }
                if !same_structure(reference[i], reference[j]) {
                    continue;
                }

                let kept = cost(i, i) + cost(j, j);
                let exchanged = cost(i, j) + cost(j, i);
                if exchanged >= kept * self.thresholds.improvement {
                    continue;
                }

                swapped.extend([i, j]);
                swaps.push((i, j));
            }
        }
        swaps
    }

    /// Returns how many points later `b` starts than `a`, when starting
    /// elsewhere would match `a` much better.
    fn start_point(&self, a: &Contour, b: &Contour) -> Option<usize> {
        let count = a.points().len();
        if count < 3 {
            return None;
        }

        let a_contour = a;
        let a = normalized(a);
        let b_points = normalized(b);
        let types = b
            .points()
            .iter()
            .map(crate::Point::point_type)
            .collect::<Vec<_>>();
        let a_types = a.iter().map(|p| p.2).collect::<Vec<_>>();
        let cost = |shift: usize| {
            (0..count)
                .map(|i| {
                    let (x, y, _) = a[i];
                    let (u, v, _) = b_points[(i + shift) % count];
                    (x - u).powi(2) + (y - v).powi(2)
                })
                .sum::<f64>()
        };

        let authored = cost(0);
        let (shift, best) = (1..count)
            .filter(|shift| (0..count).all(|i| a_types[i] == types[(i + shift) % count]))
            .map(|shift| (shift, cost(shift)))
            .min_by(|left, right| left.1.total_cmp(&right.1))?;
        if best >= authored * self.thresholds.improvement {
            return None;
        }

        // A better-matching start alone isn't a fault: masters far apart in
        // shape match loosely either way. Report it only when the authored
        // order breaks the shape halfway.
        broken_between(a_contour, b).then_some(shift)
    }
}

/// Whether the contour, interpolated halfway from `a` to `b` in its
/// authored point order, crosses itself or keeps less than 60% of the
/// smaller end's ink: the twisting and collapse a misaligned start causes.
fn broken_between(a: &Contour, b: &Contour) -> bool {
    let middle = BezPath::from(&blend(a, b, 0.5));
    let ends = BezPath::from(a)
        .area()
        .abs()
        .min(BezPath::from(b).area().abs());
    middle.area().abs() < ends * 0.6 || crosses_itself(&middle)
}

/// Whether a closed path's flattened outline crosses itself.
fn crosses_itself(path: &BezPath) -> bool {
    let polygon = Polygon::flatten(path, 1.0);
    (4..=4000).contains(&polygon.len()) && polygon.crosses_itself()
}

/// Returns the first sample position at which the contour's area has the
/// opposite sign from both ends.
fn inside_out(a: &Contour, b: &Contour, area_a: f64) -> Option<f64> {
    SAMPLES.into_iter().find(|&t| {
        let between = blend(a, b, t);
        signed_area(&between) * area_a < 0.0
    })
}

fn blend(a: &Contour, b: &Contour, t: f64) -> Contour {
    let mut contour = a.clone();
    for (point, other) in contour.points_mut().iter_mut().zip(b.points()) {
        point.set_position(
            point.x() + (other.x() - point.x()) * t,
            point.y() + (other.y() - point.y()) * t,
        );
    }
    contour
}

fn signed_area(contour: &Contour) -> f64 {
    BezPath::from(contour).area()
}

fn same_structure(a: &Contour, b: &Contour) -> bool {
    a.is_closed() == b.is_closed()
        && a.points().len() == b.points().len()
        && a.points()
            .iter()
            .zip(b.points())
            .all(|(p, q)| p.point_type() == q.point_type())
}

/// Returns the contour's points centred on their mean and scaled to unit
/// spread, so masters of different weight and width compare by shape.
fn normalized(contour: &Contour) -> Vec<(f64, f64, PointType)> {
    let points = contour.points();
    let count = points.len() as f64;
    let (cx, cy) = points.iter().fold((0.0, 0.0), |(x, y), p| {
        (x + p.x() / count, y + p.y() / count)
    });
    let spread = (points
        .iter()
        .map(|p| (p.x() - cx).powi(2) + (p.y() - cy).powi(2))
        .sum::<f64>()
        / count)
        .sqrt()
        .max(1e-9);
    points
        .iter()
        .map(|p| ((p.x() - cx) / spread, (p.y() - cy) / spread, p.point_type()))
        .collect()
}

/// Where a contour sits and how big it is, relative to its whole layer.
struct Descriptor {
    x: f64,
    y: f64,
    size: f64,
}

impl Descriptor {
    fn distance(&self, other: &Self) -> f64 {
        (self.x - other.x).powi(2) + (self.y - other.y).powi(2) + (self.size - other.size).powi(2)
    }
}

fn descriptors(contours: &[&Contour]) -> Vec<Descriptor> {
    let points = contours.iter().flat_map(|contour| contour.points());
    let (mut left, mut bottom, mut right, mut top) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
    for point in points {
        left = left.min(point.x());
        right = right.max(point.x());
        bottom = bottom.min(point.y());
        top = top.max(point.y());
    }
    let width = (right - left).max(1e-9);
    let height = (top - bottom).max(1e-9);

    contours
        .iter()
        .map(|contour| {
            let points = contour.points();
            let count = points.len().max(1) as f64;
            let (x, y) = points.iter().fold((0.0, 0.0), |(x, y), p| {
                (x + p.x() / count, y + p.y() / count)
            });
            Descriptor {
                x: (x - left) / width,
                y: (y - bottom) / height,
                size: (signed_area(contour).abs() / (width * height)).sqrt(),
            }
        })
        .collect()
}
