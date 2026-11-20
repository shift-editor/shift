//! A contour's segments and bounds, its outline with open corners erased,
//! and a component's placement as a matrix, as shift-font computes them.

use pack::Pack;
use shift_font::Contour;
use shift_font::kurbo::{BezPath, PathEl};
use shift_font::{
    DecomposedTransform, Point, PointType, SegmentIndexIter, SegmentIndices, Transform,
    open_corners,
};
use wasm_bindgen::prelude::wasm_bindgen;

/// A contour's segments and bounds, and a component's placement, as
/// shift-font computes them.
#[pack::interface]
pub trait Geometry {
    /// Segments one contour and bounds each segment and the whole contour.
    fn contour_geometry(&self, contour: ContourPoints) -> ContourGeometry;
    /// The contour's outline with its outside open corners erased, as
    /// export erases them: `open_corners::erase_open_corners`. Absent when
    /// the contour has none.
    fn erased_outline(&self, contour: ContourPoints) -> Option<Outline>;
    /// A component placement's matrix: `DecomposedTransform::to_matrix`.
    fn compose_transform(&self, transform: DecomposedTransform) -> Transform;
    /// The placement a matrix makes: `DecomposedTransform::from_matrix`.
    fn decompose_matrix(&self, matrix: Transform) -> DecomposedTransform;
}

/// The geometry rules [`Geometry`] calls.
pub struct GeometryRules;

impl Geometry for GeometryRules {
    fn contour_geometry(&self, contour: ContourPoints) -> ContourGeometry {
        contour.geometry()
    }

    fn erased_outline(&self, contour: ContourPoints) -> Option<Outline> {
        open_corners::erase_open_corners(&contour.path()).map(|path| Outline::from(&path))
    }

    fn compose_transform(&self, transform: DecomposedTransform) -> Transform {
        transform.to_matrix()
    }

    fn decompose_matrix(&self, matrix: Transform) -> DecomposedTransform {
        DecomposedTransform::from_matrix(&matrix)
    }
}

/// Runs one [`Geometry`] method for the editor's generated `Geometry` class.
#[wasm_bindgen(js_name = geometryRequest)]
pub fn request(
    method: u32,
    input: &[f64],
    #[wasm_bindgen(unchecked_param_type = "readonly Uint8Array[] | undefined")] blobs: Option<
        js_sys::Array,
    >,
) -> Vec<f64> {
    crate::blobs::answer(blobs, |blobs, names| {
        geometry_request(&GeometryRules, method, input, blobs, names)
    })
}

/// The kind of curve a segment draws.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Pack)]
pub enum SegmentKind {
    #[default]
    Line,
    Quad,
    Cubic,
}

/// One contour's points: their types, and their coordinates as `x, y`
/// pairs in the same order.
#[derive(Clone, Debug, PartialEq, Pack)]
pub struct ContourPoints {
    pub closed: bool,
    pub point_types: Vec<PointType>,
    pub coordinates: Vec<f64>,
}

impl ContourPoints {
    /// A contour's points for geometry reads and stroke preview outlines.
    pub fn of_contour(contour: &Contour) -> Self {
        Self {
            closed: contour.is_closed(),
            point_types: contour.points().iter().map(Point::point_type).collect(),
            coordinates: contour
                .points()
                .iter()
                .flat_map(|point| [point.x(), point.y()])
                .collect(),
        }
    }
}

/// A tight axis-aligned box.
#[derive(Clone, Debug, PartialEq, Pack)]
pub struct SegmentBounds {
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
}

/// A contour's segments in order, as parallel lists so reading them
/// allocates per list, not per segment, and the box around all of them,
/// which is absent when the contour has no segment.
///
/// A segment's points are consecutive in the contour, two for a line,
/// three for a quad and four for a cubic, from its first index, wrapping
/// to the start of a closed contour.
#[derive(Clone, Debug, PartialEq, Pack)]
pub struct ContourGeometry {
    pub kinds: Vec<SegmentKind>,
    /// Each segment's first point index.
    pub firsts: Vec<usize>,
    /// Each segment's tight box as `min_x, min_y, max_x, max_y`.
    pub segment_bounds: Vec<f64>,
    pub bounds: Option<SegmentBounds>,
}

/// How one element of an [`Outline`] draws.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Pack)]
pub enum PathVerb {
    #[default]
    MoveTo,
    LineTo,
    QuadTo,
    CubicTo,
    Close,
}

/// A path as parallel lists: each element's verb, and the coordinates of
/// the points it ends with, as `x, y` pairs in order (one point for a move
/// or line, two for a quad, three for a cubic, none for a close).
#[derive(Clone, Debug, Default, PartialEq, Pack)]
pub struct Outline {
    pub verbs: Vec<PathVerb>,
    pub coordinates: Vec<f64>,
}

impl From<&BezPath> for Outline {
    fn from(path: &BezPath) -> Self {
        let mut outline = Self::default();
        for element in path.elements() {
            let (verb, points) = match *element {
                PathEl::MoveTo(p) => (PathVerb::MoveTo, vec![p]),
                PathEl::LineTo(p) => (PathVerb::LineTo, vec![p]),
                PathEl::QuadTo(c, p) => (PathVerb::QuadTo, vec![c, p]),
                PathEl::CurveTo(c1, c2, p) => (PathVerb::CubicTo, vec![c1, c2, p]),
                PathEl::ClosePath => (PathVerb::Close, Vec::new()),
            };
            outline.verbs.push(verb);
            outline
                .coordinates
                .extend(points.into_iter().flat_map(|point| [point.x, point.y]));
        }
        outline
    }
}

impl ContourPoints {
    /// The contour as a path, as shift-font draws it: `From<&Contour> for BezPath`.
    fn path(&self) -> BezPath {
        let mut contour = Contour::new();
        for (index, &kind) in self.point_types.iter().enumerate() {
            let at = |offset: usize| self.coordinates.get(index * 2 + offset).copied();
            contour.add_point(
                at(0).unwrap_or_default(),
                at(1).unwrap_or_default(),
                kind,
                false,
            );
        }
        if self.closed {
            contour.close();
        }
        BezPath::from(&contour)
    }

    fn geometry(&self) -> ContourGeometry {
        let position = |index: usize| {
            let at = |offset: usize| self.coordinates.get(index * 2 + offset).copied();
            (at(0).unwrap_or_default(), at(1).unwrap_or_default())
        };
        let mut geometry = ContourGeometry {
            kinds: Vec::new(),
            firsts: Vec::new(),
            segment_bounds: Vec::new(),
            bounds: None,
        };
        for indices in SegmentIndexIter::new(self.point_types.as_slice(), self.closed) {
            let bounds = SegmentBounds::from(indices.bounds(position));
            geometry.kinds.push(SegmentKind::of(indices));
            geometry.firsts.push(indices.first());
            geometry.segment_bounds.extend([
                bounds.min_x,
                bounds.min_y,
                bounds.max_x,
                bounds.max_y,
            ]);
            geometry.bounds = Some(match geometry.bounds.take() {
                Some(total) => total.union(bounds),
                None => bounds,
            });
        }
        geometry
    }
}

impl SegmentKind {
    fn of(indices: SegmentIndices) -> Self {
        match indices {
            SegmentIndices::Line(_) => Self::Line,
            SegmentIndices::Quad(_) => Self::Quad,
            SegmentIndices::Cubic(_) => Self::Cubic,
        }
    }
}

impl SegmentBounds {
    fn union(self, other: Self) -> Self {
        Self {
            min_x: self.min_x.min(other.min_x),
            min_y: self.min_y.min(other.min_y),
            max_x: self.max_x.max(other.max_x),
            max_y: self.max_y.max(other.max_y),
        }
    }
}

impl From<(f64, f64, f64, f64)> for SegmentBounds {
    fn from((min_x, min_y, max_x, max_y): (f64, f64, f64, f64)) -> Self {
        Self {
            min_x,
            min_y,
            max_x,
            max_y,
        }
    }
}

#[cfg(test)]
mod tests {
    use shift_font::composite::{ResolvedContour, resolved_contours_bbox};
    use shift_font::{Point, PointId};

    use super::*;

    #[test]
    fn a_contour_is_bounded_as_the_compiled_glyph_bounds_it() {
        let points = [
            (0.0, 0.0, PointType::OnCurve),
            (10.0, 80.0, PointType::OffCurve),
            (90.0, 80.0, PointType::OffCurve),
            (100.0, 0.0, PointType::OnCurve),
            (60.0, -60.0, PointType::OffCurve),
            (10.0, -20.0, PointType::QCurve),
        ];
        let contour = ContourPoints {
            closed: true,
            point_types: points.iter().map(|point| point.2).collect(),
            coordinates: points.iter().flat_map(|point| [point.0, point.1]).collect(),
        };

        let geometry = contour.geometry();

        let resolved = ResolvedContour {
            points: points
                .iter()
                .enumerate()
                .map(|(index, &(x, y, kind))| {
                    Point::new(PointId::from_raw(index), x, y, kind, false)
                })
                .collect(),
            closed: true,
        };
        let expected = resolved_contours_bbox(&[resolved]).map(SegmentBounds::from);
        assert_eq!(geometry.bounds, expected);
        assert_eq!(
            geometry.kinds,
            [SegmentKind::Cubic, SegmentKind::Quad, SegmentKind::Line]
        );
        assert_eq!(geometry.firsts, [0, 3, 5]);
        assert_eq!(geometry.segment_bounds.len(), 12);
    }

    fn contour_points(points: &[(f64, f64, PointType)], closed: bool) -> ContourPoints {
        ContourPoints {
            closed,
            point_types: points.iter().map(|point| point.2).collect(),
            coordinates: points.iter().flat_map(|point| [point.0, point.1]).collect(),
        }
    }

    #[test]
    fn an_open_corner_comes_back_erased_and_a_plain_contour_comes_back_absent() {
        let corner = [
            (20.0, 0.0, PointType::OnCurve),
            (179.0, 0.0, PointType::OnCurve),
            (60.0, 353.0, PointType::OnCurve),
            (198.0, 360.0, PointType::OnCurve),
        ];
        let plain = [
            (20.0, 0.0, PointType::OnCurve),
            (179.0, 0.0, PointType::OnCurve),
            (114.5, 191.2, PointType::OnCurve),
        ];

        let erased = GeometryRules
            .erased_outline(contour_points(&corner, true))
            .expect("an open corner");

        assert_eq!(
            erased.verbs,
            [
                PathVerb::MoveTo,
                PathVerb::LineTo,
                PathVerb::LineTo,
                PathVerb::LineTo,
                PathVerb::Close
            ]
        );
        assert_eq!(
            GeometryRules.erased_outline(contour_points(&plain, true)),
            None
        );
    }

    #[test]
    fn a_contour_without_points_has_no_segment_or_box() {
        let contour = ContourPoints {
            closed: true,
            point_types: Vec::new(),
            coordinates: Vec::new(),
        };

        let geometry = contour.geometry();

        assert!(geometry.kinds.is_empty());
        assert_eq!(geometry.bounds, None);
    }
}
