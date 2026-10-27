//! shift-font's drag rules for the editor: matched once when a drag starts,
//! then one call per frame that turns the drag delta into point positions.

use std::cell::RefCell;

use shift_font::PointType;
use shift_font::drag_rules::{DragContour, DragPoint, PointRef, PreparedDrag};
use shift_font::kurbo::{Point, Vec2};
use wasm_bindgen::prelude::wasm_bindgen;

use crate::layout::{call, layout};
use crate::variation::Registry;

thread_local! {
    static DRAGS: RefCell<Registry<Prepared>> = const { RefCell::new(Registry::new()) };
}

/// A prepared drag and where each contour's points start in the editor's
/// flat point order.
struct Prepared {
    drag: PreparedDrag,
    offsets: Vec<usize>,
}

/// Matches the drag rules for dragging the selected points, keeping the
/// points as the drag found them until [`release_drag`].
///
/// Input: [`DragSelection`]. Output: [`PreparedDragHandle`].
#[wasm_bindgen(js_name = prepareDrag)]
pub fn prepare_drag(input: &[f64]) -> Vec<f64> {
    call(input, |selection: DragSelection| {
        let mut offsets = Vec::with_capacity(selection.contours.len());
        let mut start = 0;
        let contours: Vec<DragContour> = selection
            .contours
            .into_iter()
            .map(|contour| {
                offsets.push(start);
                start += contour.points.len();
                DragContour {
                    closed: contour.closed,
                    points: contour.points.iter().map(DragPointInput::point).collect(),
                }
            })
            .collect();
        let selected: Vec<PointRef> = selection
            .selected
            .iter()
            .filter_map(|&index| point_ref(&offsets, index))
            .collect();
        let drag = PreparedDrag::new(contours, selected);
        let uniform = drag.is_uniform_translation();
        let handle = DRAGS.with_borrow_mut(|drags| drags.insert(Prepared { drag, offsets }));
        PreparedDragHandle {
            handle: handle as usize,
            uniform,
        }
    })
}

/// Positions for one frame of a prepared drag: the selected points moved by
/// the delta and the points its rules move, rules last. Empty for a released
/// or unknown handle.
///
/// Input: [`DragFrame`]. Output: a list of [`DragMove`].
#[wasm_bindgen(js_name = dragMoves)]
pub fn drag_moves(input: &[f64]) -> Vec<f64> {
    call(input, |frame: DragFrame| {
        let Ok(handle) = u32::try_from(frame.handle) else {
            return Vec::new();
        };
        DRAGS.with_borrow(|drags| {
            let Some(prepared) = drags.get(handle) else {
                return Vec::new();
            };
            prepared
                .drag
                .moves(Vec2::new(frame.dx, frame.dy))
                .into_iter()
                .filter_map(|found| {
                    Some(DragMove {
                        point: prepared.offsets.get(found.point.contour)? + found.point.point,
                        x: found.position.x,
                        y: found.position.y,
                    })
                })
                .collect::<Vec<_>>()
        })
    })
}

/// Forgets a prepared drag. Releasing an unknown handle does nothing.
#[wasm_bindgen(js_name = releaseDrag)]
pub fn release_drag(handle: u32) {
    DRAGS.with_borrow_mut(|drags| drags.remove(handle));
}

/// The point at `index` in the flat order whose contours start at `offsets`.
fn point_ref(offsets: &[usize], index: usize) -> Option<PointRef> {
    let contour = offsets
        .partition_point(|&start| start <= index)
        .checked_sub(1)?;
    Some(PointRef {
        contour,
        point: index - offsets.get(contour)?,
    })
}

layout! {
    /// One point as the drag rules read it.
    pub struct DragPointInput {
        pub x: f64,
        pub y: f64,
        pub point_type: PointType,
        pub smooth: bool,
    }
}

layout! {
    /// One contour's points in order.
    pub struct DragContourInput {
        pub closed: bool,
        pub points: Vec<DragPointInput>,
    }
}

layout! {
    /// A layer's contours as a drag found them, and the selected points by
    /// their index in the layer's flat point order, contour after contour.
    pub struct DragSelection {
        pub contours: Vec<DragContourInput>,
        pub selected: Vec<usize>,
    }
}

layout! {
    /// A prepared drag's handle, and whether its points only translate
    /// because no rule matched.
    pub struct PreparedDragHandle {
        pub handle: usize,
        pub uniform: bool,
    }
}

layout! {
    /// One frame of a prepared drag: its handle and the drag delta.
    pub struct DragFrame {
        pub handle: usize,
        pub dx: f64,
        pub dy: f64,
    }
}

layout! {
    /// A point's position for a frame, by its index in the layer's flat
    /// point order.
    pub struct DragMove {
        pub point: usize,
        pub x: f64,
        pub y: f64,
    }
}

impl DragPointInput {
    fn point(&self) -> DragPoint {
        DragPoint {
            position: Point::new(self.x, self.y),
            point_type: self.point_type,
            smooth: self.smooth,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flat_indices_name_points_contour_after_contour() {
        let offsets = [0, 3, 3, 7];

        assert_eq!(
            point_ref(&offsets, 0),
            Some(PointRef {
                contour: 0,
                point: 0
            })
        );
        assert_eq!(
            point_ref(&offsets, 2),
            Some(PointRef {
                contour: 0,
                point: 2
            })
        );
        // The empty contour at 3 holds nothing; index 3 is the next one's first.
        assert_eq!(
            point_ref(&offsets, 3),
            Some(PointRef {
                contour: 2,
                point: 0
            })
        );
        assert_eq!(
            point_ref(&offsets, 8),
            Some(PointRef {
                contour: 3,
                point: 1
            })
        );
        assert_eq!(point_ref(&[], 0), None);
    }
}
