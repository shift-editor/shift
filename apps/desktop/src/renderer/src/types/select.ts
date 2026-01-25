import type { Point2D, PointId, Rect2D } from "@shift/types";
import type { BoundingRectEdge } from "@/lib/tools/select/commands";

export type SelectState =
  | { type: "idle" }
  | { type: "ready"; hoveredPointId: PointId | null }
  | { type: "selecting"; selection: SelectionData }
  | { type: "selected"; hoveredPointId: PointId | null }
  | { type: "dragging"; drag: DragData }
  | { type: "resizing"; resize: ResizeData };

export interface SelectionData {
  startPos: Point2D;
  currentPos: Point2D;
}

export interface DragData {
  anchorPointId: PointId;
  startPos: Point2D;
  lastPos: Point2D;
  totalDelta: Point2D;
}

export interface ResizeData {
  edge: Exclude<BoundingRectEdge, null>;
  startPos: Point2D;
  lastPos: Point2D;
  initialBounds: Rect2D;
  anchorPoint: Point2D;
}
