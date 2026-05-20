/**
 * Rectangle utilities for {@link Rect2D}.
 *
 * `Rect` is a stateless namespace object, matching the rest of `@shift/geo`.
 * All functions are pure and return new objects.
 *
 * @module
 */
import type { Point2D, Rect2D } from "./types";
import { Vec2 } from "./Vec2";

export const Rect = {
  /**
   * Create a normalized rectangle spanning two points.
   *
   * @param a - First corner.
   * @param b - Opposite corner.
   * @returns A rectangle whose left/top/right/bottom values are ordered.
   */
  fromPoints(a: Point2D, b: Point2D): Rect2D {
    const min = Vec2.min(a, b);
    const max = Vec2.max(a, b);

    return {
      x: min.x,
      y: min.y,
      width: max.x - min.x,
      height: max.y - min.y,
      left: min.x,
      top: min.y,
      right: max.x,
      bottom: max.y,
    };
  },

  /**
   * Test whether a point lies inside or on the edge of a rectangle.
   *
   * @param rect - Rectangle to test.
   * @param point - Point to test.
   * @returns `true` when the point is inside the rectangle or on its edge.
   */
  containsPoint(rect: Rect2D, point: Point2D): boolean {
    return (
      point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
    );
  },
} as const;
