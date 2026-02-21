/**
 * Polygon - 2D Polygon Operations
 *
 * A functional namespace for operations on 2D polygons (arrays of points).
 * All operations are pure and work with arrays of Point2D objects.
 *
 * @example
 * ```ts
 * import { Polygon } from '@shift/geo';
 *
 * const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
 * const cw = Polygon.isClockwise(points);
 * const area = Polygon.area(points);
 * ```
 */

import type { Point2D, Rect2D } from "./types";

export const Polygon = {
  /**
   * Calculate the signed area of a polygon using the shoelace formula.
   * Positive for clockwise winding, negative for counter-clockwise.
   */
  signedArea(points: readonly Point2D[]): number {
    if (points.length < 3) return 0;

    const first = points[0];
    if (!first) return 0;

    let sum = 0;
    let previous = first;
    for (const current of points.slice(1)) {
      sum += (current.x - previous.x) * (current.y + previous.y);
      previous = current;
    }
    sum += (first.x - previous.x) * (first.y + previous.y);

    return sum / 2;
  },

  /**
   * Calculate the absolute area of a polygon.
   */
  area(points: readonly Point2D[]): number {
    return Math.abs(Polygon.signedArea(points));
  },

  /**
   * Check if a polygon is wound clockwise using the shoelace formula.
   * Returns true for clockwise, false for counter-clockwise.
   * Returns true for degenerate polygons (fewer than 3 points).
   */
  isClockwise(points: readonly Point2D[]): boolean {
    if (points.length < 3) return true;
    return Polygon.signedArea(points) > 0;
  },

  /**
   * Check if a polygon is wound counter-clockwise.
   */
  isCounterClockwise(points: readonly Point2D[]): boolean {
    if (points.length < 3) return false;
    return Polygon.signedArea(points) < 0;
  },

  /**
   * Calculate the axis-aligned bounding rectangle of a set of points.
   * Returns null for empty arrays.
   */
  boundingRect(points: readonly Point2D[]): Rect2D | null {
    if (points.length === 0) return null;

    const first = points[0];
    if (!first) return null;

    let minX = first.x;
    let minY = first.y;
    let maxX = first.x;
    let maxY = first.y;

    for (const p of points.slice(1)) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
      left: minX,
      top: minY,
      right: maxX,
      bottom: maxY,
    };
  },
} as const;
