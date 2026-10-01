import { Bounds, Curve, Vec2, type CurveType, type Point2D } from "@shift/geo";
import type { SegmentedContour } from "./types/contour";

const FLATTEN_TOLERANCE = 0.25;
const MAX_FLATTEN_DEPTH = 12;

/**
 * Tests a point against the non-zero fill of closed contours.
 *
 * @remarks
 * Open contours do not contribute. Curves are adaptively flattened in glyph
 * coordinates before winding is accumulated across all candidate contours.
 *
 * @param contours - Contours participating in one combined fill operation.
 * @param point - Point in the same coordinate space as the contours.
 * @returns true when the combined non-zero winding contains the point.
 */
export function filledContoursContain(
  contours: readonly SegmentedContour[],
  point: Point2D,
): boolean {
  let winding = 0;

  for (const contour of contours) {
    if (!contour.closed) continue;

    const segments = contour.segments();
    const bounds = Bounds.unionAll(segments.map((segment) => segment.bounds));
    if (!bounds || !Bounds.containsPoint(bounds, point)) continue;

    for (const segment of segments) {
      const flattened = flatten(segment.toCurve());
      for (let index = 1; index < flattened.length; index++) {
        const start = flattened[index - 1];
        const end = flattened[index];
        if (!start || !end) continue;

        winding += edgeWinding(start, end, point);
      }
    }
  }

  return winding !== 0;
}

function edgeWinding(start: Point2D, end: Point2D, point: Point2D): number {
  const side = (end.x - start.x) * (point.y - start.y) - (point.x - start.x) * (end.y - start.y);

  if (start.y <= point.y) {
    return end.y > point.y && side > 0 ? 1 : 0;
  }

  return end.y <= point.y && side < 0 ? -1 : 0;
}

function flatten(curve: CurveType): readonly Point2D[] {
  if (curve.type === "line") return [curve.p0, curve.p1];

  const points: Point2D[] = [curve.p0];
  appendFlattened(curve, points, 0);
  return points;
}

function appendFlattened(curve: CurveType, points: Point2D[], depth: number): void {
  if (depth >= MAX_FLATTEN_DEPTH || flatness(curve) <= FLATTEN_TOLERANCE) {
    points.push(curve.p1);
    return;
  }

  const [first, second] = Curve.splitAt(curve, 0.5);
  appendFlattened(first, points, depth + 1);
  appendFlattened(second, points, depth + 1);
}

function flatness(curve: CurveType): number {
  switch (curve.type) {
    case "line":
      return 0;
    case "quadratic":
      return pointLineDistance(curve.c, curve.p0, curve.p1);
    case "cubic":
      return Math.max(
        pointLineDistance(curve.c0, curve.p0, curve.p1),
        pointLineDistance(curve.c1, curve.p0, curve.p1),
      );
  }
}

function pointLineDistance(point: Point2D, start: Point2D, end: Point2D): number {
  return Vec2.len(Vec2.reject(Vec2.sub(point, start), Vec2.sub(end, start)));
}
