//! A contour's segments and bounds, and a component's placement as a
//! matrix, as shift-font computes them.

use shift_font::{DecomposedTransform, PointType, SegmentIndexIter, SegmentIndices, Transform};
use wasm_bindgen::prelude::wasm_bindgen;

use crate::layout::{call, enum_layout, layout};

/// Segments one contour and bounds each segment and the whole contour.
///
/// Input: [`ContourPoints`]. Output: [`ContourGeometry`].
#[wasm_bindgen(js_name = contourGeometry)]
pub fn contour_geometry(input: &[f64]) -> Vec<f64> {
    call(input, |contour: ContourPoints| contour.geometry())
}

/// A component placement's matrix: `DecomposedTransform::to_matrix`.
///
/// Input: [`DecomposedTransform`]. Output: [`Transform`], as the editor's
/// `MatModel` names it.
#[wasm_bindgen(js_name = composeTransform)]
pub fn compose_transform(input: &[f64]) -> Vec<f64> {
    call(input, |transform: DecomposedTransform| {
        transform.to_matrix()
    })
}

/// The placement a matrix makes: `DecomposedTransform::from_matrix`.
///
/// Input: [`Transform`]. Output: [`DecomposedTransform`].
#[wasm_bindgen(js_name = decomposeMatrix)]
pub fn decompose_matrix(input: &[f64]) -> Vec<f64> {
    call(input, |matrix: Transform| {
        DecomposedTransform::from_matrix(&matrix)
    })
}

enum_layout! {
    /// A point's type, as the editor spells it.
    PointType {
        OnCurve => "onCurve",
        OffCurve => "offCurve",
        QCurve => "qCurve",
    }
}

/// The kind of curve a segment draws.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SegmentKind {
    #[default]
    Line,
    Quad,
    Cubic,
}

enum_layout! {
    /// The kind of curve a segment draws.
    SegmentKind {
        Line => "line",
        Quad => "quad",
        Cubic => "cubic",
    }
}

layout! {
    /// One contour's points: their types, and their coordinates as `x, y`
    /// pairs in the same order.
    pub struct ContourPoints {
        pub closed: bool,
        pub point_types: Vec<PointType>,
        pub coordinates: Vec<f64>,
    }
}

layout! {
    /// A tight axis-aligned box.
    pub struct SegmentBounds {
        pub min_x: f64,
        pub min_y: f64,
        pub max_x: f64,
        pub max_y: f64,
    }
}

layout! {
    /// A contour's segments in order, as parallel lists so reading them
    /// allocates per list, not per segment, and the box around all of them,
    /// which is absent when the contour has no segment.
    ///
    /// A segment's points are consecutive in the contour, two for a line,
    /// three for a quad and four for a cubic, from its first index, wrapping
    /// to the start of a closed contour.
    pub struct ContourGeometry {
        pub kinds: Vec<SegmentKind>,
        /// Each segment's first point index.
        pub firsts: Vec<usize>,
        /// Each segment's tight box as `min_x, min_y, max_x, max_y`.
        pub segment_bounds: Vec<f64>,
        pub bounds: Option<SegmentBounds>,
    }
}

impl ContourPoints {
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
