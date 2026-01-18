/**
 * Shift Geometry Library
 *
 * A lightweight, functional library for 2D vector math, geometric primitives,
 * hit testing, and snapping.
 *
 * Modules:
 * - Vec2: Core 2D vector operations
 * - Segment: Line and bezier curve primitives
 * - HitTest: Unified hit testing system
 * - Snap: Snapping infrastructure for precision editing
 *
 * @example
 * ```ts
 * import { Vec2, Segment, HitTest, Snap } from '@/lib/geo';
 *
 * // Vector operations
 * const sum = Vec2.add(a, b);
 * const dist = Vec2.dist(a, b);
 *
 * // Segments
 * const line = Segment.line(p0, p1);
 * const curve = Segment.cubic(p0, c0, c1, p1);
 * const midpoint = Segment.pointAt(curve, 0.5);
 *
 * // Hit testing
 * const isNear = HitTest.point(mousePos, target, radius);
 * const result = HitTest.segment(mousePos, curve, radius);
 *
 * // Snapping
 * const snapped = Snap.toGrid(mousePos, gridSize);
 * const result = Snap.find(mousePos, targets, { threshold: 10 });
 * ```
 */

// Core vector operations
export { Vec2 } from './Vec2';
export type { Point2D } from './Vec2';

// Segment primitives
export { Segment } from './Segment';
export type {
  LineSegment,
  CubicSegment,
  QuadraticSegment,
  Segment as SegmentType,
  ClosestPointResult,
} from './Segment';

// Hit testing
export { HitTest } from './HitTest';
export type {
  HitResult,
  HitTarget,
  PointTarget,
  SegmentTarget,
  RectTarget,
  CollectionHitOptions,
} from './HitTest';

// Snapping
export { Snap } from './Snap';
export type {
  SnapResult,
  SnapTarget,
  PointSnapTarget,
  LineSnapTarget,
  GridSnapTarget,
  AngleSnapTarget,
  ExtensionSnapTarget,
  SnapOptions,
} from './Snap';
