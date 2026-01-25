/**
 * Segment - Operations for font editing segments with point IDs.
 *
 * This module bridges the gap between:
 * - Pure geometry curves (Curve module - no IDs)
 * - Font segments (types/segments.ts - have IDs)
 *
 * It provides operations on segments like hit testing, bounds, and
 * conversion to pure geometry curves for math operations.
 *
 * @example
 * ```ts
 * import { Segment as SegmentOps } from '@/lib/geo/Segment';
 * import type { Segment } from '@/types/segments';
 *
 * // Hit test a segment
 * const hit = SegmentOps.hitTest(segment, mousePos, radius);
 * if (hit) {
 *   console.log('Hit segment:', hit.segmentId, 'at t:', hit.t);
 * }
 *
 * // Get segment ID
 * const id = SegmentOps.id(segment);
 *
 * // Convert to curve for math operations
 * const curve = SegmentOps.toCurve(segment);
 * const point = Curve.pointAt(curve, 0.5);
 * ```
 */

import { Curve, Vec2, type CurveType, type Point2D } from "@shift/geo";
import type {
  Segment as SegmentType,
  LineSegment,
  QuadSegment,
  CubicSegment,
} from "@/types/segments";
import type { SegmentId } from "@/types/indicator";
import { asSegmentId } from "@/types/indicator";
import type { PointId } from "@shift/types";
import { asPointId } from "@shift/types";

export interface SegmentHitResult {
  segment: SegmentType;
  segmentId: SegmentId;
  t: number;
  point: Point2D;
  distance: number;
}

export const Segment = {
  id(segment: SegmentType): SegmentId {
    switch (segment.type) {
      case "line":
        return asSegmentId(
          `${segment.points.anchor1.id}:${segment.points.anchor2.id}`,
        );
      case "quad":
        return asSegmentId(
          `${segment.points.anchor1.id}:${segment.points.anchor2.id}`,
        );
      case "cubic":
        return asSegmentId(
          `${segment.points.anchor1.id}:${segment.points.anchor2.id}`,
        );
    }
  },

  toCurve(segment: SegmentType): CurveType {
    switch (segment.type) {
      case "line":
        return Curve.line(segment.points.anchor1, segment.points.anchor2);
      case "quad":
        return Curve.quadratic(
          segment.points.anchor1,
          segment.points.control,
          segment.points.anchor2,
        );
      case "cubic":
        return Curve.cubic(
          segment.points.anchor1,
          segment.points.control1,
          segment.points.control2,
          segment.points.anchor2,
        );
    }
  },

  bounds(segment: SegmentType): { min: Point2D; max: Point2D } {
    const curve = Segment.toCurve(segment);
    return Curve.bounds(curve);
  },

  hitTest(
    segment: SegmentType,
    pos: Point2D,
    radius: number,
  ): SegmentHitResult | null {
    const bounds = Segment.bounds(segment);
    const radiusVec = { x: radius, y: radius };
    const expandedMin = Vec2.sub(bounds.min, radiusVec);
    const expandedMax = Vec2.add(bounds.max, radiusVec);

    if (
      pos.x < expandedMin.x ||
      pos.x > expandedMax.x ||
      pos.y < expandedMin.y ||
      pos.y > expandedMax.y
    ) {
      return null;
    }

    const curve = Segment.toCurve(segment);
    const closest = Curve.closestPoint(curve, pos);

    if (closest.distance < radius) {
      return {
        segment,
        segmentId: Segment.id(segment),
        t: closest.t,
        point: closest.point,
        distance: closest.distance,
      };
    }

    return null;
  },

  hitTestMultiple(
    segments: SegmentType[],
    pos: Point2D,
    radius: number,
  ): SegmentHitResult | null {
    let bestHit: SegmentHitResult | null = null;

    for (const segment of segments) {
      const hit = Segment.hitTest(segment, pos, radius);
      if (hit && (bestHit === null || hit.distance < bestHit.distance)) {
        bestHit = hit;
      }
    }

    return bestHit;
  },

  isLine(segment: SegmentType): segment is LineSegment {
    return segment.type === "line";
  },

  isQuad(segment: SegmentType): segment is QuadSegment {
    return segment.type === "quad";
  },

  isCubic(segment: SegmentType): segment is CubicSegment {
    return segment.type === "cubic";
  },

  getPointIds(segment: SegmentType): PointId[] {
    switch (segment.type) {
      case "line":
        return [
          asPointId(segment.points.anchor1.id),
          asPointId(segment.points.anchor2.id),
        ];
      case "quad":
        return [
          asPointId(segment.points.anchor1.id),
          asPointId(segment.points.control.id),
          asPointId(segment.points.anchor2.id),
        ];
      case "cubic":
        return [
          asPointId(segment.points.anchor1.id),
          asPointId(segment.points.control1.id),
          asPointId(segment.points.control2.id),
          asPointId(segment.points.anchor2.id),
        ];
    }
  },
} as const;
