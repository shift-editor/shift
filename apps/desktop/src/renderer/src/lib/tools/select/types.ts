import type { AnchorId, Point2D, PointId, Rect2D } from "@shift/types";
import type { BoundingRectEdge } from "./cursor";
import type { CornerHandle } from "@/types/boundingBox";
import type { Behavior } from "../core/Behavior";
import type { SegmentId } from "@/types/indicator";

export interface DragTarget {
  pointIds: PointId[];
  anchorIds: AnchorId[];
}

/** Tracks the start and current positions of a marquee drag. */
export interface SelectionDrag {
  startPos: Point2D;
  currentPos: Point2D;
}

/** Live state of a point-translate drag, including accumulated delta for undo grouping. */
export interface TranslateDrag {
  startPos: Point2D;
  lastPos: Point2D;
  totalDelta: Point2D;
}

/** Live state of a bounding-box resize operation, capturing the original geometry for proportional scaling. */
export interface ResizeDrag {
  edge: Exclude<BoundingRectEdge, null>;
  startPos: Point2D;
  lastPos: Point2D;
  initialBounds: Rect2D;
  anchorPoint: Point2D;
  uniformScale: boolean;
}

/** Live state of a rotation drag, tracking angles and initial point positions for the transform. */
export interface RotateDrag {
  corner: CornerHandle;
  startPos: Point2D;
  lastPos: Point2D;
  center: Point2D;
  startAngle: number;
  currentAngle: number;
  snappedAngle?: number;
}

export interface BendDrag {
  t: number;
  startPos: Point2D;
  initialControlOne: Point2D;
  initialControlTwo: Point2D;
  segmentId: SegmentId;
}

/**
 * State machine for the select tool.
 *
 * - `idle` -- no glyph loaded or tool not active.
 * - `ready` -- listening for clicks or drags.
 * - `selecting` -- marquee rectangle being drawn.
 * - `selected` -- one or more points are selected; bounding box visible.
 * - `translating` -- dragging selected points.
 * - `resizing` -- dragging a bounding-box edge handle.
 * - `rotating` -- dragging a bounding-box corner to rotate.
 */
export type SelectState =
  | { type: "idle" }
  | { type: "ready" }
  | { type: "selecting"; selection: SelectionDrag }
  | { type: "selected" }
  | { type: "translating"; translate: TranslateDrag }
  | { type: "resizing"; resize: ResizeDrag }
  | { type: "rotating"; rotate: RotateDrag }
  | { type: "bending"; bend: BendDrag };

export type SelectBehavior = Behavior<SelectState>;
