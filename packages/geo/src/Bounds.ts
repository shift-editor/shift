import type { Point2D, Rect2D } from "./types";

export interface Bounds {
  readonly min: { readonly x: number; readonly y: number };
  readonly max: { readonly x: number; readonly y: number };
}

export const Bounds = {
  // ============================================
  // Construction
  // ============================================

  create(min: Point2D, max: Point2D): Bounds {
    return { min: { x: min.x, y: min.y }, max: { x: max.x, y: max.y } };
  },

  fromPoint(p: Point2D): Bounds {
    return { min: { x: p.x, y: p.y }, max: { x: p.x, y: p.y } };
  },

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

  fromXYWH(x: number, y: number, w: number, h: number): Bounds {
    return { min: { x, y }, max: { x: x + w, y: y + h } };
  },

  // ============================================
  // Composition
  // ============================================

  union(a: Bounds, b: Bounds): Bounds {
    return {
      min: { x: Math.min(a.min.x, b.min.x), y: Math.min(a.min.y, b.min.y) },
      max: { x: Math.max(a.max.x, b.max.x), y: Math.max(a.max.y, b.max.y) },
    };
  },

  unionAll(bounds: readonly (Bounds | null)[]): Bounds | null {
    let result: Bounds | null = null;
    for (const b of bounds) {
      if (b === null) continue;
      result = result === null ? b : Bounds.union(result, b);
    }
    return result;
  },

  includePoint(b: Bounds, p: Point2D): Bounds {
    return {
      min: { x: Math.min(b.min.x, p.x), y: Math.min(b.min.y, p.y) },
      max: { x: Math.max(b.max.x, p.x), y: Math.max(b.max.y, p.y) },
    };
  },

  // ============================================
  // Derived Properties
  // ============================================

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

  // ============================================
  // Queries
  // ============================================

  containsPoint(b: Bounds, p: Point2D): boolean {
    return p.x >= b.min.x && p.x <= b.max.x && p.y >= b.min.y && p.y <= b.max.y;
  },

  overlaps(a: Bounds, b: Bounds): boolean {
    return a.min.x <= b.max.x && a.max.x >= b.min.x && a.min.y <= b.max.y && a.max.y >= b.min.y;
  },

  // ============================================
  // Transform
  // ============================================

  expand(b: Bounds, padding: number): Bounds {
    return {
      min: { x: b.min.x - padding, y: b.min.y - padding },
      max: { x: b.max.x + padding, y: b.max.y + padding },
    };
  },

  // ============================================
  // Conversion
  // ============================================

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
