/**
 * Hit-testing result types.
 *
 * When the user clicks or hovers on the canvas, the editor performs spatial
 * queries against the current glyph in UPM space. The result is a
 * discriminated union ({@link HitResult}) that tells tools exactly what was
 * hit: an anchor/control point, a curve segment, a contour endpoint, or a
 * point in the middle of a contour. `null` means nothing was within the
 * hit radius.
 *
 * Type guard functions (`isPointHit`, `isSegmentHit`, etc.) narrow the union
 * for safe property access in tool behaviors.
 *
 * @module
 */
import type { Point2D, PointId, ContourId, Point, Contour } from "@shift/types";
import type { Segment } from "./segments";
import type { SegmentId } from "./indicator";
import type { BoundingBoxHitResult } from "./boundingBox";

/** An anchor or control point was hit. */
export type PointHit = {
  type: "point";
  point: Point;
  pointId: PointId;
};

/** A curve segment was hit. Includes the parametric `t` value and closest point on the curve. */
export type SegmentHit = {
  type: "segment";
  segment: Segment;
  segmentId: SegmentId;
  /** Parametric position along the segment (0..1). */
  t: number;
  /** Nearest point on the segment curve to the query position (UPM). */
  closestPoint: Point2D;
};

/** The start or end anchor of an open contour was hit. Used by the Pen tool to close or extend contours. */
export type ContourEndpointHit = {
  type: "contourEndpoint";
  contourId: ContourId;
  pointId: PointId;
  /** Whether the hit was at the start or end of the contour. */
  position: "start" | "end";
  contour: Contour;
};

/** A non-endpoint anchor in the interior of a contour was hit. */
export type MiddlePointHit = {
  type: "middlePoint";
  contourId: ContourId;
  pointId: PointId;
  /** Zero-based index of the point within its contour. */
  pointIndex: number;
};

/**
 * Union of all hit-test outcomes. `null` means nothing was within the
 * hit radius. Discriminate on `type` to access variant-specific fields.
 */
export type HitResult = PointHit | SegmentHit | ContourEndpointHit | MiddlePointHit | null;

/**
 * Higher-level hover state used for cursor and highlight feedback.
 * Unlike {@link HitResult}, includes a `boundingBox` variant for
 * resize/rotate handle hovers.
 */
export type HoverResult =
  | { type: "boundingBox"; handle: BoundingBoxHitResult }
  | { type: "point"; pointId: PointId }
  | { type: "segment"; segmentId: SegmentId; closestPoint: Point2D; t: number }
  | { type: "none" };

export function isPointHit(hit: HitResult): hit is PointHit {
  return hit !== null && hit.type === "point";
}

export function isSegmentHit(hit: HitResult): hit is SegmentHit {
  return hit !== null && hit.type === "segment";
}

export function isContourEndpointHit(hit: HitResult): hit is ContourEndpointHit {
  return hit !== null && hit.type === "contourEndpoint";
}

export function isMiddlePointHit(hit: HitResult): hit is MiddlePointHit {
  return hit !== null && hit.type === "middlePoint";
}

export function getPointIdFromHit(hit: HitResult): PointId | null {
  if (hit === null) return null;
  if (isPointHit(hit) || isContourEndpointHit(hit) || isMiddlePointHit(hit)) return hit.pointId;
  return null;
}
