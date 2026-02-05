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
  SegmentPoint,
} from "@/types/segments";
import type { SegmentId } from "@/types/indicator";
import { asSegmentId } from "@/types/indicator";
import type { PointId, Point, Contour } from "@shift/types";

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
        return asSegmentId(`${segment.points.anchor1.id}:${segment.points.anchor2.id}`);
      case "quad":
        return asSegmentId(`${segment.points.anchor1.id}:${segment.points.anchor2.id}`);
      case "cubic":
        return asSegmentId(`${segment.points.anchor1.id}:${segment.points.anchor2.id}`);
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

  hitTest(segment: SegmentType, pos: Point2D, radius: number): SegmentHitResult | null {
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

  hitTestMultiple(segments: SegmentType[], pos: Point2D, radius: number): SegmentHitResult | null {
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
        return [segment.points.anchor1.id, segment.points.anchor2.id];
      case "quad":
        return [segment.points.anchor1.id, segment.points.control.id, segment.points.anchor2.id];
      case "cubic":
        return [
          segment.points.anchor1.id,
          segment.points.control1.id,
          segment.points.control2.id,
          segment.points.anchor2.id,
        ];
    }
  },

  getPoints(segment: SegmentType): SegmentPoint[] {
    switch (segment.type) {
      case "line":
        return [segment.points.anchor1, segment.points.anchor2];
      case "quad":
        return [segment.points.anchor1, segment.points.control, segment.points.anchor2];
      case "cubic":
        return [
          segment.points.anchor1,
          segment.points.control1,
          segment.points.control2,
          segment.points.anchor2,
        ];
    }
  },

  parse(points: readonly Point[], closed: boolean): SegmentType[] {
    if (points.length < 2) {
      return [];
    }

    const segments: SegmentType[] = [];
    let index = 0;

    const getPoint = (i: number): Point | undefined => {
      if (i < points.length) {
        return points[i];
      }
      if (closed) {
        return points[i - points.length];
      }
      return undefined;
    };

    const limit = closed ? points.length : points.length - 1;

    while (index < limit) {
      const p1 = getPoint(index);
      const p2 = getPoint(index + 1);

      if (!p1 || !p2) {
        break;
      }

      if (p1.pointType === "onCurve" && p2.pointType === "onCurve") {
        segments.push({
          type: "line",
          points: { anchor1: p1, anchor2: p2 },
        });
        index += 1;
        continue;
      }

      if (p1.pointType === "onCurve" && p2.pointType === "offCurve") {
        const p3 = getPoint(index + 2);

        if (!p3) {
          break;
        }

        if (p3.pointType === "onCurve") {
          segments.push({
            type: "quad",
            points: { anchor1: p1, control: p2, anchor2: p3 },
          });
          index += 2;
          continue;
        }

        if (p3.pointType === "offCurve") {
          const p4 = getPoint(index + 3);
          if (!p4) {
            break;
          }

          segments.push({
            type: "cubic",
            points: { anchor1: p1, control1: p2, control2: p3, anchor2: p4 },
          });
          index += 3;
          continue;
        }
      }

      index += 1;
    }

    return segments;
  },

  parseGlyph(contours: readonly Contour[]): Map<string, SegmentType[]> {
    const result = new Map<string, SegmentType[]>();

    for (const contour of contours) {
      const segments = Segment.parse(contour.points, contour.closed);
      result.set(contour.id, segments);
    }

    return result;
  },
} as const;
