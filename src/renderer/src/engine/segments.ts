/**
 * Segment parsing - converts point sequences to renderable segments.
 *
 * This module provides pure functions for parsing contour points into
 * line, quadratic bezier, and cubic bezier segments for rendering.
 */

import type { PointSnapshot, ContourSnapshot } from "@/types/generated";
import type { Segment, SegmentPoint } from "@/types/segments";

// Debug logging
const DEBUG = true;
function debug(...args: any[]) {
  if (DEBUG) console.log("[Segments]", ...args);
}

/**
 * Parse a contour's points into renderable segments.
 *
 * Point patterns:
 * - onCurve → onCurve: LineSegment
 * - onCurve → offCurve → onCurve: QuadSegment
 * - onCurve → offCurve → offCurve → onCurve: CubicSegment
 *
 * @param points - Array of points in the contour
 * @param closed - Whether the contour is closed
 * @returns Array of segments for rendering
 */
export function parseSegments(
  points: PointSnapshot[],
  closed: boolean
): Segment[] {
  debug("parseSegments called with", points.length, "points, closed:", closed);

  if (points.length < 2) {
    debug("  Less than 2 points, returning empty");
    return [];
  }

  // Log all points
  for (let i = 0; i < points.length; i++) {
    debug(`  Point[${i}]:`, points[i].id, "x:", points[i].x, "y:", points[i].y, "type:", points[i].pointType);
  }

  const segments: Segment[] = [];
  let index = 0;

  while (index < points.length - 1) {
    const p1 = points[index];
    const p2 = points[index + 1];

    debug(`  Processing index ${index}: p1.type=${p1.pointType}, p2.type=${p2.pointType}`);

    // Line segment: onCurve → onCurve
    if (p1.pointType === "onCurve" && p2.pointType === "onCurve") {
      debug(`    Creating LINE segment from (${p1.x}, ${p1.y}) to (${p2.x}, ${p2.y})`);
      segments.push({
        type: "line",
        points: { anchor1: p1, anchor2: p2 },
      });
      index += 1;
      continue;
    }

    // Bezier: onCurve → offCurve → ...
    if (p1.pointType === "onCurve" && p2.pointType === "offCurve") {
      const p3 = points[index + 2];

      if (!p3) {
        debug("    Incomplete bezier at end, breaking");
        // Incomplete segment at end, skip
        break;
      }

      // Quadratic: onCurve → offCurve → onCurve
      if (p3.pointType === "onCurve") {
        debug(`    Creating QUAD segment`);
        segments.push({
          type: "quad",
          points: { anchor1: p1, control: p2, anchor2: p3 },
        });
        index += 2;
        continue;
      }

      // Cubic: onCurve → offCurve → offCurve → onCurve
      if (p3.pointType === "offCurve") {
        const p4 = points[index + 3];
        if (!p4) {
          debug("    Incomplete cubic at end, breaking");
          // Incomplete segment at end, skip
          break;
        }

        debug(`    Creating CUBIC segment`);
        segments.push({
          type: "cubic",
          points: { anchor1: p1, control1: p2, control2: p3, anchor2: p4 },
        });
        index += 3;
        continue;
      }
    }

    // Unknown pattern, skip point
    debug(`    Unknown pattern at index ${index}, skipping`);
    index += 1;
  }

  // Handle closing segment if contour is closed
  if (closed && points.length >= 2) {
    const lastOnCurve = findLastOnCurve(points);
    const firstOnCurve = findFirstOnCurve(points);

    if (lastOnCurve && firstOnCurve && lastOnCurve !== firstOnCurve) {
      debug("  Adding closing LINE segment");
      // Simple line close for now
      // TODO: Handle bezier closing segments
      segments.push({
        type: "line",
        points: { anchor1: lastOnCurve, anchor2: firstOnCurve },
      });
    }
  }

  debug("  Returning", segments.length, "segments");
  return segments;
}

/**
 * Parse all contours from a glyph snapshot into segments.
 */
export function parseGlyphSegments(
  contours: ContourSnapshot[]
): Map<string, Segment[]> {
  const result = new Map<string, Segment[]>();

  for (const contour of contours) {
    const segments = parseSegments(contour.points, contour.closed);
    result.set(contour.id, segments);
  }

  return result;
}

/**
 * Find the last on-curve point in an array.
 */
function findLastOnCurve(points: PointSnapshot[]): PointSnapshot | null {
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].pointType === "onCurve") {
      return points[i];
    }
  }
  return null;
}

/**
 * Find the first on-curve point in an array.
 */
function findFirstOnCurve(points: PointSnapshot[]): PointSnapshot | null {
  for (const point of points) {
    if (point.pointType === "onCurve") {
      return point;
    }
  }
  return null;
}

/**
 * Get all points from a segment.
 */
export function getSegmentPoints(segment: Segment): SegmentPoint[] {
  switch (segment.type) {
    case "line":
      return [segment.points.anchor1, segment.points.anchor2];
    case "quad":
      return [
        segment.points.anchor1,
        segment.points.control,
        segment.points.anchor2,
      ];
    case "cubic":
      return [
        segment.points.anchor1,
        segment.points.control1,
        segment.points.control2,
        segment.points.anchor2,
      ];
  }
}
