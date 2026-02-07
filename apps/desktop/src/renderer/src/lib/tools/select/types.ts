import type { PointId, Point2D, Rect2D } from "@shift/types";
import type { BoundingRectEdge } from "./cursor";
import type { CornerHandle } from "@/types/boundingBox";
import type { ToolEvent } from "../core/GestureDetector";
import type { Behavior } from "../core/Behavior";
import type { SelectAction } from "./actions";
export interface SelectionData {
  startPos: Point2D;
  currentPos: Point2D;
}

export interface TranslateData {
  anchorPointId: PointId;
  startPos: Point2D;
  lastPos: Point2D;
  totalDelta: Point2D;
  draggedPointIds: PointId[];
}

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

export type SelectState =
  | { type: "idle" }
  | { type: "ready" }
  | { type: "selecting"; selection: SelectionData }
  | { type: "selected" }
  | { type: "translating"; translate: TranslateData }
  | { type: "resizing"; resize: ResizeData }
  | { type: "rotating"; rotate: RotateData };

export type SelectBehavior = Behavior<SelectState, ToolEvent, SelectAction>;
