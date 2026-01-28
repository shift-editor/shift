import type { CursorType } from "@/types/editor";
import type { Point2D } from "@shift/types";
import type { HitTestService } from "@/lib/editor/services";
import type { ToolEvent } from "../core/GestureDetector";
import type { BoundingBoxHitResult, CornerHandle } from "@/types/boundingBox";

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

export function boundingBoxHitResultToCursor(result: BoundingBoxHitResult): CursorType {
  if (!result) {
    return { type: "default" };
  }

  if (result.type === "rotate") {
    switch (result.corner) {
      case "top-left":
        return { type: "rotate-tl" };
      case "top-right":
        return { type: "rotate-tr" };
      case "bottom-left":
        return { type: "rotate-bl" };
      case "bottom-right":
        return { type: "rotate-br" };
    }
  }

  return edgeToCursor(result.edge);
}

export interface CursorContext {
  hitTest: HitTestService;
  hitTestBoundingBox: (pos: Point2D) => BoundingBoxHitResult;
}

export interface SelectCursorState {
  type: string;
  resize?: { edge: Exclude<BoundingRectEdge, null> };
  rotate?: { corner: CornerHandle };
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

  if (state.type === "rotating" && state.rotate) {
    return boundingBoxHitResultToCursor({
      type: "rotate",
      corner: state.rotate.corner,
    });
  }

  if (event?.type === "drag") {
    return { type: "default" };
  }

  if (event?.type === "dragEnd") {
    return { type: "default" };
  }

  if (state.type === "selected" && event && "point" in event) {
    const hitResult = ctx.hitTestBoundingBox(event.point);
    const point = ctx.hitTest.getPointAt(event.point);
    if (hitResult && !point) {
      return boundingBoxHitResultToCursor(hitResult);
    }
  }

  return { type: "default" };
}
