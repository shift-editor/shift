import type { Point2D, PointId } from "@shift/types";

export type SelectState =
  | { type: "idle" }
  | { type: "ready"; hoveredPointId: PointId | null }
  | { type: "selecting"; selection: SelectionData }
  | { type: "selected"; hoveredPointId: PointId | null }
  | { type: "dragging"; drag: DragData };

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
