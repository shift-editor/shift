import type { ToolEvent } from "../../core/GestureDetector";
import type { ToolContext } from "../../core/ToolContext";
import type { HandState } from "../types";
import { createBehavior } from "../../core/Behavior";

export const HandReadyBehavior = createBehavior<HandState>({
  canHandle(state: HandState, event: ToolEvent): boolean {
    return state.type === "ready" && event.type === "dragStart";
  },

  transition(state: HandState, event: ToolEvent, editor: ToolContext) {
    if (state.type !== "ready" || event.type !== "dragStart") return null;
    const startPan = editor.pan;
    return {
      state: {
        type: "dragging" as const,
        screenStart: event.screenPoint,
        startPan,
      },
    };
  },
});
