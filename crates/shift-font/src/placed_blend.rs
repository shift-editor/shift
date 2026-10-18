//! A component occurrence's outline between masters, blended the way
//! compilers interpolate a decomposed glyph.
//!
//! A variable font can vary a component's offset but not its scale,
//! rotation, or skew, so a compiler decomposes a glyph whose components
//! change those between masters: each master places the component's contours
//! with its own transform, and the placed points blend with the glyph's
//! source weights. A mirroring transform reverses each closed contour,
//! keeping its start point, so the contour keeps its direction; that reversal
//! decides which points pair up between masters.
//!
//! The rules here work on plain numbers so native projection and the editor,
//! through `shift-wasm`, run the same code.

use crate::ir::Transform;

/// A contour's closure and point count: what decides how its points pair up
/// between masters.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ContourShape {
    pub point_count: usize,
    pub closed: bool,
}

/// Returns whether `transform` mirrors, so a decomposed placement reverses
/// closed contours.
pub fn mirrors(transform: &Transform) -> bool {
    transform.xx * transform.yy - transform.xy * transform.yx < 0.0
}

/// Returns the index in the authored contour of the point a decomposed
/// placement puts at `index`.
///
/// A mirrored placement reverses a closed contour after its start point, so
/// `[p0, p1, p2, p3]` places as `[p0, p3, p2, p1]`. Open contours and
/// unmirrored placements keep their order.
pub fn placed_point_index(index: usize, shape: ContourShape, mirrored: bool) -> usize {
    if !mirrored || !shape.closed || index == 0 {
        return index;
    }
    shape.point_count - index
}

/// Returns whether two outlines line up point for point: the same number of
/// contours, each with the same closure and point count.
pub fn shapes_match(a: &[ContourShape], b: &[ContourShape]) -> bool {
    a == b
}

/// One master's outline of a component occurrence, before placement.
#[derive(Clone, Copy, Debug)]
pub struct PlacedMaster<'a> {
    /// Where this master places the occurrence in the root glyph.
    pub transform: Transform,
    /// The component glyph's contours at this master, in order.
    pub shapes: &'a [ContourShape],
    /// The contours' points as `x, y` pairs, contours concatenated in order.
    pub coordinates: &'a [f64],
}

/// One point of a blended occurrence.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BlendedPoint {
    /// The point's index in the first master's authored contour, which gives
    /// the blended point its identity and type.
    pub source_index: usize,
    pub x: f64,
    pub y: f64,
}

/// Blends a component occurrence's outline as each master places it.
///
/// Writes one [`BlendedPoint`] per point of the first master's contours, in
/// placed order, contour after contour, replacing what `out` held. The
/// weights are the glyph's source weights, one per master in order.
///
/// Returns `false`, leaving `out` empty, when the masters' outlines don't
/// line up point for point, when a master's coordinates don't cover its
/// shapes, or when the weights don't match the masters.
pub fn blend_placed_contours(
    masters: &[PlacedMaster<'_>],
    weights: &[f64],
    out: &mut Vec<BlendedPoint>,
) -> bool {
    out.clear();
    let Some(first) = masters.first() else {
        return false;
    };
    let point_total = first
        .shapes
        .iter()
        .map(|shape| shape.point_count)
        .sum::<usize>();
    let lines_up = masters.iter().all(|master| {
        shapes_match(master.shapes, first.shapes) && master.coordinates.len() == point_total * 2
    });
    if !lines_up || weights.len() != masters.len() {
        return false;
    }

    let mirrored = masters
        .iter()
        .map(|master| mirrors(&master.transform))
        .collect::<Vec<_>>();
    out.reserve(point_total);
    let mut contour_start = 0;
    for &shape in first.shapes {
        for index in 0..shape.point_count {
            let (mut x, mut y) = (0.0, 0.0);
            for ((master, weight), &mirrored) in masters.iter().zip(weights).zip(&mirrored) {
                let at = (contour_start + placed_point_index(index, shape, mirrored)) * 2;
                let (px, py) = master
                    .transform
                    .transform_point(master.coordinates[at], master.coordinates[at + 1]);
                x += weight * px;
                y += weight * py;
            }
            out.push(BlendedPoint {
                source_index: placed_point_index(index, shape, mirrored[0]),
                x,
                y,
            });
        }
        contour_start += shape.point_count;
    }
    true
}

/// Blends every component occurrence of a decomposed glyph, or none.
///
/// Compilers decompose a glyph as a whole: fontir coalesces a glyph whose
/// component 2x2 transforms vary into a simple glyph, so if one
/// occurrence's masters don't line up point for point the glyph cannot be
/// interpolated decomposed at all. Returns each occurrence's blended points,
/// in order, or `None` when any occurrence fails [`blend_placed_contours`].
pub fn blend_decomposed_glyph(
    occurrences: &[Vec<PlacedMaster<'_>>],
    weights: &[f64],
) -> Option<Vec<Vec<BlendedPoint>>> {
    occurrences
        .iter()
        .map(|masters| {
            let mut blended = Vec::new();
            blend_placed_contours(masters, weights, &mut blended).then_some(blended)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SQUARE: [f64; 8] = [0.0, 0.0, 100.0, 0.0, 100.0, 100.0, 0.0, 100.0];
    const TRIANGLE: [f64; 6] = [0.0, 0.0, 100.0, 0.0, 0.0, 100.0];

    fn closed(point_count: usize) -> ContourShape {
        ContourShape {
            point_count,
            closed: true,
        }
    }

    fn master<'a>(
        transform: Transform,
        shapes: &'a [ContourShape],
        coordinates: &'a [f64],
    ) -> PlacedMaster<'a> {
        PlacedMaster {
            transform,
            shapes,
            coordinates,
        }
    }

    #[test]
    fn a_mirrored_placement_reverses_a_closed_contour_after_its_start() {
        let order = (0..4)
            .map(|index| placed_point_index(index, closed(4), true))
            .collect::<Vec<_>>();

        assert_eq!(order, [0, 3, 2, 1]);
    }

    #[test]
    fn an_open_contour_keeps_its_order_when_mirrored() {
        let open = ContourShape {
            point_count: 3,
            closed: false,
        };

        assert_eq!(placed_point_index(1, open, true), 1);
    }

    #[test]
    fn blended_points_take_identity_from_the_first_masters_placed_order() {
        let shapes = [closed(4)];
        let mirror = Transform {
            xx: -1.0,
            dx: 200.0,
            ..Transform::identity()
        };
        let masters = [
            master(mirror, &shapes, &SQUARE),
            master(Transform::identity(), &shapes, &SQUARE),
        ];
        let mut out = Vec::new();

        assert!(blend_placed_contours(&masters, &[0.5, 0.5], &mut out));

        let sources = out
            .iter()
            .map(|point| point.source_index)
            .collect::<Vec<_>>();
        assert_eq!(sources, [0, 3, 2, 1]);
        // The mirrored master places its point 3 second, at (200,100); it
        // pairs with the other master's point 1, (100,0).
        assert_eq!((out[1].x, out[1].y), (150.0, 50.0));
    }

    #[test]
    fn one_occurrence_that_does_not_line_up_blends_none() {
        let square = [closed(4)];
        let triangle = [closed(3)];
        let identity = Transform::identity();
        let occurrences = vec![
            vec![
                master(identity, &square, &SQUARE),
                master(identity, &square, &SQUARE),
            ],
            vec![
                master(identity, &square, &SQUARE),
                master(identity, &triangle, &TRIANGLE),
            ],
        ];

        assert!(blend_decomposed_glyph(&occurrences, &[0.5, 0.5]).is_none());
        assert_eq!(
            blend_decomposed_glyph(&occurrences[..1], &[0.5, 0.5]).map(|glyph| glyph.len()),
            Some(1)
        );
    }
}
