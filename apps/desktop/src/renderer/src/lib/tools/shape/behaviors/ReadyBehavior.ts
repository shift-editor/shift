import type { ToolEvent } from "../../core/GestureDetector";
import type { ToolContext } from "../../core/ToolContext";
import type { ShapeState } from "../types";
import { createBehavior } from "../../core/Behavior";

export const ShapeReadyBehavior = createBehavior<ShapeState>({
  canHandle(state: ShapeState, event: ToolEvent): boolean {
    return state.type === "ready" && event.type === "dragStart";
  },

  transition(state: ShapeState, event: ToolEvent, _editor: ToolContext) {
    if (state.type !== "ready" || event.type !== "dragStart") return null;
    return {
      state: {
        type: "dragging" as const,
        startPos: event.point,
        currentPos: event.point,
      },
    };
  },
});
