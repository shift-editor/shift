import type { Point } from "../Point";
import type { Segment } from "../Segment";

/** Minimal point and closure geometry consumed by segment parsing. */
export interface ContourGeometry {
  readonly points: readonly Point[];
  readonly closed: boolean;
}

/** Contour geometry that owns its domain segment traversal. */
export interface SegmentedContour extends ContourGeometry {
  segments(): readonly Segment[];
}
