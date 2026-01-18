/**
 * Shift Geometry Library
 *
 * A lightweight, functional library for 2D vector math and geometric primitives.
 *
 * Modules:
 * - Vec2: Core 2D vector operations
 * - Curve: Pure geometry curve primitives (line, quadratic, cubic bezier)
 *
 * Note: For font editing segments with point IDs, see types/segments.ts.
 * The Curve module provides pure geometry without identity tracking.
 *
 * @example
 * ```ts
 * import { Vec2, Curve } from '@/lib/geo';
 *
 * // Vector operations
 * const sum = Vec2.add(a, b);
 * const dist = Vec2.dist(a, b);
 *
 * // Curves (pure geometry)
 * const line = Curve.line(p0, p1);
 * const cubic = Curve.cubic(p0, c0, c1, p1);
 * const midpoint = Curve.pointAt(cubic, 0.5);
 * const closest = Curve.closestPoint(cubic, mousePos);
 * ```
 */

// Core vector operations
export { Vec2 } from './Vec2';
export type { Point2D } from './Vec2';

// Curve primitives (pure geometry)
export { Curve } from './Curve';
export type {
  LineCurve,
  QuadraticCurve,
  CubicCurve,
  CurveType,
  ClosestPointResult,
} from './Curve';

// Segment operations (font editing segments with IDs)
export { Segment } from './Segment';
export type { SegmentHitResult } from './Segment';
