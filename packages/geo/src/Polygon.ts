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
  signedArea(points: Point2D[]): number {
    if (points.length < 3) return 0;

    let sum = 0;
    for (let i = 0; i < points.length; i++) {
      const p1 = points[i];
      const p2 = points[(i + 1) % points.length];
      sum += (p2.x - p1.x) * (p2.y + p1.y);
    }

    return sum / 2;
  },

  /**
   * Calculate the absolute area of a polygon.
   */
  area(points: Point2D[]): number {
    return Math.abs(Polygon.signedArea(points));
  },

  /**
   * Check if a polygon is wound clockwise using the shoelace formula.
   * Returns true for clockwise, false for counter-clockwise.
   * Returns true for degenerate polygons (fewer than 3 points).
   */
  isClockwise(points: Point2D[]): boolean {
    if (points.length < 3) return true;
    return Polygon.signedArea(points) > 0;
  },

  /**
   * Check if a polygon is wound counter-clockwise.
   */
  isCounterClockwise(points: Point2D[]): boolean {
    if (points.length < 3) return false;
    return Polygon.signedArea(points) < 0;
  },

  /**
   * Calculate the axis-aligned bounding rectangle of a set of points.
   * Returns null for empty arrays.
   */
  boundingRect(points: Point2D[]): Rect2D | null {
    if (points.length === 0) return null;

    let minX = points[0].x;
    let minY = points[0].y;
    let maxX = points[0].x;
    let maxY = points[0].y;

    for (let i = 1; i < points.length; i++) {
      const p = points[i];
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
