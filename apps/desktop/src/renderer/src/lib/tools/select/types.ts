import type { Point2D, Rect2D } from "@shift/geo";
import type { AnchorId, PointId } from "@shift/types";
import type { BoundingRectEdge } from "./cursor";
import type { CornerHandle } from "./BoundingBox";
import type { Behavior } from "../core/Behavior";
import type { Select } from "./Select";
import type { SegmentId } from "@/types/indicator";

export interface DragTarget {
  pointIds: PointId[];
  anchorIds: AnchorId[];
}

/** Tracks the start and current positions of a marquee drag. */
export interface BrushingDrag {
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
}

export interface BendDrag {
  t: number;
  startPos: Point2D;
  controlOneId: PointId;
  controlTwoId: PointId;
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
 * - `translating` -- dragging selected points.
 * - `resizing` -- dragging a bounding-box edge handle.
 * - `rotating` -- dragging a bounding-box corner to rotate.
 */
export type SelectState =
  | { type: "idle" }
  | { type: "ready" }
  | { type: "brushing"; selection: BrushingDrag }
  | { type: "translating"; translate: TranslateDrag }
  | { type: "resizing"; resize: ResizeDrag }
  | { type: "rotating"; rotate: RotateDrag }
  | { type: "bending"; bend: BendDrag };

export type SelectBehavior<TTool = Select> = Behavior<SelectState, TTool>;
