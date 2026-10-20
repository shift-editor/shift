//! Checks on each master's drawing of a glyph: contours that can't fill,
//! coordinates and advances that can't compile, and outlines that won't
//! render where the glyph is used.

use kurbo::BezPath;

use crate::curve::segment_bounds;
use crate::{CurveSegmentIter, DesignLocation, Font, Glyph, GlyphLayer, Point, Source};

use super::polygon::Polygon;
use super::roles::GlyphRole;
use super::{Check, Finding};

/// Runs the drawing checks on `glyph`'s layer in every master.
///
/// Glyphs the source marks as not exported are skipped, and so are
/// unencoded glyphs named with a leading `_`: they are drawing aids and
/// component parts, such as Glyphs corner components, which are open on
/// purpose.
pub(super) fn check(font: &Font, glyph: &Glyph, out: &mut Vec<Finding>) {
    let part = glyph.name().starts_with('_') && glyph.unicodes().is_empty();
    if part || font.lib().skipped_export_glyphs().contains(glyph.name()) {
        return;
    }
    let role = GlyphRole::of(glyph);
    let default = font.default_source().filter(|source| source.is_master());
    let encoded = !glyph.unicodes().is_empty() && !role.space_like;

    if let Some(default) = default
        && encoded
        && glyph.layer_for_source(&default.id()).is_none()
    {
        out.push(
            Finding::glyph(
                Check::EmptyOutline,
                glyph.id(),
                format!(
                    "'{}' is encoded but has no layer in the default master '{}'",
                    glyph.name(),
                    default.name()
                ),
            )
            .in_source(default.id()),
        );
    }

    for source in font.masters() {
        let Some(layer) = glyph.layer_for_source(&source.id()) else {
            continue;
        };
        let at = |check, message: String| {
            Finding::glyph(
                check,
                glyph.id(),
                format!("'{}' in '{}' {message}", glyph.name(), source.name()),
            )
            .in_source(source.id())
        };

        let finite = points(layer, &at, out);
        advance(layer, role, !glyph.unicodes().is_empty(), &at, out);
        if !finite {
            continue;
        }
        direction(layer, &at, out);

        let is_default = default.is_some_and(|default| default.id() == source.id());
        resolved(font, glyph, source, role, encoded && is_default, &at, out);
    }
}

fn points(
    layer: &GlyphLayer,
    at: &impl Fn(Check, String) -> Finding,
    out: &mut Vec<Finding>,
) -> bool {
    let mut finite = true;
    for (index, contour) in layer.contours_iter().enumerate() {
        let count = contour.points().len();
        // A lone open point is a stray node that compilers drop.
        if !contour.is_closed() && count > 1 {
            out.push(
                at(
                    Check::OpenContour,
                    format!(
                        "has an open contour {}, which won't fill; compilers close or drop it",
                        index + 1
                    ),
                )
                .in_contour(index),
            );
        }
        if count < 3 && contour.is_closed() {
            out.push(
                at(
                    Check::DegenerateContour,
                    format!(
                        "has a closed contour {} with only {count} point{}, which draws nothing",
                        index + 1,
                        if count == 1 { "" } else { "s" }
                    ),
                )
                .in_contour(index),
            );
        }
        if contour
            .points()
            .iter()
            .any(|point| !point.x().is_finite() || !point.y().is_finite())
        {
            finite = false;
            out.push(
                at(
                    Check::NonFinitePoint,
                    format!("has a point in contour {} that isn't a number", index + 1),
                )
                .in_contour(index),
            );
        }
    }
    finite
}

/// Reports advances that can't compile, and zero advances on encoded glyphs
/// that should space.
///
/// Unencoded glyphs may be zero-width: they are reached through features,
/// as marks, below-base forms, and ligature parts are.
fn advance(
    layer: &GlyphLayer,
    role: GlyphRole,
    encoded: bool,
    at: &impl Fn(Check, String) -> Finding,
    out: &mut Vec<Finding>,
) {
    let advance = layer.width();
    let problem = if !advance.is_finite() {
        "isn't a number"
    } else if advance < 0.0 {
        "is negative"
    } else if advance == 0.0 && encoded && !role.zero_width_allowed && !role.mark {
        "is zero, which only marks and format characters should have"
    } else {
        return;
    };
    out.push(at(
        Check::InvalidAdvance,
        format!("has an advance width that {problem}"),
    ));
}

/// Reports counters that wind the same way as the contour around them, so
/// they fill in instead of cutting a hole.
///
/// Which way outer contours run is a convention, not an error: the fill rule
/// only cares that a counter runs opposite its container.
fn direction(layer: &GlyphLayer, at: &impl Fn(Check, String) -> Finding, out: &mut Vec<Finding>) {
    let closed = layer
        .contours_iter()
        .enumerate()
        .filter(|(_, contour)| contour.is_closed())
        .collect::<Vec<_>>();
    let outlines = closed
        .iter()
        // Within a quarter of a font unit.
        .map(|(_, contour)| Polygon::flatten(&BezPath::from(*contour), 0.25))
        .collect::<Vec<_>>();
    for (position, container) in filled_counters(&outlines) {
        let (index, outer) = (closed[position].0, closed[container].0);
        out.push(
            at(
                Check::ContourDirection,
                format!(
                    "has contour {} wholly inside contour {} and winding the same way, so it adds nothing; reverse it if it should cut a hole",
                    index + 1,
                    outer + 1
                ),
            )
            .in_contour(index),
        );
    }
}

fn resolved(
    font: &Font,
    glyph: &Glyph,
    source: &Source,
    role: GlyphRole,
    expect_ink: bool,
    at: &impl Fn(Check, String) -> Finding,
    out: &mut Vec<Finding>,
) {
    let location: &DesignLocation = source.location();
    let resolved = match font.projection(location).glyph(&glyph.id()) {
        Ok(Some(resolved)) => resolved,
        Ok(None) => return,
        Err(error) => {
            out.push(at(
                Check::UnresolvedGlyph,
                format!("can't be drawn: {error}"),
            ));
            return;
        }
    };
    let ink = extent(
        resolved
            .contours()
            .iter()
            .map(|contour| (contour.points.as_slice(), contour.closed)),
    );

    if ink.is_none() && expect_ink && !role.space_like {
        out.push(at(
            Check::EmptyOutline,
            "is encoded but draws nothing".to_string(),
        ));
    }
}

/// Axis-aligned extent of points, in font units.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Extent {
    pub(super) min_x: f64,
    pub(super) min_y: f64,
    pub(super) max_x: f64,
    pub(super) max_y: f64,
}

impl Extent {
    fn of<'a>(points: impl IntoIterator<Item = &'a Point>) -> Option<Self> {
        points
            .into_iter()
            .fold(None, |extent: Option<Self>, point| {
                let part = Self {
                    min_x: point.x(),
                    min_y: point.y(),
                    max_x: point.x(),
                    max_y: point.y(),
                };
                Some(extent.map_or(part, |extent| extent.union(&part)))
            })
    }

    fn union(&self, other: &Self) -> Self {
        Self {
            min_x: self.min_x.min(other.min_x),
            min_y: self.min_y.min(other.min_y),
            max_x: self.max_x.max(other.max_x),
            max_y: self.max_y.max(other.max_y),
        }
    }
}

/// Returns the tight extent of drawn outlines, including curve extrema.
pub(super) fn extent<'a>(
    contours: impl IntoIterator<Item = (&'a [Point], bool)>,
) -> Option<Extent> {
    let mut extent: Option<Extent> = None;
    for (points, closed) in contours {
        let on_curve = Extent::of(points.iter().filter(|point| point.is_on_curve()));
        let segments = CurveSegmentIter::new(points, closed).map(|segment| {
            let (min_x, min_y, max_x, max_y) = segment_bounds(&segment);
            Extent {
                min_x,
                min_y,
                max_x,
                max_y,
            }
        });
        for part in on_curve.into_iter().chain(segments) {
            extent = Some(extent.map_or(part, |extent| extent.union(&part)));
        }
    }
    extent
}

/// Pairs of `(contour, container)` positions where a contour lies wholly
/// inside its innermost container and winds the same way.
///
/// A contour that crosses any other contour is an overlapping stroke, like an
/// A's crossbar laid over its legs or bars drawn across a frame's counter,
/// and is never reported.
fn filled_counters(outlines: &[Polygon]) -> Vec<(usize, usize)> {
    let areas = outlines.iter().map(Polygon::area).collect::<Vec<_>>();
    let usable = |index: usize| outlines[index].len() >= 3 && areas[index].abs() > f64::EPSILON;
    let crosses_another = |index: usize| {
        (0..outlines.len()).any(|other| other != index && outlines[index].crosses(&outlines[other]))
    };

    let mut filled = Vec::new();
    for index in (0..outlines.len()).filter(|index| usable(*index) && !crosses_another(*index)) {
        let innermost = (0..outlines.len())
            .filter(|other| *other != index && usable(*other))
            .filter(|other| outlines[index].is_inside(&outlines[*other]))
            .min_by(|left, right| areas[*left].abs().total_cmp(&areas[*right].abs()));
        if let Some(container) = innermost
            && (areas[index] > 0.0) == (areas[container] > 0.0)
        {
            filled.push((index, container));
        }
    }
    filled
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rectangle(min: f64, max: f64, counter_clockwise: bool) -> Polygon {
        let mut points = vec![(min, min), (max, min), (max, max), (min, max)];
        if !counter_clockwise {
            points.reverse();
        }
        polygon(points)
    }

    fn polygon(points: Vec<(f64, f64)>) -> Polygon {
        points.into_iter().map(kurbo::Point::from).collect()
    }

    #[test]
    fn outline_extent_uses_curve_extrema_not_control_points() {
        let points = vec![
            Point::on_curve(0.0, 0.0),
            Point::off_curve(0.0, 100.0),
            Point::off_curve(100.0, 100.0),
            Point::on_curve(100.0, 0.0),
        ];

        let extent = extent([(points.as_slice(), true)]).unwrap();

        assert_eq!((extent.max_x, extent.max_y), (100.0, 75.0));
    }

    #[test]
    fn a_counter_running_like_its_outer_contour_fills_in() {
        let outer = rectangle(0.0, 100.0, true);

        assert_eq!(
            filled_counters(&[outer.clone(), rectangle(25.0, 75.0, true)]),
            [(1, 0)]
        );
        assert!(filled_counters(&[outer, rectangle(25.0, 75.0, false)]).is_empty());
    }

    #[test]
    fn clockwise_outlines_are_a_convention_not_an_error() {
        let outer = rectangle(0.0, 100.0, false);
        let counter = rectangle(25.0, 75.0, true);

        assert!(filled_counters(&[outer, counter]).is_empty());
    }

    #[test]
    fn a_crossbar_laid_over_both_legs_is_not_a_counter() {
        // An inverted U with a bar whose ends sit inside the legs.
        let legs = vec![
            (0.0, 0.0),
            (20.0, 0.0),
            (20.0, 80.0),
            (80.0, 80.0),
            (80.0, 0.0),
            (100.0, 0.0),
            (100.0, 100.0),
            (0.0, 100.0),
        ];
        let bar = vec![(10.0, 40.0), (90.0, 40.0), (90.0, 50.0), (10.0, 50.0)];

        assert!(filled_counters(&[polygon(legs), polygon(bar)]).is_empty());
    }

    #[test]
    fn overlapping_outer_strokes_are_not_counters() {
        let left = rectangle(0.0, 100.0, true);
        let right = rectangle(50.0, 150.0, true);

        assert!(filled_counters(&[left, right]).is_empty());
    }
}
