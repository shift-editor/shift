import type { Point2D, PointId } from "@shift/types";

declare const SegmentIdBrand: unique symbol;

/**
 * Branded string that uniquely identifies a curve segment within a glyph.
 * Encoded as `"anchor1Id:anchor2Id"` -- the IDs of the two on-curve endpoints
 * joined by a colon. The brand prevents accidental use of raw strings where
 * a segment ID is expected.
 */
export type SegmentId = string & {
  readonly [SegmentIdBrand]: typeof SegmentIdBrand;
};

export function asSegmentId(id: string): SegmentId {
  return id as SegmentId;
}

/**
 * Describes the closest point on a segment to the cursor.
 * Used to display hover indicators and to insert points at the parametric position `t`.
 */
export interface SegmentIndicator {
  segmentId: SegmentId;
  closestPoint: Point2D;
  t: number;
}

/**
 * Tracks what the cursor is currently hovering over in the editor viewport.
 * Drives visual feedback (highlight rings, segment indicators) and determines
 * what a click would target.
 */
export interface IndicatorState {
  hoveredPoint: PointId | null;
  hoveredSegment: SegmentIndicator | null;
}
