import type { Point2D, Rect2D } from "@shift/types";
import type { ToolEvent } from "../../core/GestureDetector";
import type { ToolContext } from "../../core/ToolContext";
import type { DrawAPI } from "../../core/DrawAPI";
import type { ShapeState } from "../types";
import { createBehavior } from "../../core/Behavior";
import { DEFAULT_STYLES } from "@/lib/styles/style";

function getRect(startPos: Point2D, currentPos: Point2D): Rect2D {
  const width = currentPos.x - startPos.x;
  const height = currentPos.y - startPos.y;
  return {
    x: startPos.x,
    y: startPos.y,
    width,
    height,
    left: Math.min(startPos.x, currentPos.x),
    top: Math.min(startPos.y, currentPos.y),
    right: Math.max(startPos.x, currentPos.x),
    bottom: Math.max(startPos.y, currentPos.y),
  };
}

export const ShapeDraggingBehavior = createBehavior<ShapeState>({
  canHandle(state: ShapeState, event: ToolEvent): boolean {
    return (
      state.type === "dragging" &&
      (event.type === "drag" || event.type === "dragEnd" || event.type === "dragCancel")
    );
  },

  transition(state: ShapeState, event: ToolEvent, _editor: ToolContext): ShapeState | null {
    if (state.type !== "dragging") return null;

    if (event.type === "drag") {
      return { ...state, currentPos: event.point };
    }

    if (event.type === "dragEnd" || event.type === "dragCancel") {
      return { type: "ready" };
    }

    return null;
  },

  render(draw: DrawAPI, state: ShapeState, _editor: ToolContext): void {
    if (state.type !== "dragging") return;
    const rect = getRect(state.startPos, state.currentPos);
    if (Math.abs(rect.width) < 1 || Math.abs(rect.height) < 1) return;
    draw.rect(
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.width, y: rect.y + rect.height },
      {
        strokeStyle: DEFAULT_STYLES.strokeStyle,
        strokeWidth: DEFAULT_STYLES.lineWidth,
      },
    );
  },
});
