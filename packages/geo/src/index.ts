/**
 * @shift/geo - Lightweight 2D Geometry Library
 *
 * A functional library for 2D vector math and geometric primitives.
 *
 * Modules:
 * - Vec2: Core 2D vector operations
 * - Curve: Pure geometry curve primitives (line, quadratic, cubic bezier)
 *
 * @example
 * ```ts
 * import { Vec2, Curve } from '@shift/geo';
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

// Types
export type { Point2D, BBox } from './types';

// Core vector operations
export { Vec2 } from './Vec2';

// Curve primitives (pure geometry)
export { Curve } from './Curve';
export type {
  LineCurve,
  QuadraticCurve,
  CubicCurve,
  CurveType,
  ClosestPointResult,
} from './Curve';
