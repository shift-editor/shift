import type { Point2D } from "@shift/geo";
import type { PointId } from "@shift/types";

/** Describes a cubic control point relative to its owning on-curve endpoint. */
export interface CubicHandle {
  readonly pointId: PointId;
  readonly anchor: Point2D;
  readonly position: Point2D;
  /** Signed counterclockwise angle from the positive X axis. */
  readonly angleDegrees: number;
  /** Distance from the endpoint in glyph-local UPM units. */
  readonly length: number;
}
