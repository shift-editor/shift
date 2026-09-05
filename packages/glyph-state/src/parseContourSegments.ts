import { Point, type NewPoint } from "./Point";
import type { ContourGeometry, SegmentPoints } from "./types/contour";

/**
 * Parses line, quadratic, and cubic segments while retaining the supplied point references.
 *
 * @param contour - Ordered points and closure; closed contours wrap controls to the first anchor.
 * @returns Fresh segment descriptions without allocating point or segment identities.
 */
export function parseContourSegments<TPoint extends NewPoint>(
  contour: ContourGeometry<TPoint>,
): SegmentPoints<TPoint>[] {
  const { points, closed } = contour;
  if (points.length < 2) return [];

  const segments: SegmentPoints<TPoint>[] = [];
  let index = 0;

  const getPoint = (i: number): TPoint | null => {
    if (i < points.length) return points[i];
    if (closed) return points[i - points.length];

    return null;
  };

  const limit = closed ? points.length : points.length - 1;

  while (index < limit) {
    const p1 = getPoint(index);
    const p2 = getPoint(index + 1);
    if (!p1 || !p2) break;

    if (Point.isOnCurve(p1) && Point.isOnCurve(p2)) {
      segments.push({ type: "line", start: p1, end: p2 });
      index += 1;
      continue;
    }

    if (Point.isOnCurve(p1) && Point.isOffCurve(p2)) {
      const p3 = getPoint(index + 2);
      if (!p3) break;

      if (Point.isOnCurve(p3)) {
        segments.push({ type: "quad", start: p1, control: p2, end: p3 });
        index += 2;
        continue;
      }

      if (Point.isOffCurve(p3)) {
        const p4 = getPoint(index + 3);
        if (!p4) break;

        segments.push({ type: "cubic", start: p1, controlStart: p2, controlEnd: p3, end: p4 });
        index += 3;
        continue;
      }
    }

    index += 1;
  }

  return segments;
}
