import type { Point2D, PointAxis } from "./types";

/**
 * Orders points by their position on one axis, smallest coordinate first.
 *
 * @param axis - `"x"` orders left to right, `"y"` bottom to top.
 */
export function byAxis(axis: PointAxis): (a: Point2D, b: Point2D) => number {
  return (a, b) => a[axis] - b[axis];
}
