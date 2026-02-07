import type { ToolEvent } from "../../core/GestureDetector";
import type { ToolContext } from "../../core/ToolContext";
import type { ShapeState } from "../types";
import { createBehavior } from "../../core/Behavior";

export const ShapeDraggingBehavior = createBehavior<ShapeState>({
  canHandle(state: ShapeState, event: ToolEvent): boolean {
    return (
      state.type === "dragging" &&
      (event.type === "drag" || event.type === "dragEnd" || event.type === "dragCancel")
    );
  },

  transition(state: ShapeState, event: ToolEvent, _editor: ToolContext) {
    if (state.type !== "dragging") return null;

    if (event.type === "drag") {
      return { state: { ...state, currentPos: event.point } };
    }

    if (event.type === "dragEnd" || event.type === "dragCancel") {
      return { state: { type: "ready" as const } };
    }

    return null;
  },
});
