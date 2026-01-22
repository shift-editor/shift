import type { Point2D, PointId } from "@shift/types";

declare const SegmentIdBrand: unique symbol;

export type SegmentId = string & {
  readonly [SegmentIdBrand]: typeof SegmentIdBrand;
};

export function asSegmentId(id: string): SegmentId {
  return id as SegmentId;
}

export interface SegmentIndicator {
  segmentId: SegmentId;
  closestPoint: Point2D;
  t: number;
}

export interface IndicatorState {
  hoveredPoint: PointId | null;
  hoveredSegment: SegmentIndicator | null;
}
