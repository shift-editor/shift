import type { Point2D } from "@shift/geo";
import type { PointId } from "@shift/types";
import type { SegmentId } from "@shift/glyph-state";

export type { SegmentId };

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
export interface Indicator {
  hoveredPoint: PointId | null;
  hoveredSegment: SegmentIndicator | null;
}
