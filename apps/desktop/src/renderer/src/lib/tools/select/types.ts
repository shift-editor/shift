import type { PointId, Point2D, Rect2D, AnchorId } from "@shift/types";
import type { BoundingRectEdge } from "./cursor";
import type { CornerHandle } from "@/types/boundingBox";
import type { ToolEvent } from "../core/GestureDetector";
import type { Behavior } from "../core/Behavior";
import type { SelectAction } from "./actions";

/** Tracks the start and current positions of a marquee drag. */
export interface SelectionData {
  startPos: Point2D;
  currentPos: Point2D;
}

/** Live state of a point-translate drag, including accumulated delta for undo grouping. */
export interface TranslateData {
  anchorPointId: PointId | null;
  startPos: Point2D;
  lastPos: Point2D;
  totalDelta: Point2D;
  draggedPointIds: PointId[];
  draggedAnchorIds: AnchorId[];
}

/** Live state of a bounding-box resize operation, capturing the original geometry for proportional scaling. */
export interface ResizeData {
  edge: Exclude<BoundingRectEdge, null>;
  startPos: Point2D;
  lastPos: Point2D;
  initialBounds: Rect2D;
  anchorPoint: Point2D;
  draggedPointIds: PointId[];
  initialPositions: Map<PointId, Point2D>;
  uniformScale: boolean;
}

/** Live state of a rotation drag, tracking angles and initial point positions for the transform. */
export interface RotateData {
  corner: CornerHandle;
  startPos: Point2D;
  lastPos: Point2D;
  center: Point2D;
  startAngle: number;
  currentAngle: number;
  draggedPointIds: PointId[];
  initialPositions: Map<PointId, Point2D>;
  snappedAngle?: number;
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
  | { type: "selecting"; selection: SelectionData }
  | { type: "selected" }
  | { type: "translating"; translate: TranslateData }
  | { type: "resizing"; resize: ResizeData }
  | { type: "rotating"; rotate: RotateData };

/** Behavior type alias for the select tool's state/event/action triple. */
export type SelectBehavior = Behavior<SelectState, ToolEvent, SelectAction>;
