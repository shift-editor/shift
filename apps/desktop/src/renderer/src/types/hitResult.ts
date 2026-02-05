import type { Point2D, PointId, ContourId, Point, Contour } from "@shift/types";
import type { Segment } from "./segments";
import type { SegmentId } from "./indicator";
import type { BoundingBoxHitResult } from "./boundingBox";

export type PointHit = {
  type: "point";
  point: Point;
  pointId: PointId;
};

export type SegmentHit = {
  type: "segment";
  segment: Segment;
  segmentId: SegmentId;
  t: number;
  closestPoint: Point2D;
};

export type ContourEndpointHit = {
  type: "contourEndpoint";
  contourId: ContourId;
  pointId: PointId;
  position: "start" | "end";
  contour: Contour;
};

export type MiddlePointHit = {
  type: "middlePoint";
  contourId: ContourId;
  pointId: PointId;
  pointIndex: number;
};

export type HitResult = PointHit | SegmentHit | ContourEndpointHit | MiddlePointHit | null;

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
