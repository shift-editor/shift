/**
 * Contours - Utility functions for contour queries
 *
 * A functional namespace for querying contour data structures.
 * Works with the Contour type from @shift/types.
 *
 * Design principles:
 * - Pure functions (no mutation)
 * - Works with readonly Contour objects
 * - No class instantiation overhead
 * - Tree-shakeable (import only what you need)
 *
 * @example
 * ```ts
 * import { Contours } from '@shift/geo';
 *
 * const first = Contours.firstPoint(contour);
 * const last = Contours.lastOnCurvePoint(contour);
 * const isOpen = Contours.isOpen(contour);
 * ```
 */

import type { Point, Contour, PointId } from "@shift/types";

export const Contours = {
  /**
   * Get the first point of a contour
   */
  firstPoint(contour: Contour): Point | null {
    return contour.points[0] ?? null;
  },

  /**
   * Get the last point of a contour
   */
  lastPoint(contour: Contour): Point | null {
    const { points } = contour;
    return points[points.length - 1] ?? null;
  },

  /**
   * Get the first on-curve point of a contour
   */
  firstOnCurvePoint(contour: Contour): Point | null {
    for (const point of contour.points) {
      if (point.pointType === "onCurve") {
        return point;
      }
    }
    return null;
  },

  /**
   * Get the last on-curve point of a contour
   */
  lastOnCurvePoint(contour: Contour): Point | null {
    const { points } = contour;
    for (let i = points.length - 1; i >= 0; i--) {
      if (points[i].pointType === "onCurve") {
        return points[i];
      }
    }
    return null;
  },

  /**
   * Get all on-curve points in a contour
   */
  getOnCurvePoints(contour: Contour): readonly Point[] {
    return contour.points.filter((p) => p.pointType === "onCurve");
  },

  /**
   * Get all off-curve (control) points in a contour
   */
  getOffCurvePoints(contour: Contour): readonly Point[] {
    return contour.points.filter((p) => p.pointType === "offCurve");
  },

  /**
   * Find a point by its ID within a contour
   */
  findPointById(contour: Contour, id: PointId): Point | null {
    return contour.points.find((p) => p.id === id) ?? null;
  },

  /**
   * Find the index of a point by its ID within a contour
   * Returns -1 if not found
   */
  findPointIndex(contour: Contour, id: PointId): number {
    return contour.points.findIndex((p) => p.id === id);
  },

  /**
   * Check if a contour is open (not closed)
   */
  isOpen(contour: Contour): boolean {
    return !contour.closed;
  },

  /**
   * Check if a contour has no points
   */
  isEmpty(contour: Contour): boolean {
    return contour.points.length === 0;
  },

  /**
   * Check if a contour has interior points (points that are not endpoints).
   * For open contours, this means at least 3 points.
   */
  hasInteriorPoints(contour: Contour): boolean {
    return contour.points.length >= 3;
  },

  /**
   * Get the number of points in a contour
   */
  pointCount(contour: Contour): number {
    return contour.points.length;
  },

  /**
   * Get a point by index, optionally wrapping for closed contours.
   */
  at(contour: Contour, index: number, wrap = contour.closed): Point | null {
    const { points } = contour;
    if (index >= 0 && index < points.length) return points[index];
    if (!wrap || points.length === 0) return null;
    const wrapped = ((index % points.length) + points.length) % points.length;
    return points[wrapped];
  },

  /**
   * Get neighbors around an index.
   */
  neighbors(contour: Contour, index: number): { prev: Point | null; next: Point | null } {
    return {
      prev: Contours.at(contour, index - 1),
      next: Contours.at(contour, index + 1),
    };
  },
} as const;
