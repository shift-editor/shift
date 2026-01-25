/**
 * @shift/geo - Lightweight 2D Geometry Library
 *
 * A functional library for 2D vector math and geometric primitives.
 *
 * Modules:
 * - Vec2: Core 2D vector operations
 * - Curve: Pure geometry curve primitives (line, quadratic, cubic bezier)
 * - Polygon: Polygon operations (area, winding direction)
 *
 * @example
 * ```ts
 * import { Vec2, Curve, Polygon } from '@shift/geo';
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
 *
 * // Polygons
 * const isClockwise = Polygon.isClockwise(points);
 * const area = Polygon.area(points);
 * ```
 */

// Types
export type { Point2D, BBox, Rect2D } from "./types";

// Core vector operations
export { Vec2 } from "./Vec2";

// Curve primitives (pure geometry)
export { Curve } from "./Curve";

// Polygon operations
export { Polygon } from "./Polygon";
export type {
  LineCurve,
  QuadraticCurve,
  CubicCurve,
  CurveType,
  ClosestPointResult,
} from "./Curve";

// Matrix transformations
export { Mat, type MatModel } from "./Mat";
