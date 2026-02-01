import type { Point2D, PointId, Point, ContourId, Contour } from "@shift/types";
import type { SegmentId } from "./indicator";
import type { Segment } from "./segments";
import type { BoundingRectEdge } from "@/lib/tools/select/cursor";
import type { CornerHandle } from "./boundingBox";

export type { CornerHandle };

/**
 * Hit result for a point on the glyph.
 */
export interface PointHit {
  type: "point";
  point: Point;
  pointId: PointId;
}

/**
 * Hit result for a segment on the glyph.
 */
export interface SegmentHit {
  type: "segment";
  segment: Segment;
  segmentId: SegmentId;
  /** Parameter t along the curve (0-1) */
  t: number;
  /** Closest point on the segment to the mouse position */
  closestPoint: Point2D;
  /** Distance from the mouse position to the segment */
  distance: number;
}

/**
 * Hit result for an endpoint of an open contour.
 * This is distinct from a regular point hit because it indicates
 * a valid target for continuing/joining contours.
 */
export interface ContourEndpointHit {
  type: "contourEndpoint";
  contourId: ContourId;
  pointId: PointId;
  position: "start" | "end";
  contour: Contour;
}

/**
 * Hit result for a bounding box resize handle.
 */
export interface BoundingBoxResizeHit {
  type: "boundingBoxResize";
  edge: Exclude<BoundingRectEdge, null>;
}

/**
 * Hit result for a bounding box rotation zone.
 */
export interface BoundingBoxRotateHit {
  type: "boundingBoxRotate";
  corner: CornerHandle;
}

/**
 * Unified hit result type - a discriminated union of all possible hit targets.
 *
 * Priority order (when multiple targets overlap):
 * 1. Point - always takes precedence as it's the smallest target
 * 2. ContourEndpoint - for pen tool to detect joinable endpoints
 * 3. BoundingBox handles - for selection transforms
 * 4. Segment - larger hit area
 *
 * A `null` result means nothing was hit.
 */
export type HitResult =
  | PointHit
  | SegmentHit
  | ContourEndpointHit
  | BoundingBoxResizeHit
  | BoundingBoxRotateHit
  | null;

/**
 * Options for customizing hit testing behavior.
 */
export interface HitTestOptions {
  /** Include point hit testing (default: true) */
  points?: boolean;
  /** Include segment hit testing (default: true) */
  segments?: boolean;
  /** Include contour endpoint hit testing (default: true) */
  contourEndpoints?: boolean;
  /** Include bounding box hit testing (default: false, only enabled when there's a selection) */
  boundingBox?: boolean;
}

/**
 * Helper type guards for HitResult
 */
export function isPointHit(hit: HitResult): hit is PointHit {
  return hit?.type === "point";
}

export function isSegmentHit(hit: HitResult): hit is SegmentHit {
  return hit?.type === "segment";
}

export function isContourEndpointHit(hit: HitResult): hit is ContourEndpointHit {
  return hit?.type === "contourEndpoint";
}

export function isBoundingBoxResizeHit(hit: HitResult): hit is BoundingBoxResizeHit {
  return hit?.type === "boundingBoxResize";
}

export function isBoundingBoxRotateHit(hit: HitResult): hit is BoundingBoxRotateHit {
  return hit?.type === "boundingBoxRotate";
}

export function isBoundingBoxHit(
  hit: HitResult,
): hit is BoundingBoxResizeHit | BoundingBoxRotateHit {
  return hit?.type === "boundingBoxResize" || hit?.type === "boundingBoxRotate";
}
