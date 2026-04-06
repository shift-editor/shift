import type { GlyphSnapshot, PointSnapshot } from "@shift/types";
import { Validate } from "@shift/validation";

/**
 * Convert a GlyphSnapshot's contours into an SVG path `d` attribute string.
 * Handles line, quadratic, and cubic segments based on point types.
 */
export function snapshotToSvgPath(snapshot: GlyphSnapshot): string {
  const parts: string[] = [];

  for (const contour of snapshot.contours) {
    const d = contourToSvgD(contour.points, contour.closed);
    if (d) parts.push(d);
  }

  return parts.join(" ");
}

function contourToSvgD(points: readonly PointSnapshot[], closed: boolean): string {
  if (points.length < 2) return "";

  const segments = buildSegments(points, closed);
  const cmds: string[] = [];
  let first = true;

  for (const seg of segments) {
    switch (seg.type) {
      case "line": {
        if (first) {
          cmds.push(`M ${fmt(seg.p1.x)} ${fmt(seg.p1.y)}`);
          first = false;
        }
        cmds.push(`L ${fmt(seg.p2.x)} ${fmt(seg.p2.y)}`);
        break;
      }
      case "quad": {
        if (first) {
          cmds.push(`M ${fmt(seg.p1.x)} ${fmt(seg.p1.y)}`);
          first = false;
        }
        cmds.push(`Q ${fmt(seg.cp.x)} ${fmt(seg.cp.y)} ${fmt(seg.p2.x)} ${fmt(seg.p2.y)}`);
        break;
      }
      case "cubic": {
        if (first) {
          cmds.push(`M ${fmt(seg.p1.x)} ${fmt(seg.p1.y)}`);
          first = false;
        }
        cmds.push(
          `C ${fmt(seg.cp1.x)} ${fmt(seg.cp1.y)} ${fmt(seg.cp2.x)} ${fmt(seg.cp2.y)} ${fmt(seg.p2.x)} ${fmt(seg.p2.y)}`,
        );
        break;
      }
    }
  }

  if (closed && cmds.length > 0) cmds.push("Z");

  return cmds.join(" ");
}

function fmt(n: number): string {
  return Math.round(n * 100) / 100 + "";
}

type Coord = { x: number; y: number };
type Segment =
  | { type: "line"; p1: Coord; p2: Coord }
  | { type: "quad"; p1: Coord; cp: Coord; p2: Coord }
  | { type: "cubic"; p1: Coord; cp1: Coord; cp2: Coord; p2: Coord };

function buildSegments(points: readonly PointSnapshot[], closed: boolean): Segment[] {
  const segments: Segment[] = [];
  const n = points.length;
  if (n < 2) return segments;

  // Walk through points collecting on-curve to on-curve segments
  // Off-curve points between two on-curves form the control points
  const allPoints = closed ? [...points, points[0]] : points;
  let i = 0;

  while (i < allPoints.length - 1) {
    const start = allPoints[i];

    if (Validate.isOffCurve(start)) {
      i++;
      continue;
    }

    // Collect off-curve points until next on-curve
    const offCurves: PointSnapshot[] = [];
    let j = i + 1;
    while (j < allPoints.length && Validate.isOffCurve(allPoints[j])) {
      offCurves.push(allPoints[j]);
      j++;
    }

    if (j >= allPoints.length) break;
    const end = allPoints[j];

    switch (offCurves.length) {
      case 0:
        segments.push({ type: "line", p1: start, p2: end });
        break;
      case 1:
        segments.push({ type: "quad", p1: start, cp: offCurves[0], p2: end });
        break;
      case 2:
        segments.push({ type: "cubic", p1: start, cp1: offCurves[0], cp2: offCurves[1], p2: end });
        break;
      default:
        // Multiple off-curves: treat as cubic with first two
        segments.push({ type: "cubic", p1: start, cp1: offCurves[0], cp2: offCurves[1], p2: end });
        break;
    }

    i = j;
  }

  return segments;
}
