//! Contours flattened to polygons, for checks that compare whole outlines.

use kurbo::{BezPath, Line, PathEl, Point};

/// A closed outline as its vertices; the last vertex joins the first.
#[derive(Clone, Debug, Default, PartialEq)]
pub(super) struct Polygon(Vec<Point>);

impl Polygon {
    /// Flattens a closed path to within `tolerance` font units.
    pub(super) fn flatten(path: &BezPath, tolerance: f64) -> Self {
        let mut vertices = Vec::new();
        kurbo::flatten(path, tolerance, |element| match element {
            PathEl::MoveTo(point) | PathEl::LineTo(point) => vertices.push(point),
            _ => {}
        });
        Self(vertices)
    }

    pub(super) fn len(&self) -> usize {
        self.0.len()
    }

    /// The edges in order, the last one closing back to the first vertex.
    pub(super) fn edges(&self) -> impl Iterator<Item = Line> + '_ {
        let next = self.0.iter().cycle().skip(1);
        self.0
            .iter()
            .zip(next)
            .map(|(&start, &end)| Line::new(start, end))
    }

    /// The signed area, positive when the vertices run counter-clockwise.
    pub(super) fn area(&self) -> f64 {
        self.edges()
            .map(|edge| edge.p0.to_vec2().cross(edge.p1.to_vec2()))
            .sum::<f64>()
            / 2.0
    }

    /// Whether `point` lies inside, by the even-odd rule.
    pub(super) fn contains(&self, point: Point) -> bool {
        self.edges()
            .filter(|edge| ray_crosses(*edge, point))
            .count()
            % 2
            == 1
    }

    /// Whether every vertex lies inside `outer`; callers rule out crossing edges.
    pub(super) fn is_inside(&self, outer: &Self) -> bool {
        self.0.iter().all(|&point| outer.contains(point))
    }

    /// Whether an edge of this polygon properly crosses an edge of `other`.
    pub(super) fn crosses(&self, other: &Self) -> bool {
        self.edges().any(|edge| {
            other
                .edges()
                .any(|other_edge| lines_cross(edge, other_edge))
        })
    }

    /// Whether two edges that don't share a vertex properly cross.
    pub(super) fn crosses_itself(&self) -> bool {
        let edges = self.edges().collect::<Vec<_>>();
        let count = edges.len();
        let apart = |i: usize, j: usize| (j + 1) % count != i;
        (0..count).any(|i| {
            ((i + 2)..count)
                .filter(|&j| apart(i, j))
                .any(|j| lines_cross(edges[i], edges[j]))
        })
    }
}

impl FromIterator<Point> for Polygon {
    fn from_iter<I: IntoIterator<Item = Point>>(vertices: I) -> Self {
        Self(vertices.into_iter().collect())
    }
}

/// Whether two segments properly cross; touching at an end doesn't count.
fn lines_cross(a: Line, b: Line) -> bool {
    let side = |line: Line, point: Point| (line.p1 - line.p0).cross(point - line.p0);
    side(b, a.p0) * side(b, a.p1) < 0.0 && side(a, b.p0) * side(a, b.p1) < 0.0
}

/// Whether a ray from `point` towards positive x crosses `edge`.
fn ray_crosses(edge: Line, point: Point) -> bool {
    let Line {
        p0: previous,
        p1: current,
    } = edge;
    if (current.y > point.y) == (previous.y > point.y) {
        return false;
    }

    let crossing =
        (previous.x - current.x) * (point.y - current.y) / (previous.y - current.y) + current.x;
    point.x < crossing
}

#[cfg(test)]
mod tests {
    use super::*;

    fn square(min: f64, max: f64) -> Polygon {
        [(min, min), (max, min), (max, max), (min, max)]
            .into_iter()
            .map(Point::from)
            .collect()
    }

    #[test]
    fn counter_clockwise_area_is_positive() {
        assert_eq!(square(0.0, 10.0).area(), 100.0);
    }

    #[test]
    fn a_nested_square_is_inside_and_does_not_cross() {
        let outer = square(0.0, 100.0);
        let inner = square(25.0, 75.0);

        assert!(inner.is_inside(&outer));
        assert!(!outer.is_inside(&inner));
        assert!(!inner.crosses(&outer));
    }

    #[test]
    fn overlapping_squares_cross() {
        assert!(square(0.0, 100.0).crosses(&square(50.0, 150.0)));
    }

    #[test]
    fn a_bow_tie_crosses_itself() {
        let bow_tie: Polygon = [(0.0, 0.0), (10.0, 10.0), (10.0, 0.0), (0.0, 10.0)]
            .into_iter()
            .map(Point::from)
            .collect();

        assert!(bow_tie.crosses_itself());
        assert!(!square(0.0, 10.0).crosses_itself());
    }
}
