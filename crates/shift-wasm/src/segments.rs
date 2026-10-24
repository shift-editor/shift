//! Contour segment layout: which consecutive points form each segment.

use shift_font::{CurveSegment, CurveSegmentIter, PointType};
use wasm_bindgen::prelude::*;

/// Splits a batch of contours into segments with `CurveSegmentIter`.
///
/// `point_types` holds every contour's point types back to back (`0`
/// on-curve, `1` off-curve, `2` qCurve); `contour_lengths[i]` is contour
/// `i`'s point count and `closed[i]` is nonzero when it is closed.
///
/// Returns, per contour in order, the segment count followed by each
/// segment's `(start, point count)`. A segment's points are consecutive from
/// `start`, wrapping past the end of a closed contour, so the pair is enough
/// to recover them.
#[wasm_bindgen(js_name = contourSegmentLayout)]
pub fn contour_segment_layout(
    point_types: &[u8],
    contour_lengths: &[u32],
    closed: &[u8],
) -> Vec<u32> {
    let mut layout = Vec::with_capacity(point_types.len() * 2 + contour_lengths.len());
    let mut offset = 0usize;
    for (index, &length) in contour_lengths.iter().enumerate() {
        let length = length as usize;
        let Some(types) = point_types.get(offset..offset + length) else {
            break;
        };
        offset += length;

        let points: Vec<PointType> = types.iter().map(|&kind| point_type(kind)).collect();
        let is_closed = closed.get(index).is_some_and(|&flag| flag != 0);

        let count_slot = layout.len();
        layout.push(0);
        let base = points.as_ptr() as usize;
        let index_of = |point: &PointType| {
            (point as *const PointType as usize - base) / size_of::<PointType>()
        };
        for segment in CurveSegmentIter::new(&points, is_closed) {
            let (start, count) = match segment {
                CurveSegment::Line(start, _) => (start, 2),
                CurveSegment::Quad(start, _, _) => (start, 3),
                CurveSegment::Cubic(start, _, _, _) => (start, 4),
            };
            layout.push(index_of(start) as u32);
            layout.push(count);
            layout[count_slot] += 1;
        }
    }
    layout
}

fn point_type(kind: u8) -> PointType {
    match kind {
        1 => PointType::OffCurve,
        2 => PointType::QCurve,
        _ => PointType::OnCurve,
    }
}
