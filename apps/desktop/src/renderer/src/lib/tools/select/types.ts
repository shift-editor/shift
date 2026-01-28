import type { PointId, Point2D, Rect2D } from "@shift/types";
import type { BoundingRectEdge } from "./cursor";
import type { CornerHandle } from "@/types/boundingBox";
import type { ToolEvent } from "../core/GestureDetector";
import type { IRenderer } from "@/types/graphics";
import type { Editor } from "@/lib/editor";
import type { SelectIntent } from "./intents";

export interface SelectionData {
  startPos: Point2D;
  currentPos: Point2D;
}

export interface DragData {
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
}

export type SelectState =
  | { type: "idle"; intent?: SelectIntent }
  | { type: "ready"; hoveredPointId: PointId | null; intent?: SelectIntent }
  | { type: "selecting"; selection: SelectionData; intent?: SelectIntent }
  | { type: "selected"; hoveredPointId: PointId | null; intent?: SelectIntent }
  | { type: "dragging"; drag: DragData; intent?: SelectIntent }
  | { type: "resizing"; resize: ResizeData; intent?: SelectIntent }
  | { type: "rotating"; rotate: RotateData; intent?: SelectIntent };

export interface SelectBehavior {
  canHandle(state: SelectState, event: ToolEvent): boolean;
  transition(state: SelectState, event: ToolEvent, editor: Editor): SelectState | null;
  onTransition?(prev: SelectState, next: SelectState, event: ToolEvent, editor: Editor): void;
  render?(renderer: IRenderer, state: SelectState, editor: Editor): void;
}
