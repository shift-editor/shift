/**
 * Axis-aligned bounding box utilities.
 *
 * The `Bounds` symbol serves double duty: the **interface** describes an
 * immutable min/max box, while the **namespace object** provides pure
 * functions to construct, combine, query, and convert bounds.
 *
 * All functions are non-mutating and return new objects.
 *
 * @module
 */
import type { Point2D, Rect2D } from "./types";

/**
 * Axis-aligned bounding box defined by its minimum and maximum corners.
 *
 * In screen/canvas space, `min` is the top-left corner and `max` is the
 * bottom-right. In UPM space (y-up), `min.y` is the bottom and `max.y`
 * is the top.
 */
export interface Bounds {
  readonly min: { readonly x: number; readonly y: number };
  readonly max: { readonly x: number; readonly y: number };
}

export const Bounds = {
  /** Create a bounds from explicit min and max corners. */
  create(min: Point2D, max: Point2D): Bounds {
    return { min: { x: min.x, y: min.y }, max: { x: max.x, y: max.y } };
  },

  /** Create a zero-area bounds located at a single point. */
  fromPoint(p: Point2D): Bounds {
    return { min: { x: p.x, y: p.y }, max: { x: p.x, y: p.y } };
  },

  /**
   * Compute the tightest bounds enclosing all given points.
   * @returns `null` when the array is empty.
   */
  fromPoints(points: readonly Point2D[]): Bounds | null {
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

    return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
  },

  /** Create bounds from an origin and dimensions (x, y, width, height). */
  fromXYWH(x: number, y: number, w: number, h: number): Bounds {
    return { min: { x, y }, max: { x: x + w, y: y + h } };
  },

  // ============================================
  // Composition
  // ============================================

  /** Return the smallest bounds that contains both `a` and `b`. */
  union(a: Bounds, b: Bounds): Bounds {
    return {
      min: { x: Math.min(a.min.x, b.min.x), y: Math.min(a.min.y, b.min.y) },
      max: { x: Math.max(a.max.x, b.max.x), y: Math.max(a.max.y, b.max.y) },
    };
  },

  /**
   * Merge an array of nullable bounds into one. Skips `null` entries.
   * @returns `null` when every entry is `null`.
   */
  unionAll(bounds: readonly (Bounds | null)[]): Bounds | null {
    let result: Bounds | null = null;
    for (const b of bounds) {
      if (b === null) continue;
      result = result === null ? b : Bounds.union(result, b);
    }
    return result;
  },

  /** Expand bounds just enough to include the given point. */
  includePoint(b: Bounds, p: Point2D): Bounds {
    return {
      min: { x: Math.min(b.min.x, p.x), y: Math.min(b.min.y, p.y) },
      max: { x: Math.max(b.max.x, p.x), y: Math.max(b.max.y, p.y) },
    };
  },

  width(b: Bounds): number {
    return b.max.x - b.min.x;
  },

  height(b: Bounds): number {
    return b.max.y - b.min.y;
  },

  center(b: Bounds): Point2D {
    return {
      x: (b.min.x + b.max.x) / 2,
      y: (b.min.y + b.max.y) / 2,
    };
  },

  /** Test whether a point lies inside or on the edge of the bounds. */
  containsPoint(b: Bounds, p: Point2D): boolean {
    return p.x >= b.min.x && p.x <= b.max.x && p.y >= b.min.y && p.y <= b.max.y;
  },

  /** Test whether two bounds overlap (inclusive of touching edges). */
  overlaps(a: Bounds, b: Bounds): boolean {
    return a.min.x <= b.max.x && a.max.x >= b.min.x && a.min.y <= b.max.y && a.max.y >= b.min.y;
  },

  /** Grow the bounds outward by `padding` on every side. Use a negative value to shrink. */
  expand(b: Bounds, padding: number): Bounds {
    return {
      min: { x: b.min.x - padding, y: b.min.y - padding },
      max: { x: b.max.x + padding, y: b.max.y + padding },
    };
  },

  /** Convert to a {@link Rect2D} with x/y/width/height and edge accessors. */
  toRect(b: Bounds): Rect2D {
    return {
      x: b.min.x,
      y: b.min.y,
      width: b.max.x - b.min.x,
      height: b.max.y - b.min.y,
      left: b.min.x,
      top: b.min.y,
      right: b.max.x,
      bottom: b.max.y,
    };
  },
} as const;
