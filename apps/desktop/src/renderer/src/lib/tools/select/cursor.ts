import type { CursorType } from "@/types/editor";
import type { Point2D } from "@shift/types";
import type { HitTestService } from "@/lib/tools/core/createContext";
import type { ToolEvent } from "../core/GestureDetector";

export type BoundingRectEdge =
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | null;

export function edgeToCursor(edge: BoundingRectEdge): CursorType {
  switch (edge) {
    case "left":
    case "right":
      return { type: "ew-resize" };
    case "top":
    case "bottom":
      return { type: "ns-resize" };
    case "top-left":
    case "bottom-right":
      return { type: "nwse-resize" };
    case "top-right":
    case "bottom-left":
      return { type: "nesw-resize" };
    default:
      return { type: "default" };
  }
}

export interface CursorContext {
  hitTest: HitTestService;
  hitTestBoundingRectEdge: (pos: Point2D) => BoundingRectEdge;
}

export interface SelectCursorState {
  type: string;
  resize?: { edge: Exclude<BoundingRectEdge, null> };
}

export function getCursorForState(
  state: SelectCursorState,
  event: ToolEvent | null,
  ctx: CursorContext,
): CursorType {
  if (state.type === "dragging") {
    return { type: "move" };
  }

  if (state.type === "resizing" && state.resize) {
    return edgeToCursor(state.resize.edge);
  }

  if (event?.type === "drag") {
    return { type: "default" };
  }

  if (event?.type === "dragEnd") {
    return { type: "default" };
  }

  if (state.type === "selected" && event && "point" in event) {
    const edge = ctx.hitTestBoundingRectEdge(event.point);
    const pointId = ctx.hitTest.getPointIdAt(event.point);
    if (edge && !pointId) {
      return edgeToCursor(edge);
    }
  }

  return { type: "default" };
}
