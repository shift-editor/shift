/**
 * Segment - Line and Cubic Bezier Curve Primitives
 *
 * This module provides types and operations for geometric segments:
 * - LineSegment: A straight line between two points
 * - CubicSegment: A cubic Bezier curve with two control points
 *
 * These primitives are essential for hit testing, path rendering, and snapping.
 *
 * @example
 * ```ts
 * import { Segment } from '@/lib/geo/Segment';
 *
 * // Create a line segment
 * const line = Segment.line({ x: 0, y: 0 }, { x: 100, y: 100 });
 *
 * // Create a cubic bezier
 * const curve = Segment.cubic(
 *   { x: 0, y: 0 },     // start
 *   { x: 30, y: 50 },   // control point 1
 *   { x: 70, y: 50 },   // control point 2
 *   { x: 100, y: 0 }    // end
 * );
 *
 * // Evaluate point at t=0.5
 * const midpoint = Segment.pointAt(curve, 0.5);
 *
 * // Find closest point to a test point
 * const closest = Segment.closestPoint(curve, { x: 50, y: 30 });
 * ```
 */

import type { Point2D } from '@/types/math';
import { Vec2 } from './Vec2';

// ============================================
// Types
// ============================================

/**
 * A straight line segment between two points.
 */
export interface LineSegment {
  readonly type: 'line';
  readonly p0: Point2D; // Start point
  readonly p1: Point2D; // End point
}

/**
 * A cubic Bezier curve defined by four points.
 * The curve starts at p0, ends at p1, and is shaped by control points c0 and c1.
 */
export interface CubicSegment {
  readonly type: 'cubic';
  readonly p0: Point2D; // Start point (on curve)
  readonly c0: Point2D; // First control point (off curve)
  readonly c1: Point2D; // Second control point (off curve)
  readonly p1: Point2D; // End point (on curve)
}

/**
 * A quadratic Bezier curve defined by three points.
 * The curve starts at p0, ends at p1, and is shaped by control point c.
 */
export interface QuadraticSegment {
  readonly type: 'quadratic';
  readonly p0: Point2D; // Start point (on curve)
  readonly c: Point2D; // Control point (off curve)
  readonly p1: Point2D; // End point (on curve)
}

/**
 * Union type for all segment types.
 */
export type Segment = LineSegment | CubicSegment | QuadraticSegment;

/**
 * Result of a closest-point query.
 */
export interface ClosestPointResult {
  /** The parameter t where the closest point lies (0 to 1) */
  t: number;
  /** The closest point on the segment */
  point: Point2D;
  /** The distance from the query point to the closest point */
  distance: number;
}

// ============================================
// Constants
// ============================================

/** Number of subdivisions for iterative curve operations */
const CURVE_SUBDIVISIONS = 32;

/** Tolerance for Newton-Raphson refinement */
const NEWTON_TOLERANCE = 1e-6;

/** Maximum iterations for Newton-Raphson */
const NEWTON_MAX_ITERATIONS = 8;

// ============================================
// Segment Namespace
// ============================================

export const Segment = {
  // ============================================
  // Construction
  // ============================================

  /**
   * Create a line segment.
   */
  line(p0: Point2D, p1: Point2D): LineSegment {
    return { type: 'line', p0, p1 };
  },

  /**
   * Create a cubic Bezier segment.
   */
  cubic(p0: Point2D, c0: Point2D, c1: Point2D, p1: Point2D): CubicSegment {
    return { type: 'cubic', p0, c0, c1, p1 };
  },

  /**
   * Create a quadratic Bezier segment.
   */
  quadratic(p0: Point2D, c: Point2D, p1: Point2D): QuadraticSegment {
    return { type: 'quadratic', p0, c, p1 };
  },

  // ============================================
  // Evaluation
  // ============================================

  /**
   * Get a point on the segment at parameter t (0 to 1).
   * t=0 returns the start point, t=1 returns the end point.
   */
  pointAt(seg: Segment, t: number): Point2D {
    switch (seg.type) {
      case 'line':
        return linePointAt(seg, t);
      case 'quadratic':
        return quadraticPointAt(seg, t);
      case 'cubic':
        return cubicPointAt(seg, t);
    }
  },

  /**
   * Get the tangent vector at parameter t (not normalized).
   */
  tangentAt(seg: Segment, t: number): Point2D {
    switch (seg.type) {
      case 'line':
        return lineTangent(seg);
      case 'quadratic':
        return quadraticTangentAt(seg, t);
      case 'cubic':
        return cubicTangentAt(seg, t);
    }
  },

  /**
   * Get the unit tangent (normalized) at parameter t.
   */
  unitTangentAt(seg: Segment, t: number): Point2D {
    return Vec2.normalize(Segment.tangentAt(seg, t));
  },

  /**
   * Get the unit normal (perpendicular to tangent) at parameter t.
   */
  normalAt(seg: Segment, t: number): Point2D {
    const tangent = Vec2.normalize(Segment.tangentAt(seg, t));
    return Vec2.perp(tangent);
  },

  // ============================================
  // Closest Point
  // ============================================

  /**
   * Find the closest point on the segment to a test point.
   * Returns the parameter t, the closest point, and the distance.
   */
  closestPoint(seg: Segment, point: Point2D): ClosestPointResult {
    switch (seg.type) {
      case 'line':
        return lineClosestPoint(seg, point);
      case 'quadratic':
        return quadraticClosestPoint(seg, point);
      case 'cubic':
        return cubicClosestPoint(seg, point);
    }
  },

  /**
   * Get the distance from a point to the segment.
   */
  distanceTo(seg: Segment, point: Point2D): number {
    return Segment.closestPoint(seg, point).distance;
  },

  // ============================================
  // Properties
  // ============================================

  /**
   * Get the start point of the segment.
   */
  startPoint(seg: Segment): Point2D {
    return seg.p0;
  },

  /**
   * Get the end point of the segment.
   */
  endPoint(seg: Segment): Point2D {
    return seg.p1;
  },

  /**
   * Get the approximate length of the segment.
   * For curves, this uses subdivision for approximation.
   */
  length(seg: Segment): number {
    switch (seg.type) {
      case 'line':
        return Vec2.dist(seg.p0, seg.p1);
      case 'quadratic':
      case 'cubic':
        return curveLength(seg, CURVE_SUBDIVISIONS);
    }
  },

  /**
   * Get the axis-aligned bounding box of the segment.
   */
  bounds(seg: Segment): { min: Point2D; max: Point2D } {
    switch (seg.type) {
      case 'line':
        return lineBounds(seg);
      case 'quadratic':
        return quadraticBounds(seg);
      case 'cubic':
        return cubicBounds(seg);
    }
  },

  // ============================================
  // Subdivision
  // ============================================

  /**
   * Split a segment at parameter t into two segments.
   */
  splitAt(seg: Segment, t: number): [Segment, Segment] {
    switch (seg.type) {
      case 'line':
        return lineSplitAt(seg, t);
      case 'quadratic':
        return quadraticSplitAt(seg, t);
      case 'cubic':
        return cubicSplitAt(seg, t);
    }
  },

  /**
   * Convert a quadratic segment to a cubic segment.
   * This is lossless - the curve shape is preserved exactly.
   */
  quadraticToCubic(seg: QuadraticSegment): CubicSegment {
    // Convert quadratic control point to cubic control points
    // c0 = p0 + 2/3 * (c - p0)
    // c1 = p1 + 2/3 * (c - p1)
    const c0 = Vec2.lerp(seg.p0, seg.c, 2 / 3);
    const c1 = Vec2.lerp(seg.p1, seg.c, 2 / 3);
    return Segment.cubic(seg.p0, c0, c1, seg.p1);
  },

  /**
   * Sample points along the segment at regular parameter intervals.
   */
  sample(seg: Segment, count: number): Point2D[] {
    const points: Point2D[] = [];
    for (let i = 0; i <= count; i++) {
      points.push(Segment.pointAt(seg, i / count));
    }
    return points;
  },

  // ============================================
  // Type Guards
  // ============================================

  isLine(seg: Segment): seg is LineSegment {
    return seg.type === 'line';
  },

  isCubic(seg: Segment): seg is CubicSegment {
    return seg.type === 'cubic';
  },

  isQuadratic(seg: Segment): seg is QuadraticSegment {
    return seg.type === 'quadratic';
  },
} as const;

// ============================================
// Line Segment Implementation
// ============================================

function linePointAt(seg: LineSegment, t: number): Point2D {
  return Vec2.lerp(seg.p0, seg.p1, t);
}

function lineTangent(seg: LineSegment): Point2D {
  return Vec2.sub(seg.p1, seg.p0);
}

function lineClosestPoint(seg: LineSegment, point: Point2D): ClosestPointResult {
  const v = Vec2.sub(seg.p1, seg.p0);
  const w = Vec2.sub(point, seg.p0);

  const c1 = Vec2.dot(w, v);
  if (c1 <= 0) {
    return { t: 0, point: seg.p0, distance: Vec2.dist(point, seg.p0) };
  }

  const c2 = Vec2.dot(v, v);
  if (c2 <= c1) {
    return { t: 1, point: seg.p1, distance: Vec2.dist(point, seg.p1) };
  }

  const t = c1 / c2;
  const closest = Vec2.lerp(seg.p0, seg.p1, t);
  return { t, point: closest, distance: Vec2.dist(point, closest) };
}

function lineBounds(seg: LineSegment): { min: Point2D; max: Point2D } {
  return {
    min: Vec2.min(seg.p0, seg.p1),
    max: Vec2.max(seg.p0, seg.p1),
  };
}

function lineSplitAt(seg: LineSegment, t: number): [LineSegment, LineSegment] {
  const mid = Vec2.lerp(seg.p0, seg.p1, t);
  return [Segment.line(seg.p0, mid), Segment.line(mid, seg.p1)];
}

// ============================================
// Quadratic Bezier Implementation
// ============================================

function quadraticPointAt(seg: QuadraticSegment, t: number): Point2D {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  return {
    x: mt2 * seg.p0.x + 2 * mt * t * seg.c.x + t2 * seg.p1.x,
    y: mt2 * seg.p0.y + 2 * mt * t * seg.c.y + t2 * seg.p1.y,
  };
}

function quadraticTangentAt(seg: QuadraticSegment, t: number): Point2D {
  const mt = 1 - t;
  return {
    x: 2 * mt * (seg.c.x - seg.p0.x) + 2 * t * (seg.p1.x - seg.c.x),
    y: 2 * mt * (seg.c.y - seg.p0.y) + 2 * t * (seg.p1.y - seg.c.y),
  };
}

function quadraticClosestPoint(seg: QuadraticSegment, point: Point2D): ClosestPointResult {
  // Use iterative search followed by Newton-Raphson refinement
  let bestT = 0;
  let bestDist = Infinity;

  // Coarse search
  for (let i = 0; i <= CURVE_SUBDIVISIONS; i++) {
    const t = i / CURVE_SUBDIVISIONS;
    const p = quadraticPointAt(seg, t);
    const dist = Vec2.distSq(point, p);
    if (dist < bestDist) {
      bestDist = dist;
      bestT = t;
    }
  }

  // Newton-Raphson refinement
  bestT = newtonRaphsonQuadratic(seg, point, bestT);

  const closest = quadraticPointAt(seg, bestT);
  return { t: bestT, point: closest, distance: Vec2.dist(point, closest) };
}

function quadraticBounds(seg: QuadraticSegment): { min: Point2D; max: Point2D } {
  // Start with endpoints
  let minX = Math.min(seg.p0.x, seg.p1.x);
  let maxX = Math.max(seg.p0.x, seg.p1.x);
  let minY = Math.min(seg.p0.y, seg.p1.y);
  let maxY = Math.max(seg.p0.y, seg.p1.y);

  // Check for extrema in x: derivative = 0
  // 2(1-t)(c.x - p0.x) + 2t(p1.x - c.x) = 0
  // Solving: t = (p0.x - c.x) / (p0.x - 2*c.x + p1.x)
  const denomX = seg.p0.x - 2 * seg.c.x + seg.p1.x;
  if (Math.abs(denomX) > 1e-10) {
    const tx = (seg.p0.x - seg.c.x) / denomX;
    if (tx > 0 && tx < 1) {
      const x = quadraticPointAt(seg, tx).x;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
  }

  const denomY = seg.p0.y - 2 * seg.c.y + seg.p1.y;
  if (Math.abs(denomY) > 1e-10) {
    const ty = (seg.p0.y - seg.c.y) / denomY;
    if (ty > 0 && ty < 1) {
      const y = quadraticPointAt(seg, ty).y;
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }

  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}

function quadraticSplitAt(
  seg: QuadraticSegment,
  t: number
): [QuadraticSegment, QuadraticSegment] {
  // De Casteljau's algorithm
  const p01 = Vec2.lerp(seg.p0, seg.c, t);
  const p12 = Vec2.lerp(seg.c, seg.p1, t);
  const p012 = Vec2.lerp(p01, p12, t);

  return [Segment.quadratic(seg.p0, p01, p012), Segment.quadratic(p012, p12, seg.p1)];
}

function newtonRaphsonQuadratic(
  seg: QuadraticSegment,
  point: Point2D,
  initialT: number
): number {
  let t = initialT;

  for (let i = 0; i < NEWTON_MAX_ITERATIONS; i++) {
    const p = quadraticPointAt(seg, t);
    const d = quadraticTangentAt(seg, t);

    // f(t) = (p(t) - point) · d(t)
    // f'(t) = d(t) · d(t) + (p(t) - point) · d'(t)
    const diff = Vec2.sub(p, point);
    const f = Vec2.dot(diff, d);

    // Second derivative for quadratic: constant
    const dd = {
      x: 2 * (seg.p0.x - 2 * seg.c.x + seg.p1.x),
      y: 2 * (seg.p0.y - 2 * seg.c.y + seg.p1.y),
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
// Cubic Bezier Implementation
// ============================================

function cubicPointAt(seg: CubicSegment, t: number): Point2D {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  const t2 = t * t;
  const t3 = t2 * t;

  return {
    x: mt3 * seg.p0.x + 3 * mt2 * t * seg.c0.x + 3 * mt * t2 * seg.c1.x + t3 * seg.p1.x,
    y: mt3 * seg.p0.y + 3 * mt2 * t * seg.c0.y + 3 * mt * t2 * seg.c1.y + t3 * seg.p1.y,
  };
}

function cubicTangentAt(seg: CubicSegment, t: number): Point2D {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;

  // First derivative of cubic bezier
  return {
    x:
      3 * mt2 * (seg.c0.x - seg.p0.x) +
      6 * mt * t * (seg.c1.x - seg.c0.x) +
      3 * t2 * (seg.p1.x - seg.c1.x),
    y:
      3 * mt2 * (seg.c0.y - seg.p0.y) +
      6 * mt * t * (seg.c1.y - seg.c0.y) +
      3 * t2 * (seg.p1.y - seg.c1.y),
  };
}

function cubicSecondDerivativeAt(seg: CubicSegment, t: number): Point2D {
  const mt = 1 - t;
  return {
    x:
      6 * mt * (seg.c1.x - 2 * seg.c0.x + seg.p0.x) +
      6 * t * (seg.p1.x - 2 * seg.c1.x + seg.c0.x),
    y:
      6 * mt * (seg.c1.y - 2 * seg.c0.y + seg.p0.y) +
      6 * t * (seg.p1.y - 2 * seg.c1.y + seg.c0.y),
  };
}

function cubicClosestPoint(seg: CubicSegment, point: Point2D): ClosestPointResult {
  // Use iterative search followed by Newton-Raphson refinement
  let bestT = 0;
  let bestDist = Infinity;

  // Coarse search
  for (let i = 0; i <= CURVE_SUBDIVISIONS; i++) {
    const t = i / CURVE_SUBDIVISIONS;
    const p = cubicPointAt(seg, t);
    const dist = Vec2.distSq(point, p);
    if (dist < bestDist) {
      bestDist = dist;
      bestT = t;
    }
  }

  // Newton-Raphson refinement
  bestT = newtonRaphsonCubic(seg, point, bestT);

  const closest = cubicPointAt(seg, bestT);
  return { t: bestT, point: closest, distance: Vec2.dist(point, closest) };
}

function newtonRaphsonCubic(seg: CubicSegment, point: Point2D, initialT: number): number {
  let t = initialT;

  for (let i = 0; i < NEWTON_MAX_ITERATIONS; i++) {
    const p = cubicPointAt(seg, t);
    const d = cubicTangentAt(seg, t);
    const dd = cubicSecondDerivativeAt(seg, t);

    // f(t) = (p(t) - point) · d(t)
    // f'(t) = d(t) · d(t) + (p(t) - point) · d'(t)
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

function cubicBounds(seg: CubicSegment): { min: Point2D; max: Point2D } {
  // Start with endpoints
  let minX = Math.min(seg.p0.x, seg.p1.x);
  let maxX = Math.max(seg.p0.x, seg.p1.x);
  let minY = Math.min(seg.p0.y, seg.p1.y);
  let maxY = Math.max(seg.p0.y, seg.p1.y);

  // Find extrema by solving derivative = 0
  // For x: 3(1-t)²(c0.x-p0.x) + 6(1-t)t(c1.x-c0.x) + 3t²(p1.x-c1.x) = 0
  // This is a quadratic in t
  const extremaX = findCubicExtrema(seg.p0.x, seg.c0.x, seg.c1.x, seg.p1.x);
  const extremaY = findCubicExtrema(seg.p0.y, seg.c0.y, seg.c1.y, seg.p1.y);

  for (const t of extremaX) {
    if (t > 0 && t < 1) {
      const x = cubicPointAt(seg, t).x;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
  }

  for (const t of extremaY) {
    if (t > 0 && t < 1) {
      const y = cubicPointAt(seg, t).y;
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }

  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}

function findCubicExtrema(p0: number, c0: number, c1: number, p1: number): number[] {
  // Derivative coefficients: at² + bt + c = 0
  const a = -3 * p0 + 9 * c0 - 9 * c1 + 3 * p1;
  const b = 6 * p0 - 12 * c0 + 6 * c1;
  const c = -3 * p0 + 3 * c0;

  const roots: number[] = [];

  if (Math.abs(a) < 1e-10) {
    // Linear case
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

function cubicSplitAt(seg: CubicSegment, t: number): [CubicSegment, CubicSegment] {
  // De Casteljau's algorithm
  const p01 = Vec2.lerp(seg.p0, seg.c0, t);
  const p12 = Vec2.lerp(seg.c0, seg.c1, t);
  const p23 = Vec2.lerp(seg.c1, seg.p1, t);

  const p012 = Vec2.lerp(p01, p12, t);
  const p123 = Vec2.lerp(p12, p23, t);

  const p0123 = Vec2.lerp(p012, p123, t);

  return [
    Segment.cubic(seg.p0, p01, p012, p0123),
    Segment.cubic(p0123, p123, p23, seg.p1),
  ];
}

// ============================================
// Utility Functions
// ============================================

function curveLength(seg: QuadraticSegment | CubicSegment, subdivisions: number): number {
  let length = 0;
  let prevPoint = Segment.pointAt(seg, 0);

  for (let i = 1; i <= subdivisions; i++) {
    const t = i / subdivisions;
    const point = Segment.pointAt(seg, t);
    length += Vec2.dist(prevPoint, point);
    prevPoint = point;
  }

  return length;
}
