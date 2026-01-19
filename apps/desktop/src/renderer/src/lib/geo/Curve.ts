/**
 * Curve - Pure Geometry Primitives for Bezier Math
 *
 * This module provides types and operations for geometric curves:
 * - Line: A straight line between two points
 * - Quadratic: A quadratic Bezier curve
 * - Cubic: A cubic Bezier curve
 *
 * These are pure geometry types without identity (no IDs).
 * For font editing segments with point IDs, see types/segments.ts.
 *
 * @example
 * ```ts
 * import { Curve } from '@/lib/geo';
 *
 * // Create curves
 * const line = Curve.line({ x: 0, y: 0 }, { x: 100, y: 100 });
 * const cubic = Curve.cubic(p0, c0, c1, p1);
 *
 * // Evaluate point at t=0.5
 * const midpoint = Curve.pointAt(cubic, 0.5);
 *
 * // Find closest point (for hit testing)
 * const closest = Curve.closestPoint(cubic, mousePos);
 * ```
 */

import type { Point2D } from "@/types/math";
import { Vec2 } from "./Vec2";

// ============================================
// Types
// ============================================

/**
 * A straight line between two points.
 */
export interface LineCurve {
  readonly type: "line";
  readonly p0: Point2D;
  readonly p1: Point2D;
}

/**
 * A quadratic Bezier curve (one control point).
 */
export interface QuadraticCurve {
  readonly type: "quadratic";
  readonly p0: Point2D;
  readonly c: Point2D;
  readonly p1: Point2D;
}

/**
 * A cubic Bezier curve (two control points).
 */
export interface CubicCurve {
  readonly type: "cubic";
  readonly p0: Point2D;
  readonly c0: Point2D;
  readonly c1: Point2D;
  readonly p1: Point2D;
}

/**
 * Any curve type.
 */
export type CurveType = LineCurve | QuadraticCurve | CubicCurve;

/**
 * Result of a closest-point query.
 */
export interface ClosestPointResult {
  /** Parameter t where the closest point lies (0 to 1) */
  t: number;
  /** The closest point on the curve */
  point: Point2D;
  /** Distance from query point to closest point */
  distance: number;
}

// ============================================
// Constants
// ============================================

const CURVE_SUBDIVISIONS = 32;
const NEWTON_TOLERANCE = 1e-6;
const NEWTON_MAX_ITERATIONS = 8;

// ============================================
// Curve Namespace
// ============================================

export const Curve = {
  // ============================================
  // Construction
  // ============================================

  line(p0: Point2D, p1: Point2D): LineCurve {
    return { type: "line", p0, p1 };
  },

  quadratic(p0: Point2D, c: Point2D, p1: Point2D): QuadraticCurve {
    return { type: "quadratic", p0, c, p1 };
  },

  cubic(p0: Point2D, c0: Point2D, c1: Point2D, p1: Point2D): CubicCurve {
    return { type: "cubic", p0, c0, c1, p1 };
  },

  // ============================================
  // Evaluation
  // ============================================

  /**
   * Get point on curve at parameter t (0 to 1).
   */
  pointAt(curve: CurveType, t: number): Point2D {
    switch (curve.type) {
      case "line":
        return Vec2.lerp(curve.p0, curve.p1, t);
      case "quadratic":
        return quadraticPointAt(curve, t);
      case "cubic":
        return cubicPointAt(curve, t);
    }
  },

  /**
   * Get tangent vector at parameter t (not normalized).
   */
  tangentAt(curve: CurveType, t: number): Point2D {
    switch (curve.type) {
      case "line":
        return Vec2.sub(curve.p1, curve.p0);
      case "quadratic":
        return quadraticTangentAt(curve, t);
      case "cubic":
        return cubicTangentAt(curve, t);
    }
  },

  /**
   * Get the unit tangent (normalized) at parameter t.
   */
  unitTangentAt(curve: CurveType, t: number): Point2D {
    return Vec2.normalize(Curve.tangentAt(curve, t));
  },

  /**
   * Get the unit normal (perpendicular to tangent) at parameter t.
   */
  normalAt(curve: CurveType, t: number): Point2D {
    const tangent = Vec2.normalize(Curve.tangentAt(curve, t));
    return Vec2.perp(tangent);
  },

  // ============================================
  // Closest Point (for hit testing)
  // ============================================

  /**
   * Find closest point on curve to a test point.
   * Uses Newton-Raphson refinement for accuracy.
   */
  closestPoint(curve: CurveType, point: Point2D): ClosestPointResult {
    switch (curve.type) {
      case "line":
        return lineClosestPoint(curve, point);
      case "quadratic":
        return quadraticClosestPoint(curve, point);
      case "cubic":
        return cubicClosestPoint(curve, point);
    }
  },

  /**
   * Get distance from point to curve.
   */
  distanceTo(curve: CurveType, point: Point2D): number {
    return Curve.closestPoint(curve, point).distance;
  },

  // ============================================
  // Properties
  // ============================================

  startPoint(curve: CurveType): Point2D {
    return curve.p0;
  },

  endPoint(curve: CurveType): Point2D {
    return curve.p1;
  },

  /**
   * Approximate curve length.
   */
  length(curve: CurveType): number {
    if (curve.type === "line") {
      return Vec2.dist(curve.p0, curve.p1);
    }
    return curveLength(curve, CURVE_SUBDIVISIONS);
  },

  /**
   * Get axis-aligned bounding box.
   */
  bounds(curve: CurveType): { min: Point2D; max: Point2D } {
    switch (curve.type) {
      case "line":
        return {
          min: Vec2.min(curve.p0, curve.p1),
          max: Vec2.max(curve.p0, curve.p1),
        };
      case "quadratic":
        return quadraticBounds(curve);
      case "cubic":
        return cubicBounds(curve);
    }
  },

  // ============================================
  // Subdivision
  // ============================================

  /**
   * Split curve at parameter t using De Casteljau's algorithm.
   */
  splitAt(curve: CurveType, t: number): [CurveType, CurveType] {
    switch (curve.type) {
      case "line": {
        const mid = Vec2.lerp(curve.p0, curve.p1, t);
        return [Curve.line(curve.p0, mid), Curve.line(mid, curve.p1)];
      }
      case "quadratic":
        return quadraticSplitAt(curve, t);
      case "cubic":
        return cubicSplitAt(curve, t);
    }
  },

  /**
   * Convert quadratic to cubic (lossless).
   */
  quadraticToCubic(curve: QuadraticCurve): CubicCurve {
    const c0 = Vec2.lerp(curve.p0, curve.c, 2 / 3);
    const c1 = Vec2.lerp(curve.p1, curve.c, 2 / 3);
    return Curve.cubic(curve.p0, c0, c1, curve.p1);
  },

  /**
   * Sample points along the curve at regular parameter intervals.
   */
  sample(curve: CurveType, count: number): Point2D[] {
    const points: Point2D[] = [];
    for (let i = 0; i <= count; i++) {
      points.push(Curve.pointAt(curve, i / count));
    }
    return points;
  },

  // ============================================
  // Type Guards
  // ============================================

  isLine(curve: CurveType): curve is LineCurve {
    return curve.type === "line";
  },

  isQuadratic(curve: CurveType): curve is QuadraticCurve {
    return curve.type === "quadratic";
  },

  isCubic(curve: CurveType): curve is CubicCurve {
    return curve.type === "cubic";
  },
} as const;

// ============================================
// Quadratic Implementation
// ============================================

function quadraticPointAt(curve: QuadraticCurve, t: number): Point2D {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  return {
    x: mt2 * curve.p0.x + 2 * mt * t * curve.c.x + t2 * curve.p1.x,
    y: mt2 * curve.p0.y + 2 * mt * t * curve.c.y + t2 * curve.p1.y,
  };
}

function quadraticTangentAt(curve: QuadraticCurve, t: number): Point2D {
  const mt = 1 - t;
  return {
    x: 2 * mt * (curve.c.x - curve.p0.x) + 2 * t * (curve.p1.x - curve.c.x),
    y: 2 * mt * (curve.c.y - curve.p0.y) + 2 * t * (curve.p1.y - curve.c.y),
  };
}

function quadraticClosestPoint(
  curve: QuadraticCurve,
  point: Point2D,
): ClosestPointResult {
  let bestT = 0;
  let bestDist = Infinity;

  for (let i = 0; i <= CURVE_SUBDIVISIONS; i++) {
    const t = i / CURVE_SUBDIVISIONS;
    const p = quadraticPointAt(curve, t);
    const dist = Vec2.distSq(point, p);
    if (dist < bestDist) {
      bestDist = dist;
      bestT = t;
    }
  }

  bestT = newtonRaphsonQuadratic(curve, point, bestT);
  const closest = quadraticPointAt(curve, bestT);
  return { t: bestT, point: closest, distance: Vec2.dist(point, closest) };
}

function quadraticBounds(curve: QuadraticCurve): {
  min: Point2D;
  max: Point2D;
} {
  let minX = Math.min(curve.p0.x, curve.p1.x);
  let maxX = Math.max(curve.p0.x, curve.p1.x);
  let minY = Math.min(curve.p0.y, curve.p1.y);
  let maxY = Math.max(curve.p0.y, curve.p1.y);

  const denomX = curve.p0.x - 2 * curve.c.x + curve.p1.x;
  if (Math.abs(denomX) > 1e-10) {
    const tx = (curve.p0.x - curve.c.x) / denomX;
    if (tx > 0 && tx < 1) {
      const x = quadraticPointAt(curve, tx).x;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
  }

  const denomY = curve.p0.y - 2 * curve.c.y + curve.p1.y;
  if (Math.abs(denomY) > 1e-10) {
    const ty = (curve.p0.y - curve.c.y) / denomY;
    if (ty > 0 && ty < 1) {
      const y = quadraticPointAt(curve, ty).y;
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }

  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}

function quadraticSplitAt(
  curve: QuadraticCurve,
  t: number,
): [QuadraticCurve, QuadraticCurve] {
  const p01 = Vec2.lerp(curve.p0, curve.c, t);
  const p12 = Vec2.lerp(curve.c, curve.p1, t);
  const p012 = Vec2.lerp(p01, p12, t);
  return [
    Curve.quadratic(curve.p0, p01, p012),
    Curve.quadratic(p012, p12, curve.p1),
  ];
}

function newtonRaphsonQuadratic(
  curve: QuadraticCurve,
  point: Point2D,
  initialT: number,
): number {
  let t = initialT;

  for (let i = 0; i < NEWTON_MAX_ITERATIONS; i++) {
    const p = quadraticPointAt(curve, t);
    const d = quadraticTangentAt(curve, t);
    const diff = Vec2.sub(p, point);
    const f = Vec2.dot(diff, d);

    const dd = {
      x: 2 * (curve.p0.x - 2 * curve.c.x + curve.p1.x),
      y: 2 * (curve.p0.y - 2 * curve.c.y + curve.p1.y),
    };
    const df = Vec2.dot(d, d) + Vec2.dot(diff, dd);

    if (Math.abs(df) < 1e-10) break;

    const newT = t - f / df;
    const clampedT = Math.max(0, Math.min(1, newT));
    if (Math.abs(clampedT - t) < NEWTON_TOLERANCE) break;
    t = clampedT;
  }

  return t;
}

// ============================================
// Cubic Implementation
// ============================================

function cubicPointAt(curve: CubicCurve, t: number): Point2D {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  const t2 = t * t;
  const t3 = t2 * t;

  return {
    x:
      mt3 * curve.p0.x +
      3 * mt2 * t * curve.c0.x +
      3 * mt * t2 * curve.c1.x +
      t3 * curve.p1.x,
    y:
      mt3 * curve.p0.y +
      3 * mt2 * t * curve.c0.y +
      3 * mt * t2 * curve.c1.y +
      t3 * curve.p1.y,
  };
}

function cubicTangentAt(curve: CubicCurve, t: number): Point2D {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;

  return {
    x:
      3 * mt2 * (curve.c0.x - curve.p0.x) +
      6 * mt * t * (curve.c1.x - curve.c0.x) +
      3 * t2 * (curve.p1.x - curve.c1.x),
    y:
      3 * mt2 * (curve.c0.y - curve.p0.y) +
      6 * mt * t * (curve.c1.y - curve.c0.y) +
      3 * t2 * (curve.p1.y - curve.c1.y),
  };
}

function cubicSecondDerivativeAt(curve: CubicCurve, t: number): Point2D {
  const mt = 1 - t;
  return {
    x:
      6 * mt * (curve.c1.x - 2 * curve.c0.x + curve.p0.x) +
      6 * t * (curve.p1.x - 2 * curve.c1.x + curve.c0.x),
    y:
      6 * mt * (curve.c1.y - 2 * curve.c0.y + curve.p0.y) +
      6 * t * (curve.p1.y - 2 * curve.c1.y + curve.c0.y),
  };
}

function cubicClosestPoint(
  curve: CubicCurve,
  point: Point2D,
): ClosestPointResult {
  let bestT = 0;
  let bestDist = Infinity;

  for (let i = 0; i <= CURVE_SUBDIVISIONS; i++) {
    const t = i / CURVE_SUBDIVISIONS;
    const p = cubicPointAt(curve, t);
    const dist = Vec2.distSq(point, p);
    if (dist < bestDist) {
      bestDist = dist;
      bestT = t;
    }
  }

  bestT = newtonRaphsonCubic(curve, point, bestT);
  const closest = cubicPointAt(curve, bestT);
  return { t: bestT, point: closest, distance: Vec2.dist(point, closest) };
}

function newtonRaphsonCubic(
  curve: CubicCurve,
  point: Point2D,
  initialT: number,
): number {
  let t = initialT;

  for (let i = 0; i < NEWTON_MAX_ITERATIONS; i++) {
    const p = cubicPointAt(curve, t);
    const d = cubicTangentAt(curve, t);
    const dd = cubicSecondDerivativeAt(curve, t);

    const diff = Vec2.sub(p, point);
    const f = Vec2.dot(diff, d);
    const df = Vec2.dot(d, d) + Vec2.dot(diff, dd);

    if (Math.abs(df) < 1e-10) break;

    const newT = t - f / df;
    const clampedT = Math.max(0, Math.min(1, newT));
    if (Math.abs(clampedT - t) < NEWTON_TOLERANCE) break;
    t = clampedT;
  }

  return t;
}

function cubicBounds(curve: CubicCurve): { min: Point2D; max: Point2D } {
  let minX = Math.min(curve.p0.x, curve.p1.x);
  let maxX = Math.max(curve.p0.x, curve.p1.x);
  let minY = Math.min(curve.p0.y, curve.p1.y);
  let maxY = Math.max(curve.p0.y, curve.p1.y);

  const extremaX = findCubicExtrema(
    curve.p0.x,
    curve.c0.x,
    curve.c1.x,
    curve.p1.x,
  );
  const extremaY = findCubicExtrema(
    curve.p0.y,
    curve.c0.y,
    curve.c1.y,
    curve.p1.y,
  );

  for (const t of extremaX) {
    if (t > 0 && t < 1) {
      const x = cubicPointAt(curve, t).x;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
  }

  for (const t of extremaY) {
    if (t > 0 && t < 1) {
      const y = cubicPointAt(curve, t).y;
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }

  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}

function findCubicExtrema(
  p0: number,
  c0: number,
  c1: number,
  p1: number,
): number[] {
  const a = -3 * p0 + 9 * c0 - 9 * c1 + 3 * p1;
  const b = 6 * p0 - 12 * c0 + 6 * c1;
  const c = -3 * p0 + 3 * c0;

  const roots: number[] = [];

  if (Math.abs(a) < 1e-10) {
    if (Math.abs(b) > 1e-10) {
      roots.push(-c / b);
    }
  } else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant >= 0) {
      const sqrtD = Math.sqrt(discriminant);
      roots.push((-b + sqrtD) / (2 * a));
      roots.push((-b - sqrtD) / (2 * a));
    }
  }

  return roots;
}

function cubicSplitAt(curve: CubicCurve, t: number): [CubicCurve, CubicCurve] {
  const p01 = Vec2.lerp(curve.p0, curve.c0, t);
  const p12 = Vec2.lerp(curve.c0, curve.c1, t);
  const p23 = Vec2.lerp(curve.c1, curve.p1, t);

  const p012 = Vec2.lerp(p01, p12, t);
  const p123 = Vec2.lerp(p12, p23, t);

  const p0123 = Vec2.lerp(p012, p123, t);

  return [
    Curve.cubic(curve.p0, p01, p012, p0123),
    Curve.cubic(p0123, p123, p23, curve.p1),
  ];
}

// ============================================
// Line Implementation
// ============================================

function lineClosestPoint(
  curve: LineCurve,
  point: Point2D,
): ClosestPointResult {
  const v = Vec2.sub(curve.p1, curve.p0);
  const w = Vec2.sub(point, curve.p0);

  const c1 = Vec2.dot(w, v);
  if (c1 <= 0) {
    return { t: 0, point: curve.p0, distance: Vec2.dist(point, curve.p0) };
  }

  const c2 = Vec2.dot(v, v);
  if (c2 <= c1) {
    return { t: 1, point: curve.p1, distance: Vec2.dist(point, curve.p1) };
  }

  const t = c1 / c2;
  const closest = Vec2.lerp(curve.p0, curve.p1, t);
  return { t, point: closest, distance: Vec2.dist(point, closest) };
}

// ============================================
// Utility
// ============================================

function curveLength(
  curve: QuadraticCurve | CubicCurve,
  subdivisions: number,
): number {
  let length = 0;
  let prevPoint = Curve.pointAt(curve, 0);

  for (let i = 1; i <= subdivisions; i++) {
    const t = i / subdivisions;
    const point = Curve.pointAt(curve, t);
    length += Vec2.dist(prevPoint, point);
    prevPoint = point;
  }

  return length;
}
