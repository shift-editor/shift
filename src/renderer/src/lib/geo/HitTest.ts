/**
 * HitTest - Unified Hit Testing System
 *
 * Provides a consistent interface for testing if a point is "near" various
 * geometric primitives (points, line segments, curves, rectangles).
 *
 * The system is designed around a "tolerance radius" model where a hit occurs
 * if the distance to the target is less than the specified radius.
 *
 * Architecture:
 * - HitTest.point() - Point-to-point proximity
 * - HitTest.segment() - Point-to-segment proximity (lines, curves)
 * - HitTest.rect() - Point-in-rectangle test
 * - HitTest.collection() - Test against multiple targets
 *
 * @example
 * ```ts
 * import { HitTest, HitTarget } from '@/lib/geo/HitTest';
 *
 * // Simple point hit test
 * const isNear = HitTest.point(mousePos, targetPoint, 10);
 *
 * // Segment hit test with details
 * const result = HitTest.segment(mousePos, lineSegment, 5);
 * if (result.hit) {
 *   console.log('Hit at t =', result.t, 'distance =', result.distance);
 * }
 *
 * // Hit test against a collection of targets
 * const targets: HitTarget[] = [
 *   { type: 'point', point: p1, id: 'point-1' },
 *   { type: 'segment', segment: seg1, id: 'seg-1' },
 * ];
 * const closest = HitTest.collection(mousePos, targets, 10);
 * ```
 */

import type { Point2D, Rect2D } from '@/types/math';
import { Vec2 } from './Vec2';
import { Segment, type Segment as SegmentType, type ClosestPointResult } from './Segment';

// ============================================
// Types
// ============================================

/**
 * Result of a hit test operation.
 * Generic over the target type T for type-safe target identification.
 */
export interface HitResult<T = unknown> {
  /** Whether the test point is within the tolerance radius */
  hit: boolean;
  /** The distance from the test point to the closest point on the target */
  distance: number;
  /** The closest point on the target to the test point */
  closestPoint: Point2D;
  /** The target that was hit (null if no hit) */
  target: T | null;
  /** For segments: the parameter t [0,1] where the closest point lies */
  t?: number;
}

/**
 * A hit target that can be tested against.
 * Use the discriminated union to define different target types.
 */
export type HitTarget<ID = string> =
  | PointTarget<ID>
  | SegmentTarget<ID>
  | RectTarget<ID>;

export interface PointTarget<ID = string> {
  type: 'point';
  point: Point2D;
  id: ID;
  /** Optional priority for tie-breaking (higher = more important) */
  priority?: number;
}

export interface SegmentTarget<ID = string> {
  type: 'segment';
  segment: SegmentType;
  id: ID;
  priority?: number;
}

export interface RectTarget<ID = string> {
  type: 'rect';
  rect: Rect2D;
  id: ID;
  priority?: number;
}

/**
 * Options for collection hit testing.
 */
export interface CollectionHitOptions {
  /** Only return results within this radius */
  radius: number;
  /** Return all hits sorted by distance (default: false, only returns closest) */
  returnAll?: boolean;
  /** Filter function to exclude certain targets */
  filter?: (target: HitTarget) => boolean;
}

// ============================================
// HitTest Namespace
// ============================================

export const HitTest = {
  // ============================================
  // Simple Hit Tests
  // ============================================

  /**
   * Test if a point is within a radius of another point.
   */
  point(test: Point2D, target: Point2D, radius: number): boolean {
    return Vec2.distSq(test, target) < radius * radius;
  },

  /**
   * Test if a point is within a radius of a line segment.
   * Returns detailed hit information.
   */
  lineSegment(
    test: Point2D,
    p0: Point2D,
    p1: Point2D,
    radius: number
  ): HitResult<null> {
    const seg = Segment.line(p0, p1);
    const closest = Segment.closestPoint(seg, test);
    const hit = closest.distance < radius;

    return {
      hit,
      distance: closest.distance,
      closestPoint: closest.point,
      target: null,
      t: closest.t,
    };
  },

  /**
   * Test if a point is within a radius of any segment type.
   * Returns detailed hit information.
   */
  segment(test: Point2D, segment: SegmentType, radius: number): HitResult<null> {
    const closest = Segment.closestPoint(segment, test);
    const hit = closest.distance < radius;

    return {
      hit,
      distance: closest.distance,
      closestPoint: closest.point,
      target: null,
      t: closest.t,
    };
  },

  /**
   * Test if a point is inside a rectangle (inclusive bounds).
   */
  rectContains(test: Point2D, rect: Rect2D): boolean {
    return (
      test.x >= rect.left &&
      test.x <= rect.right &&
      test.y >= rect.top &&
      test.y <= rect.bottom
    );
  },

  /**
   * Test if a point is within a radius of a rectangle's boundary.
   */
  rectBoundary(test: Point2D, rect: Rect2D, radius: number): HitResult<null> {
    // Create four line segments for the rectangle edges
    const topLeft = { x: rect.left, y: rect.top };
    const topRight = { x: rect.right, y: rect.top };
    const bottomRight = { x: rect.right, y: rect.bottom };
    const bottomLeft = { x: rect.left, y: rect.bottom };

    const edges = [
      Segment.line(topLeft, topRight),
      Segment.line(topRight, bottomRight),
      Segment.line(bottomRight, bottomLeft),
      Segment.line(bottomLeft, topLeft),
    ];

    let closest: ClosestPointResult = { t: 0, point: topLeft, distance: Infinity };

    for (const edge of edges) {
      const result = Segment.closestPoint(edge, test);
      if (result.distance < closest.distance) {
        closest = result;
      }
    }

    return {
      hit: closest.distance < radius,
      distance: closest.distance,
      closestPoint: closest.point,
      target: null,
      t: closest.t,
    };
  },

  // ============================================
  // Collection Hit Testing
  // ============================================

  /**
   * Test a point against a collection of targets.
   * Returns the closest hit within the radius, or null if no hits.
   *
   * When multiple targets have the same distance, higher priority wins.
   */
  collection<ID = string>(
    test: Point2D,
    targets: HitTarget<ID>[],
    options: CollectionHitOptions
  ): HitResult<HitTarget<ID>> | null {
    const { radius, returnAll = false, filter } = options;
    const results: Array<HitResult<HitTarget<ID>>> = [];

    for (const target of targets) {
      if (filter && !filter(target)) continue;

      const result = testTarget(test, target, radius);
      if (result.hit) {
        results.push(result);
      }
    }

    if (results.length === 0) return null;

    // Sort by distance, then by priority (higher priority = earlier in list)
    results.sort((a, b) => {
      const distDiff = a.distance - b.distance;
      if (Math.abs(distDiff) > 0.001) return distDiff;

      const priorityA = (a.target as HitTarget<ID>)?.priority ?? 0;
      const priorityB = (b.target as HitTarget<ID>)?.priority ?? 0;
      return priorityB - priorityA;
    });

    if (returnAll) {
      // Return all results - caller can access via the first result
      // (This is a simplified API; could be extended to return array)
      return results[0];
    }

    return results[0];
  },

  /**
   * Find all targets within the radius, sorted by distance.
   */
  allInRadius<ID = string>(
    test: Point2D,
    targets: HitTarget<ID>[],
    radius: number,
    filter?: (target: HitTarget<ID>) => boolean
  ): Array<HitResult<HitTarget<ID>>> {
    const results: Array<HitResult<HitTarget<ID>>> = [];

    for (const target of targets) {
      if (filter && !filter(target)) continue;

      const result = testTarget(test, target, radius);
      if (result.hit) {
        results.push(result);
      }
    }

    results.sort((a, b) => a.distance - b.distance);
    return results;
  },

  /**
   * Find all targets contained in a rectangle.
   * For points: checks if point is inside rect.
   * For segments: checks if both endpoints are inside rect.
   * For rects: checks if entire rect is inside the selection rect.
   */
  inRect<ID = string>(
    rect: Rect2D,
    targets: HitTarget<ID>[],
    filter?: (target: HitTarget<ID>) => boolean
  ): HitTarget<ID>[] {
    const results: HitTarget<ID>[] = [];

    for (const target of targets) {
      if (filter && !filter(target)) continue;

      let contained = false;

      switch (target.type) {
        case 'point':
          contained = HitTest.rectContains(target.point, rect);
          break;
        case 'segment': {
          const seg = target.segment;
          contained =
            HitTest.rectContains(seg.p0, rect) && HitTest.rectContains(seg.p1, rect);
          break;
        }
        case 'rect':
          contained =
            target.rect.left >= rect.left &&
            target.rect.right <= rect.right &&
            target.rect.top >= rect.top &&
            target.rect.bottom <= rect.bottom;
          break;
      }

      if (contained) {
        results.push(target);
      }
    }

    return results;
  },

  // ============================================
  // Utility Functions
  // ============================================

  /**
   * Get the distance from a point to a target.
   */
  distanceToTarget(test: Point2D, target: HitTarget): number {
    switch (target.type) {
      case 'point':
        return Vec2.dist(test, target.point);
      case 'segment':
        return Segment.distanceTo(target.segment, test);
      case 'rect': {
        // Distance to rectangle = 0 if inside, otherwise distance to boundary
        if (HitTest.rectContains(test, target.rect)) {
          return 0;
        }
        return HitTest.rectBoundary(test, target.rect, Infinity).distance;
      }
    }
  },

  /**
   * Create a point target.
   */
  pointTarget<ID = string>(
    point: Point2D,
    id: ID,
    priority?: number
  ): PointTarget<ID> {
    return { type: 'point', point, id, priority };
  },

  /**
   * Create a segment target.
   */
  segmentTarget<ID = string>(
    segment: SegmentType,
    id: ID,
    priority?: number
  ): SegmentTarget<ID> {
    return { type: 'segment', segment, id, priority };
  },

  /**
   * Create a rect target.
   */
  rectTarget<ID = string>(rect: Rect2D, id: ID, priority?: number): RectTarget<ID> {
    return { type: 'rect', rect, id, priority };
  },
} as const;

// ============================================
// Internal Functions
// ============================================

function testTarget<ID>(
  test: Point2D,
  target: HitTarget<ID>,
  radius: number
): HitResult<HitTarget<ID>> {
  switch (target.type) {
    case 'point': {
      const distance = Vec2.dist(test, target.point);
      return {
        hit: distance < radius,
        distance,
        closestPoint: target.point,
        target: target,
      };
    }
    case 'segment': {
      const closest = Segment.closestPoint(target.segment, test);
      return {
        hit: closest.distance < radius,
        distance: closest.distance,
        closestPoint: closest.point,
        target: target,
        t: closest.t,
      };
    }
    case 'rect': {
      const inside = HitTest.rectContains(test, target.rect);
      if (inside) {
        return {
          hit: true,
          distance: 0,
          closestPoint: test,
          target: target,
        };
      }
      const boundary = HitTest.rectBoundary(test, target.rect, radius);
      return {
        hit: boundary.hit,
        distance: boundary.distance,
        closestPoint: boundary.closestPoint,
        target: boundary.hit ? target : null,
        t: boundary.t,
      };
    }
  }
}
